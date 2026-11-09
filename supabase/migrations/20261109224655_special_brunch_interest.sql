-- Story 2.16: the special-brunch interest question (user decisions
-- 2026-11-03 and 2026-11-09, SPEC memlog).
--
-- 1. profiles.special_brunch_interests text[] not null default '{}': fixed
--    codes couples, grandma (סבתוש), grandpa (סבוש), each at most once.
--    Existing customers get {} (= not answered). The customer updates it
--    herself next to full_name and dietary_notes (column grant, AD-1).
-- 2. The content block join-form › special_brunch (question, a title and an
--    optional hint per option), seeded published. No version bump (not a
--    consent).
-- 3. join_complete (create or replace, same signature): optional key
--    special_brunch_interests in p_profile, stored in code order.
-- 4. admin_get_customer returns it; admin_anonymize_customer clears it.
-- 5. admin_list_customers / admin_export_customers get a last parameter
--    p_interest (no default). They are new functions next to the old
--    overloads; p_interest has no default and the code always sends it, so
--    the overloads do not clash in PostgREST. The old ones are dropped in
--    20261109224659_special_brunch_interest_drop_old.sql (SQL Editor).
--
-- Every create or replace is based on the live definition
-- (pg_get_functiondef, after 2.15's migrations), which is the text of
-- 20261022154256_refactor_sweep_db.sql (join_complete, admin_get_customer,
-- admin_anonymize_customer) and 20261020112623_inactive_customers_browse.sql
-- (the list and the export). No drop here.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column special_brunch_interests text[] not null default '{}'
    constraint profiles_special_brunch_interests_check check (
      special_brunch_interests <@ array['couples', 'grandma', 'grandpa']::text[]
      and coalesce(cardinality(array_positions(special_brunch_interests, 'couples')), 0) <= 1
      and coalesce(cardinality(array_positions(special_brunch_interests, 'grandma')), 0) <= 1
      and coalesce(cardinality(array_positions(special_brunch_interests, 'grandpa')), 0) <= 1
    );

comment on column public.profiles.special_brunch_interests is
  'Story 2.16: the special brunches the customer wants to hear about (couples, grandma, grandpa); {} = none or not answered. Labels are the content block join-form › special_brunch.';

-- Self-update (AD-1, AD-5), next to full_name and dietary_notes.
grant update (special_brunch_interests) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The content block (published; the trigger content_sections_public_copy
--    derives published_content from published_content_full)
-- ---------------------------------------------------------------------------

insert into public.content_sections (
  page_slug, key, kind, sort_order, draft_content, published_content_full, published_at
)
select 'join-form', 'special_brunch', 'special_brunch', 2, s.content, s.content, now()
from (
  select '{"question":"תרצי שאעדכן אותך על בראנצ׳ים מיוחדים?","couples_title":"בראנץ׳ זוגות","couples_hint":"את מגיעה עם הבייבי ועם בן או בת הזוג","grandma_title":"בראנץ׳ עם סבתוש","grandma_hint":"את מגיעה עם הבייבי ועם סבתא","grandpa_title":"בראנץ׳ עם סבוש","grandpa_hint":"את מגיעה עם הבייבי ועם סבא"}'::jsonb as content
) as s
on conflict (page_slug, key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. join_complete
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_complete(p_token text, p_profile jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_full_name text;
  v_dietary_notes text;
  v_interests_json jsonb;
  v_interests text[] := '{}';
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
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
      )
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

  if jsonb_typeof(p_profile -> 'personal_photo_consent') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "personal_photo_consent"}';
  end if;

  if coalesce(jsonb_typeof(p_profile -> 'dietary_notes'), 'null') not in ('string', 'null') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;
  v_dietary_notes := nullif(btrim(p_profile ->> 'dietary_notes'), '');
  if char_length(v_dietary_notes) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;

  -- Story 2.16: optional; missing or null = none. Otherwise an array of
  -- known codes, each once, stored in code order.
  v_interests_json := p_profile -> 'special_brunch_interests';
  if v_interests_json is not null and v_interests_json <> 'null'::jsonb then
    -- Two steps: jsonb_array_elements fails on a non-array.
    if jsonb_typeof(v_interests_json) <> 'array' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "special_brunch_interests"}';
    end if;

    if exists (
         select 1
         from jsonb_array_elements(v_interests_json) as e (v)
         where jsonb_typeof(e.v) <> 'string'
            or (e.v #>> '{}') <> all (array['couples', 'grandma', 'grandpa']::text[])
       )
       or jsonb_array_length(v_interests_json)
          <> (select count(distinct e.v) from jsonb_array_elements(v_interests_json) as e (v)) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "special_brunch_interests"}';
    end if;

    select coalesce(array_agg(c.code order by c.n), '{}'::text[])
    into v_interests
    from unnest(array['couples', 'grandma', 'grandpa']::text[]) with ordinality as c (code, n)
    where v_interests_json ? c.code;
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

    -- From 2 years back to 9 months ahead of the local today (AD-8,
    -- story 5.20).
    if v_birth is null or not private.birth_date_allowed(v_birth, v_today) then
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

  -- Everything of the customer in one sub-block: a unique violation (the
  -- phone taken since join_begin, or any other) or BIND_CONFLICT undoes it
  -- all and the link goes to conflict.
  begin
    insert into public.profiles (
      id, full_name, phone_e164, dietary_notes, special_brunch_interests, activated_at,
      privacy_consent_at, privacy_policy_version,
      photo_consent, photo_consent_at, photo_consent_text_version,
      personal_photo_consent, personal_photo_consent_at, personal_photo_consent_text_version
    )
    values (
      v_token.pending_user_id, v_full_name, v_identity ->> 'phone', v_dietary_notes, v_interests, now(),
      now(), v_privacy_version,
      (p_profile ->> 'photo_consent')::boolean, now(), v_photo_version,
      (p_profile ->> 'personal_photo_consent')::boolean, now(), v_photo_version
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
      v_conflict_reason := case
        when v_constraint = 'profiles_phone_e164_key' then 'phone_taken'
        else 'bind_conflict'
      end;
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
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_conflict_reason
      )
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
$function$;

