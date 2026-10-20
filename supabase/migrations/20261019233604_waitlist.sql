-- Story 5.6: the waitlist (source section 5, CAP-15, AD-6, AD-12, AD-14).
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined). Additive: no
-- drop. Every redefinition below is the latest migration's definition
-- (named on each) plus only the lines marked "Story 5.6".
--
-- 1. public.waitlist_entries (RLS: her own rows, admin all; select only).
-- 2. private.notify_waitlist (the release transition and its waitlist_spot
--    notifications) and private.waitlist_spot_current (the push recheck).
-- 3. RPCs: join_waitlist, leave_waitlist, get_my_waitlist.
-- 4. Redefined: private.cancel_core (notifies the session's waiters),
--    private.book_core and private.bind_purchase (a booking ends her entry),
--    admin_update_event (a capacity raise notifies), admin_cancel_event
--    (closes the entries silently, user decision 2026-10-20),
--    claim_push_jobs (a stale waitlist_spot is skipped, not sent),
--    admin_get_event_details (+ waitlist).
--
-- Lock order (AD-6): ... refund_requests <- waitlist_entries <-
-- notification_jobs. Every write to a session's entries holds the session's
-- lock, except bind_purchase (one customer, under her profile lock).
-- notify_waitlist locks no other customer's profile: the session's lock
-- serializes it.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

-- One row per joining. joined_at is stored only (no queue, no priority).
-- party_size: the session's party size when she joined (2 for couple).
-- last_notified_cycle: the events.waitlist_cycle of the last waitlist_spot
-- she was sent (null: never). closed_at: when she left, booked or the
-- session was cancelled.
create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete cascade,
  party_size integer not null check (party_size in (1, 2)),
  joined_at timestamptz not null default now(),
  status text not null default 'active'
    check (status in ('active', 'left', 'booked', 'closed')),
  last_notified_cycle integer
    check (last_notified_cycle is null or last_notified_cycle >= 1),
  closed_at timestamptz,
  constraint waitlist_entries_closed_check
    check ((status = 'active') = (closed_at is null))
);

alter table public.waitlist_entries enable row level security;

-- One active entry per customer and session (AD-6).
create unique index waitlist_entries_active_key
  on public.waitlist_entries (customer_id, event_id)
  where status = 'active';
create index waitlist_entries_event_active_idx
  on public.waitlist_entries (event_id)
  where status = 'active';
create index waitlist_entries_customer_id_idx
  on public.waitlist_entries (customer_id);

create policy waitlist_entries_customer_select on public.waitlist_entries
  for select to authenticated
  using (customer_id = (select private.current_customer_id()));

create policy waitlist_entries_admin_select on public.waitlist_entries
  for select to authenticated
  using ((select private.is_admin()));

-- No browser writes: join_waitlist / leave_waitlist only (AD-1, AD-5).
revoke all on table public.waitlist_entries from public, anon, authenticated, service_role;
grant select on table public.waitlist_entries to authenticated;
grant select, insert, update, delete on table public.waitlist_entries to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- Called by every RPC that frees a place, holding the session's lock, with
-- p_free_before = capacity_adults - occupied_places read before its change
-- (AD-14). Nothing unless the session is published, still open and not
-- started. s = the session's party size (couple: 2). Only the transition
-- from "fewer than s free" to "at least s free" counts: waitlist_cycle + 1
-- and one waitlist_spot per active entry (discriminator event:s:cycle, so a
-- second release before the session fills sends nothing new, and a refill
-- then a release is a new cycle).
create function private.notify_waitlist(p_event_id uuid, p_free_before integer)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_event public.events;
  v_size integer;
  v_free integer;
  v_cycle integer;
  v_entry public.waitlist_entries;
  v_day date;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or now() >= v_event.registration_closes_at
     or now() >= v_event.starts_at
     or p_free_before is null then
    return;
  end if;

  v_size := case when v_event.kind = 'couple' then 2 else 1 end;
  v_free := v_event.capacity_adults - private.occupied_places(v_event.id);

  if p_free_before >= v_size or v_free < v_size then
    return;
  end if;

  update public.events
  set waitlist_cycle = waitlist_cycle + 1
  where id = v_event.id
  returning waitlist_cycle into v_cycle;

  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;

  for v_entry in
    select w.*
    from public.waitlist_entries w
    where w.event_id = v_event.id
      and w.status = 'active'
    order by w.id
    for update
  loop
    perform private.enqueue_notification(
      v_entry.customer_id,
      'waitlist_spot',
      v_event.id::text || ':' || v_size::text || ':' || v_cycle::text,
      jsonb_build_object('date', private.format_day_month(v_day)),
      '/me/sessions/' || v_event.id::text || '?from=waitlist'
    );

    update public.waitlist_entries
    set last_notified_cycle = v_cycle
    where id = v_entry.id;
  end loop;
