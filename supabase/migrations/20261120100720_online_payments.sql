-- Online payments with Grow, PR A (spec-online-payments-grow-a.md): checkout
-- rows with a seat hold, the provider confirmation RPCs, the hold release
-- job, the attention items and the public purchase setting. No customer
-- screens (PR B).
--
-- Redefinitions are based on the live pg_get_functiondef (2026-11-20):
-- private.occupied_places, public.admin_update_business_settings,
-- public.admin_get_attention_items, private.job_cleanup,
-- private.job_intervals, public.rate_limit_hit.
--
-- Lock order (AD-6): activation_tokens -> profiles -> events -> checkouts ->
-- bookings -> ... ; online_payment_issues after checkouts. No network call
-- inside a transaction: the server searches morning before calling
-- record_online_payment.

-- ---------------------------------------------------------------------------
-- 1. business_settings: the payment window, the hold grace, public purchase
-- ---------------------------------------------------------------------------

alter table public.business_settings
  add column online_payment_window_minutes integer not null default 10
    constraint business_settings_online_payment_window_minutes_check
      check (online_payment_window_minutes between 1 and 60),
  add column online_hold_grace_minutes integer not null default 5
    constraint business_settings_online_hold_grace_minutes_check
      check (online_hold_grace_minutes between 0 and 30),
  add column public_online_purchase boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. checkouts: one row per payment form; the seat hold lives here (AD-23)
-- ---------------------------------------------------------------------------

create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Only from private.current_customer_id() (null: a guest). Never bound
  -- later: a guest's purchase is bound through its payment (AD-10).
  customer_id uuid references public.profiles (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  party_size smallint not null check (party_size in (1, 2)),
  amount_agorot integer not null check (amount_agorot > 0),
  product_name text not null,
  reference text not null unique check (reference ~ '^BT-[0-9A-F]{10}$'),
  state text not null default 'open'
    check (state in ('open', 'paid', 'failed', 'expired', 'issue')),
  pay_until timestamptz not null,
  hold_until timestamptz,
  notify_secret_hash text not null,
  browser_secret_hash text not null,
  terms_accepted_at timestamptz not null,
  payment_id uuid unique references public.payments (id) on delete restrict,
  closed_at timestamptz,
  last_notified_at timestamptz,
  constraint checkouts_hold_check check ((event_id is null) = (hold_until is null)),
  constraint checkouts_paid_check check ((state = 'paid') = (payment_id is not null)),
  constraint checkouts_closed_check check (state = 'open' or closed_at is not null)
);

create index checkouts_open_event_idx on public.checkouts (event_id) where state = 'open';
create index checkouts_event_id_idx on public.checkouts (event_id);
create index checkouts_customer_id_idx on public.checkouts (customer_id);
create index checkouts_product_id_idx on public.checkouts (product_id);
create index checkouts_notified_idx on public.checkouts (last_notified_at)
  where last_notified_at is not null and state <> 'paid';

alter table public.checkouts enable row level security;
-- Read and written only by definer RPCs: no grant to any API role.
revoke all on table public.checkouts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. online_payment_issues: what Tal checks by hand
-- ---------------------------------------------------------------------------

create table public.online_payment_issues (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  checkout_id uuid not null references public.checkouts (id) on delete restrict,
  provider_transaction_id text
    check (provider_transaction_id is null
           or char_length(btrim(provider_transaction_id)) between 1 and 200),
  amount_agorot integer check (amount_agorot is null or amount_agorot >= 0),
  reason text not null check (reason in (
    'not_verified', 'amount_mismatch', 'second_payment',
    'intro_not_eligible', 'approve_failed'
  )),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint online_payment_issues_resolved_check
    check ((resolved_at is null) = (resolved_by is null))
);

create unique index online_payment_issues_checkout_txn_uidx
  on public.online_payment_issues (checkout_id, coalesce(provider_transaction_id, ''));
create index online_payment_issues_open_idx
  on public.online_payment_issues (created_at) where resolved_at is null;

