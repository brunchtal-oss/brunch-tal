-- Story 3.9, review round 1 (user decisions 2026-10-14). No drop: plain
-- create or replace, each from the live pg_get_functiondef (identical to
-- 20261013215833_refund_completion). The user runs it in the SQL Editor.
--
-- 1. refund_completed (admin_complete_refund, and the bind of a refunded
--    credit) targets the purchase page /me/purchases/<source_entitlement_id>,
--    where the chip "הוחזר" stays, not /me/bookings (the refunded card leaves
--    it 14 days after refunded_on).
-- 2. admin_list_refund_requests returns every open request (oldest first)
--    and every completed request whose purchase is not bound
--    (refund_requests.customer_id and payments.customer_id both null;
--    newest first), instead of the latest 30 completed: those have no
--    customer card to show them. Once bound they leave the list.

-- As in 20261013215833, except the notification's target.
create or replace function public.admin_complete_refund(
  p_refund_request_id uuid,
  p_refunded_on date,
  p_amount_agorot integer,
  p_reference text,
  p_confirmed boolean,
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
  v_reference text := nullif(btrim(p_reference), '');
  v_customer uuid;
  v_credit_id uuid;
  v_payment_id uuid;
  v_request public.refund_requests;
  v_request_new public.refund_requests;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_plan jsonb;
  v_event public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_complete_refund', p_idempotency_key,
    jsonb_build_object(
      'refund_request_id', p_refund_request_id,
      'refunded_on', p_refunded_on,
      'amount_agorot', p_amount_agorot,
      'reference', v_reference,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_refunded_on is null
     or p_refunded_on > (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "refunded_on"}';
  end if;

  if p_amount_agorot is null or p_amount_agorot < 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "amount"}';
  end if;

  if char_length(v_reference) > 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reference"}';
  end if;

  select r.customer_id, r.credit_id, r.payment_id
  into v_customer, v_credit_id, v_payment_id
  from public.refund_requests r
  where r.id = p_refund_request_id;

  if v_credit_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_customer is not null then
    perform 1
    from public.profiles p
    where p.id = v_customer
    for update;
  end if;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = v_credit_id
  for update;

  -- Two requests on one payment wait here for each other, so the ceiling
  -- holds.
  perform 1
  from public.payments pay
  where pay.id = v_payment_id
  for update;

  select r.* into v_request
  from public.refund_requests r
  where r.id = p_refund_request_id
  for update;

  if v_request.customer_id is distinct from v_customer
     or v_credit.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_plan := private.plan_admin_complete_refund(v_request.id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_refunded_on < (v_plan ->> 'paid_on')::date then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "refunded_on"}';
  end if;

  if p_amount_agorot > (v_plan ->> 'max_agorot')::integer then
    raise exception 'REFUND_EXCEEDS_PAID' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = (
    select b.event_id
    from public.bookings b
    where b.id = v_request.booking_id
  );

  update public.refund_requests
  set status = 'completed',
      completed_at = now(),
      refunded_on = p_refunded_on,
      amount_agorot = p_amount_agorot,
      reference = v_reference,
      handled_by = v_actor
  where id = v_request.id
  returning * into v_request_new;

  update public.cancellation_credits
  set status = 'refunded'
  where id = v_credit.id
  returning * into v_credit_new;

  perform private.audit(
    v_actor, 'admin', 'admin_complete_refund', 'refund_requests', v_request.id,
    v_customer, v_event.id, to_jsonb(v_request), to_jsonb(v_request_new)
  );

  perform private.audit(
    v_actor, 'admin', 'admin_complete_refund', 'cancellation_credits', v_credit.id,
    v_customer, v_event.id, to_jsonb(v_credit), to_jsonb(v_credit_new)
  );

  -- An unbound purchase has no one to tell yet; the bind sends it (AD-23).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'refund_completed',
      v_request.id::text,
      jsonb_build_object(
        'amount', private.format_agorot(p_amount_agorot),
        'date', private.format_day_month(
          (v_event.starts_at at time zone 'Asia/Jerusalem')::date
        )
      ),
      '/me/purchases/' || v_credit.source_entitlement_id::text
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_complete_refund', p_idempotency_key,
    jsonb_build_object(
      'refund_request_id', v_request.id,
      'amount_agorot', p_amount_agorot
    )
  );
