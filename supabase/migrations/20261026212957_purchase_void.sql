-- Story 2.14: voiding a purchase recorded by mistake (user decision
-- 2026-10-26; the source document has no void). Run by the planning tab
-- (supabase db push); nothing is dropped. Every function redefined below is
-- copied from its live pg_get_functiondef (checked by md5 of prosrc against
-- the defining migration named above it), with only the marked changes.
--
--  1. payments.voided_at, set exactly when status = 'voided'.
--  2. private.cancel_core: p_choice = 'void' (only for p_action =
--     'admin_void_purchase', any funding): every entitlement allocation is
--     released; no credit, no refund request, no notification.
--  3. private.lock_join_payment: a voided payment -> PURCHASE_VOIDED (no new
--     or replaced link).
--  4. private.bind_purchase: payment not approved or entitlement not active
--     -> PURCHASE_VOIDED, nothing bound.
--  5. token_view: a revoked join link of a voided payment -> 'voided'.
--  6. get_my_entitlements: leaves out a voided payment's entitlement.
--  7. admin_get_entitlement: + payment_id, payment_status, voided_at,
--     void_reason.
--  8. admin_list_payments: + status, entitlement_id.
--  9. admin_list_links: can_revoke / can_replace need an approved payment.
-- 10. private.plan_admin_void_purchase, preview_admin_void_purchase,
--     admin_void_purchase (AD-7).

-- 1. -------------------------------------------------------------------------

alter table public.payments
  add column voided_at timestamptz null;

alter table public.payments
  add constraint payments_voided_at_check
  check ((status = 'voided') = (voided_at is not null));

-- 2. cancel_core, from 20261019233604_waitlist.sql --------------------------
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
  -- Story 2.14: a purchase voided by mistake.
  v_void boolean := coalesce(p_choice = 'void', false);
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
  elsif v_void then
    -- Story 2.14: only the void, for any funding.
    if p_action <> 'admin_void_purchase' then
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

  if v_void then
    -- Story 2.14: the ledger closes (no unit stays reserved for a cancelled
    -- booking); the voided purchase's entitlement is revoked by the caller,
    -- so nothing released is usable. No credit, no refund request.
    v_outcome := 'void';
    for v_alloc in
      select a.*
      from public.booking_allocations a
      where a.booking_id = v_booking.id
        and a.entitlement_id is not null
      order by a.id
    loop
      insert into public.entitlement_movements (
        entitlement_id, booking_id, action, units, actor_id
      )
      values (v_alloc.entitlement_id, v_booking.id, 'release', v_alloc.units, p_actor_id);
      v_entitlement_id := coalesce(v_entitlement_id, v_alloc.entitlement_id);
    end loop;

  elsif v_funding = 'card' then
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
  -- Story 2.14: a void sends nothing (Tal's own mistake).
  if not v_pending and not v_void
     and p_action not in ('move_booking', 'admin_move_booking') then
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


-- 3. lock_join_payment, from 20261003190437_link_lifecycle_and_recovery.sql
create or replace function private.lock_join_payment(p_payment_id uuid)
returns public.activation_tokens
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_live public.activation_tokens;
  v_customer_id uuid;
  v_found boolean;
  v_status text;
begin
  if p_payment_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('activation_tokens:join:' || p_payment_id::text));

  for v_token in
    select t.*
    from public.activation_tokens t
    where t.payment_id = p_payment_id
      and t.purpose = 'join'
    order by t.id
    for update
  loop
    if v_token.state = 'consumed' then
      raise exception 'LINK_USED' using errcode = 'P0001';
    end if;
    if v_token.state <> 'revoked' then
      v_live := v_token;
    end if;
  end loop;

  select true, pay.customer_id, pay.status into v_found, v_customer_id, v_status
  from public.payments pay
  where pay.id = p_payment_id
  for share;

  if v_found is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Story 2.14: no new or replaced link for a voided purchase.
  if v_status = 'voided' then
    raise exception 'PURCHASE_VOIDED' using errcode = 'P0001';
  end if;

  if v_customer_id is not null then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_live.id is not null and private.join_link_status(v_live) = 'claiming' then
    raise exception 'LINK_IN_PROGRESS' using errcode = 'P0001';
  end if;

  return v_live;
