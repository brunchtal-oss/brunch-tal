-- Story 3.6 review fixes.
-- 1. private.returned_expiry replaces private.returned_validity (dropped in
--    the separate migration 20261006001144, run in the SQL Editor): a
--    session counts as one of the N only while its registration is open
--    (now() < registration_closes_at), so a refresh weeks later never sets
--    an expires_on in the past; and a session the entitlement already funds
--    (a confirmed booking allocated from it) counts even without room, so a
--    refresh never ends the validity before a session she booked with it
--    (full because she took the last place). It reads the entitlement's
--    kind, weekdays and party size itself.
-- 2. Its callers switch to it, with their bodies as in 20261005232647
--    otherwise: private.return_pinned_entitlement,
--    private.refresh_returned_entitlements, private.plan_admin_cancel_booking.
-- 3. public.get_my_bookings: upcoming only for a published session (home
--    had this filter before 3.6).
-- AD-5 grants for every new or replaced function.

-- The validity of a returned pinned entitlement: the local date of the
-- p_options_count-th (at least 1) session after p_after_day, by starts_at
-- and id, among the published sessions of the entitlement's
-- eligible_event_kind on its allowed weekdays (null = every day) that either
-- are still open for registration and have room for its party size, or have
-- a confirmed booking funded by this entitlement. Fewer: awaiting, with a
-- provisional far date (p_after_day + 3650). Result: {awaiting, expires_on}.
create function private.returned_expiry(
  p_entitlement_id uuid,
  p_after_day date,
  p_options_count integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_n integer := greatest(coalesce(p_options_count, 1), 1);
  v_party integer;
  v_days date[];
begin
  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_entitlement.id is null or p_after_day is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_party := case
    when jsonb_typeof(v_entitlement.eligibility_snapshot -> 'party_size') = 'number'
      then (v_entitlement.eligibility_snapshot ->> 'party_size')::integer
    when v_entitlement.eligible_event_kind = 'couple' then 2
    else 1
  end;

  select array_agg(x.day order by x.starts_at, x.id) into v_days
  from (
    select
      e.id,
      e.starts_at,
      (e.starts_at at time zone 'Asia/Jerusalem')::date as day
    from public.events e
    where e.status = 'published'
      and e.kind = v_entitlement.eligible_event_kind
      and (e.starts_at at time zone 'Asia/Jerusalem')::date > p_after_day
      and (
        v_entitlement.allowed_weekdays is null
        or extract(dow from (e.starts_at at time zone 'Asia/Jerusalem'))::smallint
           = any (v_entitlement.allowed_weekdays)
      )
      and (
        (
          now() < e.registration_closes_at
          and private.occupied_places(e.id) + v_party <= e.capacity_adults
        )
        or exists (
          select 1
          from public.bookings b
          join public.booking_allocations a on a.booking_id = b.id
          where b.event_id = e.id
            and b.status = 'confirmed'
            and a.entitlement_id = v_entitlement.id
        )
      )
    order by e.starts_at, e.id
    limit v_n
  ) x;

  if coalesce(cardinality(v_days), 0) >= v_n then
    return jsonb_build_object('awaiting', false, 'expires_on', v_days[v_n]);
  end if;

  return jsonb_build_object('awaiting', true, 'expires_on', p_after_day + 3650);
end;
$$;

-- As in 20261005232647, with private.returned_expiry.
create or replace function private.return_pinned_entitlement(
  p_entitlement_id uuid,
  p_event_day date,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_reason text
)
returns public.entitlements
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old public.entitlements;
  v_new public.entitlements;
  v_n integer;
  v_validity jsonb;
begin
  select e.* into v_old
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_old.id is null or v_old.pinned_event_id is null or p_event_day is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;

  v_validity := private.returned_expiry(v_old.id, p_event_day, v_n);

  update public.entitlements
  set pinned_event_id = null,
      valid_from = p_event_day + 1,
      expires_on = (v_validity ->> 'expires_on')::date,
      eligibility_snapshot = eligibility_snapshot || jsonb_build_object(
        'validity_mode', 'days',
        'awaiting_sessions', (v_validity ->> 'awaiting')::boolean,
        'returned_from_event_id', v_old.pinned_event_id,
        'returned_after', p_event_day,
        'options_count', v_n
      )
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'entitlements', v_new.id,
    v_new.customer_id, v_old.pinned_event_id, to_jsonb(v_old), to_jsonb(v_new), p_reason
  );

  return v_new;
