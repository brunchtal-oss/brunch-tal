-- Story 3.8: the business cancels or changes a session (CAP-12, CAP-17,
-- CAP-18, AD-6, AD-7, AD-12, AD-20).
--
-- Runs after 20261013162129_credit_option_moved.sql (the 'moved' reason).
--
-- 1. private.credit_cancelled_booking: the booking whose cancel made a
--    credit what it is now (the latest cancelled one among its origin and
--    the bookings it funded).
-- 2. Redefined private.refresh_credit_options: an active option whose
--    session now starts at or before the credit's origin is replaced
--    ('moved').
-- 3. Redefined private.cancel_core: p_choice = 'pending' is the business
--    mode, only for p_action = 'admin_cancel_event' (same signature, no
--    drop): a card entry is released; a pinned booking becomes an active
--    credit with choice_pending and no options; a credit-funded booking
--    gives the same credit back with choice_pending, its option for this
--    session replaced (event_cancelled). No booking_cancelled* notification.
-- 4. Cancel: private.plan_admin_cancel_event, preview_admin_cancel_event,
--    admin_cancel_event (one event_cancelled per customer, Tal's body).
-- 5. Time change: private.plan_admin_reschedule_event,
--    preview_admin_reschedule_event, admin_reschedule_event (one
--    event_changed per customer, Tal's body; pinned entitlements follow the
--    session's day). admin_update_event keeps EVENT_HAS_BOOKINGS.
-- 6. choose_credit_outcome: the customer closes a choice_pending credit
--    (refund or credit), no deadline.
-- 7. Redefined private.bind_purchase (a moved choice_pending credit gets
--    event_cancelled), get_my_credits (choice_pending, cancelled_starts_at),
--    admin_get_attention_items (kind choice_pending).
--
-- Reminders (5.17) need no change: job_reminders keys on booking:revision
-- and reads starts_at live; a cancelled session is not published.

-- ---------------------------------------------------------------------------
-- 1. private.credit_cancelled_booking
-- ---------------------------------------------------------------------------

-- The cancelled booking that made the credit what it is now: among its
-- origin booking and every booking it funded, the latest cancelled one
-- (a funded booking before the origin, which is always cancelled first;
-- then cancelled_at, id). For a business-cancelled credit-funded booking it is
-- that booking, not the origin. Null when none is cancelled.
create function private.credit_cancelled_booking(p_credit_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select b.id
  from public.cancellation_credits c
  join public.bookings b
    on b.id = c.origin_booking_id
    or b.id in (
      select a.booking_id
      from public.booking_allocations a
      where a.credit_id = c.id
    )
  where c.id = p_credit_id
    and b.status = 'cancelled'
  order by b.id = c.origin_booking_id, b.cancelled_at desc nulls last, b.id desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. private.refresh_credit_options
-- ---------------------------------------------------------------------------

-- As in 20261010141240, plus in step (1), right after a cancelled session:
-- an active option whose session now starts at or before the credit's
-- origin (origin_starts_at; Tal moved it earlier) -> replaced ('moved').
-- Step (2) already takes only sessions after the origin.
create or replace function private.refresh_credit_options(
  p_credit_id uuid,
  p_fill boolean default true
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
  v_origin_event uuid;
  v_option record;
  v_counted integer;
  v_event_id uuid;
begin
  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null
     or v_credit.status <> 'active'
     or v_credit.choice_pending then
    return;
  end if;

  if exists (
    select 1
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where a.credit_id = v_credit.id
      and b.status = 'confirmed'
  ) then
    return;
  end if;

  -- (1)
  for v_option in
    select
      o.id,
      e.status as event_status,
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults,
      e.id as event_id
    from public.credit_options o
    join public.events e on e.id = o.event_id
    where o.credit_id = v_credit.id
      and o.state = 'active'
    order by e.starts_at, e.id
    for update of o
  loop
    if v_option.event_status = 'cancelled' then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'event_cancelled'
      where id = v_option.id;
    elsif v_option.starts_at <= v_credit.origin_starts_at then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'moved'
      where id = v_option.id;
    elsif v_credit.customer_id is not null and exists (
      select 1
      from public.bookings b
      where b.customer_id = v_credit.customer_id
        and b.event_id = v_option.event_id
        and b.status = 'confirmed'
    ) then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'booked'
      where id = v_option.id;
    elsif v_option.event_status = 'completed'
       or now() >= v_option.registration_closes_at then
      update public.credit_options
      set state = 'passed'
      where id = v_option.id;
    elsif private.occupied_places(v_option.event_id) + v_credit.party_size
          > v_option.capacity_adults then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'full'
      where id = v_option.id;
    end if;
  end loop;

  -- (2)
  if not coalesce(p_fill, true) then
    return;
  end if;

  select b.event_id into v_origin_event
  from public.bookings b
  where b.id = v_credit.origin_booking_id;

  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('active', 'used', 'passed');

  while v_counted < v_credit.options_count loop
    v_event_id := null;

    select e.id into v_event_id
    from public.events e
    where e.status = 'published'
      and e.kind = v_credit.event_kind
      and e.starts_at > v_credit.origin_starts_at
      and now() < e.registration_closes_at
      and private.occupied_places(e.id) + v_credit.party_size <= e.capacity_adults
      and e.id is distinct from v_origin_event
      and not exists (
        select 1
        from public.credit_options o
        where o.credit_id = v_credit.id
          and o.event_id = e.id
      )
      and not exists (
        select 1
        from public.bookings b
        where b.customer_id = v_credit.customer_id
          and b.event_id = e.id
          and b.status = 'confirmed'
      )
    order by e.starts_at, e.id
    limit 1;

    exit when v_event_id is null;

    insert into public.credit_options (credit_id, event_id)
    values (v_credit.id, v_event_id);

    v_counted := v_counted + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. private.cancel_core
-- ---------------------------------------------------------------------------

-- As in 20261010141240, plus the business mode: p_choice = 'pending', only
-- with p_action = 'admin_cancel_event' (else INVALID_INPUT, detail choice),
-- for any funding. card: release as always (outcome 'card'). pinned: the
-- credit is active with choice_pending = true and gets no options, no
-- refund request (outcome 'choice_pending'). credit: the same credit, its
-- used option in this session replaced (event_cancelled), choice_pending =
-- true (audited; outcome 'choice_pending'); choosing credit later continues
-- the same options. No booking_cancelled* notification in this mode (the
-- caller sends event_cancelled).
create or replace function private.cancel_core(
  p_booking_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_reason text,
  p_choice text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_new public.bookings;
  v_event public.events;
  v_day date;
  v_funding text;
  v_alloc public.booking_allocations;
  v_entitlement public.entitlements;
  v_settings public.business_settings;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_refund public.refund_requests;
  v_outcome text;
  v_entitlement_id uuid;
  v_credit_id uuid;
  v_refund_id uuid;
  v_audit_id uuid;
  v_pending boolean := coalesce(p_choice = 'pending', false);
begin
  if p_actor_kind is null or p_actor_kind not in ('customer', 'admin', 'system')
     or p_action is null or btrim(p_action) = '' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  if private.needs_manual_cancel(v_booking.id) then
    raise exception 'MANUAL_HANDLING_REQUIRED' using errcode = 'P0001';
  end if;

  v_funding := coalesce(private.booking_funding(v_booking.id) ->> 'funding', 'card');

  if v_pending then
    if p_action <> 'admin_cancel_event' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "choice"}';
    end if;
  elsif v_funding = 'pinned' then
    if p_choice is null or p_choice not in ('refund', 'credit') then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "choice"}';
    end if;
  elsif p_choice is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;
  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = v_booking.id
  returning * into v_new;

  if v_funding = 'card' then
    v_outcome := 'card';
    for v_alloc in
      select a.*
      from public.booking_allocations a
      where a.booking_id = v_booking.id
      order by a.id
    loop
      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values (v_alloc.entitlement_id, v_booking.id, 'release', v_alloc.units, p_actor_id);
      v_entitlement_id := v_alloc.entitlement_id;
    end loop;

  elsif v_funding = 'pinned' then
    -- The reserve is closed as used; the value moves to the credit.
    for v_alloc in
      select a.*
      from public.booking_allocations a
      where a.booking_id = v_booking.id
      order by a.id
    loop
      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values (v_alloc.entitlement_id, v_booking.id, 'use', 0, p_actor_id);
      v_entitlement_id := coalesce(v_entitlement_id, v_alloc.entitlement_id);
    end loop;

    select e.* into v_entitlement
    from public.entitlements e
    where e.id = v_entitlement_id;

    select s.* into v_settings from public.business_settings s;

    insert into public.cancellation_credits (
      customer_id, origin_booking_id, source_entitlement_id, event_kind,
      party_size, options_count, origin_starts_at, original_cancelled_at,
      monetary_basis_agorot, status, choice_pending
    )
    values (
      v_booking.customer_id, v_booking.id, v_entitlement.id, v_event.kind,
      v_booking.party_size, greatest(v_settings.credit_options_count, 1),
      v_event.starts_at, now(),
      private.monetary_basis(v_booking.id),
      case when p_choice = 'refund' then 'refund_requested' else 'active' end,
      v_pending
    )
    returning * into v_credit;
    v_credit_id := v_credit.id;

    perform private.audit(
      p_actor_id, p_actor_kind, p_action, 'cancellation_credits', v_credit.id,
      v_credit.customer_id, v_event.id, null, to_jsonb(v_credit), p_reason
    );

    if p_choice = 'refund' then
      insert into public.refund_requests (
        customer_id, credit_id, payment_id, booking_id, amount_agorot
      )
      values (
        v_booking.customer_id, v_credit.id, v_entitlement.payment_id,
        v_booking.id, v_credit.monetary_basis_agorot
      )
      returning * into v_refund;
      v_refund_id := v_refund.id;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'refund_requests', v_refund.id,
        v_refund.customer_id, v_event.id, null, to_jsonb(v_refund), p_reason
      );
      v_outcome := 'refund';
    elsif v_pending then
      v_outcome := 'choice_pending';
    else
      v_outcome := 'credit';
    end if;

  else
    -- funding = 'credit': the same credit, the same options (CAP-18).
    select a.credit_id into v_credit_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
      and a.credit_id is not null
    order by a.id
    limit 1;

    if v_pending then
      -- The business cancelled the session she chose: not an opportunity
      -- that passed; the option is replaced, and she chooses again.
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'event_cancelled'
      where credit_id = v_credit_id
        and event_id = v_booking.event_id
        and state = 'used';

      select c.* into v_credit
      from public.cancellation_credits c
      where c.id = v_credit_id;

      update public.cancellation_credits
      set choice_pending = true
      where id = v_credit_id
      returning * into v_credit_new;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'cancellation_credits', v_credit_id,
        v_credit_new.customer_id, v_event.id, to_jsonb(v_credit), to_jsonb(v_credit_new), p_reason
      );
      v_outcome := 'choice_pending';
    else
      update public.credit_options
      set state = 'active'
      where credit_id = v_credit_id
        and event_id = v_booking.event_id
        and state = 'used';

      v_outcome := 'credit';
    end if;
  end if;

  v_audit_id := private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    v_booking.customer_id, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_new), p_reason
  );

  if v_outcome = 'credit' then
    perform private.refresh_credit_options(v_credit_id);
  end if;

  -- A place was freed in this session.
  perform private.refresh_credits_for_event(v_booking.event_id);

  -- Last in the transaction (AD-6, AD-12); a null customer creates nothing.
  -- The business mode sends nothing here (the caller sends event_cancelled).
  if not v_pending then
    perform private.enqueue_notification(
      v_booking.customer_id,
      case v_outcome
        when 'card' then 'booking_cancelled'
        when 'refund' then 'booking_cancelled_refund'
        else 'booking_cancelled_pinned'
      end,
      v_audit_id::text,
      jsonb_build_object('date', private.format_day_month(v_day)),
      '/me/bookings'
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'booking_id', v_booking.id,
    'outcome', v_outcome,
    'entitlement_id', v_entitlement_id,
    'credit_id', v_credit_id,
    'refund_request_id', v_refund_id
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cancel a session
-- ---------------------------------------------------------------------------

-- What cancelling the session will do (AD-7: the preview and the action run
-- this one plan). Refusals: a missing session, not published, or already
-- started (EVENT_NOT_CANCELLABLE); a booking offset from a card and an
-- addition (MANUAL_HANDLING_REQUIRED: Tal handles it first). Result: {ok,
-- event_id, concept_name, starts_at, booking_count, places, card_count
-- (an entry returns to a card), choice_count (a credit a customer chooses
-- for; held places not counted), unbound_count (a place held for a new
-- customer), at_risk, parked ([{customer_id|null, customer_label,
-- payment_id}]: paid without a place, unchanged by the cancel), title,
-- body}. card_count + choice_count + unbound_count = booking_count.
-- at_risk: every card-funded booking whose card is expired, or has no other
-- published session open for registration, with room for the party, of a
-- kind and a weekday the card funds, from its valid_from and before
-- local_day_end(expires_on): {customer_id, customer_label, product_name,
-- expires_on, reason: 'expired' | 'no_session_before_expiry'}, by
-- expires_on. title and body: event_cancelled rendered with {date}.
create function private.plan_admin_cancel_event(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_concept text;
  v_counts record;
  v_at_risk jsonb;
  v_parked jsonb;
  v_template public.notification_templates;
  v_vars jsonb;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_CANCELLABLE');
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and private.needs_manual_cancel(b.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select
    count(*)::integer as booking_count,
    count(*) filter (where x.funding = 'card')::integer as card_count,
    count(*) filter (
      where x.funding <> 'card' and x.customer_id is not null
    )::integer as choice_count,
    count(*) filter (where x.customer_id is null)::integer as unbound_count
  into v_counts
  from (
    select
      b.customer_id,
      coalesce(private.booking_funding(b.id) ->> 'funding', 'card') as funding
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', r.customer_id,
        'customer_label', r.customer_label,
        'product_name', r.product_name,
        'expires_on', r.expires_on,
        'reason', r.reason
      )
      order by r.expires_on, r.booking_id
    ),
    '[]'::jsonb
  )
  into v_at_risk
  from (
    select
      b.id as booking_id,
      b.customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      e.expires_on,
      case
        when private.local_day_end(e.expires_on) <= now() then 'expired'
        else 'no_session_before_expiry'
      end as reason
    from public.bookings b
    cross join lateral (select private.booking_funding(b.id) as j) f
    join public.entitlements e on e.id = (f.j ->> 'entitlement_id')::uuid
    join public.payments p on p.id = e.payment_id
    left join public.profiles pr on pr.id = b.customer_id
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and f.j ->> 'funding' = 'card'
      and (
        private.local_day_end(e.expires_on) <= now()
        or not exists (
          select 1
          from public.events o
          where o.id <> v_event.id
            and o.status = 'published'
            and now() < o.registration_closes_at
            and o.starts_at < private.local_day_end(e.expires_on)
            and o.kind = e.eligible_event_kind
            and not (e.kind = 'card' and o.kind = 'couple')
            and (o.starts_at at time zone 'Asia/Jerusalem')::date >= e.valid_from
            and (
              e.allowed_weekdays is null
              or extract(dow from (o.starts_at at time zone 'Asia/Jerusalem')::date)::smallint
                 = any (e.allowed_weekdays)
            )
            and private.occupied_places(o.id) + b.party_size <= o.capacity_adults
            and not exists (
              select 1
              from public.bookings ob
              where ob.event_id = o.id
                and ob.customer_id = b.customer_id
                and ob.status = 'confirmed'
            )
        )
      )
  ) r;

  -- Paid without a place (3.11 'park'): an active entitlement pinned to the
  -- session with no booking on its payment, joined or not. Never blocks;
  -- the action needs p_parked_acknowledged (user decision 2026-10-13).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'payment_id', x.payment_id
      )
      order by x.created_at, x.payment_id
    ),
    '[]'::jsonb
  )
  into v_parked
  from (
    select
      coalesce(e.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.id as payment_id,
      e.created_at
    from public.entitlements e
    join public.payments p on p.id = e.payment_id
    left join public.profiles pr on pr.id = coalesce(e.customer_id, p.customer_id)
    where e.pinned_event_id = v_event.id
      and e.status = 'active'
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )
  ) x;

  select t.* into v_template
  from public.notification_templates t
  where t.type = 'event_cancelled';

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'concept_name', v_concept,
    'starts_at', v_event.starts_at,
    'booking_count', v_counts.booking_count,
    'places', private.occupied_places(v_event.id),
    'card_count', v_counts.card_count,
    'choice_count', v_counts.choice_count,
    'unbound_count', v_counts.unbound_count,
    'at_risk', v_at_risk,
    'parked', v_parked,
    'title', private.render_notification_text(v_template.title, v_vars),
    'body', private.render_notification_text(v_template.body, v_vars)
  );
