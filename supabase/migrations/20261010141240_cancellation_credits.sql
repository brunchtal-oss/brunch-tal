-- Story 3.7: cancellation credits, alternative sessions and refund requests
-- (CAP-17, CAP-18, CAP-19, AD-14, AD-18, AD-20).
--
-- Runs right after 20261010141237_cancellation_credits_type_and_drops.sql,
-- in the same SQL Editor transaction (user decision 2026-10-10: applied and
-- merged on 2026-10-10, not on Tuesday).
--
-- Replaces the 3.6 stopgap (a cancelled pinned booking became a regular
-- entitlement): a cancelled pinned booking (single, intro, couple) always
-- becomes a cancellation credit; a refund is a credit row in
-- refund_requested with an open refund request (user decisions 2026-10-10).
-- The 3.6 "returned" entitlements stay regular entitlements and cancel like
-- a card (release).
--
-- 1. Tables cancellation_credits, credit_options, refund_requests, the FK
--    booking_allocations.credit_id; RLS select (own rows, admin), explicit
--    grants (select to authenticated only).
-- 2. Templates: booking_cancelled_pinned now means "credit";
--    booking_cancelled_refund is new (its type is added to the check in the
--    drops file).
-- 3. Helpers: private.monetary_basis, private.refresh_credit_options,
--    private.refresh_credits_for_event, private.refresh_customer_credits;
--    redefined private.booking_funding, private.needs_manual_cancel,
--    private.plan_funding, private.book_core, private.cancel_core (new
--    signature with p_choice; the old one is dropped in the drops file),
--    private.plan_admin_cancel_booking, private.bind_purchase,
--    private.job_complete_events.
-- 4. RPCs: cancel_booking (the choice), admin_cancel_booking (new signature
--    with p_choice), book_session, book_sessions, admin_book_customer and
--    their previews (lock and refresh her credits), admin_update_event
--    (capacity refreshes credits), get_my_bookings, get_my_entitlements,
--    get_my_credits (new), admin_get_home, admin_get_attention_items.
--
-- AD-5 grants and idempotency, AD-6 lock order (profiles -> events ->
-- bookings -> entitlements -> cancellation_credits -> credit_options ->
-- payments -> refund_requests), AD-7 one plan, AD-9 money in agorot, AD-12
-- notifications, AD-14 movements (a pinned cancel adds a `use`, never a
-- `release`), AD-19 audit, AD-23 rows without a customer.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One credit per cancelled pinned booking. customer_id is null while the
-- purchase is not bound (AD-23); private.bind_purchase fills it. status:
-- active (usable for one booking), used (its booking took place),
-- refund_requested (she chose a refund), refunded (3.9). choice_pending is
-- the business-cancel choice (3.8). options_count, origin_starts_at and
-- monetary_basis_agorot are fixed when the credit is created (AD-15, AD-20).
create table public.cancellation_credits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id),
  origin_booking_id uuid not null unique references public.bookings (id) on delete restrict,
  source_entitlement_id uuid not null references public.entitlements (id) on delete restrict,
  event_kind text not null check (event_kind in ('regular', 'couple')),
  party_size integer not null check (party_size in (1, 2)),
  options_count integer not null check (options_count >= 1),
  origin_starts_at timestamptz not null,
  original_cancelled_at timestamptz not null,
  monetary_basis_agorot integer not null check (monetary_basis_agorot >= 0),
  status text not null default 'active'
    check (status in ('active', 'used', 'refund_requested', 'refunded')),
  choice_pending boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.cancellation_credits enable row level security;

create index cancellation_credits_customer_id_idx on public.cancellation_credits (customer_id);
create index cancellation_credits_source_entitlement_id_idx on public.cancellation_credits (source_entitlement_id);
-- private.refresh_credits_for_event looks for active credits of a kind.
create index cancellation_credits_active_kind_idx
  on public.cancellation_credits (event_kind)
  where status = 'active';

-- The alternative sessions of a credit. active: she can book it with the
-- credit; used: she booked it with the credit; passed: its registration
-- closed unused (still one of the N); replaced: it became full, was
-- cancelled by the business, or she booked it without this credit, before
-- she used it (not one of the N, never comes back).
create table public.credit_options (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.cancellation_credits (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  state text not null default 'active'
    check (state in ('active', 'used', 'passed', 'replaced')),
  assigned_at timestamptz not null default now(),
  replaced_at timestamptz,
  replaced_reason text check (replaced_reason in ('full', 'event_cancelled', 'booked')),
  constraint credit_options_credit_event_key unique (credit_id, event_id),
  constraint credit_options_replaced_check
    check (
      (state = 'replaced') = (replaced_at is not null)
      and (state = 'replaced') = (replaced_reason is not null)
    )
);

alter table public.credit_options enable row level security;

create index credit_options_event_id_idx on public.credit_options (event_id);

-- A refund she asked for. One per credit; the completion fields stay null
-- while requested (3.9 completes it).
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id),
  credit_id uuid not null unique references public.cancellation_credits (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  amount_agorot integer not null check (amount_agorot >= 0),
  status text not null default 'requested' check (status in ('requested', 'completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  reference text check (reference is null or char_length(reference) <= 200),
  handled_by uuid,
  constraint refund_requests_completion_check
    check (
      (status = 'requested' and completed_at is null and reference is null and handled_by is null)
      or (status = 'completed' and completed_at is not null)
    )
);

alter table public.refund_requests enable row level security;

create index refund_requests_customer_id_idx on public.refund_requests (customer_id);
create index refund_requests_payment_id_idx on public.refund_requests (payment_id);
create index refund_requests_booking_id_idx on public.refund_requests (booking_id);
create index refund_requests_open_idx
  on public.refund_requests (requested_at)
  where status = 'requested';

-- The FK that waited for the credits (20261004183409).
alter table public.booking_allocations
  add constraint booking_allocations_credit_id_fkey
    foreign key (credit_id) references public.cancellation_credits (id) on delete restrict;

-- Policies: her own rows, or the admin. Reads only; every write is an RPC.
create policy cancellation_credits_authenticated_select on public.cancellation_credits
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

create policy credit_options_authenticated_select on public.credit_options
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.cancellation_credits c
      where c.id = credit_options.credit_id
        and c.customer_id = (select private.current_customer_id())
    )
  );

