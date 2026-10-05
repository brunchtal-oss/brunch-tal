-- Story 3.11: pinned product approval and placement (CAP-37, AD-23).
-- A pinned product (single, intro, couple; validity_mode 'session') is
-- approved for one session Tal picks: the approval core places the booking
-- through private.book_core in the same transaction. For a new customer the
-- booking has no customer and moves to her in private.bind_purchase.
-- New: private.has_participated, private.plan_pinned_placement (AD-7, one
-- plan for the preview and the approval), private.place_pinned_booking, the
-- RPC admin_list_bookable_events, and a partial unique index (one active
-- intro entitlement per customer).
-- Changed (same signatures, create or replace): private.plan_approve_payment
-- (PINNED_EVENT_REQUIRED, expiry = the session's local date;
-- PINNED_NOT_AVAILABLE is gone), private.grant_from_payment (writes
-- pinned_event_id), private.approve_payment_core (places the booking),
-- admin_approve_payment and preview_admin_approve_payment (lock and plan the
-- session), private.bind_purchase (intro re-check), private.plan_funding (a
-- booking takes one entry; party_size counts places only, deferred from 3.2).
-- AD-5 grants, AD-6 lock order (profiles -> events -> bookings ->
-- entitlements), AD-7 plan/preview, AD-8 time in SQL, AD-10 one core, AD-18
-- funding, AD-19 audit, AD-23 bookings without a customer.

-- ---------------------------------------------------------------------------
-- One active intro entitlement per customer (AD-6). The explicit checks
-- (INTRO_NOT_ELIGIBLE, BIND_CONFLICT) run first, so no caller sees 23505.
-- ---------------------------------------------------------------------------

create unique index entitlements_active_intro_customer_uidx
  on public.entitlements (customer_id)
  where kind = 'intro' and status = 'active' and customer_id is not null;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The customer took part in a session: a completed booking, or a confirmed
-- one whose session already ended (a no-show counts, source section 2). A
-- cancelled booking never counts. Reads now().
create function private.has_participated(p_customer_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings b
    join public.events e on e.id = b.event_id
    where b.customer_id = p_customer_id
      and (
        b.status = 'completed'
        or (b.status = 'confirmed' and e.ends_at <= now())
      )
  );
$$;