revoke execute on function public.join_complete(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_complete(text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The customer card and the removal of personal details
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_customer(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_threshold integer;
  v_today date;
  v_email text;
  v_babies jsonb;
  v_entitlements jsonb;
  v_bookings jsonb;
  v_payments jsonb;
  v_notes jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Story 4.6: a removed customer is a tombstone only (her id, when, and
  -- whether the Auth step is still pending); nothing else is read.
  if v_profile.anonymized_at is not null then
    return jsonb_build_object(
      'profile', jsonb_build_object(
        'id', v_profile.id,
        'anonymized_at', v_profile.anonymized_at,
        'removal_pending',
          coalesce(v_profile.account_op_state = 'anonymization_pending', false)
      )
    );
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile.id;
  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', b.name, 'birth_date', b.birth_date)
      order by b.birth_date, b.id
    ),
    '[]'::jsonb
  )
  into v_babies
  from public.babies b
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_name,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'pinned_event_id', x.pinned_event_id,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_entitlements
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
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      p.product_snapshot ->> 'name' as product_name,
      (
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
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_profile.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', b.event_id,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'status', b.status,
        'party_size', b.party_size,
        'created_at', b.created_at,
        'credit_id', cr.credit_id,
        -- Story 5.20: the session a moved booking went to (as get_my_bookings).
        'moved_to_starts_at', me.starts_at
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  left join lateral (
    select x.credit_id
    from (
      select cc.id as credit_id, 0 as priority
      from public.cancellation_credits cc
      where cc.origin_booking_id = b.id
      union all
      select a.credit_id, 1 as priority
      from public.booking_allocations a
      where a.booking_id = b.id
        and a.credit_id is not null
    ) x
    order by x.priority, x.credit_id
    limit 1
  ) cr on true
  left join public.bookings mb on mb.id = b.moved_to_booking_id
  left join public.events me on me.id = mb.event_id
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'product_name', p.product_snapshot ->> 'name',
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'payment_method_name', p.product_snapshot ->> 'payment_method_name',
        'status', p.status
      )
      order by p.paid_on desc, p.created_at desc, p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.customer_notes n
  where n.customer_id = v_profile.id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_email,
      'activated_at', v_profile.activated_at,
      'created_at', v_profile.created_at,
      'dietary_notes', v_profile.dietary_notes,
      'special_brunch_interests', to_jsonb(v_profile.special_brunch_interests),
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$function$;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_anonymize_customer(p_customer_id uuid, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_prev jsonb;
  v_profile public.profiles;
  v_plan jsonb;
  v_blockers jsonb;
  v_token_ids uuid[];
  v_payment_ids uuid[];
  v_old_token public.activation_tokens;
  v_new_token public.activation_tokens;
  -- Story 5.20: the Auth users of her claiming links, deleted by the
  -- caller after this call (they never have a profile).
  v_orphans uuid[] := '{}'::uuid[];
  v_prefix text := '/admin/customers/' || coalesce(p_customer_id::text, '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_confirmed is distinct from true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Locks (AD-6): her tokens, her babies (private.babies_guard locks a baby
  -- before its profile), her profile (the mutex), bookings, payments,
  -- waitlist entries, notification jobs.
  perform 1
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id
  order by t.id
  for update;

  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  into v_token_ids
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id;

  perform 1
  from public.babies b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_profile.id is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- A retry: cleaned already; never cleaned again.
  if v_profile.anonymized_at is not null then
    return private.idempotent_finish(
      v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
      jsonb_build_object(
        'result', case
          when v_profile.account_op_state = 'anonymization_pending' then 'pending'
          else 'done'
        end,
        'user_id', v_profile.id
      )
    );
  end if;

  -- Story 5.20: not while her email change is between its steps (AD-21).
  if v_profile.account_op_state = 'email_change_pending' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.bookings b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  -- The blockers again, under the locks (the preview may be stale).
  v_plan := private.plan_admin_anonymize_customer(p_customer_id);
  v_blockers := v_plan -> 'blockers';
  if jsonb_array_length(v_blockers -> 'bookings') > 0
     or jsonb_array_length(v_blockers -> 'refund_requests') > 0
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0
     or jsonb_array_length(v_blockers -> 'parked_purchases') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices'),
        'parked_purchases', jsonb_array_length(v_blockers -> 'parked_purchases')
      )::text;
  end if;

  -- Her payments, and the unbound ones behind her join links (a purchase
  -- waiting for her sign-in), by id.
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_payment_ids
  from public.payments p
  where p.customer_id = p_customer_id
     or p.id in (
       select t.payment_id
       from public.activation_tokens t
       where t.id = any (v_token_ids)
         and t.purpose = 'join'
         and t.payment_id is not null
     );

  perform 1
  from public.payments p
  where p.id = any (v_payment_ids)
  order by p.id
  for update;

  perform 1
  from public.waitlist_entries w
  where w.customer_id = p_customer_id
  order by w.id
  for update;

  perform 1
  from public.notification_jobs j
  join public.notifications n on n.id = j.notification_id
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix)
  order by j.id
  for update of j;

  -- Her links: a live link is revoked, except a join waiting for her
  -- sign-in, which can never bind now (a conflict in "to handle"); each
  -- one logged as admin_issue_link logs a revoke. Then no input hash stays.
  for v_old_token in
    select t.*
    from public.activation_tokens t
    where t.id = any (v_token_ids)
      and t.state in ('pending', 'awaiting_login', 'claiming')
    order by t.id
  loop
    update public.activation_tokens t
    set input_hash = null,
        state = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'conflict'
          else 'revoked'
        end,
        conflict_reason = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'bind_conflict'
          else t.conflict_reason
        end,
        revoked_at = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then t.revoked_at
          else v_now
        end
    where t.id = v_old_token.id
    returning * into v_new_token;

    if v_old_token.state = 'claiming'
       and v_old_token.pending_user_id is not null
       and v_old_token.pending_user_id <> p_customer_id then
      v_orphans := v_orphans || v_old_token.pending_user_id;
    end if;

    perform private.audit(
      v_actor, 'admin', 'revoke_link', 'activation_tokens', v_old_token.id,
      p_customer_id, null, to_jsonb(v_old_token), to_jsonb(v_new_token)
    );
  end loop;

  update public.activation_tokens t
  set input_hash = null
  where t.id = any (v_token_ids)
    and t.input_hash is not null;

  -- The profile: full_name is NOT NULL, so it becomes the removed wording;
  -- the privacy consent (when and which version) stays.
  update public.profiles
  set full_name = 'לקוחה שפרטיה הוסרו',
      phone_e164 = null,
      pending_email = null,
      dietary_notes = null,
      special_brunch_interests = '{}',
      photo_consent = false,
      photo_consent_at = null,
      photo_consent_text_version = null,
      personal_photo_consent = false,
      personal_photo_consent_at = null,
      personal_photo_consent_text_version = null,
      anonymized_at = v_now,
      account_op_state = 'anonymization_pending',
      account_op_started_at = v_now,
      account_op_target_hash = null
  where id = p_customer_id;

  -- Admin deletes skip babies_guard's profile lock and LAST_BABY (the
  -- caller is not the customer).
  delete from public.babies where customer_id = p_customer_id;
  delete from public.customer_notes where customer_id = p_customer_id;
  delete from public.waitlist_entries where customer_id = p_customer_id;
  -- notification_deliveries go with them (on delete cascade).
  delete from public.push_subscriptions where user_id = p_customer_id;
  -- Their notification_jobs (and deliveries) go with them.
  delete from public.notifications n
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix);

  update public.payments
  set payer_label = null,
      note = null
  where id = any (v_payment_ids)
    and (payer_label is not null or note is not null);

  update public.bookings
  set guest_details = null
  where customer_id = p_customer_id
    and guest_details is not null;

  -- Stored results: hers, her links', and Tal's that name her. This call's
  -- own row has no result yet, so it stays.
  delete from private.idempotency_results r
  where r.actor_scope = p_customer_id::text
     or r.actor_scope = any (
       select 'token:' || x::text from unnest(v_token_ids) as x
     )
     or (
       r.actor_scope in (select a.user_id::text from public.admin_roles a)
       and r.result::text like '%' || p_customer_id::text || '%'
     );

  -- Her audit rows, and those of the payments above (written while
  -- customer_id was null too): note is the one free-text key audit_diff
  -- does not mask.
  update public.audit_log a
  set before = case
        when a.before ? 'note' then jsonb_set(a.before, '{note}', '"<removed>"'::jsonb)
        else a.before
      end,
      after = case
        when a.after ? 'note' then jsonb_set(a.after, '{note}', '"<removed>"'::jsonb)
        else a.after
      end
  where (
      a.customer_id = p_customer_id
      or (a.entity_type = 'payments' and a.entity_id = any (v_payment_ids))
    )
    and (a.before ? 'note' or a.after ? 'note');

  perform private.audit(
    v_actor, 'admin', 'admin_anonymize_customer', 'profiles', p_customer_id,
    p_customer_id, null,
    jsonb_build_object('anonymized_at', null),
    jsonb_build_object('anonymized_at', v_now)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object(
      'result', 'pending',
      'user_id', p_customer_id,
      'orphan_user_ids', to_jsonb(v_orphans)
    )
  );
