-- Story 3.4: session details and manual booking (CAP-12, CAP-14).
-- 1. public.admin_get_event_details: the session page and the session-
--    morning view. The session with its occupied places
--    (private.occupied_places, the only sum of party_size, AD-6) and the
--    real bookings (private.is_real_booking) by confirmed_at. Name, phone,
--    dietary notes and babies only for an active customer whose details
--    were not removed; a booking without a customer (a pinned purchase not
--    bound yet, AD-23) has pending_join and the payment's payer_label.
-- 2. public.admin_book_customer: Tal books a customer, also after the
--    registration close and until the session ends (user decision
--    2026-10-05). Same funding (private.plan_funding 'admin') and capacity
--    checks; the booking is written by private.book_core only.
-- 3. public.preview_admin_book_customer: the same checks, no lock, no write.
-- private.book_core, private.plan_funding, private.occupied_places and
-- private.is_real_booking are used as they are. AD-5 grants and idempotency,
-- AD-6 lock order (profiles, events, entitlements), AD-19 audit (book_core).

-- The session page (story 3.4). Admin only; a read, so no idempotency key
-- (AD-5). An unknown id -> NOT_FOUND. Result:
-- {event: {id, concept_name, kind, status, starts_at, ends_at,
--   registration_closes_at, capacity_adults, occupied},
--  bookings: [{booking_id, party_size, booked_by, guest_details,
--   customer_id, pending_join, payer_label?, full_name?, phone_e164?,
--   dietary_notes?, babies?: [{name, birth_date}]}]}
-- bookings: confirmed and completed (private.is_real_booking), by
-- confirmed_at and id. The customer's details only while she is active
-- (activated, not anonymized; as private.current_customer_id).
create function public.admin_get_event_details(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_bookings jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'concept_name', c.name,
    'kind', e.kind,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'registration_closes_at', e.registration_closes_at,
    'capacity_adults', e.capacity_adults,
    'occupied', private.occupied_places(e.id)
  )
  into v_event
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_event_id;

  if v_event is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'booking_id', b.id,
        'party_size', b.party_size,
        'booked_by', b.booked_by,
        'guest_details', b.guest_details,
        'customer_id', b.customer_id,
        'pending_join', b.customer_id is null,
        'payer_label', case when b.customer_id is null then pay.payer_label end,
        'full_name', p.full_name,
        'phone_e164', p.phone_e164,
        'dietary_notes', p.dietary_notes,
        'babies', case when p.id is not null then (
          select coalesce(
            jsonb_agg(
              jsonb_build_object('name', bb.name, 'birth_date', bb.birth_date)
              order by bb.birth_date, bb.id
            ),
            '[]'::jsonb
          )
          from public.babies bb
          where bb.customer_id = p.id
        ) end
      ))
      order by b.confirmed_at, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  left join public.profiles p
    on p.id = b.customer_id
   and p.activated_at is not null
   and p.anonymized_at is null
  left join public.payments pay on pay.id = b.payment_id
  where b.event_id = p_event_id
    and private.is_real_booking(b.status);

  return jsonb_build_object('event', v_event, 'bookings', v_bookings);
end;
$$;

