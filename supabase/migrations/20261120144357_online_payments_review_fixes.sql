-- Online payments, PR A: fixes after review ("Decisions after review" in
-- spec-online-payments-grow-a.md). Every redefinition starts from its
-- definition in 20261120100720_online_payments.sql.
--
-- - checkouts: first_notified_at (the 503 window and the attention item),
--   checked_at (reconciliation order), product_snapshot (the grant's fields).
-- - Issue reasons: closed_by_admin, product_changed, customer_unavailable.
-- - private.find_checkout: secret kind 'system' (reconciliation; every
--   caller is a service_role RPC).
-- - private.close_checkout: p_notify (re-holding the same session tells no
--   waitlist).
-- - begin_checkout: service_role only, with the verified auth uid
--   (p_auth_uid); the customer is still derived here.
-- - record_online_payment: an issue checkout without a payment accepts a
--   verified document (unless Tal closed it); product_changed;
--   customer_unavailable; her other open hold on the event is closed first.
-- - mark_checkout_notified answers retry_allowed (the 30-minute window).
-- - admin_close_unconfirmed_checkout; claim_checkouts_to_reconcile and the
--   reconcile_payments job (pg_net to /api/jobs/reconcile-payments).
-- - job_cleanup: 90 days, never a notified checkout. Attention: unconfirmed
--   by first_notified_at; online_purchase_incomplete skips a live
--   conflict or stuck link.

-- ---------------------------------------------------------------------------
-- 1. Columns and the issue reasons
-- ---------------------------------------------------------------------------

alter table public.checkouts
  add column first_notified_at timestamptz,
  add column checked_at timestamptz,
  add column product_snapshot jsonb
    constraint checkouts_product_snapshot_check
      check (product_snapshot is null or jsonb_typeof(product_snapshot) = 'object');

create index checkouts_reconcile_idx on public.checkouts (checked_at nulls first, created_at)
  where state in ('open', 'failed', 'expired');

alter table public.online_payment_issues
  drop constraint online_payment_issues_reason_check,
  add constraint online_payment_issues_reason_check check (reason in (
    'not_verified', 'amount_mismatch', 'second_payment',
    'intro_not_eligible', 'approve_failed',
    'closed_by_admin', 'product_changed', 'customer_unavailable'
  ));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The product fields an online grant uses, kept on the checkout when it
-- starts and compared with the live product before the grant.
create function private.checkout_product_snapshot(p_product public.products)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'type', p_product.type,
    'units', p_product.units,
    'validity_mode', p_product.validity_mode,
    'validity_days', p_product.validity_days,
    'allowed_weekdays', p_product.allowed_weekdays,
    'eligible_event_kind', p_product.eligible_event_kind,
    'party_size', p_product.party_size,
    'intro_only', p_product.intro_only,
    'price_agorot', p_product.price_agorot
  );
$$;

-- Kind 'system': reconciliation, without a secret. Every caller is a
-- service_role RPC; only checkout_for_confirm and record_online_payment
-- pass a kind from their input.
create or replace function private.find_checkout(p_checkout_id uuid, p_secret text, p_kind text)
returns public.checkouts
language sql
stable
set search_path = ''
as $$
  select c.*
  from public.checkouts c
  where c.id = p_checkout_id
    and (
      p_kind = 'system'
      or (
        p_secret is not null
        and char_length(p_secret) between 16 and 200
        and p_kind in ('notify', 'browser')
        and (case p_kind
               when 'notify' then c.notify_secret_hash
               else c.browser_secret_hash
             end) = private.token_hash(p_secret)
      )
    );
$$;

-- p_notify false: the caller holds the same session again in this
-- transaction, so no place is freed for the waitlist.
drop function private.close_checkout(uuid, text);

create function private.close_checkout(p_checkout_id uuid, p_state text, p_notify boolean default true)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row public.checkouts;
  v_event public.events;
  v_free_before integer;
