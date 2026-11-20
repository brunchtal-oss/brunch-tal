-- Online payments, PR A: review pass 2 ("Decisions after review", pass 2
-- bullets, in spec-online-payments-grow-a.md). Redefinitions start from
-- 20261120144357_online_payments_review_fixes.sql (or 20261120100720 where
-- that one did not redefine them).
--
-- - Issue reason late_document: a checkout with an issue never grants
--   automatically (record_online_payment); only 'paid' gives replay or
--   second_payment.
-- - The product snapshot is compared without price_agorot.
-- - Re-beginning the same session keeps the previous hold_until.
-- - checkouts.form_created_at (mark_checkout_form_created) and the
--   reconciliation skips checkouts without a form or still in their window.
-- - checkouts.join_issued_at: checkout_return issues a join link once.
-- - rate_limit_hit: checkout id:<uid> keys 5 an hour, ip keys 10.
--
-- The issue reason check is replaced (drop + add in one statement, as in
-- 20261120144357): it is never absent.

-- ---------------------------------------------------------------------------
-- 1. Columns and the issue reason
-- ---------------------------------------------------------------------------

alter table public.checkouts
  add column form_created_at timestamptz,
  add column join_issued_at timestamptz;

alter table public.online_payment_issues
  drop constraint online_payment_issues_reason_check,
  add constraint online_payment_issues_reason_check check (reason in (
    'not_verified', 'amount_mismatch', 'second_payment',
    'intro_not_eligible', 'approve_failed',
    'closed_by_admin', 'product_changed', 'customer_unavailable',
    'late_document'
  ));

-- ---------------------------------------------------------------------------
-- 2. The form was created (set once; exempt from idempotency, an absolute
-- value)
-- ---------------------------------------------------------------------------