end;
$$;


-- 4. bind_purchase, from 20261022154256_refactor_sweep_db.sql
CREATE OR REPLACE FUNCTION private.bind_purchase(p_payment_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Story 2.14: a voided purchase is never bound (a refunded one, 3.9,
  -- keeps both statuses and still binds).
  if v_payment.status <> 'approved' or v_entitlement.status <> 'active' then
    raise exception 'PURCHASE_VOIDED' using errcode = 'P0001';
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
         and private.is_real_booking(b.status)
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
$function$;


-- 5. token_view, from 20261005112857_pinned_display_and_duplicates.sql
create or replace function public.token_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_state text;
  v_product_name text;
  v_amount_agorot integer;
  v_session_starts_at timestamptz;
  v_concept_name text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  v_state := case
    when v_token.id is null then 'not_found'
    when v_token.state = 'consumed' then 'used'
    when v_token.state = 'conflict' then 'conflict'
    -- Story 2.14: the link of a voided purchase.
    when v_token.state = 'revoked'
      and v_token.purpose = 'join'
      and exists (
        select 1
        from public.payments pay
        where pay.id = v_token.payment_id
          and pay.status = 'voided'
      ) then 'voided'
    when v_token.state = 'revoked' then 'expired'
    when v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at then 'expired'
    when v_token.purpose = 'reset' and not private.reset_target_valid(v_token.bound_user_id) then 'expired'
    when v_token.state = 'awaiting_login' then 'awaiting_login'
    else 'active'
  end;

  if v_state in ('active', 'awaiting_login') and v_token.purpose = 'join' then
    select pay.product_snapshot ->> 'name', pay.amount_agorot
    into v_product_name, v_amount_agorot
    from public.payments pay
    where pay.id = v_token.payment_id;

    -- A pinned purchase: its session, shown instead of the product name.
    select ev.starts_at, c.name
    into v_session_starts_at, v_concept_name
    from public.entitlements e
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.payment_id = v_token.payment_id;
  end if;

  return jsonb_build_object(
    'state_public', v_state,
    'purpose', v_token.purpose,
    'product_name', v_product_name,
    'amount_agorot', v_amount_agorot,
    'session_starts_at', v_session_starts_at,
    'concept_name', v_concept_name,
    'bound_user_id', case
      when v_state = 'awaiting_login' and v_token.purpose = 'join' then v_token.bound_user_id
    end,
    'conflict_reason', case
      when v_state = 'conflict' and v_token.purpose = 'join' then v_token.conflict_reason
    end,
    'expires_on', case
      when v_state in ('active', 'awaiting_login')
        then (v_token.expires_at at time zone 'Asia/Jerusalem')::date
    end
  );
end;
$$;


-- 6. get_my_entitlements, from 20261010141240_cancellation_credits.sql
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
      -- Story 2.14: she never sees a voided purchase.
      and p.status <> 'voided'
  ) x;

  return v_result;
end;
$$;


