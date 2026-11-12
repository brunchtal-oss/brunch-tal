-- Story 6.11: email verification and self-service password reset.
--
-- Every account is created with email_confirm true (AD-10), so Auth's
-- "confirmed" proves nothing. Our own record proves ownership: a row in
-- private.email_verifications whose email_hash equals
-- private.email_hash(<the current auth.users email>). Any email change
-- therefore un-verifies by itself, in every change path, with no hook.
-- Only set_email_verified (service role) writes it, called by the server
-- right after Auth's verifyOtp succeeded for the link in the email.
--
-- Also: the reset eligibility read (forgot password), the customer's own
-- email change (begin/finish, as Tal's admin_begin/finish_email_change,
-- user decision 2026-11-11), the "email" bucket of the rate limiter,
-- email_verified on Tal's customer card, and the record deleted when a
-- customer's details are removed.
--
-- Has a drop (the rate_limits bucket check), so it is run in the SQL
-- Editor, not through the MCP (AGENTS.md).

-- 1. The verification record ---------------------------------------------

-- No grants: read and written only by the definer functions below. A
-- private table, not a profiles column: an admin has no profile, profiles
-- is readable by the browser, and the hash binding un-verifies on change.
create table private.email_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null
);

alter table private.email_verifications enable row level security;
revoke all on table private.email_verifications from public, anon, authenticated, service_role;

-- True when the user's current Auth email is the one that was verified
-- (one normalization everywhere: private.email_hash, lower(btrim())).
-- Called only from definer functions.
create function private.email_verified(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from private.email_verifications v
    join auth.users u on u.id = v.user_id
    where v.user_id = p_user_id
      and v.email_hash = private.email_hash(u.email)
  );
$$;

-- 2. RPCs -----------------------------------------------------------------

