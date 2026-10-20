-- Story 4.6: remove a customer's personal details on her request (CAP-30,
-- AD-3, AD-6, AD-7, AD-19, AD-21). A sensitive, two-step operation:
--   1. admin_anonymize_customer cleans every identifying value in one
--      transaction and sets anonymized_at and
--      account_op_state = 'anonymization_pending';
--   2. the server deletes the Auth user (lib/server/privileged/anonymize.ts);
--   3. admin_finish_anonymize_customer closes the state.
-- Payments and bookings stay, nameless; amounts and states never change.
--
-- 1. private.plan_admin_anonymize_customer, preview_admin_anonymize_customer,
--    admin_anonymize_customer, admin_finish_anonymize_customer.
-- 2. Redefined (from pg_get_functiondef of the live DB, 2026-10-20, after
--    5.13 and 5.10): admin_get_customer (a tombstone for a removed
--    customer), admin_issue_link (reset refuses anonymization_pending),
--    private.job_reminders and private.job_expiry_alerts (skip a removed
--    customer), private.similar_payments_for (her name is the removed
--    wording), admin_get_attention_items (anonymization_stuck; the 15 other
--    branches as they were).

-- ---------------------------------------------------------------------------
-- 1. The plan (AD-7): what blocks the removal and what she loses
-- ---------------------------------------------------------------------------

-- Blockers (memlog 2026-09-29, user decision 2026-10-20): a confirmed
-- booking in a session that has not started; a refund request still
-- requested; a credit waiting for her refund-or-credit choice. Tal handles
-- them first. Forfeits (shown, never blocking): free entries of her active
-- cards and her active credits stay as they are, unused.
create function private.plan_admin_anonymize_customer(p_customer_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'blockers', jsonb_build_object(
      'bookings', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'booking_id', b.id,
              'event_id', e.id,
              'starts_at', e.starts_at,
              'concept', c.name
            )
            order by e.starts_at, b.id
          ),
          '[]'::jsonb
        )
        from public.bookings b
        join public.events e on e.id = b.event_id
        join public.concepts c on c.id = e.concept_id
        where b.customer_id = p_customer_id
          and b.status = 'confirmed'
          and e.starts_at > now()
      ),
      'refund_requests', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('id', r.id, 'amount_agorot', r.amount_agorot)
            order by r.requested_at, r.id
          ),
          '[]'::jsonb
        )
        from public.refund_requests r
        where r.customer_id = p_customer_id
          and r.status = 'requested'
      ),
      'pending_choices', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('credit_id', cc.id)
            order by cc.created_at, cc.id
          ),
          '[]'::jsonb
        )
        from public.cancellation_credits cc
        where cc.customer_id = p_customer_id
          and cc.status = 'active'
          and cc.choice_pending
      )
    ),
    'forfeits', jsonb_build_object(
      'entries_left', (
        select coalesce(sum(eb.available), 0)::integer
        from public.entitlement_balances eb
        where eb.customer_id = p_customer_id
          and eb.status = 'active'
          and not eb.is_expired
          and eb.available > 0
      ),
      'active_credits', (
        select count(*)::integer
        from public.cancellation_credits cc
        where cc.customer_id = p_customer_id
          and cc.status = 'active'
          and not cc.choice_pending
      )
    )
  );
$$;

-- What the card shows before the dialog: the plan of an available customer.
-- CUSTOMER_NOT_AVAILABLE for an admin, a removed or a missing profile.
create function public.preview_admin_anonymize_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if not exists (
       select 1 from public.profiles p
       where p.id = p_customer_id
         and p.anonymized_at is null
     )
     or exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  return private.plan_admin_anonymize_customer(p_customer_id);
end;
$$;