-- 7. admin_get_entitlement, from 20261019203305_auto_extend.sql
create or replace function public.admin_get_entitlement(p_entitlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_balance public.entitlement_balances;
  v_payment public.payments;
  v_label text;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_entries jsonb;
  v_bookings jsonb;
  v_corrections jsonb;
  -- Story 2.14.
  v_void_reason text;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_entitlement.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select b.* into v_balance
  from public.entitlement_balances b
  where b.entitlement_id = v_entitlement.id;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  -- As admin_get_customer.entries.
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
  into v_entries
  from public.booking_allocations a
  join public.bookings bk on bk.id = a.booking_id
  join public.events ev on ev.id = bk.event_id
  join public.concepts c on c.id = ev.concept_id
  cross join lateral generate_series(1, a.units) as u(n)
  where a.entitlement_id = v_entitlement.id
    and bk.status <> 'cancelled';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', x.booking_id,
        'event_id', x.event_id,
        'concept_name', x.concept_name,
        'starts_at', x.starts_at,
        'status', x.status
      )
      order by x.starts_at desc, x.booking_id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from (
    select distinct bk.id as booking_id, ev.id as event_id, c.name as concept_name,
      ev.starts_at, bk.status
    from public.booking_allocations a
    join public.bookings bk on bk.id = a.booking_id
    join public.events ev on ev.id = bk.event_id
    join public.concepts c on c.id = ev.concept_id
    where a.entitlement_id = v_entitlement.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'correction_id', co.id,
        'field', co.field,
        'old_value', co.old_value,
        'new_value', co.new_value,
        'reason', co.reason,
        'actor_kind', co.actor_kind,
        'created_at', co.created_at,
        'related_event_id', co.related_event_id,
        'related_concept_name', c.name,
        'related_starts_at', ev.starts_at,
        'week_start', co.week_start
      )
      order by co.created_at desc, co.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.entitlement_corrections co
  left join public.events ev on ev.id = co.related_event_id
  left join public.concepts c on c.id = ev.concept_id
  where co.entitlement_id = v_entitlement.id;

  -- Story 2.14: the reason Tal gave when she voided the purchase.
  if v_payment.status = 'voided' then
    select l.reason into v_void_reason
    from public.audit_log l
    where l.action = 'admin_void_purchase'
      and l.entity_type = 'payments'
      and l.entity_id = v_payment.id
    order by l.created_at desc, l.id desc
    limit 1;
  end if;

  return jsonb_build_object(
    'entitlement_id', v_entitlement.id,
    'payment_id', v_payment.id,
    'payment_status', v_payment.status,
    'voided_at', v_payment.voided_at,
    'void_reason', v_void_reason,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'product_name', v_payment.product_snapshot ->> 'name',
    'kind', v_entitlement.kind,
    'status', v_entitlement.status,
    'validity_mode', v_entitlement.eligibility_snapshot ->> 'validity_mode',
    'correctable', v_entitlement.status = 'active'
      and v_entitlement.pinned_event_id is null
      and v_entitlement.eligibility_snapshot ->> 'validity_mode' = 'days',
    'paid_on', v_payment.paid_on,
    'original_units', v_entitlement.original_units,
    'available', v_balance.available,
    'reserved', v_balance.reserved,
    'used', v_balance.used,
    'valid_from', v_entitlement.valid_from,
    'expires_on', v_entitlement.expires_on,
    'is_expired', v_balance.is_expired,
    'days_left', v_entitlement.expires_on - v_today,
    'allowed_weekdays', to_jsonb(v_entitlement.allowed_weekdays),
    'eligible_event_kind', v_entitlement.eligible_event_kind,
    'is_extended', private.entitlement_is_extended(v_entitlement.id, v_entitlement.expires_on),
    'entries', v_entries,
    'bookings', v_bookings,
    'corrections', v_corrections
  );
end;
$$;


-- 8. admin_list_payments, from 20261004072550_payer_label.sql
create or replace function public.admin_list_payments()
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
        'payment_id', l.id,
        'customer_id', l.customer_id,
        'customer_name', l.customer_name,
        'payer_label', l.payer_label,
        'product_name', l.product_snapshot ->> 'name',
        'price_agorot', (l.product_snapshot ->> 'price_agorot')::integer,
        'amount_agorot', l.amount_agorot,
        'payment_method_name', l.product_snapshot ->> 'payment_method_name',
        'paid_on', l.paid_on,
        'created_at', l.created_at,
        'amount_override_reason', l.amount_override_reason,
        'reference', l.reference,
        'note', l.note,
        -- Story 2.14: the row links to the purchase page, and a voided
        -- payment is tagged.
        'status', l.status,
        'entitlement_id', l.entitlement_id
      )
      order by l.created_at desc, l.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select pay.*, pr.full_name as customer_name, ent.id as entitlement_id
    from public.payments pay
    left join public.profiles pr on pr.id = pay.customer_id
    left join public.entitlements ent on ent.payment_id = pay.id
    order by pay.created_at desc, pay.id desc
    limit 50
  ) l;

  return v_result;
