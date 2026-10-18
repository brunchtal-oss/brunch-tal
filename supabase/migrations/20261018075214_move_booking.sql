-- Story 3.10, part 2 of 2: moving a booking (source section 6, AD-6, AD-7,
-- AD-12, AD-13, AD-18). Runs after 20261018075210_booking_moved_type.sql
-- (the template row and bookings.moved_to_booking_id).
--
-- A move is a cancel plus a new booking in one transaction: the target's
-- place and the original's source are checked first (private.plan_move),
-- any failure raises and nothing changes. The target is funded from the
-- original's source, never a new one, so private.plan_funding is not
-- called and stays unchanged (3.19 calls it in admin mode).
--
-- 1. Redefined (re-based on the live DB on 2026-10-18, md5 of prosrc):
--    private.cancel_core (20261013162639) and private.book_core
--    (20261010184900) send no notification for the actions move_booking /
--    admin_move_booking (same signatures); public.get_my_bookings
--    (20261013161248): past rows add moved_to_starts_at.
-- 2. Helpers: private.move_option_candidates, private.move_card_code,
--    private.move_target_code, private.plan_move, private.lock_move,
--    private.move_core.
-- 3. RPCs: preview_move_booking, preview_admin_move_booking, move_booking,
--    admin_move_booking (sensitive, CONFIRM_REQUIRED).
--
-- Reminders (5.17) need no change: private.job_reminders derives them per
-- booking, so the new booking gets its own, and a booking confirmed inside
-- the lead window gets none (booking_moved carries the date and time).

-- ---------------------------------------------------------------------------
-- 1. Redefinitions
-- ---------------------------------------------------------------------------

-- As in 20261013162639, plus: no booking_cancelled* notification for a
-- move (p_action move_booking / admin_move_booking; its caller sends
-- booking_moved).
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
  -- The business mode sends nothing here (the caller sends event_cancelled),
  -- nor a move (the caller sends booking_moved).
  if not v_pending and p_action not in ('move_booking', 'admin_move_booking') then
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

-- As in 20261010184900, plus: no booking confirmation for a move (the
-- caller sends booking_moved).
create or replace function private.book_core(
  p_customer_id uuid,
  p_payment_id uuid,
  p_event_id uuid,
  p_party_size integer,
  p_sources jsonb,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text
)
returns public.bookings
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_event public.events;
  v_settings public.business_settings;
  v_booking public.bookings;
  v_source jsonb;
  v_units integer;
  v_available integer;
  v_credit public.cancellation_credits;
