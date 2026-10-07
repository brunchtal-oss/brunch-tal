-- Story 4.10: the work sheet's shopping list, and the photo consent of the
-- registrants (CAP-38, CAP-40).
-- 1. public.shopping_items: one row per item of a sheet (sheet_id, on delete
--    cascade). Admin only: RLS select for admins, no write grant; every
--    write is an RPC here (AD-1, AD-5), in the pattern of 4.9: is_admin
--    first, the work_sheets row locked before any write, private.audit with
--    the event_id, and a call that changes nothing writes no audit row.
--    admin_add/update/delete_shopping_item take an idempotency key;
--    admin_set_shopping_item_bought (an absolute value) and
--    admin_set_shopping_item_order (ordering) are exempt (AD-5).
-- 2. admin_get_work_sheet (create or replace, same signature) also returns
--    shopping: [{id, body, quantity, bought}] by sort_order.
-- 3. admin_get_event_details (create or replace, same signature) also
--    returns photo_consent, only for an active customer (the same condition
--    as the name).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.work_sheets (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  -- Free text ("1 ק״ג", "8"), optional.
  quantity text check (quantity is null or char_length(btrim(quantity)) between 1 and 50),
  bought boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shopping_items_sheet_id_idx on public.shopping_items (sheet_id, sort_order);

alter table public.shopping_items enable row level security;

create policy shopping_items_authenticated_select on public.shopping_items
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.shopping_items from public, anon, authenticated, service_role;
grant select on table public.shopping_items to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An item's sheet, locked (AD-6: the parent is read without a lock, locked,
-- and the child read again). An unknown item -> NOT_FOUND.
create function private.lock_sheet_of_shopping_item(p_item_id uuid)
returns public.work_sheets
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_sheet_id uuid;
  v_sheet public.work_sheets;
begin
  select i.sheet_id into v_sheet_id from public.shopping_items i where i.id = p_item_id;
  if v_sheet_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_sheet := private.lock_work_sheet(v_sheet_id);
  if not exists (select 1 from public.shopping_items i where i.id = p_item_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_sheet;
end;
$$;

-- An item's quantity: null, or only whitespace -> null; else trimmed (the
-- same whitespace class as private.work_text) and at most 50 characters,
-- else INVALID_INPUT with detail.field = quantity.
create function private.shopping_quantity(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null then
    return null;
  end if;
  v_text := regexp_replace(
    p_value,
    '^[[:space:]\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[[:space:]\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  );
  if v_text = '' then
    return null;
  end if;
  if char_length(v_text) > 50 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "quantity"}';
  end if;
  return v_text;
end;
$$;

revoke execute on function private.lock_sheet_of_shopping_item(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.shopping_quantity(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The work sheet of a session (stories 4.9, 4.10). Volatile: the first read
-- makes the sheet (private.ensure_work_sheet); a read, so no idempotency key
-- (AD-5). An unknown session -> NOT_FOUND. Result:
-- {event: {id, concept_name, kind, status, starts_at, ends_at},
--  prep_days: [{offset, date}] (by offset),
--  addable_days: [{offset, date}] (the offsets of -6..0 not on the sheet, for
--   the add-day picker; dates from private.prep_day, AD-8),
--  dishes: [{id, name, tasks: [{id, day_offset, body, done}]}],
--  shopping: [{id, body, quantity, bought}]}
-- dishes by sort_order; tasks by day_offset, then sort_order; shopping by
-- sort_order (a bought item keeps its place).
create or replace function public.admin_get_work_sheet(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sheet public.work_sheets;
  v_event jsonb;
  v_starts_at timestamptz;
  v_days jsonb;
  v_addable jsonb;
  v_dishes jsonb;
  v_shopping jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);

  select
    jsonb_build_object(
      'id', e.id,
      'concept_name', c.name,
      'kind', e.kind,
      'status', e.status,
      'starts_at', e.starts_at,
      'ends_at', e.ends_at
    ),
    e.starts_at
  into v_event, v_starts_at
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_event_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('offset', d, 'date', private.prep_day(v_starts_at, d))
      order by d
    ),
    '[]'::jsonb
  )
  into v_days
  from unnest(v_sheet.prep_days) as d;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('offset', d, 'date', private.prep_day(v_starts_at, d))
      order by d
    ),
    '[]'::jsonb
  )
  into v_addable
  from generate_series(-6, 0) as d
  where not (d = any (v_sheet.prep_days::integer[]));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'name', w.name,
        'tasks', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'day_offset', t.day_offset,
                'body', t.body,
                'done', t.done
              )
              order by t.day_offset, t.sort_order, t.id
            )
            from public.work_tasks t
            where t.dish_id = w.id
          ),
          '[]'::jsonb
        )
      )
      order by w.sort_order, w.id
    ),
    '[]'::jsonb
  )
  into v_dishes
  from public.work_dishes w
  where w.sheet_id = v_sheet.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'body', i.body,
        'quantity', i.quantity,
        'bought', i.bought
      )
      order by i.sort_order, i.id
    ),
    '[]'::jsonb
  )
  into v_shopping
  from public.shopping_items i
  where i.sheet_id = v_sheet.id;

  return jsonb_build_object(
    'event', v_event,
    'prep_days', v_days,
    'addable_days', v_addable,
    'dishes', v_dishes,
    'shopping', v_shopping
  );
end;
$$;

