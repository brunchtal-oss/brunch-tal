-- The booking sheet hides "what will remain" for a single-entry purchase
-- (always none after it; user decision 2026-10-11): preview_book_session
-- also returns the funding entitlement's kind. Otherwise unchanged from
-- 20261010141240_cancellation_credits.sql.

create or replace function public.preview_book_session(p_event_id uuid)
returns jsonb
language plpgsql
volatile
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
  v_credit public.cancellation_credits;
  v_available integer;
  v_product_name text;
  v_units integer;
  v_cancel_deadline timestamptz;
  v_funding jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  perform private.refresh_customer_credits(v_customer);

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

  if v_source ->> 'kind' = 'credit' then
    select c.* into v_credit
    from public.cancellation_credits c
    where c.id = (v_source ->> 'id')::uuid;

    select pay.product_snapshot ->> 'name' into v_product_name
    from public.entitlements e
    join public.payments pay on pay.id = e.payment_id
    where e.id = v_credit.source_entitlement_id;

    return jsonb_build_object(
      'ok', true,
      'booked', false,
      'source', 'credit',
      'credit_id', v_credit.id,
      'product_name', v_product_name,
      'origin_starts_at', v_credit.origin_starts_at,
      'units', v_units,
      'cancel_deadline', v_cancel_deadline
    );
  end if;

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
    'source', 'entitlement',
    'entitlement_kind', v_entitlement.kind,
    'product_name', v_product_name,
    'units', v_units,
    'available_after', v_available - v_units,
    'expires_on', v_entitlement.expires_on,
    'cancel_deadline', v_cancel_deadline
  );
end;
$$;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;
