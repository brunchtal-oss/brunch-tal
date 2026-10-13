-- Story 3.5, round 2 (user decision 2026-10-13, phone check; overrides the
-- 2.5 / 3.11 decision for pinned products): a pinned product (single,
-- intro, couple) approved for an existing customer sends only the booking
-- notification (booking_confirmed / booking_confirmed_couple, from
-- private.notify_booking_confirmed inside the core), no purchase_repeat.
-- A card (and any product without a pinned session) keeps purchase_repeat
-- as before. A new customer's approval is unchanged (nothing is sent until
-- the bind, which sends only the booking notification for a pinned seat).
--
-- public.admin_approve_payment: re-based on pg_get_functiondef of the live
-- DB on 2026-10-13 (md5 of prosrc equal to 20261005160954). Same signature,
-- no drop; grants re-stated (AD-5). The user runs this file in the SQL
-- Editor; the main session registers it in schema_migrations.
--
-- public.claim_push_jobs (at the end): + notification_id per job, for the
-- push click that marks the notification read (round 2).

-- As in 20261005160954, plus: purchase_repeat only for an entitlement
-- without a pinned session.
create or replace function public.admin_approve_payment(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
  p_confirmed boolean,
  p_duplicate_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_label text := nullif(btrim(p_payer_label), '');
  v_payment public.payments;
  v_payment_new public.payments;
  v_profile_id uuid;
  v_plan jsonb;
  v_payment_id uuid;
  v_entitlement public.entitlements;
  v_booking_id uuid;
  v_pinned jsonb := '{}'::jsonb;
  v_card_tip text := '';
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'payer_label', v_label,
      'product_id', p_product_id,
      'event_id', p_event_id,
      'amount_agorot', p_amount_agorot,
      'amount_override_reason', p_amount_override_reason,
      'paid_on', p_paid_on,
      'payment_method_id', p_payment_method_id,
      'reference', p_reference,
      'note', p_note,
      'confirmed', p_confirmed,
      'duplicate_confirmed', p_duplicate_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- The label only names a new customer, up to 40 characters.
  if v_label is not null
     and (p_customer_id is not null or char_length(v_label) > 40) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- A new customer's payer name is required (user decision 2026-10-05).
  if p_customer_id is null and v_label is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "payer_label"}';
  end if;

  -- Serializes approvals that may duplicate each other (released at commit).
  perform pg_advisory_xact_lock(hashtext(
    'payments:similar:' || coalesce(p_product_id::text, '') || ':'
    || coalesce(p_amount_agorot::text, '') || ':'
    || coalesce(p_payment_method_id::text, '')
  ));

  -- Lock order (AD-6): profiles before the session, the product and the
  -- payment.
  if p_customer_id is not null then
    select p.id into v_profile_id
    from public.profiles p
    where p.id = p_customer_id
      and p.anonymized_at is null
    for update;

    if v_profile_id is null then
      raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  if p_event_id is not null then
    perform 1
    from public.events e
    where e.id = p_event_id
    for update;
  end if;

  -- The price cannot change between this plan and the core's plan.
  perform 1
  from public.products p
  where p.id = p_product_id
  for share;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if (v_plan ->> 'price_changed')::boolean and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if p_duplicate_confirmed is not true
     and jsonb_array_length(private.similar_payments_for(
       p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on,
       p_event_id
     )) > 0 then
    raise exception 'DUPLICATE_CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_payment_id := private.approve_payment_core(
    'manual', v_actor, 'admin', p_customer_id, p_product_id, p_event_id,
    p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id,
    p_reference, p_note, null, null, 'raise'
  );

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

  select b.id into v_booking_id
  from public.bookings b
  where b.payment_id = v_payment_id
    and b.status = 'confirmed';

  if v_entitlement.pinned_event_id is not null then
    v_pinned := jsonb_build_object(
      'event_id', v_entitlement.pinned_event_id,
      'booking_id', v_booking_id
    );
  end if;

  if p_customer_id is not null then
    -- The tip only for a card that can still be booked (not expired at
    -- approval, e.g. a back-dated purchase).
    if v_entitlement.kind = 'card'
       and private.local_day_end(v_entitlement.expires_on) > now() then
      select '. ' || t.body into v_card_tip
      from public.notification_templates t
      where t.type = 'purchase_new_card';
    end if;

    -- Last in the transaction (AD-6, AD-12). A pinned product already got
    -- its booking notification in the core (3.5, user decision 2026-10-13):
    -- one notification, no purchase_repeat.
    if v_entitlement.pinned_event_id is null then
      perform private.enqueue_notification(
        p_customer_id,
        'purchase_repeat',
        v_payment_id::text,
        jsonb_build_object(
          'product', v_plan ->> 'product_name',
          'expires_on', private.format_day_month(v_entitlement.expires_on),
          'card_tip', coalesce(v_card_tip, '')
        ),
        '/me'
      );
    end if;

    return private.idempotent_finish(
      v_actor::text,
      'admin_approve_payment',
      p_idempotency_key,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'entitlement_id', v_entitlement.id,
        'customer_id', p_customer_id,
        'expires_on', v_entitlement.expires_on,
        'product_name', v_plan ->> 'product_name',
        'units', (v_plan ->> 'units')::integer
      ) || v_pinned
    );
  end if;

  -- The core does not know the label: set it here, audited (AD-19, masked
  -- by private.audit_diff).
  if v_label is not null then
    select pay.* into v_payment
    from public.payments pay
    where pay.id = v_payment_id
    for update;

    update public.payments
    set payer_label = v_label
    where id = v_payment_id
    returning * into v_payment_new;

    perform private.audit(
      v_actor, 'admin', 'admin_approve_payment', 'payments', v_payment_id,
      null, p_event_id, to_jsonb(v_payment), to_jsonb(v_payment_new)
    );
  end if;

  v_token := private.issue_token('join', null, v_payment_id);

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  perform private.audit(
    v_actor, 'admin', 'admin_approve_payment', 'activation_tokens', v_token_row.id,
    null, p_event_id, null, to_jsonb(v_token_row)
  );

  v_result := private.idempotent_finish(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'entitlement_id', v_entitlement.id,
      'customer_id', null,
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'expires_on', v_entitlement.expires_on,
      'reissue_required', true
    ) || v_pinned
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