end;
$$;

-- The cancel dialog's plan (AD-7): the same admin check and grant as the
-- action.
create function public.preview_admin_cancel_event(p_event_id uuid)
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

  return private.plan_admin_cancel_event(p_event_id);
end;
$$;

-- Tal cancels a published session that has not started (CAP-12, CAP-17,
-- sensitive). Order: is_admin, idempotency, p_message trimmed 1-1000
-- (INVALID_INPUT, detail message), the registrants' customer ids read
-- without a lock and their profiles locked by id, the session, its
-- confirmed bookings by id and the re-check (a confirmed booking of a
-- customer not locked: CONCURRENT_CHANGE), the allocation entitlements by
-- id, the allocation credits by id, the plan (its code is raised),
-- p_confirmed, and p_parked_acknowledged when the plan has parked
-- purchases (CONFIRM_REQUIRED; the purchases are not changed). Then status
-- cancelled (the trigger bumps
-- revision; audited), private.cancel_core(..., 'pending') per booking by
-- id, the session's credits refreshed, and one event_cancelled per distinct
-- customer (Tal's body, vars {date}, discriminator event_id:revision, to
-- /me/bookings; a place without a customer gets it at bind). Result:
-- {event_id, cancelled, card_count, choice_count (held places not counted),
-- notified}.
create function public.admin_cancel_event(
  p_event_id uuid,
  p_confirmed boolean,
  p_message text,
  p_idempotency_key uuid,
  p_parked_acknowledged boolean default false
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
  v_message text := btrim(p_message);
  v_customers uuid[];
  v_event public.events;
  v_saved public.events;
  v_plan jsonb;
  v_booking_id uuid;
  v_ids uuid[] := '{}';
  v_result jsonb;
  v_card integer := 0;
  v_choice integer := 0;
  v_customer uuid;
  v_notified integer := 0;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_cancel_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'confirmed', p_confirmed,
      'parked_acknowledged', p_parked_acknowledged,
      'message', v_message
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_message is null or char_length(v_message) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "message"}';
  end if;

  select coalesce(array_agg(distinct b.customer_id), '{}')
  into v_customers
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
    and b.customer_id is not null;

  perform 1
  from public.profiles p
  where p.id = any (v_customers)
  order by p.id
  for update;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  perform 1
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = p_event_id
      and b.status = 'confirmed'
      and b.customer_id is not null
      and not (b.customer_id = any (v_customers))
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.id in (
    select a.entitlement_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_cancel_event(p_event_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true
     or (
       jsonb_array_length(v_plan -> 'parked') > 0
       and p_parked_acknowledged is not true
     ) then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.events
  set status = 'cancelled'
  where id = v_event.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_cancel_event', 'events', v_saved.id,
    null, v_saved.id, to_jsonb(v_event), to_jsonb(v_saved)
  );

  for v_booking_id, v_customer in
    select b.id, b.customer_id
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
    order by b.id
  loop
    v_result := private.cancel_core(
      v_booking_id, v_actor, 'admin', 'admin_cancel_event', null, 'pending'
    );
    v_ids := v_ids || v_booking_id;
    if v_result ->> 'outcome' = 'card' then
      v_card := v_card + 1;
    elsif v_customer is not null then
      v_choice := v_choice + 1;
    end if;
  end loop;

  perform private.refresh_credits_for_event(v_event.id);

  -- Last in the transaction (AD-6, AD-12).
  for v_customer in
    select distinct b.customer_id
    from public.bookings b
    where b.id = any (v_ids)
      and b.customer_id is not null
    order by b.customer_id
  loop
    if private.enqueue_notification(
      v_customer,
      'event_cancelled',
      v_saved.id::text || ':' || v_saved.revision::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_saved.starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings',
      v_message
    ) is not null then
      v_notified := v_notified + 1;
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_cancel_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_saved.id,
      'cancelled', coalesce(array_length(v_ids, 1), 0),
      'card_count', v_card,
      'choice_count', v_choice,
      'notified', v_notified
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Change a session's time
-- ---------------------------------------------------------------------------

-- What moving the session to p_starts_at - p_ends_at will do (AD-7).
-- Refusals ({ok: false, code: 'INVALID_INPUT', field}): a missing session,
-- not published, or already started (field event_id); a new start that is
-- not in the future (start_time); an end not after the start (end_time);
-- nothing changed (start_time); a registration close Tal set by hand after
-- the new start (registration_closes_local). The kind never changes (it is
-- the concept's). Result: {ok, event_id, concept_name, starts_at, ends_at,
-- new_starts_at, new_ends_at, booking_count, at_risk, title, body}.
-- at_risk: every card-funded booking whose card is not valid on the new
-- day (before valid_from, after expires_on, or a weekday it does not fund):
-- {customer_id, customer_label, product_name, expires_on, reason:
-- 'not_valid_on_new_day'}. It never blocks. title and body: event_changed
-- rendered with {date} (the old DD.MM), {new_date}, {new_time}.
create function private.plan_admin_reschedule_event(
  p_event_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_concept text;
  v_new_day date;
  v_count integer;
  v_at_risk jsonb;
  v_template public.notification_templates;
  v_vars jsonb;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'event_id');
  end if;

  if p_starts_at is null or p_starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'start_time');
  end if;

  if p_ends_at is null or p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'end_time');
  end if;

  if p_starts_at = v_event.starts_at and p_ends_at = v_event.ends_at then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'start_time');
  end if;

  if v_event.registration_close_overridden
     and v_event.registration_closes_at > p_starts_at then
    return jsonb_build_object(
      'ok', false, 'code', 'INVALID_INPUT', 'field', 'registration_closes_local'
    );
  end if;

  v_new_day := (p_starts_at at time zone 'Asia/Jerusalem')::date;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select count(*)::integer into v_count
  from public.bookings b
  where b.event_id = v_event.id
    and b.status = 'confirmed';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', r.customer_id,
        'customer_label', r.customer_label,
        'product_name', r.product_name,
        'expires_on', r.expires_on,
        'reason', 'not_valid_on_new_day'
      )
      order by r.expires_on, r.booking_id
    ),
    '[]'::jsonb
  )
  into v_at_risk
  from (
    select
      b.id as booking_id,
      b.customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      e.expires_on
    from public.bookings b
    cross join lateral (select private.booking_funding(b.id) as j) f
    join public.entitlements e on e.id = (f.j ->> 'entitlement_id')::uuid
    join public.payments p on p.id = e.payment_id
    left join public.profiles pr on pr.id = b.customer_id
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and f.j ->> 'funding' = 'card'
      and (
        v_new_day < e.valid_from
        or v_new_day > e.expires_on
        or (
          e.allowed_weekdays is not null
          and not (extract(dow from v_new_day)::smallint = any (e.allowed_weekdays))
        )
      )
  ) r;

  select t.* into v_template
  from public.notification_templates t
  where t.type = 'event_changed';

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date),
    'new_date', private.format_day_month(v_new_day),
    'new_time', to_char(p_starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'concept_name', v_concept,
    'starts_at', v_event.starts_at,
    'ends_at', v_event.ends_at,
    'new_starts_at', p_starts_at,
    'new_ends_at', p_ends_at,
    'booking_count', v_count,
    'at_risk', v_at_risk,
    'title', private.render_notification_text(v_template.title, v_vars),
    'body', private.render_notification_text(v_template.body, v_vars)
  );
