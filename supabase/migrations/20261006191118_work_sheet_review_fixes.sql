-- Story 4.9, review fixes (create or replace only; same signatures, so the
-- grants of 20261006184223_work_sheet stay):
-- 1. private.work_text trims every whitespace (tabs, newlines, no-break and
--    other Unicode spaces), not only the space, before the 1-200 check.
-- 2. admin_delete_work_dish and admin_remove_prep_day put the deleted tasks
--    (id, day_offset, body, done; with dish_id for a removed day) in the
--    audit before.
-- 3. A call that changes nothing (the same order, the same name, the same
--    body and day) returns its result without an update or an audit row.

-- The whitespace class: [:space:] plus U+00A0, U+2000-U+200B, U+2028,
-- U+2029, U+202F, U+205F, U+3000 and U+FEFF (escapes, never the characters).
create or replace function private.work_text(p_value text, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  v_text := regexp_replace(
    coalesce(p_value, ''),
    '^[[:space:]\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[[:space:]\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  );
  if p_value is null or char_length(v_text) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', p_field)::text;
  end if;
  return v_text;
end;
$$;

-- Renames a dish; the same name changes nothing. Result: {dish_id}.
create or replace function public.admin_update_work_dish(
  p_dish_id uuid,
  p_name text,
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
  v_name text;
  v_old public.work_dishes;
  v_new public.work_dishes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id, 'name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);
  v_name := private.work_text(p_name, 'name');

  select d.* into v_old from public.work_dishes d where d.id = p_dish_id;

  if v_old.name = v_name then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_work_dish', p_idempotency_key,
      jsonb_build_object('dish_id', v_old.id)
    );
  end if;

  update public.work_dishes
  set name = v_name, updated_at = now()
  where id = p_dish_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_update_work_dish', 'work_dishes', v_new.id,
    null, v_sheet.event_id, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_update_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_new.id)
  );
end;
$$;

-- Deletes a dish and its tasks; the audit before holds the dish and its
-- tasks. Result: {dish_id}.
create or replace function public.admin_delete_work_dish(
  p_dish_id uuid,
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
  v_old public.work_dishes;
  v_tasks jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);

  select d.* into v_old from public.work_dishes d where d.id = p_dish_id;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'day_offset', t.day_offset, 'body', t.body, 'done', t.done
      )
      order by t.day_offset, t.sort_order, t.id
    ),
    '[]'::jsonb
  )
  into v_tasks
  from public.work_tasks t
  where t.dish_id = p_dish_id;

  delete from public.work_dishes where id = p_dish_id;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_work_dish', 'work_dishes', v_old.id,
    null, v_sheet.event_id,
    to_jsonb(v_old) || jsonb_build_object('tasks', v_tasks), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_old.id)
  );
end;
$$;

-- The full list of the sheet's dishes in their new order. The same order
-- changes nothing. Result: {dish_ids}.
create or replace function public.admin_set_work_dish_order(p_ids uuid[])
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
    v_sheet := private.lock_sheet_of_dish(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select coalesce(array_agg(d.id order by d.sort_order, d.id), '{}'::uuid[])
  into v_old
  from public.work_dishes d
  where d.sheet_id = v_sheet.id;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('dish_ids', to_jsonb(p_ids));
  end if;

  update public.work_dishes d
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where d.id = o.id and d.sort_order is distinct from o.n::integer;

  perform private.audit(
    v_actor, 'admin', 'admin_set_work_dish_order', 'work_sheets', v_sheet.id,
    null, v_sheet.event_id,
    jsonb_build_object('dish_order', to_jsonb(v_old)),
    jsonb_build_object('dish_order', to_jsonb(p_ids))
  );

  return jsonb_build_object('dish_ids', to_jsonb(p_ids));
end;
$$;

-- Changes a task's body and day; the same body and day change nothing. A
-- task that moves to another day goes to the end of that day. Result:
-- {task_id}.
create or replace function public.admin_update_work_task(
  p_task_id uuid,
  p_body text,
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
  v_body text;
  v_old public.work_tasks;
  v_new public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_work_task', p_idempotency_key,
    jsonb_build_object('task_id', p_task_id, 'body', p_body, 'day_offset', p_day_offset)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);
  v_body := private.work_text(p_body, 'body');
  if p_day_offset is null or not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  select t.* into v_old from public.work_tasks t where t.id = p_task_id;

  if v_old.body = v_body and v_old.day_offset = p_day_offset then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_work_task', p_idempotency_key,
      jsonb_build_object('task_id', v_old.id)
    );
  end if;

  update public.work_tasks t
  set body = v_body,
      day_offset = p_day_offset,
      sort_order = case
        when t.day_offset = p_day_offset then t.sort_order
        else coalesce(
          (select max(o.sort_order) from public.work_tasks o
           where o.dish_id = t.dish_id and o.day_offset = p_day_offset),
          0
        ) + 1
      end,
      updated_at = now()
  where t.id = p_task_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_update_work_task', 'work_tasks', v_new.id,
    null, v_sheet.event_id, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_update_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_new.id)
  );
end;
$$;

-- The full list of one dish's tasks of one day in their new order. The
-- same order changes nothing. Result: {task_ids}.
create or replace function public.admin_set_work_task_order(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_first public.work_tasks;
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
    v_sheet := private.lock_sheet_of_task(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select t.* into v_first from public.work_tasks t where t.id = p_ids[1];

  select coalesce(array_agg(t.id order by t.sort_order, t.id), '{}'::uuid[])
  into v_old
  from public.work_tasks t
  where t.dish_id = v_first.dish_id and t.day_offset = v_first.day_offset;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('task_ids', to_jsonb(p_ids));
  end if;

  update public.work_tasks t
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where t.id = o.id and t.sort_order is distinct from o.n::integer;

  perform private.audit(
    v_actor, 'admin', 'admin_set_work_task_order', 'work_dishes', v_first.dish_id,
    null, v_sheet.event_id,
    jsonb_build_object('day_offset', v_first.day_offset, 'task_order', to_jsonb(v_old)),
    jsonb_build_object('day_offset', v_first.day_offset, 'task_order', to_jsonb(p_ids))
  );

  return jsonb_build_object('task_ids', to_jsonb(p_ids));
end;
$$;

-- Removes a prep day from this session's sheet with its tasks; the audit
-- before holds the deleted tasks. Result: {prep_days, deleted_tasks}.
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

  if cardinality(v_sheet.prep_days) = 1 then
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
