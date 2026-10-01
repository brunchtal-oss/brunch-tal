-- Story 2.1: money schema and the payment approval core.
-- Tables: products, payment_methods, payments, entitlements,
-- entitlement_movements (append-only), business_settings, and the view
-- entitlement_balances. activation_tokens gains payment_id (join links).
-- Functions: private.plan_approve_payment, private.approve_payment_core
-- (final AD-10 signature) built from private.record_payment and
-- private.grant_from_payment, and the admin wrapper admin_approve_payment
-- with its preview (new customer only; story 2.5 adds p_customer_id).
-- AD-5 grants, AD-6 lock order, AD-7 plan/preview, AD-8 time in SQL,
-- AD-9 money in agorot, AD-10 tokens and core, AD-14 movements, AD-15
-- snapshots, AD-19 audit.
--
-- The Hebrew seed rows are data (Tal edits them in the admin), not code text.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

-- type: single | intro | card | couple. validity_mode 'session' = pinned to
-- the session Tal picks at approval (CAP-37, E3); 'days' = valid from the
-- purchase date for validity_days days. allowed_weekdays: 0 = Sunday, null =
-- every day. Editing a product never changes entitlements already granted.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  type text not null check (type in ('single', 'intro', 'card', 'couple')),
  price_agorot integer not null check (price_agorot >= 0),
  units integer not null check (units > 0),
  validity_mode text not null check (validity_mode in ('days', 'session')),
  validity_days integer check (validity_days > 0),
  allowed_weekdays smallint[]
    check (
      allowed_weekdays is null
      or (
        cardinality(allowed_weekdays) between 1 and 7
        and allowed_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
        and array_position(allowed_weekdays, null) is null
      )
    ),
  eligible_event_kind text not null check (eligible_event_kind in ('regular', 'couple')),
  party_size smallint not null check (party_size in (1, 2)),
  intro_only boolean not null default false,
  post_join_message text check (post_join_message is null or char_length(post_join_message) <= 1000),
  post_join_button_label text check (post_join_button_label is null or char_length(post_join_button_label) <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_validity_mode_days_check
    check ((validity_mode = 'days') = (validity_days is not null))
);

alter table public.products enable row level security;

insert into public.products (
  name, type, price_agorot, units, validity_mode, validity_days,
  allowed_weekdays, eligible_event_kind, party_size, intro_only,
  post_join_message, post_join_button_label
)
values
  ('בראנץ׳ רגיל', 'single', 12800, 1, 'session', null,
   null, 'regular', 1, false,
   'קבענו! תבואי רעבה ❤️', 'לפרטי הבראנץ׳ שלי'),
  ('בראנץ׳ היכרות', 'intro', 11800, 1, 'session', null,
   null, 'regular', 1, true,
   'קבענו! תבואי רעבה ❤️', 'לפרטי הבראנץ׳ שלי'),
  ('בראנץ׳ שישי מיוחד (זוגי)', 'couple', 25000, 1, 'session', null,
   null, 'couple', 2, false,
   'קבענו! תבואו רעבים ❤️', 'לפרטי הבראנץ׳ שלנו'),
  ('כרטיסייה אישית', 'card', 47200, 4, 'days', 49,
   array[1, 4]::smallint[], 'regular', 1, false,
   'אוכל טוב וחברה נעימה מחכים לך. כדאי לבחור כבר עכשיו את כל ארבעת התאריכים שנוחים לך ולהבטיח את מקומך.',
   'בואי נבחר תאריכים');

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------

-- "Selectable" is defined once, in private.payment_method_selectable. There is
-- no row for online payments.
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  sort_order integer not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.payment_methods enable row level security;

insert into public.payment_methods (name, sort_order)
values ('ביט', 1), ('פייבוקס', 2), ('העברה בנקאית', 3), ('מזומן', 4);

-- ---------------------------------------------------------------------------
-- payments (AD-10)
-- ---------------------------------------------------------------------------

