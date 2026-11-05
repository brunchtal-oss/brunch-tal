-- Fix fix-hardening-db (user decisions 2026-11-04, via the work manager).
-- Eight small database gaps found before 6.1, each function re-created from
-- its live pg_get_functiondef (2026-11-04) with a minimal change. Same
-- signatures, so the generated types stay as they are. Nothing is dropped.
--  S6  events.waitlist_cycle is no longer readable by anon/authenticated.
--  R2  admin_change_credit_options: a re-picked passed option is active
--      again; options_count is counted after the upsert.
--  R3  admin_reschedule_event: a reschedule that reopens registration tells
--      the waitlist, as admin_update_event (5.20).
--  R4  admin_duplicate_event: the copy takes the concept's current kind; a
--      changed kind takes the default capacity and no display price.
--  R7  move_core: an option Tal adds while moving a booking is added_by
--      'admin', also when the row existed.
--  R8  pinned placement and parked settle take the party size from the
--      session kind; products are fixed. apply_product_changes sets the
--      party size from a kind sent alone, and refuses a disagreeing pair
--      with PARTY_SIZE_KIND_MISMATCH (field party_size; 2026-11-05).
--  R9  cards of anonymized customers are not auto-extended or listed.
--  R17 the product RPCs reject the retired post_join_* fields (the columns
--      stay).

-- ==========================================================================
-- S6: events column grant without waitlist_cycle.
-- ==========================================================================

revoke select on public.events from anon, authenticated;
-- capacity_adults (admin RPCs only) and waitlist_cycle (definer functions
-- only; it would show when a full session frees a place) are left out.
revoke select (capacity_adults, waitlist_cycle) on public.events from anon, authenticated;
grant select (
  id, concept_id, kind, description, starts_at, ends_at,
  registration_closes_at, registration_close_overridden, status, revision,
  display_price_agorot, created_at, image_id
) on public.events to anon, authenticated;

-- ==========================================================================
-- R8: products whose party_size disagrees with their kind (0 in dev on
-- 2026-11-04). No audit row: a migration has no actor, and production runs
-- it before any product exists.
-- ==========================================================================

update public.products
set party_size = (case when eligible_event_kind = 'couple' then 2 else 1 end)
where party_size <> (case when eligible_event_kind = 'couple' then 2 else 1 end);