end;
$$;

-- As in 20261005232647, with private.returned_expiry.
create or replace function private.refresh_returned_entitlements()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old public.entitlements;
  v_new public.entitlements;
  v_validity jsonb;
  v_count integer := 0;
begin
  for v_old in
    select e.*
    from public.entitlements e
    where (e.eligibility_snapshot ->> 'awaiting_sessions') = 'true'
      and e.status = 'active'
    order by e.id
    for update
  loop
    if jsonb_typeof(v_old.eligibility_snapshot -> 'returned_after') is distinct from 'string' then
      continue;
    end if;

    v_validity := private.returned_expiry(
      v_old.id,
      (v_old.eligibility_snapshot ->> 'returned_after')::date,
      (v_old.eligibility_snapshot ->> 'options_count')::integer
    );

    if not (v_validity ->> 'awaiting')::boolean then
      update public.entitlements
      set expires_on = (v_validity ->> 'expires_on')::date,
          eligibility_snapshot = eligibility_snapshot
            || jsonb_build_object('awaiting_sessions', false)
      where id = v_old.id
      returning * into v_new;

      perform private.audit(
        null, 'system', 'refresh_returned_entitlements', 'entitlements', v_new.id,
        v_new.customer_id,
        (v_old.eligibility_snapshot ->> 'returned_from_event_id')::uuid,
        to_jsonb(v_old), to_jsonb(v_new)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- As in 20261005232647, with private.returned_expiry.
create or replace function private.plan_admin_cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event public.events;
  v_concept text;
  v_name text;
  v_funding jsonb;
  v_entitlement public.entitlements;
  v_n integer;
  v_validity jsonb;
  v_expires_on date;
  v_awaiting boolean := false;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CANCELLABLE');
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;

  if v_event.ends_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_ENDED');
  end if;

  if private.needs_manual_cancel(v_booking.id) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select p.full_name into v_name
  from public.profiles p
  where p.id = v_booking.customer_id
    and p.activated_at is not null
    and p.anonymized_at is null;

  v_funding := private.booking_funding(v_booking.id);

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = (v_funding ->> 'entitlement_id')::uuid;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;
  v_expires_on := v_entitlement.expires_on;

  if v_funding ->> 'funding' = 'pinned' then
    v_validity := private.returned_expiry(
      v_entitlement.id,
      (v_event.starts_at at time zone 'Asia/Jerusalem')::date,
      v_n
    );
    v_awaiting := (v_validity ->> 'awaiting')::boolean;
    v_expires_on := (v_validity ->> 'expires_on')::date;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'event_id', v_event.id,
    'starts_at', v_event.starts_at,
    'concept_name', v_concept,
    'pending_join', v_booking.customer_id is null,
    'customer_name', v_name,
    'outcome', case when v_funding ->> 'funding' = 'pinned' then 'pinned' else 'card' end,
    'funding', v_funding ->> 'funding',
    'product_name', v_funding ->> 'product_name',
    'within_window', not private.can_self_cancel(v_booking.id),
    'expires_on', v_expires_on,
    'awaiting_sessions', v_awaiting,
    'options_count', v_n
  ));
end;
$$;

-- As in 20261005232647, plus e.status = 'published' for upcoming.
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
        'product_name', f.info ->> 'product_name'
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
        'product_name', f.info ->> 'product_name'
      ) as row
    from public.bookings b
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join lateral (select private.booking_funding(b.id) as info) f on true
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
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.returned_expiry(uuid, date, integer) from public, anon, authenticated, service_role;
revoke execute on function private.return_pinned_entitlement(uuid, date, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_returned_entitlements() from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_cancel_booking(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.get_my_bookings() from public, anon, authenticated, service_role;
grant execute on function public.get_my_bookings() to authenticated;