create function public.mark_checkout_form_created(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.checkouts
  set form_created_at = coalesce(form_created_at, now())
  where id = v_row.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. begin_checkout_core: no extension by re-beginning the same session
-- ---------------------------------------------------------------------------

create or replace function private.begin_checkout_core(
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_terms_accepted boolean
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_product public.products;
  v_event public.events;
  v_settings public.business_settings;
  v_prev_events uuid[] := '{}'::uuid[];
  v_prev public.checkouts;
  v_place jsonb;
  v_party integer;
  v_id uuid := gen_random_uuid();
  v_notify text;
  v_browser text;
  v_row public.checkouts;
  -- Review pass 2: the hold of her previous open checkout of the same
  -- session; the new one never ends later (no extension by re-beginning).
  v_keep_hold timestamptz;
begin
  if p_terms_accepted is not true then
    raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_product_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Lock order (AD-6): profiles -> events -> checkouts. Her open checkouts'
  -- sessions are read without a lock, locked with the new one by id, and
  -- checked again under the checkout lock.
  if p_customer_id is not null then
    perform 1
    from public.profiles p
    where p.id = p_customer_id
    for update;

    select coalesce(array_agg(distinct c.event_id), '{}'::uuid[]) into v_prev_events
    from public.checkouts c
    where c.customer_id = p_customer_id
      and c.state = 'open'
      and c.event_id is not null;
  end if;

  perform 1
  from public.events e
  where e.id = any (array_remove(v_prev_events || p_event_id, null))
  order by e.id
  for update;

  -- One open checkout per customer: the previous one fails and its hold is
  -- released. The waitlist hears of it, unless the new checkout holds the
  -- same session (no place is freed). A late payment on it still lands.
  if p_customer_id is not null then
    for v_prev in
      select c.*
      from public.checkouts c
      where c.customer_id = p_customer_id
        and c.state = 'open'
      order by c.id
      for update
    loop
      if v_prev.event_id is not null and not (v_prev.event_id = any (v_prev_events)) then
        raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
      end if;
      if v_prev.event_id = p_event_id then
        v_keep_hold := least(coalesce(v_keep_hold, v_prev.hold_until), v_prev.hold_until);
      end if;
      perform private.close_checkout(
        v_prev.id, 'failed', v_prev.event_id is distinct from p_event_id
      );
    end loop;
  end if;

  select p.* into v_product
  from public.products p
  where p.id = p_product_id
  for share;

  if v_product.id is null or not v_product.active or v_product.price_agorot <= 0 then
    raise exception 'PRODUCT_NOT_PURCHASABLE' using errcode = 'P0001';
  end if;

  if v_product.validity_mode = 'session' then
    if p_event_id is null then
      raise exception 'PINNED_EVENT_REQUIRED' using errcode = 'P0001';
    end if;

    select e.* into v_event
    from public.events e
    where e.id = p_event_id;

    if v_event.id is null or v_event.status <> 'published' then
      raise exception 'EVENT_NOT_BOOKABLE' using errcode = 'P0001';
    end if;

    -- The self-booking rules (book_session): the moment after the locks.
    if clock_timestamp() >= v_event.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
    end if;

    -- Full (other holds count), not fit, already booked, intro.
    v_place := private.plan_pinned_placement(p_customer_id, p_product_id, p_event_id, null);
    if not (v_place ->> 'ok')::boolean then
      raise exception '%', v_place ->> 'code' using errcode = 'P0001';
    end if;

    v_party := case when v_event.kind = 'couple' then 2 else 1 end;
  else
    if p_event_id is not null then
      raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
    end if;

    if (v_product.type = 'intro' or v_product.intro_only)
       and p_customer_id is not null
       and private.intro_blocked(p_customer_id, null) then
      raise exception 'INTRO_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;

    v_party := v_product.party_size;
  end if;

  select s.* into v_settings from public.business_settings s;

  v_notify := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_browser := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  insert into public.checkouts (
    id, customer_id, product_id, event_id, party_size, amount_agorot,
    product_name, reference, state, pay_until, hold_until,
    notify_secret_hash, browser_secret_hash, terms_accepted_at,
    product_snapshot
  )
  values (
    v_id,
    p_customer_id,
    v_product.id,
    v_event.id,
    v_party,
    v_product.price_agorot,
    v_product.name,
    'BT-' || upper(left(replace(v_id::text, '-', ''), 10)),
    'open',
    least(
      now() + make_interval(mins => v_settings.online_payment_window_minutes),
      v_keep_hold
    ),
    case when v_event.id is not null then
      least(
        now() + make_interval(mins => v_settings.online_payment_window_minutes
                                      + v_settings.online_hold_grace_minutes),
        v_keep_hold
      )
    end,
    private.token_hash(v_notify),
    private.token_hash(v_browser),
    now(),
    private.checkout_product_snapshot(v_product)
  )
  returning * into v_row;

  return jsonb_build_object(
    'checkout_id', v_row.id,
    'reference', v_row.reference,
    'amount_agorot', v_row.amount_agorot,
    'product_name', v_row.product_name,
    'product_kind', v_product.validity_mode,
    'event_id', v_row.event_id,
    'pay_until', v_row.pay_until,
    'notify_secret', v_notify,
    'browser_secret', v_browser
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. record_online_payment: late_document; the price is not compared
-- ---------------------------------------------------------------------------

create or replace function public.record_online_payment(
  p_checkout_id uuid,
  p_secret text,
  p_secret_kind text,
  p_document_id text,
  p_outcome text,
  p_amount_agorot integer,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc text := nullif(btrim(p_document_id), '');
  v_row public.checkouts;
  v_payment public.payments;
  v_issue public.online_payment_issues;
  v_product public.products;
  v_event public.events;
  v_other public.checkouts;
  v_outcome text := p_outcome;
  v_paid_on date;
  v_free_before integer;
  v_payment_id uuid;
  v_entitlement public.entitlements;
  v_card_tip text := '';
  v_code text;
  v_reason text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_outcome is null
     or p_outcome not in ('verified', 'not_verified', 'amount_mismatch')
     or (p_outcome <> 'not_verified' and v_doc is null)
     or char_length(coalesce(v_doc, '')) > 200
     or (p_outcome = 'verified' and p_amount_agorot is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_secret, p_secret_kind);
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_doc is not null then
    perform pg_advisory_xact_lock(hashtext('grow:' || v_doc));

    -- Replay: the same document already became a payment.
    select pay.* into v_payment
    from public.payments pay
    where pay.provider = 'grow'
      and pay.provider_transaction_id = v_doc;

    if v_payment.id is not null then
      return jsonb_build_object(
        'state', (select c.state from public.checkouts c where c.id = v_row.id),
        'payment_id', v_payment.id,
        'replayed', true
      );
    end if;
  end if;

  -- Replay: the same document (or the same "no single document") already
  -- became an issue of this checkout.
  select i.* into v_issue
  from public.online_payment_issues i
  where i.checkout_id = v_row.id
    and coalesce(i.provider_transaction_id, '') = coalesce(v_doc, '');

  if v_issue.id is not null then
    return jsonb_build_object(
      'state', (select c.state from public.checkouts c where c.id = v_row.id),
      'issue', v_issue.reason,
      'replayed', true
    );
  end if;

  -- Lock order (AD-6): profiles -> events -> checkouts.
  if v_row.customer_id is not null then
    perform 1
    from public.profiles p
    where p.id = v_row.customer_id
    for update;
  end if;

  if v_row.event_id is not null then
    select e.* into v_event
    from public.events e
    where e.id = v_row.event_id
    for update;
  end if;

  select c.* into v_row
  from public.checkouts c
  where c.id = v_row.id
  for update;

  -- Deleted meanwhile (cleanup).
  if not found then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Paid: another document is a second payment, never a second grant.
  if v_row.state = 'paid' then
    insert into public.online_payment_issues (
      checkout_id, provider_transaction_id, amount_agorot, reason, detail
    )
    values (
      v_row.id, v_doc, p_amount_agorot, 'second_payment',
      jsonb_build_object('outcome', p_outcome)
    )
    on conflict do nothing;

    return jsonb_build_object('state', v_row.state, 'issue', 'second_payment');
  end if;

  -- Defense in depth: the amount is the checkout's, never the payload's.
  if v_outcome = 'verified' and p_amount_agorot <> v_row.amount_agorot then
    v_outcome := 'amount_mismatch';
  end if;

  -- Review pass 2: a checkout with an issue (resolved or not; Tal may have
  -- settled it by hand) never grants automatically. A verified document is
  -- a late_document issue for Tal; once per (checkout, document).
  if v_row.state = 'issue' then
    v_reason := case when v_outcome = 'verified' then 'late_document' else v_outcome end;

    insert into public.online_payment_issues (
      checkout_id, provider_transaction_id, amount_agorot, reason
    )
    values (v_row.id, v_doc, p_amount_agorot, v_reason)
    on conflict do nothing;

    return jsonb_build_object('state', 'issue', 'issue', v_reason);
  end if;

  -- A known customer who was anonymized (or is no longer active), or a
  -- product edited since the checkout started: Tal handles it, no payment.
  if v_outcome = 'verified'
     and v_row.customer_id is not null
     and not exists (
       select 1
       from public.profiles p
       where p.id = v_row.customer_id
         and p.activated_at is not null
         and p.anonymized_at is null
     ) then
    v_outcome := 'customer_unavailable';
  end if;

  if v_outcome = 'verified' and v_row.product_snapshot is not null then
    select p.* into v_product
    from public.products p
    where p.id = v_row.product_id
    for share;

    -- Review pass 2: the price is not compared (the core handles a price
    -- change); snapshots stored before keep the key.
    if (private.checkout_product_snapshot(v_product) - 'price_agorot')
       is distinct from (v_row.product_snapshot - 'price_agorot') then
      v_outcome := 'product_changed';
    end if;
  end if;

  if v_outcome <> 'verified' then
    insert into public.online_payment_issues (
      checkout_id, provider_transaction_id, amount_agorot, reason
    )
    values (v_row.id, v_doc, p_amount_agorot, v_outcome);

    perform private.close_checkout(v_row.id, 'issue');

    return jsonb_build_object('state', 'issue', 'issue', v_outcome);
  end if;

  -- Her other open holds on this session would park her own payment: they
  -- are closed first (their release tells the waitlist as usual).
  if v_row.customer_id is not null and v_row.event_id is not null then
    for v_other in
      select c.*
      from public.checkouts c
      where c.customer_id = v_row.customer_id
        and c.event_id = v_row.event_id
        and c.state = 'open'
        and c.id <> v_row.id
      order by c.id
      for update
    loop
      perform private.close_checkout(v_other.id, 'failed');
    end loop;
  end if;

  -- Verified. The free places before, as if an open hold still counted.
  if v_row.event_id is not null and v_row.state = 'open' then
    v_free_before := v_event.capacity_adults - private.occupied_places(v_event.id)
      - case when v_row.hold_until > now() then 0 else v_row.party_size end;
  end if;

  v_paid_on := least(
    (coalesce(p_paid_at, now()) at time zone 'Asia/Jerusalem')::date,
    (now() at time zone 'Asia/Jerusalem')::date
  );

  begin
    -- The hold stops counting before the core checks the seat.
    update public.checkouts
    set closed_at = coalesce(closed_at, now())
    where id = v_row.id;

    v_payment_id := private.approve_payment_core(
      'online', null, 'system', v_row.customer_id, v_row.product_id,
      v_row.event_id, v_row.amount_agorot, null, v_paid_on, null, null, null,
      'grow', v_doc, 'park'
    );

    update public.checkouts
    set state = 'paid', payment_id = v_payment_id
    where id = v_row.id;
  exception when sqlstate 'P0001' then
    v_code := sqlerrm;
    v_payment_id := null;
  end;

  if v_payment_id is null then
    v_reason := case when v_code = 'INTRO_NOT_ELIGIBLE' then 'intro_not_eligible' else 'approve_failed' end;

    insert into public.online_payment_issues (
      checkout_id, provider_transaction_id, amount_agorot, reason, detail
    )
    values (
      v_row.id, v_doc, p_amount_agorot, v_reason,
      jsonb_build_object('code', v_code)
    );

    perform private.close_checkout(v_row.id, 'issue');

    return jsonb_build_object('state', 'issue', 'issue', v_reason);
  end if;

  if v_free_before is not null then
    perform private.notify_waitlist(v_row.event_id, v_free_before);
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

  -- A known customer and a non-pinned product: purchase_repeat, as
  -- admin_approve_payment (a pinned one got booking_confirmed in the core).
  if v_row.customer_id is not null and v_entitlement.pinned_event_id is null then
    if v_entitlement.kind = 'card'
       and private.local_day_end(v_entitlement.expires_on) > now() then
      select '. ' || t.body into v_card_tip
      from public.notification_templates t
      where t.type = 'purchase_new_card';
    end if;

    select p.* into v_product
    from public.products p
    where p.id = v_row.product_id;

    perform private.enqueue_notification(
      v_row.customer_id,
      'purchase_repeat',
      v_payment_id::text,
      jsonb_build_object(
        'product', v_product.name,
        'expires_on', private.format_day_month(v_entitlement.expires_on),
        'card_tip', coalesce(v_card_tip, '')
      ),
      '/me'
    );
  end if;

  return jsonb_build_object('state', 'paid', 'payment_id', v_payment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. checkout_return: the join link once per checkout
-- ---------------------------------------------------------------------------

create or replace function public.checkout_return(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
  v_kind text;
  v_payment public.payments;
  v_live public.activation_tokens;
  v_token jsonb;
  v_result jsonb;
  v_join_issued_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  v_result := jsonb_build_object(
    'state', v_row.state,
    'product_kind', v_kind,
    'event_id', v_row.event_id,
    'customer_known', v_row.customer_id is not null
  );

  if v_row.state <> 'paid' or v_row.customer_id is not null then
    return v_result;
  end if;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = v_row.payment_id;

  if v_payment.customer_id is not null then
    return v_result || jsonb_build_object('joined', true);
  end if;

  begin
    -- Lock order (AD-6): the payment's join tokens first. Raises LINK_USED
    -- (bound or consumed), PURCHASE_VOIDED, LINK_IN_PROGRESS (claiming).
    v_live := private.lock_join_payment(v_payment.id);
  exception when sqlstate 'P0001' then
    return v_result || jsonb_build_object(
      'joined', sqlerrm = 'LINK_USED',
      'join_blocked', sqlerrm <> 'LINK_USED'
    );
  end;

  -- Review pass 2: one link per checkout, read under the token lock; a
  -- later return is blocked (the browser drops its cookie entry anyway).
  select c.join_issued_at into v_join_issued_at
  from public.checkouts c
  where c.id = v_row.id
  for update;

  if v_join_issued_at is not null then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  -- A conflict stays for Tal ("לטיפול"); no new link over it.
  if v_live.id is not null and v_live.state = 'conflict' then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  if v_live.id is not null then
    update public.activation_tokens
    set state = 'revoked', revoked_at = now()
    where id = v_live.id;
  end if;

  v_token := private.issue_token('join', null, v_payment.id);

  update public.checkouts
  set join_issued_at = now()
  where id = v_row.id;

  return v_result || jsonb_build_object(
    'joined', false,
    'join_token', v_token ->> 'token'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reconciliation: only checkouts with a form, past their window
-- ---------------------------------------------------------------------------

create or replace function public.claim_checkouts_to_reconcile(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  with picked as (
    select c.id
    from public.checkouts c
    where c.state in ('open', 'failed', 'expired')
      and c.created_at > now() - interval '7 days'
      -- Review pass 2: Grow made a form, and an open one is past its window.
      and c.form_created_at is not null
      and not (c.state = 'open' and c.pay_until > now())
    order by c.checked_at nulls first, c.created_at, c.id
    limit p_limit
    for update skip locked
  ),
  stamped as (
    update public.checkouts c
    set checked_at = now()
    from picked
    where c.id = picked.id
    returning c.id
  )
  select array_agg(s.id) into v_ids
  from stamped s;

  return to_jsonb(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

create or replace function private.job_reconcile_payments()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.checkouts c
    where c.state in ('open', 'failed', 'expired')
      and c.created_at > now() - interval '7 days'
      and c.form_created_at is not null
      and not (c.state = 'open' and c.pay_until > now())
  ) then
    return null;
  end if;

  return private.invoke_reconcile_payments();
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. rate_limit_hit: the customer's checkout key
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_hit(p_bucket text, p_keys text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- checkout counts by the hour; the others by 15 minutes.
  v_window timestamptz := case
    when p_bucket = 'checkout' then date_trunc('hour', now())
    else to_timestamp(floor(extract(epoch from now()) / 900) * 900)
  end;
  v_key text;
  v_hits integer;
  v_limit integer;
  v_allowed boolean := true;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_bucket is null or p_bucket not in ('login', 'token', 'email', 'checkout')
     or p_keys is null
     or cardinality(p_keys) not between 1 and 4
     or exists (
       select 1 from unnest(p_keys) k
       where k is null
          or char_length(k) not between 4 and 512
          or k !~ '^(ip|id):.'
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Sorted, so two concurrent calls lock the rows in one order.
  for v_key in
    select distinct k from unnest(p_keys) k
    order by k
  loop
    insert into private.rate_limits as r (bucket, key_hash, window_start, hits)
    values (
      p_bucket,
      encode(extensions.digest(v_key, 'sha256'), 'hex'),
      v_window,
      1
    )
    on conflict (bucket, key_hash, window_start)
    do update set hits = r.hits + 1
    returning r.hits into v_hits;

    v_limit := case
      -- Review pass 2: a guest's checkout sends the IP only (10 an hour); a
      -- customer's also sends id:<her auth uid> (5 an hour).
      when p_bucket = 'checkout' and v_key like 'id:%' then 5
      when p_bucket = 'checkout' then 10
      when p_bucket = 'email' and v_key like 'ip:%' then 5
      when p_bucket = 'email' then 3
      when v_key like 'ip:%' then 20
      when p_bucket = 'login' then 8
      else 10
    end;

    if v_hits > v_limit then
      v_allowed := false;
    end if;
  end loop;

  -- Old windows are removed a little at a time.
  delete from private.rate_limits
  where ctid in (
    select r.ctid from private.rate_limits r
    where r.window_start < now() - interval '1 day'
    limit 100
  );

  return jsonb_build_object('allowed', v_allowed);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function private.begin_checkout_core(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.job_reconcile_payments() from public, anon, authenticated, service_role;

revoke execute on function public.mark_checkout_form_created(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_form_created(uuid, text) to service_role;

revoke execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) to service_role;

revoke execute on function public.checkout_return(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_return(uuid, text) to service_role;

revoke execute on function public.claim_checkouts_to_reconcile(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_checkouts_to_reconcile(integer) to service_role;

revoke execute on function public.rate_limit_hit(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, text[]) to service_role;
