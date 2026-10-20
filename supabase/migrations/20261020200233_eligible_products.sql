-- Story 3.18: eligible products per session (source §7).
--
-- A session may name the products it accepts (public.event_products). No
-- row = every fitting product, as before (user decision 1, 2026-10-20). One
-- definition, private.event_accepts_product, is called by every eligibility
-- path: entitlement_fits_event (so week_has_eligible_session /
-- job_auto_extend, plan_admin_correct_entitlement and
-- admin_get_attention_items), plan_funding (both entitlement queries and the
-- credit step), plan_pinned_placement (decision 2a), the credit options
-- (move_option_candidates, refresh_credit_options; decision 2b) and the move
-- checks (move_card_code, move_target_code). New bookings only: no existing
-- booking, entitlement or credit changes (an active credit option that stops
-- fitting is replaced like a full one). Prices are unchanged (decision 3).
-- Every redefinition below is the live pg_get_functiondef plus the product
-- lines; the signatures are unchanged, so the grants stay.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table public.event_products (
  event_id uuid not null references public.events (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  primary key (event_id, product_id)
);

create index event_products_product_id_idx
  on public.event_products (product_id);

alter table public.event_products enable row level security;

create policy event_products_admin_select on public.event_products
  for select to authenticated
  using ((select private.is_admin()));

-- Written only inside the event RPCs (security definer, AD-1, AD-5).
revoke all on table public.event_products from public, anon, authenticated, service_role;
grant select on table public.event_products to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The helper
-- ---------------------------------------------------------------------------

-- True when the session names no products, or names this one.
create function private.event_accepts_product(p_event_id uuid, p_product_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
      select 1 from public.event_products ep where ep.event_id = p_event_id
    )
    or exists (
      select 1
      from public.event_products ep
      where ep.event_id = p_event_id
        and ep.product_id = p_product_id
    );
$$;

-- Saves a session's product set from p_product_ids (a JSON array of
-- distinct uuid strings, may be empty). Each must be a product (active or
-- hidden) of the session's kind, else INVALID_INPUT field product_ids. An
-- unchanged set writes nothing and returns false; a changed one writes one
-- audit row (entity event_products, before/after {product_ids,
-- product_names}, names sorted) and returns true. The caller holds the
-- session's lock (or just created it).
create function private.save_event_products(
  p_event public.events,
  p_product_ids jsonb,
  p_actor uuid,
  p_action text
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_old uuid[];
  v_old_names text[];
  v_new_names text[];
begin
  if p_product_ids is null
     or jsonb_typeof(p_product_ids) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(p_product_ids) x
       where jsonb_typeof(x.value) <> 'string'
         or (x.value #>> '{}')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "product_ids"}';
  end if;

  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_ids
  from (
    select distinct (v.value #>> '{}')::uuid as id
    from jsonb_array_elements(p_product_ids) v
  ) x;

  if cardinality(v_ids) <> jsonb_array_length(p_product_ids)
     or exists (
       select 1
       from unnest(v_ids) as i(id)
       left join public.products p on p.id = i.id
       where p.id is null
         or p.eligible_event_kind is distinct from p_event.kind
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "product_ids"}';
  end if;

  select coalesce(array_agg(ep.product_id order by ep.product_id), '{}'::uuid[])
  into v_old
  from public.event_products ep
  where ep.event_id = p_event.id;

  if v_old = v_ids then
    return false;
  end if;

  delete from public.event_products
  where event_id = p_event.id
    and not (product_id = any (v_ids));

  insert into public.event_products (event_id, product_id)
  select p_event.id, i.id
  from unnest(v_ids) as i(id)
  on conflict do nothing;

  select coalesce(array_agg(p.name order by p.name, p.id), '{}'::text[])
  into v_old_names
  from public.products p
  where p.id = any (v_old);

  select coalesce(array_agg(p.name order by p.name, p.id), '{}'::text[])
  into v_new_names
  from public.products p
  where p.id = any (v_ids);

  perform private.audit(
    p_actor, 'admin', p_action, 'event_products', p_event.id,
    null, p_event.id,
    jsonb_build_object('product_ids', to_jsonb(v_old), 'product_names', to_jsonb(v_old_names)),
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'product_names', to_jsonb(v_new_names))
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Eligibility
-- ---------------------------------------------------------------------------

create or replace function private.entitlement_fits_event(
  p_entitlement public.entitlements,
  p_event public.events
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_entitlement.status = 'active'
    and p_entitlement.eligible_event_kind = p_event.kind
    and (
      p_entitlement.allowed_weekdays is null
      or extract(dow from (p_event.starts_at at time zone 'Asia/Jerusalem')::date)::smallint
         = any (p_entitlement.allowed_weekdays)
    )
    and not (p_entitlement.kind = 'card' and p_event.kind = 'couple')
    and p_entitlement.valid_from <= (p_event.starts_at at time zone 'Asia/Jerusalem')::date
    and (p_event.starts_at at time zone 'Asia/Jerusalem')::date <= p_entitlement.expires_on
    -- Story 3.18.
    and private.event_accepts_product(
      p_event.id, (p_entitlement.eligibility_snapshot ->> 'product_id')::uuid
    ),
    false
  );
$$;

create or replace function private.plan_funding(
  p_customer_id uuid,
  p_event_id uuid,
  p_party_size integer,
  p_mode text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_day date;
  v_weekday smallint;
  v_credit_id uuid;
  v_entitlement_id uuid;
  v_without_date boolean;
  -- Story 3.18.
  v_product_only boolean;
  v_without_date_product boolean;
begin
  if p_customer_id is null
     or p_party_size is null or p_party_size not in (1, 2)
     or p_mode is null or p_mode not in ('self', 'admin', 'move', 'online') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- (1) A credit whose active option is this session, or whose origin
  -- (the cancelled session) is this session, and whose product (from its
  -- source entitlement) the session accepts (story 3.18).
  select c.id into v_credit_id
  from public.cancellation_credits c
  where c.customer_id = p_customer_id
    and c.status = 'active'
    and not c.choice_pending
    and c.party_size = p_party_size
    and (
      exists (
        select 1
        from public.credit_options o
        where o.credit_id = c.id
          and o.event_id = v_event.id
          and o.state = 'active'
      )
      or exists (
        select 1
        from public.bookings ob
        where ob.id = c.origin_booking_id
          and ob.event_id = v_event.id
      )
    )
    and not exists (
      select 1
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      where a.credit_id = c.id
        and b.status = 'confirmed'
    )
    and private.event_accepts_product(
      v_event.id,
      (
        select (se.eligibility_snapshot ->> 'product_id')::uuid
        from public.entitlements se
        where se.id = c.source_entitlement_id
      )
    )
  order by c.created_at, c.id
  limit 1;

  if v_credit_id is not null then
    return jsonb_build_object(
      'ok', true,
      'sources', jsonb_build_array(
        jsonb_build_object('kind', 'credit', 'id', v_credit_id, 'units', 1)
      )
    );
  end if;

  -- (2) An entitlement, as before, of a product the session accepts.
  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;
  v_weekday := extract(dow from v_day)::smallint;

  select b.entitlement_id into v_entitlement_id
  from public.entitlements e
  join public.entitlement_balances b on b.entitlement_id = e.id
  where e.customer_id = p_customer_id
    and e.status = 'active'
    and e.eligible_event_kind = v_event.kind
    and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
    and (
      e.pinned_event_id is null
      or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
    )
    and not (e.kind = 'card' and v_event.kind = 'couple')
    and b.available >= 1
    and e.valid_from <= v_day
    and v_day <= e.expires_on
    and private.event_accepts_product(
      v_event.id, (e.eligibility_snapshot ->> 'product_id')::uuid
    )
  order by e.expires_on, e.id
  limit 1;

  if v_entitlement_id is not null then
    return jsonb_build_object(
      'ok', true,
      'sources', jsonb_build_array(
        jsonb_build_object('kind', 'entitlement', 'id', v_entitlement_id, 'units', 1)
      )
    );
  end if;

  -- Story 3.18: every rule (the date included) but the product, for an
  -- entitlement or a credit.
  select exists (
    select 1
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    where e.customer_id = p_customer_id
      and e.status = 'active'
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and (
        e.pinned_event_id is null
        or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
      )
      and not (e.kind = 'card' and v_event.kind = 'couple')
      and b.available >= 1
      and e.valid_from <= v_day
      and v_day <= e.expires_on
  ) or exists (
    select 1
    from public.cancellation_credits c
    where c.customer_id = p_customer_id
      and c.status = 'active'
      and not c.choice_pending
      and c.party_size = p_party_size
      and (
        exists (
          select 1
          from public.credit_options o
          where o.credit_id = c.id
            and o.event_id = v_event.id
            and o.state = 'active'
        )
        or exists (
          select 1
          from public.bookings ob
          where ob.id = c.origin_booking_id
            and ob.event_id = v_event.id
        )
      )
      and not exists (
        select 1
        from public.booking_allocations a
        join public.bookings b on b.id = a.booking_id
        where a.credit_id = c.id
          and b.status = 'confirmed'
      )
  ) into v_product_only;

  -- Every rule but the date (the product included).
  select exists (
    select 1
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    where e.customer_id = p_customer_id
      and e.status = 'active'
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and (
        e.pinned_event_id is null
        or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
      )
      and not (e.kind = 'card' and v_event.kind = 'couple')
      and b.available >= 1
      and private.event_accepts_product(
        v_event.id, (e.eligibility_snapshot ->> 'product_id')::uuid
      )
  ) into v_without_date;

  -- Every rule but the date and the product: an entitlement both expired on
  -- that date and excluded reads as excluded (story 3.18).
  select exists (
    select 1
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    where e.customer_id = p_customer_id
      and e.status = 'active'
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and (
        e.pinned_event_id is null
        or (p_mode not in ('self', 'online') and e.pinned_event_id = v_event.id)
      )
      and not (e.kind = 'card' and v_event.kind = 'couple')
      and b.available >= 1
  ) into v_without_date_product;

  return jsonb_build_object(
    'ok', false,
    'code', case
      when v_product_only then 'PRODUCT_NOT_VALID_FOR_EVENT'
      when v_without_date then 'ENTITLEMENT_EXPIRED_ON_DATE'
      when v_without_date_product then 'PRODUCT_NOT_VALID_FOR_EVENT'
      else 'NO_MATCHING_ENTITLEMENT'
    end,
    'sources', '[]'::jsonb
  );
end;
$$;

-- Decision 2a: a pinned product obeys the session's product set.
create or replace function private.plan_pinned_placement(
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_product public.products;
  v_event public.events;
  v_weekday smallint;
begin
  select p.* into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null or v_product.validity_mode <> 'session' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_BOOKABLE');
  end if;

  v_weekday := extract(dow from (v_event.starts_at at time zone 'Asia/Jerusalem'))::smallint;

  if v_event.kind <> v_product.eligible_event_kind
     or (v_product.allowed_weekdays is not null
         and not v_weekday = any (v_product.allowed_weekdays))
     or not private.event_accepts_product(v_event.id, v_product.id) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FIT');
  end if;

  if private.occupied_places(v_event.id) + v_product.party_size > v_event.capacity_adults then
    return jsonb_build_object('ok', false, 'code', 'EVENT_FULL');
  end if;

  if p_customer_id is not null then
    if exists (
      select 1
      from public.bookings b
      where b.customer_id = p_customer_id
        and b.event_id = v_event.id
        and b.status = 'confirmed'
    ) then
      return jsonb_build_object('ok', false, 'code', 'CUSTOMER_ALREADY_BOOKED');
    end if;

    if (v_product.type = 'intro' or v_product.intro_only)
       and private.intro_blocked(p_customer_id, p_payment_id) then
      return jsonb_build_object('ok', false, 'code', 'INTRO_NOT_ELIGIBLE');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- The payment approval picker: each event carries its product_ids (empty =
-- every fitting product), so eventOptionsFor hides the ones that do not
-- accept the pinned product (decision 2a).
create or replace function public.admin_list_bookable_events()
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
        'id', e.id,
        'starts_at', e.starts_at,
        'kind', e.kind,
        'local_date', (e.starts_at at time zone 'Asia/Jerusalem')::date,
        'weekday', extract(dow from (e.starts_at at time zone 'Asia/Jerusalem'))::integer,
        'concept_name', c.name,
        'occupied', private.occupied_places(e.id),
        'capacity', e.capacity_adults,
        'product_ids', coalesce(
          (
            select jsonb_agg(ep.product_id order by ep.product_id)
            from public.event_products ep
            where ep.event_id = e.id
          ),
          '[]'::jsonb
        )
      )
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.status = 'published'
    and e.starts_at > now();

  return v_result;
end;
$$;

-- A card move: the card's product must be accepted by the target. Order:
-- the rules, then the product, then the dates (story 3.18).
create or replace function private.move_card_code(p_booking_id uuid, p_target_event_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_day date;
  v_weekday smallint;
  v_rules boolean;
  v_dates boolean;
  v_product boolean;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_target_event_id;

  v_day := (v_event.starts_at at time zone 'Asia/Jerusalem')::date;
  v_weekday := extract(dow from v_day)::smallint;

  select
    coalesce(bool_and(
      e.status = 'active'
      and e.pinned_event_id is null
      and e.eligible_event_kind = v_event.kind
      and (e.allowed_weekdays is null or v_weekday = any (e.allowed_weekdays))
      and not (e.kind = 'card' and v_event.kind = 'couple')
    ), false),
    coalesce(bool_and(e.valid_from <= v_day and v_day <= e.expires_on), false),
    coalesce(bool_and(private.event_accepts_product(
      v_event.id, (e.eligibility_snapshot ->> 'product_id')::uuid
    )), false)
  into v_rules, v_dates, v_product
  from public.booking_allocations a
  join public.entitlements e on e.id = a.entitlement_id
  where a.booking_id = p_booking_id;

  if not v_rules then
    return 'NO_MATCHING_ENTITLEMENT';
  end if;
  if not v_product then
    return 'PRODUCT_NOT_VALID_FOR_EVENT';
  end if;
  if not v_dates then
    return 'ENTITLEMENT_EXPIRED_ON_DATE';
  end if;
  return null;
end;
$$;

-- A credit or pinned move: the credit's product (its entitlement) must be
-- accepted by the target, for the customer and for Tal (story 3.18).
create or replace function private.move_target_code(
  p_booking public.bookings,
  p_funding text,
  p_candidates uuid[],
  p_target_event_id uuid,
  p_actor_kind text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_original public.events;
  v_target public.events;
begin
  select e.* into v_original
  from public.events e
  where e.id = p_booking.event_id;

  select e.* into v_target
  from public.events e
  where e.id = p_target_event_id;

  if v_target.id is null
     or v_target.status <> 'published'
     or v_target.kind <> v_original.kind
     or v_target.id = v_original.id then
    return 'MOVE_TARGET_NOT_ALLOWED';
  end if;

  if p_actor_kind = 'customer' then
    if clock_timestamp() >= v_target.registration_closes_at then
      return 'REGISTRATION_CLOSED';
    end if;
  elsif v_target.ends_at <= clock_timestamp() then
    return 'EVENT_ENDED';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.customer_id = p_booking.customer_id
      and b.event_id = v_target.id
      and private.is_real_booking(b.status)
  ) then
    return 'ALREADY_BOOKED';
  end if;

  if private.occupied_places(v_target.id) + p_booking.party_size > v_target.capacity_adults then
    return 'EVENT_FULL';
  end if;

  if p_funding = 'card' then
    return private.move_card_code(p_booking.id, v_target.id);
  end if;

  if not private.event_accepts_product(
    v_target.id,
    (
      select (e.eligibility_snapshot ->> 'product_id')::uuid
      from public.entitlements e
      where e.id = (private.booking_funding(p_booking.id) ->> 'entitlement_id')::uuid
    )
  ) then
    return 'PRODUCT_NOT_VALID_FOR_EVENT';
  end if;

  if p_actor_kind = 'customer'
     and not (v_target.id = any (coalesce(p_candidates, '{}'::uuid[]))) then
    return 'MOVE_TARGET_NOT_ALLOWED';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Credit options (decision 2b): a session that does not accept the
-- credit's product (its source entitlement) is skipped, and an active option
-- that stops fitting is replaced by the next session, like a full one.
-- ---------------------------------------------------------------------------

create or replace function private.move_option_candidates(p_booking_id uuid)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_event public.events;
  v_funding jsonb;
  v_credit public.cancellation_credits;
  v_n integer;
  v_origin_event uuid;
  v_keep uuid[] := '{}'::uuid[];
  v_fill uuid[];
  v_counted integer := 0;
  v_option record;
  -- Story 3.18.
  v_product uuid;
begin
  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking.id is null then
    return '{}'::uuid[];
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_booking.event_id;

  v_funding := private.booking_funding(v_booking.id);

  select (e.eligibility_snapshot ->> 'product_id')::uuid into v_product
  from public.entitlements e
  where e.id = (v_funding ->> 'entitlement_id')::uuid;

  if v_funding ->> 'funding' = 'pinned' then
    select greatest(s.credit_options_count, 1) into v_n
    from public.business_settings s;

    select coalesce(array_agg(x.id order by x.starts_at, x.id), '{}'::uuid[])
    into v_keep
    from (
      select e.id, e.starts_at
      from public.events e
      where e.status = 'published'
        and e.kind = v_event.kind
        and e.starts_at > v_event.starts_at
        and now() < e.registration_closes_at
        and private.occupied_places(e.id) + v_booking.party_size <= e.capacity_adults
        and e.id <> v_event.id
        and private.event_accepts_product(e.id, v_product)
        and not exists (
          select 1
          from public.bookings b
          where b.customer_id = v_booking.customer_id
            and b.event_id = e.id
            and b.status = 'confirmed'
        )
      order by e.starts_at, e.id
      limit v_n
    ) x;

    return v_keep;
  end if;

  if v_funding ->> 'funding' is distinct from 'credit' then
    return '{}'::uuid[];
  end if;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = (v_funding ->> 'credit_id')::uuid;

  if v_credit.id is null then
    return '{}'::uuid[];
  end if;

  -- Rule (1), as after the cancel.
  for v_option in
    select
      o.state,
      e.id as event_id,
      e.status as event_status,
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults,
      o.added_by
    from public.credit_options o
    join public.events e on e.id = o.event_id
    where o.credit_id = v_credit.id
    order by e.starts_at, e.id
  loop
    if v_option.state = 'passed'
       or (v_option.state = 'used' and v_option.event_id <> v_event.id) then
      v_counted := v_counted + 1;
    elsif v_option.state = 'active'
       or (v_option.state = 'used' and v_option.event_id = v_event.id) then
      if v_option.event_status = 'cancelled'
         or (
           v_option.starts_at <= v_credit.origin_starts_at
           and v_option.added_by <> 'admin'
         ) then
        null;
      elsif exists (
        select 1
        from public.bookings b
        where b.customer_id = v_booking.customer_id
          and b.event_id = v_option.event_id
          and b.status = 'confirmed'
          and b.id <> v_booking.id
      ) then
        null;
      elsif v_option.event_status = 'completed'
         or now() >= v_option.registration_closes_at then
        v_counted := v_counted + 1;
      elsif not private.event_accepts_product(v_option.event_id, v_product) then
        null;
      elsif private.occupied_places(v_option.event_id)
            - (case when v_option.event_id = v_event.id then v_booking.party_size else 0 end)
            + v_credit.party_size > v_option.capacity_adults then
        null;
      else
        v_counted := v_counted + 1;
        v_keep := v_keep || v_option.event_id;
      end if;
    end if;
  end loop;

  select b.event_id into v_origin_event
  from public.bookings b
  where b.id = v_credit.origin_booking_id;

  -- Rule (2).
  if v_counted < v_credit.options_count then

    select coalesce(array_agg(x.id order by x.starts_at, x.id), '{}'::uuid[])
    into v_fill
    from (
      select e.id, e.starts_at
      from public.events e
      where e.status = 'published'
        and e.kind = v_credit.event_kind
        and e.starts_at > v_credit.origin_starts_at
        and now() < e.registration_closes_at
        and private.occupied_places(e.id) + v_credit.party_size <= e.capacity_adults
        and e.id is distinct from v_origin_event
        and private.event_accepts_product(e.id, v_product)
        and not exists (
          select 1
          from public.credit_options o
          where o.credit_id = v_credit.id
            and o.event_id = e.id
        )
        and not exists (
          select 1
          from public.bookings b
          where b.customer_id = v_booking.customer_id
            and b.event_id = e.id
            and b.status = 'confirmed'
            and b.id <> v_booking.id
        )
      order by e.starts_at, e.id
      limit v_credit.options_count - v_counted
    ) x;

    v_keep := v_keep || v_fill;
  end if;

  -- The credit's origin session, outside the N (book_core funds it from the
  -- credit; user decision 2026-10-18); never the booking's own session.
  -- Story 3.18: only when it accepts the credit's product.
  if v_origin_event is not null
     and not (v_origin_event = any (v_keep))
     and private.event_accepts_product(v_origin_event, v_product) then
    v_keep := v_keep || v_origin_event;
  end if;

  return array_remove(v_keep, v_event.id);
end;
$$;

create or replace function private.refresh_credit_options(
  p_credit_id uuid,
  p_fill boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_credit public.cancellation_credits;
  v_origin_event uuid;
  v_option record;
  v_counted integer;
  v_event_id uuid;
  -- Story 3.18.
  v_product uuid;
begin
  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_credit.id is null
     or v_credit.status <> 'active'
     or v_credit.choice_pending then
    return;
  end if;

  if exists (
    select 1
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where a.credit_id = v_credit.id
      and b.status = 'confirmed'
  ) then
    return;
  end if;

  select (e.eligibility_snapshot ->> 'product_id')::uuid into v_product
  from public.entitlements e
  where e.id = v_credit.source_entitlement_id;

  -- (1)
  for v_option in
    select
      o.id,
      e.status as event_status,
      e.starts_at,
      e.registration_closes_at,
      e.capacity_adults,
      e.id as event_id,
      o.added_by
    from public.credit_options o
    join public.events e on e.id = o.event_id
    where o.credit_id = v_credit.id
      and o.state = 'active'
    order by e.starts_at, e.id
    for update of o
  loop
    if v_option.event_status = 'cancelled' then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'event_cancelled'
      where id = v_option.id;
    elsif v_option.starts_at <= v_credit.origin_starts_at
          and v_option.added_by <> 'admin' then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'moved'
      where id = v_option.id;
    elsif v_credit.customer_id is not null and exists (
      select 1
      from public.bookings b
      where b.customer_id = v_credit.customer_id
        and b.event_id = v_option.event_id
        and b.status = 'confirmed'
    ) then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'booked'
      where id = v_option.id;
    elsif v_option.event_status = 'completed'
       or now() >= v_option.registration_closes_at then
      update public.credit_options
      set state = 'passed'
      where id = v_option.id;
    elsif private.occupied_places(v_option.event_id) + v_credit.party_size
          > v_option.capacity_adults
       -- Story 3.18: like a full one.
       or not private.event_accepts_product(v_option.event_id, v_product) then
      update public.credit_options
      set state = 'replaced', replaced_at = now(), replaced_reason = 'full'
      where id = v_option.id;
    end if;
  end loop;

  -- (2)
  if not coalesce(p_fill, true) then
    return;
  end if;

  select b.event_id into v_origin_event
  from public.bookings b
  where b.id = v_credit.origin_booking_id;

  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('active', 'used', 'passed');

  while v_counted < v_credit.options_count loop
    v_event_id := null;

    select e.id into v_event_id
    from public.events e
    where e.status = 'published'
      and e.kind = v_credit.event_kind
      and e.starts_at > v_credit.origin_starts_at
      and now() < e.registration_closes_at
      and private.occupied_places(e.id) + v_credit.party_size <= e.capacity_adults
      and e.id is distinct from v_origin_event
      and private.event_accepts_product(e.id, v_product)
      and not exists (
        select 1
        from public.credit_options o
        where o.credit_id = v_credit.id
          and o.event_id = e.id
      )
      and not exists (
        select 1
        from public.bookings b
        where b.customer_id = v_credit.customer_id
          and b.event_id = e.id
          and b.status = 'confirmed'
      )
    order by e.starts_at, e.id
    limit 1;

    exit when v_event_id is null;

    insert into public.credit_options (credit_id, event_id)
    values (v_credit.id, v_event_id);

    v_counted := v_counted + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The session RPCs: product_ids (array of distinct uuid strings, may be
-- empty) in create and update; duplicate copies the set.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_event(p_event jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_concept public.concepts;
  v_concept_text text;
  v_publish boolean := false;
  v_settings public.business_settings;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_event', p_idempotency_key, p_event
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_concept_text := p_event ->> 'concept_id';
  if jsonb_typeof(p_event -> 'concept_id') is distinct from 'string'
     or v_concept_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  if p_event ? 'publish' then
    if jsonb_typeof(p_event -> 'publish') <> 'boolean' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "publish"}';
    end if;
    v_publish := (p_event ->> 'publish')::boolean;
  end if;

  select c.* into v_concept
  from public.concepts c
  where c.id = v_concept_text::uuid
    and c.archived_at is null;

  if v_concept.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  select s.* into v_settings from public.business_settings s;

  v_row.concept_id := v_concept.id;
  v_row.kind := v_concept.default_kind;
  v_row.description := v_concept.description;
  v_row := private.apply_event_changes(
    v_row,
    p_event - 'concept_id' - 'publish' - 'product_ids',
    array['date', 'start_time', 'end_time', 'description',
          'capacity_adults', 'display_price_agorot', 'registration_closes_local']
  );
  if not (p_event ? 'capacity_adults') then
    v_row.capacity_adults := case v_row.kind
      when 'couple' then v_settings.default_capacity_couple
      else v_settings.default_capacity_regular
    end;
  end if;

  v_saved := private.save_event(v_row, true);

  if v_publish then
    update public.events
    set status = 'published'
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_create_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  -- Story 3.18: its own audit row when the set is not empty.
  if p_event ? 'product_ids' then
    perform private.save_event_products(
      v_saved, p_event -> 'product_ids', v_actor, 'admin_create_event'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_create_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id, 'status', v_saved.status)
  );
end;
$$;

create or replace function public.admin_update_event(
  p_event_id uuid,
  p_changes jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.events;
  v_row public.events;
  v_saved public.events;
  -- Story 5.6.
  v_free_before integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
  for update;

  if v_old.id is null or v_old.status in ('cancelled', 'completed') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;

  v_row := private.apply_event_changes(
    v_old,
    p_changes - 'product_ids',
    array['date', 'start_time', 'end_time', 'description',
          'capacity_adults', 'registration_closes_local', 'display_price_agorot']
  );

  if (
       v_row.starts_at is distinct from v_old.starts_at
       or v_row.ends_at is distinct from v_old.ends_at
       or v_row.kind is distinct from v_old.kind
     )
     and exists (
       select 1
       from public.bookings b
       where b.event_id = v_old.id
         and b.status = 'confirmed'
     ) then
    raise exception 'EVENT_HAS_BOOKINGS' using errcode = 'P0001';
  end if;

  -- Never below the places already taken: no silent overbooking (CAP-14).
  if v_row.capacity_adults is distinct from v_old.capacity_adults
     and v_row.capacity_adults < private.occupied_places(v_old.id) then
    raise exception 'CAPACITY_BELOW_BOOKED' using errcode = 'P0001';
  end if;

  -- Story 5.6: the free places before the save (AD-14).
  v_free_before := v_old.capacity_adults - private.occupied_places(v_old.id);

  if v_row is distinct from v_old then
    v_saved := private.save_event(v_row, false);

    if v_saved is distinct from v_old then
      perform private.audit(
        v_actor, 'admin', 'admin_update_event', 'events', v_saved.id,
        null, v_saved.id, to_jsonb(v_old), to_jsonb(v_saved)
      );
    end if;

    if v_saved.capacity_adults is distinct from v_old.capacity_adults then
      perform private.refresh_credits_for_event(v_old.id);
    end if;

    -- Story 5.6: a capacity raise may free a place for the waiters.
    if v_saved.capacity_adults > v_old.capacity_adults then
      perform private.notify_waitlist(v_old.id, v_free_before);
    end if;
  end if;

  -- Story 3.18: allowed with bookings, which stay as they are. A changed set
  -- has its own audit row, and the credit options on this session are
  -- checked again (one that stops fitting is replaced).
  if p_changes ? 'product_ids'
     and private.save_event_products(
       coalesce(v_saved, v_old), p_changes -> 'product_ids', v_actor, 'admin_update_event'
     ) then
    perform private.refresh_credits_for_event(v_old.id);
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;

create or replace function public.admin_duplicate_event(
  p_event_id uuid,
  p_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_source public.events;
  v_row public.events;
  v_saved public.events;
  -- Story 3.18.
  v_products jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'date', p_date,
      'start_time', p_start_time,
      'end_time', p_end_time
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select e.* into v_source
  from public.events e
  where e.id = p_event_id;

  if v_source.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;
  if p_date is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "date"}';
  elsif p_start_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "start_time"}';
  elsif p_end_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_row.concept_id := v_source.concept_id;
  v_row.kind := v_source.kind;
  v_row.description := v_source.description;
  v_row.capacity_adults := v_source.capacity_adults;
  v_row.display_price_agorot := v_source.display_price_agorot;
  v_row.starts_at := private.local_instant(p_date, p_start_time);
  v_row.ends_at := private.local_instant(p_date, p_end_time);
  if v_row.ends_at <= v_row.starts_at then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_saved := private.save_event(v_row, true);

  if v_source.image_id is not null then
    update public.events
    set image_id = v_source.image_id
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_duplicate_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  -- Story 3.18: the source's product set, with its own audit row.
  select coalesce(jsonb_agg(ep.product_id order by ep.product_id), '[]'::jsonb)
  into v_products
  from public.event_products ep
  where ep.event_id = v_source.id;

  perform private.save_event_products(
    v_saved, v_products, v_actor, 'admin_duplicate_event'
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants of the new helpers: none (called from definer functions).
-- ---------------------------------------------------------------------------

revoke execute on function private.event_accepts_product(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.save_event_products(public.events, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