begin
  if (p_customer_id is null and p_payment_id is null)
     or p_party_size is null or p_party_size not in (1, 2)
     or p_sources is null or jsonb_typeof(p_sources) <> 'array'
     or jsonb_array_length(p_sources) = 0
     or p_actor_kind is null or p_actor_kind not in ('customer', 'admin', 'system')
     or p_action is null or btrim(p_action) = '' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if private.occupied_places(v_event.id) + p_party_size > v_event.capacity_adults then
    raise exception 'EVENT_FULL' using errcode = 'P0001';
  end if;

  select s.* into v_settings from public.business_settings s;

  insert into public.bookings (
    customer_id, payment_id, event_id, party_size, status, booked_by,
    confirmed_at, policy_snapshot
  )
  values (
    p_customer_id, p_payment_id, v_event.id, p_party_size, 'confirmed',
    p_actor_kind, now(),
    jsonb_build_object(
      'cancel_window_hours', v_settings.cancel_window_hours,
      'reminder_lead_hours', v_settings.reminder_lead_hours
    )
  )
  returning * into v_booking;

  for v_source in select s.value from jsonb_array_elements(p_sources) s loop
    -- Null-safe: a missing units or id is INVALID_INPUT, never a raw error.
    if v_source ->> 'kind' is null
       or v_source ->> 'kind' not in ('entitlement', 'credit')
       or jsonb_typeof(v_source -> 'units') is distinct from 'number'
       or jsonb_typeof(v_source -> 'id') is distinct from 'string'
       or (v_source ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_source ->> 'units') !~ '^[0-9]{1,9}$' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
    v_units := (v_source ->> 'units')::integer;

    if v_source ->> 'kind' = 'credit' then
      select c.* into v_credit
      from public.cancellation_credits c
      where c.id = (v_source ->> 'id')::uuid;

      if v_units <> 1
         or v_credit.id is null
         or p_customer_id is null
         or v_credit.customer_id is distinct from p_customer_id
         or v_credit.status <> 'active'
         or v_credit.choice_pending
         or v_credit.party_size <> p_party_size
         or exists (
           select 1
           from public.booking_allocations a
           join public.bookings b on b.id = a.booking_id
           where a.credit_id = v_credit.id
             and b.status = 'confirmed'
         )
         or not (
           exists (
             select 1
             from public.credit_options o
             where o.credit_id = v_credit.id
               and o.event_id = v_event.id
               and o.state = 'active'
           )
           or exists (
             select 1
             from public.bookings ob
             where ob.id = v_credit.origin_booking_id
               and ob.event_id = v_event.id
           )
         ) then
        raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
      end if;

      insert into public.booking_allocations (booking_id, credit_id, units)
      values (v_booking.id, v_credit.id, 1);

      -- An option becomes used; the origin session has no option row.
      update public.credit_options
      set state = 'used'
      where credit_id = v_credit.id
        and event_id = v_event.id
        and state = 'active';
    else
      select b.available into v_available
      from public.entitlement_balances b
      where b.entitlement_id = (v_source ->> 'id')::uuid;

      if v_available is null or v_units < 1 or v_available < v_units then
        raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
      end if;

      insert into public.booking_allocations (booking_id, entitlement_id, units)
      values (v_booking.id, (v_source ->> 'id')::uuid, v_units);

      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values ((v_source ->> 'id')::uuid, v_booking.id, 'reserve', -v_units, p_actor_id);
    end if;
  end loop;

  -- The places changed: options in this session that became full (or that
  -- she just booked otherwise) move on; no option is added here, only on
  -- the owner's paths (other customers' credits skip locked).
  perform private.refresh_credits_for_event(v_event.id);

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    p_customer_id, v_event.id, null, to_jsonb(v_booking)
  );

  -- Last in the transaction (AD-6, AD-12). A move sends booking_moved
  -- instead (its caller).
  if p_action not in ('move_booking', 'admin_move_booking') then
    perform private.notify_booking_confirmed(v_booking);
  end if;

  return v_booking;
end;
$$;