alter table public.online_payment_issues enable row level security;
revoke all on table public.online_payment_issues from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. occupied_places: confirmed bookings + open, unexpired holds (AD-6, AD-23)
-- ---------------------------------------------------------------------------

create or replace function private.occupied_places(p_event_id uuid)
 returns integer
 language sql
 stable
 set search_path to ''
as $function$
  select (
    coalesce((
      select sum(b.party_size)
      from public.bookings b
      where b.event_id = p_event_id
        and private.is_real_booking(b.status)
    ), 0)
    -- A checkout's hold (online payments): open, not closed inside the
    -- confirming transaction, and not past hold_until.
    + coalesce((
      select sum(c.party_size)
      from public.checkouts c
      where c.event_id = p_event_id
        and c.state = 'open'
        and c.closed_at is null
        and c.hold_until > now()
    ), 0)
  )::integer;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------

-- The checkout of an id and a raw secret of the given kind, else null. The
-- secret is hashed here (sha256, as private.token_hash); nothing else hashes.
create function private.find_checkout(p_checkout_id uuid, p_secret text, p_kind text)
returns public.checkouts
language sql
stable
set search_path = ''
as $$
  select c.*
  from public.checkouts c
  where c.id = p_checkout_id
    and p_secret is not null
    and char_length(p_secret) between 16 and 200
    and p_kind in ('notify', 'browser')
    and (case p_kind
           when 'notify' then c.notify_secret_hash
           else c.browser_secret_hash
         end) = private.token_hash(p_secret);
$$;

-- Closes a checkout that is open, failed or expired (to failed, expired or
-- issue). An open hold that is released tells the waitlist, with
-- free_before as if the hold still counted (also when hold_until already
-- passed). The caller holds the event lock (AD-6) and the checkout row lock.
create function private.close_checkout(p_checkout_id uuid, p_state text)
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

  if v_row.state = 'open' and v_row.event_id is not null then
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
-- 6. Begin a checkout (customer and guest)
-- ---------------------------------------------------------------------------