end;
$$;

-- The push worker's recheck of a waitlist_spot job (AD-12): its session
-- (dedupe key part 3, type:recipient:event:size:cycle) is still published
-- and open, has at least the party size (part 4) free, is still in the same
-- cycle (part 5), and the recipient still has an active entry there.
create function private.waitlist_spot_current(p_recipient_id uuid, p_dedupe_key text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event_text text := split_part(p_dedupe_key, ':', 3);
  v_size_text text := split_part(p_dedupe_key, ':', 4);
  v_cycle_text text := split_part(p_dedupe_key, ':', 5);
  v_event public.events;
begin
  if p_recipient_id is null
     or v_event_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_size_text !~ '^[12]$'
     or v_cycle_text !~ '^[0-9]{1,9}$' then
    return false;
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_event_text::uuid;

  return v_event.id is not null
    and v_event.status = 'published'
    and now() < v_event.registration_closes_at
    and v_event.capacity_adults - private.occupied_places(v_event.id) >= v_size_text::integer
    and v_event.waitlist_cycle = v_cycle_text::integer
    and exists (
      select 1
      from public.waitlist_entries w
      where w.customer_id = p_recipient_id
        and w.event_id = v_event.id
        and w.status = 'active'
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- A signed-in customer joins a full session's waitlist (no funding needed,
-- security-and-rpc-rules). Guest, admin or inactive: NOT_AUTHORIZED. Locks
-- her profile, then the session. Codes in order: NOT_FOUND (not
-- published), REGISTRATION_CLOSED, ALREADY_BOOKED, ALREADY_WAITLISTED,
-- EVENT_NOT_FULL. Result: {entry_id, event_id}.
create function public.join_waitlist(p_event_id uuid, p_idempotency_key uuid)
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
  v_entry public.waitlist_entries;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'join_waitlist', p_idempotency_key,
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
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if now() >= v_event.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.customer_id = v_customer
      and b.event_id = v_event.id
      and private.is_real_booking(b.status)
  ) then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.waitlist_entries w
    where w.customer_id = v_customer
      and w.event_id = v_event.id
      and w.status = 'active'
  ) then
    raise exception 'ALREADY_WAITLISTED' using errcode = 'P0001';
  end if;

  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  if private.occupied_places(v_event.id) + v_party <= v_event.capacity_adults then
    raise exception 'EVENT_NOT_FULL' using errcode = 'P0001';
  end if;

  insert into public.waitlist_entries (customer_id, event_id, party_size)
  values (v_customer, v_event.id, v_party)
  returning * into v_entry;

  perform private.audit(
    v_actor, 'customer', 'join_waitlist', 'waitlist_entries', v_entry.id,
    v_customer, v_event.id, null, to_jsonb(v_entry)
  );

  return private.idempotent_finish(
    v_actor::text, 'join_waitlist', p_idempotency_key,
    jsonb_build_object('entry_id', v_entry.id, 'event_id', v_event.id)
  );
end;
$$;

