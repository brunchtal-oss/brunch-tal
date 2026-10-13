-- Story 3.5, part 2 of 2: couple and intro bookings.
--
-- Runs after couple_type_and_index (the template row needs the new type).
-- Every redefinition below is re-based on the live DB: on 2026-10-13 each
-- matched the file named in its comment (md5 of prosrc). 3.8 redefines
-- private.bind_purchase too: its migration must start from this body and
-- keep the 3.5 change (the "already booked in this session" line).
--
-- 1. booking_confirmed_couple template (push, Tal edits it in the admin).
-- 2. set_booking_guest_details: the customer writes her companion's dietary
--    note on her confirmed couple booking until registration closes.
-- 3. private.notify_booking_confirmed: a couple booking gets
--    booking_confirmed_couple with a target on the note's section; the one
--    enqueuer, so self, admin, pinned approval and the deferred send in
--    bind_purchase each send exactly one notification.
-- 4. private.plan_funding: a card never funds a couple session, in every
--    mode (no couple offset, even by Tal).
-- 5. public.preview_book_session: a cancelled session returns
--    EVENT_CANCELLED with booked: true when she has a booking there
--    (confirmed / completed, or cancelled together with the session).
-- 6. public.get_my_bookings: + guest_details, guest_details_editable.
-- 7. private.bind_purchase: "already booked in this session" is any real
--    booking (private.is_real_booking: confirmed or completed), as the
--    rebuilt bookings_confirmed_customer_event_uidx.

-- ---------------------------------------------------------------------------
-- 1. The template
-- ---------------------------------------------------------------------------

insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'booking_confirmed_couple', 'customer', true, 'template',
  'ההרשמה אושרה',
  '{date} · {time} · בראנץ׳ {concept}. אפשר להוסיף בהרשמות שלך הגבלות תזונה או אלרגיות של המלווה',
  array['date', 'time', 'concept']
);

-- ---------------------------------------------------------------------------
-- 2. set_booking_guest_details
-- ---------------------------------------------------------------------------

-- The customer's companion's dietary note on her own confirmed couple
-- booking (CAP-11, 3.5). Never a name. Order: current_customer_id
-- (NOT_AUTHORIZED), idempotency, the text (trimmed, empty -> null, more than
-- 1000 -> INVALID_INPUT detail guest_details), her profile lock, the
-- booking read without a lock (not hers or missing -> NOT_FOUND), the
-- session lock, the booking lock and re-check (CONCURRENT_CHANGE), then
-- confirmed with party_size 2 (INVALID_INPUT detail booking) and
-- now() < the session's registration_closes_at (REGISTRATION_CLOSED).
-- The update is audited (private.audit_diff masks guest_details); an
-- unchanged text writes nothing. No notification. Result: {booking_id,
-- guest_details}.
create function public.set_booking_guest_details(
  p_booking_id uuid,
  p_guest_details text,
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
  v_customer uuid := (select private.current_customer_id());
  v_prev jsonb;
  v_text text;
  v_booking public.bookings;
  v_locked public.bookings;
  v_new public.bookings;
  v_closes_at timestamptz;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'set_booking_guest_details', p_idempotency_key,
    jsonb_build_object('booking_id', p_booking_id, 'guest_details', p_guest_details)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_text := nullif(btrim(coalesce(p_guest_details, '')), '');
  if char_length(v_text) > 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "guest_details"}';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.customer_id = v_customer;

  if v_booking.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select e.registration_closes_at into v_closes_at
  from public.events e
  where e.id = v_booking.event_id
  for update;

  select b.* into v_locked
  from public.bookings b
  where b.id = v_booking.id
  for update;

  if v_locked is distinct from v_booking then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_booking.status <> 'confirmed' or v_booking.party_size <> 2 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "booking"}';
  end if;

  if now() >= v_closes_at then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  if v_booking.guest_details is distinct from v_text then
    update public.bookings
    set guest_details = v_text
    where id = v_booking.id
    returning * into v_new;

    perform private.audit(
      v_actor, 'customer', 'set_booking_guest_details', 'bookings', v_booking.id,
      v_customer, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_new)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'set_booking_guest_details', p_idempotency_key,
    jsonb_build_object('booking_id', v_booking.id, 'guest_details', v_text)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3-7. Redefinitions
-- ---------------------------------------------------------------------------

-- 3. As in 20261004183409, plus the couple branch: party_size 2 ->
-- booking_confirmed_couple, target /me/bookings#booking-<id> (the
-- companion's note); otherwise booking_confirmed as before. Same
-- discriminator (the booking id) and vars for both. A null customer still
-- creates nothing (AD-23).
create or replace function private.notify_booking_confirmed(p_booking public.bookings)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
  v_concept text;
