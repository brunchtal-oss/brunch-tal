-- Story 3.16, part 2 of 2: Tal changes a credit's alternatives (which is
-- also how she extends it) or replaces it with a refund request (source §6,
-- §7; both sensitive, AD-7). Runs after 20261019204034_credit_adjustment_
-- types (the template types and replaced_reason 'admin').
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined). Every
-- redefinition below was built from the live pg_get_functiondef on
-- 2026-10-19 (identical to the latest migration of each).
--
-- 1. credit_options.added_by ('system' | 'admin').
-- 2. Templates: credit_options_changed, credit_refund_requested.
-- 3. Helpers: private.credit_session_matches, private.credit_in_use,
--    private.credit_options_snapshot, private.credit_plan_base.
-- 4. Changing the alternatives: private.plan_admin_change_credit_options,
--    preview_admin_change_credit_options, admin_change_credit_options.
-- 5. Refund instead of credit: private.plan_admin_refund_credit,
--    preview_admin_refund_credit, admin_refund_credit.
-- 6. admin_list_credit_candidates (the edit box's sessions).
-- 7. The refresh rule: private.refresh_credit_options and
--    private.move_option_candidates keep an option Tal added even when it
--    starts before the cancelled session (no 'moved' for added_by 'admin').
-- 8. Reads: admin_list_customer_credits (+ options, options_count, in_use,
--    exhausted) and admin_get_customer (+ bookings[].credit_id) redefined.
--
-- Why the refresh needs no other change: a removed option stays as a
-- replaced ('admin') row, and the fill skips any session that is already an
-- option of the credit in any state, so it never returns; options_count is
-- set to Tal's count (used + passed + picked), so the fill never tops it up
-- to the original N. An option Tal added that fills, is cancelled or passes
-- is handled like any other.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- Who made the option: the refresh ('system') or Tal ('admin').
alter table public.credit_options
  add column added_by text not null default 'system'
    constraint credit_options_added_by_check check (added_by in ('system', 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Templates (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- Vars: {date} (DD.MM of the cancelled session the credit came from) and
-- {amount} ("180 ₪", the refund). booking_cancelled_refund does not fit: its
-- title says the booking was cancelled now.
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values
  (
    'credit_options_changed', 'customer', true, 'template',
    'עדכון בזיכוי שלך',
    'המפגשים שאפשר להירשם אליהם עם הזיכוי מ־{date} עודכנו. הפרטים באזור האישי',
    array['date']
  ),
  (
    'credit_refund_requested', 'customer', true, 'template',
    'בקשת ההחזר התקבלה',
    'במקום הזיכוי מ־{date} יוחזרו לך {amount}. נעדכן אותך כשההחזר יבוצע',
    array['date', 'amount']
  );

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Whether Tal may pick the session as an alternative of the credit:
-- published, the credit's kind, not started, registration open, room for
-- its party_size, not the credit's origin session, and she has no
-- confirmed booking in it. Any date, also before origin_starts_at.
create function private.credit_session_matches(
  p_credit public.cancellation_credits,
  p_event public.events
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_event.status = 'published'
    and p_event.kind = p_credit.event_kind
    and p_event.starts_at > now()
    and now() < p_event.registration_closes_at
    and private.occupied_places(p_event.id) + p_credit.party_size <= p_event.capacity_adults
    and p_event.id is distinct from (
      select b.event_id
      from public.bookings b
      where b.id = p_credit.origin_booking_id
    )
    and not exists (
      select 1
      from public.bookings b
      where b.customer_id = p_credit.customer_id
        and b.event_id = p_event.id
        and b.status = 'confirmed'
    ),
    false
  );
$$;

-- The credit funds a confirmed booking (the same freeze as
-- refresh_credit_options): it cannot be changed or refunded.
create function private.credit_in_use(p_credit_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where a.credit_id = p_credit_id
      and b.status = 'confirmed'
  );
$$;

-- The audit's before / after of a change: {options: [{event_id, starts_at}]
-- (the active ones, by date), options_count}.
create function private.credit_options_snapshot(p_credit_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'options', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('event_id', e.id, 'starts_at', e.starts_at)
          order by e.starts_at, e.id
        )
        from public.credit_options o
        join public.events e on e.id = o.event_id
        where o.credit_id = c.id
          and o.state = 'active'
      ),
      '[]'::jsonb
    ),
    'options_count', c.options_count
  )
  from public.cancellation_credits c
  where c.id = p_credit_id;
