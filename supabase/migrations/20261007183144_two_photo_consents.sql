-- Story 2.13: two photo consents (CAP-40, user decision 2026-10-07).
-- profiles.photo_consent keeps its columns and now means the atmosphere
-- photos (published, identifiable). The personal photos shared in the
-- brunch's WhatsApp group get their own columns in the same pattern; an
-- existing customer has not approved them (default false). No drop, no
-- rename. authenticated gets no update on the new columns (AD-1): only
-- join_complete and set_personal_photo_consent write them.
-- 1. profiles: personal_photo_consent, _at, _text_version.
-- 2. join_complete (create or replace, same signature): requires
--    personal_photo_consent (a boolean) as photo_consent, and stores both
--    with now() and the join-form published_version.
-- 3. set_personal_photo_consent: the copy of set_photo_consent for the
--    personal consent.
-- 4. admin_get_customer and admin_get_event_details return the personal
--    consent too (same conditions, nothing else changed).
-- 5. The join-form photo_consent block: two questions and a note (the
--    wording of the UX memlog 2026-10-07), draft and published, and the
--    page's published_version + 1 (as admin_publish_content).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column personal_photo_consent boolean not null default false,
  add column personal_photo_consent_at timestamptz,
  add column personal_photo_consent_text_version integer
    check (personal_photo_consent_text_version >= 0);

-- ---------------------------------------------------------------------------
-- 2. join_complete
-- ---------------------------------------------------------------------------