end;
$$;

-- As in 20261013215833, except which completed requests it returns (above).
create or replace function public.admin_list_refund_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with base as (
    select
      r.id,
      r.status,
      r.requested_at,
      r.completed_at,
      r.customer_id is null and p.customer_id is null as unbound,
      jsonb_build_object(
        'refund_request_id', r.id,
        'status', r.status,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'customer_label', coalesce(nullif(btrim(pr.full_name), ''), p.payer_label),
        'amount_agorot', r.amount_agorot,
        'requested_at', r.requested_at,
        'refunded_on', r.refunded_on,
        'reference', r.reference,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'product_name', p.product_snapshot ->> 'name',
        'paid_agorot', p.amount_agorot,
        'max_agorot', greatest(p.amount_agorot - d.done, 0)
      ) as item
    from public.refund_requests r
    join public.payments p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join public.profiles pr on pr.id = coalesce(r.customer_id, p.customer_id)
    cross join lateral (
      select coalesce(sum(o.amount_agorot), 0)::bigint as done
      from public.refund_requests o
      where o.payment_id = r.payment_id
        and o.status = 'completed'
    ) d
  ),
  open_rows as (
    select
      0 as grp,
      row_number() over (order by b.requested_at, b.id) as n,
      b.item
    from base b
    where b.status = 'requested'
  ),
  done_rows as (
    select
      1 as grp,
      row_number() over (order by b.completed_at desc, b.id) as n,
      b.item
    from base b
    where b.status = 'completed'
      and b.unbound
  )
  select coalesce(jsonb_agg(u.item order by u.grp, u.n), '[]'::jsonb)
  into v_result
  from (
    select o.grp, o.n, o.item from open_rows o
    union all
    select d.grp, d.n, d.item from done_rows d
  ) u;

  return v_result;
end;
$$;