-- As in 20261013161248, plus per past booking moved_to_starts_at: the
-- session a moved booking went to (null for any other booking).
create or replace function public.get_my_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_n integer;
  v_upcoming jsonb;
  v_past jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;

  v_customer := private.current_customer_id();
  if v_customer is null then
    return jsonb_build_object('upcoming', '[]'::jsonb, 'past', '[]'::jsonb, 'options_count', v_n);
  end if;

  select coalesce(jsonb_agg(x.row order by x.starts_at, x.id), '[]'::jsonb)
  into v_upcoming
  from (
    select
      b.id,
      e.starts_at,
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', e.id,
        'status', b.status,
        'starts_at', e.starts_at,
        'concept_name', c.name,
        'party_size', b.party_size,
        'cancelled_at', b.cancelled_at,
        'can_self_cancel', private.can_self_cancel(b.id),
        'funding', f.info ->> 'funding',
        'product_name', f.info ->> 'product_name',
        'guest_details', b.guest_details,
        'guest_details_editable', (b.status = 'confirmed' and b.party_size = 2 and now() < e.registration_closes_at)
      ) as row
    from public.bookings b
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join lateral (select private.booking_funding(b.id) as info) f on true
    where b.customer_id = v_customer
      and b.status = 'confirmed'
      and e.status = 'published'
      and e.starts_at > now()
  ) x;

  select coalesce(jsonb_agg(x.row order by x.starts_at desc, x.id desc), '[]'::jsonb)
  into v_past
  from (
    select
      b.id,
      e.starts_at,
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', e.id,
        'status', b.status,
        'starts_at', e.starts_at,
        'concept_name', c.name,
        'party_size', b.party_size,
        'cancelled_at', b.cancelled_at,
        'can_self_cancel', false,
        'funding', f.info ->> 'funding',
        'product_name', f.info ->> 'product_name',
        'guest_details', b.guest_details,
        'guest_details_editable', (b.status = 'confirmed' and b.party_size = 2 and now() < e.registration_closes_at),
        'moved_to_starts_at', me.starts_at
      ) as row
    from public.bookings b
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join lateral (select private.booking_funding(b.id) as info) f on true
    left join public.bookings mb on mb.id = b.moved_to_booking_id
    left join public.events me on me.id = mb.event_id
    where b.customer_id = v_customer
      and (
        b.status in ('cancelled', 'completed')
        or (b.status = 'confirmed' and e.starts_at <= now())
      )
    order by e.starts_at desc, b.id desc
    limit 50
  ) x;

  return jsonb_build_object('upcoming', v_upcoming, 'past', v_past, 'options_count', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The sessions that will be active options of the credit a move funds the
-- target from, as they will be right after the cancel (pinned and
-- credit-funded bookings; empty for a card). Simulates
-- private.refresh_credit_options on the state after cancel_core:
-- pinned: a new credit counted from the original session (rule (2), the
-- first N of business_settings.credit_options_count); credit: the same
-- credit, its used option (the original session) active again, then rule
-- (1) on every active option and rule (2) up to its options_count. The
-- original session is never in the result (a move never targets it).
create function private.move_option_candidates(p_booking_id uuid)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event public.events;
  v_funding jsonb;
  v_credit public.cancellation_credits;
  v_n integer;
  v_origin_event uuid;
  v_keep uuid[] := '{}'::uuid[];
  v_fill uuid[];
  v_counted integer := 0;
  v_option record;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null then
    return '{}'::uuid[];
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;

  v_funding := private.booking_funding(v_booking.id);

  if v_funding ->> 'funding' = 'pinned' then
    select greatest(s.credit_options_count, 1) into v_n
    from public.business_settings s;

    select coalesce(array_agg(x.id order by x.starts_at, x.id), '{}'::uuid[])
    into v_keep
    from (
      select e.id, e.starts_at
      from public.events e
      where e.status = 'published'
        and e.kind = v_event.kind
        and e.starts_at > v_event.starts_at
        and now() < e.registration_closes_at
        and private.occupied_places(e.id) + v_booking.party_size <= e.capacity_adults
        and e.id <> v_event.id
        and not exists (
          select 1
          from public.bookings b
          where b.customer_id = v_booking.customer_id
            and b.event_id = e.id
            and b.status = 'confirmed'
        )
      order by e.starts_at, e.id
      limit v_n
    ) x;

    return v_keep;
  end if;

  if v_funding ->> 'funding' is distinct from 'credit' then
    return '{}'::uuid[];
  end if;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = (v_funding ->> 'credit_id')::uuid;

  if v_credit.id is null then
    return '{}'::uuid[];
  end if;

  -- Rule (1), as after the cancel.
  for v_option in
    select
      o.state,
      e.id as event_id,
      e.status as event_status,
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults
    from public.credit_options o
    join public.events e on e.id = o.event_id
    where o.credit_id = v_credit.id
    order by e.starts_at, e.id
  loop
    if v_option.state = 'passed'
       or (v_option.state = 'used' and v_option.event_id <> v_event.id) then
      v_counted := v_counted + 1;
    elsif v_option.state = 'active'
       or (v_option.state = 'used' and v_option.event_id = v_event.id) then
      if v_option.event_status = 'cancelled'
         or v_option.starts_at <= v_credit.origin_starts_at then
        null;
      elsif exists (
        select 1
        from public.bookings b
        where b.customer_id = v_booking.customer_id
          and b.event_id = v_option.event_id
          and b.status = 'confirmed'
          and b.id <> v_booking.id
      ) then
        null;
      elsif v_option.event_status = 'completed'
         or now() >= v_option.registration_closes_at then
        v_counted := v_counted + 1;
      elsif private.occupied_places(v_option.event_id)
            - (case when v_option.event_id = v_event.id then v_booking.party_size else 0 end)
            + v_credit.party_size > v_option.capacity_adults then
        null;
      else
        v_counted := v_counted + 1;
        v_keep := v_keep || v_option.event_id;
      end if;
    end if;
  end loop;

  -- Rule (2).
  if v_counted < v_credit.options_count then
    select b.event_id into v_origin_event
    from public.bookings b
    where b.id = v_credit.origin_booking_id;

    select coalesce(array_agg(x.id order by x.starts_at, x.id), '{}'::uuid[])
    into v_fill
    from (
      select e.id, e.starts_at
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
          where b.customer_id = v_booking.customer_id
            and b.event_id = e.id
            and b.status = 'confirmed'
            and b.id <> v_booking.id
        )
      order by e.starts_at, e.id
      limit v_credit.options_count - v_counted
    ) x;

    v_keep := v_keep || v_fill;
  end if;

  return array_remove(v_keep, v_event.id);
