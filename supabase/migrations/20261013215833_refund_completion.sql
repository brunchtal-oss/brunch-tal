-- Story 3.9, part 2 of 2: Tal records that she paid a refund (CAP-19,
-- AD-7). Runs after 20261013215828_refund_completed_type (the type check).
--
-- It drops and adds a constraint, so the user runs it in the Supabase SQL
-- Editor and the main session registers it. Every redefinition below was
-- built from the live pg_get_functiondef on 2026-10-13 (identical to the
-- latest migration of each).
--
-- 1. refund_requests.refunded_on (the day Tal paid it): null while
--    requested, required when completed (refund_requests_completion_check).
-- 2. The refund_completed template (push on).
-- 3. private.plan_admin_complete_refund, preview_admin_complete_refund and
--    admin_complete_refund (a sensitive action: "האם לאשר החזר?").
-- 4. admin_list_refund_requests (the refunds section of /admin/payments)
--    and admin_list_customer_credits (the customer card's credits and
--    refunds).
-- 5. get_my_credits: refund.refunded_on, and a refunded credit only for 14
--    local days after refunded_on.
-- 6. admin_get_home: the month's refunds by refunded_on.
-- 7. private.bind_purchase: a refunded credit of an unbound purchase moves
--    like the others and its customer gets refund_completed.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.refund_requests
  add column refunded_on date;

-- No completed request exists before 3.9; a completed one (none in dev on
-- 2026-10-13) would take the local day of its completion.
update public.refund_requests
set refunded_on = (completed_at at time zone 'Asia/Jerusalem')::date
where status = 'completed'
  and refunded_on is null;

alter table public.refund_requests
  drop constraint refund_requests_completion_check;

alter table public.refund_requests
  add constraint refund_requests_completion_check
    check (
      (
        status = 'requested'
        and completed_at is null
        and refunded_on is null
        and reference is null
        and handled_by is null
      )
      or (
        status = 'completed'
        and completed_at is not null
        and refunded_on is not null
      )
    );

-- ---------------------------------------------------------------------------
-- 2. Template (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- Tal recorded the refund (user decision 2026-10-13). Vars: {amount} (the
-- refunded amount, "180 ₪") and {date} (DD.MM of the cancelled session).
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'refund_completed', 'customer', true, 'template',
  'ההחזר בוצע',
  'החזר של {amount} על הבראנץ׳ ב-{date} הועבר אלייך',
  array['amount', 'date']
);

-- ---------------------------------------------------------------------------
-- 3. Completing a refund request (AD-7: one plan for the preview and the
--    action)
-- ---------------------------------------------------------------------------

