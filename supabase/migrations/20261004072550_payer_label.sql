-- Story 2.5, after the review (user decision 2026-10-04): "שם לזיהוי", an
-- optional label for a new customer's payment (payments.payer_label), so
-- Tal can tell new customers apart until they join (AD-5, AD-10, AD-19).
-- 1. payments.payer_label: null or 1..40 characters after btrim. No grant
--    to authenticated (the customer never reads it).
-- 2. private.audit_diff masks payer_label on payments.
-- 3. private.similar_payments (drop, then create) takes the label: two
--    payments that both have a label, and the labels differ (lower(btrim()))
--    are not similar; each item also returns payer_label.
-- 4. admin_approve_payment and preview_admin_approve_payment (drop, then
--    create) take p_payer_label right after p_customer_id: empty -> null,
--    over 40 characters or with an existing customer -> INVALID_INPUT. The
--    core does not change: the wrapper sets the label after it and audits.
-- 5. admin_list_links and admin_list_payments also return payer_label.

alter table public.payments
  add column payer_label text
    check (payer_label is null or char_length(btrim(payer_label)) between 1 and 40);

-- ---------------------------------------------------------------------------
-- private.audit_diff: payer_label is masked on payments
-- ---------------------------------------------------------------------------

-- As in 20260930191525, plus payments.payer_label.
create or replace function private.audit_diff(p_old jsonb, p_new jsonb, p_table text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with keys as (
    select k from jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as k
    union
    select k from jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as k
  ),
  changed as (
    select
      k,
      coalesce(p_old, '{}'::jsonb) ? k as in_old,
      coalesce(p_new, '{}'::jsonb) ? k as in_new,
      coalesce(p_old, '{}'::jsonb) -> k as old_value,
      coalesce(p_new, '{}'::jsonb) -> k as new_value,
      (
        p_table = 'babies'
        or (p_table = 'profiles' and k = 'full_name')
        or (p_table = 'bookings' and k = 'guest_details')
        or (p_table = 'payments' and k = 'payer_label')
        or k in ('phone_e164', 'dietary_notes', 'pending_email',
                 'email', 'token_hash', 'input_hash')
        or k like '%\_email'
      ) as masked
    from keys
    where (coalesce(p_old, '{}'::jsonb) -> k) is distinct from (coalesce(p_new, '{}'::jsonb) -> k)
  )
  select jsonb_build_object(
    'before', coalesce(
      jsonb_object_agg(k, case when masked then to_jsonb('<changed>'::text) else old_value end)
        filter (where in_old),
      '{}'::jsonb
    ),
    'after', coalesce(
      jsonb_object_agg(k, case when masked then to_jsonb('<changed>'::text) else new_value end)
        filter (where in_new),
      '{}'::jsonb
    )
  )
  from changed;
$$;

-- ---------------------------------------------------------------------------
-- private.similar_payments: the payer label
-- ---------------------------------------------------------------------------

drop function private.similar_payments(uuid, uuid, integer, uuid, date);

-- As in 20261003220222, plus p_payer_label: a payment is not similar when
-- both have a label and the labels differ (any case, outer spaces). Each
-- item: {customer_name, payer_label, paid_on, created_at}.
create function private.similar_payments(
  p_customer_id uuid,
  p_payer_label text,
  p_product_id uuid,
  p_amount_agorot integer,
  p_payment_method_id uuid,
  p_paid_on date
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
    -- Two different labels (any case, outer spaces) are two payers.
    and not (
      nullif(btrim(pay.payer_label), '') is not null
      and nullif(btrim(p_payer_label), '') is not null
      and lower(btrim(pay.payer_label)) <> lower(btrim(p_payer_label))
    );
$$;

-- ---------------------------------------------------------------------------
-- admin_approve_payment: p_payer_label
-- ---------------------------------------------------------------------------

drop function public.admin_approve_payment(uuid, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid);

-- As in 20261004070751, plus p_payer_label (a new customer only; empty ->
-- null; over 40 or with p_customer_id -> INVALID_INPUT), passed to
-- private.similar_payments and set on the payment after the core, audited.
create function public.admin_approve_payment(
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
      'payer_label', p_payer_label,
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

  -- Lock order (AD-6): profiles before the product and the payment.
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
     and jsonb_array_length(private.similar_payments(
       p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
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
      )
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
    )
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- preview_admin_approve_payment: p_payer_label
-- ---------------------------------------------------------------------------

drop function public.preview_admin_approve_payment(uuid, uuid, uuid, integer, date, uuid);

-- As in 20261003220222, plus p_payer_label (the same checks as the approval),
-- passed to private.similar_payments.
create function public.preview_admin_approve_payment(
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

  return v_plan || jsonb_build_object(
    'customer_name', v_customer_name,
    'similar_payments', private.similar_payments(
      p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
    ),
    'duplicate_window_days', (
      select s.duplicate_payment_window_days from public.business_settings s
    ),
    'expired', now() >= (v_plan ->> 'expires_at')::timestamptz
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_links, admin_list_payments: payer_label
-- ---------------------------------------------------------------------------

-- As in 20261003141504, plus payer_label (shown until the customer joins).
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
        'payer_label', l.payer_label,
        'amount_agorot', l.amount_agorot,
        'paid_on', l.paid_on,
        'created_at', l.created_at,
        'expires_at', l.expires_at,
        'consumed_at', l.consumed_at,
        'revoked_at', l.revoked_at,
        'customer_name', case when l.fine_status = 'consumed' then customer.full_name end,
        'can_revoke',
          l.state not in ('consumed', 'revoked')
          and l.payment_customer_id is null
          and not l.payment_blocked,
        'can_replace',
          l.is_latest
          and l.payment_customer_id is null
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

-- As in 20261003220222, plus payer_label.
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
        'note', l.note
      )
      order by l.created_at desc, l.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select pay.*, pr.full_name as customer_name
    from public.payments pay
    left join public.profiles pr on pr.id = pay.customer_id
    order by pay.created_at desc, pay.id desc
    limit 50
  ) l;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer functions (as owner).
revoke execute on function private.audit_diff(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function private.similar_payments(uuid, text, uuid, integer, uuid, date) from public, anon, authenticated, service_role;

revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, text, uuid, uuid, integer, date, uuid) to authenticated;

revoke execute on function public.admin_list_links() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_links() to authenticated;

revoke execute on function public.admin_list_payments() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_payments() to authenticated;
