-- Story 3.2, review fixes (20261004183409 is already applied).
-- 1. admin_update_event: a capacity below the places already taken ->
--    CAPACITY_BELOW_BOOKED (no silent overbooking; lowering to exactly the
--    taken places is allowed).
-- 2. private.book_core: the source guard is null-safe, so a source without
--    units or with a missing or malformed id raises INVALID_INPUT.
-- AD-5 grants as before for both replaced functions.

-- As in 20261004183409, with the null-safe source guard.
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
    -- Credits arrive in 3.7.
    -- Null-safe: a missing units or id is INVALID_INPUT, never a raw error.
    if v_source ->> 'kind' is distinct from 'entitlement'
       or jsonb_typeof(v_source -> 'units') is distinct from 'number'
       or jsonb_typeof(v_source -> 'id') is distinct from 'string'
       or (v_source ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_source ->> 'units') !~ '^[0-9]{1,9}$' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
    v_units := (v_source ->> 'units')::integer;

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
  end loop;

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    p_customer_id, v_event.id, null, to_jsonb(v_booking)
  );

  -- Last in the transaction (AD-6, AD-12).
  perform private.notify_booking_confirmed(v_booking);

  return v_booking;
end;
$$;


-- As in 20261004183409, plus CAPACITY_BELOW_BOOKED.
create or replace function public.admin_update_event(
  p_event_id uuid,
  p_changes jsonb,
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
  v_old public.events;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
  for update;

  if v_old.id is null or v_old.status in ('cancelled', 'completed') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;

  v_row := private.apply_event_changes(
    v_old,
    p_changes,
    array['date', 'start_time', 'end_time', 'kind', 'description',
          'capacity_adults', 'registration_closes_local', 'display_price_agorot']
  );

  if (
       v_row.starts_at is distinct from v_old.starts_at
       or v_row.ends_at is distinct from v_old.ends_at
       or v_row.kind is distinct from v_old.kind
     )
     and exists (
       select 1
       from public.bookings b
       where b.event_id = v_old.id
         and b.status = 'confirmed'
     ) then
    raise exception 'EVENT_HAS_BOOKINGS' using errcode = 'P0001';
  end if;

  -- Never below the places already taken: no silent overbooking (CAP-14).
  if v_row.capacity_adults is distinct from v_old.capacity_adults
     and v_row.capacity_adults < private.occupied_places(v_old.id) then
    raise exception 'CAPACITY_BELOW_BOOKED' using errcode = 'P0001';
  end if;

  if v_row is distinct from v_old then
    v_saved := private.save_event(v_row, false);

    if v_saved is distinct from v_old then
      perform private.audit(
        v_actor, 'admin', 'admin_update_event', 'events', v_saved.id,
        null, v_saved.id, to_jsonb(v_old), to_jsonb(v_saved)
      );
    end if;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;


revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;