end;
$$;

-- Whether the card entitlement(s) of a card-funded booking fit the target,
-- as plan_funding step (2) without the balance (the booking's own reserve
-- comes back on the cancel): active, not pinned, of the session's kind, on
-- its weekday, no card for a couple session, valid_from <= day <= expires_on
-- (expires_on already includes any extension). Null when every one fits;
-- otherwise NO_MATCHING_ENTITLEMENT, or ENTITLEMENT_EXPIRED_ON_DATE when
-- only the date fails.
create function private.move_card_code(p_booking_id uuid, p_target_event_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_day date;
  v_weekday smallint;
  v_rules boolean;
  v_dates boolean;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_target_event_id;

  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;
  v_weekday := extract(dow from v_day)::smallint;

  select
    coalesce(bool_and(
      e.status = 'active'
      and e.pinned_event_id is null
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and not (e.kind = 'card' and v_event.kind = 'couple')
    ), false),
    coalesce(bool_and(e.valid_from <= v_day and v_day <= e.expires_on), false)
  into v_rules, v_dates
  from public.booking_allocations a
  join public.entitlements e on e.id = a.entitlement_id
  where a.booking_id = p_booking_id;

  if not v_rules then
    return 'NO_MATCHING_ENTITLEMENT';
  end if;
  if not v_dates then
    return 'ENTITLEMENT_EXPIRED_ON_DATE';
  end if;
  return null;
end;
$$;

-- Why the booking cannot move to this session, or null. In order: not a
-- published session of the original session's kind, or the original
-- session itself (MOVE_TARGET_NOT_ALLOWED); the customer: its registration
-- closed (REGISTRATION_CLOSED), Tal: it ended (EVENT_ENDED); she has a real
-- booking there (ALREADY_BOOKED); no room for the party (EVENT_FULL); then
-- the funding: a card's fit (private.move_card_code); a pinned or
-- credit-funded booking, the customer only: one of p_candidates
-- (MOVE_TARGET_NOT_ALLOWED).
create function private.move_target_code(
  p_booking public.bookings,
  p_funding text,
  p_candidates uuid[],
  p_target_event_id uuid,
  p_actor_kind text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_original public.events;
  v_target public.events;
begin
  select e.* into v_original
  from public.events e
  where e.id = p_booking.event_id;

  select e.* into v_target
  from public.events e
  where e.id = p_target_event_id;

  if v_target.id is null
     or v_target.status <> 'published'
     or v_target.kind <> v_original.kind
     or v_target.id = v_original.id then
    return 'MOVE_TARGET_NOT_ALLOWED';
  end if;

  if p_actor_kind = 'customer' then
    if clock_timestamp() >= v_target.registration_closes_at then
      return 'REGISTRATION_CLOSED';
    end if;
  elsif v_target.ends_at <= clock_timestamp() then
    return 'EVENT_ENDED';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.customer_id = p_booking.customer_id
      and b.event_id = v_target.id
      and private.is_real_booking(b.status)
  ) then
    return 'ALREADY_BOOKED';
  end if;

  if private.occupied_places(v_target.id) + p_booking.party_size > v_target.capacity_adults then
    return 'EVENT_FULL';
  end if;

  if p_funding = 'card' then
    return private.move_card_code(p_booking.id, v_target.id);
  end if;

  if p_actor_kind = 'customer'
     and not (v_target.id = any (coalesce(p_candidates, '{}'::uuid[]))) then
    return 'MOVE_TARGET_NOT_ALLOWED';
  end if;

  return null;
end;
$$;

-- What a move will do (AD-7: the previews and both actions run this one
-- plan). p_actor_kind: 'customer' or 'admin'. Refusals: a booking that is
-- missing, not confirmed or without a customer (BOOKING_NOT_MOVABLE); its
-- session ended (EVENT_ENDED); more than one kind of entitlement
-- (MANUAL_HANDLING_REQUIRED); then, with a target, private.move_target_code.
-- The customer's self-cancel window is checked by the callers
-- (private.can_self_cancel). Result: {ok, code} or {ok, booking_id,
-- event_id, starts_at, concept_name, party_size, funding
-- ('card'|'pinned'|'credit'), product_name} plus, without a target,
-- targets: [{event_id, starts_at, concept_name, outside_options}] (by
-- starts_at, at most 60), with a target, target_event_id and
-- outside_options (Tal: the target is not one of the credit's options and
-- gets one at the move).
create function private.plan_move(
  p_booking_id uuid,
  p_target_event_id uuid,
  p_actor_kind text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event public.events;
  v_concept text;
  v_info jsonb;
  v_funding text;
  v_candidates uuid[];
  v_code text;
  v_target record;
  v_targets jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_actor_kind is null or p_actor_kind not in ('customer', 'admin') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null
     or v_booking.status <> 'confirmed'
     or v_booking.customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_MOVABLE');
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;

  if v_event.ends_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_ENDED');
  end if;

  if private.needs_manual_cancel(v_booking.id) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  v_info := private.booking_funding(v_booking.id);
  v_funding := coalesce(v_info ->> 'funding', 'card');
  v_candidates := private.move_option_candidates(v_booking.id);

  v_result := jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'event_id', v_event.id,
    'starts_at', v_event.starts_at,
    'concept_name', v_concept,
    'party_size', v_booking.party_size,
    'funding', v_funding,
    'product_name', v_info ->> 'product_name'
  );

  if p_target_event_id is not null then
    v_code := private.move_target_code(
      v_booking, v_funding, v_candidates, p_target_event_id, p_actor_kind
    );
    if v_code is not null then
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
    return v_result || jsonb_build_object(
      'target_event_id', p_target_event_id,
      'outside_options',
      v_funding <> 'card' and not (p_target_event_id = any (v_candidates))
    );
  end if;

  for v_target in
    select e.id, e.starts_at, c.name as concept_name
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.kind = v_event.kind
      and e.id <> v_event.id
      and (
        (p_actor_kind = 'customer' and clock_timestamp() < e.registration_closes_at)
        or (p_actor_kind = 'admin' and e.ends_at > clock_timestamp())
      )
    order by e.starts_at, e.id
  loop
    exit when jsonb_array_length(v_targets) >= 60;
    if private.move_target_code(
         v_booking, v_funding, v_candidates, v_target.id, p_actor_kind
       ) is null then
      v_targets := v_targets || jsonb_build_array(jsonb_build_object(
        'event_id', v_target.id,
        'starts_at', v_target.starts_at,
        'concept_name', v_target.concept_name,
        'outside_options',
        v_funding <> 'card' and not (v_target.id = any (v_candidates))
      ));
    end if;
  end loop;

  return v_result || jsonb_build_object('targets', v_targets);
end;
$$;

-- The move's locks after the customer's profile (AD-6): both sessions by id
-- ascending, the booking re-read and locked (changed -> CONCURRENT_CHANGE),
-- the entitlements of its allocations by id, then its credits by id. A
-- missing target locks only the original session (the plan refuses it).
create function private.lock_move(p_booking public.bookings, p_target_event_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_locked public.bookings;
begin
  perform 1
  from public.events e
  where e.id in (p_booking.event_id, p_target_event_id)
  order by e.id
  for update;

  select b.* into v_locked
  from public.bookings b
  where b.id = p_booking.id
  for update;

  if v_locked is distinct from p_booking then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.id in (
    select a.entitlement_id
    from public.booking_allocations a
    where a.booking_id = p_booking.id
  )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    where a.booking_id = p_booking.id
  )
  order by c.id
  for update;
end;
$$;

-- The move itself, after the locks and the plan (source section 6): the
-- cancel and the new booking in this one transaction, the target funded
-- from the original's source. card: the same entitlement(s) and units.
-- pinned: cancel_core with choice 'credit', then the new credit. credit:
-- the same credit. For a credit: when the target is neither an active
-- option nor the credit's origin session, the customer is refused
-- (MOVE_TARGET_NOT_ALLOWED, a safety net behind the plan) and for Tal the
-- option is added (or made active again) and audited. Then book_core; the
-- new booking takes the original's policy_snapshot and guest_details; the
-- original gets moved_to_booking_id (audited); one booking_moved
-- (discriminator: the new booking id). cancel_core and book_core send
-- nothing for the move actions. Result: {booking_id, from_booking_id}.
create function private.move_core(
  p_booking_id uuid,
  p_target_event_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_cancelled public.bookings;
  v_moved public.bookings;
  v_new public.bookings;
  v_from public.events;
  v_target public.events;
  v_concept text;
  v_funding text;
  v_sources jsonb;
  v_cancel jsonb;
  v_credit_id uuid;
  v_origin_event uuid;
  v_option_before public.credit_options;
  v_option public.credit_options;
begin
  if p_action is null or p_action not in ('move_booking', 'admin_move_booking') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  select e.* into v_from from public.events e where e.id = v_booking.event_id;

  v_funding := coalesce(private.booking_funding(v_booking.id) ->> 'funding', 'card');

  if v_funding = 'card' then
    select jsonb_agg(
      jsonb_build_object('kind', 'entitlement', 'id', a.entitlement_id, 'units', a.units)
      order by a.id
    )
    into v_sources
    from public.booking_allocations a
    where a.booking_id = v_booking.id;
  elsif v_funding = 'credit' then
    select a.credit_id into v_credit_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
      and a.credit_id is not null
    order by a.id
    limit 1;
  end if;

  v_cancel := private.cancel_core(
    v_booking.id, p_actor_id, p_actor_kind, p_action, p_reason,
    case when v_funding = 'pinned' then 'credit' end
  );

  if v_funding = 'pinned' then
    v_credit_id := (v_cancel ->> 'credit_id')::uuid;
  end if;

  if v_funding <> 'card' then
    v_sources := jsonb_build_array(
      jsonb_build_object('kind', 'credit', 'id', v_credit_id, 'units', 1)
    );

    select b.event_id into v_origin_event
    from public.cancellation_credits c
    join public.bookings b on b.id = c.origin_booking_id
    where c.id = v_credit_id;

    if p_target_event_id is distinct from v_origin_event
       and not exists (
         select 1
         from public.credit_options o
         where o.credit_id = v_credit_id
           and o.event_id = p_target_event_id
           and o.state = 'active'
       ) then
      if p_actor_kind = 'customer' then
        raise exception 'MOVE_TARGET_NOT_ALLOWED' using errcode = 'P0001';
      end if;

      select o.* into v_option_before
      from public.credit_options o
      where o.credit_id = v_credit_id
        and o.event_id = p_target_event_id
      for update;

      insert into public.credit_options (credit_id, event_id)
      values (v_credit_id, p_target_event_id)
      on conflict (credit_id, event_id) do update
        set state = 'active', replaced_at = null, replaced_reason = null
      returning * into v_option;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'credit_options', v_option.id,
        v_booking.customer_id, p_target_event_id,
        case when v_option_before.id is not null then to_jsonb(v_option_before) end,
        to_jsonb(v_option), p_reason
      );
    end if;
  end if;

  v_new := private.book_core(
    v_booking.customer_id, null, p_target_event_id, v_booking.party_size,
    v_sources, p_actor_id, p_actor_kind, p_action
  );

  update public.bookings
  set policy_snapshot = v_booking.policy_snapshot,
      guest_details = v_booking.guest_details
  where id = v_new.id
  returning * into v_new;

  select b.* into v_cancelled
  from public.bookings b
  where b.id = v_booking.id;

  update public.bookings
  set moved_to_booking_id = v_new.id
  where id = v_booking.id
  returning * into v_moved;

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    v_booking.customer_id, v_booking.event_id, to_jsonb(v_cancelled), to_jsonb(v_moved), p_reason
  );

  select e.* into v_target from public.events e where e.id = v_new.event_id;
  select c.name into v_concept from public.concepts c where c.id = v_target.concept_id;

  -- Last in the transaction (AD-6, AD-12).
  perform private.enqueue_notification(
    v_new.customer_id,
    'booking_moved',
    v_new.id::text,
    jsonb_build_object(
      'from_date', private.format_day_month((v_from.starts_at at time zone 'Asia/Jerusalem')::date),
      'date', private.format_day_month((v_target.starts_at at time zone 'Asia/Jerusalem')::date),
      'time', to_char(v_target.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      'concept', v_concept
    ),
    '/me/sessions/' || v_target.id::text
  );

  return jsonb_build_object('booking_id', v_new.id, 'from_booking_id', v_booking.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- The customer's move sheet: her own booking (else BOOKING_NOT_MOVABLE),
-- her credits refreshed first (the owner's path), then private.plan_move
-- without a target. Result: {ok, code} or the plan plus can_move
-- (private.can_self_cancel: the button knows whether it may open the
-- sheet). Exempt from idempotency (a preview, AD-5).
create function public.preview_move_booking(p_booking_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_plan jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and b.customer_id = v_customer
  ) then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_MOVABLE');
  end if;

  perform private.refresh_customer_credits(v_customer);

  v_plan := private.plan_move(p_booking_id, null, 'customer');
  if not (v_plan ->> 'ok')::boolean then
    return v_plan;
  end if;

  return v_plan || jsonb_build_object(
    'can_move', private.can_self_cancel(p_booking_id)
  );
end;
$$;

-- Tal's move dialog: private.plan_move without a target, plus the
-- customer's name (an active customer only) and within_window (she can no
-- longer move it by herself). Exempt from idempotency (a preview, AD-5).
create function public.preview_admin_move_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_name text;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_plan := private.plan_move(p_booking_id, null, 'admin');
  if not (v_plan ->> 'ok')::boolean then
    return v_plan;
  end if;

  select p.full_name into v_name
  from public.bookings b
  join public.profiles p on p.id = b.customer_id
  where b.id = p_booking_id
    and p.activated_at is not null
    and p.anonymized_at is null;

  return v_plan || jsonb_strip_nulls(jsonb_build_object(
    'customer_name', v_name,
    'within_window', not private.can_self_cancel(p_booking_id)
  ));
end;
$$;

-- A signed-in customer moves her own confirmed booking (source section 6),
-- only while she could cancel it herself. Order: current_customer_id
-- (NOT_AUTHORIZED), idempotency, a missing target (INVALID_INPUT, detail
-- target), her profile lock, the booking read without a lock (not hers,
-- missing or not confirmed -> BOOKING_NOT_MOVABLE), private.lock_move,
-- private.can_self_cancel (SELF_CANCEL_CLOSED), her credits refreshed,
-- private.plan_move (its code is raised), private.move_core. Result:
-- {booking_id, from_booking_id}.
create function public.move_booking(
  p_booking_id uuid,
  p_target_event_id uuid,
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
  v_booking public.bookings;
  v_plan jsonb;
  v_result jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'move_booking', p_idempotency_key,
    jsonb_build_object('booking_id', p_booking_id, 'target_event_id', p_target_event_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_target_event_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "target"}';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.customer_id = v_customer;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_MOVABLE' using errcode = 'P0001';
  end if;

  perform private.lock_move(v_booking, p_target_event_id);

  if not private.can_self_cancel(v_booking.id) then
    raise exception 'SELF_CANCEL_CLOSED' using errcode = 'P0001';
  end if;

  perform private.refresh_customer_credits(v_customer);

  v_plan := private.plan_move(v_booking.id, p_target_event_id, 'customer');
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  v_result := private.move_core(
    v_booking.id, p_target_event_id, v_actor, 'customer', 'move_booking', null
  );

  return private.idempotent_finish(
    v_actor::text, 'move_booking', p_idempotency_key, v_result
  );
end;
$$;

-- Tal moves a confirmed booking (sensitive, any time until its session
-- ends, also inside the window; a pinned or credit-funded booking to any
-- matching session, user decision 2026-10-18). Order: is_admin, idempotency,
-- the reason (optional, at most 2000) and a missing target (INVALID_INPUT),
-- the customer read without a lock (none -> BOOKING_NOT_MOVABLE) and her
-- profile locked, the booking read (missing or not confirmed ->
-- BOOKING_NOT_MOVABLE; another customer -> CONCURRENT_CHANGE),
-- private.lock_move, her credits refreshed, private.plan_move (its code is
-- raised), p_confirmed (CONFIRM_REQUIRED), private.move_core with the
-- reason. Result: {booking_id, from_booking_id}.
create function public.admin_move_booking(
  p_booking_id uuid,
  p_target_event_id uuid,
  p_confirmed boolean,
  p_idempotency_key uuid,
  p_reason text default null
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
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_booking public.bookings;
  v_plan jsonb;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_move_booking', p_idempotency_key,
    jsonb_build_object(
      'booking_id', p_booking_id,
      'target_event_id', p_target_event_id,
      'confirmed', p_confirmed,
      'reason', v_reason
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  if p_target_event_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "target"}';
  end if;

  select b.customer_id into v_customer
  from public.bookings b
  where b.id = p_booking_id;

  if v_customer is null then
    raise exception 'BOOKING_NOT_MOVABLE' using errcode = 'P0001';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_MOVABLE' using errcode = 'P0001';
  end if;

  if v_booking.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform private.lock_move(v_booking, p_target_event_id);

  perform private.refresh_customer_credits(v_customer);

  v_plan := private.plan_move(v_booking.id, p_target_event_id, 'admin');
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_result := private.move_core(
    v_booking.id, p_target_event_id, v_actor, 'admin', 'admin_move_booking', v_reason
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_move_booking', p_idempotency_key, v_result
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.cancel_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.get_my_bookings() from public, anon, authenticated, service_role;
grant execute on function public.get_my_bookings() to authenticated;

revoke execute on function private.move_option_candidates(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.move_card_code(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.move_target_code(public.bookings, text, uuid[], uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_move(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.lock_move(public.bookings, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.move_core(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.preview_move_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_move_booking(uuid) to authenticated;

revoke execute on function public.preview_admin_move_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_move_booking(uuid) to authenticated;

revoke execute on function public.move_booking(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.move_booking(uuid, uuid, uuid) to authenticated;

revoke execute on function public.admin_move_booking(uuid, uuid, boolean, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_move_booking(uuid, uuid, boolean, uuid, text) to authenticated;