-- Step 1 (AD-21). Results:
--   pending: cleaned now, or already cleaned and waiting for the Auth step
--            (a retry resumes without cleaning again); user_id = her id;
--   done:    removed and closed already.
-- Raises CONFIRM_REQUIRED, CUSTOMER_NOT_AVAILABLE (admin or missing),
-- ANONYMIZE_BLOCKED (detail: the blockers' counts), INVALID_INPUT.
create function public.admin_anonymize_customer(
  p_customer_id uuid,
  p_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_prev jsonb;
  v_profile public.profiles;
  v_plan jsonb;
  v_blockers jsonb;
  v_token_ids uuid[];
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
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices')
      )::text;
  end if;

  perform 1
  from public.payments p
  where p.customer_id = p_customer_id
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

  -- Her links: no input hash; a live link is revoked, except a join waiting
  -- for her sign-in, which can never bind now (a conflict in "to handle").
  update public.activation_tokens t
  set input_hash = null,
      state = case
        when t.purpose = 'join' and t.state = 'awaiting_login' then 'conflict'
        when t.state in ('pending', 'awaiting_login', 'claiming') then 'revoked'
        else t.state
      end,
      conflict_reason = case
        when t.purpose = 'join' and t.state = 'awaiting_login' then 'bind_conflict'
        else t.conflict_reason
      end,
      revoked_at = case
        when t.purpose = 'join' and t.state = 'awaiting_login' then t.revoked_at
        when t.state in ('pending', 'awaiting_login', 'claiming') then v_now
        else t.revoked_at
      end
  where t.id = any (v_token_ids);

  -- The profile: full_name is NOT NULL, so it becomes the removed wording;
  -- the privacy consent (when and which version) stays.
  update public.profiles
  set full_name = 'לקוחה שפרטיה הוסרו',
      phone_e164 = null,
      pending_email = null,
      dietary_notes = null,
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
  where customer_id = p_customer_id
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

  -- Her audit rows: note is the one free-text key audit_diff does not mask.
  update public.audit_log a
  set before = case
        when a.before ? 'note' then jsonb_set(a.before, '{note}', '"<removed>"'::jsonb)
        else a.before
      end,
      after = case
        when a.after ? 'note' then jsonb_set(a.after, '{note}', '"<removed>"'::jsonb)
        else a.after
      end
  where a.customer_id = p_customer_id
    and (a.before ? 'note' or a.after ? 'note');

  perform private.audit(
    v_actor, 'admin', 'admin_anonymize_customer', 'profiles', p_customer_id,
    p_customer_id, null,
    jsonb_build_object('anonymized_at', null),
    jsonb_build_object('anonymized_at', v_now)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', p_customer_id)
  );
end;
$$;

-- Step 3 (AD-21): after the Auth user was deleted. Results: done; or
-- not_pending (closed already, or never started). Raises CONCURRENT_CHANGE
-- while the Auth user still exists (the state stays; "to handle" after 15
-- minutes).
create function public.admin_finish_anonymize_customer(
  p_customer_id uuid,
  p_idempotency_key uuid
)
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
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.account_op_state is distinct from 'anonymization_pending' then
    return private.idempotent_finish(
      v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
      jsonb_build_object('result', 'not_pending')
    );
  end if;

  if exists (select 1 from auth.users u where u.id = v_old.id) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  update public.profiles
  set account_op_state = null,
      account_op_started_at = null
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_finish_anonymize_customer', 'profiles', v_old.id,
    v_old.id, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
    jsonb_build_object('result', 'done')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Redefinitions
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        'credit_id', cr.credit_id
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
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$$;

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
       or exists (select 1 from public.admin_roles r where r.user_id = p_target_id)
       -- Story 4.6: never during a removal (its step 1 sets anonymized_at
       -- too, so this only guards the state itself).
       or exists (
         select 1 from public.profiles p
         where p.id = p_target_id
           and p.account_op_state = 'anonymization_pending'
       ) then
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

create or replace function private.job_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select
      b.id as booking_id,
      b.customer_id,
      e.id as event_id,
      e.revision,
      e.starts_at,
      c.name as concept
    from public.bookings b
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    join public.profiles pr on pr.id = b.customer_id
    where b.status = 'confirmed'
      and b.customer_id is not null
      and pr.anonymized_at is null
      and e.status = 'published'
      and now() < e.starts_at
      and now() >= e.starts_at
        - make_interval(hours => (b.policy_snapshot ->> 'reminder_lead_hours')::integer)
      and b.confirmed_at < e.starts_at
        - make_interval(hours => (b.policy_snapshot ->> 'reminder_lead_hours')::integer)
    order by b.id
    for update of b skip locked
  loop
    if private.enqueue_notification(
      v_row.customer_id,
      'reminder',
      v_row.booking_id::text || ':' || v_row.revision::text,
      jsonb_build_object(
        'date', private.format_day_month((v_row.starts_at at time zone 'Asia/Jerusalem')::date),
        'time', to_char(v_row.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
        'concept', v_row.concept
      ),
      '/me/sessions/' || v_row.event_id::text
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function private.job_expiry_alerts()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_card record;
  v_credit record;
  v_last record;
  v_active integer;
  v_set integer;
  v_count integer := 0;
begin
  select s.* into v_settings
  from public.business_settings s;

  for v_card in
    select
      e.id,
      e.customer_id,
      e.expires_on,
      e.expires_on - v_today as days_left,
      b.available,
      coalesce(pr.full_name, '') as full_name
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    join public.profiles pr on pr.id = e.customer_id
    where e.status = 'active'
      and e.pinned_event_id is null
      and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      and e.customer_id is not null
      and pr.anonymized_at is null
      and b.available > 0
      and e.expires_on - v_today >= 0
      and e.expires_on - v_today <= greatest(
        v_settings.admin_expiring_days, v_settings.customer_expiring_days
      )
    order by e.id
  loop
    begin
      if v_card.days_left <= v_settings.admin_expiring_days then
        v_count := v_count + private.enqueue_admin_notification(
          'admin_card_expiring',
          v_card.id::text || ':' || to_char(v_card.expires_on, 'YYYY-MM-DD'),
          jsonb_build_object(
            'customer', v_card.full_name,
            'units', v_card.available,
            'expires_on', private.format_day_month(v_card.expires_on)
          ),
          '/admin/customers/' || v_card.customer_id::text
        );
      end if;

      if v_card.days_left <= v_settings.customer_expiring_days then
        if private.enqueue_notification(
          v_card.customer_id,
          'card_expiring',
          v_card.id::text || ':' || to_char(v_card.expires_on, 'YYYY-MM-DD'),
          jsonb_build_object(
            'units', v_card.available,
            'expires_on', private.format_day_month(v_card.expires_on)
          ),
          '/me/sessions'
        ) is not null then
          v_count := v_count + 1;
        end if;
      end if;
    exception when others then
      raise warning 'job_expiry_alerts: entitlement % failed: % %',
        v_card.id, sqlstate, sqlerrm;
    end;
  end loop;

  for v_credit in
    select c.id, c.customer_id, c.options_count, c.party_size
    from public.cancellation_credits c
    where c.status = 'active'
      and not c.choice_pending
      and c.customer_id is not null
      and exists (
        select 1 from public.profiles pr
        where pr.id = c.customer_id and pr.anonymized_at is null
      )
    order by c.id
  loop
    begin
      if private.credit_in_use(v_credit.id) then
        continue;
      end if;

      select
        count(*) filter (where o.state = 'active')::integer,
        count(*) filter (where o.state in ('active', 'passed'))::integer
      into v_active, v_set
      from public.credit_options o
      where o.credit_id = v_credit.id;

      if v_active = 0 or v_set <> v_credit.options_count then
        continue;
      end if;

      select o.event_id, e.starts_at, e.registration_closes_at, e.status,
        e.capacity_adults
      into v_last
      from public.credit_options o
      join public.events e on e.id = o.event_id
      where o.credit_id = v_credit.id
        and o.state = 'active'
      order by e.registration_closes_at desc, e.id desc
      limit 1;

      -- Its session is no longer bookable (cancelled, unpublished or full)
      -- but the refresh has not replaced it yet: no alert this run (the
      -- same room test as private.refresh_credit_options).
      if v_last.status <> 'published'
         or private.occupied_places(v_last.event_id) + v_credit.party_size
            > v_last.capacity_adults then
        continue;
      end if;

      if now() >= v_last.registration_closes_at
           - make_interval(days => v_settings.credit_expiring_days)
         and now() < v_last.registration_closes_at then
        if private.enqueue_notification(
          v_credit.customer_id,
          'credit_expiring',
          v_credit.id::text || ':' || v_last.event_id::text,
          jsonb_build_object(
            'date', private.format_day_month(
              (v_last.starts_at at time zone 'Asia/Jerusalem')::date
            ),
            'closes_on', private.format_day_month(
              (v_last.registration_closes_at at time zone 'Asia/Jerusalem')::date
            )
          ),
          '/me/bookings'
        ) is not null then
          v_count := v_count + 1;
        end if;
      end if;
    exception when others then
      raise warning 'job_expiry_alerts: credit % failed: % %',
        v_credit.id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

create or replace function private.similar_payments_for(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_amount_agorot integer,
  p_payment_method_id uuid,
  p_paid_on date,
  p_event_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        -- Story 4.6 (2.5 deferred): a removed customer reads as the source's
        -- wording, never as an empty name ("new customer").
        'customer_name', case
          when pr.id is null then null
          when pr.anonymized_at is null then pr.full_name
          else 'לקוחה שפרטיה הוסרו'
        end,
        'payer_label', pay.payer_label,
        'paid_on', pay.paid_on,
        'created_at', pay.created_at
      )
      order by pay.paid_on desc, pay.created_at desc, pay.id desc
    ),
    '[]'::jsonb
  )
  from public.payments pay
  cross join public.business_settings s
  left join public.profiles pr on pr.id = pay.customer_id
  left join public.entitlements ent on ent.payment_id = pay.id
  where pay.status = 'approved'
    and pay.product_id = p_product_id
    and pay.amount_agorot = p_amount_agorot
    and pay.payment_method_id = p_payment_method_id
    and abs(pay.paid_on - p_paid_on) <= s.duplicate_payment_window_days
    and case
      -- A new customer: the other payment's name is the typed one.
      when p_customer_id is null then
        nullif(lower(btrim(p_payer_label)), '') = coalesce(
          nullif(lower(btrim(pay.payer_label)), ''),
          case when pr.anonymized_at is null then nullif(lower(btrim(pr.full_name)), '') end
        )
      -- An existing customer: her own payment, or an unbound one named as
      -- she is.
      else
        pay.customer_id = p_customer_id
        or (
          pay.customer_id is null
          and nullif(lower(btrim(pay.payer_label)), '') = (
            select nullif(lower(btrim(me.full_name)), '')
            from public.profiles me
            where me.id = p_customer_id
          )
        )
    end
    -- Two different sessions are two purchases.
    and not (
      p_event_id is not null
      and ent.pinned_event_id is not null
      and ent.pinned_event_id <> p_event_id
    );
$$;

-- As in 20261019233918 (5.10), plus anonymization_stuck (4.6).
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
  -- Every scheduled job (private.job_intervals) with its cron.job row, if
  -- any (an active one first).
  jobs as (
    select ji.jobname, ji.every, j.jobid, coalesce(j.active, false) as active
    from private.job_intervals() ji
    left join lateral (
      select cj.jobid, cj.active
      from cron.job cj
      where cj.jobname = ji.jobname
      order by cj.active desc, cj.jobid desc
      limit 1
    ) j on true
  ),
  -- Per job, by index lookups only (no aggregate over the whole of
  -- cron.job_run_details): its latest run, its latest succeeded run, and
  -- whether any run started more than 3 x its frequency ago.
  -- missing: not in cron.job, or not active. failed: its latest run failed.
  -- late: no succeeded run ended within 3 x its frequency, and either a
  -- succeeded run exists or a run started before that window (a first run
  -- still running is not late). A job with no runs at all is not flagged.
  job_states as (
    select
      jb.jobname,
      case
        when jb.jobid is null or not jb.active then 'missing'
        when lr.status = 'failed' then 'failed'
        when (ok.end_time is null or ok.end_time < now() - jb.every * 3)
          and (
            ok.runid is not null
            or exists (
              select 1
              from cron.job_run_details od
              where od.jobid = jb.jobid
                and od.start_time < now() - jb.every * 3
            )
          ) then 'late'
      end as reason,
      case
        when jb.jobid is null or not jb.active then now()
        when lr.status = 'failed'
          then coalesce(lr.end_time, lr.start_time, now())
        else coalesce(ok.end_time, lr.start_time, now())
      end as since
    from jobs jb
    left join lateral (
      select d.runid, d.status, d.start_time, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
      order by d.runid desc
      limit 1
    ) lr on true
    left join lateral (
      select d.runid, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
        and d.status = 'succeeded'
      order by d.runid desc
      limit 1
    ) ok on true
    where jb.jobid is null
       or not jb.active
       or lr.runid is not null
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

    -- A booking that no longer fits its card after a correction (3.13): the
    -- latest unhandled warning per booking, while the booking is confirmed,
    -- its session has not started and the card still does not fit it.
    select
      w.since,
      w.booking_id,
      jsonb_build_object(
        'kind', 'correction_affected',
        'id', w.booking_id,
        'customer_id', coalesce(b.customer_id, p.customer_id),
        'customer_label', p.customer_label,
        'since', w.since,
        'entitlement_id', e.id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'field', w.field
      )
    from (
      select distinct on (cb.booking_id)
        cb.booking_id, co.entitlement_id, co.field, co.created_at as since
      from public.entitlement_correction_bookings cb
      join public.entitlement_corrections co on co.id = cb.correction_id
      where cb.handled_at is null
      order by cb.booking_id, co.created_at desc, co.id desc
    ) w
    join public.bookings b on b.id = w.booking_id
    join public.entitlements e on e.id = w.entitlement_id
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where b.status = 'confirmed'
      and ev.starts_at > now()
      and not private.entitlement_fits_event(e, ev)

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

    -- A removal of personal details stuck between its steps for more than
    -- 15 minutes (4.6, AD-21): no anonymized_at filter (step 1 set it); the
    -- card's "complete the removal" resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'anonymization_stuck',
        'id', pr.id,
        'customer_label', null,
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'anonymization_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'

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

    union all

    -- A scheduled job that failed, is late or is missing (5.10, AD-22): one
    -- item per job; the item's id is the jobname.
    select
      s.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'job_failed',
        'id', s.jobname,
        'customer_label', null,
        'since', s.since,
        'job', s.jobname,
        'reason', s.reason
      )
    from job_states s
    where s.reason is not null

    union all

    -- app_url or cron_secret absent or empty in Vault (5.10, AD-22): push
    -- never leaves. Only the item, never a value.
    select
      now(),
      null::uuid,
      jsonb_build_object(
        'kind', 'vault_missing',
        'id', 'vault_missing',
        'customer_label', null,
        'since', now()
      )
    where not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'app_url'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )
      or not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'cron_secret'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )

    union all

    -- Push jobs still queued 15 minutes after they were due (5.10): the
    -- worker is not reached (a wrong secret or URL). One item for all.
    select
      q.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_stuck',
        'id', 'push_stuck',
        'customer_label', null,
        'since', q.since,
        'count', q.n
      )
    from (
      select min(j.next_attempt_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'queued'
        and j.next_attempt_at < now() - interval '15 minutes'
    ) q
    where q.n > 0
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


-- ---------------------------------------------------------------------------
-- 3. Grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.plan_admin_anonymize_customer(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.job_reminders() from public, anon, authenticated, service_role;
revoke execute on function private.job_expiry_alerts() from public, anon, authenticated, service_role;
revoke execute on function private.similar_payments_for(uuid, text, uuid, integer, uuid, date, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_anonymize_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_anonymize_customer(uuid) to authenticated;

revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;

revoke execute on function public.admin_finish_anonymize_customer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_anonymize_customer(uuid, uuid) to authenticated;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;

revoke execute on function public.admin_issue_link(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_issue_link(text, uuid, uuid) to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