begin
  if p_state is null or p_state not in ('failed', 'expired', 'issue') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select c.* into v_row
  from public.checkouts c
  where c.id = p_checkout_id;

  if v_row.id is null or v_row.state not in ('open', 'failed', 'expired') then
    return;
  end if;

  if v_row.state = 'open' and v_row.event_id is not null and p_notify is not false then
    select e.* into v_event
    from public.events e
    where e.id = v_row.event_id;

    v_free_before := v_event.capacity_adults - private.occupied_places(v_event.id)
      - case
          when v_row.closed_at is null and v_row.hold_until > now() then 0
          else v_row.party_size
        end;
  end if;

  update public.checkouts
  set state = p_state, closed_at = coalesce(closed_at, now())
  where id = v_row.id;

  if v_free_before is not null then
    perform private.notify_waitlist(v_row.event_id, v_free_before);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Begin: the product snapshot; re-holding the same session is silent
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
    now() + make_interval(mins => v_settings.online_payment_window_minutes),
    case when v_event.id is not null then
      now() + make_interval(mins => v_settings.online_payment_window_minutes
                                    + v_settings.online_hold_grace_minutes)
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

-- Service role only (the kill switch is enforced by the server before it
-- calls): p_auth_uid is the uid of the verified session claims, never
-- browser input. The customer is derived here with the rule of
-- private.current_customer_id (activated, not anonymized). Declared
-- exception in security-and-rpc-rules.md.
drop function public.begin_checkout(uuid, uuid, boolean, uuid);