-- customer_id stays null until the purchase is bound (private.bind_purchase,
-- story 2.2). product_snapshot = the product row at approval plus
-- payment_method_name; past payments are always shown from it. No
-- idempotency_key column (AD-5). status 'voided' is reserved.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id),
  product_id uuid not null references public.products (id) on delete restrict,
  source text not null check (source in ('manual', 'online')),
  provider text check (provider is null or char_length(btrim(provider)) between 1 and 100),
  provider_transaction_id text
    check (provider_transaction_id is null or char_length(btrim(provider_transaction_id)) between 1 and 200),
  recorded_by uuid,
  payment_method_id uuid references public.payment_methods (id) on delete restrict,
  amount_agorot integer not null check (amount_agorot >= 0),
  paid_on date not null,
  reference text check (reference is null or char_length(reference) <= 200),
  note text check (note is null or char_length(note) <= 2000),
  amount_override_reason text
    check (amount_override_reason is null or char_length(amount_override_reason) <= 2000),
  status text not null default 'approved' check (status in ('approved', 'voided')),
  product_snapshot jsonb not null check (jsonb_typeof(product_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint payments_manual_recorded_by_check
    check ((source = 'manual') = (recorded_by is not null)),
  constraint payments_manual_method_check
    check ((source = 'manual') = (payment_method_id is not null)),
  constraint payments_online_provider_check
    check ((source = 'online') = (provider is not null and provider_transaction_id is not null))
);

alter table public.payments enable row level security;

create unique index payments_provider_transaction_uidx
  on public.payments (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index payments_customer_id_idx on public.payments (customer_id);
create index payments_product_id_idx on public.payments (product_id);
create index payments_payment_method_id_idx on public.payments (payment_method_id);

-- ---------------------------------------------------------------------------
-- entitlements (AD-14)
-- ---------------------------------------------------------------------------

-- One entitlement per payment. "Expired" and "used up" are derived in
-- entitlement_balances, never stored. pinned_event_id has no FK until events
-- exist (E3). allowed_weekdays and eligible_event_kind start from the
-- snapshot and change only through a correction (CAP-9).
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id),
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  kind text not null check (kind in ('single', 'intro', 'card', 'couple')),
  original_units integer not null check (original_units > 0),
  valid_from date not null,
  expires_on date not null,
  pinned_event_id uuid,
  eligibility_snapshot jsonb not null
    check (
      jsonb_typeof(eligibility_snapshot) = 'object'
      and eligibility_snapshot ->> 'validity_mode' in ('days', 'session')
    ),
  allowed_weekdays smallint[]
    check (
      allowed_weekdays is null
      or (
        cardinality(allowed_weekdays) between 1 and 7
        and allowed_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
        and array_position(allowed_weekdays, null) is null
      )
    ),
  eligible_event_kind text not null check (eligible_event_kind in ('regular', 'couple')),
  status text not null default 'active' check (status in ('active', 'revoked', 'refunded')),
  created_at timestamptz not null default now(),
  constraint entitlements_expires_on_check check (expires_on >= valid_from),
  constraint entitlements_pinned_check
    check (((eligibility_snapshot ->> 'validity_mode') = 'session') = (pinned_event_id is not null))
);

alter table public.entitlements enable row level security;

create index entitlements_customer_id_idx on public.entitlements (customer_id);
create index entitlements_pinned_event_id_idx on public.entitlements (pinned_event_id);

-- ---------------------------------------------------------------------------
-- entitlement_movements (AD-14): append-only
-- ---------------------------------------------------------------------------