end;
$$;

-- The time-change dialog's plan (AD-7).
create function public.preview_admin_reschedule_event(
  p_event_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
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

  return private.plan_admin_reschedule_event(p_event_id, p_starts_at, p_ends_at);
end;
$$;

-- Tal moves a published session that has not started (CAP-12, sensitive;
-- a session is never moved silently). The locks of admin_cancel_event,
-- with the entitlements pinned to the session among the entitlements.
-- Then the plan (INVALID_INPUT with detail field), p_confirmed
-- (CONFIRM_REQUIRED), the new times (the triggers bump revision and
-- recompute the registration close unless Tal set it), every entitlement
-- pinned to the session gets expires_on = the new local day (never before
-- its valid_from; audited), the session's credits refreshed (an option
-- moved before a credit's origin is replaced), the session audited, and
-- one event_changed per distinct customer (Tal's body, vars {date, new_date,
-- new_time}, discriminator event_id:revision, to /me/bookings). The
-- reminder follows by itself (booking:revision). Result: {event_id,
-- booking_count, notified, starts_at, ends_at}.
create function public.admin_reschedule_event(
  p_event_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_confirmed boolean,
  p_message text,
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
  v_message text := btrim(p_message);
  v_customers uuid[];
  v_event public.events;
  v_saved public.events;
  v_plan jsonb;
  v_new_day date;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_customer uuid;
  v_notified integer := 0;
  v_vars jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'confirmed', p_confirmed,
      'message', v_message
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_message is null or char_length(v_message) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "message"}';
  end if;

  select coalesce(array_agg(distinct b.customer_id), '{}')
  into v_customers
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
    and b.customer_id is not null;

  perform 1
  from public.profiles p
  where p.id = any (v_customers)
  order by p.id
  for update;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  perform 1
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = p_event_id
      and b.status = 'confirmed'
      and b.customer_id is not null
      and not (b.customer_id = any (v_customers))
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.pinned_event_id = p_event_id
     or e.id in (
       select a.entitlement_id
       from public.booking_allocations a
       join public.bookings b on b.id = a.booking_id
       where b.event_id = p_event_id
         and b.status = 'confirmed'
     )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_reschedule_event(p_event_id, p_starts_at, p_ends_at);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
      detail = jsonb_build_object('field', v_plan ->> 'field')::text;
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.events
  set starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_event.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_reschedule_event', 'events', v_saved.id,
    null, v_saved.id, to_jsonb(v_event), to_jsonb(v_saved)
  );

  -- A pinned product is valid only on its session (AD-8).
  v_new_day := (v_saved.starts_at at time zone 'Asia/Jerusalem')::date;
  for v_entitlement in
    select e.*
    from public.entitlements e
    where e.pinned_event_id = v_saved.id
      and e.expires_on is distinct from greatest(v_new_day, e.valid_from)
    order by e.id
  loop
    update public.entitlements
    set expires_on = greatest(v_new_day, v_entitlement.valid_from)
    where id = v_entitlement.id
    returning * into v_entitlement_new;

    perform private.audit(
      v_actor, 'admin', 'admin_reschedule_event', 'entitlements', v_entitlement.id,
      v_entitlement.customer_id, v_saved.id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
    );
  end loop;

  perform private.refresh_credits_for_event(v_saved.id);

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date),
    'new_date', private.format_day_month(v_new_day),
    'new_time', to_char(v_saved.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
  );

  -- Last in the transaction (AD-6, AD-12).
  for v_customer in
    select distinct b.customer_id
    from public.bookings b
    where b.event_id = v_saved.id
      and b.status = 'confirmed'
      and b.customer_id is not null
    order by b.customer_id
  loop
    if private.enqueue_notification(
      v_customer,
      'event_changed',
      v_saved.id::text || ':' || v_saved.revision::text,
      v_vars,
      '/me/bookings',
      v_message
    ) is not null then
      v_notified := v_notified + 1;
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_saved.id,
      'booking_count', (v_plan ->> 'booking_count')::integer,
      'notified', v_notified,
      'starts_at', v_saved.starts_at,
      'ends_at', v_saved.ends_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. choose_credit_outcome