-- The session page, the session-morning view and the work sheet (stories
-- 3.4, 4.10). Admin only; a read, so no idempotency key (AD-5). An unknown
-- id -> NOT_FOUND. Result:
-- {event: {id, concept_name, kind, status, starts_at, ends_at,
--   registration_closes_at, capacity_adults, occupied},
--  bookings: [{booking_id, party_size, booked_by, guest_details,
--   customer_id, pending_join, payer_label?, full_name?, phone_e164?,
--   dietary_notes?, photo_consent?, babies?: [{name, birth_date}]}]}
-- bookings: confirmed and completed (private.is_real_booking), by
-- confirmed_at and id. The customer's details (photo_consent too) only while
-- she is active (activated, not anonymized; as private.current_customer_id).
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

-- ---------------------------------------------------------------------------
-- Shopping items
-- ---------------------------------------------------------------------------

-- A new item at the end of the list. body: 1-200 characters
-- (private.work_text); quantity: optional, whitespace only -> null.
-- Result: {item_id}.
create function public.admin_add_shopping_item(
  p_event_id uuid,
  p_body text,
  p_quantity text,
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
  v_sheet public.work_sheets;
  v_body text;
  v_quantity text;
  v_item public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_shopping_item', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'body', p_body, 'quantity', p_quantity)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);
  v_body := private.work_text(p_body, 'body');
  v_quantity := private.shopping_quantity(p_quantity);

  insert into public.shopping_items (sheet_id, body, quantity, sort_order)
  values (
    v_sheet.id,
    v_body,
    v_quantity,
    coalesce(
      (select max(i.sort_order) from public.shopping_items i where i.sheet_id = v_sheet.id),
      0
    ) + 1
  )
  returning * into v_item;

  perform private.audit(
    v_actor, 'admin', 'admin_add_shopping_item', 'shopping_items', v_item.id,
    null, v_sheet.event_id, null, to_jsonb(v_item)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', v_item.id)
  );
end;
$$;

-- Changes an item's body and quantity; the same values change nothing.
-- The item keeps its place and its bought mark. Result: {item_id}.
create function public.admin_update_shopping_item(
  p_item_id uuid,
  p_body text,
  p_quantity text,
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
  v_sheet public.work_sheets;
  v_body text;
  v_quantity text;
  v_old public.shopping_items;
  v_new public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', p_item_id, 'body', p_body, 'quantity', p_quantity)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);
  v_body := private.work_text(p_body, 'body');
  v_quantity := private.shopping_quantity(p_quantity);

  select i.* into v_old from public.shopping_items i where i.id = p_item_id;

  if v_old.body = v_body and v_old.quantity is not distinct from v_quantity then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
      jsonb_build_object('item_id', v_old.id)
    );
  end if;

  update public.shopping_items
  set body = v_body, quantity = v_quantity, updated_at = now()
  where id = p_item_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_update_shopping_item', 'shopping_items', v_new.id,
    null, v_sheet.event_id, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', v_new.id)
  );
end;
$$;

-- Deletes an item; the audit before holds it. Result: {item_id}.
create function public.admin_delete_shopping_item(
  p_item_id uuid,
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
  v_sheet public.work_sheets;
  v_old public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', p_item_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);

  delete from public.shopping_items where id = p_item_id
  returning * into v_old;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_shopping_item', 'shopping_items', v_old.id,
    null, v_sheet.event_id, to_jsonb(v_old), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', v_old.id)
  );
end;
$$;

-- Marks an item bought or not bought: an absolute value, exempt from
-- idempotency (AD-5); the same value writes nothing. The item keeps its
-- place. Result: {item_id, bought}.
create function public.admin_set_shopping_item_bought(p_item_id uuid, p_bought boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old public.shopping_items;
  v_new public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_bought is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);

  select i.* into v_old from public.shopping_items i where i.id = p_item_id;
  if v_old.bought = p_bought then
    return jsonb_build_object('item_id', v_old.id, 'bought', v_old.bought);
  end if;

  update public.shopping_items
  set bought = p_bought, updated_at = now()
  where id = p_item_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_shopping_item_bought', 'shopping_items', v_new.id,
    null, v_sheet.event_id, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('item_id', v_new.id, 'bought', v_new.bought);
end;
$$;

-- The full list of the sheet's items in their new order (AD-5 ordering;
-- exempt from idempotency). The sheet is taken from the first id. A list
-- that is not exactly the sheet's items -> CONCURRENT_CHANGE; the same
-- order changes nothing. Result: {item_ids}.
create function public.admin_set_shopping_item_order(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  begin
    v_sheet := private.lock_sheet_of_shopping_item(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select coalesce(array_agg(i.id order by i.sort_order, i.id), '{}'::uuid[])
  into v_old
  from public.shopping_items i
  where i.sheet_id = v_sheet.id;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('item_ids', to_jsonb(p_ids));
  end if;

  update public.shopping_items i
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where i.id = o.id and i.sort_order is distinct from o.n::integer;

  perform private.audit(
    v_actor, 'admin', 'admin_set_shopping_item_order', 'work_sheets', v_sheet.id,
    null, v_sheet.event_id,
    jsonb_build_object('shopping_order', to_jsonb(v_old)),
    jsonb_build_object('shopping_order', to_jsonb(p_ids))
  );

  return jsonb_build_object('item_ids', to_jsonb(p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5). admin_get_work_sheet and admin_get_event_details
-- keep their grants (create or replace, same signatures); stated again.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_get_work_sheet(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_work_sheet(uuid) to authenticated;

revoke execute on function public.admin_get_event_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_event_details(uuid) to authenticated;

revoke execute on function public.admin_add_shopping_item(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_shopping_item(uuid, text, text, uuid) to authenticated;

revoke execute on function public.admin_update_shopping_item(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_shopping_item(uuid, text, text, uuid) to authenticated;

revoke execute on function public.admin_delete_shopping_item(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_shopping_item(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_shopping_item_bought(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_shopping_item_bought(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_shopping_item_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_shopping_item_order(uuid[]) to authenticated;