-- Fixed sign per action: grant, opening_balance, release > 0; reserve < 0;
-- use = 0 (marks a reservation as used); adjust <> 0. booking_id has no FK
-- until bookings exist (E3).
create table public.entitlement_movements (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.entitlements (id) on delete restrict,
  booking_id uuid,
  action text not null
    check (action in ('grant', 'opening_balance', 'reserve', 'use', 'release', 'adjust')),
  units integer not null,
  reason text check (reason is null or char_length(reason) <= 2000),
  actor_id uuid,
  reverses_id uuid references public.entitlement_movements (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint entitlement_movements_units_sign_check
    check (
      case action
        when 'grant' then units > 0
        when 'opening_balance' then units > 0
        when 'release' then units > 0
        when 'reserve' then units < 0
        when 'use' then units = 0
        when 'adjust' then units <> 0
      end
    ),
  constraint entitlement_movements_booking_check
    check (action not in ('reserve', 'use', 'release') or booking_id is not null)
);

alter table public.entitlement_movements enable row level security;

create index entitlement_movements_entitlement_id_idx on public.entitlement_movements (entitlement_id);
create index entitlement_movements_booking_id_idx on public.entitlement_movements (booking_id);
create index entitlement_movements_reverses_id_idx on public.entitlement_movements (reverses_id);

-- Raises on update, delete and truncate, for every role including the owner.
create function private.entitlement_movements_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'entitlement_movements is append-only' using errcode = 'P0001';
end;
$$;

create trigger entitlement_movements_no_update_delete
  before update or delete on public.entitlement_movements
  for each row execute function private.entitlement_movements_append_only();

create trigger entitlement_movements_no_truncate
  before truncate on public.entitlement_movements
  for each statement execute function private.entitlement_movements_append_only();

-- ---------------------------------------------------------------------------
-- business_settings (AD-15): exactly one row
-- ---------------------------------------------------------------------------

-- An RPC that creates an entity reads its defaults here inside the
-- transaction and stores them as a snapshot on the entity. Weekdays: 0 =
-- Sunday. registration_close_local_time is never between 00:00 and 03:00.
create table public.business_settings (
  id boolean primary key default true check (id),
  version integer not null default 1 check (version > 0),
  default_validity_days integer not null default 49 check (default_validity_days > 0),
  registration_close_days_before integer not null default 1
    check (registration_close_days_before >= 0),
  registration_close_local_time time not null default '20:00'
    check (registration_close_local_time >= '03:00'),
  default_capacity_regular integer not null default 12 check (default_capacity_regular > 0),
  default_capacity_couple integer not null default 14 check (default_capacity_couple > 0),
  cancel_window_hours integer not null default 48 check (cancel_window_hours >= 0),
  credit_options_count integer not null default 2 check (credit_options_count >= 0),
  reminder_lead_hours integer not null default 24 check (reminder_lead_hours >= 0),
  admin_expiring_days integer not null default 21 check (admin_expiring_days >= 0),
  customer_expiring_days integer not null default 10 check (customer_expiring_days >= 0),
  last_places_threshold integer not null default 4 check (last_places_threshold >= 0),
  default_prep_days smallint[] not null default array[-1, 0]::smallint[]
    check (array_position(default_prep_days, null) is null),
  marketing_reminder_schedule jsonb not null default '[
    {"weekday": 0, "time": "09:00"},
    {"weekday": 1, "time": "20:00"},
    {"weekday": 2, "time": "09:00"},
    {"weekday": 3, "time": "09:00"},
    {"weekday": 4, "time": "20:00"}
  ]'::jsonb check (jsonb_typeof(marketing_reminder_schedule) = 'array'),
  inactivity_months integer not null default 3 check (inactivity_months > 0),
  updated_at timestamptz not null default now()
);

alter table public.business_settings enable row level security;

insert into public.business_settings default values;

-- ---------------------------------------------------------------------------
-- activation_tokens: join links point at their payment (AD-10)
-- ---------------------------------------------------------------------------

alter table public.activation_tokens
  add column payment_id uuid references public.payments (id) on delete restrict;

alter table public.activation_tokens
  add constraint activation_tokens_join_payment_check
    check ((purpose = 'join') = (payment_id is not null));

-- At most one join link per payment that is not revoked.
create unique index activation_tokens_live_join_uidx
  on public.activation_tokens (payment_id)
  where purpose = 'join' and state <> 'revoked';
create index activation_tokens_payment_id_idx on public.activation_tokens (payment_id);

-- New signature (drop, then create): p_payment_id for join links. Callers
-- with two arguments (issue_reset_token) keep working through the default.
drop function private.issue_token(text, uuid);

