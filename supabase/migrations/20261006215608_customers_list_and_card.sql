-- Story 4.2: the customers list and the customer card (CAP-25, CAP-9,
-- CAP-40). Internal notes (customer_notes) are admin only: RLS select for
-- admins, no policy for a customer, no write grant; every write is an RPC
-- here (AD-1, AD-5). A customer is a profiles row that is not anonymized and
-- not in admin_roles. The last activity of a customer is the latest of: the
-- session day of a completed booking, paid_on of an approved payment of
-- hers, and the day a booking of hers was created (any status); days in
-- Asia/Jerusalem (AD-8). The email is read only here, from auth.users (AD-3).

-- ---------------------------------------------------------------------------
-- customer_notes
-- ---------------------------------------------------------------------------

-- created_by is the admin's id, without a FK (as audit_log.actor_id): the
-- note stays when an admin account goes.
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index customer_notes_customer_id_idx
  on public.customer_notes (customer_id, created_at desc);

alter table public.customer_notes enable row level security;

create policy customer_notes_authenticated_select on public.customer_notes
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.customer_notes from public, anon, authenticated, service_role;
grant select on table public.customer_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The day of a customer's last activity (participation, purchase or
-- booking, the latest of them), or null without any. Also used by 5.13
-- (active / inactive).
create function private.customer_last_activity_on(p_customer_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select max(x.day)
  from (
    select (e.starts_at at time zone 'Asia/Jerusalem')::date as day
    from public.bookings b
    join public.events e on e.id = b.event_id
    where b.customer_id = p_customer_id
      and b.status = 'completed'
    union all
    select p.paid_on
    from public.payments p
    where p.customer_id = p_customer_id
      and p.status = 'approved'
    union all
    select (b.created_at at time zone 'Asia/Jerusalem')::date
    from public.bookings b
    where b.customer_id = p_customer_id
  ) x;
$$;

-- The one search rule of the customers (story 2.5's admin_search_customers
-- and the customers list): part of the name, any case; the whole phone in
-- any format (private.normalize_phone); or a run of the phone's digits, also
-- in the local form (05...). Only a query made of phone characters is
-- matched by its digits. The caller trims and checks the query's length.
create function private.customer_matches(
  p_full_name text,
  p_phone_e164 text,
  p_query text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_query text := btrim(p_query);
  v_phone text;
  v_digits text;
begin
  if v_query is null or v_query = '' then
    return false;
  end if;

  if strpos(lower(coalesce(p_full_name, '')), lower(v_query)) > 0 then
    return true;
  end if;

  if p_phone_e164 is null then
    return false;
  end if;

  v_phone := private.normalize_phone(v_query);
  if v_phone is not null and p_phone_e164 = v_phone then
    return true;
  end if;

  if v_query ~ '^[0-9+() .-]+$' then
    v_digits := nullif(regexp_replace(v_query, '[^0-9]', '', 'g'), '');
  end if;

  return v_digits is not null
    and (
      strpos(substr(p_phone_e164, 2), v_digits) > 0
      or (
        p_phone_e164 like '+972%'
        and strpos('0' || substr(p_phone_e164, 5), v_digits) > 0
      )
    );
end;
$$;

revoke execute on function private.customer_last_activity_on(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.customer_matches(text, text, text) from public, anon, authenticated, service_role;

-- The audit masks a note's body (AD-19): as in 20261004072550, plus
-- customer_notes.body.
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
        or (p_table = 'customer_notes' and k = 'body')
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
-- admin_search_customers: the same result, through private.customer_matches
-- ---------------------------------------------------------------------------

create or replace function public.admin_search_customers(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(p_query);
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_query is null or char_length(v_query) not between 2 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
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
      and private.customer_matches(p.full_name, p.phone_e164, v_query)
    order by p.full_name, p.id
    limit 20
  ) c;

  return v_result;
end;
$$;

revoke execute on function public.admin_search_customers(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_customers(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The customers list (/admin/customers). Every empty parameter is no
-- filter. The query is searched from 2 characters after trimming (fewer: no
-- search; over 100: INVALID_INPUT). The dates filter the last activity, both
-- ends included; a customer without activity never passes a date filter.
-- from > to: INVALID_INPUT. By last activity (none last), name, id; at most
-- 200, has_more when there are more. No email.
create function public.admin_list_customers(
  p_query text,
  p_active_from date,
  p_active_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(p_query), '');
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_query is not null and char_length(v_query) > 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;
  if char_length(v_query) < 2 then
    v_query := null;
  end if;
  if p_active_from > p_active_to then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'active_to')::text;
  end if;

  with customers as (
    select
      p.id,
      p.full_name,
      p.phone_e164,
      p.activated_at is not null as activated,
      private.customer_last_activity_on(p.id) as last_activity_on
    from public.profiles p
    where p.anonymized_at is null
      and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
      and (
        v_query is null
        or private.customer_matches(p.full_name, p.phone_e164, v_query)
      )
  ),
  filtered as (
    select
      c.*,
      row_number() over (
        order by c.last_activity_on desc nulls last, c.full_name, c.id
      ) as rn
    from customers c
    where (p_active_from is null or c.last_activity_on >= p_active_from)
      and (p_active_to is null or c.last_activity_on <= p_active_to)
  )
  select jsonb_build_object(
    'customers', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'full_name', f.full_name,
          'phone_e164', f.phone_e164,
          'activated', f.activated,
          'last_activity_on', f.last_activity_on
        )
        order by f.rn
      ) filter (where f.rn <= 200),
      '[]'::jsonb
    ),
    'has_more', coalesce(max(f.rn) > 200, false)
  )
  into v_result
  from filtered f
  where f.rn <= 201;

  return v_result;
end;
$$;

-- The customer card (/admin/customers/[id]). Not a customer (unknown, an
-- admin or anonymized): NOT_FOUND. Balances only from entitlement_balances
-- (AD-14), with the fields of get_my_entitlements; is_expiring by
-- business_settings.admin_expiring_days. Notes appear only here.
create function public.admin_get_customer(p_customer_id uuid)
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
  v_notifications jsonb;
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
        'pinned_event_id', x.pinned_event_id
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
      p.product_snapshot ->> 'name' as product_name
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
      jsonb_build_object(
        'title', n.payload ->> 'title',
        'body', n.payload ->> 'body',
        'created_at', n.created_at,
        'read_at', n.read_at
      )
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notifications
  from (
    select n.*
    from public.notifications n
    where n.recipient_id = v_profile.id
      and n.recipient_kind = 'customer'
    order by n.created_at desc, n.id
    limit 30
  ) n;

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
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notifications', v_notifications,
    'notes', v_notes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Write: internal notes (add and delete only; user decision 2026-10-07)
-- ---------------------------------------------------------------------------

-- Locks the customer's profiles row (for update); not a customer:
-- NOT_FOUND.
create function private.lock_customer(p_customer_id uuid)
returns public.profiles
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and p.anonymized_at is null
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
  for update;
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_profile;
end;
$$;

revoke execute on function private.lock_customer(uuid) from public, anon, authenticated, service_role;

create function public.admin_add_customer_note(
  p_customer_id uuid,
  p_body text,
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
  v_profile public.profiles;
  v_note public.customer_notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_customer_note', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'body')::text;
  end if;

  v_profile := private.lock_customer(p_customer_id);

  insert into public.customer_notes (customer_id, body, created_by)
  values (v_profile.id, btrim(p_body), v_actor)
  returning * into v_note;

  perform private.audit(
    v_actor, 'admin', 'admin_add_customer_note', 'customer_notes', v_note.id,
    v_profile.id, null, null, to_jsonb(v_note)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_customer_note', p_idempotency_key,
    jsonb_build_object('note_id', v_note.id)
  );
end;
$$;

create function public.admin_delete_customer_note(
  p_note_id uuid,
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
  v_customer uuid;
  v_old public.customer_notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_customer_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select n.customer_id into v_customer
  from public.customer_notes n
  where n.id = p_note_id;
  if v_customer is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform private.lock_customer(v_customer);

  -- Read again under the lock: a concurrent delete went first.
  select n.* into v_old
  from public.customer_notes n
  where n.id = p_note_id
  for update;
  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from public.customer_notes where id = v_old.id;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_customer_note', 'customer_notes', v_old.id,
    v_old.customer_id, null, to_jsonb(v_old), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_customer_note', p_idempotency_key,
    jsonb_build_object('note_id', v_old.id)
  );
end;
$$;

revoke execute on function public.admin_list_customers(text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customers(text, date, date) to authenticated;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;

revoke execute on function public.admin_add_customer_note(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_customer_note(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_delete_customer_note(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_customer_note(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_get_home: as in 20261005225116, plus customer_id on expiring_cards
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_start date;
  v_threshold integer;
  v_sessions jsonb;
  v_cards jsonb;
  v_totals jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  v_start := date_trunc('month', v_today)::date;

  select s.admin_expiring_days into v_threshold
  from public.business_settings s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', u.id,
        'concept_name', u.concept_name,
        'kind', u.kind,
        'starts_at', u.starts_at,
        'ends_at', u.ends_at,
        'occupied', private.occupied_places(u.id),
        'capacity', u.capacity_adults
      )
      order by u.starts_at, u.id
    ),
    '[]'::jsonb
  )
  into v_sessions
  from (
    select e.id, c.name as concept_name, e.kind, e.starts_at, e.ends_at,
      e.capacity_adults
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.ends_at > now()
    order by e.starts_at, e.id
    limit 4
  ) u;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'available', x.available,
        'expires_on', x.expires_on,
        'days_left', x.days_left
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      b.available,
      b.expires_on,
      b.expires_on - v_today as days_left
    from public.entitlement_balances b
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and b.available > 0
      and b.expires_on - v_today <= v_threshold
  ) x;

  select jsonb_build_object(
    'period_start', v_start,
    'period_end', v_today,
    'approved_count', count(*)::integer,
    'approved_agorot', coalesce(sum(p.amount_agorot), 0)::bigint,
    'net_agorot', coalesce(sum(p.amount_agorot), 0)::bigint
  )
  into v_totals
  from public.payments p
  where p.status = 'approved'
    and p.paid_on between v_start and v_today;

  return jsonb_build_object(
    'upcoming_sessions', v_sessions,
    'expiring_cards', v_cards,
    'totals', v_totals
  );
end;
$$;

revoke execute on function public.admin_get_home() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_home() to authenticated;