create policy refund_requests_authenticated_select on public.refund_requests
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

revoke all on table public.cancellation_credits from public, anon, authenticated, service_role;
grant select on table public.cancellation_credits to authenticated;

revoke all on table public.credit_options from public, anon, authenticated, service_role;
grant select on table public.credit_options to authenticated;

revoke all on table public.refund_requests from public, anon, authenticated, service_role;
grant select on table public.refund_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Templates (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- booking_cancelled_pinned now means "a credit" (also a second cancel of a
-- credit-funded booking). Notifications were created from the 3.6 body, so
-- the version goes up. Vars: {date} (DD.MM of the cancelled session).
update public.notification_templates
set title = 'ההרשמה ל{date} בוטלה',
    body = 'קיבלת זיכוי להרשמה לאחד המפגשים המתאימים הבאים. אפשר לבחור מפגש בהרשמות שלך',
    allowed_vars = array['date'],
    version = version + 1,
    updated_at = now()
where type = 'booking_cancelled_pinned';

-- A pinned booking cancelled with a refund request. Vars: {date}.
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'booking_cancelled_refund', 'customer', false, 'template',
  'ההרשמה ל{date} בוטלה',
  'בקשת ההחזר התקבלה. נעדכן אותך כשההחזר יבוצע',
  array['date']
);

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- What a booking was worth, in agorot (AD-20): for each allocation from an
-- entitlement, its payment's amount times units over the entitlement's
-- original units (integer division); for an allocation from a credit, that
-- credit's own basis. Read once, when a credit is created.
create function private.monetary_basis(p_booking_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    case
      when a.entitlement_id is not null
        then (p.amount_agorot::bigint * a.units) / e.original_units
      else c.monetary_basis_agorot
    end
  ), 0)::integer
  from public.booking_allocations a
  left join public.entitlements e on e.id = a.entitlement_id
  left join public.payments p on p.id = e.payment_id
  left join public.cancellation_credits c on c.id = a.credit_id
  where a.booking_id = p_booking_id;
$$;