-- She leaves the session's waitlist, at any time. Locks her profile, the
-- session, then her active entry; none: NOT_WAITLISTED. Result:
-- {event_id, starts_at}.
create function public.leave_waitlist(p_event_id uuid, p_idempotency_key uuid)
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
  v_entry public.waitlist_entries;
  v_new public.waitlist_entries;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'leave_waitlist', p_idempotency_key,
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

  select w.* into v_entry
  from public.waitlist_entries w
  where w.customer_id = v_customer
    and w.event_id = p_event_id
    and w.status = 'active'
  for update;

  if v_entry.id is null then
    raise exception 'NOT_WAITLISTED' using errcode = 'P0001';
  end if;

  update public.waitlist_entries
  set status = 'left', closed_at = now()
  where id = v_entry.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'customer', 'leave_waitlist', 'waitlist_entries', v_entry.id,
    v_customer, v_entry.event_id, to_jsonb(v_entry), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'leave_waitlist', p_idempotency_key,
    jsonb_build_object('event_id', v_entry.event_id, 'starts_at', v_event.starts_at)
  );
end;
$$;

-- Her active entries whose session is published and still open, by start:
-- [{event_id, starts_at, concept_name, kind, joined_at}].
create function public.get_my_waitlist()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_rows jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', e.id,
        'starts_at', e.starts_at,
        'concept_name', c.name,
        'kind', e.kind,
        'joined_at', w.joined_at
      )
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.waitlist_entries w
  join public.events e on e.id = w.event_id
  join public.concepts c on c.id = e.concept_id
  where w.customer_id = v_customer
    and w.status = 'active'
    and e.status = 'published'
    and now() < e.registration_closes_at;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Redefinitions
-- ---------------------------------------------------------------------------

-- As in 20261018075214, plus (story 5.6): the free places read before the
-- cancel, and private.notify_waitlist after the refresh calls, before her
-- own notification. A no-op in admin_cancel_event (already cancelled).
create or replace function private.cancel_core(
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
  v_credit_new public.cancellation_credits;
  v_refund public.refund_requests;
  v_outcome text;
  v_entitlement_id uuid;
  v_credit_id uuid;
  v_refund_id uuid;
  v_audit_id uuid;
  v_pending boolean := coalesce(p_choice = 'pending', false);
  -- Story 5.6.
  v_free_before integer;
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

  if v_pending then
    if p_action <> 'admin_cancel_event' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "choice"}';
    end if;
  elsif v_funding = 'pinned' then
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

  -- Story 5.6: the free places before this cancel (AD-14).
  v_free_before := v_event.capacity_adults - private.occupied_places(v_event.id);

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
      monetary_basis_agorot, status, choice_pending
    )
    values (
      v_booking.customer_id, v_booking.id, v_entitlement.id, v_event.kind,
      v_booking.party_size, greatest(v_settings.credit_options_count, 1),
      v_event.starts_at, now(),
      private.monetary_basis(v_booking.id),
      case when p_choice = 'refund' then 'refund_requested' else 'active' end,
      v_pending
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
    elsif v_pending then
      v_outcome := 'choice_pending';
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

    if v_pending then
      -- The business cancelled the session she chose: not an opportunity
      -- that passed; the option is replaced, and she chooses again.
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'event_cancelled'
      where credit_id = v_credit_id
        and event_id = v_booking.event_id
        and state = 'used';

      select c.* into v_credit
      from public.cancellation_credits c
      where c.id = v_credit_id;

      update public.cancellation_credits
      set choice_pending = true
      where id = v_credit_id
      returning * into v_credit_new;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'cancellation_credits', v_credit_id,
        v_credit_new.customer_id, v_event.id, to_jsonb(v_credit), to_jsonb(v_credit_new), p_reason
      );
      v_outcome := 'choice_pending';
    else
      update public.credit_options
      set state = 'active'
      where credit_id = v_credit_id
        and event_id = v_booking.event_id
        and state = 'used';

      v_outcome := 'credit';
    end if;
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

  -- Story 5.6: the session's waiters hear of the place (only on the
  -- transition; nothing in a cancelled session).
  perform private.notify_waitlist(v_booking.event_id, v_free_before);

  -- Last in the transaction (AD-6, AD-12); a null customer creates nothing.
  -- The business mode sends nothing here (the caller sends event_cancelled),
  -- nor a move (the caller sends booking_moved).
  if not v_pending and p_action not in ('move_booking', 'admin_move_booking') then
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
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'booking_id', v_booking.id,
    'outcome', v_outcome,
    'entitlement_id', v_entitlement_id,
    'credit_id', v_credit_id,
    'refund_request_id', v_refund_id
  ));
