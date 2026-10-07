-- Story 4.10, round 2 (the user's phone check, 2026-10-07; changes the prep
-- days of story 4.9 and the shopping add of round 1):
-- 1. work_sheets.base_days: the default prep days copied when the sheet was
--    made (private.ensure_work_sheet). Existing sheets: their prep days that
--    are in the current setting, else {0}. A base day cannot be removed or
--    moved; only an added day (on the sheet, not in base_days) can.
-- 2. admin_get_work_sheet (create or replace, same signature): every prep day
--    carries added: boolean.
-- 3. admin_remove_prep_day (create or replace, same signature): a base day
--    -> INVALID_INPUT.
-- 4. admin_move_prep_day (new): moves an added day to a free day of -6..0,
--    its tasks with it, in one transaction (lock, audit before/after,
--    idempotency).
-- 5. admin_add_shopping_items (new): several items at the end of the list in
--    one call (one per line on the screen, up to 100). It replaces
--    admin_add_shopping_item, which is dropped.
-- Has a drop: the user runs it in the SQL Editor (AGENTS.md).

-- ---------------------------------------------------------------------------
-- work_sheets.base_days
-- ---------------------------------------------------------------------------

alter table public.work_sheets add column base_days smallint[];

update public.work_sheets s
set base_days = coalesce(
  nullif(
    array(
      select d
      from unnest(s.prep_days) as d
      where d = any (
        coalesce((select bs.default_prep_days from public.business_settings bs limit 1), '{}'::smallint[])
      )
      order by d
    ),
    '{}'::smallint[]
  ),
  array[0]::smallint[]
);

alter table public.work_sheets alter column base_days set not null;
alter table public.work_sheets
  add constraint work_sheets_base_days_check check (private.valid_prep_days(base_days));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The only creator of a work_sheets row (AD-16): on the first call for a
-- session it copies default_prep_days (distinct, sorted, within -6..0; the
-- session day alone if nothing is left) to prep_days and to base_days.
-- Returns the row, not locked. An unknown session -> NOT_FOUND.
create or replace function private.ensure_work_sheet(p_event_id uuid)
returns public.work_sheets
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_days smallint[];
  v_sheet public.work_sheets;
begin
  if p_event_id is null
     or not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select s.* into v_sheet from public.work_sheets s where s.event_id = p_event_id;
  if v_sheet.id is not null then
    return v_sheet;
  end if;

  select coalesce(
    array(
      select distinct d
      from public.business_settings s, unnest(s.default_prep_days) as d
      where d between -6 and 0
      order by d
    ),
    '{}'::smallint[]
  )
  into v_days;
  if cardinality(v_days) = 0 then
    v_days := array[0]::smallint[];
  end if;

  insert into public.work_sheets (event_id, prep_days, base_days)
  values (p_event_id, v_days, v_days)
  on conflict (event_id) do nothing;

  select s.* into v_sheet from public.work_sheets s where s.event_id = p_event_id;
  return v_sheet;
end;
$$;

revoke execute on function private.ensure_work_sheet(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The work sheet of a session (stories 4.9, 4.10). Volatile: the first read
-- makes the sheet (private.ensure_work_sheet); a read, so no idempotency key
-- (AD-5). An unknown session -> NOT_FOUND. Result:
-- {event: {id, concept_name, kind, status, starts_at, ends_at},
--  prep_days: [{offset, date, added}] (by offset; added: not one of the
--   sheet's base_days, so it can be removed or moved),
--  addable_days: [{offset, date}] (the offsets of -6..0 not on the sheet, for
--   adding and moving a day; dates from private.prep_day, AD-8),
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
      jsonb_build_object(
        'offset', d,
        'date', private.prep_day(v_starts_at, d),
        'added', not (d = any (v_sheet.base_days))
      )
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

-- ---------------------------------------------------------------------------
-- Prep days
-- ---------------------------------------------------------------------------

-- Removes an added prep day from this session's sheet with its tasks; the
-- audit before holds the deleted tasks. A base day (one of base_days) ->
-- INVALID_INPUT; so does the last day. A day that is not on the sheet
-- changes nothing. Result: {prep_days, deleted_tasks}.
create or replace function public.admin_remove_prep_day(
  p_event_id uuid,
  p_day_offset integer,
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
  v_new public.work_sheets;
  v_tasks jsonb;
  v_deleted integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'day_offset', p_day_offset)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_day_offset is null or p_day_offset not between -6 and 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  if not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    return private.idempotent_finish(
      v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days), 'deleted_tasks', 0)
    );
  end if;

  if p_day_offset = any (v_sheet.base_days::integer[])
     or cardinality(v_sheet.prep_days) = 1 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  with deleted as (
    delete from public.work_tasks t
    using public.work_dishes d
    where d.id = t.dish_id
      and d.sheet_id = v_sheet.id
      and t.day_offset = p_day_offset
    returning t.id, t.dish_id, t.day_offset, t.body, t.done
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'dish_id', x.dish_id, 'day_offset', x.day_offset,
          'body', x.body, 'done', x.done
        )
        order by x.dish_id, x.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_tasks, v_deleted
  from deleted x;

  update public.work_sheets s
  set prep_days = array_remove(s.prep_days, p_day_offset::smallint),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_remove_prep_day', 'work_sheets', v_new.id,
    null, v_new.event_id,
    to_jsonb(v_sheet) || jsonb_build_object('deleted_tasks', v_tasks),
    to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days), 'deleted_tasks', v_deleted)
  );