-- As in 20261013215833, except the target of refund_completed.
create or replace function private.bind_purchase(p_payment_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_payment public.payments;
  v_payment_new public.payments;
  v_booking public.bookings;
  v_booking_new public.bookings;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_refund public.refund_requests;
  v_refund_new public.refund_requests;
  v_event public.events;
begin
  if p_payment_id is null or p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null
  for update;

  if v_profile_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform 1
  from public.bookings b
  where b.payment_id = p_payment_id
  order by b.id
  for update;

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = p_payment_id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.source_entitlement_id = v_entitlement.id
  order by c.id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  perform 1
  from public.refund_requests r
  where r.payment_id = p_payment_id
  order by r.id
  for update;

  if v_payment.id is null or v_entitlement.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_payment.customer_id is not null
     or v_entitlement.customer_id is not null
     or exists (
       select 1
       from public.bookings b
       where b.payment_id = p_payment_id
         and b.customer_id is not null
     )
     or exists (
       select 1
       from public.cancellation_credits c
       where c.source_entitlement_id = v_entitlement.id
         and c.customer_id is not null
     )
     or exists (
       select 1
       from public.refund_requests r
       where r.payment_id = p_payment_id
         and r.customer_id is not null
     )
     or exists (
       select 1
       from public.bookings b
       join public.bookings other
         on other.event_id = b.event_id
        and other.customer_id = p_customer_id
        and private.is_real_booking(other.status)
       where b.payment_id = p_payment_id
         and b.status = 'confirmed'
     )
     or (
       (
         v_entitlement.kind = 'intro'
         or coalesce((v_entitlement.eligibility_snapshot ->> 'intro_only')::boolean, false)
       )
       and private.intro_blocked(p_customer_id, p_payment_id)
     ) then
    raise exception 'BIND_CONFLICT' using errcode = 'P0001';
  end if;

  update public.payments
  set customer_id = p_customer_id
  where id = v_payment.id
  returning * into v_payment_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'payments', v_payment.id,
    p_customer_id, null, to_jsonb(v_payment), to_jsonb(v_payment_new)
  );

  update public.entitlements
  set customer_id = p_customer_id, bound_at = now()
  where id = v_entitlement.id
  returning * into v_entitlement_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'entitlements', v_entitlement.id,
    p_customer_id, v_entitlement.pinned_event_id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
  );

  for v_booking in
    select b.*
    from public.bookings b
    where b.payment_id = p_payment_id
    order by b.id
  loop
    update public.bookings
    set customer_id = p_customer_id
    where id = v_booking.id
    returning * into v_booking_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'bookings', v_booking.id,
      p_customer_id, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_booking_new)
    );
  end loop;

  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
    order by c.id
  loop
    update public.cancellation_credits
    set customer_id = p_customer_id
    where id = v_credit.id
    returning * into v_credit_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'cancellation_credits', v_credit.id,
      p_customer_id, null, to_jsonb(v_credit), to_jsonb(v_credit_new)
    );
  end loop;

  for v_refund in
    select r.*
    from public.refund_requests r
    where r.payment_id = p_payment_id
    order by r.id
  loop
    update public.refund_requests
    set customer_id = p_customer_id
    where id = v_refund.id
    returning * into v_refund_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'refund_requests', v_refund.id,
      p_customer_id, null, to_jsonb(v_refund), to_jsonb(v_refund_new)
    );
  end loop;

  -- Skipped at approval because there was no customer (AD-23).
  if v_entitlement.kind = 'card' then
    perform private.enqueue_notification(
      p_customer_id, 'purchase_new_card', p_payment_id::text, '{}'::jsonb, '/me'
    );
  end if;

  for v_booking in
    select b.*
    from public.bookings b
    where b.payment_id = p_payment_id
      and b.status = 'confirmed'
    order by b.id
  loop
    perform private.notify_booking_confirmed(v_booking);
  end loop;

  -- A credit made while there was no customer (Tal cancelled the held
  -- place): its options are refreshed for her now (an option she already
  -- booked is replaced, an unfilled one may fill; the owner's path), and
  -- she hears about it: booking_cancelled_pinned for an active credit,
  -- booking_cancelled_refund for a refund request, refund_completed for a
  -- refund Tal already completed (3.9).
  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
      and c.status in ('active', 'refund_requested', 'refunded')
    order by c.id
  loop
    if v_credit.status = 'active' then
      perform private.refresh_credit_options(v_credit.id);
    end if;

    -- Story 3.9: the refund was completed before she joined.
    if v_credit.status = 'refunded' then
      select r.* into v_refund
      from public.refund_requests r
      where r.credit_id = v_credit.id;

      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = v_refund.booking_id
      );

      perform private.enqueue_notification(
        p_customer_id,
        'refund_completed',
        'bind:' || v_credit.id::text,
        jsonb_build_object(
          'amount', private.format_agorot(v_refund.amount_agorot),
          'date', private.format_day_month(
            (v_event.starts_at at time zone 'Asia/Jerusalem')::date
          )
        ),
        '/me/purchases/' || v_credit.source_entitlement_id::text
      );
      continue;
    end if;

    -- Story 3.8: a business cancel of a held place; she chooses now.
    if v_credit.status = 'active' and v_credit.choice_pending then
      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = private.credit_cancelled_booking(v_credit.id)
      );

      perform private.enqueue_notification(
        p_customer_id,
        'event_cancelled',
        v_event.id::text || ':' || v_event.revision::text,
        jsonb_build_object(
          'date',
          private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
        ),
        '/me/bookings'
      );
      continue;
    end if;

    perform private.enqueue_notification(
      p_customer_id,
      case when v_credit.status = 'active'
        then 'booking_cancelled_pinned'
        else 'booking_cancelled_refund'
      end,
      'bind:' || v_credit.id::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_complete_refund(uuid, date, integer, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_complete_refund(uuid, date, integer, text, boolean, uuid) to authenticated;

revoke execute on function public.admin_list_refund_requests() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_refund_requests() to authenticated;
