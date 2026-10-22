-- Story 3.3: multi-date booking and registration close (CAP-13, CAP-14).
-- 1. public.book_sessions: a card books several dates in one call. Every
--    lock is taken first (the customer's profile, every session by id, every
--    active entitlement of hers that is not pinned, by id; AD-6), then each
--    date is checked and booked on its own, in the order of book_session.
--    A failed date keeps no place and takes no entry; it is only reported.
-- 2. public.preview_book_sessions: the selection screen. Each date through
--    public.preview_book_session (no second copy of the checks), plus her
--    available entries.
-- 3. public.book_session: registration close is checked against
--    clock_timestamp() after the locks, not now() (the transaction start),
--    so a request that waited on a lock past the close is refused (source
--    section 11; user decision 2026-10-05). Same signature, the rest of the
--    body as in 20261004183409.
-- private.book_core and private.plan_funding are used as they are.
-- AD-5 grants for every new or replaced function.

-- As in 20261004183409, with the close checked against clock_timestamp()
-- after the profile and session locks.
create or replace function public.book_session(p_event_id uuid, p_idempotency_key uuid)
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
  v_event public.events;
  v_party integer;
  v_plan jsonb;
  v_recheck jsonb;
  v_booking public.bookings;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'book_session', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.status <> 'published' then
    raise exception 'EVENT_NOT_BOOKABLE' using errcode = 'P0001';
  end if;

  -- The moment after the locks, not the transaction start (story 3.3).
  if clock_timestamp() >= v_event.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.customer_id = v_customer
      and b.event_id = v_event.id
      and b.status = 'confirmed'
  ) then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end if;

  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  if private.occupied_places(v_event.id) + v_party > v_event.capacity_adults then
    raise exception 'EVENT_FULL' using errcode = 'P0001';
  end if;

  v_plan := private.plan_funding(v_customer, v_event.id, v_party, 'self');
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

  v_recheck := private.plan_funding(v_customer, v_event.id, v_party, 'self');
  if not (v_recheck ->> 'ok')::boolean then
    raise exception '%', v_recheck ->> 'code' using errcode = 'P0001';
  end if;
  if v_recheck -> 'sources' is distinct from v_plan -> 'sources' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_booking := private.book_core(
    v_customer, null, v_event.id, v_party, v_plan -> 'sources',
    v_actor, 'customer', 'book_session'
  );

  return private.idempotent_finish(
    v_actor::text, 'book_session', p_idempotency_key,
    jsonb_build_object('booking_id', v_booking.id)
  );
end;
$$;

