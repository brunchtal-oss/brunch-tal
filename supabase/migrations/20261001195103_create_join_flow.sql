-- Story 2.2: the join tracer (AD-10, AD-21).
-- profiles gains the customer columns (phone, dietary notes, consents) and a
-- column-level self-update; babies; the content tables (content_pages,
-- content_sections) with the seed the join form and the business details
-- need; token_view fills the product of a join link; join_begin and
-- join_complete (service role) around the Auth Admin call in
-- lib/server/privileged/join.ts; private.bind_purchase, the only binder of a
-- purchase to a customer.
-- AD-5 grants and idempotency, AD-6 lock order (activation_tokens, profiles,
-- entitlements, payments, notification_jobs), AD-8 local dates, AD-9 phone,
-- AD-16 content, AD-19 audit.
--
-- The Hebrew seed rows are content (Tal edits them in the content editor,
-- E5), not code text.

-- ---------------------------------------------------------------------------
-- profiles: customer columns
-- ---------------------------------------------------------------------------

-- phone_e164 comes only from private.normalize_phone. dietary_notes: null =
-- not shown anywhere, never an empty string. The consent versions are the
-- published_version of the content page at the time of consent (0 until a
-- real wording is published; 6.9 checks it before launch).
alter table public.profiles
  add column phone_e164 text
    constraint profiles_phone_e164_key unique
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column dietary_notes text
    check (dietary_notes is null or (btrim(dietary_notes) <> '' and char_length(dietary_notes) <= 2000)),
  add column privacy_consent_at timestamptz,
  add column privacy_policy_version integer check (privacy_policy_version >= 0),
  add column photo_consent boolean not null default false,
  add column photo_consent_at timestamptz,
  add column photo_consent_text_version integer check (photo_consent_text_version >= 0);

-- Self-update of the customer's own name and dietary notes only (AD-1, AD-5).
-- Phone, email and consents change only through RPCs (2.8, 2.10).
create policy profiles_authenticated_update on public.profiles
  for update to authenticated
  using (id = (select private.current_customer_id()))
  with check (id = (select private.current_customer_id()));

grant update (full_name, dietary_notes) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- babies
-- ---------------------------------------------------------------------------

-- The customer manages her own babies (2.10); the age is computed for display
-- only. The whole row is masked in the audit log (private.audit_diff).
create table public.babies (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  birth_date date not null,
  created_at timestamptz not null default now()
);

alter table public.babies enable row level security;

create index babies_customer_id_idx on public.babies (customer_id);

create policy babies_authenticated_select on public.babies
  for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

create policy babies_authenticated_insert on public.babies
  for insert to authenticated
  with check (customer_id = (select private.current_customer_id()));

create policy babies_authenticated_update on public.babies
  for update to authenticated
  using (customer_id = (select private.current_customer_id()))
  with check (customer_id = (select private.current_customer_id()));

create policy babies_authenticated_delete on public.babies
  for delete to authenticated
  using (customer_id = (select private.current_customer_id()));

revoke all on table public.babies from public, anon, authenticated, service_role;
grant select, delete on table public.babies to authenticated;
grant insert (customer_id, name, birth_date) on table public.babies to authenticated;
grant update (name, birth_date) on table public.babies to authenticated;

-- ---------------------------------------------------------------------------
-- Content (AD-16): pages and sections, draft and published
-- ---------------------------------------------------------------------------

-- published_version goes up on every publish (admin_publish_content, E5);
-- a consent stores it. A page or section without published_content is not
-- visible to anon or authenticated, and the draft columns never are.
create table public.content_pages (
  slug text primary key
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  draft_content jsonb check (draft_content is null or jsonb_typeof(draft_content) = 'object'),
  published_content jsonb
    check (published_content is null or jsonb_typeof(published_content) = 'object'),
  published_at timestamptz,
  published_version integer not null default 0 check (published_version >= 0),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_pages_published_check
    check ((published_content is null) = (published_at is null))
);