end;
$$;


-- 9. admin_list_links, from 20261004075417_payer_label_review_fixes.sql
create or replace function public.admin_list_links()
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

  with links as (
    select
      t.*,
      private.join_link_status(t) as fine_status,
      pay.customer_id as payment_customer_id,
      pay.status as payment_status,
      pay.product_snapshot ->> 'name' as product_name,
      pay.payer_label,
      pay.amount_agorot,
      pay.paid_on,
      -- The link a replacement starts from: the live one, or, when every
      -- link of the payment is revoked, the last one revoked.
      case
        when t.state <> 'revoked' then true
        else not exists (
          select 1
          from public.activation_tokens t2
          where t2.payment_id = t.payment_id
            and t2.purpose = 'join'
            and t2.state <> 'revoked'
        )
        and t.id = (
          select t2.id
          from public.activation_tokens t2
          where t2.payment_id = t.payment_id
            and t2.purpose = 'join'
          order by t2.revoked_at desc nulls last, t2.created_at desc, t2.id desc
          limit 1
        )
      end as is_latest,
      exists (
        select 1
        from public.activation_tokens t3
        where t3.payment_id = t.payment_id
          and t3.purpose = 'join'
          and (
            t3.state = 'consumed'
            or private.join_link_status(t3) = 'claiming'
          )
      ) as payment_blocked
    from public.activation_tokens t
    join public.payments pay on pay.id = t.payment_id
    where t.purpose = 'join'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'token_id', l.id,
        'payment_id', l.payment_id,
        'status', case
          when l.fine_status in ('consumed', 'revoked', 'expired') then l.fine_status
          else 'pending'
        end,
        'detail', case
          when l.fine_status in ('awaiting_login', 'stuck', 'conflict') then l.fine_status
        end,
        'detail_name', case
          when l.fine_status = 'awaiting_login' then bound.full_name
        end,
        'conflict_reason', case when l.fine_status = 'conflict' then l.conflict_reason end,
        'product_name', l.product_name,
        'payer_label', case when l.payment_customer_id is null then l.payer_label end,
        'amount_agorot', l.amount_agorot,
        'paid_on', l.paid_on,
        'created_at', l.created_at,
        'expires_at', l.expires_at,
        'consumed_at', l.consumed_at,
        'revoked_at', l.revoked_at,
        'customer_name', case when l.fine_status = 'consumed' then customer.full_name end,
        -- Story 2.14: nothing to revoke or replace on a voided purchase.
        'can_revoke',
          l.state not in ('consumed', 'revoked')
          and l.payment_customer_id is null
          and l.payment_status = 'approved'
          and not l.payment_blocked,
        'can_replace',
          l.is_latest
          and l.payment_customer_id is null
          and l.payment_status = 'approved'
          and not l.payment_blocked
      )
      order by l.created_at desc, l.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from links l
  left join public.profiles bound on bound.id = l.bound_user_id
  left join public.profiles customer on customer.id = l.customer_id;

  return v_result;
end;
$$;


-- 10. ------------------------------------------------------------------------