-- Round 2, push click (user decision 2026-10-13: opening a push marks its
-- notification read): as in 20261006184326 (equal to the live prosrc on
-- 2026-10-13), plus notification_id in each job, so the worker puts it in
-- the push payload and the app marks it read through the existing
-- mark_notifications_read (her session; it skips rows that are not hers).
-- Same signature (returns jsonb), no drop; grant re-stated (AD-5).
create or replace function public.claim_push_jobs(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_subs jsonb;
  v_out jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "limit"}';
  end if;

  for v_job in
    select
      j.id,
      j.notification_id,
      j.status,
      j.attempt_count,
      n.recipient_id,
      n.created_at as notified_at,
      n.payload,
      n.target_path
    from public.notification_jobs j
    join public.notifications n on n.id = j.notification_id
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'sending' and j.lease_until < now())
    order by j.next_attempt_at, j.id
    for update of j skip locked
  loop
    exit when v_count >= p_limit;

    if v_job.notified_at < now() - interval '24 hours' then
      update public.notification_jobs
      set status = 'skipped', lease_until = null, finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'sending' and v_job.attempt_count >= 5 then
      update public.notification_jobs
      set status = 'failed', lease_until = null, finished_at = now(),
          last_error = 'LEASE_EXPIRED'
      where id = v_job.id;
      continue;
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      )
      order by s.id
    )
    into v_subs
    from public.push_subscriptions s
    where s.user_id = v_job.recipient_id
      and not exists (
        select 1
        from public.notification_deliveries d
        where d.job_id = v_job.id
          and d.subscription_id = s.id
      );

    if v_subs is null then
      update public.notification_jobs
      set status = case
            when exists (
              select 1 from public.notification_deliveries d where d.job_id = v_job.id
            ) then 'sent'
            else 'skipped'
          end,
          lease_until = null,
          finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    update public.notification_jobs
    set status = 'sending',
        lease_until = now() + interval '2 minutes',
        attempt_count = attempt_count + 1
    where id = v_job.id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'job_id', v_job.id,
      'notification_id', v_job.notification_id,
      'title', v_job.payload ->> 'title',
      'body', v_job.payload ->> 'body',
      'target_path', v_job.target_path,
      'subscriptions', v_subs
    ));
    v_count := v_count + 1;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.claim_push_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_jobs(integer) to service_role;