-- Whether a pinned product can be placed in a session (AD-7: the preview and
-- the approval run this one plan). In order: the session is published and
-- has not started (EVENT_NOT_BOOKABLE); its kind is the product's
-- eligible_event_kind and its local weekday is in allowed_weekdays (null =
-- every day) (EVENT_NOT_FIT); occupied_places + party_size <= capacity
-- (EVENT_FULL). Only with a customer: she has a confirmed booking for it
-- (CUSTOMER_ALREADY_BOOKED); an intro_only product while she took part or
-- has an active intro entitlement (INTRO_NOT_ELIGIBLE; for any intro product
-- the active intro alone, because of the unique index). The registration
-- close does not apply to Tal. p_payment_id: the purchase being placed, whose
-- own entitlement is not "another" active intro (null before it exists).
-- Result: {ok, code?}.
create function private.plan_pinned_placement(
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

    if (v_product.intro_only and private.has_participated(p_customer_id))
       or (
         (v_product.intro_only or v_product.type = 'intro')
         and exists (
           select 1
           from public.entitlements e
           where e.customer_id = p_customer_id
             and e.kind = 'intro'
             and e.status = 'active'
             and e.payment_id is distinct from p_payment_id
         )
       ) then
      return jsonb_build_object('ok', false, 'code', 'INTRO_NOT_ELIGIBLE');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- As in 20261001162630, for pinned products (CAP-37): a pinned product
-- without a session -> PINNED_EVENT_REQUIRED; an unknown session ->
-- EVENT_NOT_BOOKABLE; expires_on = the session's local date (never before
-- the purchase date, so a parked purchase for a session that started keeps
-- a valid row). PINNED_NOT_AVAILABLE is gone. The plan also returns the
-- session (event_id, event_starts_at, concept_name) for the preview.
-- Whether the session can take the booking is private.plan_pinned_placement.
create or replace function private.plan_approve_payment(
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_paid_on date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_product public.products;
  v_event public.events;
  v_concept text;
  v_expires_on date;
begin
  select p.* into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null or not v_product.active then
    raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if v_product.validity_mode = 'session' then
    if p_event_id is null then
      raise exception 'PINNED_EVENT_REQUIRED' using errcode = 'P0001';
    end if;

    select e.* into v_event
    from public.events e
    where e.id = p_event_id;

    if v_event.id is null then
      raise exception 'EVENT_NOT_BOOKABLE' using errcode = 'P0001';
    end if;

    select c.name into v_concept
    from public.concepts c
    where c.id = v_event.concept_id;
  elsif p_event_id is not null then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if p_paid_on is null
     or p_paid_on > (now() at time zone 'Asia/Jerusalem')::date
     or p_amount_agorot is null
     or p_amount_agorot < 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_event.id is not null then
    v_expires_on := greatest((v_event.starts_at at time zone 'Asia/Jerusalem')::date, p_paid_on);
  else
    v_expires_on := p_paid_on + v_product.validity_days;
  end if;

  return jsonb_build_object(
    'product_id', v_product.id,
    'product_name', v_product.name,
    'kind', v_product.type,
    'units', v_product.units,
    'event_id', v_event.id,
    'event_starts_at', v_event.starts_at,
    'concept_name', v_concept,
    'valid_from', p_paid_on,
    'expires_on', v_expires_on,
    'expires_at', private.local_day_end(v_expires_on),
    'price_agorot', v_product.price_agorot,
    'amount_agorot', p_amount_agorot,
    'price_changed', p_amount_agorot <> v_product.price_agorot
  );
end;
$$;

-- As in 20261001162630, plus pinned_event_id = the plan's session for a
-- pinned product (entitlements_pinned_check: session mode <-> a session).
create or replace function private.grant_from_payment(
  p_payment public.payments,
  p_product public.products,
  p_plan jsonb,
  p_actor_id uuid
)
returns public.entitlements
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
begin
  insert into public.entitlements (
    customer_id, payment_id, kind, original_units, valid_from, expires_on,
    pinned_event_id, eligibility_snapshot, allowed_weekdays,
    eligible_event_kind, status
  )
  values (
    p_payment.customer_id,
    p_payment.id,
    p_product.type,
    p_product.units,
    (p_plan ->> 'valid_from')::date,
    (p_plan ->> 'expires_on')::date,
    case when p_product.validity_mode = 'session' then (p_plan ->> 'event_id')::uuid end,
    jsonb_build_object(
      'product_id', p_product.id,
      'type', p_product.type,
      'units', p_product.units,
      'validity_mode', p_product.validity_mode,
      'validity_days', p_product.validity_days,
      'allowed_weekdays', p_product.allowed_weekdays,
      'eligible_event_kind', p_product.eligible_event_kind,
      'party_size', p_product.party_size,
      'intro_only', p_product.intro_only
    ),
    p_product.allowed_weekdays,
    p_product.eligible_event_kind,
    'active'
  )
  returning * into v_entitlement;

  insert into public.entitlement_movements (entitlement_id, action, units, actor_id)
  values (v_entitlement.id, 'grant', p_product.units, p_actor_id);

  return v_entitlement;
end;
$$;

-- Places the booking of a pinned purchase (AD-23), called only from
-- private.approve_payment_core after the entitlement exists. Locks the
-- session (AD-6; already held when the caller locked it) and runs
-- private.plan_pinned_placement. A refusal: 'raise' throws its code, 'park'
-- writes no booking and keeps the payment and the entitlement (returns
-- null). Otherwise private.book_core with the purchase's own entitlement as
-- the one source (one entry; party_size counts the places), without
-- plan_funding (a new customer has nothing yet). Returns the booking id.
create function private.place_pinned_booking(
  p_payment public.payments,
  p_entitlement public.entitlements,
  p_on_seat_failure text,
  p_actor_id uuid,
  p_actor_kind text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_place jsonb;
  v_booking public.bookings;
begin
  if p_payment.id is null
     or p_entitlement.id is null
     or p_entitlement.payment_id is distinct from p_payment.id
     or p_entitlement.pinned_event_id is null
     or p_on_seat_failure is null or p_on_seat_failure not in ('raise', 'park') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform 1
  from public.events e
  where e.id = p_entitlement.pinned_event_id
  for update;

  v_place := private.plan_pinned_placement(
    p_payment.customer_id, p_payment.product_id, p_entitlement.pinned_event_id, p_payment.id
  );

  if not (v_place ->> 'ok')::boolean then
    if p_on_seat_failure = 'raise' then
      raise exception '%', v_place ->> 'code' using errcode = 'P0001';
    end if;
    return null;
  end if;

  v_booking := private.book_core(
    p_payment.customer_id,
    p_payment.id,
    p_entitlement.pinned_event_id,
    (p_entitlement.eligibility_snapshot ->> 'party_size')::integer,
    jsonb_build_array(
      jsonb_build_object('kind', 'entitlement', 'id', p_entitlement.id, 'units', 1)
    ),
    p_actor_id,
    p_actor_kind,
    'approve_payment'
  );

  return v_booking.id;
end;
$$;

-- As in 20261001162630, final signature, plus pinned products: the session
-- is locked first (AD-6: after the caller's profile, before the bookings and
-- the entitlement), then the product and the method FOR SHARE. For a pinned
-- product private.plan_pinned_placement runs before anything is written: a
-- refusal raises in 'raise', and INTRO_NOT_ELIGIBLE raises in both modes (a
-- second active intro entitlement cannot exist). An intro product of days
-- for a customer with an active intro -> INTRO_NOT_ELIGIBLE as well. After
-- the payment and the entitlement, private.place_pinned_booking places the
-- booking (or parks it).
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
  elsif v_product.type = 'intro'
     and p_customer_id is not null
     and exists (
       select 1
       from public.entitlements e
       where e.customer_id = p_customer_id
         and e.kind = 'intro'
         and e.status = 'active'
     ) then
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

-- As in 20261004183409, plus (deferred from 3.2) a booking takes one entry
-- whatever its party size: party_size counts places only (source section 2:
-- a couple booking is "one booking for two adults"). An entitlement matches
-- with available >= 1 and every source has units 1.
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

-- As in 20261004183409, plus the intro re-check (AD-23): an intro
-- entitlement for a customer who took part (private.has_participated) or
-- has another active intro entitlement -> BIND_CONFLICT, nothing bound (the
-- join RPCs move the link to conflict, bind_conflict).
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
       v_entitlement.kind = 'intro'
       and (
         private.has_participated(p_customer_id)
         or exists (
           select 1
           from public.entitlements e
           where e.customer_id = p_customer_id
             and e.kind = 'intro'
             and e.status = 'active'
             and e.id <> v_entitlement.id
         )
       )
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

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- As in 20261004075337, plus a pinned product: the session is locked right
-- after the profile (AD-6); the core plans and places the booking ('raise').
-- For a pinned product the result adds event_id and booking_id.
-- purchase_repeat stays for a pinned product too (decision of 2.5);
-- booking_confirmed comes from private.book_core.
create or replace function public.admin_approve_payment(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
  p_confirmed boolean,
  p_duplicate_confirmed boolean,
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
  v_label text := nullif(btrim(p_payer_label), '');
  v_payment public.payments;
  v_payment_new public.payments;
  v_profile_id uuid;
  v_plan jsonb;
  v_payment_id uuid;
  v_entitlement public.entitlements;
  v_booking_id uuid;
  v_pinned jsonb := '{}'::jsonb;
  v_card_tip text := '';
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'payer_label', v_label,
      'product_id', p_product_id,
      'event_id', p_event_id,
      'amount_agorot', p_amount_agorot,
      'amount_override_reason', p_amount_override_reason,
      'paid_on', p_paid_on,
      'payment_method_id', p_payment_method_id,
      'reference', p_reference,
      'note', p_note,
      'confirmed', p_confirmed,
      'duplicate_confirmed', p_duplicate_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- The label only names a new customer, up to 40 characters.
  if v_label is not null
     and (p_customer_id is not null or char_length(v_label) > 40) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Serializes approvals that may duplicate each other (released at commit).
  perform pg_advisory_xact_lock(hashtext(
    'payments:similar:' || coalesce(p_product_id::text, '') || ':'
    || coalesce(p_amount_agorot::text, '') || ':'
    || coalesce(p_payment_method_id::text, '')
  ));

  -- Lock order (AD-6): profiles before the session, the product and the
  -- payment.
  if p_customer_id is not null then
    select p.id into v_profile_id
    from public.profiles p
    where p.id = p_customer_id
      and p.anonymized_at is null
    for update;

    if v_profile_id is null then
      raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  if p_event_id is not null then
    perform 1
    from public.events e
    where e.id = p_event_id
    for update;
  end if;

  -- The price cannot change between this plan and the core's plan.
  perform 1
  from public.products p
  where p.id = p_product_id
  for share;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if (v_plan ->> 'price_changed')::boolean and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if p_duplicate_confirmed is not true
     and jsonb_array_length(private.similar_payments(
       p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
     )) > 0 then
    raise exception 'DUPLICATE_CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_payment_id := private.approve_payment_core(
    'manual', v_actor, 'admin', p_customer_id, p_product_id, p_event_id,
    p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id,
    p_reference, p_note, null, null, 'raise'
  );

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

  select b.id into v_booking_id
  from public.bookings b
  where b.payment_id = v_payment_id
    and b.status = 'confirmed';

  if v_entitlement.pinned_event_id is not null then
    v_pinned := jsonb_build_object(
      'event_id', v_entitlement.pinned_event_id,
      'booking_id', v_booking_id
    );
  end if;

  if p_customer_id is not null then
    -- The tip only for a card that can still be booked (not expired at
    -- approval, e.g. a back-dated purchase).
    if v_entitlement.kind = 'card'
       and private.local_day_end(v_entitlement.expires_on) > now() then
      select '. ' || t.body into v_card_tip
      from public.notification_templates t
      where t.type = 'purchase_new_card';
    end if;

    -- Last in the transaction (AD-6, AD-12).
    perform private.enqueue_notification(
      p_customer_id,
      'purchase_repeat',
      v_payment_id::text,
      jsonb_build_object(
        'product', v_plan ->> 'product_name',
        'expires_on', private.format_day_month(v_entitlement.expires_on),
        'card_tip', coalesce(v_card_tip, '')
      ),
      '/me'
    );

    return private.idempotent_finish(
      v_actor::text,
      'admin_approve_payment',
      p_idempotency_key,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'entitlement_id', v_entitlement.id,
        'customer_id', p_customer_id,
        'expires_on', v_entitlement.expires_on,
        'product_name', v_plan ->> 'product_name',
        'units', (v_plan ->> 'units')::integer
      ) || v_pinned
    );
  end if;

  -- The core does not know the label: set it here, audited (AD-19, masked
  -- by private.audit_diff).
  if v_label is not null then
    select pay.* into v_payment
    from public.payments pay
    where pay.id = v_payment_id
    for update;

    update public.payments
    set payer_label = v_label
    where id = v_payment_id
    returning * into v_payment_new;

    perform private.audit(
      v_actor, 'admin', 'admin_approve_payment', 'payments', v_payment_id,
      null, p_event_id, to_jsonb(v_payment), to_jsonb(v_payment_new)
    );
  end if;

  v_token := private.issue_token('join', null, v_payment_id);

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  perform private.audit(
    v_actor, 'admin', 'admin_approve_payment', 'activation_tokens', v_token_row.id,
    null, p_event_id, null, to_jsonb(v_token_row)
  );

  v_result := private.idempotent_finish(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'entitlement_id', v_entitlement.id,
      'customer_id', null,
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'expires_on', v_entitlement.expires_on,
      'reissue_required', true
    ) || v_pinned
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

-- As in 20261004072550, plus a pinned product: the code of
-- private.plan_pinned_placement is raised, as the approval would (AD-7).
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
  elsif v_plan ->> 'kind' = 'intro'
     and p_customer_id is not null
     and exists (
       select 1
       from public.entitlements e
       where e.customer_id = p_customer_id
         and e.kind = 'intro'
         and e.status = 'active'
     ) then
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

-- The sessions a pinned product can be approved for (the "session" field of
-- the approval form): published and not started, by start time. For each:
-- id, starts_at, kind, local_date and weekday (Jerusalem, 0 = Sunday), the
-- concept's name, occupied (private.occupied_places) and capacity. Admin
-- only; a read, so no idempotency key (AD-5).
create function public.admin_list_bookable_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'starts_at', e.starts_at,
        'kind', e.kind,
        'local_date', (e.starts_at at time zone 'Asia/Jerusalem')::date,
        'weekday', extract(dow from (e.starts_at at time zone 'Asia/Jerusalem'))::integer,
        'concept_name', c.name,
        'occupied', private.occupied_places(e.id),
        'capacity', e.capacity_adults
      )
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.status = 'published'
    and e.starts_at > now();

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: no API role executes them.
revoke execute on function private.has_participated(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_pinned_placement(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.place_pinned_booking(public.payments, public.entitlements, text, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_approve_payment(uuid, uuid, integer, date) from public, anon, authenticated, service_role;
revoke execute on function private.grant_from_payment(public.payments, public.products, jsonb, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.approve_payment_core(text, uuid, text, uuid, uuid, uuid, integer, text, date, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_funding(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) to authenticated;

revoke execute on function public.admin_list_bookable_events() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_bookable_events() to authenticated;