-- What completing the request would do, and its ceiling. The ceiling is per
-- payment: paid_agorot (the request's payment) minus refunded_before_agorot
-- (the completed requests on the same payment), never below 0. Refusals:
-- a missing request (NOT_FOUND), one that is not requested
-- (REFUND_ALREADY_COMPLETED). Result: {ok, code} or {ok, refund_request_id,
-- customer_id, customer_label, requested_agorot, paid_agorot,
-- refunded_before_agorot, max_agorot, paid_on, concept_name, starts_at (the
-- cancelled session), today (the local day, the default and the latest
-- refunded_on)}.
create function private.plan_admin_complete_refund(p_refund_request_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_request public.refund_requests;
  v_payment public.payments;
  v_label text;
  v_before bigint;
  v_concept text;
  v_starts timestamptz;
begin
  select r.* into v_request
  from public.refund_requests r
  where r.id = p_refund_request_id;

  if v_request.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_request.status <> 'requested' then
    return jsonb_build_object('ok', false, 'code', 'REFUND_ALREADY_COMPLETED');
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = v_request.payment_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_request.customer_id, v_payment.customer_id);

  select coalesce(sum(o.amount_agorot), 0)::bigint into v_before
  from public.refund_requests o
  where o.payment_id = v_request.payment_id
    and o.status = 'completed';

  select c.name, e.starts_at into v_concept, v_starts
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  where b.id = v_request.booking_id;

  return jsonb_build_object(
    'ok', true,
    'refund_request_id', v_request.id,
    'customer_id', coalesce(v_request.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'requested_agorot', v_request.amount_agorot,
    'paid_agorot', v_payment.amount_agorot,
    'refunded_before_agorot', v_before,
    'max_agorot', greatest(v_payment.amount_agorot - v_before, 0),
    'paid_on', v_payment.paid_on,
    'concept_name', v_concept,
    'starts_at', v_starts,
    'today', (now() at time zone 'Asia/Jerusalem')::date
  );
end;
$$;

-- The dialog's impact box (AD-7): the admin check, then the plan.
create function public.preview_admin_complete_refund(p_refund_request_id uuid)
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

  return private.plan_admin_complete_refund(p_refund_request_id);
end;
$$;

-- Tal records the refund she paid outside the app (source §6: a date, an
-- amount and an optional reference). Order: is_admin, idempotency, the
-- shape (INVALID_INPUT, detail field: refunded_on missing or after the
-- local today; amount missing or below 0; reference over 200 characters
-- after trimming), the request read without a lock, her profile locked
-- (when bound), the credit, the payment, the request (AD-6) and the
-- re-check of its customer (CONCURRENT_CHANGE), the plan (its code is
-- raised), refunded_on before the payment's paid_on (INVALID_INPUT,
-- refunded_on), an amount above max_agorot (REFUND_EXCEEDS_PAID),
-- p_confirmed (CONFIRM_REQUIRED). Then: the request completed with the
-- amount Tal entered (the requested amount stays in the audit's before;
-- nothing stays open), the credit refunded, both audited, and
-- refund_completed for a bound customer (discriminator: the request id,
-- vars {amount, date}). Result: {refund_request_id, amount_agorot}.
create function public.admin_complete_refund(
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
      '/me/bookings'
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

-- ---------------------------------------------------------------------------
-- 4. Reads for the admin
-- ---------------------------------------------------------------------------

-- The refunds section of /admin/payments: every open request (oldest
-- first), then the latest 30 completed ones (newest first). Each:
-- {refund_request_id, status, customer_id, customer_label, amount_agorot
-- (requested, or refunded once completed), requested_at, refunded_on,
-- reference, concept_name, starts_at (the cancelled session), product_name,
-- paid_agorot, max_agorot (what the payment can still refund: paid minus
-- its completed requests, never below 0)}.
create function public.admin_list_refund_requests()
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
  )
  select coalesce(jsonb_agg(u.item order by u.grp, u.n), '[]'::jsonb)
  into v_result
  from (
    select o.grp, o.n, o.item from open_rows o
    union all
    select d.grp, d.n, d.item from done_rows d where d.n <= 30
  ) u;

  return v_result;
end;
$$;

-- A customer's credits and their refunds, for her card (newest first):
-- {credit_id, status, choice_pending, party_size, origin_starts_at,
-- concept_name (of the original session), monetary_basis_agorot, refund:
-- {refund_request_id, status, amount_agorot, requested_at, refunded_on,
-- reference} or null}. [] for a customer without credits.
create function public.admin_list_customer_credits(p_customer_id uuid)
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'credit_id', c.id,
        'status', c.status,
        'choice_pending', c.choice_pending,
        'party_size', c.party_size,
        'origin_starts_at', c.origin_starts_at,
        'concept_name', oc.name,
        'monetary_basis_agorot', c.monetary_basis_agorot,
        'refund', case
          when rr.id is not null then jsonb_build_object(
            'refund_request_id', rr.id,
            'status', rr.status,
            'amount_agorot', rr.amount_agorot,
            'requested_at', rr.requested_at,
            'refunded_on', rr.refunded_on,
            'reference', rr.reference
          )
        end
      )
      order by c.created_at desc, c.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.cancellation_credits c
  join public.bookings ob on ob.id = c.origin_booking_id
  join public.events oe on oe.id = ob.event_id
  join public.concepts oc on oc.id = oe.concept_id
  left join public.refund_requests rr on rr.credit_id = c.id
  where c.customer_id = p_customer_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_my_credits
