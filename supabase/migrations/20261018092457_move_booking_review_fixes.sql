-- Story 3.10, review fixes (runs after 20261018075214_move_booking.sql).
-- Same signatures; bodies re-based on 20261018075214.
--
-- 1. private.move_option_candidates: a credit-funded booking may move to the
--    credit's origin session (user decision 2026-10-18; book_core already
--    funds it), so it is a candidate (the customer may choose it, Tal's list
--    marks it inside the options). Never the booking's own session.
-- 2. private.move_core: the copy of policy_snapshot and guest_details onto
--    the new booking is audited (before: the row book_core returned).
-- 3. public.preview_admin_move_booking: volatile; refreshes the booking's
--    customer's credits before the plan, as admin_move_booking does.
-- An option Tal added outside the alternatives stays an active option after
-- a later cancel (user decision 2026-10-18): no change.

-- 1. As in 20261018075214, plus the credit's origin session.
create or replace function private.move_option_candidates(p_booking_id uuid)
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

  select b.event_id into v_origin_event
  from public.bookings b
  where b.id = v_credit.origin_booking_id;

  -- Rule (2).
  if v_counted < v_credit.options_count then

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

  -- The credit's origin session, outside the N (book_core funds it from the
  -- credit; user decision 2026-10-18); never the booking's own session.
  if v_origin_event is not null and not (v_origin_event = any (v_keep)) then
    v_keep := v_keep || v_origin_event;
  end if;

  return array_remove(v_keep, v_event.id);
end;
$$;

-- 2. As in 20261018075214, plus the audit of the snapshot copy.
create or replace function private.move_core(
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
  v_booked public.bookings;
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

  v_booked := private.book_core(
    v_booking.customer_id, null, p_target_event_id, v_booking.party_size,
    v_sources, p_actor_id, p_actor_kind, p_action
  );

  update public.bookings
  set policy_snapshot = v_booking.policy_snapshot,
      guest_details = v_booking.guest_details
  where id = v_booked.id
  returning * into v_new;

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_new.id,
    v_new.customer_id, v_new.event_id, to_jsonb(v_booked), to_jsonb(v_new), p_reason
  );

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

-- 3. As in 20261018075214, plus the refresh of the customer's credits.
create or replace function public.preview_admin_move_booking(p_booking_id uuid)
returns jsonb
language plpgsql
volatile
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

  -- The booking's customer's credits first, as admin_move_booking does, so
  -- the list matches what the move will accept (a null customer: nothing).
  perform private.refresh_customer_credits(
    (select b.customer_id from public.bookings b where b.id = p_booking_id)
  );

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

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.move_option_candidates(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.move_core(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_move_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_move_booking(uuid) to authenticated;
