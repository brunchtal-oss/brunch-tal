-- Story 2.6: the product catalog in the admin (CAP-3).
-- RPCs: admin_create_product, admin_update_product (every field but the
-- price, including active = hide / show), and the sensitive price change
-- (AD-7): private.plan_set_product_price, preview_admin_set_product_price,
-- admin_set_product_price. Editing a product applies to new purchases only:
-- entitlements and payments keep their snapshots (AD-15). No new column, no
-- delete, the approval core is unchanged. AD-5 grants and idempotency, AD-9
-- money in agorot, AD-19 audit (old and new values).

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- Applies a jsonb of field changes to a product row and returns the new row.
-- Keys outside the allowed fields (price_agorot is never one; active only
-- when p_allow_active), or a value of the wrong JSON type, raise
-- INVALID_INPUT with detail.field. Value rules: name and texts are trimmed,
-- an empty optional text is null; integers must be whole JSON numbers;
-- allowed_weekdays is null (every day) or an array of 0-6 (0 = Sunday),
-- deduplicated and sorted; all seven days become null; an empty array is
-- refused. Table checks (ranges, days <-> validity_days) are enforced by
-- private.save_product.
create function private.apply_product_changes(
  p_row public.products,
  p_changes jsonb,
  p_allow_active boolean
)
returns public.products
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row public.products := p_row;
  v_key text;
  v_value jsonb;
  v_type text;
  v_num numeric;
  v_days smallint[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    v_type := jsonb_typeof(v_value);

    if v_key not in (
      'name', 'type', 'units', 'validity_mode', 'validity_days',
      'allowed_weekdays', 'eligible_event_kind', 'party_size', 'intro_only',
      'post_join_message', 'post_join_button_label', 'active'
    ) or (v_key = 'active' and not p_allow_active) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;

    -- Integers: a whole JSON number in the integer range (validity_days may
    -- be null).
    if v_key in ('units', 'validity_days', 'party_size') and v_type <> 'null' then
      if v_type <> 'number' then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
      v_num := (v_value #>> '{}')::numeric;
      if v_num <> trunc(v_num) or v_num < -2147483648 or v_num > 2147483647 then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
    end if;

    -- Required strings and booleans.
    if (v_key in ('name', 'type', 'validity_mode', 'eligible_event_kind') and v_type <> 'string')
       or (v_key in ('intro_only', 'active') and v_type <> 'boolean')
       or (v_key in ('units', 'party_size') and v_type <> 'number')
       or (v_key in ('post_join_message', 'post_join_button_label')
           and v_type not in ('string', 'null'))
       or (v_key = 'allowed_weekdays' and v_type not in ('array', 'null')) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;

    case v_key
      when 'name' then
        v_row.name := btrim(v_value #>> '{}');
      when 'type' then
        v_row.type := v_value #>> '{}';
      when 'units' then
        v_row.units := (v_value #>> '{}')::integer;
      when 'validity_mode' then
        v_row.validity_mode := v_value #>> '{}';
      when 'validity_days' then
        v_row.validity_days := (v_value #>> '{}')::integer;
      when 'eligible_event_kind' then
        v_row.eligible_event_kind := v_value #>> '{}';
      when 'party_size' then
        if (v_value #>> '{}')::integer not between -32768 and 32767 then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        v_row.party_size := (v_value #>> '{}')::smallint;
      when 'intro_only' then
        v_row.intro_only := (v_value #>> '{}')::boolean;
      when 'active' then
        v_row.active := (v_value #>> '{}')::boolean;
      when 'post_join_message' then
        v_row.post_join_message := nullif(btrim(v_value #>> '{}'), '');
      when 'post_join_button_label' then
        v_row.post_join_button_label := nullif(btrim(v_value #>> '{}'), '');
      when 'allowed_weekdays' then
        if v_type = 'null' then
          v_row.allowed_weekdays := null;
        else
          if jsonb_array_length(v_value) = 0
             or exists (
               select 1
               from jsonb_array_elements(v_value) d
               where jsonb_typeof(d) <> 'number'
                  or (d #>> '{}') !~ '^[0-6]$'
             ) then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end if;
          select array_agg(distinct (d #>> '{}')::smallint order by (d #>> '{}')::smallint)
          into v_days
          from jsonb_array_elements(v_value) d;
          -- Every day of the week is "every day".
          v_row.allowed_weekdays := case when cardinality(v_days) = 7 then null else v_days end;
        end if;
    end case;
  end loop;

  return v_row;
end;
$$;

-- Inserts (p_insert) or updates a product row. A table check or a missing
-- required value becomes INVALID_INPUT with detail.field (the column; the
-- days <-> validity_days check is reported on validity_days).
create function private.save_product(p_row public.products, p_insert boolean)
returns public.products
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_saved public.products;
  v_constraint text;
  v_column text;
  v_field text;
begin
  begin
    if p_insert then
      insert into public.products (
        name, type, price_agorot, units, validity_mode, validity_days,
        allowed_weekdays, eligible_event_kind, party_size, intro_only,
        post_join_message, post_join_button_label, active
      )
      values (
        p_row.name, p_row.type, p_row.price_agorot, p_row.units,
        p_row.validity_mode, p_row.validity_days, p_row.allowed_weekdays,
        p_row.eligible_event_kind, p_row.party_size,
        coalesce(p_row.intro_only, false), p_row.post_join_message,
        p_row.post_join_button_label, coalesce(p_row.active, true)
      )
      returning * into v_saved;
    else
      update public.products
      set name = p_row.name,
          type = p_row.type,
          price_agorot = p_row.price_agorot,
          units = p_row.units,
          validity_mode = p_row.validity_mode,
          validity_days = p_row.validity_days,
          allowed_weekdays = p_row.allowed_weekdays,
          eligible_event_kind = p_row.eligible_event_kind,
          party_size = p_row.party_size,
          intro_only = p_row.intro_only,
          post_join_message = p_row.post_join_message,
          post_join_button_label = p_row.post_join_button_label,
          active = p_row.active
      where id = p_row.id
      returning * into v_saved;
    end if;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        v_constraint = constraint_name,
        v_column = column_name;
      v_field := coalesce(
        nullif(v_column, ''),
        substring(v_constraint from '^products_(.*)_check$')
      );
      if v_field = 'validity_mode_days' then
        v_field := 'validity_days';
      end if;
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_field)::text;
  end;

  return v_saved;
end;
$$;

-- One plan for the preview and the change (AD-7). An unknown product, a
-- missing or negative price, or the current price raise INVALID_INPUT.
create function private.plan_set_product_price(p_product_id uuid, p_price_agorot integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select p.* into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null
     or p_price_agorot is null
     or p_price_agorot < 0
     or p_price_agorot = v_product.price_agorot then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "price_agorot"}';
  end if;

  return jsonb_build_object(
    'product_id', v_product.id,
    'name', v_product.name,
    'old_price_agorot', v_product.price_agorot,
    'new_price_agorot', p_price_agorot
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Tal adds a product. p_product holds every field but active (a new product
-- is offered): name, type, price_agorot, units, validity_mode,
-- validity_days, allowed_weekdays, eligible_event_kind, party_size,
-- intro_only, post_join_message, post_join_button_label. A days product
-- without validity_days gets business_settings.default_validity_days.
-- Result: {product_id}.
create function public.admin_create_product(p_product jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_row public.products;
  v_price jsonb;
  v_num numeric;
  v_saved public.products;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_product', p_idempotency_key, p_product
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The price is set here; every other field through the shared rules.
  v_price := p_product -> 'price_agorot';
  if v_price is null or jsonb_typeof(v_price) <> 'number' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "price_agorot"}';
  end if;
  v_num := (v_price #>> '{}')::numeric;
  if v_num <> trunc(v_num) or v_num < 0 or v_num > 2147483647 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "price_agorot"}';
  end if;

  v_row.intro_only := false;
  v_row.active := true;
  v_row := private.apply_product_changes(v_row, p_product - 'price_agorot', false);
  v_row.price_agorot := v_num::integer;

  if v_row.validity_mode = 'days' and v_row.validity_days is null then
    select s.default_validity_days into v_row.validity_days
    from public.business_settings s;
  end if;

  v_saved := private.save_product(v_row, true);

  perform private.audit(
    v_actor, 'admin', 'admin_create_product', 'products', v_saved.id,
    null, null, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_product', p_idempotency_key,
    jsonb_build_object('product_id', v_saved.id)
  );
end;
$$;

-- Tal changes fields of a product (not the price: admin_set_product_price).
-- p_changes: a non-empty subset of name, type, units, validity_mode,
-- validity_days, allowed_weekdays, eligible_event_kind, party_size,
-- intro_only, post_join_message, post_join_button_label, active (false =
-- hidden: not offered in "add payment", the approval refuses it with
-- PRODUCT_NOT_AVAILABLE, past payments keep their snapshot). Locks the row;
-- the audit row (admin_update_product) holds the old and new values. A change
-- that leaves the row as it was writes nothing. Result: {product_id}.
create function public.admin_update_product(
  p_product_id uuid,
  p_changes jsonb,
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
  v_old public.products;
  v_row public.products;
  v_saved public.products;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_product', p_idempotency_key,
    jsonb_build_object('product_id', p_product_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.products p
  where p.id = p_product_id
  for update;

  if v_old.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_row := private.apply_product_changes(v_old, p_changes, true);

  if v_row is distinct from v_old then
    v_saved := private.save_product(v_row, false);

    perform private.audit(
      v_actor, 'admin', 'admin_update_product', 'products', v_saved.id,
      null, null, to_jsonb(v_old), to_jsonb(v_saved)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_product', p_idempotency_key,
    jsonb_build_object('product_id', v_old.id)
  );
end;
$$;

-- What the price change will do, shown in the sensitive dialog. Same
-- permission and grant as the change (AD-7).
create function public.preview_admin_set_product_price(
  p_product_id uuid,
  p_price_agorot integer
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

  return private.plan_set_product_price(p_product_id, p_price_agorot);
end;
$$;

-- Tal changes a product's catalog price (sensitive, AD-7): without
-- p_confirmed CONFIRM_REQUIRED and nothing changes. The reason is optional;
-- the audit row (admin_set_product_price) holds the old and new price and the
-- reason. New purchases only: payments and entitlements keep their
-- snapshots. Result: {product_id, name, old_price_agorot, new_price_agorot}.
create function public.admin_set_product_price(
  p_product_id uuid,
  p_price_agorot integer,
  p_reason text,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.products;
  v_plan jsonb;
  v_saved public.products;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_set_product_price', p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'price_agorot', p_price_agorot,
      'reason', v_reason,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  select p.* into v_old
  from public.products p
  where p.id = p_product_id
  for update;

  v_plan := private.plan_set_product_price(p_product_id, p_price_agorot);

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.products
  set price_agorot = p_price_agorot
  where id = v_old.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_set_product_price', 'products', v_saved.id,
    null, null, to_jsonb(v_old), to_jsonb(v_saved), v_reason
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_set_product_price', p_idempotency_key, v_plan
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer RPCs (as owner).
revoke execute on function private.apply_product_changes(public.products, jsonb, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.save_product(public.products, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.plan_set_product_price(uuid, integer) from public, anon, authenticated, service_role;

revoke execute on function public.admin_create_product(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_product(jsonb, uuid) to authenticated;

revoke execute on function public.admin_update_product(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_product(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.preview_admin_set_product_price(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_set_product_price(uuid, integer) to authenticated;

revoke execute on function public.admin_set_product_price(uuid, integer, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_product_price(uuid, integer, text, boolean, uuid) to authenticated;