end;
$$;

-- Moves an added prep day (on the sheet, not one of base_days) to a free
-- day of -6..0 (not on the sheet); its tasks move with it and keep their
-- order. A base day, a day not on the sheet, a taken or out-of-range target
-- -> INVALID_INPUT (detail.field from / to). The same day changes nothing.
-- The audit before holds the moved tasks. Result: {prep_days, moved_tasks}.
create function public.admin_move_prep_day(
  p_event_id uuid,
  p_from integer,
  p_to integer,
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
  v_new public.work_sheets;
  v_tasks jsonb;
  v_moved integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_move_prep_day', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'from', p_from, 'to', p_to)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_from is null or p_from not between -6 and 0
     or not (p_from = any (v_sheet.prep_days::integer[]))
     or p_from = any (v_sheet.base_days::integer[]) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "from"}';
  end if;

  if p_to is null or p_to not between -6 and 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "to"}';
  end if;

  if p_to = p_from then
    return private.idempotent_finish(
      v_actor::text, 'admin_move_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days), 'moved_tasks', 0)
    );
  end if;

  if p_to = any (v_sheet.prep_days::integer[]) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "to"}';
  end if;

  with moved as (
    update public.work_tasks t
    set day_offset = p_to::smallint, updated_at = now()
    from public.work_dishes d
    where d.id = t.dish_id
      and d.sheet_id = v_sheet.id
      and t.day_offset = p_from
    returning t.id, t.dish_id, t.body, t.done
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'dish_id', x.dish_id, 'day_offset', p_from,
          'body', x.body, 'done', x.done
        )
        order by x.dish_id, x.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_tasks, v_moved
  from moved x;

  update public.work_sheets s
  set prep_days = array(
        select d
        from unnest(array_remove(s.prep_days, p_from::smallint) || p_to::smallint) as d
        order by d
      ),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_move_prep_day', 'work_sheets', v_new.id,
    null, v_new.event_id,
    to_jsonb(v_sheet) || jsonb_build_object('moved_tasks', v_tasks),
    to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_move_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days), 'moved_tasks', v_moved)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Shopping items
-- ---------------------------------------------------------------------------

-- New items at the end of the list, in the given order (one per line on the
-- screen; the screen leaves out empty lines). 1 to 100 items, each 1-200
-- characters (private.work_text); otherwise INVALID_INPUT and no item is
-- added. No quantity (a new item has none). Result: {item_ids}.
create function public.admin_add_shopping_items(
  p_event_id uuid,
  p_bodies text[],
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
  v_bodies text[] := '{}';
  v_body text;
  v_next integer;
  v_item public.shopping_items;
  v_ids uuid[] := '{}';
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_shopping_items', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'bodies', to_jsonb(p_bodies))
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_bodies is null or coalesce(array_length(p_bodies, 1), 0) not between 1 and 100
     or array_ndims(p_bodies) <> 1 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "bodies"}';
  end if;

  -- Every line is checked before anything is added.
  foreach v_body in array p_bodies loop
    v_bodies := v_bodies || private.work_text(v_body, 'bodies');
  end loop;

  select coalesce(max(i.sort_order), 0)
  into v_next
  from public.shopping_items i
  where i.sheet_id = v_sheet.id;

  foreach v_body in array v_bodies loop
    v_next := v_next + 1;
    insert into public.shopping_items (sheet_id, body, quantity, sort_order)
    values (v_sheet.id, v_body, null, v_next)
    returning * into v_item;

    perform private.audit(
      v_actor, 'admin', 'admin_add_shopping_items', 'shopping_items', v_item.id,
      null, v_sheet.event_id, null, to_jsonb(v_item)
    );
    v_ids := v_ids || v_item.id;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_shopping_items', p_idempotency_key,
    jsonb_build_object('item_ids', to_jsonb(v_ids))
  );
end;
$$;

-- Replaced by admin_add_shopping_items (round 2: no quantity on adding).
drop function public.admin_add_shopping_item(uuid, text, text, uuid);

-- ---------------------------------------------------------------------------
-- Function grants (AD-5). admin_get_work_sheet and admin_remove_prep_day
-- keep their grants (create or replace, same signatures); stated again.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_get_work_sheet(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_work_sheet(uuid) to authenticated;

revoke execute on function public.admin_remove_prep_day(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_prep_day(uuid, integer, uuid) to authenticated;

revoke execute on function public.admin_move_prep_day(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_move_prep_day(uuid, integer, integer, uuid) to authenticated;

revoke execute on function public.admin_add_shopping_items(uuid, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_shopping_items(uuid, text[], uuid) to authenticated;