alter table public.content_pages enable row level security;

-- A block inside a page (hero, faq, business_details, photo_consent, ...).
-- Repeated items (steps, questions) live inside the block as an ordered list.
-- Each kind has one zod schema in lib/content/schema.ts.
create table public.content_sections (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null references public.content_pages (slug) on delete restrict,
  key text not null check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(key) <= 100),
  kind text not null check (kind ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(kind) <= 100),
  sort_order integer not null default 0,
  hidden boolean not null default false,
  draft_content jsonb,
  published_content jsonb,
  published_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_sections_page_key_key unique (page_slug, key),
  constraint content_sections_published_check
    check ((published_content is null) = (published_at is null))
);

alter table public.content_sections enable row level security;

create policy content_pages_public_select on public.content_pages
  for select to anon, authenticated
  using (published_content is not null);

create policy content_sections_public_select on public.content_sections
  for select to anon, authenticated
  using (published_content is not null and not hidden);

-- Published columns only; the editor (E5) reads drafts through admin RPCs.
revoke all on table public.content_pages from public, anon, authenticated, service_role;
grant select (slug, published_content, published_at, published_version)
  on table public.content_pages to anon, authenticated;

revoke all on table public.content_sections from public, anon, authenticated, service_role;
grant select (id, page_slug, key, kind, sort_order, published_content, published_at)
  on table public.content_sections to anon, authenticated;

-- Seed, version 0 (allowed only while the site is locked; 6.9 checks that a
-- real version was published). privacy: not published yet. join-form: the
-- photo consent question and its two answers (the approved wording).
-- contact: the business details.
insert into public.content_pages (slug, published_content, published_at, published_version)
values
  ('privacy', null, null, 0),
  ('join-form', '{}'::jsonb, now(), 0),
  ('contact', '{}'::jsonb, now(), 0);

insert into public.content_sections (
  page_slug, key, kind, sort_order, draft_content, published_content, published_at
)
select s.page_slug, s.key, s.kind, 1, s.content, s.content, now()
from (
  values
    ('join-form', 'photo_consent', 'photo_consent',
     jsonb_build_object(
       'question',
       E'במפגשים אני מצלמת תמונות כדי שיהיה למשתתפות הבראנץ׳ מזכרת מתוקה עם הקטנטנים.\n'
       || E'לפעמים אשמח לשתף רגעים מהמפגשים גם באתר וברשתות החברתיות.\n'
       || 'האם את מסכימה שאפרסם תמונות שלכם?',
       'yes_label', 'כן, בשמחה',
       'no_label', 'מעדיפה שהתמונות שלנו ישארו פרטיות'
     )),
    ('contact', 'business_details', 'business_details',
     jsonb_build_object('whatsapp_phone', '0544256456'))
) as s (page_slug, key, kind, content);

-- ---------------------------------------------------------------------------
-- token_view: the product of a join link
-- ---------------------------------------------------------------------------

-- Same states as before (claiming is active). For an active join link the
-- product name comes from the payment's product_snapshot and the amount is
-- what was paid.
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
    else 'active'
  end;

  if v_state = 'active' and v_token.purpose = 'join' then
    select pay.product_snapshot ->> 'name', pay.amount_agorot
    into v_product_name, v_amount_agorot
    from public.payments pay
    where pay.id = v_token.payment_id;
  end if;

  return jsonb_build_object(
    'state_public', v_state,
    'purpose', v_token.purpose,
    'product_name', v_product_name,
    'amount_agorot', v_amount_agorot,
    'expires_on', case
      when v_state = 'active' then (v_token.expires_at at time zone 'Asia/Jerusalem')::date
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The join identity: email lower(trim()), phone through
-- private.normalize_phone (AD-9), and input_hash = sha256(email|phone).
-- Invalid input raises INVALID_INPUT with detail.field (email | phone).
create function private.join_identity(p_email text, p_phone text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_phone text := private.normalize_phone(p_phone);
begin
  if v_email is null
     or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "email"}';
  end if;

  if v_phone is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "phone"}';
  end if;

  return jsonb_build_object(
    'email', v_email,
    'phone', v_phone,
    'input_hash', encode(extensions.digest(v_email || '|' || v_phone, 'sha256'), 'hex')
  );
