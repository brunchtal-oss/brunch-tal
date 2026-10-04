-- Story 3.2: self-booking tracer with a card (CAP-13, CAP-9).
-- Tables: bookings (AD-23: customer_id may be empty for a pinned purchase
-- that is not bound yet, and still counts in the capacity) and
-- booking_allocations (AD-18). FKs from entitlement_movements.booking_id and
-- entitlements.pinned_event_id.
-- Helpers: private.is_real_booking, private.occupied_places (the only sum of
-- party_size, AD-6), private.can_self_cancel (AD-20), private.plan_funding
-- (AD-18; the entitlement branch only until credits in 3.7),
-- private.book_core (the one booking writer, shared with 3.11) and
-- private.notify_booking_confirmed.
-- RPCs: book_session, preview_book_session, get_event_availability
-- (authenticated only, a label and never a number, AD-14).
-- Changed: private.bind_purchase binds the bookings of the payment (AD-23);
-- admin_update_event refuses a new time or kind while there are confirmed
-- bookings (EVENT_HAS_BOOKINGS, until the impact view of 3.8); the
-- booking_confirmed template gets "בראנץ׳ {concept}" (user decision
-- 2026-10-04; Hebrew stays in the template table, AD-5).
-- AD-5 grants and idempotency, AD-6 lock order, AD-8 time in SQL, AD-14
-- movements, AD-15 policy_snapshot, AD-19 audit, AD-20 snapshot.

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------

-- party_size: adults (couple = 2); babies are never counted. booked_by: who
-- made the booking (the customer herself, Tal, or the system for an online
-- purchase). policy_snapshot: cancel_window_hours and reminder_lead_hours
-- from business_settings at booking time (AD-15); a rule on an existing
-- booking reads only this. guest_details: the companion's dietary note only
-- (a couple booking, 3.5), never a name. A booking without a customer comes
-- only from a payment (AD-23).
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id),
  payment_id uuid references public.payments (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  party_size smallint not null check (party_size in (1, 2)),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed')),
  booked_by text not null check (booked_by in ('customer', 'admin', 'system')),
  confirmed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  guest_details text check (guest_details is null or char_length(guest_details) <= 1000),
  policy_snapshot jsonb not null
    check (
      jsonb_typeof(policy_snapshot) = 'object'
      and jsonb_typeof(policy_snapshot -> 'cancel_window_hours') = 'number'
      and jsonb_typeof(policy_snapshot -> 'reminder_lead_hours') = 'number'
    ),
  created_at timestamptz not null default now(),
  constraint bookings_cancelled_at_check
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint bookings_customer_or_payment_check
    check (customer_id is not null or payment_id is not null)
);

alter table public.bookings enable row level security;

-- One confirmed booking per customer and session (AD-6, AD-23).
create unique index bookings_confirmed_customer_event_uidx
  on public.bookings (customer_id, event_id)
  where status = 'confirmed' and customer_id is not null;
create index bookings_customer_id_idx on public.bookings (customer_id);
create index bookings_event_id_idx on public.bookings (event_id);
create index bookings_payment_id_idx on public.bookings (payment_id);

-- ---------------------------------------------------------------------------
-- booking_allocations (AD-18)
-- ---------------------------------------------------------------------------

-- How a booking was funded, exactly: one row per source. credit_id gets its
-- FK with cancellation_credits (3.7).
create table public.booking_allocations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  entitlement_id uuid references public.entitlements (id) on delete restrict,
  credit_id uuid,
  units integer not null check (units > 0),
  created_at timestamptz not null default now(),
  constraint booking_allocations_source_check
    check (num_nonnulls(entitlement_id, credit_id) = 1)
);

alter table public.booking_allocations enable row level security;

create index booking_allocations_booking_id_idx on public.booking_allocations (booking_id);
create index booking_allocations_entitlement_id_idx on public.booking_allocations (entitlement_id);
create index booking_allocations_credit_id_idx on public.booking_allocations (credit_id);

-- ---------------------------------------------------------------------------
-- FKs that waited for bookings and events
-- ---------------------------------------------------------------------------

alter table public.entitlement_movements
  add constraint entitlement_movements_booking_id_fkey
    foreign key (booking_id) references public.bookings (id) on delete restrict;