create function public.begin_checkout(
  p_auth_uid uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_terms_accepted boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_prev jsonb;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.id into v_customer
  from public.profiles p
  where p.id = p_auth_uid
    and p.activated_at is not null
    and p.anonymized_at is null;

  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_customer::text, 'begin_checkout', p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'event_id', p_event_id,
      'terms_accepted', p_terms_accepted
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_result := private.begin_checkout_core(v_customer, p_product_id, p_event_id, p_terms_accepted);

  -- The stored result has no raw secret (AD-10): a replay asks to reissue.
  perform private.idempotent_finish(
    v_customer::text, 'begin_checkout', p_idempotency_key,
    (v_result - 'notify_secret' - 'browser_secret')
      || jsonb_build_object('reissue_required', true)
  );

  return v_result || jsonb_build_object('reissue_required', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Notification: first_notified_at and the 30-minute retry window
-- ---------------------------------------------------------------------------

-- retry_allowed: Grow may be asked to retry (503) only while the checkout is
-- open and within 30 minutes of the first notification; afterwards the
-- route answers 200 and reconciliation takes over.
create or replace function public.mark_checkout_notified(p_checkout_id uuid, p_notify_secret text)
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

  v_row := private.find_checkout(p_checkout_id, p_notify_secret, 'notify');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.checkouts
  set last_notified_at = now(),
      first_notified_at = coalesce(first_notified_at, now())
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'retry_allowed',
      v_row.state = 'open' and now() <= v_row.first_notified_at + interval '30 minutes'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. record_online_payment
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

  -- Paid, or closed by Tal after she checked it in Grow: another document
  -- is a second payment, never a second grant. An issue checkout without a
  -- payment still accepts a verified document.
  if v_row.state = 'paid'
     or exists (
       select 1
       from public.online_payment_issues i
       where i.checkout_id = v_row.id
         and i.reason = 'closed_by_admin'
     ) then
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

    if private.checkout_product_snapshot(v_product) is distinct from v_row.product_snapshot then
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
-- 6. cancel_checkout: a row deleted meanwhile is not found; customer_known
-- ---------------------------------------------------------------------------

create or replace function public.cancel_checkout(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
  v_kind text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_row.event_id is not null then
    perform 1
    from public.events e
    where e.id = v_row.event_id
    for update;
  end if;

  select c.* into v_row
  from public.checkouts c
  where c.id = v_row.id
  for update;

  if not found then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_row.state = 'open' then
    perform private.close_checkout(v_row.id, 'failed');
  end if;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  return jsonb_build_object(
    'state', (select c.state from public.checkouts c where c.id = v_row.id),
    'product_kind', v_kind,
    'event_id', v_row.event_id,
    'customer_known', v_row.customer_id is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Tal closes an unconfirmed checkout (she checked it in Grow)
-- ---------------------------------------------------------------------------

-- The checkout moves to 'issue' with a resolved closed_by_admin issue, so a
-- later verified document is a second payment, never a second grant (e.g.
-- after she approved the payment by hand). An open hold is released.
create function public.admin_close_unconfirmed_checkout(
  p_checkout_id uuid,
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
  v_event_id uuid;
  v_old public.checkouts;
  v_new public.checkouts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_close_unconfirmed_checkout', p_idempotency_key,
    jsonb_build_object('checkout_id', p_checkout_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): the session, then the checkout.
  select c.event_id into v_event_id
  from public.checkouts c
  where c.id = p_checkout_id;

  if v_event_id is not null then
    perform 1
    from public.events e
    where e.id = v_event_id
    for update;
  end if;

  select c.* into v_old
  from public.checkouts c
  where c.id = p_checkout_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.event_id is distinct from v_event_id then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old.state not in ('open', 'failed', 'expired') then
    raise exception 'CHECKOUT_NOT_CLOSABLE' using errcode = 'P0001';
  end if;

  perform private.close_checkout(v_old.id, 'issue');

  insert into public.online_payment_issues (
    checkout_id, provider_transaction_id, reason, resolved_at, resolved_by
  )
  values (v_old.id, null, 'closed_by_admin', now(), v_actor);

  select c.* into v_new
  from public.checkouts c
  where c.id = v_old.id;

  perform private.audit(
    v_actor, 'admin', 'admin_close_unconfirmed_checkout', 'checkouts',
    v_old.id, v_old.customer_id, v_old.event_id,
    jsonb_build_object('state', v_old.state),
    jsonb_build_object('state', v_new.state),
    v_old.reference
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_close_unconfirmed_checkout', p_idempotency_key,
    jsonb_build_object('checkout_id', v_old.id, 'state', v_new.state)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The resolve audit: only the changed columns, the reference as reason
-- ---------------------------------------------------------------------------

create or replace function public.admin_resolve_online_payment_issue(
  p_issue_id uuid,
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
  v_old public.online_payment_issues;
  v_new public.online_payment_issues;
  v_checkout public.checkouts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_resolve_online_payment_issue', p_idempotency_key,
    jsonb_build_object('issue_id', p_issue_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select i.* into v_old
  from public.online_payment_issues i
  where i.id = p_issue_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.resolved_at is null then
    update public.online_payment_issues
    set resolved_at = now(), resolved_by = v_actor
    where id = v_old.id
    returning * into v_new;

    select c.* into v_checkout
    from public.checkouts c
    where c.id = v_old.checkout_id;

    perform private.audit(
      v_actor, 'admin', 'admin_resolve_online_payment_issue', 'online_payment_issues',
      v_old.id, v_checkout.customer_id, v_checkout.event_id,
      jsonb_build_object('resolved_at', v_old.resolved_at, 'resolved_by', v_old.resolved_by),
      jsonb_build_object('resolved_at', v_new.resolved_at, 'resolved_by', v_new.resolved_by),
      v_checkout.reference
    );
  else
    v_new := v_old;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_resolve_online_payment_issue', p_idempotency_key,
    jsonb_build_object('issue_id', v_new.id, 'resolved_at', v_new.resolved_at)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Reconciliation: the candidates, the pg_net call, the job
-- ---------------------------------------------------------------------------

-- At most p_limit unpaid checkouts of the last 7 days, the least recently
-- checked first; checked_at is stamped now, so the next run takes others.
-- Exempt from idempotency (a claim, as claim_push_jobs).
create function public.claim_checkouts_to_reconcile(p_limit integer)
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

-- POST <app_url>/api/jobs/reconcile-payments with Bearer cron_secret from
-- Vault, as private.invoke_push_worker. Without values in Vault: nothing.
create function private.invoke_reconcile_payments()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select rtrim(btrim(s.decrypted_secret), '/') into v_url
  from vault.decrypted_secrets s
  where s.name = 'app_url';

  select btrim(s.decrypted_secret) into v_secret
  from vault.decrypted_secrets s
  where s.name = 'cron_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  return net.http_post(
    url := v_url || '/api/jobs/reconcile-payments',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

-- Every 10 minutes (pg_cron): calls the route only when an unpaid checkout
-- of the last 7 days exists. Safe to run twice.
create function private.job_reconcile_payments()
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
  ) then
    return null;
  end if;

  return private.invoke_reconcile_payments();
end;
$$;

create or replace function private.job_intervals()
 returns table(jobname text, every interval)
 language sql
 stable
 set search_path to ''
as $function$
  values
    ('reminders'::text, interval '1 minute'),
    ('invoke_push_worker', interval '1 minute'),
    ('complete_events', interval '5 minutes'),
    ('refresh_credit_options', interval '15 minutes'),
    ('marketing_reminders', interval '5 minutes'),
    ('expiry_alerts', interval '1 hour'),
    ('auto_extend', interval '1 hour'),
    ('cleanup', interval '1 day'),
    -- Online payments (PR A).
    ('release_holds', interval '1 minute'),
    ('reconcile_payments', interval '10 minutes');
$function$;

-- ---------------------------------------------------------------------------
-- 10. job_cleanup: 90 days, never a notified checkout
-- ---------------------------------------------------------------------------

create or replace function private.job_cleanup()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_count integer := 0;
begin
  begin
    delete from public.notifications n
    where n.read_at < now() - interval '90 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: notifications failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from public.notification_jobs j
    where j.finished_at < now() - interval '30 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: notification_jobs failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from private.idempotency_results r
    where r.created_at < now() - interval '7 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: idempotency_results failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from cron.job_run_details d
    where d.end_time < now() - interval '14 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: job_run_details failed: % %', sqlstate, sqlerrm;
  end;

  -- 5.6's rule (deferred-work, target 5.10): the active waitlist entries of
  -- a session that started, was cancelled or completed are closed (they
  -- are already hidden; this only records it). A row held by another
  -- transaction waits for the next run.
  begin
    update public.waitlist_entries w
    set status = 'closed', closed_at = now()
    where w.id in (
      select we.id
      from public.waitlist_entries we
      join public.events e on e.id = we.event_id
      where we.status = 'active'
        and (
          e.starts_at <= now()
          or e.status in ('cancelled', 'completed')
        )
      order by we.id
      for update of we skip locked
    );
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: waitlist_entries failed: % %', sqlstate, sqlerrm;
  end;

  -- Online payments: an unpaid checkout (failed or expired) older than 90
  -- days. One Grow ever notified, or one with an issue row, stays (the
  -- evidence of a payment).
  begin
    delete from public.checkouts c
    where c.id in (
      select ch.id
      from public.checkouts ch
      where ch.state in ('failed', 'expired')
        and ch.created_at < now() - interval '90 days'
        and ch.first_notified_at is null
        and not exists (
          select 1 from public.online_payment_issues i where i.checkout_id = ch.id
        )
      order by ch.id
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: checkouts failed: % %', sqlstate, sqlerrm;
  end;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Attention: unconfirmed by first_notified_at; online_purchase_incomplete
-- skips a payment whose live link is in a conflict or stuck
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_attention_items()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.source,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  -- Every scheduled job (private.job_intervals) with its cron.job row, if
  -- any (an active one first).
  jobs as (
    select ji.jobname, ji.every, j.jobid, coalesce(j.active, false) as active
    from private.job_intervals() ji
    left join lateral (
      select cj.jobid, cj.active
      from cron.job cj
      where cj.jobname = ji.jobname
      order by cj.active desc, cj.jobid desc
      limit 1
    ) j on true
  ),
  -- Per job, by index lookups only (no aggregate over the whole of
  -- cron.job_run_details): its latest run, its latest succeeded run, and
  -- whether any run started more than 3 x its frequency ago.
  -- missing: not in cron.job, or not active. failed: its latest run failed.
  -- late: no succeeded run ended within 3 x its frequency, and either a
  -- succeeded run exists or a run started before that window (a first run
  -- still running is not late). A job with no runs at all is not flagged.
  job_states as (
    select
      jb.jobname,
      case
        when jb.jobid is null or not jb.active then 'missing'
        when lr.status = 'failed' then 'failed'
        when (ok.end_time is null or ok.end_time < now() - jb.every * 3)
          and (
            ok.runid is not null
            or exists (
              select 1
              from cron.job_run_details od
              where od.jobid = jb.jobid
                and od.start_time < now() - jb.every * 3
            )
          ) then 'late'
      end as reason,
      case
        when jb.jobid is null or not jb.active then now()
        when lr.status = 'failed'
          then coalesce(lr.end_time, lr.start_time, now())
        else coalesce(ok.end_time, lr.start_time, now())
      end as since
    from jobs jb
    left join lateral (
      select d.runid, d.status, d.start_time, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
      order by d.runid desc
      limit 1
    ) lr on true
    left join lateral (
      select d.runid, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
        and d.status = 'succeeded'
      order by d.runid desc
      limit 1
    ) ok on true
    where jb.jobid is null
       or not jb.active
       or lr.runid is not null
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    -- An online purchase has its own item after 24 hours
    -- (online_purchase_incomplete).
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and p.source <> 'online'
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- An online purchase paid more than 24 hours ago and still not joined.
    select
      p.created_at,
      p.id,
      jsonb_build_object(
        'kind', 'online_purchase_incomplete',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', p.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    where p.status = 'approved'
      and p.source = 'online'
      and p.customer_id is null
      and p.created_at < now() - interval '24 hours'
      -- A live conflict or stuck link already shows as its own item.
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status in ('conflict', 'stuck')
      )

    union all

    -- An online payment Tal checks by hand (not verified, amount mismatch,
    -- second payment, intro race, approval failure), until resolved.
    select
      i.created_at,
      i.id,
      jsonb_build_object(
        'kind', 'online_payment_issue',
        'id', i.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', i.created_at,
        'customer_id', c.customer_id,
        'reason', i.reason,
        'reference', c.reference,
        'product_name', c.product_name,
        'amount_agorot', coalesce(i.amount_agorot, c.amount_agorot),
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at
      )
    from public.online_payment_issues i
    join public.checkouts c on c.id = i.checkout_id
    left join public.profiles pr on pr.id = c.customer_id
    left join public.events ev on ev.id = c.event_id
    left join public.concepts cn on cn.id = ev.concept_id
    where i.resolved_at is null

    union all

    -- Grow first notified 30 minutes ago, nothing was confirmed, and she
    -- did not return: Tal checks it in Grow (and may close it,
    -- admin_close_unconfirmed_checkout).
    select
      c.first_notified_at,
      c.id,
      jsonb_build_object(
        'kind', 'online_payment_unconfirmed',
        'id', c.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', c.first_notified_at,
        'customer_id', c.customer_id,
        'reference', c.reference,
        'product_name', c.product_name,
        'amount_agorot', c.amount_agorot,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at
      )
    from public.checkouts c
    left join public.profiles pr on pr.id = c.customer_id
    left join public.events ev on ev.id = c.event_id
    left join public.concepts cn on cn.id = ev.concept_id
    where c.first_notified_at is not null
      and c.state not in ('paid', 'issue')
      and c.first_notified_at < now() - interval '30 minutes'
      and not exists (
        select 1
        from public.online_payment_issues i
        where i.checkout_id = c.id
          and i.resolved_at is null
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'event_status', ev.status,
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- A refund she asked for (3.7), open until Tal completes it (3.9).
    select
      r.requested_at,
      r.id,
      jsonb_build_object(
        'kind', 'refund_requested',
        'id', r.id,
        'customer_label', p.customer_label,
        'since', r.requested_at,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'amount_agorot', r.amount_agorot,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.refund_requests r
    join pay p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where r.status = 'requested'

    union all

    -- A business cancel she has not chosen for yet (3.8): refund or credit,
    -- no deadline; bound credits only.
    select
      cb.cancelled_at,
      c.id,
      jsonb_build_object(
        'kind', 'choice_pending',
        'id', c.id,
        'customer_label', coalesce(nullif(btrim(pr.full_name), ''), p.customer_label),
        'since', cb.cancelled_at,
        'customer_id', c.customer_id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'amount_agorot', c.monetary_basis_agorot
      )
    from public.cancellation_credits c
    join public.entitlements se on se.id = c.source_entitlement_id
    join pay p on p.id = se.payment_id
    left join public.profiles pr on pr.id = c.customer_id
    join public.bookings cb on cb.id = private.credit_cancelled_booking(c.id)
    join public.events ev on ev.id = cb.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where c.status = 'active'
      and c.choice_pending
      and c.customer_id is not null

    union all

    -- A booking that no longer fits its card after a correction (3.13): the
    -- latest unhandled warning per booking, while the booking is confirmed,
    -- its session has not started and the card still does not fit it.
    select
      w.since,
      w.booking_id,
      jsonb_build_object(
        'kind', 'correction_affected',
        'id', w.booking_id,
        'customer_id', coalesce(b.customer_id, p.customer_id),
        'customer_label', p.customer_label,
        'since', w.since,
        'entitlement_id', e.id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'field', w.field
      )
    from (
      select distinct on (cb.booking_id)
        cb.booking_id, co.entitlement_id, co.field, co.created_at as since
      from public.entitlement_correction_bookings cb
      join public.entitlement_corrections co on co.id = cb.correction_id
      where cb.handled_at is null
      order by cb.booking_id, co.created_at desc, co.id desc
    ) w
    join public.bookings b on b.id = w.booking_id
    join public.entitlements e on e.id = w.entitlement_id
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where b.status = 'confirmed'
      and ev.starts_at > now()
      and not private.entitlement_fits_event(e, ev)

    union all

    -- An email change stuck between its steps for more than 15 minutes
    -- (2.8, AD-21); saving the same address again on the card resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'email_change_stuck',
        'id', pr.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'email_change_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'
      and pr.anonymized_at is null

    union all

    -- A removal of personal details stuck between its steps for more than
    -- 15 minutes (4.6, AD-21): no anonymized_at filter (step 1 set it); the
    -- card's "complete the removal" resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'anonymization_stuck',
        'id', pr.id,
        'customer_label', null,
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'anonymization_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null

    union all

    -- Push notifications that failed in the last 7 days (5.8): one item for
    -- all of them, since the latest failure.
    select
      f.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_failed',
        'id', 'push_failed',
        'customer_label', null,
        'since', f.since,
        'count', f.n
      )
    from (
      select max(j.finished_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'failed'
        and j.finished_at >= now() - interval '7 days'
    ) f
    where f.n > 0

    union all

    -- A scheduled job that failed, is late or is missing (5.10, AD-22): one
    -- item per job; the item's id is the jobname.
    select
      s.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'job_failed',
        'id', s.jobname,
        'customer_label', null,
        'since', s.since,
        'job', s.jobname,
        'reason', s.reason
      )
    from job_states s
    where s.reason is not null

    union all

    -- app_url or cron_secret absent or empty in Vault (5.10, AD-22): push
    -- never leaves. Only the item, never a value.
    select
      now(),
      null::uuid,
      jsonb_build_object(
        'kind', 'vault_missing',
        'id', 'vault_missing',
        'customer_label', null,
        'since', now()
      )
    where not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'app_url'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )
      or not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'cron_secret'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )

    union all

    -- Push jobs still queued 15 minutes after they were due (5.10): the
    -- worker is not reached (a wrong secret or URL). One item for all.
    select
      q.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_stuck',
        'id', 'push_stuck',
        'customer_label', null,
        'since', q.since,
        'count', q.n
      )
    from (
      select min(j.next_attempt_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'queued'
        and j.next_attempt_at < now() - interval '15 minutes'
    ) q
    where q.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function private.checkout_product_snapshot(public.products) from public, anon, authenticated, service_role;
revoke execute on function private.find_checkout(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.close_checkout(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.begin_checkout_core(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.invoke_reconcile_payments() from public, anon, authenticated, service_role;
revoke execute on function private.job_reconcile_payments() from public, anon, authenticated, service_role;
revoke execute on function private.job_intervals() from public, anon, authenticated, service_role;
revoke execute on function private.job_cleanup() from public, anon, authenticated, service_role;

revoke execute on function public.begin_checkout(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_checkout(uuid, uuid, uuid, boolean, uuid) to service_role;

revoke execute on function public.mark_checkout_notified(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_notified(uuid, text) to service_role;

revoke execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) to service_role;

revoke execute on function public.cancel_checkout(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_checkout(uuid, text) to service_role;

revoke execute on function public.admin_close_unconfirmed_checkout(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_close_unconfirmed_checkout(uuid, uuid) to authenticated;

revoke execute on function public.admin_resolve_online_payment_issue(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_resolve_online_payment_issue(uuid, uuid) to authenticated;

revoke execute on function public.claim_checkouts_to_reconcile(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_checkouts_to_reconcile(integer) to service_role;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Schedule (AD-11): every 10 minutes
-- ---------------------------------------------------------------------------

select cron.schedule('reconcile_payments', '*/10 * * * *', 'select private.job_reconcile_payments()');