-- Records that the user's current email is verified. Called by the server
-- only after verifyOtp (type email) succeeded in the same request, with the
-- user id that verifyOtp returned (never the browser's session user).
-- A set_* absolute value: exempt from idempotency (AD-5); not in the audit
-- log (nobody needs to review it later). is_admin tells the page where the
-- "continue" link goes.
create function public.set_email_verified(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select private.email_hash(u.email) into v_hash
  from auth.users u
  where u.id = p_user_id;

  if v_hash is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into private.email_verifications (user_id, email_hash, verified_at)
  values (p_user_id, v_hash, now())
  on conflict (user_id) do update
  set email_hash = excluded.email_hash,
      verified_at = excluded.verified_at;

  return jsonb_build_object(
    'verified', true,
    'is_admin', exists (
      select 1 from public.admin_roles r where r.user_id = p_user_id
    )
  );
end;
$$;

-- Whether a reset link may be sent to this address (forgot password) and
-- whose account it is. Eligible only for an activated, non-anonymized
-- customer or an admin, whose current email is verified. The server
-- answers the visitor the same way in every case; the result never leaves
-- the server.
create function public.get_email_reset_eligibility(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
  v_user uuid;
  v_eligible boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_email is null or char_length(v_email) > 254 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email
  order by u.id
  limit 1;

  if v_user is not null then
    v_eligible := private.email_verified(v_user) and (
      exists (select 1 from public.admin_roles r where r.user_id = v_user)
      or exists (
        select 1 from public.profiles p
        where p.id = v_user
          and p.activated_at is not null
          and p.anonymized_at is null
      )
    );
  end if;

  return jsonb_build_object('user_id', v_user, 'eligible', v_eligible);
end;
$$;

-- The signed-in user's own state (customer or admin), for the banner and
-- the profile label. A read: exempt from idempotency.
create function public.get_my_email_verified()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return jsonb_build_object('verified', private.email_verified(v_user));
end;
$$;

-- The customer changes her own email (user decision 2026-11-11), step 1 of
-- the same three steps as Tal's change (AD-21): the duplicate check
-- (find_identity), then email_change_pending with the address's hash. The
-- server checked her current password before this call. Mirrors
-- admin_begin_email_change for private.current_customer_id().
create function public.begin_my_email_change(p_email text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_customer uuid := private.current_customer_id();
  v_email text := lower(btrim(p_email));
  v_hash text := private.email_hash(p_email);
  v_prev jsonb;
  v_old public.profiles;
  v_current text;
  v_match jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- The request is hashed; the address itself never reaches the row.
  v_prev := private.idempotent_begin(
    v_actor::text, 'begin_my_email_change', p_idempotency_key,
    jsonb_build_object('email_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_email is null
     or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "email"}';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = v_customer
  for update;

  if v_old.id is null
     or v_old.anonymized_at is not null
     or v_old.activated_at is null
     or v_old.account_op_state = 'anonymization_pending' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- The same change again (a crash between the steps): resume from Auth.
  if v_old.account_op_state = 'email_change_pending'
     and v_old.account_op_target_hash = v_hash then
    return private.idempotent_finish(
      v_actor::text, 'begin_my_email_change', p_idempotency_key,
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
    -- Blocked: nothing changes; the answer carries no address.
    return private.idempotent_finish(
      v_actor::text, 'begin_my_email_change', p_idempotency_key,
      jsonb_build_object('result', 'taken')
    );
  end if;

  update public.profiles
  set account_op_state = 'email_change_pending',
      account_op_started_at = now(),
      account_op_target_hash = v_hash
  where id = v_old.id;

  return private.idempotent_finish(
    v_actor::text, 'begin_my_email_change', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', v_old.id)
  );
end;
$$;

-- Step 3 of her own email change: clears the state and logs the change
-- (the address masked by audit_diff). Safe to repeat: without a pending
-- change it answers not_pending. Mirrors admin_finish_email_change.
create function public.finish_my_email_change(p_succeeded boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_customer uuid := private.current_customer_id();
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_current text;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'finish_my_email_change', p_idempotency_key,
    jsonb_build_object('succeeded', p_succeeded)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_succeeded is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = v_customer
  for update;

  if v_old.id is null
     or v_old.account_op_state is distinct from 'email_change_pending' then
    return private.idempotent_finish(
      v_actor::text, 'finish_my_email_change', p_idempotency_key,
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
    perform private.audit(
      v_actor, 'customer', 'finish_my_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old) || jsonb_build_object('email', 'previous'),
      to_jsonb(v_new) || jsonb_build_object('email', 'current')
    );
  else
    perform private.audit(
      v_actor, 'customer', 'finish_my_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old),
      to_jsonb(v_new) || jsonb_build_object('result', 'taken')
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'finish_my_email_change', p_idempotency_key,
    jsonb_build_object('result', case when p_succeeded then 'changed' else 'taken' end)
  );
end;
$$;

-- 3. The "email" bucket of the rate limiter --------------------------------

-- Sending an email (forgot password, resend, self email change): 5 per IP
-- and 3 per id (the normalized email, or the user id) in 15 minutes.
alter table private.rate_limits
  drop constraint rate_limits_bucket_check,
  add constraint rate_limits_bucket_check check (bucket in ('login', 'token', 'email'));

create or replace function public.rate_limit_hit(p_bucket text, p_keys text[])
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

  if p_bucket is null or p_bucket not in ('login', 'token', 'email')
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
      when p_bucket = 'email' and v_key like 'ip:%' then 5
      when p_bucket = 'email' then 3
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

-- 4. Tal's card and the removal of details ---------------------------------

-- From the live definitions (pg_get_functiondef in dev, 2026-11-11):
-- admin_get_customer adds profile.email_verified; admin_anonymize_customer
-- deletes the verification record.

CREATE OR REPLACE FUNCTION public.admin_get_customer(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_threshold integer;
  v_today date;
  v_email text;
  v_babies jsonb;
  v_entitlements jsonb;
  v_bookings jsonb;
  v_payments jsonb;
  v_notes jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Story 4.6: a removed customer is a tombstone only (her id, when, and
  -- whether the Auth step is still pending); nothing else is read.
  if v_profile.anonymized_at is not null then
    return jsonb_build_object(
      'profile', jsonb_build_object(
        'id', v_profile.id,
        'anonymized_at', v_profile.anonymized_at,
        'removal_pending',
          coalesce(v_profile.account_op_state = 'anonymization_pending', false)
      )
    );
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile.id;
  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', b.name, 'birth_date', b.birth_date)
      order by b.birth_date, b.id
    ),
    '[]'::jsonb
  )
  into v_babies
  from public.babies b
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_name,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'pinned_event_id', x.pinned_event_id,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_entitlements
  from (
    select
      b.entitlement_id,
      b.kind,
      b.status,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.is_expired,
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      p.product_snapshot ->> 'name' as product_name,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_profile.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', b.event_id,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'status', b.status,
        'party_size', b.party_size,
        'created_at', b.created_at,
        'credit_id', cr.credit_id,
        -- Story 5.20: the session a moved booking went to (as get_my_bookings).
        'moved_to_starts_at', me.starts_at
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  left join lateral (
    select x.credit_id
    from (
      select cc.id as credit_id, 0 as priority
      from public.cancellation_credits cc
      where cc.origin_booking_id = b.id
      union all
      select a.credit_id, 1 as priority
      from public.booking_allocations a
      where a.booking_id = b.id
        and a.credit_id is not null
    ) x
    order by x.priority, x.credit_id
    limit 1
  ) cr on true
  left join public.bookings mb on mb.id = b.moved_to_booking_id
  left join public.events me on me.id = mb.event_id
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'product_name', p.product_snapshot ->> 'name',
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'payment_method_name', p.product_snapshot ->> 'payment_method_name',
        'status', p.status
      )
      order by p.paid_on desc, p.created_at desc, p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.customer_notes n
  where n.customer_id = v_profile.id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_email,
      'activated_at', v_profile.activated_at,
      'created_at', v_profile.created_at,
      'dietary_notes', v_profile.dietary_notes,
      'special_brunch_interests', to_jsonb(v_profile.special_brunch_interests),
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id),
      -- Story 6.11: our own record matches her current email.
      'email_verified', private.email_verified(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_anonymize_customer(p_customer_id uuid, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_prev jsonb;
  v_profile public.profiles;
  v_plan jsonb;
  v_blockers jsonb;
  v_token_ids uuid[];
  v_payment_ids uuid[];
  v_old_token public.activation_tokens;
  v_new_token public.activation_tokens;
  -- Story 5.20: the Auth users of her claiming links, deleted by the
  -- caller after this call (they never have a profile).
  v_orphans uuid[] := '{}'::uuid[];
  v_prefix text := '/admin/customers/' || coalesce(p_customer_id::text, '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_confirmed is distinct from true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Locks (AD-6): her tokens, her babies (private.babies_guard locks a baby
  -- before its profile), her profile (the mutex), bookings, payments,
  -- waitlist entries, notification jobs.
  perform 1
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id
  order by t.id
  for update;

  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  into v_token_ids
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id;

  perform 1
  from public.babies b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_profile.id is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- A retry: cleaned already; never cleaned again.
  if v_profile.anonymized_at is not null then
    return private.idempotent_finish(
      v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
      jsonb_build_object(
        'result', case
          when v_profile.account_op_state = 'anonymization_pending' then 'pending'
          else 'done'
        end,
        'user_id', v_profile.id
      )
    );
  end if;

  -- Story 5.20: not while her email change is between its steps (AD-21).
  if v_profile.account_op_state = 'email_change_pending' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.bookings b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  -- The blockers again, under the locks (the preview may be stale).
  v_plan := private.plan_admin_anonymize_customer(p_customer_id);
  v_blockers := v_plan -> 'blockers';
  if jsonb_array_length(v_blockers -> 'bookings') > 0
     or jsonb_array_length(v_blockers -> 'refund_requests') > 0
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0
     or jsonb_array_length(v_blockers -> 'parked_purchases') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices'),
        'parked_purchases', jsonb_array_length(v_blockers -> 'parked_purchases')
      )::text;
  end if;

  -- Her payments, and the unbound ones behind her join links (a purchase
  -- waiting for her sign-in), by id.
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_payment_ids
  from public.payments p
  where p.customer_id = p_customer_id
     or p.id in (
       select t.payment_id
       from public.activation_tokens t
       where t.id = any (v_token_ids)
         and t.purpose = 'join'
         and t.payment_id is not null
     );

  perform 1
  from public.payments p
  where p.id = any (v_payment_ids)
  order by p.id
  for update;

  perform 1
  from public.waitlist_entries w
  where w.customer_id = p_customer_id
  order by w.id
  for update;

  perform 1
  from public.notification_jobs j
  join public.notifications n on n.id = j.notification_id
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix)
  order by j.id
  for update of j;

  -- Her links: a live link is revoked, except a join waiting for her
  -- sign-in, which can never bind now (a conflict in "to handle"); each
  -- one logged as admin_issue_link logs a revoke. Then no input hash stays.
  for v_old_token in
    select t.*
    from public.activation_tokens t
    where t.id = any (v_token_ids)
      and t.state in ('pending', 'awaiting_login', 'claiming')
    order by t.id
  loop
    update public.activation_tokens t
    set input_hash = null,
        state = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'conflict'
          else 'revoked'
        end,
        conflict_reason = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'bind_conflict'
          else t.conflict_reason
        end,
        revoked_at = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then t.revoked_at
          else v_now
        end
    where t.id = v_old_token.id
    returning * into v_new_token;

    if v_old_token.state = 'claiming'
       and v_old_token.pending_user_id is not null
       and v_old_token.pending_user_id <> p_customer_id then
      v_orphans := v_orphans || v_old_token.pending_user_id;
    end if;

    perform private.audit(
      v_actor, 'admin', 'revoke_link', 'activation_tokens', v_old_token.id,
      p_customer_id, null, to_jsonb(v_old_token), to_jsonb(v_new_token)
    );
  end loop;

  update public.activation_tokens t
  set input_hash = null
  where t.id = any (v_token_ids)
    and t.input_hash is not null;

  -- The profile: full_name is NOT NULL, so it becomes the removed wording;
  -- the privacy consent (when and which version) stays.
  update public.profiles
  set full_name = 'לקוחה שפרטיה הוסרו',
      phone_e164 = null,
      pending_email = null,
      dietary_notes = null,
      special_brunch_interests = '{}',
      photo_consent = false,
      photo_consent_at = null,
      photo_consent_text_version = null,
      personal_photo_consent = false,
      personal_photo_consent_at = null,
      personal_photo_consent_text_version = null,
      anonymized_at = v_now,
      account_op_state = 'anonymization_pending',
      account_op_started_at = v_now,
      account_op_target_hash = null
  where id = p_customer_id;

  -- Admin deletes skip babies_guard's profile lock and LAST_BABY (the
  -- caller is not the customer).
  delete from public.babies where customer_id = p_customer_id;
  delete from public.customer_notes where customer_id = p_customer_id;
  -- Story 6.11: her email verification record.
  delete from private.email_verifications where user_id = p_customer_id;
  delete from public.waitlist_entries where customer_id = p_customer_id;
  -- notification_deliveries go with them (on delete cascade).
  delete from public.push_subscriptions where user_id = p_customer_id;
  -- Their notification_jobs (and deliveries) go with them.
  delete from public.notifications n
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix);

  update public.payments
  set payer_label = null,
      note = null
  where id = any (v_payment_ids)
    and (payer_label is not null or note is not null);

  update public.bookings
  set guest_details = null
  where customer_id = p_customer_id
    and guest_details is not null;

  -- Stored results: hers, her links', and Tal's that name her. This call's
  -- own row has no result yet, so it stays.
  delete from private.idempotency_results r
  where r.actor_scope = p_customer_id::text
     or r.actor_scope = any (
       select 'token:' || x::text from unnest(v_token_ids) as x
     )
     or (
       r.actor_scope in (select a.user_id::text from public.admin_roles a)
       and r.result::text like '%' || p_customer_id::text || '%'
     );

  -- Her audit rows, and those of the payments above (written while
  -- customer_id was null too): note is the one free-text key audit_diff
  -- does not mask.
  update public.audit_log a
  set before = case
        when a.before ? 'note' then jsonb_set(a.before, '{note}', '"<removed>"'::jsonb)
        else a.before
      end,
      after = case
        when a.after ? 'note' then jsonb_set(a.after, '{note}', '"<removed>"'::jsonb)
        else a.after
      end
  where (
      a.customer_id = p_customer_id
      or (a.entity_type = 'payments' and a.entity_id = any (v_payment_ids))
    )
    and (a.before ? 'note' or a.after ? 'note');

  perform private.audit(
    v_actor, 'admin', 'admin_anonymize_customer', 'profiles', p_customer_id,
    p_customer_id, null,
    jsonb_build_object('anonymized_at', null),
    jsonb_build_object('anonymized_at', v_now)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object(
      'result', 'pending',
      'user_id', p_customer_id,
      'orphan_user_ids', to_jsonb(v_orphans)
    )
  );
end;
$function$;

-- 5. Grants (AD-5) -----------------------------------------------------------

revoke execute on function private.email_verified(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.set_email_verified(uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_email_verified(uuid) to service_role;

revoke execute on function public.get_email_reset_eligibility(text) from public, anon, authenticated, service_role;
grant execute on function public.get_email_reset_eligibility(text) to service_role;

revoke execute on function public.get_my_email_verified() from public, anon, authenticated, service_role;
grant execute on function public.get_my_email_verified() to authenticated;

revoke execute on function public.begin_my_email_change(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_my_email_change(text, uuid) to authenticated;

revoke execute on function public.finish_my_email_change(boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_my_email_change(boolean, uuid) to authenticated;

revoke execute on function public.rate_limit_hit(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, text[]) to service_role;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;

revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;