$$;

-- What both plans show about the credit: {credit_id, customer_id,
-- customer_label (her name, or the payer label of an unbound purchase),
-- concept_name (the original session), origin_starts_at}.
create function private.credit_plan_base(p_credit public.cancellation_credits)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'credit_id', p_credit.id,
    'customer_id', coalesce(p_credit.customer_id, pay.customer_id),
    'customer_label', coalesce(nullif(btrim(pr.full_name), ''), pay.payer_label),
    'concept_name', oc.name,
    'origin_starts_at', p_credit.origin_starts_at
  )
  from (select 1) one
  left join public.entitlements en on en.id = p_credit.source_entitlement_id
  left join public.payments pay on pay.id = en.payment_id
  left join public.profiles pr on pr.id = coalesce(p_credit.customer_id, pay.customer_id)
  left join public.bookings ob on ob.id = p_credit.origin_booking_id
  left join public.events oe on oe.id = ob.event_id
  left join public.concepts oc on oc.id = oe.concept_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Changing the alternatives (AD-7: one plan for the preview and the
--    action)
-- ---------------------------------------------------------------------------

-- What setting the credit's active alternatives to p_event_ids would do.
-- Refusals ({ok: false, code[, field]}): NOT_FOUND; CREDIT_NOT_ACTIVE (not
-- active); CREDIT_CHOICE_PENDING (a business cancel still waiting for her
-- choice); CREDIT_IN_USE (it funds a confirmed booking); INVALID_INPUT with
-- field 'events' (not 1-10 distinct sessions that all match,
-- private.credit_session_matches); NO_CHANGE (the same set as now).
-- Result: {ok, credit_id, customer_id, customer_label, concept_name,
-- origin_starts_at, before: [{event_id, starts_at, concept_name}] (the
-- active alternatives now), after: [...] (the picked ones)}, by date.
create function private.plan_admin_change_credit_options(
  p_credit_id uuid,
  p_event_ids uuid[]
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
  v_count integer := coalesce(cardinality(p_event_ids), 0);
  v_before jsonb;
  v_after jsonb;
begin
  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_credit.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_NOT_ACTIVE');
  end if;

  if v_credit.choice_pending then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_CHOICE_PENDING');
  end if;

  if private.credit_in_use(v_credit.id) then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_IN_USE');
  end if;

  if v_count not between 1 and 10
     or array_position(p_event_ids, null) is not null
     or (select count(distinct u.id) from unnest(p_event_ids) as u(id)) <> v_count
     or (
       select count(*)
       from public.events e
       where e.id = any (p_event_ids)
         and private.credit_session_matches(v_credit, e)
     ) <> v_count then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'events');
  end if;

  if not exists (
       select 1
       from public.credit_options o
       where o.credit_id = v_credit.id
         and o.state = 'active'
         and not (o.event_id = any (p_event_ids))
     )
     and (
       select count(*)
       from public.credit_options o
       where o.credit_id = v_credit.id
         and o.state = 'active'
         and o.event_id = any (p_event_ids)
     ) = v_count then
    return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('event_id', e.id, 'starts_at', e.starts_at, 'concept_name', c.name)
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_before
  from public.credit_options o
  join public.events e on e.id = o.event_id
  join public.concepts c on c.id = e.concept_id
  where o.credit_id = v_credit.id
    and o.state = 'active';

  select coalesce(
    jsonb_agg(
      jsonb_build_object('event_id', e.id, 'starts_at', e.starts_at, 'concept_name', c.name)
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_after
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = any (p_event_ids);

  return jsonb_build_object('ok', true)
    || private.credit_plan_base(v_credit)
    || jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- The dialog's impact box (AD-7): the admin check, then the plan.
create function public.preview_admin_change_credit_options(
  p_credit_id uuid,
  p_event_ids uuid[]
)
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

  return private.plan_admin_change_credit_options(p_credit_id, p_event_ids);
end;
$$;

-- Tal sets a credit's alternatives (source §6: "האדמין יכולה לשנות חלופות
-- או להאריך ידנית עם סיבה"; sensitive). Adding sessions to a credit whose
-- alternatives all passed is how she extends it. Order: is_admin,
-- idempotency, the reason (INVALID_INPUT, detail field reason: over 2000
-- after trimming), the credit's customer read without a lock, her profile
-- locked (private.lock_customer, when bound), every involved session (the
-- active alternatives and the picked ones) by id, the credit, the re-check
-- of its customer (CONCURRENT_CHANGE), its options, the plan (its code is
-- raised, with detail field for INVALID_INPUT), p_confirmed
-- (CONFIRM_REQUIRED). Then: an active alternative not picked becomes
-- replaced ('admin'); a picked session that is not an active alternative is
-- inserted (added_by 'admin'), or its former replaced row is active again
-- (added_by 'admin'); options_count := used + passed + picked; one audit
-- row on cancellation_credits (before/after: options and options_count,
-- with the reason) and, for a bound customer, credit_options_changed
-- (discriminator: the audit id). Result: {credit_id, options_count}.
create function public.admin_change_credit_options(
  p_credit_id uuid,
  p_event_ids uuid[],
  p_reason text,
  p_confirmed boolean,
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
  -- session that was an alternative before is active again.
  insert into public.credit_options as o (credit_id, event_id, added_by)
  select v_credit.id, x.event_id, 'admin'
  from unnest(p_event_ids) as x(event_id)
  on conflict on constraint credit_options_credit_event_key do update
  set state = 'active',
      added_by = 'admin',
      assigned_at = now(),
      replaced_at = null,
      replaced_reason = null
  where o.state = 'replaced';

  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('used', 'passed');

  update public.cancellation_credits
  set options_count = v_counted + cardinality(p_event_ids)
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Refund instead of credit
-- ---------------------------------------------------------------------------

-- What replacing the credit with a refund request would do. Refusals:
-- NOT_FOUND; CREDIT_NOT_ACTIVE (not active: already a refund request,
-- refunded or used); CREDIT_IN_USE. A credit waiting for her choice
-- (choice_pending) is allowed: the request closes the choice. Result: {ok,
-- credit_id, customer_id, customer_label, concept_name, origin_starts_at,
-- amount_agorot (the credit's monetary basis), choice_pending}.
create function private.plan_admin_refund_credit(p_credit_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
begin
  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_credit.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_NOT_ACTIVE');
  end if;

  if private.credit_in_use(v_credit.id) then
    return jsonb_build_object('ok', false, 'code', 'CREDIT_IN_USE');
  end if;

  return jsonb_build_object('ok', true)
    || private.credit_plan_base(v_credit)
    || jsonb_build_object(
      'amount_agorot', v_credit.monetary_basis_agorot,
      'choice_pending', v_credit.choice_pending
    );
end;
$$;

-- The dialog's impact box (AD-7): the admin check, then the plan.
create function public.preview_admin_refund_credit(p_credit_id uuid)
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

  return private.plan_admin_refund_credit(p_credit_id);
end;
$$;

-- Tal gives money back instead of the credit (source §7 "טיפול בזיכוי
-- והחזר"; sensitive; user decision 2026-10-18: after a move a cancel
-- returns a credit, and this is how she refunds it). Order: is_admin,
-- idempotency, the reason (INVALID_INPUT, reason), the credit's customer
-- and payment read without a lock, her profile locked (when bound), the
-- credit, the re-check of its customer (CONCURRENT_CHANGE), the payment
-- (AD-6: profiles -> cancellation_credits -> payments), the plan (its code
-- is raised), p_confirmed (CONFIRM_REQUIRED). Then the writes of
-- choose_credit_outcome's refund branch: the credit refund_requested
-- (choice_pending false, so a pending choice closes) and a refund request
-- of its monetary basis on the source payment, for the cancelled booking
-- (or the origin booking). Its active options stay as they are (the credit
-- is no longer refreshed). Two audit rows (the credit, the request; with
-- the reason) and, for a bound customer, credit_refund_requested
-- (discriminator: the credit row's audit id). Result: {credit_id,
-- refund_request_id, amount_agorot}.
create function public.admin_refund_credit(
  p_credit_id uuid,
  p_reason text,
  p_confirmed boolean,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_payment_id uuid;
  v_credit public.cancellation_credits;
  v_saved public.cancellation_credits;
  v_refund public.refund_requests;
  v_plan jsonb;
  v_event_id uuid;
  v_audit_id uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_refund_credit', p_idempotency_key,
    jsonb_build_object(
      'credit_id', p_credit_id,
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

  select c.customer_id, en.payment_id
  into v_customer, v_payment_id
  from public.cancellation_credits c
  left join public.entitlements en on en.id = c.source_entitlement_id
  where c.id = p_credit_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id
  for update;

  if v_credit.id is not null
     and v_credit.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.payments pay
  where pay.id = v_payment_id
  for update;

  v_plan := private.plan_admin_refund_credit(p_credit_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.cancellation_credits
  set status = 'refund_requested', choice_pending = false
  where id = v_credit.id
  returning * into v_saved;

  insert into public.refund_requests (
    customer_id, credit_id, payment_id, booking_id, amount_agorot
  )
  values (
    v_credit.customer_id, v_credit.id, v_payment_id,
    coalesce(private.credit_cancelled_booking(v_credit.id), v_credit.origin_booking_id),
    v_credit.monetary_basis_agorot
  )
  returning * into v_refund;

  select b.event_id into v_event_id
  from public.bookings b
  where b.id = v_refund.booking_id;

  v_audit_id := private.audit(
    v_actor, 'admin', 'admin_refund_credit', 'cancellation_credits', v_credit.id,
    v_customer, v_event_id, to_jsonb(v_credit), to_jsonb(v_saved), v_reason
  );

  perform private.audit(
    v_actor, 'admin', 'admin_refund_credit', 'refund_requests', v_refund.id,
    v_customer, v_event_id, null, to_jsonb(v_refund), v_reason
  );

  -- An unbound purchase has no one to tell (AD-23).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'credit_refund_requested',
      v_audit_id::text,
      jsonb_build_object(
        'date', private.format_day_month(
          (v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date
        ),
        'amount', private.format_agorot(v_refund.amount_agorot)
      ),
      '/me/bookings'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_refund_credit', p_idempotency_key,
    jsonb_build_object(
      'credit_id', v_credit.id,
      'refund_request_id', v_refund.id,
      'amount_agorot', v_refund.amount_agorot
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The sessions Tal can pick
-- ---------------------------------------------------------------------------

-- The edit box of "שינוי חלופות": the next 30 sessions that match the
-- credit (private.credit_session_matches), plus any active alternative
-- after them, by date: [{event_id, starts_at, concept_name, is_option (an
-- active alternative now)}]. NOT_FOUND for a missing credit.
create function public.admin_list_credit_candidates(p_credit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', x.id,
        'starts_at', x.starts_at,
        'concept_name', x.concept_name,
        'is_option', x.is_option
      )
      order by x.starts_at, x.id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      e.id,
      e.starts_at,
      c.name as concept_name,
      exists (
        select 1
        from public.credit_options o
        where o.credit_id = v_credit.id
          and o.event_id = e.id
          and o.state = 'active'
      ) as is_option,
      row_number() over (order by e.starts_at, e.id) as n
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.kind = v_credit.event_kind
      and e.starts_at > now()
      and private.credit_session_matches(v_credit, e)
  ) x
  where x.n <= 30
    or x.is_option;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The refresh rule (also for 5.10's job)
-- ---------------------------------------------------------------------------

-- As in 20261013162639, except that the moved rule of step (1) skips an
-- option Tal added (added_by admin): she may pick a session earlier than
-- the cancelled one. Everything else unchanged.
create or replace function private.refresh_credit_options(
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
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults,
      e.id as event_id,
      o.added_by
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
    elsif v_option.starts_at <= v_credit.origin_starts_at
          and v_option.added_by <> 'admin' then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'moved'
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

-- As in 20261018092457 (it simulates the refresh for plan_move), with the
-- same exception: an option Tal added is not dropped for starting at or
-- before the credit origin. Everything else unchanged.
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
      e.capacity_adults,
      o.added_by
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
         or (
           v_option.starts_at <= v_credit.origin_starts_at
           and v_option.added_by <> 'admin'
         ) then
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

-- ---------------------------------------------------------------------------
-- 8. Reads for the admin
-- ---------------------------------------------------------------------------

-- As in 20261013215833, plus per credit: options_count, options (the
-- active, used and passed alternatives by date: {event_id, starts_at,
-- concept_name, state, added_by}), in_use (it funds a confirmed booking)
-- and exhausted (active, no choice pending, not in use, no active
-- alternative and none left to fill, as in get_my_credits).
create or replace function public.admin_list_customer_credits(p_customer_id uuid)
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
        'credit_id', c.id,
        'status', c.status,
        'choice_pending', c.choice_pending,
        'party_size', c.party_size,
        'origin_starts_at', c.origin_starts_at,
        'concept_name', oc.name,
        'monetary_basis_agorot', c.monetary_basis_agorot,
        'refund', case
          when rr.id is not null then jsonb_build_object(
            'refund_request_id', rr.id,
            'status', rr.status,
            'amount_agorot', rr.amount_agorot,
            'requested_at', rr.requested_at,
            'refunded_on', rr.refunded_on,
            'reference', rr.reference
          )
        end,
        'options_count', c.options_count,
        'options', coalesce(o.options, '[]'::jsonb),
        'in_use', u.in_use,
        'exhausted', c.status = 'active'
          and not c.choice_pending
          and not u.in_use
          and coalesce(o.active_count, 0) = 0
          and coalesce(o.counted, 0) >= c.options_count
      )
      order by c.created_at desc, c.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.cancellation_credits c
  join public.bookings ob on ob.id = c.origin_booking_id
  join public.events oe on oe.id = ob.event_id
  join public.concepts oc on oc.id = oe.concept_id
  left join public.refund_requests rr on rr.credit_id = c.id
  cross join lateral (
    select private.credit_in_use(c.id) as in_use
  ) u
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'event_id', e.id,
          'starts_at', e.starts_at,
          'concept_name', cc.name,
          'state', op.state,
          'added_by', op.added_by
        )
        order by e.starts_at, e.id
      ) as options,
      count(*) filter (where op.state = 'active') as active_count,
      count(*) as counted
    from public.credit_options op
    join public.events e on e.id = op.event_id
    join public.concepts cc on cc.id = e.concept_id
    where op.credit_id = c.id
      and op.state in ('active', 'used', 'passed')
  ) o on true
  where c.customer_id = p_customer_id;

  return v_result;
end;
$$;

-- As in 20261018084612, plus bookings[].credit_id: the credit whose origin
-- is the booking, else the credit that funded it (the booking history links
-- a cancelled booking to it).
create or replace function public.admin_get_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_threshold integer;
  v_today date;
  v_email text;
  v_babies jsonb;
  v_entitlements jsonb;
  v_bookings jsonb;
  v_payments jsonb;
  v_notes jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and p.anonymized_at is null
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile.id;
  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', b.name, 'birth_date', b.birth_date)
      order by b.birth_date, b.id
    ),
    '[]'::jsonb
  )
  into v_babies
  from public.babies b
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_name,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'pinned_event_id', x.pinned_event_id,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_entitlements
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
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      p.product_snapshot ->> 'name' as product_name,
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
    where b.customer_id = v_profile.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', b.event_id,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'status', b.status,
        'party_size', b.party_size,
        'created_at', b.created_at,
        'credit_id', cr.credit_id
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  left join lateral (
    select x.credit_id
    from (
      select cc.id as credit_id, 0 as priority
      from public.cancellation_credits cc
      where cc.origin_booking_id = b.id
      union all
      select a.credit_id, 1 as priority
      from public.booking_allocations a
      where a.booking_id = b.id
        and a.credit_id is not null
    ) x
    order by x.priority, x.credit_id
    limit 1
  ) cr on true
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'product_name', p.product_snapshot ->> 'name',
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'payment_method_name', p.product_snapshot ->> 'payment_method_name',
        'status', p.status
      )
      order by p.paid_on desc, p.created_at desc, p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.customer_notes n
  where n.customer_id = v_profile.id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_email,
      'activated_at', v_profile.activated_at,
      'created_at', v_profile.created_at,
      'dietary_notes', v_profile.dietary_notes,
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.credit_session_matches(public.cancellation_credits, public.events) from public, anon, authenticated, service_role;
revoke execute on function private.credit_in_use(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.credit_options_snapshot(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.credit_plan_base(public.cancellation_credits) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_change_credit_options(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_refund_credit(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.refresh_credit_options(uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.move_option_candidates(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_change_credit_options(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_change_credit_options(uuid, uuid[]) to authenticated;

revoke execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_refund_credit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_refund_credit(uuid) to authenticated;

revoke execute on function public.admin_refund_credit(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_credit(uuid, text, boolean, uuid) to authenticated;

revoke execute on function public.admin_list_credit_candidates(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_credit_candidates(uuid) to authenticated;

revoke execute on function public.admin_list_customer_credits(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customer_credits(uuid) to authenticated;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;