-- ==========================================================================
-- R2: admin_change_credit_options.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.admin_change_credit_options(p_credit_id uuid, p_event_ids uuid[], p_reason text, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_credit public.cancellation_credits;
  v_saved public.cancellation_credits;
  v_plan jsonb;
  v_before jsonb;
  v_after jsonb;
  v_counted integer;
  v_event_id uuid;
  v_audit_id uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_change_credit_options', p_idempotency_key,
    jsonb_build_object(
      'credit_id', p_credit_id,
      'event_ids', to_jsonb(p_event_ids),
      'reason', v_reason,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  select c.customer_id into v_customer
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  perform 1
  from public.events e
  where e.id = any (coalesce(p_event_ids, '{}'::uuid[]))
    or e.id in (
      select o.event_id
      from public.credit_options o
      where o.credit_id = p_credit_id
        and o.state = 'active'
    )
  order by e.id
  for update;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id
  for update;

  if v_credit.id is not null
     and v_credit.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.credit_options o
  where o.credit_id = p_credit_id
  order by o.id
  for update;

  -- Bring the options to their true states first (no fill): an active
  -- option whose session filled, closed or that she booked is replaced or
  -- passed by the usual rules, so the plan, the audit and options_count
  -- (used + passed + picked) see them as they are, not as replaced
  -- (admin).
  perform private.refresh_credit_options(p_credit_id, false);

  v_plan := private.plan_admin_change_credit_options(p_credit_id, p_event_ids);
  if not (v_plan ->> 'ok')::boolean then
    if v_plan ? 'field' then
      raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_plan ->> 'field')::text;
    end if;
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_before := private.credit_options_snapshot(v_credit.id);

  update public.credit_options
  set state = 'replaced', replaced_at = now(), replaced_reason = 'admin'
  where credit_id = v_credit.id
    and state = 'active'
    and not (event_id = any (p_event_ids));

  -- One row per credit and session (credit_options_credit_event_key): a
  -- session that was an alternative before is active again. Fix
  -- fix-hardening-db (R2): also a passed one (registration reopened), which
  -- the plan checked like any other pick.
  insert into public.credit_options as o (credit_id, event_id, added_by)
  select v_credit.id, x.event_id, 'admin'
  from unnest(p_event_ids) as x(event_id)
  on conflict on constraint credit_options_credit_event_key do update
  set state = 'active',
      added_by = 'admin',
      assigned_at = now(),
      replaced_at = null,
      replaced_reason = null
  where o.state in ('replaced', 'passed');

  -- Fix fix-hardening-db (R2): counted after the upsert, so a re-picked
  -- passed option (now active) is not counted twice.
  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('used', 'passed', 'active');

  update public.cancellation_credits
  set options_count = v_counted
  where id = v_credit.id
  returning * into v_saved;

  v_after := private.credit_options_snapshot(v_credit.id);

  select b.event_id into v_event_id
  from public.bookings b
  where b.id = coalesce(
    private.credit_cancelled_booking(v_credit.id),
    v_credit.origin_booking_id
  );

  v_audit_id := private.audit(
    v_actor, 'admin', 'admin_change_credit_options', 'cancellation_credits', v_credit.id,
    v_customer, v_event_id, v_before, v_after, v_reason
  );

  -- Last in the transaction (AD-6, AD-12); an unbound credit has no one to
  -- tell (AD-23).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'credit_options_changed',
      v_audit_id::text,
      jsonb_build_object(
        'date', private.format_day_month(
          (v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date
        )
      ),
      '/me/bookings'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_change_credit_options', p_idempotency_key,
    jsonb_build_object(
      'credit_id', v_credit.id,
      'options_count', v_saved.options_count
    )
  );
end;
$function$;

revoke execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) to authenticated;

-- ==========================================================================
-- R3: admin_reschedule_event.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.admin_reschedule_event(p_event_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_confirmed boolean, p_message text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_message text := btrim(p_message);
  v_customers uuid[];
  v_event public.events;
  v_saved public.events;
  v_plan jsonb;
  v_new_day date;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_customer uuid;
  v_notified integer := 0;
  v_vars jsonb;
  -- Fix fix-hardening-db (R3).
  v_reopened boolean;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'confirmed', p_confirmed,
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
  where e.pinned_event_id = p_event_id
     or e.id in (
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

  v_plan := private.plan_admin_reschedule_event(p_event_id, p_starts_at, p_ends_at);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
      detail = jsonb_build_object('field', v_plan ->> 'field')::text;
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.events
  set starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_event.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_reschedule_event', 'events', v_saved.id,
    null, v_saved.id, to_jsonb(v_event), to_jsonb(v_saved)
  );

  -- A pinned product is valid only on its session (AD-8). A voided
  -- (revoked) entitlement keeps its expires_on (6.5).
  v_new_day := (v_saved.starts_at at time zone 'Asia/Jerusalem')::date;
  for v_entitlement in
    select e.*
    from public.entitlements e
    where e.pinned_event_id = v_saved.id
      and e.status <> 'revoked'
      and e.expires_on is distinct from greatest(v_new_day, e.valid_from)
    order by e.id
  loop
    update public.entitlements
    set expires_on = greatest(v_new_day, v_entitlement.valid_from)
    where id = v_entitlement.id
    returning * into v_entitlement_new;

    perform private.audit(
      v_actor, 'admin', 'admin_reschedule_event', 'entitlements', v_entitlement.id,
      v_entitlement.customer_id, v_saved.id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
    );
  end loop;

  perform private.refresh_credits_for_event(v_saved.id);

  -- Fix fix-hardening-db (R3), as admin_update_event (5.20): registration
  -- closed before the move and open after it (the trigger moved the close;
  -- an overridden close does not move) tells the waiters, as if no place was
  -- free before (notify_waitlist checks that one is free now).
  v_reopened := v_event.registration_closes_at <= now()
    and v_saved.registration_closes_at > now()
    and v_saved.status = 'published'
    and v_saved.starts_at > now();

  if v_reopened then
    perform private.notify_waitlist(v_saved.id, 0);
  end if;

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date),
    'new_date', private.format_day_month(v_new_day),
    'new_time', to_char(v_saved.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
  );

  -- Last in the transaction (AD-6, AD-12).
  for v_customer in
    select distinct b.customer_id
    from public.bookings b
    where b.event_id = v_saved.id
      and b.status = 'confirmed'
      and b.customer_id is not null
    order by b.customer_id
  loop
    if private.enqueue_notification(
      v_customer,
      'event_changed',
      v_saved.id::text || ':' || v_saved.revision::text,
      v_vars,
      '/me/bookings',
      v_message
    ) is not null then
      v_notified := v_notified + 1;
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_saved.id,
      'booking_count', (v_plan ->> 'booking_count')::integer,
      'notified', v_notified,
      'starts_at', v_saved.starts_at,
      'ends_at', v_saved.ends_at
    )
  );