end;
$$;

-- As in 20261018075214, plus (story 5.6): her active entry for the session
-- becomes booked, after the refresh and the audit (none without a
-- customer). Covers book_session, book_sessions, admin_book_customer, the
-- pinned placement and a move's target.
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

  -- Story 5.6: booked here, she leaves the session's waitlist (the caller
  -- holds the session's lock).
  if p_customer_id is not null then
    update public.waitlist_entries
    set status = 'booked', closed_at = now()
    where customer_id = p_customer_id
      and event_id = v_event.id
      and status = 'active';
  end if;

  -- Last in the transaction (AD-6, AD-12). A move sends booking_moved
  -- instead (its caller).
  if p_action not in ('move_booking', 'admin_move_booking') then
    perform private.notify_booking_confirmed(v_booking);
  end if;

  return v_booking;
end;
$$;

-- As in 20261014114926, plus (story 5.6): for each confirmed booking it
-- binds, her active entry for that session becomes booked (source section
-- 5 line 221: binding is not a conflict; user decision 2026-10-20). Under
-- her profile lock, after the refund requests (AD-6).
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
  v_event public.events;
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

  -- Story 5.6: a place bound to her in a session she waits for ends her
  -- entry there (booked).
  update public.waitlist_entries w
  set status = 'booked', closed_at = now()
  where w.customer_id = p_customer_id
    and w.status = 'active'
    and w.event_id in (
      select b.event_id
      from public.bookings b
      where b.payment_id = p_payment_id
        and b.status = 'confirmed'
    );

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
  -- booking_cancelled_refund for a refund request, refund_completed for a
  -- refund Tal already completed (3.9).
  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
      and c.status in ('active', 'refund_requested', 'refunded')
    order by c.id
  loop
    if v_credit.status = 'active' then
      perform private.refresh_credit_options(v_credit.id);
    end if;

    -- Story 3.9: the refund was completed before she joined.
    if v_credit.status = 'refunded' then
      select r.* into v_refund
      from public.refund_requests r
      where r.credit_id = v_credit.id;

      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = v_refund.booking_id
      );

      perform private.enqueue_notification(
        p_customer_id,
        'refund_completed',
        'bind:' || v_credit.id::text,
        jsonb_build_object(
          'amount', private.format_agorot(v_refund.amount_agorot),
          'date', private.format_day_month(
            (v_event.starts_at at time zone 'Asia/Jerusalem')::date
          )
        ),
        '/me/purchases/' || v_credit.source_entitlement_id::text
      );
      continue;
    end if;

    -- Story 3.8: a business cancel of a held place; she chooses now.
    if v_credit.status = 'active' and v_credit.choice_pending then
      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = private.credit_cancelled_booking(v_credit.id)
      );

      perform private.enqueue_notification(
        p_customer_id,
        'event_cancelled',
        v_event.id::text || ':' || v_event.revision::text,
        jsonb_build_object(
          'date',
          private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
        ),
        '/me/bookings'
      );
      continue;
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

-- As in 20261010141240, plus (story 5.6): the free places read before the
-- save, and private.notify_waitlist when the capacity went up.
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
  -- Story 5.6.
  v_free_before integer;
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

  -- Story 5.6: the free places before the save (AD-14).
  v_free_before := v_old.capacity_adults - private.occupied_places(v_old.id);

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

    -- Story 5.6: a capacity raise may free a place for the waiters.
    if v_saved.capacity_adults > v_old.capacity_adults then
      perform private.notify_waitlist(v_old.id, v_free_before);
    end if;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;