-- What voiding a purchase would do (story 2.14, AD-7). The purchase's
-- bookings: payment_id = the payment, or an allocation on its entitlement.
-- Refusals ({ok: false, code}), first match: NOT_FOUND; PURCHASE_VOIDED
-- (payment not approved or entitlement not active); PURCHASE_ENTRY_USED (a
-- booking of the purchase completed, or confirmed with its session
-- started); PURCHASE_HAS_CREDIT (a credit from its entitlement, or a refund
-- request on the payment); MANUAL_HANDLING_REQUIRED (a listed booking funded
-- from two kinds of entry). Result: {ok, payment_id, entitlement_id, kind,
-- customer_id, customer_label, product_name, amount_agorot, paid_on,
-- link_will_be_revoked, bookings: [{booking_id, event_id, starts_at,
-- concept_name, party_size, guest_details}]}: the confirmed bookings whose
-- session has not started, by starts_at; each is cancelled with no credit.
create function private.plan_admin_void_purchase(p_payment_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_entitlement public.entitlements;
  v_label text;
  v_link boolean;
  v_bookings jsonb;
begin
  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id;

  if v_payment.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment.id;

  if v_entitlement.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_payment.status <> 'approved' or v_entitlement.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'PURCHASE_VOIDED');
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.events ev on ev.id = b.event_id
    where (
        b.payment_id = v_payment.id
        or exists (
          select 1
          from public.booking_allocations a
          where a.booking_id = b.id
            and a.entitlement_id = v_entitlement.id
        )
      )
      and (
        b.status = 'completed'
        or (b.status = 'confirmed' and ev.starts_at <= now())
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'PURCHASE_ENTRY_USED');
  end if;

  if exists (
    select 1
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
  ) or exists (
    select 1
    from public.refund_requests r
    where r.payment_id = v_payment.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'PURCHASE_HAS_CREDIT');
  end if;

  -- Every confirmed booking left has its session ahead (above).
  if exists (
    select 1
    from public.bookings b
    where b.status = 'confirmed'
      and (
        b.payment_id = v_payment.id
        or exists (
          select 1
          from public.booking_allocations a
          where a.booking_id = b.id
            and a.entitlement_id = v_entitlement.id
        )
      )
      and private.needs_manual_cancel(b.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  -- A join link that is neither revoked nor consumed (pending, awaiting
  -- login, conflict, or claiming past 15 minutes; one claiming in progress
  -- is refused under the lock, LINK_IN_PROGRESS).
  v_link := v_payment.customer_id is null and exists (
    select 1
    from public.activation_tokens t
    where t.payment_id = v_payment.id
      and t.purpose = 'join'
      and t.state not in ('revoked', 'consumed')
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', x.id,
        'event_id', x.event_id,
        'starts_at', x.starts_at,
        'concept_name', x.concept_name,
        'party_size', x.party_size,
        'guest_details', x.guest_details
      )
      order by x.starts_at, x.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from (
    select b.id, b.event_id, ev.starts_at, c.name as concept_name,
      b.party_size, b.guest_details
    from public.bookings b
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where b.status = 'confirmed'
      and (
        b.payment_id = v_payment.id
        or exists (
          select 1
          from public.booking_allocations a
          where a.booking_id = b.id
            and a.entitlement_id = v_entitlement.id
        )
      )
  ) x;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'entitlement_id', v_entitlement.id,
    'kind', v_entitlement.kind,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'product_name', v_payment.product_snapshot ->> 'name',
    'amount_agorot', v_payment.amount_agorot,
    'paid_on', v_payment.paid_on,
    'link_will_be_revoked', v_link,
    'bookings', v_bookings
  );
end;
$$;

create function public.preview_admin_void_purchase(p_payment_id uuid)
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

  return private.plan_admin_void_purchase(p_payment_id);
end;
$$;

-- Tal voids a purchase recorded by mistake (story 2.14; final, no undo).
-- Order: is_admin, idempotency, the payment's customer and entitlement read
-- without a lock; bound: her profile (private.lock_customer); unbound:
-- private.lock_join_payment (advisory lock and the link rows;
-- LINK_IN_PROGRESS while she is joining; bound meanwhile ->
-- CONCURRENT_CHANGE); the sessions of the purchase's confirmed bookings by
-- id, those bookings, the entitlements they draw on, the payment; the
-- customer re-checked (CONCURRENT_CHANGE); the plan (its code is raised);
-- the reason (over 2000 after trimming: INVALID_INPUT, detail reason);
-- p_confirmed (CONFIRM_REQUIRED). Then each listed booking is cancelled
-- (private.cancel_core, void mode: released, no credit, no notification,
-- the waitlist hears of the place), the entitlement is revoked, the payment
-- voided (both audited with the reason) and a live join link revoked.
-- Result: {payment_id, cancelled_count, revoked_pending_user_id} (the
-- pending Auth user of a stuck claiming link, deleted by the server).
create function public.admin_void_purchase(
  p_payment_id uuid,
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
  v_found boolean;
  v_customer uuid;
  v_entitlement_id uuid;
  v_live public.activation_tokens;
  v_locked uuid[];
  v_payment public.payments;
  v_payment_new public.payments;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_plan jsonb;
  v_item jsonb;
  v_count integer := 0;
  v_pending_user_id uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_void_purchase', p_idempotency_key,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'reason', v_reason,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Read without a lock (AD-6): the parent first, then the children.
  select true, pay.customer_id into v_found, v_customer
  from public.payments pay
  where pay.id = p_payment_id;

  if v_found is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select e.id into v_entitlement_id
  from public.entitlements e
  where e.payment_id = p_payment_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  else
    begin
      v_live := private.lock_join_payment(p_payment_id);
    exception
      when raise_exception then
        -- She joined between the read and the lock.
        if sqlerrm = 'LINK_USED' then
          raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
        end if;
        raise;
    end;
  end if;

  perform 1
  from public.events ev
  where ev.id in (
    select b.event_id
    from public.bookings b
    where b.status = 'confirmed'
      and (
        b.payment_id = p_payment_id
        or exists (
          select 1
          from public.booking_allocations a
          where a.booking_id = b.id
            and a.entitlement_id = v_entitlement_id
        )
      )
  )
  order by ev.id
  for update;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_locked
  from (
    select b.id
    from public.bookings b
    where b.status = 'confirmed'
      and (
        b.payment_id = p_payment_id
        or exists (
          select 1
          from public.booking_allocations a
          where a.booking_id = b.id
            and a.entitlement_id = v_entitlement_id
        )
      )
    order by b.id
    for update
  ) x;

  perform 1
  from public.entitlements e
  where e.id = v_entitlement_id
     or e.id in (
       select a.entitlement_id
       from public.booking_allocations a
       where a.booking_id = any (v_locked)
     )
  order by e.id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  if v_payment.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_plan := private.plan_admin_void_purchase(p_payment_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  -- A booking made after the locks were taken.
  if exists (
    select 1
    from jsonb_array_elements(v_plan -> 'bookings') x
    where not ((x ->> 'booking_id')::uuid = any (v_locked))
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in
    select x
    from jsonb_array_elements(v_plan -> 'bookings') x
  loop
    perform private.cancel_core(
      (v_item ->> 'booking_id')::uuid, v_actor, 'admin', 'admin_void_purchase',
      v_reason, 'void'
    );
    v_count := v_count + 1;
  end loop;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = v_entitlement_id;

  update public.entitlements
  set status = 'revoked'
  where id = v_entitlement.id
  returning * into v_entitlement_new;

  perform private.audit(
    v_actor, 'admin', 'admin_void_purchase', 'entitlements', v_entitlement.id,
    v_entitlement.customer_id, v_entitlement.pinned_event_id,
    to_jsonb(v_entitlement), to_jsonb(v_entitlement_new), v_reason
  );

  update public.payments
  set status = 'voided', voided_at = now()
  where id = v_payment.id
  returning * into v_payment_new;

  perform private.audit(
    v_actor, 'admin', 'admin_void_purchase', 'payments', v_payment.id,
    v_payment.customer_id, null, to_jsonb(v_payment), to_jsonb(v_payment_new), v_reason
  );

  if v_live.id is not null then
    v_pending_user_id := private.revoke_join_token(v_live, v_actor);
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_void_purchase', p_idempotency_key,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'cancelled_count', v_count,
      'revoked_pending_user_id', v_pending_user_id
    )
  );
end;
$$;

-- Grants (AD-5): the helpers none, every RPC exactly one.
revoke execute on function private.cancel_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.lock_join_payment(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_void_purchase(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;

revoke execute on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;

revoke execute on function public.admin_get_entitlement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_entitlement(uuid) to authenticated;

revoke execute on function public.admin_list_payments() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_payments() to authenticated;

revoke execute on function public.admin_list_links() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_links() to authenticated;

revoke execute on function public.preview_admin_void_purchase(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_void_purchase(uuid) to authenticated;

revoke execute on function public.admin_void_purchase(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_void_purchase(uuid, text, boolean, uuid) to authenticated;