-- Returns the raw secrets once; the wrappers store the result without them.
create function private.begin_checkout_core(
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

  -- One open checkout per customer: the previous one fails, its hold is
  -- released and the waitlist hears of it. A late payment on it still
  -- lands (record_online_payment accepts failed).
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
      perform private.close_checkout(v_prev.id, 'failed');
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
    notify_secret_hash, browser_secret_hash, terms_accepted_at
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
    now()
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

create function public.begin_checkout(
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
  v_actor uuid := (select auth.uid());
  v_customer uuid := (select private.current_customer_id());
  v_prev jsonb;
  v_result jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'begin_checkout', p_idempotency_key,
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
    v_actor::text, 'begin_checkout', p_idempotency_key,
    (v_result - 'notify_secret' - 'browser_secret')
      || jsonb_build_object('reissue_required', true)
  );

  return v_result || jsonb_build_object('reissue_required', false);
end;
$$;

create function public.begin_guest_checkout(
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
  v_prev jsonb;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    'guest', 'begin_guest_checkout', p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'event_id', p_event_id,
      'terms_accepted', p_terms_accepted
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if not coalesce((select s.public_online_purchase from public.business_settings s), false) then
    raise exception 'PUBLIC_PURCHASE_OFF' using errcode = 'P0001';
  end if;

  v_result := private.begin_checkout_core(null, p_product_id, p_event_id, p_terms_accepted);

  perform private.idempotent_finish(
    'guest', 'begin_guest_checkout', p_idempotency_key,
    (v_result - 'notify_secret' - 'browser_secret')
      || jsonb_build_object('reissue_required', true)
  );

  return v_result || jsonb_build_object('reissue_required', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Confirmation: read, mark notified, record
-- ---------------------------------------------------------------------------

-- What the server needs to search morning. A wrong secret is
-- CHECKOUT_NOT_FOUND too.
create function public.checkout_for_confirm(
  p_checkout_id uuid,
  p_secret text,
  p_secret_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_secret, p_secret_kind);
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'state', v_row.state,
    'reference', v_row.reference,
    'amount_agorot', v_row.amount_agorot,
    'created_on', (v_row.created_at at time zone 'Asia/Jerusalem')::date
  );
end;
$$;

-- Every authenticated notification writes its time first, in its own short
-- call, even when the answer will be 503 (the unconfirmed safety net).
-- Exempt from idempotency: an absolute value.
create function public.mark_checkout_notified(p_checkout_id uuid, p_notify_secret text)
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
  set last_notified_at = now()
  where id = v_row.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- The verified morning document becomes a purchase (AD-10: the shared core,
-- source online, park). Dedupe by (grow, document id): the advisory lock and
-- the unique payments index; a repeat returns the result built from the
-- rows (AD-5). Accepts an open, failed or expired checkout; a paid one gets
-- only the replay or a second_payment issue.
create function public.record_online_payment(
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

  -- A paid checkout (or one already with an issue): another document is a
  -- second payment.
  if v_row.state in ('paid', 'issue') then
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

  if v_outcome in ('not_verified', 'amount_mismatch') then
    insert into public.online_payment_issues (
      checkout_id, provider_transaction_id, amount_agorot, reason
    )
    values (v_row.id, v_doc, p_amount_agorot, v_outcome);

    perform private.close_checkout(v_row.id, 'issue');

    return jsonb_build_object('state', 'issue', 'issue', v_outcome);
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
-- 8. The browser's failure return; 9. the browser's return
-- ---------------------------------------------------------------------------

-- Exempt from idempotency (an absolute state): open -> failed, hold released.
create function public.cancel_checkout(p_checkout_id uuid, p_browser_secret text)
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

  if v_row.state = 'open' then
    perform private.close_checkout(v_row.id, 'failed');
  end if;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  return jsonb_build_object(
    'state', (select c.state from public.checkouts c where c.id = v_row.id),
    'product_kind', v_kind,
    'event_id', v_row.event_id
  );
end;
$$;

-- After the confirm step: where the browser goes. A paid checkout of a new
-- customer gets a fresh join link (the live one is revoked first, without an
-- audit row, as admin_begin_join_fill); the raw token is returned once.
-- Exempt from idempotency: every return replaces the link.
create function public.checkout_return(p_checkout_id uuid, p_browser_secret text)
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

  return v_result || jsonb_build_object(
    'joined', false,
    'join_token', v_token ->> 'token'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. job_release_holds: expire unpaid checkouts (every minute)
-- ---------------------------------------------------------------------------

create function private.job_release_holds()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_row public.checkouts;
  v_count integer := 0;
  v_grace integer;
begin
  select s.online_hold_grace_minutes into v_grace from public.business_settings s;
  v_grace := coalesce(v_grace, 0);

  -- Pinned: past hold_until. Lock order: the session, then its checkouts; a
  -- session or row held elsewhere waits for the next run.
  for v_event_id in
    select distinct c.event_id
    from public.checkouts c
    where c.state = 'open'
      and c.event_id is not null
      and c.hold_until <= now()
    order by c.event_id
  loop
    begin
      perform 1
      from public.events e
      where e.id = v_event_id
      for update skip locked;

      if found then
        for v_row in
          select c.*
          from public.checkouts c
          where c.event_id = v_event_id
            and c.state = 'open'
            and c.hold_until <= now()
          order by c.id
          for update skip locked
        loop
          perform private.close_checkout(v_row.id, 'expired');
          v_count := v_count + 1;
        end loop;
      end if;
    exception when others then
      raise warning 'job_release_holds: event failed: % %', sqlstate, sqlerrm;
    end;
  end loop;

  -- Non-pinned: past pay_until + grace.
  begin
    for v_row in
      select c.*
      from public.checkouts c
      where c.state = 'open'
        and c.event_id is null
        and c.pay_until + make_interval(mins => v_grace) <= now()
      order by c.id
      for update skip locked
    loop
      perform private.close_checkout(v_row.id, 'expired');
      v_count := v_count + 1;
    end loop;
  exception when others then
    raise warning 'job_release_holds: checkouts failed: % %', sqlstate, sqlerrm;
  end;

  return v_count;
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
    ('release_holds', interval '1 minute');
$function$;

-- ---------------------------------------------------------------------------
-- 11. job_cleanup: unpaid checkouts older than 30 days
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

  -- Online payments: an unpaid checkout (failed or expired) older than 30
  -- days. One with an issue row stays (Tal's record).
  begin
    delete from public.checkouts c
    where c.id in (
      select ch.id
      from public.checkouts ch
      where ch.state in ('failed', 'expired')
        and ch.created_at < now() - interval '30 days'
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
-- 12. Attention items: online_payment_issue, online_purchase_incomplete,
-- online_payment_unconfirmed; purchase_without_link skips online purchases
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

    -- Grow notified, nothing was confirmed for 30 minutes, and she did not
    -- return: Tal checks it in Grow.
    select
      c.last_notified_at,
      c.id,
      jsonb_build_object(
        'kind', 'online_payment_unconfirmed',
        'id', c.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', c.last_notified_at,
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
    where c.last_notified_at is not null
      and c.state not in ('paid', 'issue')
      and c.last_notified_at < now() - interval '30 minutes'
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
-- 13. Tal marks an issue as handled
-- ---------------------------------------------------------------------------

create function public.admin_resolve_online_payment_issue(
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
      to_jsonb(v_old), to_jsonb(v_new), null
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
-- 14. rate_limit_hit: bucket checkout, 10 an hour per IP
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
      -- Both keys of a checkout carry the IP (lib/server/privileged/checkout.ts).
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
-- 1b. admin_update_business_settings: the two minutes and the boolean
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_business_settings(p_changes jsonb, p_expected_version integer, p_idempotency_key uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_key text;
  v_value jsonb;
  v_int integer;
  v_old public.business_settings;
  v_row public.business_settings;
  v_prep smallint[];
  v_schedule jsonb;
  v_strip text[] := array['version', 'updated_at'];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_business_settings', p_idempotency_key,
    jsonb_build_object('changes', p_changes, 'expected_version', p_expected_version)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb
     or p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.* into v_old
  from public.business_settings s
  for update;

  if v_old.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
  end if;

  v_row := v_old;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e
  loop
    if v_key in (
      'default_validity_days', 'registration_close_days_before',
      'default_capacity_regular', 'default_capacity_couple',
      'cancel_window_hours', 'credit_options_count', 'reminder_lead_hours',
      'admin_expiring_days', 'customer_expiring_days',
      'last_places_threshold', 'inactivity_months',
      'duplicate_payment_window_days', 'credit_expiring_days',
      'online_payment_window_minutes', 'online_hold_grace_minutes'
    ) then
      -- case keeps the casts behind the type check (no evaluation order in
      -- a boolean "or"); the parentheses let plpgsql find
      -- the THEN of the IF.
      if (case
           when jsonb_typeof(v_value) <> 'number' then true
           else (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
             or abs((v_value #>> '{}')::numeric) > 100000
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
      v_int := (v_value #>> '{}')::numeric::integer;

      if not (case v_key
        when 'default_validity_days' then v_int between 1 and 730
        when 'registration_close_days_before' then v_int between 0 and 7
        when 'default_capacity_regular' then v_int between 1 and 100
        when 'default_capacity_couple' then v_int between 1 and 100
        when 'cancel_window_hours' then v_int between 0 and 336
        when 'credit_options_count' then v_int between 1 and 10
        when 'reminder_lead_hours' then v_int between 1 and 168
        when 'admin_expiring_days' then v_int between 0 and 90
        when 'customer_expiring_days' then v_int between 0 and 90
        when 'last_places_threshold' then v_int between 0 and 50
        when 'inactivity_months' then v_int between 1 and 24
        when 'duplicate_payment_window_days' then v_int between 0 and 60
        when 'credit_expiring_days' then v_int between 1 and 30
        when 'online_payment_window_minutes' then v_int between 1 and 60
        when 'online_hold_grace_minutes' then v_int between 0 and 30
      end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      case v_key
        when 'default_validity_days' then v_row.default_validity_days := v_int;
        when 'registration_close_days_before' then v_row.registration_close_days_before := v_int;
        when 'default_capacity_regular' then v_row.default_capacity_regular := v_int;
        when 'default_capacity_couple' then v_row.default_capacity_couple := v_int;
        when 'cancel_window_hours' then v_row.cancel_window_hours := v_int;
        when 'credit_options_count' then v_row.credit_options_count := v_int;
        when 'reminder_lead_hours' then v_row.reminder_lead_hours := v_int;
        when 'admin_expiring_days' then v_row.admin_expiring_days := v_int;
        when 'customer_expiring_days' then v_row.customer_expiring_days := v_int;
        when 'last_places_threshold' then v_row.last_places_threshold := v_int;
        when 'inactivity_months' then v_row.inactivity_months := v_int;
        when 'duplicate_payment_window_days' then v_row.duplicate_payment_window_days := v_int;
        when 'credit_expiring_days' then v_row.credit_expiring_days := v_int;
        when 'online_payment_window_minutes' then v_row.online_payment_window_minutes := v_int;
        when 'online_hold_grace_minutes' then v_row.online_hold_grace_minutes := v_int;
      end case;

    elsif v_key = 'public_online_purchase' then
      -- Online payments: the public session page's buy section (PR B).
      if jsonb_typeof(v_value) <> 'boolean' then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
      v_row.public_online_purchase := (v_value #>> '{}')::boolean;

    elsif v_key in (
      'registration_close_local_time', 'default_session_start_time',
      'default_session_end_time'
    ) then
      if (case
           when jsonb_typeof(v_value) <> 'string' then true
           when (v_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then true
           else v_key = 'registration_close_local_time'
             and (v_value #>> '{}')::time < time '03:00'
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      case v_key
        when 'registration_close_local_time' then
          v_row.registration_close_local_time := (v_value #>> '{}')::time;
        when 'default_session_start_time' then
          v_row.default_session_start_time := (v_value #>> '{}')::time;
        when 'default_session_end_time' then
          v_row.default_session_end_time := (v_value #>> '{}')::time;
      end case;

    elsif v_key = 'default_prep_days' then
      if (case
           when jsonb_typeof(v_value) <> 'array' then true
           when jsonb_array_length(v_value) not between 1 and 7 then true
           when exists (
             select 1 from jsonb_array_elements(v_value) e
             where case
               when jsonb_typeof(e) <> 'number' then true
               else (e #>> '{}')::numeric not in (-6, -5, -4, -3, -2, -1, 0)
             end
           ) then true
           else (select count(distinct (e #>> '{}')::numeric)
                 from jsonb_array_elements(v_value) e)
                <> jsonb_array_length(v_value)
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      select array_agg((e #>> '{}')::numeric::smallint order by (e #>> '{}')::numeric)
      into v_prep
      from jsonb_array_elements(v_value) e;
      v_row.default_prep_days := v_prep;

    elsif v_key = 'marketing_reminder_schedule' then
      -- Story 5.11: 0..7 slots, one per weekday at most, each exactly
      -- {"weekday": 0..6, "time": "HH:MM"}.
      if (case
           when jsonb_typeof(v_value) <> 'array' then true
           when jsonb_array_length(v_value) > 7 then true
           when exists (
             select 1 from jsonb_array_elements(v_value) e
             where case
               when jsonb_typeof(e) <> 'object' then true
               when (select array_agg(k order by k) from jsonb_object_keys(e) k)
                    is distinct from array['time', 'weekday'] then true
               when jsonb_typeof(e -> 'weekday') <> 'number' then true
               when (e ->> 'weekday')::numeric not in (0, 1, 2, 3, 4, 5, 6) then true
               when jsonb_typeof(e -> 'time') <> 'string' then true
               else (e ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             end
           ) then true
           else (select count(distinct (e ->> 'weekday')::numeric)
                 from jsonb_array_elements(v_value) e)
                <> jsonb_array_length(v_value)
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'weekday', (e ->> 'weekday')::numeric::integer,
            'time', e ->> 'time'
          )
          order by (e ->> 'weekday')::numeric
        ),
        '[]'::jsonb
      )
      into v_schedule
      from jsonb_array_elements(v_value) e;
      v_row.marketing_reminder_schedule := v_schedule;

    else
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;
  end loop;

  if v_row.default_session_end_time <= v_row.default_session_start_time then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"default_session_end_time"}';
  end if;

  if v_row is distinct from v_old then
    update public.business_settings s
    set default_validity_days = v_row.default_validity_days,
        registration_close_days_before = v_row.registration_close_days_before,
        registration_close_local_time = v_row.registration_close_local_time,
        default_capacity_regular = v_row.default_capacity_regular,
        default_capacity_couple = v_row.default_capacity_couple,
        cancel_window_hours = v_row.cancel_window_hours,
        credit_options_count = v_row.credit_options_count,
        reminder_lead_hours = v_row.reminder_lead_hours,
        admin_expiring_days = v_row.admin_expiring_days,
        customer_expiring_days = v_row.customer_expiring_days,
        last_places_threshold = v_row.last_places_threshold,
        default_prep_days = v_row.default_prep_days,
        marketing_reminder_schedule = v_row.marketing_reminder_schedule,
        inactivity_months = v_row.inactivity_months,
        duplicate_payment_window_days = v_row.duplicate_payment_window_days,
        credit_expiring_days = v_row.credit_expiring_days,
        default_session_start_time = v_row.default_session_start_time,
        default_session_end_time = v_row.default_session_end_time,
        online_payment_window_minutes = v_row.online_payment_window_minutes,
        online_hold_grace_minutes = v_row.online_hold_grace_minutes,
        public_online_purchase = v_row.public_online_purchase,
        version = s.version + 1,
        updated_at = now()
    where s.id = v_old.id
    returning s.* into v_row;

    -- Only the changed values (the version is in the row itself).
    perform private.audit(
      v_actor, 'admin', 'admin_update_business_settings', 'business_settings',
      null, null, null, to_jsonb(v_old) - v_strip, to_jsonb(v_row) - v_strip,
      null
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_business_settings', p_idempotency_key,
    to_jsonb(v_row) - 'id'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 15. Function grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function private.occupied_places(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.find_checkout(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.close_checkout(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.begin_checkout_core(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.job_release_holds() from public, anon, authenticated, service_role;
revoke execute on function private.job_intervals() from public, anon, authenticated, service_role;
revoke execute on function private.job_cleanup() from public, anon, authenticated, service_role;

revoke execute on function public.begin_checkout(uuid, uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_checkout(uuid, uuid, boolean, uuid) to authenticated;

revoke execute on function public.begin_guest_checkout(uuid, uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_guest_checkout(uuid, uuid, boolean, uuid) to service_role;

revoke execute on function public.checkout_for_confirm(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_for_confirm(uuid, text, text) to service_role;

revoke execute on function public.mark_checkout_notified(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_checkout_notified(uuid, text) to service_role;

revoke execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.record_online_payment(uuid, text, text, text, text, integer, timestamptz) to service_role;

revoke execute on function public.cancel_checkout(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_checkout(uuid, text) to service_role;

revoke execute on function public.checkout_return(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_return(uuid, text) to service_role;

revoke execute on function public.admin_resolve_online_payment_issue(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_resolve_online_payment_issue(uuid, uuid) to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

revoke execute on function public.admin_update_business_settings(jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_business_settings(jsonb, integer, uuid) to authenticated;

revoke execute on function public.rate_limit_hit(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Schedule (AD-11): every minute; the frequency is only the delay
-- ---------------------------------------------------------------------------

select cron.schedule('release_holds', '* * * * *', 'select private.job_release_holds()');
