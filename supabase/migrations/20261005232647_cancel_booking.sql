-- Story 3.6: self-cancel within the window and cancellation by Tal (CAP-16,
-- CAP-17, AD-20).
-- 1. private.cancel_core: the one writer of a cancellation (move_booking in
--    3.10 reuses it). The booking becomes cancelled, every allocation gets a
--    release to the same entitlement, a pinned entitlement returns as a
--    regular one (user decision 2026-10-06, until the credits of 3.7), the
--    audit row and the notification, in the caller's transaction.
-- 2. private.returned_validity, private.return_pinned_entitlement,
--    private.refresh_returned_entitlements and the trigger on publishing a
--    session: a returned pinned entitlement is valid until the local date of
--    the N-th matching session with room after the cancelled one (N =
--    business_settings.credit_options_count); with fewer it waits
--    (eligibility_snapshot.awaiting_sessions) and is computed again when a
--    session is published.
-- 3. public.cancel_booking (the customer, private.can_self_cancel is the
--    only boundary), public.admin_cancel_booking and
--    public.preview_admin_cancel_booking (a sensitive action, one plan:
--    private.plan_admin_cancel_booking, AD-7), public.get_my_bookings.
-- 4. Changed, same signatures: public.preview_book_session (the booked
--    state carries booking_id and how it was funded) and
--    public.get_my_entitlements (awaiting_sessions, returned).
-- 5. Templates: booking_cancelled gets a fixed body; booking_cancelled_pinned
--    is new (its type was added to the check in 20261005231322).
-- AD-5 grants and idempotency, AD-6 lock order (profiles -> events ->
-- bookings -> entitlements), AD-7 plan/preview, AD-8 time in SQL, AD-12
-- notifications (discriminator: the audit row of the cancellation), AD-14
-- movements, AD-19 audit, AD-23 bookings without a customer.

