-- Story 4.9: the work sheet of a session (CAP-38): dishes, tasks and prep
-- days. Admin only: RLS select for admins, no write grant; every write is an
-- RPC here (AD-1, AD-5). The work_sheets row of a session is made only by
-- private.ensure_work_sheet, which copies business_settings.default_prep_days
-- once (AD-16); a later change of the setting does not touch a sheet.
-- prep_days and day_offset are days relative to the session day (-1 = the
-- day before, 0 = the session day); the dates come from private.prep_day
-- (AD-8). Every write locks the work_sheets row first (for update).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A valid prep-day list: 1 to 7 distinct offsets between -6 and 0, no null,
-- sorted ascending (the columns' order).
create function private.valid_prep_days(p_days smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_days is not null
    and cardinality(p_days) between 1 and 7
    and array_position(p_days, null) is null
    and p_days <@ array[-6, -5, -4, -3, -2, -1, 0]::smallint[]
    and p_days = array(select distinct d from unnest(p_days) as d order by d);
$$;

create table public.work_sheets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events (id) on delete cascade,
  prep_days smallint[] not null check (private.valid_prep_days(prep_days)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_dishes (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.work_sheets (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.work_dishes (id) on delete cascade,
  day_offset smallint not null check (day_offset between -6 and 0),
  body text not null check (char_length(btrim(body)) between 1 and 200),
  done boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- work_sheets.event_id is indexed by its unique constraint.
create index work_dishes_sheet_id_idx on public.work_dishes (sheet_id, sort_order);
create index work_tasks_dish_id_idx on public.work_tasks (dish_id, day_offset, sort_order);

alter table public.work_sheets enable row level security;
alter table public.work_dishes enable row level security;
alter table public.work_tasks enable row level security;

create policy work_sheets_authenticated_select on public.work_sheets
  for select to authenticated
  using ((select private.is_admin()));

create policy work_dishes_authenticated_select on public.work_dishes
  for select to authenticated
  using ((select private.is_admin()));

create policy work_tasks_authenticated_select on public.work_tasks
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.work_sheets from public, anon, authenticated, service_role;
revoke all on table public.work_dishes from public, anon, authenticated, service_role;
revoke all on table public.work_tasks from public, anon, authenticated, service_role;
grant select on table public.work_sheets to authenticated;
grant select on table public.work_dishes to authenticated;
grant select on table public.work_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The only creator of a work_sheets row (AD-16): on the first call for a
-- session it copies default_prep_days (distinct, sorted, within -6..0; the
-- session day alone if nothing is left). Returns the row, not locked. An
-- unknown session -> NOT_FOUND.
create function private.ensure_work_sheet(p_event_id uuid)
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

  insert into public.work_sheets (event_id, prep_days)
  values (p_event_id, v_days)
  on conflict (event_id) do nothing;

  select s.* into v_sheet from public.work_sheets s where s.event_id = p_event_id;
  return v_sheet;
end;
$$;

-- Locks a sheet (for update) and returns it.
create function private.lock_work_sheet(p_sheet_id uuid)
returns public.work_sheets
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_sheet public.work_sheets;
begin
  select s.* into v_sheet from public.work_sheets s where s.id = p_sheet_id for update;
  if v_sheet.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_sheet;
end;
$$;

-- A dish's sheet, locked (AD-6: the parent is read without a lock, locked,
-- and the child read again). An unknown dish -> NOT_FOUND.
create function private.lock_sheet_of_dish(p_dish_id uuid)
returns public.work_sheets
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_sheet_id uuid;
  v_sheet public.work_sheets;
begin
  select d.sheet_id into v_sheet_id from public.work_dishes d where d.id = p_dish_id;
  if v_sheet_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_sheet := private.lock_work_sheet(v_sheet_id);
  if not exists (select 1 from public.work_dishes d where d.id = p_dish_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_sheet;
end;
$$;

-- A task's sheet, locked, as private.lock_sheet_of_dish.
create function private.lock_sheet_of_task(p_task_id uuid)
returns public.work_sheets
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_sheet_id uuid;
  v_sheet public.work_sheets;
begin
  select d.sheet_id into v_sheet_id
  from public.work_tasks t
  join public.work_dishes d on d.id = t.dish_id
  where t.id = p_task_id;
  if v_sheet_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_sheet := private.lock_work_sheet(v_sheet_id);
  if not exists (select 1 from public.work_tasks t where t.id = p_task_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_sheet;
end;
$$;

-- A dish name or task body: trimmed, 1 to 200 characters, else
-- INVALID_INPUT with detail.field.
create function private.work_text(p_value text, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or char_length(btrim(p_value)) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', p_field)::text;
  end if;
  return btrim(p_value);
end;
$$;

revoke execute on function private.valid_prep_days(smallint[]) from public, anon, authenticated, service_role;
revoke execute on function private.ensure_work_sheet(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.lock_work_sheet(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.lock_sheet_of_dish(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.lock_sheet_of_task(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.work_text(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The work sheet of a session (story 4.9). Volatile: the first read makes the
-- sheet (private.ensure_work_sheet); a read, so no idempotency key (AD-5).
-- An unknown session -> NOT_FOUND. Result:
-- {event: {id, concept_name, kind, status, starts_at, ends_at},
--  prep_days: [{offset, date}] (by offset),
--  addable_days: [{offset, date}] (the offsets of -6..0 not on the sheet, for
--   the add-day picker; dates from private.prep_day, AD-8),
--  dishes: [{id, name, tasks: [{id, day_offset, body, done}]}]}
-- dishes by sort_order; tasks by day_offset, then sort_order.
create function public.admin_get_work_sheet(p_event_id uuid)
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

  return jsonb_build_object(
    'event', v_event,
    'prep_days', v_days,
    'addable_days', v_addable,
    'dishes', v_dishes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dishes
-- ---------------------------------------------------------------------------

-- A new dish at the end of the sheet. Result: {dish_id}.
create function public.admin_add_work_dish(
  p_event_id uuid,
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
  v_dish public.work_dishes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_work_dish', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);
  v_name := private.work_text(p_name, 'name');

  insert into public.work_dishes (sheet_id, name, sort_order)
  values (
    v_sheet.id,
    v_name,
    coalesce(
      (select max(d.sort_order) from public.work_dishes d where d.sheet_id = v_sheet.id),
      0
    ) + 1
  )
  returning * into v_dish;

  perform private.audit(
    v_actor, 'admin', 'admin_add_work_dish', 'work_dishes', v_dish.id,
    null, v_sheet.event_id, null, to_jsonb(v_dish)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_dish.id)
  );
end;
$$;

-- Renames a dish. Result: {dish_id}.
create function public.admin_update_work_dish(
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

-- Deletes a dish and its tasks. Result: {dish_id}.
create function public.admin_delete_work_dish(
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
  v_tasks integer;
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
  select count(*)::integer into v_tasks from public.work_tasks t where t.dish_id = p_dish_id;

  delete from public.work_dishes where id = p_dish_id;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_work_dish', 'work_dishes', v_old.id,
    null, v_sheet.event_id,
    to_jsonb(v_old) || jsonb_build_object('task_count', v_tasks), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_old.id)
  );
end;
$$;

-- The full list of the sheet's dishes in their new order (AD-5 ordering;
-- exempt from idempotency). The sheet is taken from the first id. A list
-- that is not exactly the sheet's dishes -> CONCURRENT_CHANGE. Result:
-- {dish_ids}.
create function public.admin_set_work_dish_order(p_ids uuid[])
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

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

-- A new task at the end of its dish's day. The day must be one of the
-- sheet's prep_days, else INVALID_INPUT (detail.field = day_offset).
-- Result: {task_id}.
create function public.admin_add_work_task(
  p_dish_id uuid,
  p_day_offset integer,
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
  v_sheet public.work_sheets;
  v_body text;
  v_task public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_work_task', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id, 'day_offset', p_day_offset, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);
  v_body := private.work_text(p_body, 'body');
  if p_day_offset is null or not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  insert into public.work_tasks (dish_id, day_offset, body, sort_order)
  values (
    p_dish_id,
    p_day_offset,
    v_body,
    coalesce(
      (select max(t.sort_order) from public.work_tasks t
       where t.dish_id = p_dish_id and t.day_offset = p_day_offset),
      0
    ) + 1
  )
  returning * into v_task;

  perform private.audit(
    v_actor, 'admin', 'admin_add_work_task', 'work_tasks', v_task.id,
    null, v_sheet.event_id, null, to_jsonb(v_task)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_task.id)
  );
end;
$$;

-- Changes a task's body and day. A task that moves to another day goes to
-- the end of that day. The day must be one of the sheet's prep_days.
-- Result: {task_id}.
create function public.admin_update_work_task(
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

-- Deletes a task. Result: {task_id}.
create function public.admin_delete_work_task(
  p_task_id uuid,
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
  v_old public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_work_task', p_idempotency_key,
    jsonb_build_object('task_id', p_task_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);

  delete from public.work_tasks where id = p_task_id
  returning * into v_old;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_work_task', 'work_tasks', v_old.id,
    null, v_sheet.event_id, to_jsonb(v_old), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_old.id)
  );
end;
$$;

-- Marks a task done or not done: an absolute value, exempt from
-- idempotency (AD-5). Result: {task_id, done}.
create function public.admin_set_work_task_done(p_task_id uuid, p_done boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old public.work_tasks;
  v_new public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);

  select t.* into v_old from public.work_tasks t where t.id = p_task_id;
  if v_old.done = p_done then
    return jsonb_build_object('task_id', v_old.id, 'done', v_old.done);
  end if;

  update public.work_tasks
  set done = p_done, updated_at = now()
  where id = p_task_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_work_task_done', 'work_tasks', v_new.id,
    null, v_sheet.event_id, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('task_id', v_new.id, 'done', v_new.done);
end;
$$;

-- The full list of one dish's tasks of one day in their new order (AD-5
-- ordering; exempt from idempotency). The dish and day are taken from the
-- first id. A list that is not exactly those tasks -> CONCURRENT_CHANGE.
-- Result: {task_ids}.
create function public.admin_set_work_task_order(p_ids uuid[])
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

-- ---------------------------------------------------------------------------
-- Prep days (this session only)
-- ---------------------------------------------------------------------------

-- Adds a prep day (-6..0, else INVALID_INPUT) to this session's sheet. A day
-- already on the sheet changes nothing. Result: {prep_days}.
create function public.admin_add_prep_day(
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
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_prep_day', p_idempotency_key,
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

  if p_day_offset = any (v_sheet.prep_days::integer[]) then
    return private.idempotent_finish(
      v_actor::text, 'admin_add_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days))
    );
  end if;

  update public.work_sheets s
  set prep_days = array(
        select d from unnest(s.prep_days || p_day_offset::smallint) as d order by d
      ),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_add_prep_day', 'work_sheets', v_new.id,
    null, v_new.event_id, to_jsonb(v_sheet), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days))
  );
end;
$$;

-- Removes a prep day from this session's sheet with its tasks, in the same
-- transaction. The last day stays (INVALID_INPUT). A day that is not on the
-- sheet changes nothing. Result: {prep_days, deleted_tasks}.
create function public.admin_remove_prep_day(
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
    returning t.id
  )
  select count(*)::integer into v_deleted from deleted;

  update public.work_sheets s
  set prep_days = array_remove(s.prep_days, p_day_offset::smallint),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_remove_prep_day', 'work_sheets', v_new.id,
    null, v_new.event_id,
    to_jsonb(v_sheet),
    to_jsonb(v_new) || jsonb_build_object('deleted_tasks', v_deleted)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days), 'deleted_tasks', v_deleted)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_get_work_sheet(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_work_sheet(uuid) to authenticated;

revoke execute on function public.admin_add_work_dish(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_work_dish(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_update_work_dish(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_work_dish(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_delete_work_dish(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_work_dish(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_work_dish_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_dish_order(uuid[]) to authenticated;

revoke execute on function public.admin_add_work_task(uuid, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_work_task(uuid, integer, text, uuid) to authenticated;

revoke execute on function public.admin_update_work_task(uuid, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_work_task(uuid, text, integer, uuid) to authenticated;

revoke execute on function public.admin_delete_work_task(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_work_task(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_work_task_done(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_task_done(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_work_task_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_task_order(uuid[]) to authenticated;

revoke execute on function public.admin_add_prep_day(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_prep_day(uuid, integer, uuid) to authenticated;

revoke execute on function public.admin_remove_prep_day(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_prep_day(uuid, integer, uuid) to authenticated;