begin
  select e.starts_at, c.name into v_starts_at, v_concept
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_booking.event_id;

  perform private.enqueue_notification(
    p_booking.customer_id,
    case when p_booking.party_size = 2
      then 'booking_confirmed_couple'
      else 'booking_confirmed'
    end,
    p_booking.id::text,
    jsonb_build_object(
      'date', private.format_day_month((v_starts_at at time zone 'Asia/Jerusalem')::date),
      'time', to_char(v_starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      'concept', v_concept
    ),
    case when p_booking.party_size = 2
      then '/me/bookings#booking-' || p_booking.id::text
      else '/me/sessions/' || p_booking.event_id::text
    end
  );
end;
$$;

-- 4. As in 20261010184900, plus: a card is never offered for a couple
-- session in any mode (self, admin, move, online), not only self and
-- online. There is no couple offset, even by Tal.
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
    and not (e.kind = 'card' and v_event.kind = 'couple')
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
      and not (e.kind = 'card' and v_event.kind = 'couple')
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

-- 5. As in 20261010141240, plus a cancelled session: EVENT_CANCELLED with
-- booked true and her booking_id when she has a booking there (confirmed /
-- completed, or cancelled together with the session), booked false
-- otherwise. A session that is neither published, completed nor cancelled
-- stays EVENT_NOT_BOOKABLE. Everything else unchanged.
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

  -- A cancelled session (3.5): her booking there is a confirmed or
  -- completed one, or one cancelled together with the session (by
  -- admin_cancel_event, 3.8: cancel_core audits each of its bookings with
  -- that action). A booking she cancelled herself earlier is not hers here.
  if v_event.id is not null and v_event.status = 'cancelled' then
    if v_booking.id is null then
      select b.* into v_booking
      from public.bookings b
      where b.customer_id = v_customer
        and b.event_id = p_event_id
        and b.status = 'cancelled'
        and exists (
          select 1
          from public.audit_log a
          where a.entity_type = 'bookings'
            and a.entity_id = b.id
            and a.action = 'admin_cancel_event'
        )
      order by b.id
      limit 1;
    end if;

    if v_booking.id is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'EVENT_CANCELLED',
        'booked', true,
        'booking_id', v_booking.id
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'EVENT_CANCELLED', 'booked', false);
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
    'product_name', v_product_name,
    'units', v_units,
    'available_after', v_available - v_units,
    'expires_on', v_entitlement.expires_on,
    'cancel_deadline', v_cancel_deadline
  );
end;
$$;

-- 6. As in 20261010141240, plus per booking guest_details (the companion's
-- note) and guest_details_editable (confirmed, couple, before the
-- session's registration close: the rule set_booking_guest_details
-- checks). Every other field unchanged.
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
        'product_name', f.info ->> 'product_name',
        'guest_details', b.guest_details,
        'guest_details_editable', (b.status = 'confirmed' and b.party_size = 2 and now() < e.registration_closes_at)
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
        'product_name', f.info ->> 'product_name',
        'guest_details', b.guest_details,
        'guest_details_editable', (b.status = 'confirmed' and b.party_size = 2 and now() < e.registration_closes_at)
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

-- 7. As in 20261010141240 (if 3.8 was applied first: as in its migration),
-- plus: "already booked in this session" is any real booking of hers there
-- (private.is_real_booking: confirmed or completed), so a seat is never
-- bound to a customer who already took part in that session
-- (BIND_CONFLICT), as bookings_confirmed_customer_event_uidx now backs.
-- The deferred booking notification goes through
-- private.notify_booking_confirmed, so a couple seat gets
-- booking_confirmed_couple.
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
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_refund public.refund_requests;
  v_refund_new public.refund_requests;
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

  perform 1
  from public.cancellation_credits c
  where c.source_entitlement_id = v_entitlement.id
  order by c.id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  perform 1
  from public.refund_requests r
  where r.payment_id = p_payment_id
  order by r.id
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
       from public.cancellation_credits c
       where c.source_entitlement_id = v_entitlement.id
         and c.customer_id is not null
     )
     or exists (
       select 1
       from public.refund_requests r
       where r.payment_id = p_payment_id
         and r.customer_id is not null
     )
     or exists (
       select 1
       from public.bookings b
       join public.bookings other
         on other.event_id = b.event_id
        and other.customer_id = p_customer_id
        and private.is_real_booking(other.status)
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

  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
    order by c.id
  loop
    update public.cancellation_credits
    set customer_id = p_customer_id
    where id = v_credit.id
    returning * into v_credit_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'cancellation_credits', v_credit.id,
      p_customer_id, null, to_jsonb(v_credit), to_jsonb(v_credit_new)
    );
  end loop;

  for v_refund in
    select r.*
    from public.refund_requests r
    where r.payment_id = p_payment_id
    order by r.id
  loop
    update public.refund_requests
    set customer_id = p_customer_id
    where id = v_refund.id
    returning * into v_refund_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'refund_requests', v_refund.id,
      p_customer_id, null, to_jsonb(v_refund), to_jsonb(v_refund_new)
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

  -- A credit made while there was no customer (Tal cancelled the held
  -- place): its options are refreshed for her now (an option she already
  -- booked is replaced, an unfilled one may fill; the owner's path), and
  -- she hears about it: booking_cancelled_pinned for an active credit,
  -- booking_cancelled_refund for a refund request.
  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
      and c.status in ('active', 'refund_requested')
    order by c.id
  loop
    if v_credit.status = 'active' then
      perform private.refresh_credit_options(v_credit.id);
    end if;

    perform private.enqueue_notification(
      p_customer_id,
      case when v_credit.status = 'active'
        then 'booking_cancelled_pinned'
        else 'booking_cancelled_refund'
      end,
      'bind:' || v_credit.id::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.set_booking_guest_details(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_booking_guest_details(uuid, text, uuid) to authenticated;

revoke execute on function private.notify_booking_confirmed(public.bookings) from public, anon, authenticated, service_role;
revoke execute on function private.plan_funding(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;

revoke execute on function public.get_my_bookings() from public, anon, authenticated, service_role;
grant execute on function public.get_my_bookings() to authenticated;