-- As in 20261013162639, plus (story 5.6): after the cancel loop the
-- session's active entries become closed, silently (no notification; user
-- decision 2026-10-20). The session's lock is held.
create or replace function public.admin_cancel_event(
  p_event_id uuid,
  p_confirmed boolean,
  p_message text,
  p_idempotency_key uuid,
  p_parked_acknowledged boolean default false
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
  v_message text := btrim(p_message);
  v_customers uuid[];
  v_event public.events;
  v_saved public.events;
  v_plan jsonb;
  v_booking_id uuid;
  v_ids uuid[] := '{}';
  v_result jsonb;
  v_card integer := 0;
  v_choice integer := 0;
  v_customer uuid;
  v_notified integer := 0;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_cancel_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'confirmed', p_confirmed,
      'parked_acknowledged', p_parked_acknowledged,
      'message', v_message
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_message is null or char_length(v_message) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "message"}';
  end if;

  select coalesce(array_agg(distinct b.customer_id), '{}')
  into v_customers
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
    and b.customer_id is not null;

  perform 1
  from public.profiles p
  where p.id = any (v_customers)
  order by p.id
  for update;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  perform 1
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = p_event_id
      and b.status = 'confirmed'
      and b.customer_id is not null
      and not (b.customer_id = any (v_customers))
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.id in (
    select a.entitlement_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_cancel_event(p_event_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true
     or (
       jsonb_array_length(v_plan -> 'parked') > 0
       and p_parked_acknowledged is not true
     ) then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.events
  set status = 'cancelled'
  where id = v_event.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_cancel_event', 'events', v_saved.id,
    null, v_saved.id, to_jsonb(v_event), to_jsonb(v_saved)
  );

  for v_booking_id, v_customer in
    select b.id, b.customer_id
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
    order by b.id
  loop
    v_result := private.cancel_core(
      v_booking_id, v_actor, 'admin', 'admin_cancel_event', null, 'pending'
    );
    v_ids := v_ids || v_booking_id;
    if v_result ->> 'outcome' = 'card' then
      v_card := v_card + 1;
    elsif v_customer is not null then
      v_choice := v_choice + 1;
    end if;
  end loop;

  -- Story 5.6: the waiters leave the list silently (no waitlist_spot).
  update public.waitlist_entries
  set status = 'closed', closed_at = now()
  where event_id = v_event.id
    and status = 'active';

  perform private.refresh_credits_for_event(v_event.id);

  -- Last in the transaction (AD-6, AD-12).
  for v_customer in
    select distinct b.customer_id
    from public.bookings b
    where b.id = any (v_ids)
      and b.customer_id is not null
    order by b.customer_id
  loop
    if private.enqueue_notification(
      v_customer,
      'event_cancelled',
      v_saved.id::text || ':' || v_saved.revision::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_saved.starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings',
      v_message
    ) is not null then
      v_notified := v_notified + 1;
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_cancel_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_saved.id,
      'cancelled', coalesce(array_length(v_ids, 1), 0),
      'card_count', v_card,
      'choice_count', v_choice,
      'notified', v_notified
    )
  );
end;
$$;

-- As in 20261013182941, plus (story 5.6): a waitlist_spot job that is no
-- longer current (private.waitlist_spot_current) is skipped, not returned
-- (AD-12). The in-app notification stays.
create or replace function public.claim_push_jobs(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_subs jsonb;
  v_out jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "limit"}';
  end if;

  for v_job in
    select
      j.id,
      j.notification_id,
      j.status,
      j.attempt_count,
      n.recipient_id,
      n.created_at as notified_at,
      n.payload,
      n.target_path,
      -- Story 5.6.
      n.type,
      n.dedupe_key
    from public.notification_jobs j
    join public.notifications n on n.id = j.notification_id
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'sending' and j.lease_until < now())
    order by j.next_attempt_at, j.id
    for update of j skip locked
  loop
    exit when v_count >= p_limit;

    if v_job.notified_at < now() - interval '24 hours' then
      update public.notification_jobs
      set status = 'skipped', lease_until = null, finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    -- Story 5.6: the place was taken, the session closed or moved on to a
    -- new cycle, or she left or booked: no push.
    if v_job.type = 'waitlist_spot'
       and not private.waitlist_spot_current(v_job.recipient_id, v_job.dedupe_key) then
      update public.notification_jobs
      set status = 'skipped', lease_until = null, finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'sending' and v_job.attempt_count >= 5 then
      update public.notification_jobs
      set status = 'failed', lease_until = null, finished_at = now(),
          last_error = 'LEASE_EXPIRED'
      where id = v_job.id;
      continue;
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      )
      order by s.id
    )
    into v_subs
    from public.push_subscriptions s
    where s.user_id = v_job.recipient_id
      and not exists (
        select 1
        from public.notification_deliveries d
        where d.job_id = v_job.id
          and d.subscription_id = s.id
      );

    if v_subs is null then
      update public.notification_jobs
      set status = case
            when exists (
              select 1 from public.notification_deliveries d where d.job_id = v_job.id
            ) then 'sent'
            else 'skipped'
          end,
          lease_until = null,
          finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    update public.notification_jobs
    set status = 'sending',
        lease_until = now() + interval '2 minutes',
        attempt_count = attempt_count + 1
    where id = v_job.id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'job_id', v_job.id,
      'notification_id', v_job.notification_id,
      'title', v_job.payload ->> 'title',
      'body', v_job.payload ->> 'body',
      'target_path', v_job.target_path,
      'subscriptions', v_subs
    ));
    v_count := v_count + 1;
  end loop;

  return v_out;
