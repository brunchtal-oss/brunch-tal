-- Story 3.11: the duplicate warning by name (user decision 2026-10-05, SPEC
-- memlog; supersedes the rule of 20261005111717). Same signatures (create or
-- replace), grants re-stated (AD-5).
-- 1. A new customer's payer name is required: admin_approve_payment and
--    preview_admin_approve_payment raise INVALID_INPUT (detail.field
--    payer_label) for no customer and an empty label.
-- 2. private.similar_payments_for: the same product, amount, method and
--    window, and
--    - a new customer: the other payment's name (its payer_label, else its
--      bound customer's full_name, not anonymized) equals the typed name
--      (any case, outer spaces); a payment without a name never matches;
--    - an existing customer: her own payment, or an unbound one whose
--      payer_label equals her full_name;
--    - a pinned approval never matches a payment pinned to another session.

-- The similar payments (see the header). Each item: {customer_name,
-- payer_label, paid_on, created_at}.
create or replace function private.similar_payments_for(
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
    and case
      -- A new customer: the other payment's name is the typed one.
      when p_customer_id is null then
        nullif(lower(btrim(p_payer_label)), '') = coalesce(
          nullif(lower(btrim(pay.payer_label)), ''),
          case when pr.anonymized_at is null then nullif(lower(btrim(pr.full_name)), '') end
        )
      -- An existing customer: her own payment, or an unbound one named as
      -- she is.
      else
        pay.customer_id = p_customer_id
        or (
          pay.customer_id is null
          and nullif(lower(btrim(pay.payer_label)), '') = (
            select nullif(lower(btrim(me.full_name)), '')
            from public.profiles me
            where me.id = p_customer_id
          )
        )
    end
    -- Two different sessions are two purchases.
    and not (
      p_event_id is not null
      and ent.pinned_event_id is not null
      and ent.pinned_event_id <> p_event_id
    );
$$;

-- As in 20261005111717, plus the required payer name of a new customer.
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

  -- A new customer's payer name is required (user decision 2026-10-05).
  if p_customer_id is null and v_label is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "payer_label"}';
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

-- As in 20261005111717, plus the required payer name of a new customer.
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

  -- A new customer's payer name is required (user decision 2026-10-05).
  if p_customer_id is null and v_label is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "payer_label"}';
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

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.similar_payments_for(uuid, text, uuid, integer, uuid, date, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) to authenticated;