-- ---------------------------------------------------------------------------

-- As in 20261013162639, plus refund.refunded_on, and a refunded credit is
-- returned only while the local today is at most refunded_on + 14 (then
-- only the purchase chip remains). Every other field unchanged.
create or replace function public.get_my_credits()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_customer := private.current_customer_id();
  if v_customer is null then
    return '[]'::jsonb;
  end if;

  perform private.refresh_customer_credits(v_customer);

  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb)
  into v_result
  from (
    select
      c.id,
      c.created_at,
      jsonb_build_object(
        'credit_id', c.id,
        'status', c.status,
        'party_size', c.party_size,
        'origin_starts_at', c.origin_starts_at,
        'origin_concept_name', oc.name,
        'reserved_booking', r.reserved,
        'choice_pending', c.choice_pending,
        'cancelled_starts_at', ce.starts_at,
        'options_count', c.options_count,
        'options', case
          when c.choice_pending then '[]'::jsonb
          else coalesce(o.options, '[]'::jsonb)
        end,
        'waiting', c.status = 'active'
          and not c.choice_pending
          and r.reserved is null
          and coalesce(o.active_count, 0) = 0
          and n.counted < c.options_count,
        'exhausted', c.status = 'active'
          and not c.choice_pending
          and r.reserved is null
          and coalesce(o.active_count, 0) = 0
          and n.counted >= c.options_count,
        'refund', case
          when rr.id is not null then jsonb_build_object(
            'amount_agorot', rr.amount_agorot,
            'status', rr.status,
            'requested_at', rr.requested_at,
            'refunded_on', rr.refunded_on
          )
        end
      ) as item
    from public.cancellation_credits c
    join public.bookings ob on ob.id = c.origin_booking_id
    join public.events oe on oe.id = ob.event_id
    join public.concepts oc on oc.id = oe.concept_id
    left join public.refund_requests rr on rr.credit_id = c.id
    left join lateral (
      select e.starts_at
      from public.bookings b
      join public.events e on e.id = b.event_id
      where b.id = private.credit_cancelled_booking(c.id)
    ) ce on true
    left join lateral (
      select jsonb_build_object(
        'booking_id', b.id,
        'event_id', e.id,
        'starts_at', e.starts_at
      ) as reserved
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      join public.events e on e.id = b.event_id
      where a.credit_id = c.id
        and b.status = 'confirmed'
      order by b.id
      limit 1
    ) r on true
    left join lateral (
      select count(*)::integer as counted
      from public.credit_options oc2
      where oc2.credit_id = c.id
        and oc2.state in ('active', 'used', 'passed')
    ) n on true
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'event_id', e.id,
            'starts_at', e.starts_at,
            'concept_name', cc.name,
            'state', op.state
          )
          order by e.starts_at, e.id
        ) as options,
        count(*) filter (where op.state = 'active') as active_count
      from public.credit_options op
      join public.events e on e.id = op.event_id
      join public.concepts cc on cc.id = e.concept_id
      where op.credit_id = c.id
        and op.state in ('active', 'used')
    ) o on true
    where c.customer_id = v_customer
      and c.status in ('active', 'refund_requested', 'refunded')
      and (
        c.status <> 'refunded'
        or (now() at time zone 'Asia/Jerusalem')::date <= rr.refunded_on + 14
      )
  ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. admin_get_home
-- ---------------------------------------------------------------------------

