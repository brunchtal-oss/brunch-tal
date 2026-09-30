-- Story 1.4: the shared RPC contract.
-- AD-5 idempotency (private.idempotency_results, idempotent_begin/finish),
-- AD-19 audit log (public.audit_log, private.audit, private.audit_diff), and
-- both reset RPCs of story 1.1 rebuilt on top of them (new signature with
-- p_idempotency_key: drop, then create, in this same migration).

-- ---------------------------------------------------------------------------
-- Idempotency (AD-5)
-- ---------------------------------------------------------------------------

-- One row per (actor scope, rpc, key). Inserted without a result by
-- idempotent_begin, so a concurrent call with the same key waits on the
-- primary key; filled by idempotent_finish in the same transaction. A failed
-- call rolls the row back, so nothing is stored for a failure.
-- Internal: RLS on, no policy, no grant to any API role.
create table private.idempotency_results (
  actor_scope text not null check (char_length(btrim(actor_scope)) between 1 and 200),
  rpc text not null check (char_length(btrim(rpc)) between 1 and 100),
  key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_scope, rpc, key)
);

alter table private.idempotency_results enable row level security;

revoke all on table private.idempotency_results from public, anon, authenticated, service_role;

-- First statement after the permission check, before any lock. Returns null
-- when the caller should run, or the stored result of an earlier successful
-- call with the same scope, rpc, key and request. The request is hashed as
-- sha256 hex of p_request::text (jsonb text is canonical).
create function private.idempotent_begin(
  p_scope text,
  p_rpc text,
  p_key uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_hash text;
  v_inserted boolean;
  v_row private.idempotency_results;
begin
  if p_key is null
     or p_scope is null or btrim(p_scope) = ''
     or p_rpc is null or btrim(p_rpc) = '' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_hash := encode(
    extensions.digest(coalesce(p_request, '{}'::jsonb)::text, 'sha256'),
    'hex'
  );

  -- A concurrent transaction holding the same key makes this insert wait
  -- until it commits (conflict) or rolls back (insert succeeds).
  insert into private.idempotency_results (actor_scope, rpc, key, request_hash)
  values (p_scope, p_rpc, p_key, v_hash)
  on conflict do nothing
  returning true into v_inserted;

  if v_inserted then
    return null;
  end if;

  select r.* into v_row
  from private.idempotency_results r
  where r.actor_scope = p_scope and r.rpc = p_rpc and r.key = p_key;

  if v_row.request_hash <> v_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
  end if;

  if v_row.result is null then
    -- A committed row always has a result; only a second begin for the same
    -- key inside one transaction gets here. Internal error, not a P0001 code.
    raise exception 'idempotency row without result' using errcode = 'XX000';
  end if;

  return v_row.result;
end;
$$;

-- Last statement of a successful call: stores and returns the result.
create function private.idempotent_finish(
  p_scope text,
  p_rpc text,
  p_key uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_result is null then
    raise exception 'idempotent_finish without a result' using errcode = 'XX000';
  end if;

  update private.idempotency_results
  set result = p_result
  where actor_scope = p_scope
    and rpc = p_rpc
    and key = p_key
    and result is null;

  if not found then
    raise exception 'idempotent_finish without idempotent_begin' using errcode = 'XX000';
  end if;

  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (AD-19)
-- ---------------------------------------------------------------------------

-- before/after hold only the columns that changed, built by
-- private.audit_diff; identifying values are replaced with "<changed>".
-- Never a password, token, token hash or link: only ids. No FK to events
-- (the table arrives in E3).
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'customer', 'system')),
  action text not null check (char_length(btrim(action)) between 1 and 100),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 100),
  entity_id uuid,
  customer_id uuid references public.profiles (id),
  event_id uuid,
  before jsonb not null default '{}'::jsonb check (jsonb_typeof(before) = 'object'),
  after jsonb not null default '{}'::jsonb check (jsonb_typeof(after) = 'object'),
  reason text check (reason is null or char_length(reason) <= 2000),
  constraint audit_log_actor_check
    check (actor_kind = 'system' or actor_id is not null)
);

