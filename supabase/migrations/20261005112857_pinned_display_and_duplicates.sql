-- Story 3.11, after the phone test (user decisions 2026-10-05, SPEC and UX
-- memlog). Same signatures (create or replace), grants re-stated (AD-5).
-- 1. A session's kind always follows its concept (concepts.default_kind):
--    admin_create_event and admin_update_event refuse a kind
--    (INVALID_INPUT, detail.field kind). The concept cannot change in an
--    update, so the kind never changes there.
-- 2. token_view also returns the session of a pinned purchase
--    (session_starts_at, concept_name): the join page names it instead of
--    the product.
-- 3. The duplicate warning: private.similar_payments_for (new, with the
--    session) is not similar for two different payer names or two different
--    sessions; admin_approve_payment and preview_admin_approve_payment use it.

-- As in 20261004160747, without kind: the session's kind is always the
-- concept's default_kind (a kind in p_event -> INVALID_INPUT, field kind).
create or replace function public.admin_create_event(p_event jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_concept public.concepts;
  v_concept_text text;
  v_publish boolean := false;
  v_settings public.business_settings;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_event', p_idempotency_key, p_event
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_concept_text := p_event ->> 'concept_id';
  if jsonb_typeof(p_event -> 'concept_id') is distinct from 'string'
     or v_concept_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  if p_event ? 'publish' then
    if jsonb_typeof(p_event -> 'publish') <> 'boolean' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "publish"}';
    end if;
    v_publish := (p_event ->> 'publish')::boolean;
  end if;

  select c.* into v_concept
  from public.concepts c
  where c.id = v_concept_text::uuid
    and c.archived_at is null;

  if v_concept.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  select s.* into v_settings from public.business_settings s;

  v_row.concept_id := v_concept.id;
  v_row.kind := v_concept.default_kind;
  v_row.description := v_concept.description;
  v_row := private.apply_event_changes(
    v_row,
    p_event - 'concept_id' - 'publish',
    array['date', 'start_time', 'end_time', 'description',
          'capacity_adults', 'display_price_agorot', 'registration_closes_local']
  );
  if not (p_event ? 'capacity_adults') then
    v_row.capacity_adults := case v_row.kind
      when 'couple' then v_settings.default_capacity_couple
      else v_settings.default_capacity_regular
    end;
  end if;

  v_saved := private.save_event(v_row, true);

  if v_publish then
    update public.events
    set status = 'published'
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_create_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id, 'status', v_saved.status)
  );
end;
$$;

-- As in 20261004191220, without kind (INVALID_INPUT, field kind): the kind
-- follows the concept, which cannot change here.
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
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;

-- As private.similar_payments (20261004072550), plus (user decisions
-- 2026-10-05) a payment is not similar when:
-- (a) the typed payer label and the other payment's name differ (any case,
--     outer spaces). The other name is its payer_label, else its bound
--     customer's full_name (not anonymized). When either side has no name,
--     this rule does not apply.
-- (b) the new approval is pinned to a session (p_event_id) and the other
--     payment's entitlement is pinned to a different session.
-- Each item: {customer_name, payer_label, paid_on, created_at}. A new
-- function because the event is a new parameter (no drop); admin_approve_payment
-- and preview_admin_approve_payment call it.
create function private.similar_payments_for(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_amount_agorot integer,
  p_payment_method_id uuid,
  p_paid_on date,
  p_event_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_name', case when pr.anonymized_at is null then pr.full_name end,
        'payer_label', pay.payer_label,
        'paid_on', pay.paid_on,
        'created_at', pay.created_at
      )
      order by pay.paid_on desc, pay.created_at desc, pay.id desc
    ),
    '[]'::jsonb
  )
  from public.payments pay
  cross join public.business_settings s
  left join public.profiles pr on pr.id = pay.customer_id
  left join public.entitlements ent on ent.payment_id = pay.id
  where pay.status = 'approved'
    and pay.product_id = p_product_id
    and pay.amount_agorot = p_amount_agorot
    and pay.payment_method_id = p_payment_method_id
    and abs(pay.paid_on - p_paid_on) <= s.duplicate_payment_window_days
    and (
      p_customer_id is null
      or pay.customer_id = p_customer_id
      or pay.customer_id is null
    )
    -- (a) Two different names (any case, outer spaces) are two payers.
    and not (
      nullif(btrim(p_payer_label), '') is not null
      and coalesce(
        nullif(btrim(pay.payer_label), ''),
        case when pr.anonymized_at is null then nullif(btrim(pr.full_name), '') end
      ) is not null
      and lower(btrim(p_payer_label)) <> lower(coalesce(
        nullif(btrim(pay.payer_label), ''),
        btrim(pr.full_name)
      ))
    )
    -- (b) Two different sessions are two purchases.
    and not (
      p_event_id is not null
      and ent.pinned_event_id is not null
      and ent.pinned_event_id <> p_event_id
    );
$$;

-- As in 20261004212706, with private.similar_payments_for and the session.
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
     and jsonb_array_length(private.similar_payments_for(
       p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on,
       p_event_id
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

-- As in 20261004221450, with private.similar_payments_for and the session.
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
    'similar_payments', private.similar_payments_for(
      p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on,
      p_event_id
    ),
    'duplicate_window_days', (
      select s.duplicate_payment_window_days from public.business_settings s
    ),
    'expired', now() >= (v_plan ->> 'expires_at')::timestamptz
  );
end;
$$;

-- As in 20261002200634, plus session_starts_at and concept_name of a pinned
-- purchase (null for a days product).
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

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.similar_payments_for(uuid, text, uuid, integer, uuid, date, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_create_event(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_event(jsonb, uuid) to authenticated;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) to authenticated;

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;
