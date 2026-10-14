-- Story 2.8: admin-assisted reset, email and phone change, rate limit
-- (CAP-7, AD-3, AD-5, AD-10, AD-19, AD-21, AD-22).
--
-- 1. profiles.account_op_state / account_op_started_at /
--    account_op_target_hash: the intent state of a two-step account
--    operation (AD-21). The pending email is stored only as
--    sha256(lower(btrim(email))), never the address.
-- 2. private.rate_limits + public.rate_limit_hit (service_role only): one
--    fixed-window counter for the login and the token actions.
-- 3. Redefined admin_issue_link: purpose 'reset' (customer only).
-- 4. admin_begin_email_change / admin_finish_email_change (AD-21),
--    admin_change_phone, admin_get_customer_account (read).
-- 5. private.guard_auth_user_change + a before update trigger on
--    auth.users: an email change is accepted only when Tal started it (the
--    profile is email_change_pending and the hash matches); a phone change
--    is always refused. So a customer cannot change her own email with
--    auth.updateUser and the publishable key.
-- 6. Redefined private.audit_diff (masks account_op_target_hash) and
--    admin_get_attention_items (kind email_change_stuck).
--
-- Every redefined function starts from pg_get_functiondef of the live DB
-- (2026-10-13, after 3.8 and 3.5).

-- 1. Account operation state ---------------------------------------------

alter table public.profiles
  add column account_op_state text
    constraint profiles_account_op_state_check
    check (account_op_state in ('email_change_pending', 'anonymization_pending')),
  add column account_op_started_at timestamptz,
  add column account_op_target_hash text
    constraint profiles_account_op_target_hash_check
    check (account_op_target_hash ~ '^[0-9a-f]{64}$');

alter table public.profiles
  add constraint profiles_account_op_consistent_check check (
    (account_op_state is null) = (account_op_started_at is null)
    and coalesce(account_op_state = 'email_change_pending', false) = (account_op_target_hash is not null)
  );

-- The stuck item of "to handle" reads only the profiles in a state.
create index profiles_account_op_started_at_idx
  on public.profiles (account_op_started_at)
  where account_op_state is not null;

-- The hash of an email as stored in account_op_target_hash.
create function private.email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(lower(btrim(p_email)), '') is null then null
    else encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex')
  end;
$$;

-- 2. Rate limit ---------------------------------------------------------

-- One row per bucket, hashed key and fixed 15-minute window. The key is
-- never stored in clear (an IP, an email or a token id).
create table private.rate_limits (
  bucket text not null check (bucket in ('login', 'token')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, key_hash, window_start)
);

create index rate_limits_window_start_idx on private.rate_limits (window_start);

alter table private.rate_limits enable row level security;
revoke all on table private.rate_limits from public, anon, authenticated, service_role;

