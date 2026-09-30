-- Story 1.1: identity (profiles, admin_roles), one-time links
-- (activation_tokens) and the manual password-reset flow.
-- AD-3 identity, AD-5 grants and RPC contract, AD-6 lock order,
-- AD-10 tokens, AD-21 two-step privileged operation.
-- Idempotency and audit log arrive in story 1.4 and are applied to these
-- RPCs then.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- profiles.id = auth.users.id (AD-3). No FK to auth.users so that
-- anonymization can delete the Auth user. Email lives only in auth.users.
-- E2 adds the remaining columns (phone, consent, dietary notes, ...).
create table public.profiles (
  id uuid primary key,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  activated_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Admin is identified only by admin_roles, never by a profile column (AD-3).
create table public.admin_roles (
  user_id uuid primary key,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now()
);

alter table public.admin_roles enable row level security;

-- One-time links (AD-10). Only the sha256 hex of the raw token is stored.
-- "expired" is derived (now() > expires_at and state in pending,
-- awaiting_login), never stored. Server-only: no grants to API roles; all
-- access goes through security definer RPCs.
create table public.activation_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('join', 'claim', 'reset')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'awaiting_login', 'claiming', 'consumed', 'revoked', 'conflict')),
  expires_at timestamptz not null,
  bound_user_id uuid,
  pending_user_id uuid,
  customer_id uuid references public.profiles (id),
  input_hash text,
  conflict_reason text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  constraint activation_tokens_consumed_at_check
    check ((state = 'consumed') = (consumed_at is not null)),
  constraint activation_tokens_revoked_at_check
    check ((state = 'revoked') = (revoked_at is not null)),
  constraint activation_tokens_reset_target_check
    check (purpose <> 'reset' or bound_user_id is not null)
);

alter table public.activation_tokens enable row level security;

-- At most one live reset link per user: issuing a replacement revokes the
-- previous one in the same transaction.
create unique index activation_tokens_live_reset_uidx
  on public.activation_tokens (bound_user_id)
  where purpose = 'reset' and state = 'pending';
create index activation_tokens_bound_user_id_idx on public.activation_tokens (bound_user_id);
create index activation_tokens_customer_id_idx on public.activation_tokens (customer_id);

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- Called from policies: security definer stable, no arguments (AD-5).
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles r where r.user_id = (select auth.uid())
  );
$$;

-- auth.uid() only when it has an activated, non-anonymized profile (AD-3).
create function private.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.activated_at is not null
    and p.anonymized_at is null;
$$;

-- sha256 hex of a raw token. Internal: TS never hashes a token (AD-10).
create function private.token_hash(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_raw, 'sha256'), 'hex');
$$;

