-- Story 3.12: session completion (AD-11, AD-14). pg_cron is enabled once
-- here; later stories (5.8, 5.17) add their own cron.schedule only.
-- private.job_complete_events runs every 5 minutes: a published session whose
-- ends_at has passed becomes completed, its confirmed bookings become
-- completed, and every entitlement allocation of those bookings gets one
-- 'use' movement (units 0; the reserve is never edited). A no-show without a
-- cancellation counts as taking part (source: card, intro). A double run
-- changes nothing. private.occupied_places now sums the real bookings
-- (private.is_real_booking: confirmed or completed), so a completed
-- session keeps its occupancy for Tal; an open session has no completed
-- booking, so the capacity checks do not change. preview_book_session
-- returns the customer's booking of a completed session (EVENT_COMPLETED).

create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- One 'use' per booking and entitlement (backs the job's not-exists check)
-- ---------------------------------------------------------------------------

create unique index entitlement_movements_use_booking_entitlement_uidx
  on public.entitlement_movements (booking_id, entitlement_id)
  where action = 'use';

-- ---------------------------------------------------------------------------
-- private.occupied_places: the real bookings (AD-6)
-- ---------------------------------------------------------------------------

-- The only place that sums party_size (AD-6): the adults of the real
-- bookings of a session (private.is_real_booking: confirmed or completed),
-- including bookings without a customer (AD-23). There is no stored counter.
create or replace function private.occupied_places(p_event_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(b.party_size), 0)::integer
  from public.bookings b
  where b.event_id = p_event_id
    and private.is_real_booking(b.status);
$$;

-- ---------------------------------------------------------------------------
-- private.job_complete_events (AD-11)
-- ---------------------------------------------------------------------------

-- Every published session with ends_at <= now(), by id. Lock order (AD-6):
-- the session (for update skip locked: a session held by another
-- transaction is handled on the next run), then its confirmed bookings by
-- id, then the entitlements of their allocations by id; then the updates,
-- the use movements and one audit row per session, in the cron call's
-- transaction. An allocation from a credit (credit_id) is skipped (no
-- credits until 3.7). No notification and no push. Does not depend on the
-- cron's time: it compares with now(). Returns the number of sessions
-- completed. Called only by pg_cron (as the owner); no grant.
create function private.job_complete_events()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_event_new public.events;
  v_count integer := 0;
begin
  for v_event in
    select e.*
    from public.events e
    where e.status = 'published'
      and e.ends_at <= now()
    order by e.id
    for update skip locked
  loop
    perform 1
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
    order by b.id
    for update;

    perform 1
    from public.entitlements en
    where en.id in (
      select a.entitlement_id
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      where b.event_id = v_event.id
        and b.status = 'confirmed'
        and a.entitlement_id is not null
    )
    order by en.id
    for update;

    insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
    select distinct a.entitlement_id, b.id, 'use', 0
    from public.bookings b
    join public.booking_allocations a on a.booking_id = b.id
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and a.entitlement_id is not null
      and not exists (
        select 1
        from public.entitlement_movements m
        where m.booking_id = b.id
          and m.entitlement_id = a.entitlement_id
          and m.action = 'use'
      );

    update public.bookings
    set status = 'completed'
    where event_id = v_event.id
      and status = 'confirmed';

    update public.events
    set status = 'completed'
    where id = v_event.id
    returning * into v_event_new;

    perform private.audit(
      null, 'system', 'complete_event', 'events', v_event.id,
      null, v_event.id, to_jsonb(v_event), to_jsonb(v_event_new)
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- preview_book_session: her booking of a completed session
-- ---------------------------------------------------------------------------

-- As in 20261005232647, except that her booking (confirmed or completed) is
-- read before the status check: in a completed session with her booking it
-- returns booked: true, can_self_cancel false and the code EVENT_COMPLETED
-- (the panel shows "the session ended" and "you took part"). Every other
-- branch as before (a cancelled session, or a completed one without her
-- booking: EVENT_NOT_BOOKABLE).
create or replace function public.preview_book_session(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_event public.events;
  v_settings public.business_settings;
  v_booking public.bookings;
  v_party integer;
  v_code text;
  v_plan jsonb;
  v_source jsonb;
  v_entitlement public.entitlements;
  v_available integer;
  v_product_name text;
  v_units integer;
  v_cancel_deadline timestamptz;
  v_funding jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  select b.* into v_booking
  from public.bookings b
  where b.customer_id = v_customer
    and b.event_id = p_event_id
    and b.status in ('confirmed', 'completed')
  order by b.id
  limit 1;

  if v_event.id is not null
     and v_event.status = 'completed'
     and v_booking.id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'EVENT_COMPLETED',
      'booked', true,
      'booking_id', v_booking.id,
      'can_self_cancel', false
    );
  end if;

  if v_event.id is null or v_event.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_BOOKABLE', 'booked', false);
  end if;

  -- In a published session only a confirmed booking is hers.
  if v_booking.status is distinct from 'confirmed' then
    v_booking := null;
  end if;

  select s.* into v_settings from public.business_settings s;

  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  if now() >= v_event.registration_closes_at then
    v_code := 'REGISTRATION_CLOSED';
  elsif v_booking.id is not null then
    v_code := 'ALREADY_BOOKED';
  elsif private.occupied_places(v_event.id) + v_party > v_event.capacity_adults then
    v_code := 'EVENT_FULL';
  else
    v_plan := private.plan_funding(v_customer, v_event.id, v_party, 'self');
    if not (v_plan ->> 'ok')::boolean then
      v_code := v_plan ->> 'code';
    end if;
  end if;

  if v_booking.id is not null then
    v_funding := private.booking_funding(v_booking.id);
    return jsonb_build_object(
      'ok', false,
      'code', v_code,
      'booked', true,
      'booking_id', v_booking.id,
      'funding', v_funding ->> 'funding',
      'product_name', v_funding ->> 'product_name',
      'options_count', greatest(v_settings.credit_options_count, 1),
      'cancel_deadline', private.cancel_deadline(
        (v_booking.policy_snapshot ->> 'cancel_window_hours')::integer,
        v_event.starts_at
      ),
      'can_self_cancel', private.can_self_cancel(v_booking.id)
    );
  end if;

  v_cancel_deadline := private.cancel_deadline(v_settings.cancel_window_hours, v_event.starts_at);

  if v_code is not null then
    return jsonb_build_object(
      'ok', false,
      'code', v_code,
      'booked', false,
      'cancel_deadline', v_cancel_deadline
    );
  end if;

  v_source := v_plan -> 'sources' -> 0;
  v_units := (v_source ->> 'units')::integer;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = (v_source ->> 'id')::uuid;

  select b.available into v_available
  from public.entitlement_balances b
  where b.entitlement_id = v_entitlement.id;

  select pay.product_snapshot ->> 'name' into v_product_name
  from public.payments pay
  where pay.id = v_entitlement.payment_id;

  return jsonb_build_object(
    'ok', true,
    'booked', false,
    'product_name', v_product_name,
    'units', v_units,
    'available_after', v_available - v_units,
    'expires_on', v_entitlement.expires_on,
    'cancel_deadline', v_cancel_deadline
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.occupied_places(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.job_complete_events() from public, anon, authenticated, service_role;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule (AD-11): every 5 minutes; the frequency is only the maximum delay
-- ---------------------------------------------------------------------------

select cron.schedule('complete_events', '*/5 * * * *', 'select private.job_complete_events()');
