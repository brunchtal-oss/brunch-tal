-- Story 3.7, phone test: a credit also funds a booking of its origin
-- session (user decision 2026-10-10, overrides source section 6 "the
-- cancelled session is not an alternative"). Besides its N options, and
-- without counting toward them, a cancellation credit funds a new booking
-- of the session whose booking became the credit (origin_booking_id), while
-- that session is published, open for registration and has room (the
-- booking RPCs check those as for any session). Before this she saw "no
-- matching entry" on the session she had cancelled.
-- 1. private.plan_funding: the credit branch takes a credit whose active
--    option is this session OR whose origin session is this session.
-- 2. private.book_core: the same re-check of a credit source; for the
--    origin session there is no option row to mark used.
-- 3. public.preview_book_sessions: available also counts a credit whose
--    origin session is among p_items.
-- Everything else stays as in 20261010141240: a cancel of a booking of the
-- origin session finds no used option to restore, and the credit is active
-- again with the same options. Same signatures; grants re-stated (AD-5).

-- As in 20261010141240, plus the origin session in the credit branch.
create or replace function private.plan_funding(
  p_customer_id uuid,
  p_event_id uuid,
  p_party_size integer,
  p_mode text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_day date;
  v_weekday smallint;
  v_credit_id uuid;
  v_entitlement_id uuid;
  v_without_date boolean;
begin
  if p_customer_id is null
     or p_party_size is null or p_party_size not in (1, 2)
     or p_mode is null or p_mode not in ('self', 'admin', 'move', 'online') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- (1) A credit whose active option is this session, or whose origin
  -- (the cancelled session) is this session.
  select c.id into v_credit_id
  from public.cancellation_credits c
  where c.customer_id = p_customer_id
    and c.status = 'active'
    and not c.choice_pending
    and c.party_size = p_party_size
    and (
      exists (
        select 1
        from public.credit_options o
        where o.credit_id = c.id
          and o.event_id = v_event.id
          and o.state = 'active'
      )
      or exists (
        select 1
        from public.bookings ob
        where ob.id = c.origin_booking_id
          and ob.event_id = v_event.id
      )
    )
    and not exists (
      select 1
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      where a.credit_id = c.id
        and b.status = 'confirmed'
    )
  order by c.created_at, c.id
  limit 1;

  if v_credit_id is not null then
    return jsonb_build_object(
      'ok', true,
      'sources', jsonb_build_array(
        jsonb_build_object('kind', 'credit', 'id', v_credit_id, 'units', 1)
      )
    );
  end if;

  -- (2) An entitlement, as before.
  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;
  v_weekday := extract(dow from v_day)::smallint;

  select b.entitlement_id into v_entitlement_id
  from public.entitlements e
  join public.entitlement_balances b on b.entitlement_id = e.id
  where e.customer_id = p_customer_id
    and e.status = 'active'
    and e.eligible_event_kind = v_event.kind
    and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
    and (
      e.pinned_event_id is null
      or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
    )
    and not (e.kind = 'card' and v_event.kind = 'couple' and p_mode in ('self', 'online'))
    and b.available >= 1
    and e.valid_from <= v_day
    and v_day <= e.expires_on
  order by e.expires_on, e.id
  limit 1;

  if v_entitlement_id is not null then
    return jsonb_build_object(
      'ok', true,
      'sources', jsonb_build_array(
        jsonb_build_object('kind', 'entitlement', 'id', v_entitlement_id, 'units', 1)
      )
    );
  end if;

  -- Every rule but the date.
  select exists (
    select 1
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    where e.customer_id = p_customer_id
      and e.status = 'active'
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and (
        e.pinned_event_id is null
        or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
      )
      and not (e.kind = 'card' and v_event.kind = 'couple' and p_mode in ('self', 'online'))
      and b.available >= 1
  ) into v_without_date;

  return jsonb_build_object(
    'ok', false,
    'code', case when v_without_date
      then 'ENTITLEMENT_EXPIRED_ON_DATE'
      else 'NO_MATCHING_ENTITLEMENT'
    end,
    'sources', '[]'::jsonb
  );
end;
$$;

-- As in 20261010141240, plus the origin session in the credit re-check.
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

  -- Last in the transaction (AD-6, AD-12).
  perform private.notify_booking_confirmed(v_booking);

  return v_booking;
end;
$$;

-- As in 20261010141240, plus a credit whose origin session is among p_items.
create or replace function public.preview_book_sessions(p_items uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_available integer;
  v_credits integer;
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

  perform private.refresh_customer_credits(v_customer);

  select coalesce(sum(b.available), 0)::integer into v_available
  from public.entitlements e
  join public.entitlement_balances b on b.entitlement_id = e.id
  where e.customer_id = v_customer
    and e.status = 'active'
    and e.pinned_event_id is null
    and e.expires_on >= (now() at time zone 'Asia/Jerusalem')::date;

  select count(*)::integer into v_credits
  from public.cancellation_credits c
  where c.customer_id = v_customer
    and c.status = 'active'
    and not c.choice_pending
    and not exists (
      select 1
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      where a.credit_id = c.id
        and b.status = 'confirmed'
    )
    and (
      exists (
        select 1
        from public.credit_options o
        where o.credit_id = c.id
          and o.state = 'active'
          and o.event_id = any (p_items)
      )
      or exists (
        select 1
        from public.bookings ob
        where ob.id = c.origin_booking_id
          and ob.event_id = any (p_items)
      )
    );

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
        'product_name', case
          when (v_preview ->> 'ok')::boolean then v_preview ->> 'product_name'
        end,
        'cancel_deadline', v_preview -> 'cancel_deadline'
      ))
    );
  end loop;

  return jsonb_build_object('available', v_available + v_credits, 'results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.plan_funding(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.preview_book_sessions(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_sessions(uuid[]) to authenticated;