end;
$function$;

revoke execute on function public.admin_reschedule_event(uuid, timestamp with time zone, timestamp with time zone, boolean, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_reschedule_event(uuid, timestamp with time zone, timestamp with time zone, boolean, text, uuid) to authenticated;

-- ==========================================================================
-- R4: admin_duplicate_event.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.admin_duplicate_event(p_event_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_source public.events;
  v_row public.events;
  v_saved public.events;
  -- Story 3.18.
  v_products jsonb;
  -- Fix fix-hardening-db (R4).
  v_kind text;
  v_settings public.business_settings;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'date', p_date,
      'start_time', p_start_time,
      'end_time', p_end_time
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select e.* into v_source
  from public.events e
  where e.id = p_event_id;

  if v_source.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;

  -- Story 5.20 (user decision 2026-10-22): an archived concept is not
  -- duplicated; Tal restores it first. The concept row is share-locked
  -- first, so it cannot be archived while this copy is made.
  select c.default_kind into v_kind
  from public.concepts c
  where c.id = v_source.concept_id
  for share;

  if exists (
    select 1
    from public.concepts c
    where c.id = v_source.concept_id
      and c.archived_at is not null
  ) then
    raise exception 'CONCEPT_ARCHIVED' using errcode = 'P0001';
  end if;

  if p_date is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "date"}';
  elsif p_start_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "start_time"}';
  elsif p_end_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_row.concept_id := v_source.concept_id;
  -- Fix fix-hardening-db (R4): the concept's current kind. Same kind as the
  -- source: its capacity and display price, as before. A changed kind: the
  -- default capacity of that kind (as admin_create_event) and no display
  -- price (the source's was for the other kind).
  v_row.kind := v_kind;
  v_row.description := v_source.description;
  if v_kind = v_source.kind then
    v_row.capacity_adults := v_source.capacity_adults;
    v_row.display_price_agorot := v_source.display_price_agorot;
  else
    select s.* into v_settings from public.business_settings s;
    v_row.capacity_adults := case v_kind
      when 'couple' then v_settings.default_capacity_couple
      else v_settings.default_capacity_regular
    end;
    v_row.display_price_agorot := null;
  end if;
  v_row.starts_at := private.local_instant(p_date, p_start_time);
  v_row.ends_at := private.local_instant(p_date, p_end_time);
  if v_row.ends_at <= v_row.starts_at then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_saved := private.save_event(v_row, true);

  if v_source.image_id is not null then
    update public.events
    set image_id = v_source.image_id
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_duplicate_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  -- Story 3.18: the source's product set, with its own audit row. Story
  -- 5.20: only products whose kind still fits the session (a product marked
  -- on a past session may have changed kind since; PRODUCT_IN_USE guards
  -- only sessions ahead).
  select coalesce(jsonb_agg(ep.product_id order by ep.product_id), '[]'::jsonb)
  into v_products
  from public.event_products ep
  join public.products p on p.id = ep.product_id
  where ep.event_id = v_source.id
    and p.eligible_event_kind = v_saved.kind;

  perform private.save_event_products(
    v_saved, v_products, v_actor, 'admin_duplicate_event'
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$function$;

revoke execute on function public.admin_duplicate_event(uuid, date, time without time zone, time without time zone, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_duplicate_event(uuid, date, time without time zone, time without time zone, uuid) to authenticated;

-- ==========================================================================
-- R7: private.move_core.
-- ==========================================================================

CREATE OR REPLACE FUNCTION private.move_core(p_booking_id uuid, p_target_event_id uuid, p_actor_id uuid, p_actor_kind text, p_action text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    (case when v_funding = 'pinned' then 'credit' end)
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

      -- Fix fix-hardening-db (R7): only Tal reaches here (a customer is
      -- rejected above), so the option is hers, also when the row existed.
      insert into public.credit_options (credit_id, event_id, added_by)
      values (v_credit_id, p_target_event_id, 'admin')
      on conflict (credit_id, event_id) do update
        set state = 'active', added_by = 'admin', replaced_at = null,
            replaced_reason = null
      returning * into v_option;

      perform private.audit(
        p_actor_id, p_actor_kind, p_action, 'credit_options', v_option.id,
        v_booking.customer_id, p_target_event_id,
        (case when v_option_before.id is not null then to_jsonb(v_option_before) end),
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
$function$;

revoke execute on function private.move_core(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

-- ==========================================================================
-- R8: party size from the session kind.
-- ==========================================================================

CREATE OR REPLACE FUNCTION private.plan_pinned_placement(p_customer_id uuid, p_product_id uuid, p_event_id uuid, p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_product public.products;
  v_event public.events;
  v_weekday smallint;
  -- Fix fix-hardening-db (R8).
  v_party integer;
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
         and not v_weekday = any (v_product.allowed_weekdays))
     or not private.event_accepts_product(v_event.id, v_product.id) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FIT');
  end if;

  -- Fix fix-hardening-db (R8): the party size of the session kind.
  v_party := case when v_event.kind = 'couple' then 2 else 1 end;
  if private.occupied_places(v_event.id) + v_party > v_event.capacity_adults then
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
$function$;

revoke execute on function private.plan_pinned_placement(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.place_pinned_booking(p_payment public.payments, p_entitlement public.entitlements, p_on_seat_failure text, p_actor_id uuid, p_actor_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_place jsonb;
  v_booking public.bookings;
  -- Fix fix-hardening-db (R8).
  v_kind text;
  v_party integer;
begin
  if p_payment.id is null
     or p_entitlement.id is null
     or p_entitlement.payment_id is distinct from p_payment.id
     or p_entitlement.pinned_event_id is null
     or p_on_seat_failure is null or p_on_seat_failure not in ('raise', 'park') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.kind into v_kind
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

  -- Fix fix-hardening-db (R8): the party size of the session kind.
  v_party := case when v_kind = 'couple' then 2 else 1 end;

  v_booking := private.book_core(
    p_payment.customer_id,
    p_payment.id,
    p_entitlement.pinned_event_id,
    v_party,
    jsonb_build_array(
      jsonb_build_object('kind', 'entitlement', 'id', p_entitlement.id, 'units', 1)
    ),
    p_actor_id,
    p_actor_kind,
    'approve_payment'
  );

  return v_booking.id;
end;
$function$;

revoke execute on function private.place_pinned_booking(public.payments, public.entitlements, text, uuid, text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_settle_parked_purchase(p_entitlement_id uuid, p_reason text, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_event_id uuid;
  v_event public.events;
  v_entitlement public.entitlements;
  v_payment public.payments;
  v_settings public.business_settings;
  v_plan jsonb;
  v_booking public.bookings;
  v_credit public.cancellation_credits;
  v_units integer := 1;
  -- Fix fix-hardening-db (R8).
  v_party integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_settle_parked_purchase', p_idempotency_key,
    jsonb_build_object(
      'entitlement_id', p_entitlement_id,
      'reason', v_reason,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  select e.customer_id, e.pinned_event_id into v_customer, v_event_id
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  select ev.* into v_event
  from public.events ev
  where ev.id = v_event_id
  for update;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id
  for update;

  if v_entitlement.id is not null
     and (
       v_entitlement.customer_id is distinct from v_customer
       or v_entitlement.pinned_event_id is distinct from v_event_id
     ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id
  for update;

  v_plan := private.plan_admin_settle_parked_purchase(p_entitlement_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  select s.* into v_settings from public.business_settings s;

  -- Fix fix-hardening-db (R8): the party size of the session kind; the
  -- credit copies it.
  v_party := case when v_event.kind = 'couple' then 2 else 1 end;

  insert into public.bookings (
    customer_id, payment_id, event_id, party_size, status, booked_by,
    confirmed_at, cancelled_at, policy_snapshot
  )
  values (
    v_customer, v_payment.id, v_event.id,
    v_party,
    'cancelled', 'admin', now(), now(),
    jsonb_build_object(
      'cancel_window_hours', v_settings.cancel_window_hours,
      'reminder_lead_hours', v_settings.reminder_lead_hours
    )
  )
  returning * into v_booking;

  insert into public.booking_allocations (booking_id, entitlement_id, units)
  values (v_booking.id, v_entitlement.id, v_units);

  insert into public.entitlement_movements (
    entitlement_id, booking_id, action, units, actor_id
  )
  values
    (v_entitlement.id, v_booking.id, 'reserve', -v_units, v_actor),
    (v_entitlement.id, v_booking.id, 'use', 0, v_actor);

  insert into public.cancellation_credits (
    customer_id, origin_booking_id, source_entitlement_id, event_kind,
    party_size, options_count, origin_starts_at, original_cancelled_at,
    monetary_basis_agorot, status, choice_pending
  )
  values (
    v_customer, v_booking.id, v_entitlement.id, v_event.kind,
    v_booking.party_size, greatest(v_settings.credit_options_count, 1),
    v_event.starts_at, now(),
    private.monetary_basis(v_booking.id),
    'active', true
  )
  returning * into v_credit;

  perform private.audit(
    v_actor, 'admin', 'admin_settle_parked_purchase', 'bookings', v_booking.id,
    v_customer, v_event.id, null, to_jsonb(v_booking), v_reason
  );

  perform private.audit(
    v_actor, 'admin', 'admin_settle_parked_purchase', 'cancellation_credits', v_credit.id,
    v_customer, v_event.id, null, to_jsonb(v_credit), v_reason
  );

  -- Last in the transaction (AD-6, AD-12); unbound: at bind (3.8).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'event_cancelled',
      v_event.id::text || ':' || v_event.revision::text || ':' || v_booking.id::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_settle_parked_purchase', p_idempotency_key,
    jsonb_build_object(
      'entitlement_id', v_entitlement.id,
      'booking_id', v_booking.id,
      'credit_id', v_credit.id
    )
  );
end;
$function$;

revoke execute on function public.admin_settle_parked_purchase(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_settle_parked_purchase(uuid, text, boolean, uuid) to authenticated;

-- ==========================================================================
-- R9: cards of anonymized customers.
-- ==========================================================================

CREATE OR REPLACE FUNCTION private.job_auto_extend(p_today date DEFAULT NULL::date, p_entitlement_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  v_id uuid;
  v_entitlement public.entitlements;
  v_saved public.entitlements;
  v_correction public.entitlement_corrections;
  v_week date;
  v_extended integer;
  v_available integer;
  v_count integer := 0;
begin
  for v_id in
    select e.id
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    -- Fix fix-hardening-db (R9): as job_expiry_alerts, a card of an
    -- anonymized customer is not extended; an unbound card still is.
    left join public.profiles pr on pr.id = e.customer_id
    where e.status = 'active'
      and pr.anonymized_at is null
      and e.pinned_event_id is null
      and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      and b.available + b.reserved > 0
      and (p_entitlement_ids is null or e.id = any (p_entitlement_ids))
    order by e.id
  loop
    begin
      select e.* into v_entitlement
      from public.entitlements e
      where e.id = v_id
        and e.status = 'active'
        and e.pinned_event_id is null
        and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      for update skip locked;

      if not found then
        continue;
      end if;

      -- Checked again under the lock: a finished card is never extended.
      if not exists (
        select 1
        from public.entitlement_balances b
        where b.entitlement_id = v_entitlement.id
          and b.available + b.reserved > 0
      ) then
        continue;
      end if;

      v_extended := 0;
      v_correction := null;
      v_week := private.local_week_start(v_entitlement.valid_from);

      while v_week <= v_entitlement.expires_on and v_week + 7 <= v_today loop
        if not exists (
             select 1
             from public.entitlement_corrections c
             where c.entitlement_id = v_entitlement.id
               and c.week_start = v_week
           )
           and not private.week_has_eligible_session(v_entitlement, v_week) then
          update public.entitlements
          set expires_on = expires_on + 7
          where id = v_entitlement.id
          returning * into v_saved;

          insert into public.entitlement_corrections (
            entitlement_id, field, old_value, new_value, related_event_id,
            reason, actor_id, actor_kind, week_start
          )
          values (
            v_entitlement.id, 'expires_on', to_jsonb(v_entitlement.expires_on),
            to_jsonb(v_saved.expires_on), null, null, null, 'system', v_week
          )
          returning * into v_correction;

          perform private.audit(
            null, 'system', 'job_auto_extend', 'entitlements', v_entitlement.id,
            v_entitlement.customer_id, null, to_jsonb(v_entitlement), to_jsonb(v_saved)
          );

          v_entitlement := v_saved;
          v_extended := v_extended + 1;
        end if;

        v_week := v_week + 7;
      end loop;

      if v_extended > 0 then
        -- One notification per card per run, with the final expiry; an
        -- unbound card has no one to tell (AD-23).
        if v_entitlement.customer_id is not null then
          select b.available into v_available
          from public.entitlement_balances b
          where b.entitlement_id = v_entitlement.id;

          perform private.enqueue_notification(
            v_entitlement.customer_id,
            'entitlement_auto_extended',
            v_correction.id::text,
            jsonb_build_object(
              'expires_on', private.format_day_month(v_entitlement.expires_on),
              'units', v_available
            ),
            '/me/purchases/' || v_entitlement.id::text
          );
        end if;

        v_count := v_count + v_extended;
      end if;
    exception when others then
      raise warning 'job_auto_extend: entitlement % failed: % %',
        v_id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

revoke execute on function private.job_auto_extend(date, uuid[]) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- Fix fix-hardening-db (R9): not an anonymized customer's card; an
      -- unbound purchase (no profile) is still listed.
      and pr.anonymized_at is null
  ) x;

  select count(*)::integer, coalesce(sum(r.amount_agorot), 0)::bigint
  into v_refunded_count, v_refunded_agorot
  from public.refund_requests r
  where r.status = 'completed'
    and r.refunded_on between v_start and v_today;

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
$function$;

revoke execute on function public.admin_get_home() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_home() to authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_open_cards(p_filter text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_threshold integer;
  v_today date;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_filter is null or p_filter not in ('all', 'available', 'expiring') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'paid_on', x.paid_on,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'days_left', x.days_left,
        'is_expiring', x.is_expiring,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.customer_label nulls last, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      p.paid_on,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.expires_on - v_today as days_left,
      -- The home's expiring_cards rule (admin_get_home, 20261010141240).
      coalesce(
        b.available > 0 and b.expires_on - v_today <= v_threshold,
        false
      ) as is_expiring,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and e.pinned_event_id is null
      and b.available + b.reserved > 0
      -- Fix fix-hardening-db (R9): not an anonymized customer's card; an
      -- unbound purchase (no profile) is still listed.
      and pr.anonymized_at is null
  ) x
  where p_filter = 'all'
    or (p_filter = 'available' and x.available > 0)
    or (p_filter = 'expiring' and x.is_expiring);

  return v_result;
end;
$function$;

revoke execute on function public.admin_list_open_cards(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_open_cards(text) to authenticated;

-- ==========================================================================
-- R17 and R8: private.apply_product_changes.
-- ==========================================================================

CREATE OR REPLACE FUNCTION private.apply_product_changes(p_row public.products, p_changes jsonb, p_allow_active boolean)
 RETURNS public.products
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_row public.products := p_row;
  v_key text;
  v_value jsonb;
  v_type text;
  v_num numeric;
  v_days smallint[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    v_type := jsonb_typeof(v_value);

    if v_key not in (
      'name', 'type', 'units', 'validity_mode', 'validity_days',
      'allowed_weekdays', 'eligible_event_kind', 'party_size', 'intro_only',
      'active'
    ) or (v_key = 'active' and not p_allow_active) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;

    if v_key in ('units', 'validity_days', 'party_size') and v_type <> 'null' then
      if v_type <> 'number' then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
      v_num := (v_value #>> '{}')::numeric;
      if v_num <> trunc(v_num) or v_num < -2147483648 or v_num > 2147483647 then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
    end if;

    if (v_key in ('name', 'type', 'validity_mode', 'eligible_event_kind') and v_type <> 'string')
       or (v_key in ('intro_only', 'active') and v_type <> 'boolean')
       or (v_key in ('units', 'party_size') and v_type <> 'number')
       or (v_key = 'allowed_weekdays' and v_type not in ('array', 'null')) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;

    case v_key
      when 'name' then
        v_row.name := btrim(v_value #>> '{}');
      when 'type' then
        v_row.type := v_value #>> '{}';
      when 'units' then
        v_row.units := (v_value #>> '{}')::integer;
      when 'validity_mode' then
        v_row.validity_mode := v_value #>> '{}';
      when 'validity_days' then
        v_row.validity_days := (v_value #>> '{}')::integer;
      when 'eligible_event_kind' then
        v_row.eligible_event_kind := v_value #>> '{}';
      when 'party_size' then
        if (v_value #>> '{}')::integer not between -32768 and 32767 then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        v_row.party_size := (v_value #>> '{}')::smallint;
      when 'intro_only' then
        v_row.intro_only := (v_value #>> '{}')::boolean;
      when 'active' then
        v_row.active := (v_value #>> '{}')::boolean;
      when 'allowed_weekdays' then
        if v_type = 'null' then
          v_row.allowed_weekdays := null;
        else
          if jsonb_array_length(v_value) = 0
             or exists (
               select 1
               from jsonb_array_elements(v_value) d
               where jsonb_typeof(d) <> 'number'
                  or (d #>> '{}') !~ '^[0-6]$'
             ) then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end if;
          select array_agg(distinct (d #>> '{}')::smallint order by (d #>> '{}')::smallint)
          into v_days
          from jsonb_array_elements(v_value) d;
          v_row.allowed_weekdays := case when cardinality(v_days) = 7 then null else v_days end;
        end if;
    end case;
  end loop;

  -- Fix fix-hardening-db (R8, work manager's decision 2026-11-05): the
  -- party size follows the kind (couple 2, regular 1). A kind sent without
  -- a party size sets it (the product editor saves one field at a time; the
  -- caller's audit row carries both). Otherwise checked on the merged row,
  -- so a party size sent alone is checked against the stored kind.
  if p_changes ? 'eligible_event_kind' and not p_changes ? 'party_size' then
    v_row.party_size := case when v_row.eligible_event_kind = 'couple' then 2 else 1 end;
  end if;

  if (v_row.eligible_event_kind = 'couple') <> (v_row.party_size = 2) then
    raise exception 'PARTY_SIZE_KIND_MISMATCH' using errcode = 'P0001',
      detail = '{"field": "party_size"}';
  end if;

  return v_row;
end;
$function$;

revoke execute on function private.apply_product_changes(public.products, jsonb, boolean) from public, anon, authenticated, service_role;