create function private.issue_token(
  p_purpose text,
  p_bound_user_id uuid,
  p_payment_id uuid default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_raw text;
  v_id uuid;
  v_expires_at timestamptz := now() + interval '48 hours';
begin
  if p_purpose is null or p_purpose not in ('join', 'claim', 'reset') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if (p_purpose = 'join') <> (p_payment_id is not null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  insert into public.activation_tokens (purpose, token_hash, expires_at, bound_user_id, payment_id)
  values (p_purpose, private.token_hash(v_raw), v_expires_at, p_bound_user_id, p_payment_id)
  returning id into v_id;

  return jsonb_build_object('token_id', v_id, 'token', v_raw, 'expires_at', v_expires_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- entitlement_balances (AD-14): the only balance formula
-- ---------------------------------------------------------------------------

-- available = sum of units. Per booking, net = -(reserve + release);
-- reserved sums it for bookings without a 'use', used for bookings with one.
-- security_invoker: the caller's RLS on entitlements and movements applies.
create view public.entitlement_balances
with (security_invoker = true)
as
select
  e.id as entitlement_id,
  e.customer_id,
  e.payment_id,
  e.kind,
  e.status,
  e.original_units,
  e.valid_from,
  e.expires_on,
  coalesce(a.available, 0)::integer as available,
  coalesce(r.reserved, 0)::integer as reserved,
  coalesce(r.used, 0)::integer as used,
  private.local_day_end(e.expires_on) as expires_at,
  now() >= private.local_day_end(e.expires_on) as is_expired
from public.entitlements e
left join lateral (
  select sum(m.units) as available
  from public.entitlement_movements m
  where m.entitlement_id = e.id
) a on true
left join lateral (
  select
    sum(-b.net) filter (where not b.has_use) as reserved,
    sum(-b.net) filter (where b.has_use) as used
  from (
    select
      m.booking_id,
      coalesce(sum(m.units) filter (where m.action in ('reserve', 'release')), 0) as net,
      bool_or(m.action = 'use') as has_use
    from public.entitlement_movements m
    where m.entitlement_id = e.id
      and m.booking_id is not null
    group by m.booking_id
  ) b
) r on true;

-- ---------------------------------------------------------------------------
-- Policies and table grants (AD-5): authenticated reads only, no writes
-- ---------------------------------------------------------------------------

create policy products_authenticated_select on public.products
  for select to authenticated
  using (true);

create policy payment_methods_admin_select on public.payment_methods
  for select to authenticated
  using ((select private.is_admin()));

create policy payments_authenticated_select on public.payments
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

create policy entitlements_authenticated_select on public.entitlements
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

create policy entitlement_movements_authenticated_select on public.entitlement_movements
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.entitlements e
      where e.id = entitlement_movements.entitlement_id
        and e.customer_id = (select private.current_customer_id())
    )
  );

create policy business_settings_admin_select on public.business_settings
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.products from public, anon, authenticated, service_role;
grant select on table public.products to authenticated;

revoke all on table public.payment_methods from public, anon, authenticated, service_role;
grant select on table public.payment_methods to authenticated;

revoke all on table public.payments from public, anon, authenticated, service_role;
grant select on table public.payments to authenticated;

revoke all on table public.entitlements from public, anon, authenticated, service_role;
grant select on table public.entitlements to authenticated;

revoke all on table public.entitlement_movements from public, anon, authenticated, service_role;
grant select on table public.entitlement_movements to authenticated;

revoke all on table public.business_settings from public, anon, authenticated, service_role;
grant select on table public.business_settings to authenticated;

revoke all on table public.entitlement_balances from public, anon, authenticated, service_role;
grant select on table public.entitlement_balances to authenticated;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The only definition of "selectable": exists and not hidden.
create function private.payment_method_selectable(p_payment_method_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.payment_methods pm
    where pm.id = p_payment_method_id
      and not pm.hidden
  );
$$;

-- One plan for the preview and the approval (AD-7). Checks, in order:
-- product missing or inactive; pinned product (until E3); a session for a
-- days product; purchase date missing or after the local today, amount
-- missing or negative. Expiry is computed only here (AD-8).
create function private.plan_approve_payment(
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_paid_on date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_product public.products;
  v_expires_on date;
begin
  select p.* into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null or not v_product.active then
    raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Pinned products arrive in E3; PINNED_EVENT_REQUIRED is checked then.
  if v_product.validity_mode = 'session' then
    raise exception 'PINNED_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if p_event_id is not null then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if p_paid_on is null
     or p_paid_on > (now() at time zone 'Asia/Jerusalem')::date
     or p_amount_agorot is null
     or p_amount_agorot < 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_expires_on := p_paid_on + v_product.validity_days;

  return jsonb_build_object(
    'product_id', v_product.id,
    'product_name', v_product.name,
    'kind', v_product.type,
    'units', v_product.units,
    'event_id', null,
    'valid_from', p_paid_on,
    'expires_on', v_expires_on,
    'expires_at', private.local_day_end(v_expires_on),
    'price_agorot', v_product.price_agorot,
    'amount_agorot', p_amount_agorot,
    'price_changed', p_amount_agorot <> v_product.price_agorot
  );
end;
$$;

-- Inserts the payment row. The only writer of public.payments; called only
-- from private.approve_payment_core.
create function private.record_payment(
  p_source text,
  p_actor_id uuid,
  p_customer_id uuid,
  p_product public.products,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_payment_method_name text,
  p_reference text,
  p_note text,
  p_provider text,
  p_provider_transaction_id text
)
returns public.payments
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  insert into public.payments (
    customer_id, product_id, source, provider, provider_transaction_id,
    recorded_by, payment_method_id, amount_agorot, paid_on, reference, note,
    amount_override_reason, status, product_snapshot
  )
  values (
    p_customer_id,
    p_product.id,
    p_source,
    p_provider,
    p_provider_transaction_id,
    case when p_source = 'manual' then p_actor_id end,
    p_payment_method_id,
    p_amount_agorot,
    p_paid_on,
    nullif(btrim(p_reference), ''),
    nullif(btrim(p_note), ''),
    p_amount_override_reason,
    'approved',
    to_jsonb(p_product) || jsonb_build_object('payment_method_name', p_payment_method_name)
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

-- Creates the entitlement of a payment and its single 'grant' movement.
-- Called only from private.approve_payment_core.
create function private.grant_from_payment(
  p_payment public.payments,
  p_product public.products,
  p_plan jsonb,
  p_actor_id uuid
)
returns public.entitlements
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
begin
  insert into public.entitlements (
    customer_id, payment_id, kind, original_units, valid_from, expires_on,
    pinned_event_id, eligibility_snapshot, allowed_weekdays,
    eligible_event_kind, status
  )
  values (
    p_payment.customer_id,
    p_payment.id,
    p_product.type,
    p_product.units,
    (p_plan ->> 'valid_from')::date,
    (p_plan ->> 'expires_on')::date,
    null,
    jsonb_build_object(
      'product_id', p_product.id,
      'type', p_product.type,
      'units', p_product.units,
      'validity_mode', p_product.validity_mode,
      'validity_days', p_product.validity_days,
      'allowed_weekdays', p_product.allowed_weekdays,
      'eligible_event_kind', p_product.eligible_event_kind,
      'party_size', p_product.party_size,
      'intro_only', p_product.intro_only
    ),
    p_product.allowed_weekdays,
    p_product.eligible_event_kind,
    'active'
  )
  returning * into v_entitlement;

  insert into public.entitlement_movements (entitlement_id, action, units, actor_id)
  values (v_entitlement.id, 'grant', p_product.units, p_actor_id);

  return v_entitlement;
end;
$$;

-- The single approval core (AD-10), final signature. Does not check the
-- caller and never reads auth.uid(): the actor is a parameter. Creates the
-- payment and its entitlement, audits both, returns payment_id. Never issues
-- a token. Pinned products (place_pinned_booking, 'park') arrive in E3.
-- Locks the product and the payment method FOR SHARE before planning, so the
-- plan and the snapshot read the same row versions.
create function private.approve_payment_core(
  p_source text,
  p_actor_id uuid,
  p_actor_kind text,
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
  p_provider text,
  p_provider_transaction_id text,
  p_on_seat_failure text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_product public.products;
  v_method_name text;
  v_plan jsonb;
  v_payment public.payments;
  v_entitlement public.entitlements;
  v_reason text;
begin
  if p_source is null or p_source not in ('manual', 'online')
     or p_actor_kind is null or p_actor_kind not in ('admin', 'customer', 'system')
     or p_on_seat_failure is null or p_on_seat_failure not in ('raise', 'park')
     or (p_source = 'manual' and p_actor_id is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_product
  from public.products p
  where p.id = p_product_id
  for share;

  if p_payment_method_id is not null then
    select pm.name into v_method_name
    from public.payment_methods pm
    where pm.id = p_payment_method_id
    for share;
  end if;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if p_source = 'manual' and not private.payment_method_selectable(p_payment_method_id) then
    raise exception 'PAYMENT_METHOD_NOT_SELECTABLE' using errcode = 'P0001';
  end if;

  if p_source = 'online' and p_payment_method_id is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The override reason is kept only when the amount differs from the price.
  v_reason := case
    when (v_plan ->> 'price_changed')::boolean then nullif(btrim(p_amount_override_reason), '')
  end;

  v_payment := private.record_payment(
    p_source, p_actor_id, p_customer_id, v_product, p_amount_agorot, v_reason,
    p_paid_on, p_payment_method_id, v_method_name, p_reference, p_note,
    p_provider, p_provider_transaction_id
  );

  perform private.audit(
    p_actor_id, p_actor_kind, 'approve_payment', 'payments', v_payment.id,
    p_customer_id, p_event_id, null, to_jsonb(v_payment), v_reason
  );

  v_entitlement := private.grant_from_payment(v_payment, v_product, v_plan, p_actor_id);

  perform private.audit(
    p_actor_id, p_actor_kind, 'approve_payment', 'entitlements', v_entitlement.id,
    p_customer_id, p_event_id, null, to_jsonb(v_entitlement)
  );

  return v_payment.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Tal approves a payment for a new customer (CAP-2): payment, entitlement and
-- a join link in one transaction. The raw token is returned once; a repeat
-- with the same key returns the stored result without it
-- (reissue_required: true). Story 2.5 adds p_customer_id (drop, then create).
create function public.admin_approve_payment(
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
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
  v_plan jsonb;
  v_payment_id uuid;
  v_entitlement public.entitlements;
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
      'product_id', p_product_id,
      'event_id', p_event_id,
      'amount_agorot', p_amount_agorot,
      'amount_override_reason', p_amount_override_reason,
      'paid_on', p_paid_on,
      'payment_method_id', p_payment_method_id,
      'reference', p_reference,
      'note', p_note,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if (v_plan ->> 'price_changed')::boolean and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_payment_id := private.approve_payment_core(
    'manual', v_actor, 'admin', null, p_product_id, p_event_id,
    p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id,
    p_reference, p_note, null, null, 'raise'
  );

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

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
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'expires_on', v_entitlement.expires_on,
      'reissue_required', true
    )
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

-- What the approval will create (entitlement, units, expiry, price_changed),
-- shown before Tal confirms. Same permission and grant as the action (AD-7).
create function public.preview_admin_approve_payment(
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_paid_on date
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

  return private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): revoke from every role, then at most one grant.
-- ---------------------------------------------------------------------------

-- entitlement_balances (security_invoker) calls local_day_end as the caller.
grant execute on function private.local_day_end(date) to authenticated;

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.entitlement_movements_append_only() from public, anon, authenticated, service_role;
revoke execute on function private.issue_token(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.payment_method_selectable(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_approve_payment(uuid, uuid, integer, date) from public, anon, authenticated, service_role;
revoke execute on function private.record_payment(text, uuid, uuid, public.products, integer, text, date, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.grant_from_payment(public.payments, public.products, jsonb, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.approve_payment_core(text, uuid, text, uuid, uuid, uuid, integer, text, date, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.admin_approve_payment(uuid, uuid, integer, text, date, uuid, text, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, uuid, integer, text, date, uuid, text, text, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_approve_payment(uuid, uuid, integer, date) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_approve_payment(uuid, uuid, integer, date) to authenticated;