-- Several dates with a card (CAP-13, story 3.3). p_items: session ids, 1 to
-- 20, no null, no duplicate (else INVALID_INPUT). The idempotency request is
-- the sorted ids. Locks (AD-6): her profile, every session by id, every
-- active entitlement of hers that is not pinned, by id; nothing is planned
-- before them, so no plan is checked twice. Then, for each date by
-- starts_at and id (an id that does not exist last), the checks of
-- book_session in its order: EVENT_NOT_BOOKABLE, REGISTRATION_CLOSED
-- (clock_timestamp() after the locks), ALREADY_BOOKED, EVENT_FULL,
-- plan_funding('self'). plan_funding is stable, so it sees the bookings of
-- the earlier dates of this call. A success books through private.book_core
-- (audit 'book_sessions', one booking_confirmed per date); a failure is only
-- written in the result. Result, in that order and stored for the key even
-- when every date failed: {results: [{event_id, ok, code?, booking_id?}]}.
create function public.book_sessions(p_items uuid[], p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_customer uuid := (select private.current_customer_id());
  v_sorted uuid[];
  v_prev jsonb;
  v_now timestamptz;
  v_id uuid;
  v_event public.events;
  v_party integer;
  v_plan jsonb;
  v_code text;
  v_booking public.bookings;
  v_results jsonb := '[]'::jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_items is null
     or cardinality(p_items) = 0
     or cardinality(p_items) > 20
     or exists (select 1 from unnest(p_items) i where i is null)
     or (select count(distinct i) from unnest(p_items) i) <> cardinality(p_items) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select array_agg(i order by i) into v_sorted from unnest(p_items) i;

  v_prev := private.idempotent_begin(
    v_actor::text, 'book_sessions', p_idempotency_key,
    jsonb_build_object('event_ids', to_jsonb(v_sorted))
  );
  if v_prev is not null then
    return v_prev;
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  perform 1
  from public.events e
  where e.id = any (v_sorted)
  order by e.id
  for update;

  perform 1
  from public.entitlements e
  where e.customer_id = v_customer
    and e.status = 'active'
    and e.pinned_event_id is null
  order by e.id
  for update;

  -- The moment after every lock (story 3.3): a request that waited past the
  -- close is refused.
  v_now := clock_timestamp();

  for v_id in
    select i
    from unnest(v_sorted) i
    left join public.events e on e.id = i
    order by e.starts_at nulls last, i
  loop
    v_code := null;
    v_plan := null;

    select e.* into v_event
    from public.events e
    where e.id = v_id;

    v_party := case when v_event.kind = 'couple' then 2 else 1 end;

    if v_event.id is null or v_event.status <> 'published' then
      v_code := 'EVENT_NOT_BOOKABLE';
    elsif v_now >= v_event.registration_closes_at then
      v_code := 'REGISTRATION_CLOSED';
    elsif exists (
      select 1
      from public.bookings b
      where b.customer_id = v_customer
        and b.event_id = v_event.id
        and b.status = 'confirmed'
    ) then
      v_code := 'ALREADY_BOOKED';
    elsif private.occupied_places(v_event.id) + v_party > v_event.capacity_adults then
      v_code := 'EVENT_FULL';
    else
      v_plan := private.plan_funding(v_customer, v_event.id, v_party, 'self');
      if not (v_plan ->> 'ok')::boolean then
        v_code := v_plan ->> 'code';
      end if;
    end if;

    if v_code is null then
      v_booking := private.book_core(
        v_customer, null, v_event.id, v_party, v_plan -> 'sources',
        v_actor, 'customer', 'book_sessions'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'event_id', v_id, 'ok', true, 'booking_id', v_booking.id
      ));
    else
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'event_id', v_id, 'ok', false, 'code', v_code
      ));
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'book_sessions', p_idempotency_key,
    jsonb_build_object('results', v_results)
  );
end;
$$;

-- The selection screen (story 3.3): each date checked on its own by
-- public.preview_book_session (now(), no locks, no writes). p_items: at most
-- 200 ids, no null (else INVALID_INPUT); duplicates are reported once.
-- available: the sum of available of her active entitlements that are not
-- pinned and have not expired by the local day. Result: {available,
-- results: [{event_id, ok, code?, product_name?, cancel_deadline}]} by
-- starts_at and id (an id that does not exist last). A date she is booked
-- for has code ALREADY_BOOKED.
create function public.preview_book_sessions(p_items uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_available integer;
  v_id uuid;
  v_preview jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_items is null
     or cardinality(p_items) > 200
     or exists (select 1 from unnest(p_items) i where i is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select coalesce(sum(b.available), 0)::integer into v_available
  from public.entitlements e
  join public.entitlement_balances b on b.entitlement_id = e.id
  where e.customer_id = v_customer
    and e.status = 'active'
    and e.pinned_event_id is null
    and e.expires_on >= (now() at time zone 'Asia/Jerusalem')::date;

  for v_id in
    select d.i
    from (select distinct i from unnest(p_items) i) d
    left join public.events e on e.id = d.i
    order by e.starts_at nulls last, d.i
  loop
    v_preview := public.preview_book_session(v_id);

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'event_id', v_id,
        'ok', (v_preview ->> 'ok')::boolean,
        'code', case
          when (v_preview ->> 'booked')::boolean then 'ALREADY_BOOKED'
          else v_preview ->> 'code'
        end,
        'product_name', v_preview ->> 'product_name',
        'cancel_deadline', v_preview -> 'cancel_deadline'
      ))
    );
  end loop;

  return jsonb_build_object('available', v_available, 'results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.book_session(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.book_session(uuid, uuid) to authenticated;

revoke execute on function public.book_sessions(uuid[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.book_sessions(uuid[], uuid) to authenticated;

revoke execute on function public.preview_book_sessions(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_sessions(uuid[]) to authenticated;