-- As in 20261010141240, except that the month's refunds (refunded_count,
-- refunded_agorot, so net_agorot) count a completed request by
-- refunded_on, the day Tal paid it (as payments by paid_on), not by when
-- she recorded it. Every other field unchanged.
create or replace function public.admin_get_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_start date;
  v_threshold integer;
  v_sessions jsonb;
  v_cards jsonb;
  v_totals jsonb;
  v_refunded_count integer;
  v_refunded_agorot bigint;
  v_open_refunds jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  v_start := date_trunc('month', v_today)::date;

  select s.admin_expiring_days into v_threshold
  from public.business_settings s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', u.id,
        'concept_name', u.concept_name,
        'kind', u.kind,
        'starts_at', u.starts_at,
        'ends_at', u.ends_at,
        'occupied', private.occupied_places(u.id),
        'capacity', u.capacity_adults
      )
      order by u.starts_at, u.id
    ),
    '[]'::jsonb
  )
  into v_sessions
  from (
    select e.id, c.name as concept_name, e.kind, e.starts_at, e.ends_at,
      e.capacity_adults
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.ends_at > now()
    order by e.starts_at, e.id
    limit 4
  ) u;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'available', x.available,
        'expires_on', x.expires_on,
        'days_left', x.days_left
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      b.available,
      b.expires_on,
      b.expires_on - v_today as days_left
    from public.entitlement_balances b
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and b.available > 0
      and b.expires_on - v_today <= v_threshold
  ) x;

  select count(*)::integer, coalesce(sum(r.amount_agorot), 0)::bigint
  into v_refunded_count, v_refunded_agorot
  from public.refund_requests r
  where r.status = 'completed'
    and r.refunded_on between v_start and v_today;

  select jsonb_build_object(
    'period_start', v_start,
    'period_end', v_today,
    'approved_count', count(*)::integer,
    'approved_agorot', coalesce(sum(p.amount_agorot), 0)::bigint,
    'refunded_count', v_refunded_count,
    'refunded_agorot', v_refunded_agorot,
    'net_agorot', coalesce(sum(p.amount_agorot), 0)::bigint - v_refunded_agorot
  )
  into v_totals
  from public.payments p
  where p.status = 'approved'
    and p.paid_on between v_start and v_today;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'refund_request_id', x.id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'amount_agorot', x.amount_agorot,
        'requested_at', x.requested_at,
        'event_id', x.event_id,
        'concept_name', x.concept_name,
        'starts_at', x.starts_at
      )
      order by x.requested_at, x.id
    ),
    '[]'::jsonb
  )
  into v_open_refunds
  from (
    select
      r.id,
      coalesce(r.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      r.amount_agorot,
      r.requested_at,
      e.id as event_id,
      c.name as concept_name,
      e.starts_at
    from public.refund_requests r
    join public.payments p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join public.profiles pr on pr.id = coalesce(r.customer_id, p.customer_id)
    where r.status = 'requested'
  ) x;

  return jsonb_build_object(
    'upcoming_sessions', v_sessions,
    'expiring_cards', v_cards,
    'totals', v_totals,
    'open_refunds', v_open_refunds
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The bind
-- ---------------------------------------------------------------------------

-- As in 20261013162639, plus: a refunded credit (Tal completed its refund
-- while the purchase was not bound) moves with its request as before, and
-- its customer gets refund_completed (discriminator bind:<credit_id>, vars
-- {amount: the refunded amount, date: DD.MM of the cancelled session})
-- instead of booking_cancelled_refund.
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
        '/me/bookings'
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

-- Internal helpers: no API role executes them.
revoke execute on function private.plan_admin_complete_refund(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_complete_refund(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_complete_refund(uuid) to authenticated;

revoke execute on function public.admin_complete_refund(uuid, date, integer, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_complete_refund(uuid, date, integer, text, boolean, uuid) to authenticated;

revoke execute on function public.admin_list_refund_requests() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_refund_requests() to authenticated;

revoke execute on function public.admin_list_customer_credits(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customer_credits(uuid) to authenticated;

revoke execute on function public.get_my_credits() from public, anon, authenticated, service_role;
grant execute on function public.get_my_credits() to authenticated;

revoke execute on function public.admin_get_home() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_home() to authenticated;