end;
$$;

-- The only binder of a purchase to a customer (AD-10), called from
-- join_complete (and later claim_join, claim_complete and the online flow).
-- Locks the customer's profile (her mutex), then the entitlement and the
-- payment (AD-6), re-checks the invariants that could not be checked while
-- customer_id was empty, and on a violation binds nothing and raises
-- BIND_CONFLICT. Otherwise fills customer_id on every row derived from the
-- payment and enqueues the notifications skipped while there was no customer.
-- E3 adds the checks for bookings, waitlist, intro and has_participated, and
-- binds bookings, cancellation_credits and refund_requests.
create function private.bind_purchase(p_payment_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_payment public.payments;
  v_payment_new public.payments;
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

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = p_payment_id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  if v_payment.id is null or v_entitlement.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_payment.customer_id is not null or v_entitlement.customer_id is not null then
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
  set customer_id = p_customer_id
  where id = v_entitlement.id
  returning * into v_entitlement_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'entitlements', v_entitlement.id,
    p_customer_id, v_entitlement.pinned_event_id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
  );

  -- Skipped at approval because there was no customer (AD-23).
  if v_entitlement.kind = 'card' then
    perform private.enqueue_notification(
      p_customer_id, 'purchase_new_card', p_payment_id::text, '{}'::jsonb, '/me'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Step 1 of the join (AD-10, AD-21), service role, scope token:<id>.
-- Results: {outcome: claiming, token_id, pending_user_id} (create or update
-- that Auth user next), {outcome: conflict, token_id} (Tal handles it), or,
-- for a link this same key already completed, the stored join_complete
-- result {outcome: joined, ...}. A pending link whose email is in auth.users
-- or whose phone is in profiles goes to conflict (identity_match; 2.3 splits
-- the existing-account case). claiming with the same input returns the same
-- pending_user_id, also after the link's expiry; with other input,
-- LINK_IN_USE. Closed states first: not a join link, revoked, or pending and
-- expired is LINK_EXPIRED; consumed is LINK_USED.
create function public.join_begin(
  p_token text,
  p_email text,
  p_phone text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_hash text;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Unlocked read: builds the scope and answers the closed states. The raw
  -- token never reaches the stored request hash.
  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;

  if v_token.state = 'consumed' then
    -- Completed by this key, only the response was lost: no Auth change.
    select r.result into v_prev
    from private.idempotency_results r
    where r.actor_scope = v_scope
      and r.rpc = 'join_complete'
      and r.key = p_idempotency_key
      and r.result is not null;
    if v_prev is not null then
      return v_prev;
    end if;
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state = 'pending' and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return jsonb_build_object('outcome', 'conflict', 'token_id', v_token.id);
  end if;

  v_identity := private.join_identity(p_email, p_phone);
  v_hash := v_identity ->> 'input_hash';

  -- awaiting_login (2.3) or claiming with other input.
  if v_token.state <> 'pending' and v_token.input_hash is distinct from v_hash then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_scope, 'join_begin', p_idempotency_key,
    jsonb_build_object('input_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens first; re-check after the lock.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state = 'pending' and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    v_result := jsonb_build_object('outcome', 'conflict', 'token_id', v_token.id);
  elsif v_token.state = 'claiming' and v_token.input_hash = v_hash then
    v_result := jsonb_build_object(
      'outcome', 'claiming',
      'token_id', v_token.id,
      'pending_user_id', v_token.pending_user_id
    );
  elsif v_token.state <> 'pending' then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  elsif exists (
    select 1 from auth.users u where lower(u.email) = v_identity ->> 'email'
  ) or exists (
    select 1 from public.profiles p where p.phone_e164 = v_identity ->> 'phone'
  ) then
    update public.activation_tokens
    set state = 'conflict', conflict_reason = 'identity_match'
    where id = v_token.id
    returning * into v_new;

    perform private.audit(
      null, 'system', 'join_begin', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );

    v_result := jsonb_build_object('outcome', 'conflict', 'token_id', v_token.id);
  else
    update public.activation_tokens
    set state = 'claiming', pending_user_id = gen_random_uuid(), input_hash = v_hash
    where id = v_token.id
    returning * into v_new;

    perform private.audit(
      null, 'system', 'join_begin', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );

    v_result := jsonb_build_object(
      'outcome', 'claiming',
      'token_id', v_new.id,
      'pending_user_id', v_new.pending_user_id
    );
  end if;

  return private.idempotent_finish(v_scope, 'join_begin', p_idempotency_key, v_result);
end;
$$;

-- Step 3 of the join (AD-10, AD-21), after the Auth user pending_user_id
-- exists with the password. One transaction: the activated profile with both
-- consent versions, the babies, private.bind_purchase (which enqueues the
-- purchase notification), the consumed link and the audit. Idempotent per
-- (token, key); the request is '{}' so the raw token and the personal data
-- never reach the stored hash. A phone taken in the meantime (23505) or
-- BIND_CONFLICT rolls back everything of this customer and moves the link to
-- conflict ({outcome: conflict}).
-- p_profile: {email, phone, full_name, dietary_notes, privacy_consent,
-- photo_consent, babies: [{name, birth_date}]}.
-- Returns {outcome: joined, token_id, customer_id, payment_id}.
create function public.join_complete(
  p_token text,
  p_profile jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_full_name text;
  v_dietary_notes text;
  v_babies jsonb;
  v_item record;
  v_name text;
  v_birth_text text;
  v_birth date;
  v_names text[] := '{}';
  v_births date[] := '{}';
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_privacy_version integer;
  v_photo_version integer;
  v_profile public.profiles;
  v_baby public.babies;
  v_conflict_reason text;
  v_constraint text;
  i integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;
  v_prev := private.idempotent_begin(v_scope, 'join_complete', p_idempotency_key, '{}'::jsonb);
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens, then profiles, entitlements,
  -- payments and notification_jobs inside private.bind_purchase.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object('outcome', 'conflict', 'token_id', v_token.id)
    );
  end if;

  -- A claiming link may finish after its expiry (AD-10).
  if v_token.state <> 'claiming' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_identity := private.join_identity(p_profile ->> 'email', p_profile ->> 'phone');

  if v_identity ->> 'input_hash' is distinct from v_token.input_hash then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  -- The Auth user of step 2 exists, with the email of this input.
  if not exists (
    select 1
    from auth.users u
    where u.id = v_token.pending_user_id
      and lower(u.email) = v_identity ->> 'email'
  ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_full_name := btrim(p_profile ->> 'full_name');
  if v_full_name is null or char_length(v_full_name) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "full_name"}';
  end if;

  if (p_profile -> 'privacy_consent') is distinct from 'true'::jsonb then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- "Private" is a full answer; only a missing answer is refused.
  if jsonb_typeof(p_profile -> 'photo_consent') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "photo_consent"}';
  end if;

  if coalesce(jsonb_typeof(p_profile -> 'dietary_notes'), 'null') not in ('string', 'null') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;
  v_dietary_notes := nullif(btrim(p_profile ->> 'dietary_notes'), '');
  if char_length(v_dietary_notes) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;

  -- At least one baby (user decision 2026-10-01), at most 10 per form.
  v_babies := p_profile -> 'babies';
  if jsonb_typeof(v_babies) is distinct from 'array'
     or jsonb_array_length(v_babies) not between 1 and 10 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
  end if;

  for v_item in
    select b.value as item, (b.ordinality - 1)::integer as idx
    from jsonb_array_elements(v_babies) with ordinality as b (value, ordinality)
  loop
    if jsonb_typeof(v_item.item) <> 'object' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
    end if;

    v_name := btrim(v_item.item ->> 'name');
    if v_name is null or char_length(v_name) not between 1 and 100 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'baby_name', 'index', v_item.idx)::text;
    end if;

    v_birth_text := v_item.item ->> 'birth_date';
    v_birth := null;
    if v_birth_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_birth := v_birth_text::date;
      exception when others then
        v_birth := null;
      end;
    end if;

    -- Not after the local today (AD-8).
    if v_birth is null or v_birth > v_today then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'birth_date', 'index', v_item.idx)::text;
    end if;

    v_names := v_names || v_name;
    v_births := v_births || v_birth;
  end loop;

  -- The published versions at the time of consent (0 = the seed).
  select cp.published_version into v_privacy_version
  from public.content_pages cp
  where cp.slug = 'privacy';

  select cp.published_version into v_photo_version
  from public.content_pages cp
  where cp.slug = 'join-form';

  if v_privacy_version is null or v_photo_version is null then
    raise exception 'join_complete: content pages missing' using errcode = 'XX000';
  end if;

  -- Everything of the customer in one sub-block: a phone taken since
  -- join_begin or BIND_CONFLICT undoes it all and the link goes to conflict.
  begin
    insert into public.profiles (
      id, full_name, phone_e164, dietary_notes, activated_at,
      privacy_consent_at, privacy_policy_version,
      photo_consent, photo_consent_at, photo_consent_text_version
    )
    values (
      v_token.pending_user_id, v_full_name, v_identity ->> 'phone', v_dietary_notes, now(),
      now(), v_privacy_version,
      (p_profile ->> 'photo_consent')::boolean, now(), v_photo_version
    )
    returning * into v_profile;

    perform private.audit(
      v_profile.id, 'customer', 'join_complete', 'profiles', v_profile.id,
      v_profile.id, null, null, to_jsonb(v_profile)
    );

    for i in 1 .. cardinality(v_names) loop
      insert into public.babies (customer_id, name, birth_date)
      values (v_profile.id, v_names[i], v_births[i])
      returning * into v_baby;

      perform private.audit(
        v_profile.id, 'customer', 'join_complete', 'babies', v_baby.id,
        v_profile.id, null, null, to_jsonb(v_baby)
      );
    end loop;

    perform private.bind_purchase(v_token.payment_id, v_profile.id);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'profiles_phone_e164_key' then
        raise;
      end if;
      v_conflict_reason := 'phone_taken';
    when raise_exception then
      if sqlerrm <> 'BIND_CONFLICT' then
        raise;
      end if;
      v_conflict_reason := 'bind_conflict';
  end;

  if v_conflict_reason is not null then
    update public.activation_tokens
    set state = 'conflict', conflict_reason = v_conflict_reason
    where id = v_token.id
    returning * into v_new;

    perform private.audit(
      null, 'system', 'join_complete', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );

    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object('outcome', 'conflict', 'token_id', v_token.id)
    );
  end if;

  update public.activation_tokens
  set state = 'consumed', consumed_at = now(), customer_id = v_profile.id
  where id = v_token.id
  returning * into v_new;

  perform private.audit(
    v_profile.id, 'customer', 'join_complete', 'activation_tokens', v_token.id,
    v_profile.id, null, to_jsonb(v_token), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_scope, 'join_complete', p_idempotency_key,
    jsonb_build_object(
      'outcome', 'joined',
      'token_id', v_token.id,
      'customer_id', v_profile.id,
      'payment_id', v_token.payment_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): revoke from every role, then at most one grant.
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.join_identity(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;

revoke execute on function public.join_begin(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_begin(text, text, text, uuid) to service_role;

revoke execute on function public.join_complete(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_complete(text, jsonb, uuid) to service_role;