alter table public.audit_log enable row level security;

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_customer_id_idx on public.audit_log (customer_id);
create index audit_log_event_id_idx on public.audit_log (event_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- Read by admins only (CAP-26). No role writes directly: only private.audit.
create policy audit_log_authenticated_select on public.audit_log
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to authenticated;

-- {before, after} with only the keys whose value changed. A key present on
-- one side only appears on that side. Identifying values become "<changed>".
create function private.audit_diff(p_old jsonb, p_new jsonb, p_table text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with keys as (
    select k from jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as k
    union
    select k from jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as k
  ),
  changed as (
    select
      k,
      coalesce(p_old, '{}'::jsonb) ? k as in_old,
      coalesce(p_new, '{}'::jsonb) ? k as in_new,
      coalesce(p_old, '{}'::jsonb) -> k as old_value,
      coalesce(p_new, '{}'::jsonb) -> k as new_value,
      (
        p_table = 'babies'
        or (p_table = 'profiles' and k = 'full_name')
        or (p_table = 'bookings' and k = 'guest_details')
        or k in ('phone_e164', 'dietary_notes', 'pending_email',
                 'email', 'token_hash', 'input_hash')
        or k like '%\_email'
      ) as masked
    from keys
    where (coalesce(p_old, '{}'::jsonb) -> k) is distinct from (coalesce(p_new, '{}'::jsonb) -> k)
  )
  select jsonb_build_object(
    'before', coalesce(
      jsonb_object_agg(k, case when masked then to_jsonb('<changed>'::text) else old_value end)
        filter (where in_old),
      '{}'::jsonb
    ),
    'after', coalesce(
      jsonb_object_agg(k, case when masked then to_jsonb('<changed>'::text) else new_value end)
        filter (where in_new),
      '{}'::jsonb
    )
  )
  from changed;
$$;

-- The only writer of audit_log. The actor is a parameter, never derived from
-- auth.uid(), so a service-role call (job, token flow) is recorded correctly.
-- Takes the full old and new rows and stores only the masked diff.
create function private.audit(
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_customer_id uuid,
  p_event_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_reason text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_diff jsonb := private.audit_diff(p_old, p_new, p_entity_type);
  v_id uuid;
begin
  insert into public.audit_log (
    actor_id, actor_kind, action, entity_type, entity_id,
    customer_id, event_id, before, after, reason
  )
  values (
    p_actor_id, p_actor_kind, p_action, p_entity_type, p_entity_id,
    p_customer_id, p_event_id, v_diff -> 'before', v_diff -> 'after', p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reset RPCs with idempotency and audit (replaces story 1.1 signatures)
-- ---------------------------------------------------------------------------

drop function public.reset_begin(text);
drop function public.reset_complete(text);

-- Step 1 of the reset (AD-21): checks the link and returns the target user.
-- Stores nothing. A link consumed by reset_complete with this same key
-- returns already_completed: true, so a retry after a lost response goes on;
-- consumed with another key is LINK_USED; revoked or expired stays closed.
create function public.reset_begin(p_token text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'reset' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'consumed' then
    if exists (
      select 1
      from private.idempotency_results r
      where r.actor_scope = 'token:' || v_token.id::text
        and r.rpc = 'reset_complete'
        and r.key = p_idempotency_key
        and r.result is not null
    ) then
      return jsonb_build_object(
        'token_id', v_token.id,
        'user_id', v_token.bound_user_id,
        'already_completed', true
      );
    end if;
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state <> 'pending'
     or now() > v_token.expires_at
     or not private.reset_target_valid(v_token.bound_user_id) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'token_id', v_token.id,
    'user_id', v_token.bound_user_id,
    'already_completed', false
  );
end;
$$;

-- Step 3 of the reset (AD-21), after Auth updated the password. Idempotent
-- per (token, key): a repeat returns the stored result without a second audit
-- row. Finishes even if the link expired since reset_begin. Consumed by
-- another key is LINK_USED; revoked is LINK_EXPIRED.
create function public.reset_complete(p_token text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_actor_kind text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Find the token without a lock only to build the scope; the request is
  -- '{}' so the raw token never reaches the stored hash.
  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'reset' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;
  v_prev := private.idempotent_begin(v_scope, 'reset_complete', p_idempotency_key, '{}'::jsonb);
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens, then profiles (only read here).
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state <> 'pending' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  update public.activation_tokens
  set state = 'consumed',
      consumed_at = now(),
      customer_id = (select p.id from public.profiles p where p.id = v_token.bound_user_id)
  where id = v_token.id
  returning * into v_new;

  v_actor_kind := case
    when exists (select 1 from public.admin_roles r where r.user_id = v_token.bound_user_id)
      then 'admin'
    else 'customer'
  end;

  perform private.audit(
    v_token.bound_user_id,
    v_actor_kind,
    'reset_complete',
    'activation_tokens',
    v_token.id,
    v_new.customer_id,
    null,
    to_jsonb(v_token),
    to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_scope,
    'reset_complete',
    p_idempotency_key,
    jsonb_build_object('token_id', v_token.id, 'user_id', v_token.bound_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): revoke from every role, then exactly one grant.
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.idempotent_begin(text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.idempotent_finish(text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.audit_diff(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function private.audit(uuid, text, text, text, uuid, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated, service_role;

revoke execute on function public.reset_begin(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_begin(text, uuid) to service_role;

revoke execute on function public.reset_complete(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_complete(text, uuid) to service_role;
