-- Story 3.11, review fixes (20261004212706 is already applied). Same
-- signatures, create or replace; grants re-stated (AD-5).
-- One intro rule everywhere: an intro product is type 'intro' or
-- intro_only; an intro entitlement is kind 'intro' or intro_only in its
-- eligibility_snapshot. For it BOTH checks apply, through the one helper
-- private.intro_blocked: the customer took part (private.has_participated)
-- or has another active intro entitlement. Used by
-- private.plan_pinned_placement, private.approve_payment_core (days intro),
-- preview_admin_approve_payment (days intro) and private.bind_purchase.

-- The customer cannot get an intro: she took part, or she has an active intro
-- entitlement (kind 'intro' or intro_only) other than the one of
-- p_payment_id (the purchase being checked; null before it exists).
create function private.intro_blocked(p_customer_id uuid, p_payment_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_participated(p_customer_id)
    or exists (
      select 1
      from public.entitlements e
      where e.customer_id = p_customer_id
        and e.status = 'active'
        and (
          e.kind = 'intro'
          or coalesce((e.eligibility_snapshot ->> 'intro_only')::boolean, false)
        )
        and e.payment_id is distinct from p_payment_id
    );
$$;

-- As in 20261004212706, with the one intro rule (private.intro_blocked).
create or replace function private.plan_pinned_placement(
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_product public.products;
  v_event public.events;
  v_weekday smallint;
begin
  select p.* into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null or v_product.validity_mode <> 'session' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_BOOKABLE');
  end if;

  v_weekday := extract(dow from (v_event.starts_at at time zone 'Asia/Jerusalem'))::smallint;

  if v_event.kind <> v_product.eligible_event_kind
     or (v_product.allowed_weekdays is not null
         and not v_weekday = any (v_product.allowed_weekdays)) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FIT');
  end if;

  if private.occupied_places(v_event.id) + v_product.party_size > v_event.capacity_adults then
    return jsonb_build_object('ok', false, 'code', 'EVENT_FULL');
  end if;

  if p_customer_id is not null then
    if exists (
      select 1
      from public.bookings b
      where b.customer_id = p_customer_id
        and b.event_id = v_event.id
        and b.status = 'confirmed'
    ) then
      return jsonb_build_object('ok', false, 'code', 'CUSTOMER_ALREADY_BOOKED');
    end if;

    if (v_product.type = 'intro' or v_product.intro_only)
       and private.intro_blocked(p_customer_id, p_payment_id) then
      return jsonb_build_object('ok', false, 'code', 'INTRO_NOT_ELIGIBLE');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- As in 20261004212706, with the one intro rule (private.intro_blocked).
create or replace function private.approve_payment_core(
  p_source text,
  p_actor_id uuid,
  p_actor_kind text,
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
  p_provider text,
  p_provider_transaction_id text,
  p_on_seat_failure text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_product public.products;
  v_method_name text;
  v_plan jsonb;
  v_place jsonb;
  v_payment public.payments;
  v_entitlement public.entitlements;
  v_reason text;
begin
  if p_source is null or p_source not in ('manual', 'online')
     or p_actor_kind is null or p_actor_kind not in ('admin', 'customer', 'system')
     or p_on_seat_failure is null or p_on_seat_failure not in ('raise', 'park')
     or (p_source = 'manual' and p_actor_id is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_event_id is not null then
    perform 1
    from public.events e
    where e.id = p_event_id
    for update;
  end if;

  select p.* into v_product
  from public.products p
  where p.id = p_product_id
  for share;

  if p_payment_method_id is not null then
    select pm.name into v_method_name
    from public.payment_methods pm
    where pm.id = p_payment_method_id
    for share;
  end if;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if v_product.validity_mode = 'session' then
    v_place := private.plan_pinned_placement(p_customer_id, p_product_id, p_event_id, null);
    if not (v_place ->> 'ok')::boolean
       and (p_on_seat_failure = 'raise' or v_place ->> 'code' = 'INTRO_NOT_ELIGIBLE') then
      raise exception '%', v_place ->> 'code' using errcode = 'P0001';
    end if;
  elsif (v_product.type = 'intro' or v_product.intro_only)
     and p_customer_id is not null
     and private.intro_blocked(p_customer_id, null) then
    raise exception 'INTRO_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  if p_source = 'manual' and not private.payment_method_selectable(p_payment_method_id) then
    raise exception 'PAYMENT_METHOD_NOT_SELECTABLE' using errcode = 'P0001';
  end if;

  if p_source = 'online' and p_payment_method_id is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The override reason is kept only when the amount differs from the price.
  v_reason := case
    when (v_plan ->> 'price_changed')::boolean then nullif(btrim(p_amount_override_reason), '')
  end;

  v_payment := private.record_payment(
    p_source, p_actor_id, p_customer_id, v_product, p_amount_agorot, v_reason,
    p_paid_on, p_payment_method_id, v_method_name, p_reference, p_note,
    p_provider, p_provider_transaction_id
  );

  perform private.audit(
    p_actor_id, p_actor_kind, 'approve_payment', 'payments', v_payment.id,
    p_customer_id, p_event_id, null, to_jsonb(v_payment), v_reason
  );

  v_entitlement := private.grant_from_payment(v_payment, v_product, v_plan, p_actor_id);

  perform private.audit(
    p_actor_id, p_actor_kind, 'approve_payment', 'entitlements', v_entitlement.id,
    p_customer_id, p_event_id, null, to_jsonb(v_entitlement)
  );

  if v_entitlement.pinned_event_id is not null then
    perform private.place_pinned_booking(
      v_payment, v_entitlement, p_on_seat_failure, p_actor_id, p_actor_kind
    );
  end if;

  return v_payment.id;
end;
$$;

-- As in 20261004212706, with the one intro rule (private.intro_blocked).
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

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
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
       from public.bookings b
       join public.bookings other
         on other.event_id = b.event_id
        and other.customer_id = p_customer_id
        and other.status = 'confirmed'
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
end;
$$;

-- As in 20261004212706, with the one intro rule (private.intro_blocked).
create or replace function public.preview_admin_approve_payment(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_paid_on date,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer_name text;
  v_label text := nullif(btrim(p_payer_label), '');
  v_plan jsonb;
  v_place jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_label is not null
     and (p_customer_id is not null or char_length(v_label) > 40) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_customer_id is not null then
    select p.full_name into v_customer_name
    from public.profiles p
    where p.id = p_customer_id
      and p.anonymized_at is null;

    if v_customer_name is null then
      raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if v_plan ->> 'event_id' is not null then
    v_place := private.plan_pinned_placement(p_customer_id, p_product_id, p_event_id, null);
    if not (v_place ->> 'ok')::boolean then
      raise exception '%', v_place ->> 'code' using errcode = 'P0001';
    end if;
  elsif p_customer_id is not null
     and exists (
       select 1
       from public.products p
       where p.id = p_product_id
         and (p.type = 'intro' or p.intro_only)
     )
     and private.intro_blocked(p_customer_id, null) then
    raise exception 'INTRO_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  return v_plan || jsonb_build_object(
    'customer_name', v_customer_name,
    'similar_payments', private.similar_payments(
      p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
    ),
    'duplicate_window_days', (
      select s.duplicate_payment_window_days from public.business_settings s
    ),
    'expired', now() >= (v_plan ->> 'expires_at')::timestamptz
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.intro_blocked(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_pinned_placement(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.approve_payment_core(text, uuid, text, uuid, uuid, uuid, integer, text, date, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) to authenticated;