-- The only place a token is created (AD-10): 32 random bytes, base64url
-- without padding, 48 hours. The raw token is returned once and never stored.
create function private.issue_token(p_purpose text, p_bound_user_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_raw text;
  v_id uuid;
  v_expires_at timestamptz := now() + interval '48 hours';
begin
  if p_purpose is null or p_purpose not in ('join', 'claim', 'reset') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  insert into public.activation_tokens (purpose, token_hash, expires_at, bound_user_id)
  values (p_purpose, private.token_hash(v_raw), v_expires_at, p_bound_user_id)
  returning id into v_id;

  return jsonb_build_object('token_id', v_id, 'token', v_raw, 'expires_at', v_expires_at);
end;
$$;

-- The only lookup of a token by its raw value (AD-10). Returns a row of
-- nulls when the token does not exist or is malformed.
create function private.find_token(p_raw text, p_for_update boolean)
returns public.activation_tokens
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
begin
  if p_raw is null or p_raw !~ '^[A-Za-z0-9_-]{43}$' then
    return v_token;
  end if;

  if p_for_update then
    select t.* into v_token
    from public.activation_tokens t
    where t.token_hash = private.token_hash(p_raw)
    for update;
  else
    select t.* into v_token
    from public.activation_tokens t
    where t.token_hash = private.token_hash(p_raw);
  end if;

  return v_token;
end;
$$;

-- A reset targets an activated, non-anonymized customer or an admin.
create function private.reset_target_valid(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.admin_roles r where r.user_id = p_user_id)
      or exists (
        select 1 from public.profiles p
        where p.id = p_user_id
          and p.activated_at is not null
          and p.anonymized_at is null
      );
$$;

-- ---------------------------------------------------------------------------
-- Policies and table grants
-- ---------------------------------------------------------------------------

create policy profiles_authenticated_select on public.profiles
  for select to authenticated
  using (id = (select private.current_customer_id()) or (select private.is_admin()));

revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select on table public.profiles to authenticated;
grant select, insert on table public.profiles to service_role;

-- admin_roles: read only through private.is_admin(); written only by a
-- privileged server (dev script today). No policy for API roles.
revoke all on table public.admin_roles from public, anon, authenticated, service_role;
grant select, insert on table public.admin_roles to service_role;

revoke all on table public.activation_tokens from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- 'admin' | 'customer' | 'none'. Used by the /me and /admin guards.
create function public.get_my_session_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if private.is_admin() then
    return 'admin';
  end if;

  if private.current_customer_id() is not null then
    return 'customer';
  end if;

  return 'none';
end;
$$;

-- Issues a reset link for an activated customer or an admin and revokes the
-- previous live reset link of the same user. Service role only; the admin
-- button (admin_issue_link) replaces the caller in story 2.8.
create function public.issue_reset_token(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Serializes concurrent issuing for the same user before any row lock.
  perform pg_advisory_xact_lock(hashtext('activation_tokens:reset:' || p_user_id::text));

  if not private.reset_target_valid(p_user_id) then
    raise exception 'RESET_TARGET_INVALID' using errcode = 'P0001';
  end if;

  update public.activation_tokens
  set state = 'revoked', revoked_at = now()
  where purpose = 'reset'
    and bound_user_id = p_user_id
    and state = 'pending';

  return private.issue_token('reset', p_user_id);
end;
$$;

-- Step 1 of the reset (AD-21): check the link and return the target user.
-- The FOR UPDATE lock is released when this RPC's transaction ends, so it
-- does not protect the Auth update that follows; reset_complete locks and
-- re-checks the token. Does not change state (reset has no intermediate state).
create function public.reset_begin(p_token text)
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

  v_token := private.find_token(p_token, true);

  if v_token.id is null or v_token.purpose <> 'reset' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state <> 'pending'
     or now() > v_token.expires_at
     or not private.reset_target_valid(v_token.bound_user_id) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object('token_id', v_token.id, 'user_id', v_token.bound_user_id);
end;
$$;

-- Step 3 of the reset (AD-21), after Auth updated the password. Finishes
-- even if the link expired since reset_begin, and returns success for a link
-- that is already consumed, so a retry completes.
create function public.reset_complete(p_token text)
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

  -- Lock order (AD-6): activation_tokens, then profiles (only read here).
  v_token := private.find_token(p_token, true);

  if v_token.id is null or v_token.purpose <> 'reset' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'consumed' then
    return jsonb_build_object(
      'token_id', v_token.id,
      'user_id', v_token.bound_user_id,
      'already_consumed', true
    );
  end if;

  if v_token.state <> 'pending' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  update public.activation_tokens
  set state = 'consumed',
      consumed_at = now(),
      customer_id = (select p.id from public.profiles p where p.id = v_token.bound_user_id)
  where id = v_token.id;

  return jsonb_build_object(
    'token_id', v_token.id,
    'user_id', v_token.bound_user_id,
    'already_consumed', false
  );
end;
$$;

-- Public view of a link for /reset/[token] and /join/[token]. Never changes
-- state, so opening or previewing a link does not consume it.
-- state_public: active | used | expired | conflict | not_found.
-- Product fields stay null until E2.
create function public.token_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_state text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  v_state := case
    when v_token.id is null then 'not_found'
    when v_token.state = 'consumed' then 'used'
    when v_token.state = 'conflict' then 'conflict'
    when v_token.state = 'revoked' then 'expired'
    when v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at then 'expired'
    when v_token.purpose = 'reset' and not private.reset_target_valid(v_token.bound_user_id) then 'expired'
    else 'active'
  end;

  return jsonb_build_object(
    'state_public', v_state,
    'purpose', v_token.purpose,
    'product_name', null,
    'amount_agorot', null,
    'expires_on', case
      when v_state = 'active' then (v_token.expires_at at time zone 'Asia/Jerusalem')::date
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): revoke from every role, then exactly one grant.
-- ---------------------------------------------------------------------------

revoke execute on function private.is_admin() from public, anon, authenticated, service_role;
grant execute on function private.is_admin() to authenticated;

revoke execute on function private.current_customer_id() from public, anon, authenticated, service_role;
grant execute on function private.current_customer_id() to authenticated;

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.token_hash(text) from public, anon, authenticated, service_role;
revoke execute on function private.issue_token(text, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.find_token(text, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.reset_target_valid(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.get_my_session_role() from public, anon, authenticated, service_role;
grant execute on function public.get_my_session_role() to authenticated;

revoke execute on function public.issue_reset_token(uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_reset_token(uuid) to service_role;

revoke execute on function public.reset_begin(text) from public, anon, authenticated, service_role;
grant execute on function public.reset_begin(text) to service_role;

revoke execute on function public.reset_complete(text) from public, anon, authenticated, service_role;
grant execute on function public.reset_complete(text) to service_role;

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;