-- How a booking was funded, for the screens and the cancel: {funding,
-- entitlement_id, credit_id, product_name}. funding: 'credit' (a
-- cancellation credit), 'pinned' (the booking of a pinned entitlement's own
-- session), 'card' (any other entitlement, a 3.6 returned one too). The
-- first allocation by id; null without one. product_name is the purchase's
-- (for a credit, its source entitlement's).
create or replace function private.booking_funding(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'funding', case
      when a.credit_id is not null then 'credit'
      when e.pinned_event_id is not null and e.pinned_event_id = b.event_id then 'pinned'
      else 'card'
    end,
    'entitlement_id', e.id,
    'credit_id', a.credit_id,
    'product_name', p.product_snapshot ->> 'name'
  )
  from public.bookings b
  join public.booking_allocations a on a.booking_id = b.id
  left join public.cancellation_credits c on c.id = a.credit_id
  join public.entitlements e on e.id = coalesce(a.entitlement_id, c.source_entitlement_id)
  join public.payments p on p.id = e.payment_id
  where b.id = p_booking_id
  order by a.id
  limit 1;
$$;

-- More than one kind of entitlement (a couple booking offset from a card
-- and an addition): Tal handles it by hand (AD-20). A credit allocation is
-- cancelled normally since 3.7.
create or replace function private.needs_manual_cancel(p_booking_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (
    select count(distinct e.kind)
    from public.booking_allocations a
    join public.entitlements e on e.id = a.entitlement_id
    where a.booking_id = p_booking_id
  ) > 1;
$$;

-- Keeps a credit's alternative sessions current (AD-14, CAP-18).
-- Idempotent, exempt from idempotency (AD-5). Assumes the caller holds the
-- credit's lock. Runs only for an active credit, not choice_pending, with
-- no confirmed booking funded by it (she already used it for a booking:
-- nothing moves, no extension).
-- (1) Each active option, by starts_at: its session cancelled -> replaced
--     (event_cancelled); she (the credit's customer) has a confirmed
--     booking there, funded otherwise -> replaced (booked); its
--     registration closed -> passed (still one of the N); no room for the
--     party -> replaced (full). A replaced option never comes back (a later
--     free place does not undo it).
-- (2) Only with p_fill (the owner's paths; a refresh for another
--     customer's change never inserts options, so it never takes a lock on
--     another session, AD-6): while the options in (active, used, passed)
--     are fewer than options_count: the next published session (starts_at, id) of the
--     credit's kind that starts after the cancelled session
--     (origin_starts_at), still open for registration, with room for the
--     party, not the cancelled session, not already an option of this
--     credit in any state, and not a session she has a confirmed booking
--     to. Fewer found: the credit waits.
create function private.refresh_credit_options(
  p_credit_id uuid,
  p_fill boolean default true
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
  v_origin_event uuid;
  v_option record;
  v_counted integer;
  v_event_id uuid;
begin
  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null
     or v_credit.status <> 'active'
     or v_credit.choice_pending then
    return;
  end if;

  if exists (
    select 1
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where a.credit_id = v_credit.id
      and b.status = 'confirmed'
  ) then
    return;
  end if;

  -- (1)
  for v_option in
    select
      o.id,
      e.status as event_status,
      e.registration_closes_at,
      e.capacity_adults,
      e.id as event_id
    from public.credit_options o
    join public.events e on e.id = o.event_id
    where o.credit_id = v_credit.id
      and o.state = 'active'
    order by e.starts_at, e.id
    for update of o
  loop
    if v_option.event_status = 'cancelled' then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'event_cancelled'
      where id = v_option.id;
    elsif v_credit.customer_id is not null and exists (
      select 1
      from public.bookings b
      where b.customer_id = v_credit.customer_id
        and b.event_id = v_option.event_id
        and b.status = 'confirmed'
    ) then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'booked'
      where id = v_option.id;
    elsif v_option.event_status = 'completed'
       or now() >= v_option.registration_closes_at then
      update public.credit_options
      set state = 'passed'
      where id = v_option.id;
    elsif private.occupied_places(v_option.event_id) + v_credit.party_size
          > v_option.capacity_adults then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'full'
      where id = v_option.id;
    end if;
  end loop;

  -- (2)
  if not coalesce(p_fill, true) then
    return;
  end if;

  select b.event_id into v_origin_event
  from public.bookings b
  where b.id = v_credit.origin_booking_id;

  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('active', 'used', 'passed');

  while v_counted < v_credit.options_count loop
    v_event_id := null;

    select e.id into v_event_id
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
        where b.customer_id = v_credit.customer_id
          and b.event_id = e.id
          and b.status = 'confirmed'
      )
    order by e.starts_at, e.id
    limit 1;

    exit when v_event_id is null;

    insert into public.credit_options (credit_id, event_id)
    values (v_credit.id, v_event_id);

    v_counted := v_counted + 1;
  end loop;
end;
$$;

-- A session's places or status changed (a booking, a cancel, a capacity
-- change): every active credit (not choice_pending) with an active option
-- in it gets step (1) of private.refresh_credit_options (the states only,
-- p_fill false). It never inserts options: a non-owner path that inserted
-- an option for another session would take a key-share lock on it, and
-- could wait on a customer who holds that session and waits on this credit
-- (a deadlock across customers). Filling happens only on the owner's paths
-- (her booking RPCs, the cancel of her booking, the previews,
-- get_my_credits, bind_purchase). Credits held by another transaction are
-- skipped (for update skip locked): their owner's next view or booking
-- refreshes them again. The caller holds the session's lock.
create function private.refresh_credits_for_event(p_event_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select c.id
    from public.cancellation_credits c
    where c.status = 'active'
      and not c.choice_pending
      and exists (
        select 1
        from public.credit_options o
        where o.credit_id = c.id
          and o.event_id = p_event_id
          and o.state = 'active'
      )
    order by c.id
    for update of c skip locked
  loop
    perform private.refresh_credit_options(v_id, false);
  end loop;
end;
$$;

-- The owner's paths (her bookings, previews, get_my_credits): her profile
-- (the customer's mutex, AD-6), then her active credits by id, each
-- refreshed. A caller that already holds her profile and her sessions and
-- entitlements calls it after them (the lock order).
create function private.refresh_customer_credits(p_customer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_customer_id is null then
    return;
  end if;

  perform 1
  from public.profiles p
  where p.id = p_customer_id
  for update;

  for v_id in
    select c.id
    from public.cancellation_credits c
    where c.customer_id = p_customer_id
      and c.status = 'active'
      and not c.choice_pending
    order by c.id
    for update
  loop
    perform private.refresh_credit_options(v_id);
  end loop;
end;
$$;

-- As in 20261004212706, plus (AD-18, every mode) first a credit: her active
-- credit, not choice_pending, not funding a confirmed booking, of the same
-- party size, with an active option in this session (created_at, id). Its
-- source: {kind: 'credit', id, units: 1}. Then the entitlements as before.
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

  -- (1) A credit whose active option is this session.
  select c.id into v_credit_id
  from public.cancellation_credits c
  where c.customer_id = p_customer_id
    and c.status = 'active'
    and not c.choice_pending
    and c.party_size = p_party_size
    and exists (
      select 1
      from public.credit_options o
      where o.credit_id = c.id
        and o.event_id = v_event.id
        and o.state = 'active'
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

-- As in 20261004191220, plus a credit source (AD-18): the credit is
-- re-checked (hers, active, not choice_pending, the party size, not funding
-- a confirmed booking, an active option in this session; otherwise
-- CONCURRENT_CHANGE), the allocation carries credit_id, the option becomes
-- used, and no movement is written. After the allocations the session's
-- credits are refreshed (private.refresh_credits_for_event), since its
-- places changed. Assumes the caller holds the locks (AD-6).
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
         or not exists (
           select 1
           from public.credit_options o
           where o.credit_id = v_credit.id
             and o.event_id = v_event.id
             and o.state = 'active'
         ) then
        raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
      end if;

      insert into public.booking_allocations (booking_id, credit_id, units)
      values (v_booking.id, v_credit.id, 1);

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

-- The one writer of a cancellation (AD-20). Assumes the caller holds the
-- locks (profile, session, booking, entitlements, credit, AD-6) and
-- re-checks: the booking is confirmed (BOOKING_NOT_CANCELLABLE), one kind
-- of entitlement (MANUAL_HANDLING_REQUIRED), and the choice
-- (INVALID_INPUT, detail choice): a pinned booking needs p_choice in
-- ('refund', 'credit'), any other booking a null one.
-- Writes: status cancelled with cancelled_at, then by the funding:
-- - card (a 3.6 returned entitlement too): a release of +units per
--   allocation to the same entitlement (no extension). Outcome 'card'.
-- - pinned: no release; a `use` movement (units 0, booking_id) closes the
--   reserve; a credit with options_count = greatest(credit_options_count,
--   1) read now, origin_starts_at = the session's starts_at,
--   monetary_basis_agorot = private.monetary_basis (once). 'credit': the
--   credit is active and its options fill; outcome 'credit'. 'refund': the
--   credit is refund_requested with a refund request (amount = the basis,
--   requested) and no options; outcome 'refund'.
-- - credit: the same credit is usable again (its used option in this
--   session back to active, then refreshed); never a new cycle. Outcome
--   'credit'.
-- Then the session's credits are refreshed (a place was freed), the audit
-- row (p_action, p_reason), and the notification booking_cancelled /
-- booking_cancelled_pinned / booking_cancelled_refund with {date}, the
-- audit id as discriminator, to /me/bookings (nothing for a booking without
-- a customer, AD-23). Result: {booking_id, outcome, entitlement_id?,
-- credit_id?, refund_request_id?}.
create function private.cancel_core(
  p_booking_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_reason text,
  p_choice text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_new public.bookings;
  v_event public.events;
  v_day date;
  v_funding text;
  v_alloc public.booking_allocations;
  v_entitlement public.entitlements;
  v_settings public.business_settings;
  v_credit public.cancellation_credits;
  v_refund public.refund_requests;
  v_outcome text;
  v_entitlement_id uuid;
  v_credit_id uuid;
  v_refund_id uuid;
  v_audit_id uuid;
begin
  if p_actor_kind is null or p_actor_kind not in ('customer', 'admin', 'system')
     or p_action is null or btrim(p_action) = '' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  if private.needs_manual_cancel(v_booking.id) then
    raise exception 'MANUAL_HANDLING_REQUIRED' using errcode = 'P0001';
  end if;

  v_funding := coalesce(private.booking_funding(v_booking.id) ->> 'funding', 'card');

  if v_funding = 'pinned' then
    if p_choice is null or p_choice not in ('refund', 'credit') then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "choice"}';
    end if;
  elsif p_choice is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;
  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = v_booking.id
  returning * into v_new;

  if v_funding = 'card' then
    v_outcome := 'card';
    for v_alloc in
      select a.*
      from public.booking_allocations a
      where a.booking_id = v_booking.id
      order by a.id
    loop
      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values (v_alloc.entitlement_id, v_booking.id, 'release', v_alloc.units, p_actor_id);
      v_entitlement_id := v_alloc.entitlement_id;
    end loop;

  elsif v_funding = 'pinned' then
    -- The reserve is closed as used; the value moves to the credit.
    for v_alloc in
      select a.*
      from public.booking_allocations a
      where a.booking_id = v_booking.id
      order by a.id
    loop
      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values (v_alloc.entitlement_id, v_booking.id, 'use', 0, p_actor_id);
      v_entitlement_id := coalesce(v_entitlement_id, v_alloc.entitlement_id);
    end loop;

    select e.* into v_entitlement
    from public.entitlements e
    where e.id = v_entitlement_id;

    select s.* into v_settings from public.business_settings s;

    insert into public.cancellation_credits (
      customer_id, origin_booking_id, source_entitlement_id, event_kind,
      party_size, options_count, origin_starts_at, original_cancelled_at,
      monetary_basis_agorot, status
    )
    values (
      v_booking.customer_id, v_booking.id, v_entitlement.id, v_event.kind,
      v_booking.party_size, greatest(v_settings.credit_options_count, 1),
      v_event.starts_at, now(),
      private.monetary_basis(v_booking.id),
      case when p_choice = 'refund' then 'refund_requested' else 'active' end
    )
    returning * into v_credit;
    v_credit_id := v_credit.id;

    perform private.audit(
      p_actor_id, p_actor_kind, p_action, 'cancellation_credits', v_credit.id,
      v_credit.customer_id, v_event.id, null, to_jsonb(v_credit), p_reason
    );

    if p_choice = 'refund' then
      insert into public.refund_requests (
        customer_id, credit_id, payment_id, booking_id, amount_agorot
      )
      values (
        v_booking.customer_id, v_credit.id, v_entitlement.payment_id,
        v_booking.id, v_credit.monetary_basis_agorot
      )
      returning * into v_refund;
      v_refund_id := v_refund.id;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'refund_requests', v_refund.id,
        v_refund.customer_id, v_event.id, null, to_jsonb(v_refund), p_reason
      );
      v_outcome := 'refund';
    else
      v_outcome := 'credit';
    end if;

  else
    -- funding = 'credit': the same credit, the same options (CAP-18).
    select a.credit_id into v_credit_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
      and a.credit_id is not null
    order by a.id
    limit 1;

    update public.credit_options
    set state = 'active'
    where credit_id = v_credit_id
      and event_id = v_booking.event_id
      and state = 'used';

    v_outcome := 'credit';
  end if;

  v_audit_id := private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    v_booking.customer_id, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_new), p_reason
  );

  if v_outcome = 'credit' then
    perform private.refresh_credit_options(v_credit_id);
  end if;

  -- A place was freed in this session.
  perform private.refresh_credits_for_event(v_booking.event_id);

  -- Last in the transaction (AD-6, AD-12); a null customer creates nothing.
  perform private.enqueue_notification(
    v_booking.customer_id,
    case v_outcome
      when 'card' then 'booking_cancelled'
      when 'refund' then 'booking_cancelled_refund'
      else 'booking_cancelled_pinned'
    end,
    v_audit_id::text,
    jsonb_build_object('date', private.format_day_month(v_day)),
    '/me/bookings'
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'booking_id', v_booking.id,
    'outcome', v_outcome,
    'entitlement_id', v_entitlement_id,
    'credit_id', v_credit_id,
    'refund_request_id', v_refund_id
  ));
end;
$$;

-- What Tal's cancellation will do (AD-7: the preview and the action run this
-- one plan). Refusals, in order: a booking that is missing or not confirmed
-- (BOOKING_NOT_CANCELLABLE); its session ended (EVENT_ENDED); more than one
-- kind of entitlement (MANUAL_HANDLING_REQUIRED). Result: {ok, code?} or
-- {ok, booking_id, event_id, starts_at, concept_name, pending_join,
-- customer_name?, outcome ('card'|'credit'), funding
-- ('card'|'pinned'|'credit'), product_name, within_window (she can no
-- longer cancel by herself), choice_required (a pinned booking she could
-- still cancel herself: Tal chooses refund or credit), options_count (N of
-- the new credit, or of the funding credit), amount_agorot (a pinned
-- booking: what a refund request would be), expires_on (a card's)}.
create or replace function private.plan_admin_cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event public.events;
  v_concept text;
  v_name text;
  v_funding jsonb;
  v_kind text;
  v_entitlement public.entitlements;
  v_credit public.cancellation_credits;
  v_n integer;
  v_can_self boolean;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CANCELLABLE');
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;

  if v_event.ends_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_ENDED');
  end if;

  if private.needs_manual_cancel(v_booking.id) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select p.full_name into v_name
  from public.profiles p
  where p.id = v_booking.customer_id
    and p.activated_at is not null
    and p.anonymized_at is null;

  v_funding := private.booking_funding(v_booking.id);
  v_kind := coalesce(v_funding ->> 'funding', 'card');
  v_can_self := private.can_self_cancel(v_booking.id);

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = (v_funding ->> 'entitlement_id')::uuid;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = (v_funding ->> 'credit_id')::uuid;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'event_id', v_event.id,
    'starts_at', v_event.starts_at,
    'concept_name', v_concept,
    'pending_join', v_booking.customer_id is null,
    'customer_name', v_name,
    'outcome', case when v_kind = 'card' then 'card' else 'credit' end,
    'funding', v_kind,
    'product_name', v_funding ->> 'product_name',
    'within_window', not v_can_self,
    'choice_required', v_kind = 'pinned' and v_can_self,
    'options_count', case when v_kind = 'credit' then v_credit.options_count else v_n end,
    'amount_agorot', case when v_kind = 'pinned' then private.monetary_basis(v_booking.id) end,
    'expires_on', case when v_kind = 'card' then v_entitlement.expires_on end
  ));
end;
$$;

-- As in 20261004221450, plus the credits and refund requests of the
-- purchase (AD-10): locked after its entitlement and after its payment
-- (AD-6), part of the "already bound" conflict, moved to the customer with
-- an audit row each; each moved active credit is refreshed for her
-- (private.refresh_credit_options, the owner's path), and she gets
-- booking_cancelled_pinned for each moved active credit and
-- booking_cancelled_refund for each moved refund_requested one
-- (discriminator bind:<credit_id>, vars {date}), skipped at the cancel
-- because there was no customer (AD-23).
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

-- As in 20261006142736, plus (3.7) a credit that funded a booking of the
-- session becomes used: after the entitlements, its credits are locked by id
-- with for update skip locked; one held by another transaction fails this
-- session's block (rolled back, tried again on the next run), so a credit is
-- never left active with a completed booking. Each change is audited
-- (actor system). Credits get no movement.
create or replace function private.job_complete_events()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_event_new public.events;
  v_count integer := 0;
  v_credit_ids uuid[];
  v_locked integer;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
begin
  for v_event in
    select e.*
    from public.events e
    where e.status = 'published'
      and e.ends_at <= now()
    order by e.id
    for update skip locked
  loop
    begin
      perform 1
      from public.bookings b
      where b.event_id = v_event.id
        and b.status = 'confirmed'
      order by b.id
      for update;

      perform 1
      from public.entitlements en
      where en.id in (
        select a.entitlement_id
        from public.booking_allocations a
        join public.bookings b on b.id = a.booking_id
        where b.event_id = v_event.id
          and b.status = 'confirmed'
          and a.entitlement_id is not null
      )
      order by en.id
      for update;

      select coalesce(array_agg(distinct a.credit_id), '{}'::uuid[]) into v_credit_ids
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      where b.event_id = v_event.id
        and b.status = 'confirmed'
        and a.credit_id is not null;

      if cardinality(v_credit_ids) > 0 then
        select count(*)::integer into v_locked
        from (
          select c.id
          from public.cancellation_credits c
          where c.id = any (v_credit_ids)
          order by c.id
          for update skip locked
        ) x;

        if v_locked < cardinality(v_credit_ids) then
          raise exception 'CREDIT_LOCKED';
        end if;
      end if;

      insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
      select distinct a.entitlement_id, b.id, 'use', 0
      from public.bookings b
      join public.booking_allocations a on a.booking_id = b.id
      where b.event_id = v_event.id
        and b.status = 'confirmed'
        and a.entitlement_id is not null
        and not exists (
          select 1
          from public.entitlement_movements m
          where m.booking_id = b.id
            and m.entitlement_id = a.entitlement_id
            and m.action = 'use'
        );

      for v_credit in
        select c.*
        from public.cancellation_credits c
        where c.id = any (v_credit_ids)
          and c.status = 'active'
        order by c.id
      loop
        update public.cancellation_credits
        set status = 'used'
        where id = v_credit.id
        returning * into v_credit_new;

        perform private.audit(
          null, 'system', 'complete_event', 'cancellation_credits', v_credit.id,
          v_credit.customer_id, v_event.id, to_jsonb(v_credit), to_jsonb(v_credit_new)
        );
      end loop;

      update public.bookings
      set status = 'completed'
      where event_id = v_event.id
        and status = 'confirmed';

      update public.events
      set status = 'completed'
      where id = v_event.id
      returning * into v_event_new;

      perform private.audit(
        null, 'system', 'complete_event', 'events', v_event.id,
        null, v_event.id, to_jsonb(v_event), to_jsonb(v_event_new)
      );

      v_count := v_count + 1;
    exception when others then
      raise warning 'job_complete_events: event % failed: % %',
        v_event.id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- A signed-in customer cancels her own confirmed booking (CAP-16, CAP-17).
-- Order: current_customer_id (NOT_AUTHORIZED), idempotency, a choice other
-- than refund / credit (INVALID_INPUT, detail choice), her profile lock, the
-- booking read without a lock (not hers, missing or not confirmed ->
-- BOOKING_NOT_CANCELLABLE), the session lock, the booking lock and re-check
-- (CONCURRENT_CHANGE), private.can_self_cancel (SELF_CANCEL_CLOSED), the
-- entitlements of its allocations by id, the credit of its allocation;
-- then the choice: a pinned booking needs refund or credit, a card-,
-- returned- or credit-funded one none (INVALID_INPUT, detail choice); then
-- private.cancel_core. Result: cancel_core's.
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_idempotency_key uuid,
  p_choice text default null
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
  v_booking public.bookings;
  v_locked public.bookings;
  v_funding text;
  v_result jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'cancel_booking', p_idempotency_key,
    jsonb_build_object('booking_id', p_booking_id, 'choice', p_choice)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_choice is not null and p_choice not in ('refund', 'credit') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.customer_id = v_customer;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  perform 1
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

  if not private.can_self_cancel(v_booking.id) then
    raise exception 'SELF_CANCEL_CLOSED' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.id in (
    select a.entitlement_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
  )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
  )
  order by c.id
  for update;

  v_funding := coalesce(private.booking_funding(v_booking.id) ->> 'funding', 'card');
  if (v_funding = 'pinned') <> (p_choice is not null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  v_result := private.cancel_core(
    v_booking.id, v_actor, 'customer', 'cancel_booking', null, p_choice
  );

  return private.idempotent_finish(
    v_actor::text, 'cancel_booking', p_idempotency_key, v_result
  );
end;
$$;

-- Tal cancels a confirmed booking (CAP-17, sensitive, also inside the
-- window, also a booking without a customer, until the session ends).
-- Order: is_admin, idempotency, the reason (optional, at most 2000) and a
-- choice other than refund / credit (INVALID_INPUT), the customer read
-- without a lock and her profile locked (when there is one), the booking
-- read, the session lock, the booking lock and re-check (CONCURRENT_CHANGE),
-- the entitlements by id, the credit of its allocation,
-- private.plan_admin_cancel_booking (its code is raised), the choice (a
-- pinned booking she could still cancel herself -- choice_required -- needs
-- refund or credit; any other booking none; INVALID_INPUT, detail choice),
-- p_confirmed (CONFIRM_REQUIRED), private.cancel_core with the reason and
-- the choice (a pinned booking inside the window: credit). Result:
-- cancel_core's. Replaces the 4-argument signature (dropped in the drops
-- file).
create function public.admin_cancel_booking(
  p_booking_id uuid,
  p_confirmed boolean,
  p_idempotency_key uuid,
  p_reason text default null,
  p_choice text default null
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
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_booking public.bookings;
  v_locked public.bookings;
  v_plan jsonb;
  v_choice text;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_cancel_booking', p_idempotency_key,
    jsonb_build_object(
      'booking_id', p_booking_id,
      'confirmed', p_confirmed,
      'reason', v_reason,
      'choice', p_choice
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  if p_choice is not null and p_choice not in ('refund', 'credit') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  select b.customer_id into v_customer
  from public.bookings b
  where b.id = p_booking_id;

  if v_customer is not null then
    perform 1
    from public.profiles p
    where p.id = v_customer
    for update;
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null or v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  if v_booking.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
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

  perform 1
  from public.entitlements e
  where e.id in (
    select a.entitlement_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
  )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    where a.booking_id = v_booking.id
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_cancel_booking(v_booking.id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if coalesce((v_plan ->> 'choice_required')::boolean, false) <> (p_choice is not null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "choice"}';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  -- A pinned booking inside the window becomes a credit (no choice).
  v_choice := case
    when v_plan ->> 'funding' = 'pinned' then coalesce(p_choice, 'credit')
  end;

  v_result := private.cancel_core(
    v_booking.id, v_actor, 'admin', 'admin_cancel_booking', v_reason, v_choice
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_cancel_booking', p_idempotency_key, v_result
  );
end;
$$;

-- As in 20261005171826, with the lock order of 3.7 (AD-6): her profile,
-- the session, her active entitlements by id, her active credits by id
-- (refreshed, private.refresh_customer_credits), then plan_funding and the
-- re-check. A credit source is booked like an entitlement.
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

  perform 1
  from public.entitlements e
  where e.customer_id = v_customer
    and e.status = 'active'
  order by e.id
  for update;

  perform private.refresh_customer_credits(v_customer);

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

-- As in 20261005171826, with the lock order of 3.7 (AD-6): her profile,
-- the sessions by id, her active entitlements by id (all of them, a pinned
-- one too), her active credits by id (refreshed). Each date as before.
create or replace function public.book_sessions(p_items uuid[], p_idempotency_key uuid)
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
  order by e.id
  for update;

  perform private.refresh_customer_credits(v_customer);

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

-- As in 20261005193624, with the lock order of 3.7 (AD-6): her profile,
-- the session, her active entitlements by id, her active credits by id
-- (refreshed), then plan_funding('admin') and the re-check.
create or replace function public.admin_book_customer(
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

  perform 1
  from public.entitlements e
  where e.customer_id = v_customer
    and e.status = 'active'
  order by e.id
  for update;

  perform private.refresh_customer_credits(v_customer);

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

-- As in 20261005193624, now volatile: the customer's credits are locked and
-- refreshed first (private.refresh_customer_credits); a credit source shows
-- its purchase's product_name and no expires_on, with source 'credit'
-- (otherwise 'entitlement').
create or replace function public.preview_admin_book_customer(
  p_customer_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
volatile
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
  v_source jsonb;
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

  perform private.refresh_customer_credits(v_customer);

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

  v_source := v_plan -> 'sources' -> 0;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = case
    when v_source ->> 'kind' = 'credit' then (
      select c.source_entitlement_id
      from public.cancellation_credits c
      where c.id = (v_source ->> 'id')::uuid
    )
    else (v_source ->> 'id')::uuid
  end;

  select pay.product_snapshot ->> 'name' into v_product_name
  from public.payments pay
  where pay.id = v_entitlement.payment_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'source', v_source ->> 'kind',
    'product_name', v_product_name,
    'expires_on', case when v_source ->> 'kind' = 'entitlement' then v_entitlement.expires_on end,
    'occupied', v_occupied,
    'capacity', v_event.capacity_adults
  ));
end;
$$;

-- As in 20261006111121, now volatile: her credits are locked and refreshed
-- first (private.refresh_customer_credits). The booked state's funding is
-- 'card', 'pinned' or 'credit' (a 3.6 returned entry is 'card'). A bookable
-- date funded by a credit: {ok, booked: false, source: 'credit',
-- credit_id, product_name (the purchase the credit came from),
-- origin_starts_at (the cancelled session), units: 1, cancel_deadline};
-- one funded by an entitlement carries source 'entitlement' and every value
-- as before.
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
    'product_name', v_product_name,
    'units', v_units,
    'available_after', v_available - v_units,
    'expires_on', v_entitlement.expires_on,
    'cancel_deadline', v_cancel_deadline
  );
end;
$$;

-- As in 20261005234204, now volatile (it calls preview_book_session, which
-- refreshes her credits), and available also counts her credits that can
-- fund one of these dates (active, not choice_pending, not funding a
-- confirmed booking, with an active option among p_items), one each.
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
    and exists (
      select 1
      from public.credit_options o
      where o.credit_id = c.id
        and o.state = 'active'
        and o.event_id = any (p_items)
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

-- As in 20261005111717, plus: a capacity change refreshes the session's
-- credits (an option that became full moves on; a waiting credit takes
-- new room on its owner's next view), in the same transaction, after the
-- session's lock.
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
    array['date', 'start_time', 'end_time', 'description',
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

    if v_saved.capacity_adults is distinct from v_old.capacity_adults then
      perform private.refresh_credits_for_event(v_old.id);
    end if;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;

-- As in 20261006001058; funding is 'card', 'pinned' or 'credit' (a 3.6
-- returned entry is 'card', private.booking_funding). Every other value as
-- before.
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
        'product_name', f.info ->> 'product_name'
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
        'product_name', f.info ->> 'product_name'
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

-- As in 20261005232647, without awaiting_sessions and returned (the 3.6
-- stopgap is gone), plus credit_status: the status of the credit a
-- cancelled pinned booking of this entitlement became (null without one).
-- Every other field unchanged.
create or replace function public.get_my_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_threshold integer;
  v_today date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_customer := private.current_customer_id();
  if v_customer is null then
    return '[]'::jsonb;
  end if;

  select s.customer_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_snapshot ->> 'name',
        'amount_agorot', x.amount_agorot,
        'paid_on', x.paid_on,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'expired_before_bound', x.expired_before_bound,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'validity_days', case
          when jsonb_typeof(x.eligibility_snapshot -> 'validity_days') = 'number'
            then (x.eligibility_snapshot ->> 'validity_days')::integer
        end,
        'pinned_event_id', x.pinned_event_id,
        'payment_id', x.payment_id,
        'credit_status', x.credit_status
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      b.entitlement_id,
      b.kind,
      b.status,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.is_expired,
      b.expired_before_bound,
      b.payment_id,
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      e.eligibility_snapshot,
      p.amount_agorot,
      p.paid_on,
      p.product_snapshot,
      (
        select c.status
        from public.cancellation_credits c
        where c.source_entitlement_id = e.id
        order by c.created_at desc, c.id desc
        limit 1
      ) as credit_status
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_customer
  ) x;

  return v_result;
end;
$$;

-- Her credits (story 3.7), refreshed first: her profile lock, her active
-- credits by id, private.refresh_credit_options for each. Not a customer
-- (no active profile): []. Every credit in active, refund_requested or
-- refunded, by created_at: {credit_id, status, party_size,
-- origin_starts_at, origin_concept_name, reserved_booking: {booking_id,
-- event_id, starts_at} (the confirmed booking it funds) or null, options:
-- [{event_id, starts_at, concept_name, state}] (active and used, by
-- starts_at), waiting (active, not reserved, no active option, fewer
-- options in active/used/passed than options_count: the next sessions are
-- not published yet), exhausted (active, not reserved, no active option,
-- every one of the N passed: user decision 2026-10-10, she contacts the
-- business), refund:
-- {amount_agorot, status, requested_at} or null}. Never a number of places.
-- Exempt from idempotency (a read with an idempotent refresh, AD-5).
create function public.get_my_credits()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_customer := private.current_customer_id();
  if v_customer is null then
    return '[]'::jsonb;
  end if;

  perform private.refresh_customer_credits(v_customer);

  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb)
  into v_result
  from (
    select
      c.id,
      c.created_at,
      jsonb_build_object(
        'credit_id', c.id,
        'status', c.status,
        'party_size', c.party_size,
        'origin_starts_at', c.origin_starts_at,
        'origin_concept_name', oc.name,
        'reserved_booking', r.reserved,
        'options', coalesce(o.options, '[]'::jsonb),
        'waiting', c.status = 'active'
          and r.reserved is null
          and coalesce(o.active_count, 0) = 0
          and n.counted < c.options_count,
        'exhausted', c.status = 'active'
          and r.reserved is null
          and coalesce(o.active_count, 0) = 0
          and n.counted >= c.options_count,
        'refund', case
          when rr.id is not null then jsonb_build_object(
            'amount_agorot', rr.amount_agorot,
            'status', rr.status,
            'requested_at', rr.requested_at
          )
        end
      ) as item
    from public.cancellation_credits c
    join public.bookings ob on ob.id = c.origin_booking_id
    join public.events oe on oe.id = ob.event_id
    join public.concepts oc on oc.id = oe.concept_id
    left join public.refund_requests rr on rr.credit_id = c.id
    left join lateral (
      select jsonb_build_object(
        'booking_id', b.id,
        'event_id', e.id,
        'starts_at', e.starts_at
      ) as reserved
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      join public.events e on e.id = b.event_id
      where a.credit_id = c.id
        and b.status = 'confirmed'
      order by b.id
      limit 1
    ) r on true
    left join lateral (
      select count(*)::integer as counted
      from public.credit_options oc2
      where oc2.credit_id = c.id
        and oc2.state in ('active', 'used', 'passed')
    ) n on true
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'event_id', e.id,
            'starts_at', e.starts_at,
            'concept_name', cc.name,
            'state', op.state
          )
          order by e.starts_at, e.id
        ) as options,
        count(*) filter (where op.state = 'active') as active_count
      from public.credit_options op
      join public.events e on e.id = op.event_id
      join public.concepts cc on cc.id = e.concept_id
      where op.credit_id = c.id
        and op.state in ('active', 'used')
    ) o on true
    where c.customer_id = v_customer
      and c.status in ('active', 'refund_requested', 'refunded')
  ) x;

  return v_result;
end;
$$;

-- As in 20261006215608, plus (3.7): totals.refunded_count and
-- totals.refunded_agorot (completed refund requests whose completed_at is
-- in the local month; none before 3.9), net_agorot = approved_agorot -
-- refunded_agorot, and open_refunds: every requested refund, by
-- requested_at: {refund_request_id, customer_id, customer_label,
-- amount_agorot, requested_at, event_id, concept_name, starts_at}. Every
-- other field unchanged.
create or replace function public.admin_get_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_start date;
  v_threshold integer;
  v_sessions jsonb;
  v_cards jsonb;
  v_totals jsonb;
  v_refunded_count integer;
  v_refunded_agorot bigint;
  v_open_refunds jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  v_start := date_trunc('month', v_today)::date;

  select s.admin_expiring_days into v_threshold
  from public.business_settings s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', u.id,
        'concept_name', u.concept_name,
        'kind', u.kind,
        'starts_at', u.starts_at,
        'ends_at', u.ends_at,
        'occupied', private.occupied_places(u.id),
        'capacity', u.capacity_adults
      )
      order by u.starts_at, u.id
    ),
    '[]'::jsonb
  )
  into v_sessions
  from (
    select e.id, c.name as concept_name, e.kind, e.starts_at, e.ends_at,
      e.capacity_adults
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.ends_at > now()
    order by e.starts_at, e.id
    limit 4
  ) u;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'available', x.available,
        'expires_on', x.expires_on,
        'days_left', x.days_left
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      b.available,
      b.expires_on,
      b.expires_on - v_today as days_left
    from public.entitlement_balances b
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and b.available > 0
      and b.expires_on - v_today <= v_threshold
  ) x;

  select count(*)::integer, coalesce(sum(r.amount_agorot), 0)::bigint
  into v_refunded_count, v_refunded_agorot
  from public.refund_requests r
  where r.status = 'completed'
    and (r.completed_at at time zone 'Asia/Jerusalem')::date between v_start and v_today;

  select jsonb_build_object(
    'period_start', v_start,
    'period_end', v_today,
    'approved_count', count(*)::integer,
    'approved_agorot', coalesce(sum(p.amount_agorot), 0)::bigint,
    'refunded_count', v_refunded_count,
    'refunded_agorot', v_refunded_agorot,
    'net_agorot', coalesce(sum(p.amount_agorot), 0)::bigint - v_refunded_agorot
  )
  into v_totals
  from public.payments p
  where p.status = 'approved'
    and p.paid_on between v_start and v_today;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'refund_request_id', x.id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'amount_agorot', x.amount_agorot,
        'requested_at', x.requested_at,
        'event_id', x.event_id,
        'concept_name', x.concept_name,
        'starts_at', x.starts_at
      )
      order by x.requested_at, x.id
    ),
    '[]'::jsonb
  )
  into v_open_refunds
  from (
    select
      r.id,
      coalesce(r.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      r.amount_agorot,
      r.requested_at,
      e.id as event_id,
      c.name as concept_name,
      e.starts_at
    from public.refund_requests r
    join public.payments p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    left join public.profiles pr on pr.id = coalesce(r.customer_id, p.customer_id)
    where r.status = 'requested'
  ) x;

  return jsonb_build_object(
    'upcoming_sessions', v_sessions,
    'expiring_cards', v_cards,
    'totals', v_totals,
    'open_refunds', v_open_refunds
  );
end;
$$;

-- "To handle" (stories 4.1, 5.5, 5.8, 3.7). As in 20261006184326, plus
-- refund_requested: every requested refund request, since requested_at:
-- {kind, id (the refund request), customer_label, since, customer_id,
-- amount_agorot, event_id, concept_name, starts_at}. It leaves the list
-- when Tal completes it (3.9).
create or replace function public.admin_get_attention_items()
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

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- A refund she asked for (3.7), open until Tal completes it (3.9).
    select
      r.requested_at,
      r.id,
      jsonb_build_object(
        'kind', 'refund_requested',
        'id', r.id,
        'customer_label', p.customer_label,
        'since', r.requested_at,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'amount_agorot', r.amount_agorot,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.refund_requests r
    join pay p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where r.status = 'requested'

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null

    union all

    -- Push notifications that failed in the last 7 days (5.8): one item for
    -- all of them, since the latest failure.
    select
      f.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_failed',
        'id', 'push_failed',
        'customer_label', null,
        'since', f.since,
        'count', f.n
      )
    from (
      select max(j.finished_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'failed'
        and j.finished_at >= now() - interval '7 days'
    ) f
    where f.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: no API role executes them.
revoke execute on function private.monetary_basis(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.booking_funding(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.needs_manual_cancel(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_credit_options(uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_credits_for_event(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_customer_credits(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_funding(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.cancel_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_cancel_booking(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.job_complete_events() from public, anon, authenticated, service_role;

revoke execute on function public.cancel_booking(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(uuid, uuid, text) to authenticated;

revoke execute on function public.admin_cancel_booking(uuid, boolean, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_booking(uuid, boolean, uuid, text, text) to authenticated;

revoke execute on function public.book_session(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.book_session(uuid, uuid) to authenticated;

revoke execute on function public.book_sessions(uuid[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.book_sessions(uuid[], uuid) to authenticated;

revoke execute on function public.admin_book_customer(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_book_customer(uuid, uuid, uuid) to authenticated;

revoke execute on function public.preview_admin_book_customer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_book_customer(uuid, uuid) to authenticated;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;

revoke execute on function public.preview_book_sessions(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_sessions(uuid[]) to authenticated;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.get_my_bookings() from public, anon, authenticated, service_role;
grant execute on function public.get_my_bookings() to authenticated;

revoke execute on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;

revoke execute on function public.get_my_credits() from public, anon, authenticated, service_role;
grant execute on function public.get_my_credits() to authenticated;

revoke execute on function public.admin_get_home() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_home() to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