alter table public.entitlements
  add constraint entitlements_pinned_event_id_fkey
    foreign key (pinned_event_id) references public.events (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Policies and table grants (AD-5): reads only, no writes from the browser
-- ---------------------------------------------------------------------------

create policy bookings_authenticated_select on public.bookings
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

create policy booking_allocations_authenticated_select on public.booking_allocations
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.bookings b
      where b.id = booking_allocations.booking_id
        and b.customer_id = (select private.current_customer_id())
    )
  );

revoke all on table public.bookings from public, anon, authenticated, service_role;
grant select on table public.bookings to authenticated;

revoke all on table public.booking_allocations from public, anon, authenticated, service_role;
grant select on table public.booking_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- booking_confirmed: "בראנץ׳ {concept}"
-- ---------------------------------------------------------------------------

-- The session title is "בראנץ׳ {concept}" without a regular/couple label
-- (shared decision 2026-09-26, user decision 2026-10-04). No notification
-- was created from the previous wording, so the version stays.
update public.notification_templates
set body = '{date} · {time} · בראנץ׳ {concept}'
where type = 'booking_confirmed';

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The one definition of a "real" booking (reminders, completion, work sheet,
-- attendee lists, AD-6).
create function private.is_real_booking(p_status text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_status in ('confirmed', 'completed'), false);
$$;

-- The only place that sums party_size (AD-6): the adults of the confirmed
-- bookings of a session, including bookings without a customer (AD-23).
-- There is no stored counter.
create function private.occupied_places(p_event_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(b.party_size), 0)::integer
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed';
$$;

-- The single self-cancel boundary (AD-20): now() <= the deadline from the
-- booking's own snapshot. False for a booking that is not confirmed.
create function private.can_self_cancel(p_booking_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select b.status = 'confirmed'
        and now() <= private.cancel_deadline(
          (b.policy_snapshot ->> 'cancel_window_hours')::integer,
          e.starts_at
        )
      from public.bookings b
      join public.events e on e.id = b.event_id
      where b.id = p_booking_id
    ),
    false
  );
$$;