-- Counts one attempt for every key and answers whether all of them are
-- still under their limit in the current window (blocked until the window
-- ends). Keys are "ip:<address>" or "id:<account or token>"; the limit
-- follows the bucket and the prefix (user decision 2026-10-13):
--   login: ip 20, id (normalized email) 8
--   token: ip 20, id (token) 10
-- Every attempt counts, allowed or not, whether the account exists or not.
-- Exempt from idempotency (AD-5): a counter, each call is one attempt.
create function public.rate_limit_hit(p_bucket text, p_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  v_key text;
  v_hits integer;
  v_limit integer;
  v_allowed boolean := true;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_bucket is null or p_bucket not in ('login', 'token')
     or p_keys is null
     or cardinality(p_keys) not between 1 and 4
     or exists (
       select 1 from unnest(p_keys) k
       where k is null
          or char_length(k) not between 4 and 512
          or k !~ '^(ip|id):.'
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Sorted, so two concurrent calls lock the rows in one order.
  for v_key in
    select distinct k from unnest(p_keys) k
    order by k
  loop
    insert into private.rate_limits as r (bucket, key_hash, window_start, hits)
    values (
      p_bucket,
      encode(extensions.digest(v_key, 'sha256'), 'hex'),
      v_window,
      1
    )
    on conflict (bucket, key_hash, window_start)
    do update set hits = r.hits + 1
    returning r.hits into v_hits;

    v_limit := case
      when v_key like 'ip:%' then 20
      when p_bucket = 'login' then 8
      else 10
    end;

    if v_hits > v_limit then
      v_allowed := false;
    end if;
  end loop;

  -- Old windows are removed a little at a time.
  delete from private.rate_limits
  where ctid in (
    select r.ctid from private.rate_limits r
    where r.window_start < now() - interval '1 day'
    limit 100
  );

  return jsonb_build_object('allowed', v_allowed);
end;
$$;

-- 3. Reset link from the admin card -------------------------------------

create or replace function public.admin_issue_link(p_purpose text, p_target_id uuid, p_idempotency_key uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_live public.activation_tokens;
  v_old public.activation_tokens;
  v_revoked public.activation_tokens;
  v_pending_user_id uuid;
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_customer_id uuid;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_issue_link', p_idempotency_key,
    jsonb_build_object('purpose', p_purpose, 'target_id', p_target_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- claim arrives with the import (E6).
  if p_purpose is null or p_purpose not in ('join', 'reset') or p_target_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_purpose = 'join' then
    v_live := private.lock_join_payment(p_target_id);

    if v_live.id is not null then
      v_pending_user_id := private.revoke_join_token(v_live, v_actor);
    end if;

    v_token := private.issue_token('join', null, p_target_id);
  else
    -- Reset (story 2.8): the target is an activated customer, never an
    -- admin or a removed profile. Serialized like issue_reset_token, before
    -- any row lock; the previous pending reset link is revoked in the same
    -- transaction (one live reset link per user).
    perform pg_advisory_xact_lock(hashtext('activation_tokens:reset:' || p_target_id::text));

    if not private.reset_target_valid(p_target_id)
       or exists (select 1 from public.admin_roles r where r.user_id = p_target_id) then
      raise exception 'RESET_TARGET_INVALID' using errcode = 'P0001';
    end if;

    v_customer_id := p_target_id;

    for v_old in
      select t.* from public.activation_tokens t
      where t.purpose = 'reset'
        and t.bound_user_id = p_target_id
        and t.state = 'pending'
      order by t.id
      for update
    loop
      update public.activation_tokens
      set state = 'revoked', revoked_at = now()
      where id = v_old.id
      returning * into v_revoked;

      perform private.audit(
        v_actor, 'admin', 'revoke_link', 'activation_tokens', v_old.id,
        p_target_id, null, to_jsonb(v_old), to_jsonb(v_revoked)
      );
    end loop;

    v_token := private.issue_token('reset', p_target_id);
  end if;

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  perform private.audit(
    v_actor, 'admin', 'admin_issue_link', 'activation_tokens', v_token_row.id,
    v_customer_id, null, null, to_jsonb(v_token_row)
  );

  v_result := private.idempotent_finish(
    v_actor::text, 'admin_issue_link', p_idempotency_key,
    jsonb_build_object(
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'revoked_pending_user_id', v_pending_user_id,
      'reissue_required', true
    )
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$function$;

-- 4. Email and phone change ---------------------------------------------

-- Step 1 of an email change (AD-21). Checks the address with find_identity
-- and writes the intent (email_change_pending + the target's hash); the
-- server then updates Auth and calls admin_finish_email_change. Results:
--   pending: go on to Auth (also when the same change is pending: resume)
--   taken:   the address belongs to another account or a pending import;
--            nothing changes, the audit row is committed (no raise).
-- Raises EMAIL_UNCHANGED (her own address), INVALID_INPUT (field email),
-- CUSTOMER_NOT_AVAILABLE (admin, removed, not activated, or in another
-- account operation).
create function public.admin_begin_email_change(p_customer_id uuid, p_email text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_hash text := private.email_hash(p_email);
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_current text;
  v_match jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- The request is hashed; the address itself never reaches the row.
  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_begin_email_change', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'email_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null
     or v_email is null
     or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "email"}';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.anonymized_at is not null
     or v_old.activated_at is null
     or v_old.account_op_state = 'anonymization_pending'
     or exists (select 1 from public.admin_roles r where r.user_id = v_old.id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- The same change again (a crash between the steps): resume from Auth.
  if v_old.account_op_state = 'email_change_pending'
     and v_old.account_op_target_hash = v_hash then
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_email_change', p_idempotency_key,
      jsonb_build_object('result', 'pending', 'user_id', v_old.id)
    );
  end if;

  select u.email into v_current from auth.users u where u.id = v_old.id;
  if lower(btrim(v_current)) = v_email then
    raise exception 'EMAIL_UNCHANGED' using errcode = 'P0001';
  end if;

  v_match := private.find_identity(v_email, null);
  if v_match ->> 'match' <> 'none'
     and (v_match ->> 'customer_id') is distinct from v_old.id::text then
    -- Blocked: logged and committed, without the address (source §10).
    perform private.audit(
      v_actor, 'admin', 'admin_begin_email_change', 'profiles', v_old.id,
      v_old.id, null, null, jsonb_build_object('result', 'taken')
    );
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_email_change', p_idempotency_key,
      jsonb_build_object('result', 'taken')
    );
  end if;

  update public.profiles
  set account_op_state = 'email_change_pending',
      account_op_started_at = now(),
      account_op_target_hash = v_hash
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_begin_email_change', 'profiles', v_old.id,
    v_old.id, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_begin_email_change', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', v_old.id)
  );
end;
$$;

-- Step 3 of an email change. p_succeeded: whether Auth took the new
-- address. true: Auth must hold the pending address (else
-- CONCURRENT_CHANGE, the state stays and the item shows as stuck); the
-- state is cleared and the change is logged (email masked). false (Auth
-- answered email_exists): the state is cleared and the block is logged.
-- No pending change (finished already): not_pending.
create function public.admin_finish_email_change(p_customer_id uuid, p_succeeded boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_current text;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_finish_email_change', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'succeeded', p_succeeded)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null or p_succeeded is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.account_op_state is distinct from 'email_change_pending' then
    return private.idempotent_finish(
      v_actor::text, 'admin_finish_email_change', p_idempotency_key,
      jsonb_build_object('result', 'not_pending')
    );
  end if;

  select u.email into v_current from auth.users u where u.id = v_old.id;

  if p_succeeded and private.email_hash(v_current) is distinct from v_old.account_op_target_hash then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  update public.profiles
  set account_op_state = null,
      account_op_started_at = null,
      account_op_target_hash = null
  where id = v_old.id
  returning * into v_new;

  if p_succeeded then
    -- email is masked by audit_diff: the row says only that it changed.
    perform private.audit(
      v_actor, 'admin', 'admin_finish_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old) || jsonb_build_object('email', 'previous'),
      to_jsonb(v_new) || jsonb_build_object('email', 'current')
    );
  else
    perform private.audit(
      v_actor, 'admin', 'admin_finish_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old),
      to_jsonb(v_new) || jsonb_build_object('result', 'taken')
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_finish_email_change', p_idempotency_key,
    jsonb_build_object('result', case when p_succeeded then 'changed' else 'taken' end)
  );
end;
$$;

-- A phone change through Tal (source §10): normalized by
-- private.normalize_phone, checked with find_identity. Results: changed;
-- taken (another account, a pending import, or a concurrent change to the
-- same number): nothing changes, the audit row is committed (no raise).
-- Raises INVALID_PHONE, PHONE_UNCHANGED, CUSTOMER_NOT_AVAILABLE (admin,
-- removed, or in another account operation).
create function public.admin_change_phone(p_customer_id uuid, p_phone text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_phone text := private.normalize_phone(p_phone);
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_match jsonb;
  v_taken boolean := false;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_change_phone', p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'phone_hash', encode(extensions.digest(coalesce(v_phone, ''), 'sha256'), 'hex')
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_phone is null then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.anonymized_at is not null
     or v_old.account_op_state = 'anonymization_pending'
     or exists (select 1 from public.admin_roles r where r.user_id = v_old.id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if v_old.phone_e164 = v_phone then
    raise exception 'PHONE_UNCHANGED' using errcode = 'P0001';
  end if;

  v_match := private.find_identity(null, v_phone);
  if v_match ->> 'match' <> 'none'
     and (v_match ->> 'customer_id') is distinct from v_old.id::text then
    v_taken := true;
  else
    begin
      update public.profiles
      set phone_e164 = v_phone
      where id = v_old.id
      returning * into v_new;
    exception when unique_violation then
      -- Another account took the number in the meantime.
      v_taken := true;
    end;
  end if;

  if v_taken then
    perform private.audit(
      v_actor, 'admin', 'admin_change_phone', 'profiles', v_old.id,
      v_old.id, null, null, jsonb_build_object('result', 'taken')
    );
    return private.idempotent_finish(
      v_actor::text, 'admin_change_phone', p_idempotency_key,
      jsonb_build_object('result', 'taken')
    );
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_change_phone', 'profiles', v_old.id,
    v_old.id, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_change_phone', p_idempotency_key,
    jsonb_build_object('result', 'changed')
  );
end;
$$;

-- The account part of the admin customer card (story 2.8): the account
-- operation state (stuck after 15 minutes, as in "to handle") and the
-- latest reset link (status derived: expired is pending past expires_at).
-- Never the token or its hash. NOT_FOUND like admin_get_customer.
create function public.admin_get_customer_account(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_link jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and p.anonymized_at is null
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'token_id', t.id,
    'status', case
      when t.state = 'pending' and now() > t.expires_at then 'expired'
      else t.state
    end,
    'created_at', t.created_at,
    'expires_at', t.expires_at,
    'consumed_at', t.consumed_at,
    'revoked_at', t.revoked_at
  )
  into v_link
  from public.activation_tokens t
  where t.purpose = 'reset'
    and t.bound_user_id = v_profile.id
  order by t.created_at desc, t.id desc
  limit 1;

  return jsonb_build_object(
    'customer_id', v_profile.id,
    'is_activated', v_profile.activated_at is not null,
    'account_op_state', v_profile.account_op_state,
    'account_op_started_at', v_profile.account_op_started_at,
    'email_change_stuck', coalesce(
      v_profile.account_op_state = 'email_change_pending'
        and v_profile.account_op_started_at < now() - interval '15 minutes',
      false
    ),
    'reset_link', v_link
  );
end;
$$;

-- 5. No self change of email or phone in Auth ---------------------------

-- Runs inside every update of auth.users (Supabase Auth runs as
-- supabase_auth_admin; definer, so it can read public.profiles). Allowed:
--   - any update that leaves email, email_change, phone and phone_change
--     as they are (sign-in, password, metadata);
--   - an email change when the profile is email_change_pending and the new
--     address (and email_change, if set) matches account_op_target_hash,
--     i.e. Tal's admin_begin_email_change started it.
-- Refused (ACCOUNT_CHANGE_BLOCKED): every other email change, including an
-- admin's own and a customer's auth.updateUser({ email }), and every phone
-- change. An admin's own email changes only in the SQL Editor, in one
-- transaction with:  set local app.allow_auth_identity_change = 'on';
-- (Auth itself never sets it.)
create function private.guard_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_target text;
begin
  if coalesce(current_setting('app.allow_auth_identity_change', true), '') = 'on' then
    return new;
  end if;

  if nullif(new.phone, '') is distinct from nullif(old.phone, '')
     or nullif(new.phone_change, '') is distinct from nullif(old.phone_change, '') then
    raise exception 'ACCOUNT_CHANGE_BLOCKED' using errcode = 'P0001';
  end if;

  if new.email is distinct from old.email
     or nullif(new.email_change, '') is distinct from nullif(old.email_change, '') then
    select p.account_op_state, p.account_op_target_hash
    into v_state, v_target
    from public.profiles p
    where p.id = new.id;

    if v_state is distinct from 'email_change_pending'
       or v_target is null
       or private.email_hash(new.email) is distinct from v_target
       or (nullif(new.email_change, '') is not null
           and private.email_hash(new.email_change) is distinct from v_target) then
      raise exception 'ACCOUNT_CHANGE_BLOCKED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_identity_change
  before update of email, email_change, phone, phone_change on auth.users
  for each row execute function private.guard_auth_user_change();

-- 6. Audit masking and "to handle" --------------------------------------

create or replace function private.audit_diff(p_old jsonb, p_new jsonb, p_table text)
 returns jsonb
 language sql
 immutable
 set search_path to ''
as $function$
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
        or (p_table = 'payments' and k = 'payer_label')
        or (p_table = 'customer_notes' and k = 'body')
        or (p_table = 'notes' and k = 'body')
        or k in ('phone_e164', 'dietary_notes', 'pending_email',
                 'email', 'token_hash', 'input_hash', 'account_op_target_hash')
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
$function$;

create or replace function public.admin_get_attention_items()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'event_status', ev.status,
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- A refund she asked for (3.7), open until Tal completes it (3.9).
    select
      r.requested_at,
      r.id,
      jsonb_build_object(
        'kind', 'refund_requested',
        'id', r.id,
        'customer_label', p.customer_label,
        'since', r.requested_at,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'amount_agorot', r.amount_agorot,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.refund_requests r
    join pay p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where r.status = 'requested'

    union all

    -- A business cancel she has not chosen for yet (3.8): refund or credit,
    -- no deadline; bound credits only.
    select
      cb.cancelled_at,
      c.id,
      jsonb_build_object(
        'kind', 'choice_pending',
        'id', c.id,
        'customer_label', coalesce(nullif(btrim(pr.full_name), ''), p.customer_label),
        'since', cb.cancelled_at,
        'customer_id', c.customer_id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'amount_agorot', c.monetary_basis_agorot
      )
    from public.cancellation_credits c
    join public.entitlements se on se.id = c.source_entitlement_id
    join pay p on p.id = se.payment_id
    left join public.profiles pr on pr.id = c.customer_id
    join public.bookings cb on cb.id = private.credit_cancelled_booking(c.id)
    join public.events ev on ev.id = cb.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where c.status = 'active'
      and c.choice_pending
      and c.customer_id is not null

    union all

    -- An email change stuck between its steps for more than 15 minutes
    -- (2.8, AD-21); saving the same address again on the card resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'email_change_stuck',
        'id', pr.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'email_change_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'
      and pr.anonymized_at is null

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null

    union all

    -- Push notifications that failed in the last 7 days (5.8): one item for
    -- all of them, since the latest failure.
    select
      f.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_failed',
        'id', 'push_failed',
        'customer_label', null,
        'since', f.since,
        'count', f.n
      )
    from (
      select max(j.finished_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'failed'
        and j.finished_at >= now() - interval '7 days'
    ) f
    where f.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$function$;

-- Grants (AD-5) -----------------------------------------------------------

revoke execute on function private.email_hash(text) from public, anon, authenticated, service_role;
revoke execute on function private.guard_auth_user_change() from public, anon, authenticated, service_role;
revoke execute on function private.audit_diff(jsonb, jsonb, text) from public, anon, authenticated, service_role;

revoke execute on function public.rate_limit_hit(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, text[]) to service_role;

revoke execute on function public.admin_issue_link(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_issue_link(text, uuid, uuid) to authenticated;

revoke execute on function public.admin_begin_email_change(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_email_change(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_finish_email_change(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_email_change(uuid, boolean, uuid) to authenticated;

revoke execute on function public.admin_change_phone(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_change_phone(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_get_customer_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer_account(uuid) to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