-- ---------------------------------------------------------------------------
-- Templates (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- No notification was created from the previous body ('{outcome}'), so the
-- version stays. Vars: {date} (DD.MM of the cancelled session).
update public.notification_templates
set body = 'הכניסה חזרה ליתרה שלך'
where type = 'booking_cancelled';

-- A pinned booking (single, intro, couple). Vars: {date}, {expires_on}
-- (DD.MM, empty while the entitlement waits for the next sessions).
insert into public.notification_templates (type, recipient_kind, push, body_mode, title, body)
values (
  'booking_cancelled_pinned', 'customer', false, 'template',
  'ההרשמה ל{date} בוטלה',
  'הכניסה חזרה אלייך, ואפשר להירשם איתה לאחד המפגשים המתאימים הבאים'
);

-- The returned entitlements still waiting for sessions (refresh on publish).
create index entitlements_awaiting_sessions_idx
  on public.entitlements (id)
  where (eligibility_snapshot ->> 'awaiting_sessions') = 'true';

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The validity of a returned pinned entitlement: the local date of the
-- p_options_count-th published session of p_event_kind, on an allowed
-- weekday (null = every day), whose local date is after p_after_day and that
-- has room for p_party_size now, by starts_at and id. Fewer than that:
-- awaiting, with a provisional far date (p_after_day + 3650). Result:
-- {awaiting, expires_on}.
create function private.returned_validity(
  p_event_kind text,
  p_weekdays smallint[],
  p_party_size integer,
  p_after_day date,
  p_options_count integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_n integer := greatest(coalesce(p_options_count, 1), 1);
  v_days date[];
begin
  select array_agg(x.day order by x.starts_at, x.id) into v_days
  from (
    select
      e.id,
      e.starts_at,
      (e.starts_at at time zone 'Asia/Jerusalem')::date as day
    from public.events e
    where e.status = 'published'
      and e.kind = p_event_kind
      and (e.starts_at at time zone 'Asia/Jerusalem')::date > p_after_day
      and (
        p_weekdays is null
        or extract(dow from (e.starts_at at time zone 'Asia/Jerusalem'))::smallint = any (p_weekdays)
      )
      and private.occupied_places(e.id) + p_party_size <= e.capacity_adults
    order by e.starts_at, e.id
    limit v_n
  ) x;

  if coalesce(cardinality(v_days), 0) >= v_n then
    return jsonb_build_object('awaiting', false, 'expires_on', v_days[v_n]);
  end if;

  return jsonb_build_object('awaiting', true, 'expires_on', p_after_day + 3650);
end;
$$;

-- A pinned entitlement whose booking was cancelled becomes a regular one
-- (user decision 2026-10-06): pinned_event_id null, validity_mode days (the
-- pinned check), valid_from the day after the cancelled session (so it never
-- funds that session again), expires_on from private.returned_validity with
-- N = business_settings.credit_options_count (at least 1). The snapshot keeps
-- awaiting_sessions, returned_from_event_id, returned_after (the cancelled
-- session's local date) and options_count. Assumes the caller holds the
-- entitlement's lock. Audited (p_action, p_reason). Returns the new row.
create function private.return_pinned_entitlement(
  p_entitlement_id uuid,
  p_event_day date,
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_reason text
)
returns public.entitlements
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old public.entitlements;
  v_new public.entitlements;
  v_n integer;
  v_party integer;
  v_validity jsonb;
begin
  select e.* into v_old
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_old.id is null or v_old.pinned_event_id is null or p_event_day is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;

  v_party := case
    when jsonb_typeof(v_old.eligibility_snapshot -> 'party_size') = 'number'
      then (v_old.eligibility_snapshot ->> 'party_size')::integer
    when v_old.eligible_event_kind = 'couple' then 2
    else 1
  end;

  v_validity := private.returned_validity(
    v_old.eligible_event_kind, v_old.allowed_weekdays, v_party, p_event_day, v_n
  );

  update public.entitlements
  set pinned_event_id = null,
      valid_from = p_event_day + 1,
      expires_on = (v_validity ->> 'expires_on')::date,
      eligibility_snapshot = eligibility_snapshot || jsonb_build_object(
        'validity_mode', 'days',
        'awaiting_sessions', (v_validity ->> 'awaiting')::boolean,
        'returned_from_event_id', v_old.pinned_event_id,
        'returned_after', p_event_day,
        'options_count', v_n
      )
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    p_actor_id, p_actor_kind, p_action, 'entitlements', v_new.id,
    v_new.customer_id, v_old.pinned_event_id, to_jsonb(v_old), to_jsonb(v_new), p_reason
  );

  return v_new;
end;
$$;

-- Every active returned entitlement that still waits for sessions is
-- computed again (private.returned_validity from its returned_after and
-- options_count); when N sessions exist, expires_on is the N-th one's date
-- and awaiting_sessions becomes false (audit, actor system). Locks the
-- entitlements by id. Returns how many were settled.
create function private.refresh_returned_entitlements()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old public.entitlements;
  v_new public.entitlements;
  v_party integer;
  v_validity jsonb;
  v_count integer := 0;
begin
  for v_old in
    select e.*
    from public.entitlements e
    where (e.eligibility_snapshot ->> 'awaiting_sessions') = 'true'
      and e.status = 'active'
    order by e.id
    for update
  loop
    if jsonb_typeof(v_old.eligibility_snapshot -> 'returned_after') is distinct from 'string' then
      continue;
    end if;

    v_party := case
      when jsonb_typeof(v_old.eligibility_snapshot -> 'party_size') = 'number'
        then (v_old.eligibility_snapshot ->> 'party_size')::integer
      when v_old.eligible_event_kind = 'couple' then 2
      else 1
    end;

    v_validity := private.returned_validity(
      v_old.eligible_event_kind,
      v_old.allowed_weekdays,
      v_party,
      (v_old.eligibility_snapshot ->> 'returned_after')::date,
      (v_old.eligibility_snapshot ->> 'options_count')::integer
    );

    if not (v_validity ->> 'awaiting')::boolean then
      update public.entitlements
      set expires_on = (v_validity ->> 'expires_on')::date,
          eligibility_snapshot = eligibility_snapshot
            || jsonb_build_object('awaiting_sessions', false)
      where id = v_old.id
      returning * into v_new;

      perform private.audit(
        null, 'system', 'refresh_returned_entitlements', 'entitlements', v_new.id,
        v_new.customer_id,
        (v_old.eligibility_snapshot ->> 'returned_from_event_id')::uuid,
        to_jsonb(v_old), to_jsonb(v_new)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- A session becomes published (created published, or a draft published):
-- the waiting returned entitlements are computed again.
create function private.events_refresh_returned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform private.refresh_returned_entitlements();
  end if;
  return null;
end;
$$;

create trigger events_refresh_returned
  after insert or update of status on public.events
  for each row execute function private.events_refresh_returned();

-- How a booking was funded, for the screens: {funding, entitlement_id,
-- product_name}. funding: 'pinned' (the booking of a pinned entitlement's own
-- session), 'card' (a card), 'returned' (a pinned entitlement that already
-- returned once). The first allocation by id; null without one.
create function private.booking_funding(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'funding', case
      when e.pinned_event_id is not null and e.pinned_event_id = b.event_id then 'pinned'
      when e.kind = 'card' then 'card'
      else 'returned'
    end,
    'entitlement_id', e.id,
    'product_name', p.product_snapshot ->> 'name'
  )
  from public.bookings b
  join public.booking_allocations a on a.booking_id = b.id
  join public.entitlements e on e.id = a.entitlement_id
  join public.payments p on p.id = e.payment_id
  where b.id = p_booking_id
  order by a.id
  limit 1;
$$;

-- More than one kind of source (a couple booking offset from a card and an
-- addition), or a credit (3.7): Tal handles it by hand (AD-20).
create function private.needs_manual_cancel(p_booking_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
      select 1
      from public.booking_allocations a
      where a.booking_id = p_booking_id
        and a.credit_id is not null
    )
    or (
      select count(distinct e.kind)
      from public.booking_allocations a
      join public.entitlements e on e.id = a.entitlement_id
      where a.booking_id = p_booking_id
    ) > 1;
$$;

-- The one writer of a cancellation (AD-20). Assumes the caller holds the
-- locks (profile, session, booking, entitlements, AD-6) and re-checks: the
-- booking is confirmed (BOOKING_NOT_CANCELLABLE) and has one kind of source
-- (MANUAL_HANDLING_REQUIRED). Writes: status cancelled with cancelled_at; a
-- release of +units per allocation to the same entitlement (no extension);
-- a pinned entitlement of this session returns through
-- private.return_pinned_entitlement; the audit row (p_action, p_reason);
-- booking_cancelled (card or returned) or booking_cancelled_pinned, with the
-- audit id as discriminator, to /me/bookings (nothing for a booking without
-- a customer, AD-23). Result: {booking_id, outcome: 'card'|'pinned',
-- entitlement_id, expires_on, awaiting_sessions}.
create function private.cancel_core(
  p_booking_id uuid,
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
  v_new public.bookings;
  v_starts_at timestamptz;
  v_day date;
  v_alloc public.booking_allocations;
  v_entitlement public.entitlements;
  v_outcome text := 'card';
  v_entitlement_id uuid;
  v_expires_on date;
  v_awaiting boolean := false;
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

  select e.starts_at into v_starts_at
  from public.events e
  where e.id = v_booking.event_id;
  v_day := (v_starts_at at time zone 'Asia/Jerusalem')::date;

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = v_booking.id
  returning * into v_new;

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

    select e.* into v_entitlement
    from public.entitlements e
    where e.id = v_alloc.entitlement_id;

    if v_entitlement.pinned_event_id is not null
       and v_entitlement.pinned_event_id = v_booking.event_id then
      v_entitlement := private.return_pinned_entitlement(
        v_entitlement.id, v_day, p_actor_id, p_actor_kind, p_action, p_reason
      );
      v_outcome := 'pinned';
      v_awaiting := coalesce((v_entitlement.eligibility_snapshot ->> 'awaiting_sessions')::boolean, false);
    end if;

    v_entitlement_id := v_entitlement.id;
    v_expires_on := v_entitlement.expires_on;
  end loop;

  v_audit_id := private.audit(
    p_actor_id, p_actor_kind, p_action, 'bookings', v_booking.id,
    v_booking.customer_id, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_new), p_reason
  );

  -- Last in the transaction (AD-6, AD-12); a null customer creates nothing.
  perform private.enqueue_notification(
    v_booking.customer_id,
    case when v_outcome = 'pinned' then 'booking_cancelled_pinned' else 'booking_cancelled' end,
    v_audit_id::text,
    jsonb_build_object(
      'date', private.format_day_month(v_day),
      'expires_on', case
        when v_outcome = 'pinned' and not v_awaiting then private.format_day_month(v_expires_on)
        else ''
      end
    ),
    '/me/bookings'
  );

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'outcome', v_outcome,
    'entitlement_id', v_entitlement_id,
    'expires_on', v_expires_on,
    'awaiting_sessions', v_awaiting
  );
end;
$$;

-- What Tal's cancellation will do (AD-7: the preview and the action run this
-- one plan). Refusals, in order: a booking that is missing or not confirmed
-- (BOOKING_NOT_CANCELLABLE); its session ended (EVENT_ENDED); more than one
-- kind of source (MANUAL_HANDLING_REQUIRED). Result: {ok, code?} or {ok,
-- booking_id, event_id, starts_at, concept_name, pending_join, customer_name?,
-- outcome ('card'|'pinned'), funding, product_name, within_window (she can no
-- longer cancel by herself), expires_on (the entitlement's, or for a pinned
-- one the date it gets), awaiting_sessions, options_count}.
create function private.plan_admin_cancel_booking(p_booking_id uuid)
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
  v_entitlement public.entitlements;
  v_n integer;
  v_validity jsonb;
  v_party integer;
  v_expires_on date;
  v_awaiting boolean := false;
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

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = (v_funding ->> 'entitlement_id')::uuid;

  select greatest(s.credit_options_count, 1) into v_n from public.business_settings s;
  v_expires_on := v_entitlement.expires_on;

  if v_funding ->> 'funding' = 'pinned' then
    v_party := case
      when jsonb_typeof(v_entitlement.eligibility_snapshot -> 'party_size') = 'number'
        then (v_entitlement.eligibility_snapshot ->> 'party_size')::integer
      when v_entitlement.eligible_event_kind = 'couple' then 2
      else 1
    end;
    v_validity := private.returned_validity(
      v_entitlement.eligible_event_kind,
      v_entitlement.allowed_weekdays,
      v_party,
      (v_event.starts_at at time zone 'Asia/Jerusalem')::date,
      v_n
    );
    v_awaiting := (v_validity ->> 'awaiting')::boolean;
    v_expires_on := (v_validity ->> 'expires_on')::date;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'event_id', v_event.id,
    'starts_at', v_event.starts_at,
    'concept_name', v_concept,
    'pending_join', v_booking.customer_id is null,
    'customer_name', v_name,
    'outcome', case when v_funding ->> 'funding' = 'pinned' then 'pinned' else 'card' end,
    'funding', v_funding ->> 'funding',
    'product_name', v_funding ->> 'product_name',
    'within_window', not private.can_self_cancel(v_booking.id),
    'expires_on', v_expires_on,
    'awaiting_sessions', v_awaiting,
    'options_count', v_n
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- A signed-in customer cancels her own confirmed booking (CAP-16). Order:
-- current_customer_id (NOT_AUTHORIZED), idempotency, p_choice must be null
-- until 3.7 (INVALID_INPUT), her profile lock, the booking read without a
-- lock (not hers, missing or not confirmed -> BOOKING_NOT_CANCELLABLE,
-- without telling which), the session lock, the booking lock and re-check
-- (changed -> CONCURRENT_CHANGE), private.can_self_cancel (the only
-- boundary, from the booking's snapshot; false -> SELF_CANCEL_CLOSED), the
-- entitlements of its allocations by id, then private.cancel_core. Result:
-- cancel_core's.
create function public.cancel_booking(
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

  -- The refund / credit choice arrives with 3.7.
  if p_choice is not null then
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

  v_result := private.cancel_core(v_booking.id, v_actor, 'customer', 'cancel_booking', null);

  return private.idempotent_finish(
    v_actor::text, 'cancel_booking', p_idempotency_key, v_result
  );
end;
$$;

-- The sensitive dialog of Tal's cancellation (AD-7): same permission and
-- grant as the action.
create function public.preview_admin_cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return private.plan_admin_cancel_booking(p_booking_id);
end;
$$;

-- Tal cancels a confirmed booking (CAP-17, sensitive, also inside the
-- window, also a booking without a customer, until the session ends). Order:
-- is_admin, idempotency, the reason (optional, at most 2000), the customer
-- read without a lock and her profile locked (when there is one), the
-- booking read, the session lock, the booking lock and re-check (changed,
-- e.g. bound meanwhile -> CONCURRENT_CHANGE), the entitlements by id,
-- private.plan_admin_cancel_booking (its code is raised), p_confirmed
-- (CONFIRM_REQUIRED), private.cancel_core with the reason. Result:
-- cancel_core's.
create function public.admin_cancel_booking(
  p_booking_id uuid,
  p_confirmed boolean,
  p_idempotency_key uuid,
  p_reason text default null
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
      'reason', v_reason
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
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

  v_plan := private.plan_admin_cancel_booking(v_booking.id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_result := private.cancel_core(v_booking.id, v_actor, 'admin', 'admin_cancel_booking', v_reason);

  return private.idempotent_finish(
    v_actor::text, 'admin_cancel_booking', p_idempotency_key, v_result
  );
end;
$$;

-- Her bookings (story 3.6): {upcoming, past, options_count}. upcoming: her
-- confirmed bookings whose session has not started, by starts_at; past: her
-- cancelled and completed bookings and the confirmed ones whose session
-- started, latest 50 by starts_at desc. Each: {booking_id, event_id, status,
-- starts_at, concept_name, party_size, cancelled_at, can_self_cancel,
-- funding ('card'|'pinned'|'returned'), product_name}. options_count: N of a
-- returned pinned entry (business_settings.credit_options_count, at least
-- 1). Not a customer (no active profile) -> empty lists. Never a deadline
-- or a number of places.
create function public.get_my_bookings()
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

-- As in 20261004183409, plus in the booked state: booking_id, funding
-- ('card'|'pinned'|'returned'), product_name and options_count (story 3.6:
-- the cancel sheet says what returns and where). Every other value as
-- before.
create or replace function public.preview_book_session(p_event_id uuid)
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
  v_funding jsonb;
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

-- As in 20261005200619, plus awaiting_sessions (a returned pinned entry that
-- waits for the next sessions; its expires_on is provisional and is not
-- shown) and returned (a pinned entry that returned after a cancellation).
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
          and not x.awaiting
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
        'awaiting_sessions', x.awaiting,
        'returned', x.eligibility_snapshot ? 'returned_from_event_id'
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
      coalesce((e.eligibility_snapshot ->> 'awaiting_sessions')::boolean, false) as awaiting,
      p.amount_agorot,
      p.paid_on,
      p.product_snapshot
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_customer
  ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: no API role executes them.
revoke execute on function private.returned_validity(text, smallint[], integer, date, integer) from public, anon, authenticated, service_role;
revoke execute on function private.return_pinned_entitlement(uuid, date, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_returned_entitlements() from public, anon, authenticated, service_role;
revoke execute on function private.events_refresh_returned() from public, anon, authenticated, service_role;
revoke execute on function private.booking_funding(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.needs_manual_cancel(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.cancel_core(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_cancel_booking(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.cancel_booking(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(uuid, uuid, text) to authenticated;

revoke execute on function public.preview_admin_cancel_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_cancel_booking(uuid) to authenticated;

revoke execute on function public.admin_cancel_booking(uuid, boolean, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_booking(uuid, boolean, uuid, text) to authenticated;

revoke execute on function public.get_my_bookings() from public, anon, authenticated, service_role;
grant execute on function public.get_my_bookings() to authenticated;

revoke execute on function public.preview_book_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_session(uuid) to authenticated;

revoke execute on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;
