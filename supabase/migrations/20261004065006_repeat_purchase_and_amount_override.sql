-- Story 2.5: repeat purchase and amount override (AD-5, AD-6, AD-7, AD-10,
-- AD-12, AD-19; user decisions 2026-10-04).
-- 1. business_settings.duplicate_payment_window_days (default 7, >= 0).
-- 2. Display helpers (deferred from 2.12): private.format_day_month (DD.MM)
--    and private.format_agorot (as formatAgorot in lib/money.ts).
-- 3. private.similar_payments: approved payments with the same product,
--    amount and method within the window of the purchase date.
-- 4. The purchase_repeat template ends with {card_tip}.
-- 5. admin_approve_payment (drop, then create) takes p_customer_id first and
--    p_duplicate_confirmed before the key: an existing customer gets the
--    purchase at once (no token) and purchase_repeat in the queue.
-- 6. preview_admin_approve_payment (drop, then create) takes p_customer_id
--    first and p_payment_method_id last, and adds the customer's name and
--    the similar payments to the plan.
-- 7. admin_search_customers and admin_list_payments (read, admin).
-- approve_payment_core and plan_approve_payment do not change.

-- ---------------------------------------------------------------------------
-- business_settings.duplicate_payment_window_days
-- ---------------------------------------------------------------------------

-- A payment with the same product, amount and method whose purchase date is
-- at most this many days before or after the new one is shown as a possible
-- duplicate before the approval (edited in the settings, 4.7).
alter table public.business_settings
  add column duplicate_payment_window_days integer not null default 7
    check (duplicate_payment_window_days >= 0);

-- ---------------------------------------------------------------------------
-- Display helpers (pure; called only from definer functions, no grant)
-- ---------------------------------------------------------------------------

-- "12.10" (as formatDayMonth in lib/time.ts for a plain date).
create function private.format_day_month(p_day date)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lpad(extract(day from p_day)::int::text, 2, '0')
    || '.'
    || lpad(extract(month from p_day)::int::text, 2, '0');
$$;

-- "128 ₪", "1,234 ₪", "127.50 ₪", "-5 ₪" (as formatAgorot in lib/money.ts):
-- whole shekels with thousands grouping, agorot only when there are any.
create function private.format_agorot(p_agorot integer)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case when p_agorot < 0 then '-' else '' end
    || regexp_replace((abs(p_agorot::bigint) / 100)::text, '(\d)(?=(\d{3})+$)', '\1,', 'g')
    || case
         when abs(p_agorot::bigint) % 100 = 0 then ''
         else '.' || lpad((abs(p_agorot::bigint) % 100)::text, 2, '0')
       end
    || ' ₪';
$$;

-- ---------------------------------------------------------------------------
-- private.similar_payments
-- ---------------------------------------------------------------------------

-- Approved payments with the same product, amount and payment method whose
-- purchase date is within business_settings.duplicate_payment_window_days of
-- p_paid_on (before or after). For an existing customer: hers, or not bound
-- yet; for a new customer (p_customer_id null): any. Newest purchase first.
-- Each item: {customer_name (null when not bound), paid_on, created_at}.
create function private.similar_payments(
  p_customer_id uuid,
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
    );
$$;

-- ---------------------------------------------------------------------------
-- purchase_repeat: {card_tip} (user decision 2026-10-04, SPEC memlog)
-- ---------------------------------------------------------------------------

-- card_tip: for a card, '. ' and the body of purchase_new_card; otherwise
-- empty. No notification was created from the previous wording, so the
-- version stays.
update public.notification_templates
set body = '{product}, בתוקף עד {expires_on}{card_tip}'
where type = 'purchase_repeat';

-- ---------------------------------------------------------------------------
-- admin_approve_payment: new and existing customer
-- ---------------------------------------------------------------------------

drop function public.admin_approve_payment(uuid, uuid, integer, text, date, uuid, text, text, boolean, uuid);