-- As in 20261002194018, plus the personal photo consent.
create or replace function public.join_complete(
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

  -- Everything of the customer in one sub-block: a unique violation (the
  -- phone taken since join_begin, or any other) or BIND_CONFLICT undoes it
  -- all and the link goes to conflict.
  begin
    insert into public.profiles (
      id, full_name, phone_e164, dietary_notes, activated_at,
      privacy_consent_at, privacy_policy_version,
      photo_consent, photo_consent_at, photo_consent_text_version,
      personal_photo_consent, personal_photo_consent_at, personal_photo_consent_text_version
    )
    values (
      v_token.pending_user_id, v_full_name, v_identity ->> 'phone', v_dietary_notes, now(),
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
$$;

revoke execute on function public.join_complete(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_complete(text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. set_personal_photo_consent
-- ---------------------------------------------------------------------------

-- The customer's own personal photo consent (as set_photo_consent): exempt
-- from idempotency (a set_* self-update, AD-5). No active customer ->
-- NOT_AUTHORIZED; null -> INVALID_INPUT personal_photo_consent. The same
-- value writes nothing; a change stores the value, now() and the join-form
-- published_version, and is audited. Returns the three columns.
create function public.set_personal_photo_consent(p_consent boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_old public.profiles;
  v_new public.profiles;
  v_version integer;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_consent is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "personal_photo_consent"}';
  end if;

  -- Lock order (AD-6): profiles is the customer's mutex.
  select p.* into v_old
  from public.profiles p
  where p.id = v_customer
  for update;

  -- The profile was removed between the check and the lock.
  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_old.personal_photo_consent = p_consent then
    return jsonb_build_object(
      'personal_photo_consent', v_old.personal_photo_consent,
      'personal_photo_consent_at', v_old.personal_photo_consent_at,
      'personal_photo_consent_text_version', v_old.personal_photo_consent_text_version
    );
  end if;

  select cp.published_version into v_version
  from public.content_pages cp
  where cp.slug = 'join-form';

  if v_version is null then
    raise exception 'set_personal_photo_consent: content page missing' using errcode = 'XX000';
  end if;

  update public.profiles p
  set personal_photo_consent = p_consent,
      personal_photo_consent_at = now(),
      personal_photo_consent_text_version = v_version
  where p.id = v_customer
  returning p.* into v_new;

  perform private.audit(
    v_customer, 'customer', 'set_personal_photo_consent', 'profiles', v_customer,
    v_customer, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object(
    'personal_photo_consent', v_new.personal_photo_consent,
    'personal_photo_consent_at', v_new.personal_photo_consent_at,
    'personal_photo_consent_text_version', v_new.personal_photo_consent_text_version
  );
end;
$$;

revoke execute on function public.set_personal_photo_consent(boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_personal_photo_consent(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin reads
-- ---------------------------------------------------------------------------

-- As in 20261007121030, plus personal_photo_consent and its time.
create or replace function public.admin_get_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    and p.anonymized_at is null
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
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
        'created_at', b.created_at
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
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
$$;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;

-- As in 20261006215720, plus personal_photo_consent (only for an active
-- customer, as photo_consent).
create or replace function public.admin_get_event_details(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_bookings jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'concept_name', c.name,
    'kind', e.kind,
    'status', e.status,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'registration_closes_at', e.registration_closes_at,
    'capacity_adults', e.capacity_adults,
    'occupied', private.occupied_places(e.id)
  )
  into v_event
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_event_id;

  if v_event is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'booking_id', b.id,
        'party_size', b.party_size,
        'booked_by', b.booked_by,
        'guest_details', b.guest_details,
        'customer_id', b.customer_id,
        'pending_join', b.customer_id is null,
        'payer_label', case when b.customer_id is null then pay.payer_label end,
        'full_name', p.full_name,
        'phone_e164', p.phone_e164,
        'dietary_notes', p.dietary_notes,
        'photo_consent', p.photo_consent,
        'personal_photo_consent', p.personal_photo_consent,
        'babies', case when p.id is not null then (
          select coalesce(
            jsonb_agg(
              jsonb_build_object('name', bb.name, 'birth_date', bb.birth_date)
              order by bb.birth_date, bb.id
            ),
            '[]'::jsonb
          )
          from public.babies bb
          where bb.customer_id = p.id
        ) end
      ))
      order by b.confirmed_at, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  left join public.profiles p
    on p.id = b.customer_id
   and p.activated_at is not null
   and p.anonymized_at is null
  left join public.payments pay on pay.id = b.payment_id
  where b.event_id = p_event_id
    and private.is_real_booking(b.status);

  return jsonb_build_object('event', v_event, 'bookings', v_bookings);
end;
$$;

revoke execute on function public.admin_get_event_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_event_details(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The join-form photo_consent block
-- ---------------------------------------------------------------------------

update public.content_sections
set draft_content = '{"atmosphere_title":"פרסום תמונות אווירה","atmosphere_question":"האם את מסכימה לפרסום תמונות מהמפגשים שבהן ניתן לזהות אותך או את ילדך, באתר ובערוצי הפרסום של העסק?","atmosphere_yes":"כן, אני מסכימה.","atmosphere_no":"לא, איני מסכימה.","personal_title":"צילום תמונות אישיות ושיתוף בקבוצה","personal_question":"האם את מסכימה שטל תצלם תמונות אישיות שלך או של ילדך ותשתף אותן בקבוצת הוואטסאפ של הבראנץ׳? התמונות יהיו נגישות לחברות הקבוצה ולא ישמשו לפרסום מטעם העסק.","personal_yes":"כן, אני מסכימה.","personal_no":"לא, איני מסכימה.","note":"הסכמה לגבי ילדך ניתנת על ידך כהורה או כאפוטרופוס מוסמך.\nההסכמות אינן תנאי להשתתפות, וסירוב לא יפגע בשירות שתקבלי.\nההשתתפות כשלעצמה אינה מהווה הסכמה.\nניתן לשנות את בחירתך או לבטל הסכמה להמשך צילום, שיתוף או פרסום בכל עת באפליקציה."}'::jsonb,
    published_content = '{"atmosphere_title":"פרסום תמונות אווירה","atmosphere_question":"האם את מסכימה לפרסום תמונות מהמפגשים שבהן ניתן לזהות אותך או את ילדך, באתר ובערוצי הפרסום של העסק?","atmosphere_yes":"כן, אני מסכימה.","atmosphere_no":"לא, איני מסכימה.","personal_title":"צילום תמונות אישיות ושיתוף בקבוצה","personal_question":"האם את מסכימה שטל תצלם תמונות אישיות שלך או של ילדך ותשתף אותן בקבוצת הוואטסאפ של הבראנץ׳? התמונות יהיו נגישות לחברות הקבוצה ולא ישמשו לפרסום מטעם העסק.","personal_yes":"כן, אני מסכימה.","personal_no":"לא, איני מסכימה.","note":"הסכמה לגבי ילדך ניתנת על ידך כהורה או כאפוטרופוס מוסמך.\nההסכמות אינן תנאי להשתתפות, וסירוב לא יפגע בשירות שתקבלי.\nההשתתפות כשלעצמה אינה מהווה הסכמה.\nניתן לשנות את בחירתך או לבטל הסכמה להמשך צילום, שיתוף או פרסום בכל עת באפליקציה."}'::jsonb,
    published_at = now(),
    updated_at = now()
where page_slug = 'join-form'
  and key = 'photo_consent';

update public.content_pages
set published_content = coalesce(published_content, '{}'::jsonb),
    published_at = now(),
    published_version = published_version + 1,
    updated_at = now()
where slug = 'join-form';