-- The only code that chooses how a booking is funded (AD-18). Modes: self,
-- admin, move, online. Until credits (3.7) only the entitlement branch: an
-- active entitlement of the customer for the session's kind, on the
-- session's local weekday (null = every day), valid on the session's local
-- date (valid_from <= date <= expires_on) and with available >= party size
-- (entitlement_balances), by expires_on and then id. A pinned entitlement
-- (validity_mode session) is never chosen in self or online and funds only
-- its pinned_event_id; a card is never offered for a couple session in self
-- or online (CAP-11). No match: ENTITLEMENT_EXPIRED_ON_DATE when one would
-- match except for the date, otherwise NO_MATCHING_ENTITLEMENT.
-- Result: {ok, code?, sources: [{kind: 'entitlement', id, units}]}.
create function private.plan_funding(
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
    and b.available >= p_party_size
    and e.valid_from <= v_day
    and v_day <= e.expires_on
  order by e.expires_on, e.id
  limit 1;

  if v_entitlement_id is not null then
    return jsonb_build_object(
      'ok', true,
      'sources', jsonb_build_array(
        jsonb_build_object('kind', 'entitlement', 'id', v_entitlement_id, 'units', p_party_size)
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
      and b.available >= p_party_size
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

-- booking_confirmed for a booking with a customer (a null customer creates
-- nothing, AD-23). {date} DD.MM and {time} HH:MM in Jerusalem, {concept}
-- the concept's name. Discriminator: the booking id.
create function private.notify_booking_confirmed(p_booking public.bookings)
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
    'booking_confirmed',
    p_booking.id::text,
    jsonb_build_object(
      'date', private.format_day_month((v_starts_at at time zone 'Asia/Jerusalem')::date),
      'time', to_char(v_starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      'concept', v_concept
    ),
    '/me/sessions/' || p_booking.event_id::text
  );
end;
$$;

-- The one writer of a booking (AD-20; book_session now, place_pinned_booking
-- in 3.11, move_booking later). Assumes the caller already holds the locks
-- (profile, event, entitlements, AD-6) and planned the funding; re-checks
-- the places and each source's balance. Writes the booking with its
-- policy_snapshot, an allocation and a negative reserve per source (AD-14),
-- the audit row (p_action) and booking_confirmed, in the caller's
-- transaction. p_actor_kind: customer | admin | system (also booked_by).
create function private.book_core(
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
    if v_source ->> 'kind' is distinct from 'entitlement'
       or jsonb_typeof(v_source -> 'units') <> 'number' then
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

-- As in 20261003141504, plus the bookings of the payment (AD-23): locked
-- after the profile and before the entitlement (AD-6). A confirmed booking
-- for a session the customer is already booked to -> BIND_CONFLICT, and
-- nothing is bound. Otherwise every booking of the payment gets the
-- customer, and booking_confirmed (skipped while there was no customer) is
-- enqueued for each confirmed one.
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

-- A signed-in customer books one session with her own entitlement (CAP-13).
-- Locks her profile (her mutex), then the session (AD-6), and checks in
-- order: published (EVENT_NOT_BOOKABLE), now() < registration_closes_at
-- (REGISTRATION_CLOSED), no confirmed booking of hers (ALREADY_BOOKED),
-- enough places for the party (EVENT_FULL), then plan_funding('self'); the
-- chosen entitlement is locked and the plan checked again (a different
-- source -> CONCURRENT_CHANGE). party_size: 2 for a couple session,
-- otherwise 1. A failure keeps no place and takes no entry. Result:
-- {booking_id}.
create function public.book_session(p_event_id uuid, p_idempotency_key uuid)
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

  if now() >= v_event.registration_closes_at then
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

-- The booking sheet (CAP-13): the same checks as book_session and
-- plan_funding('self'), without locks and without writing. Result: {ok,
-- code?, product_name, units, available_after, expires_on, cancel_deadline,
-- booked, can_self_cancel}. booked: she already has a confirmed booking for
-- the session; then cancel_deadline and can_self_cancel come from that
-- booking's snapshot (AD-20). Otherwise cancel_deadline is the one a new
-- booking would get. product_name, units, available_after and expires_on
-- only when ok. A session that is missing or not published ->
-- EVENT_NOT_BOOKABLE (a draft is never shown).
create function public.preview_book_session(p_event_id uuid)
returns jsonb
language plpgsql
stable
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
  v_available integer;
  v_product_name text;
  v_units integer;
  v_cancel_deadline timestamptz;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null or v_event.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_BOOKABLE', 'booked', false);
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.customer_id = v_customer
    and b.event_id = v_event.id
    and b.status = 'confirmed';

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
    return jsonb_build_object(
      'ok', false,
      'code', v_code,
      'booked', true,
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
    'product_name', v_product_name,
    'units', v_units,
    'available_after', v_available - v_units,
    'expires_on', v_entitlement.expires_on,
    'cancel_deadline', v_cancel_deadline
  );
end;
$$;

-- Availability for a signed-in user (AD-14, CAP-13): for each published
-- session among p_event_ids (at most 200), a label by the size of a booking
-- for it (couple = 2): full when the free places are fewer than that,
-- last_places when they are at most business_settings.last_places_threshold
-- (read now), otherwise available; and registration_open (now() <
-- registration_closes_at). Never a number. Other ids are left out. Result:
-- [{event_id, label, registration_open}].
create function public.get_event_availability(p_event_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold integer;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_event_ids is null or cardinality(p_event_ids) > 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.last_places_threshold into v_threshold from public.business_settings s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', f.id,
        'label', case
          when f.free < f.party then 'full'
          when f.free <= v_threshold then 'last_places'
          else 'available'
        end,
        'registration_open', now() < f.registration_closes_at
      )
      order by f.starts_at, f.id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      e.id,
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults - private.occupied_places(e.id) as free,
      case when e.kind = 'couple' then 2 else 1 end as party
    from public.events e
    where e.id = any (p_event_ids)
      and e.status = 'published'
  ) f;

  return v_result;
end;
$$;

-- As in 20261004143612, plus (deferred 3.1 #7): a new date, start time, end
-- time or kind while the session has a confirmed booking ->
-- EVENT_HAS_BOOKINGS, until the impact view of 3.8. Capacity, description,
-- the close and the display price still change. The row lock keeps
-- book_session out until the transaction ends.
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

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: no API role executes them.
revoke execute on function private.is_real_booking(text) from public, anon, authenticated, service_role;
revoke execute on function private.occupied_places(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.can_self_cancel(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_funding(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function private.notify_booking_confirmed(public.bookings) from public, anon, authenticated, service_role;
revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.book_session(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.book_session(uuid, uuid) to authenticated;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;

revoke execute on function public.get_event_availability(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_event_availability(uuid[]) to authenticated;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;