-- ---------------------------------------------------------------------------

-- The customer closes a business-cancel choice (AD-20, no deadline). Order:
-- the caller (private.current_customer_id, else NOT_AUTHORIZED),
-- idempotency, p_choice refund | credit (INVALID_INPUT, detail choice), her
-- profile lock, the credit lock; hers, active and choice_pending, else
-- CHOICE_NOT_PENDING. refund: the payment of its source entitlement locked,
-- the credit refund_requested (choice_pending false) with a refund request
-- of its monetary basis. credit: choice_pending false, then its options
-- fill (counted from the original cancelled session; the same options,
-- never a new cycle). Audited; no notification. Result: {credit_id,
-- outcome, refund_request_id?}.
create function public.choose_credit_outcome(
  p_credit_id uuid,
  p_choice text,
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
  v_customer uuid := (select private.current_customer_id());
  v_prev jsonb;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_payment_id uuid;
  v_refund public.refund_requests;
  v_event_id uuid;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'choose_credit_outcome', p_idempotency_key,
    jsonb_build_object('credit_id', p_credit_id, 'choice', p_choice)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_choice is null or p_choice not in ('refund', 'credit') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id
  for update;

  if v_credit.id is null
     or v_credit.customer_id is distinct from v_customer
     or v_credit.status <> 'active'
     or not v_credit.choice_pending then
    raise exception 'CHOICE_NOT_PENDING' using errcode = 'P0001';
  end if;

  select b.event_id into v_event_id
  from public.bookings b
  where b.id = private.credit_cancelled_booking(v_credit.id);

  if p_choice = 'refund' then
    select e.payment_id into v_payment_id
    from public.entitlements e
    where e.id = v_credit.source_entitlement_id;

    perform 1
    from public.payments pay
    where pay.id = v_payment_id
    for update;

    update public.cancellation_credits
    set status = 'refund_requested', choice_pending = false
    where id = v_credit.id
    returning * into v_credit_new;

    insert into public.refund_requests (
      customer_id, credit_id, payment_id, booking_id, amount_agorot
    )
    values (
      v_customer, v_credit.id, v_payment_id,
      coalesce(private.credit_cancelled_booking(v_credit.id), v_credit.origin_booking_id),
      v_credit.monetary_basis_agorot
    )
    returning * into v_refund;
  else
    update public.cancellation_credits
    set choice_pending = false
    where id = v_credit.id
    returning * into v_credit_new;
  end if;

  perform private.audit(
    v_actor, 'customer', 'choose_credit_outcome', 'cancellation_credits', v_credit.id,
    v_customer, v_event_id, to_jsonb(v_credit), to_jsonb(v_credit_new)
  );

  if v_refund.id is not null then
    perform private.audit(
      v_actor, 'customer', 'choose_credit_outcome', 'refund_requests', v_refund.id,
      v_customer, v_event_id, null, to_jsonb(v_refund)
    );
  else
    perform private.refresh_credit_options(v_credit.id);
  end if;

  return private.idempotent_finish(
    v_actor::text, 'choose_credit_outcome', p_idempotency_key,
    jsonb_strip_nulls(jsonb_build_object(
      'credit_id', v_credit.id,
      'outcome', p_choice,
      'refund_request_id', v_refund.id
    ))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reads and the bind
-- ---------------------------------------------------------------------------

-- As live after 3.5 (20261013161248: "already booked in this session" is
-- any real booking, private.is_real_booking), plus: a moved credit that is
-- choice_pending (Tal
-- cancelled the session of a held place) gets event_cancelled (the template
-- body, vars {date} of the cancelled session, discriminator
-- event_id:revision, as at the cancel) instead of booking_cancelled_pinned.
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
  -- booking_cancelled_refund for a refund request.
  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
      and c.status in ('active', 'refund_requested')
    order by c.id
  loop
    if v_credit.status = 'active' then
      perform private.refresh_credit_options(v_credit.id);
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

-- As in 20261010141240, plus choice_pending, cancelled_starts_at (the
-- start of the session whose cancel made the credit what it is now,
-- private.credit_cancelled_booking) and options_count (N, for the choice
-- sheet). A choice_pending credit has no options
-- ([]) and is neither waiting nor exhausted. Every other field unchanged.
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
            'requested_at', rr.requested_at
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
  ) x;

  return v_result;
end;
$$;

-- As in 20261010141240, plus choice_pending: every bound credit still
-- waiting for her business-cancel choice, since that cancel: {kind, id (the
-- credit), customer_label, since, customer_id, event_id, concept_name,
-- starts_at (the cancelled session), amount_agorot (its monetary basis)}.
-- It leaves the list when she chooses.
-- paid_without_place also carries event_status (cancelled: the session was
-- cancelled by the business; Tal closes a refund or credit by hand).
create or replace function public.admin_get_attention_items()
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
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: no API role executes them.
revoke execute on function private.credit_cancelled_booking(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_credit_options(uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.cancel_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_cancel_event(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_reschedule_event(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_cancel_event(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_cancel_event(uuid) to authenticated;

revoke execute on function public.admin_cancel_event(uuid, boolean, text, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_event(uuid, boolean, text, uuid, boolean) to authenticated;

revoke execute on function public.preview_admin_reschedule_event(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_reschedule_event(uuid, timestamptz, timestamptz) to authenticated;

revoke execute on function public.admin_reschedule_event(uuid, timestamptz, timestamptz, boolean, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_reschedule_event(uuid, timestamptz, timestamptz, boolean, text, uuid) to authenticated;

revoke execute on function public.choose_credit_outcome(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.choose_credit_outcome(uuid, text, uuid) to authenticated;

revoke execute on function public.get_my_credits() from public, anon, authenticated, service_role;
grant execute on function public.get_my_credits() to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