end;
$function$;

revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The customers list and export, with p_interest (new overloads)
-- ---------------------------------------------------------------------------

-- As admin_list_customers(text, text), plus p_interest: null = no filter,
-- else one known code (INVALID_INPUT interest otherwise); AND with the
-- activity and the search.
create function public.admin_list_customers(p_query text, p_activity text, p_interest text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := coalesce(btrim(p_query), '');
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_activity is null or p_activity not in ('all', 'active', 'inactive') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'activity')::text;
  end if;

  if p_interest is not null
     and p_interest not in ('couples', 'grandma', 'grandpa') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'interest')::text;
  end if;

  if char_length(v_query) > 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;
  -- One character: nothing yet (the search starts at two).
  if char_length(v_query) = 1 then
    return jsonb_build_object('customers', '[]'::jsonb, 'has_more', false);
  end if;

  with matched as (
    select
      p.id,
      p.full_name,
      p.phone_e164,
      p.activated_at is not null as activated,
      private.customer_last_activity_on(p.id) as last_activity_on,
      private.customer_activity(p.id) = 'inactive' as inactive
    from public.profiles p
    where p.anonymized_at is null
      and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
      and (
        v_query = ''
        or private.customer_matches(p.full_name, p.phone_e164, v_query)
      )
      and (p_interest is null or p_interest = any (p.special_brunch_interests))
  ),
  ranked as (
    select
      m.*,
      row_number() over (
        order by m.last_activity_on desc nulls last, m.full_name, m.id
      ) as rn
    from matched m
    where p_activity = 'all' or m.inactive = (p_activity = 'inactive')
  )
  select jsonb_build_object(
    'customers', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'full_name', r.full_name,
          'phone_e164', r.phone_e164,
          'activated', r.activated,
          'last_activity_on', r.last_activity_on,
          'inactive', r.inactive
        )
        order by r.rn
      ) filter (where r.rn <= 200),
      '[]'::jsonb
    ),
    'has_more', coalesce(max(r.rn) > 200, false)
  )
  into v_result
  from ranked r
  where r.rn <= 201;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_customers(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customers(text, text, text) to authenticated;

-- As admin_export_customers(text, text, text[], text), plus p_interest (as
-- the list) and the column special_brunch_interests (the codes; the app
-- writes the labels). The audit after-json keeps interest.
create function public.admin_export_customers(
  p_scope text,
  p_query text,
  p_columns text[],
  p_activity text,
  p_interest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_query text := btrim(p_query);
  v_name boolean;
  v_phone boolean;
  v_email boolean;
  v_interests boolean;
  v_rows jsonb;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_scope is null or p_scope not in ('all', 'search') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'scope')::text;
  end if;

  if p_scope = 'search'
     and (v_query is null or char_length(v_query) not between 2 and 100) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;

  if p_activity is null or p_activity not in ('all', 'active', 'inactive') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'activity')::text;
  end if;

  if p_interest is not null
     and p_interest not in ('couples', 'grandma', 'grandpa') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'interest')::text;
  end if;

  if p_columns is null
     or coalesce(cardinality(p_columns), 0) = 0
     or not (p_columns <@ array['full_name', 'phone', 'email', 'special_brunch_interests']::text[])
     or cardinality(p_columns)
        <> (select count(distinct c) from unnest(p_columns) c) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'columns')::text;
  end if;

  v_name := 'full_name' = any (p_columns);
  v_phone := 'phone' = any (p_columns);
  v_email := 'email' = any (p_columns);
  v_interests := 'special_brunch_interests' = any (p_columns);

  with matched as (
    select
      p.id,
      p.full_name,
      p.phone_e164,
      p.special_brunch_interests,
      private.customer_last_activity_on(p.id) as last_activity_on
    from public.profiles p
    where p.anonymized_at is null
      and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
      and (
        p_scope = 'all'
        or private.customer_matches(p.full_name, p.phone_e164, v_query)
      )
      and (
        p_activity = 'all'
        or private.customer_activity(p.id) = p_activity
      )
      and (p_interest is null or p_interest = any (p.special_brunch_interests))
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'full_name', case when v_name then m.full_name end,
          'phone_e164', case when v_phone then m.phone_e164 end,
          'email', case when v_email then (
            select u.email from auth.users u where u.id = m.id
          ) end,
          'special_brunch_interests', case
            when v_interests then to_jsonb(m.special_brunch_interests)
          end
        )
        order by m.last_activity_on desc nulls last, m.full_name, m.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_rows, v_count
  from matched m;

  perform private.audit(
    v_actor, 'admin', 'admin_export_customers', 'profiles',
    null, null, null, null,
    jsonb_build_object(
      'scope', p_scope,
      'columns', to_jsonb(p_columns),
      'activity', p_activity,
      'interest', p_interest,
      'row_count', v_count
    ),
    null
  );

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke execute on function public.admin_export_customers(text, text, text[], text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_export_customers(text, text, text[], text, text) to authenticated;