end;
$$;

-- As in 20261007183144, plus (story 5.6) waitlist: the session's active
-- entries by joined_at, [{customer_id, customer_label (her name; null after
-- her details were removed), joined_at, notified}].
create or replace function public.admin_get_event_details(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_bookings jsonb;
  -- Story 5.6.
  v_waitlist jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'concept_name', c.name,
    'kind', e.kind,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'registration_closes_at', e.registration_closes_at,
    'capacity_adults', e.capacity_adults,
    'occupied', private.occupied_places(e.id)
  )
  into v_event
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_event_id;

  if v_event is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'booking_id', b.id,
        'party_size', b.party_size,
        'booked_by', b.booked_by,
        'guest_details', b.guest_details,
        'customer_id', b.customer_id,
        'pending_join', b.customer_id is null,
        'payer_label', case when b.customer_id is null then pay.payer_label end,
        'full_name', p.full_name,
        'phone_e164', p.phone_e164,
        'dietary_notes', p.dietary_notes,
        'photo_consent', p.photo_consent,
        'personal_photo_consent', p.personal_photo_consent,
        'babies', case when p.id is not null then (
          select coalesce(
            jsonb_agg(
              jsonb_build_object('name', bb.name, 'birth_date', bb.birth_date)
              order by bb.birth_date, bb.id
            ),
            '[]'::jsonb
          )
          from public.babies bb
          where bb.customer_id = p.id
        ) end
      ))
      order by b.confirmed_at, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  left join public.profiles p
    on p.id = b.customer_id
   and p.activated_at is not null
   and p.anonymized_at is null
  left join public.payments pay on pay.id = b.payment_id
  where b.event_id = p_event_id
    and private.is_real_booking(b.status);

  -- Story 5.6.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', w.customer_id,
        'customer_label', nullif(btrim(p.full_name), ''),
        'joined_at', w.joined_at,
        'notified', w.last_notified_cycle is not null
      )
      order by w.joined_at, w.id
    ),
    '[]'::jsonb
  )
  into v_waitlist
  from public.waitlist_entries w
  left join public.profiles p
    on p.id = w.customer_id
   and p.anonymized_at is null
  where w.event_id = p_event_id
    and w.status = 'active';

  return jsonb_build_object(
    'event', v_event,
    'bookings', v_bookings,
    'waitlist', v_waitlist
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.notify_waitlist(uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function private.waitlist_spot_current(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.cancel_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.book_core(uuid, uuid, uuid, integer, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.join_waitlist(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_waitlist(uuid, uuid) to authenticated;

revoke execute on function public.leave_waitlist(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.leave_waitlist(uuid, uuid) to authenticated;

revoke execute on function public.get_my_waitlist() from public, anon, authenticated, service_role;
grant execute on function public.get_my_waitlist() to authenticated;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.admin_cancel_event(uuid, boolean, text, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_event(uuid, boolean, text, uuid, boolean) to authenticated;

revoke execute on function public.claim_push_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_jobs(integer) to service_role;

revoke execute on function public.admin_get_event_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_event_details(uuid) to authenticated;