-- Tal books a customer (CAP-14, story 3.4). Order: is_admin, idempotency,
-- the customer's profile lock (missing, not activated or anonymized ->
-- CUSTOMER_NOT_AVAILABLE), the session lock, then: not published ->
-- EVENT_NOT_BOOKABLE; ends_at <= clock_timestamp() -> EVENT_ENDED (Tal also
-- books a walk-in on the morning; after the end 3.12 completes the session);
-- a confirmed booking of hers -> CUSTOMER_ALREADY_BOOKED; no room for the
-- party size -> EVENT_FULL; plan_funding('admin') (a pinned entitlement
-- funds its own session); the planned entitlements locked and the plan
-- checked again (CONCURRENT_CHANGE); private.book_core (booked_by admin,
-- audit 'admin_book_customer', booking_confirmed to her). The registration
-- close is not checked. A couple session takes party size 2. Result:
-- {booking_id}.
create function public.admin_book_customer(
  p_customer_id uuid,
  p_event_id uuid,
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
  v_customer uuid;
  v_event public.events;
  v_party integer;
  v_plan jsonb;
  v_recheck jsonb;
  v_booking public.bookings;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_book_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'event_id', p_event_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select p.id into v_customer
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null
  for update;

  if v_customer is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.status <> 'published' then
    raise exception 'EVENT_NOT_BOOKABLE' using errcode = 'P0001';
  end if;

  -- The moment after the locks (as book_session, story 3.3).
  if v_event.ends_at <= clock_timestamp() then
    raise exception 'EVENT_ENDED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.customer_id = v_customer
      and b.event_id = v_event.id
      and b.status = 'confirmed'
  ) then
    raise exception 'CUSTOMER_ALREADY_BOOKED' using errcode = 'P0001';
  end if;

  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  if private.occupied_places(v_event.id) + v_party > v_event.capacity_adults then
    raise exception 'EVENT_FULL' using errcode = 'P0001';
  end if;

  v_plan := private.plan_funding(v_customer, v_event.id, v_party, 'admin');
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.id in (
    select (s ->> 'id')::uuid
    from jsonb_array_elements(v_plan -> 'sources') s
    where s ->> 'kind' = 'entitlement'
  )
  order by e.id
  for update;

  v_recheck := private.plan_funding(v_customer, v_event.id, v_party, 'admin');
  if not (v_recheck ->> 'ok')::boolean then
    raise exception '%', v_recheck ->> 'code' using errcode = 'P0001';
  end if;
  if v_recheck -> 'sources' is distinct from v_plan -> 'sources' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_booking := private.book_core(
    v_customer, null, v_event.id, v_party, v_plan -> 'sources',
    v_actor, 'admin', 'admin_book_customer'
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_book_customer', p_idempotency_key,
    jsonb_build_object('booking_id', v_booking.id)
  );
end;
$$;

-- The manual booking screen (story 3.4): the checks of admin_book_customer
-- in its order, with now(), no lock and no write. Admin only (a customer ->
-- NOT_AUTHORIZED). Result: {ok, code?, product_name?, expires_on?,
-- occupied, capacity}; product_name and expires_on of the entitlement that
-- would be used when ok; occupied and capacity of the session when it
-- exists.
create function public.preview_admin_book_customer(
  p_customer_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_event public.events;
  v_occupied integer;
  v_party integer;
  v_code text;
  v_plan jsonb;
  v_entitlement public.entitlements;
  v_product_name text;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.id into v_customer
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is not null then
    v_occupied := private.occupied_places(v_event.id);
  end if;

  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  if v_customer is null then
    v_code := 'CUSTOMER_NOT_AVAILABLE';
  elsif v_event.id is null or v_event.status <> 'published' then
    v_code := 'EVENT_NOT_BOOKABLE';
  elsif v_event.ends_at <= now() then
    v_code := 'EVENT_ENDED';
  elsif exists (
    select 1
    from public.bookings b
    where b.customer_id = v_customer
      and b.event_id = v_event.id
      and b.status = 'confirmed'
  ) then
    v_code := 'CUSTOMER_ALREADY_BOOKED';
  elsif v_occupied + v_party > v_event.capacity_adults then
    v_code := 'EVENT_FULL';
  else
    v_plan := private.plan_funding(v_customer, v_event.id, v_party, 'admin');
    if not (v_plan ->> 'ok')::boolean then
      v_code := v_plan ->> 'code';
    end if;
  end if;

  if v_code is not null then
    return jsonb_strip_nulls(jsonb_build_object(
      'ok', false,
      'code', v_code,
      'occupied', v_occupied,
      'capacity', v_event.capacity_adults
    ));
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = (v_plan -> 'sources' -> 0 ->> 'id')::uuid;

  select pay.product_snapshot ->> 'name' into v_product_name
  from public.payments pay
  where pay.id = v_entitlement.payment_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'product_name', v_product_name,
    'expires_on', v_entitlement.expires_on,
    'occupied', v_occupied,
    'capacity', v_event.capacity_adults
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_get_event_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_event_details(uuid) to authenticated;

revoke execute on function public.admin_book_customer(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_book_customer(uuid, uuid, uuid) to authenticated;

revoke execute on function public.preview_admin_book_customer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_book_customer(uuid, uuid) to authenticated;