-- Tal approves a payment (CAP-2, CAP-6). p_customer_id null: a new customer,
-- as before (payment, entitlement and a join link; the raw token is returned
-- once, a repeat returns reissue_required: true). p_customer_id set: the
-- customer's profile is locked (AD-6); missing or anonymized ->
-- CUSTOMER_NOT_AVAILABLE; the purchase is hers at once (no token, bound_at
-- null) and purchase_repeat goes to the queue (discriminator payment_id).
-- Before the locks an advisory lock on product + amount + method, so two
-- approvals of the same payment cannot both miss each other; after the locks
-- private.similar_payments runs again and a result without
-- p_duplicate_confirmed raises DUPLICATE_CONFIRM_REQUIRED. A changed amount
-- needs p_confirmed (CONFIRM_REQUIRED); its reason is kept by the core.
-- Result: {payment_id, entitlement_id, customer_id, expires_on} (+ token_id,
-- link_expires_at, reissue_required and once the token for a new customer).
create function public.admin_approve_payment(
  p_customer_id uuid,
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
       p_customer_id, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
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
    if v_entitlement.kind = 'card' then
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
        'expires_on', v_entitlement.expires_on
      )
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
-- preview_admin_approve_payment
-- ---------------------------------------------------------------------------

drop function public.preview_admin_approve_payment(uuid, uuid, integer, date);

-- What the approval will create (AD-7): the plan, plus customer_name (null
-- for a new customer), similar_payments (private.similar_payments),
-- duplicate_window_days (the window the warning names) and expired (the
-- expiry has already passed, by the server's clock). The same customer check
-- as the approval, without the lock.
create function public.preview_admin_approve_payment(
  p_customer_id uuid,
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
  v_plan jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
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
      p_customer_id, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on
    ),
    'duplicate_window_days', (
      select s.duplicate_payment_window_days from public.business_settings s
    ),
    'expired', now() >= (v_plan ->> 'expires_at')::timestamptz
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_search_customers, admin_list_payments (read, admin; no idempotency)
-- ---------------------------------------------------------------------------

-- Tal finds a customer by part of her name (any case) or by her phone in any
-- format (a full number through private.normalize_phone, or a run of its
-- digits, local or international). At least 2 characters (after trimming),
-- at most 100, otherwise INVALID_INPUT. Anonymized profiles are never
-- returned. Up to 20, by name. Items: {id, full_name, phone_e164}.
create function public.admin_search_customers(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(p_query);
  v_phone text;
  v_digits text;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_query is null or char_length(v_query) not between 2 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_phone := private.normalize_phone(v_query);
  -- Only a query made of phone characters is matched by its digits.
  if v_query ~ '^[0-9+() .-]+$' then
    v_digits := nullif(regexp_replace(v_query, '[^0-9]', '', 'g'), '');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone_e164', c.phone_e164)
      order by c.full_name, c.id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select p.id, p.full_name, p.phone_e164
    from public.profiles p
    where p.anonymized_at is null
      and (
        strpos(lower(p.full_name), lower(v_query)) > 0
        or (v_phone is not null and p.phone_e164 = v_phone)
        or (
          v_digits is not null
          and p.phone_e164 is not null
          and (
            strpos(substr(p.phone_e164, 2), v_digits) > 0
            or (
              p.phone_e164 like '+972%'
              and strpos('0' || substr(p.phone_e164, 5), v_digits) > 0
            )
          )
        )
      )
    order by p.full_name, p.id
    limit 20
  ) c;

  return v_result;
end;
$$;

-- The 50 latest payments for /admin/payments, newest approval first. Product,
-- price and method from the payment's snapshot (as they were at approval);
-- customer_name null while the purchase is not bound. Filters, search and
-- sums arrive in E4.
create function public.admin_list_payments()
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

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.format_day_month(date) from public, anon, authenticated, service_role;
revoke execute on function private.format_agorot(integer) from public, anon, authenticated, service_role;
revoke execute on function private.similar_payments(uuid, uuid, integer, uuid, date) from public, anon, authenticated, service_role;

revoke execute on function public.admin_approve_payment(uuid, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, uuid, uuid, integer, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, uuid, uuid, integer, date, uuid) to authenticated;

revoke execute on function public.admin_search_customers(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_customers(text) to authenticated;

revoke execute on function public.admin_list_payments() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_payments() to authenticated;
