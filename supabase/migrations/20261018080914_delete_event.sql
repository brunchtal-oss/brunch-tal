-- Story 3.17: Tal deletes a session (SPEC › Constraints, principle 3; a
-- sensitive action, AD-7). Only a draft or a published session that has
-- not ended, with no row at all in bookings (any status, a place held for a
-- new customer included) and no purchase pinned to it. The session's work
-- sheet (dishes, tasks, shopping) goes with it (on delete cascade). Its credit_options rows are
-- removed first (on delete restrict); the credit is not filled here (no
-- fill on admin paths, AD-6): the owner's next path refills it to
-- options_count (private.refresh_credit_options). No notification. Only
-- additions: admin_update_event, admin_cancel_event, cancel_core and
-- refresh_credit_options are unchanged.

-- ---------------------------------------------------------------------------
-- 1. The plan
-- ---------------------------------------------------------------------------

-- What deleting the session will do (AD-7: the preview and the action run
-- this one plan). Refusals ({ok: false, code}): a missing session
-- (NOT_FOUND); cancelled, completed, or published and ended (ends_at <=
-- now(), before job_complete_events marks it completed):
-- EVENT_NOT_DELETABLE, it stays in the history; any bookings row
-- (EVENT_HAS_BOOKINGS); an entitlement pinned to it, paid and not placed
-- (EVENT_HAS_PURCHASES). Result: {ok, event_id,
-- concept_name, status, starts_at, work_dishes_count, work_tasks_count,
-- shopping_items_count, credit_count (the credits that offer it as one of
-- their N: an active or passed option), credit_options ([{credit_id,
-- state}] by credit_id: every option row that will be removed)}.
create or replace function private.plan_admin_delete_event(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_concept text;
  v_sheet uuid;
  v_dishes integer := 0;
  v_tasks integer := 0;
  v_items integer := 0;
  v_credit_count integer;
  v_options jsonb;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_event.status not in ('draft', 'published')
     or (v_event.status = 'published' and v_event.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_DELETABLE');
  end if;

  if exists (select 1 from public.bookings b where b.event_id = v_event.id) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_HAS_BOOKINGS');
  end if;

  if exists (
    select 1 from public.entitlements e where e.pinned_event_id = v_event.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'EVENT_HAS_PURCHASES');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select s.id into v_sheet from public.work_sheets s where s.event_id = v_event.id;

  if v_sheet is not null then
    select count(*)::integer into v_dishes
    from public.work_dishes d
    where d.sheet_id = v_sheet;

    select count(*)::integer into v_tasks
    from public.work_tasks t
    join public.work_dishes d on d.id = t.dish_id
    where d.sheet_id = v_sheet;

    select count(*)::integer into v_items
    from public.shopping_items i
    where i.sheet_id = v_sheet;
  end if;

  select count(distinct o.credit_id)::integer into v_credit_count
  from public.credit_options o
  where o.event_id = v_event.id
    and o.state in ('active', 'passed');

  select coalesce(
    jsonb_agg(
      jsonb_build_object('credit_id', o.credit_id, 'state', o.state)
      order by o.credit_id
    ),
    '[]'::jsonb
  )
  into v_options
  from public.credit_options o
  where o.event_id = v_event.id;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'concept_name', v_concept,
    'status', v_event.status,
    'starts_at', v_event.starts_at,
    'work_dishes_count', v_dishes,
    'work_tasks_count', v_tasks,
    'shopping_items_count', v_items,
    'credit_count', v_credit_count,
    'credit_options', v_options
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The preview
-- ---------------------------------------------------------------------------

-- The delete dialog's plan (AD-7): the same admin check and grant as the
-- action.
create or replace function public.preview_admin_delete_event(p_event_id uuid)
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

  return private.plan_admin_delete_event(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The action
-- ---------------------------------------------------------------------------

-- Tal deletes a draft, or a published session that has not ended, that
-- nobody booked (sensitive).
-- Order: is_admin, idempotency, the session locked (a booking or a pinned
-- purchase on it takes a key-share lock on the row, so the plan sees every
-- one that committed first, and one that comes after finds no session),
-- the credits that have an option on it locked by id (AD-6: events, then
-- cancellation_credits), the plan (its code is raised), p_confirmed
-- (CONFIRM_REQUIRED). Then its credit_options rows deleted, the session
-- deleted (its work sheet cascades; a foreign_key_violation is a row made
-- in between: EVENT_HAS_BOOKINGS), audited with the prior row, its
-- concept's name (the session's label once it is gone), the work sheet
-- counts and the removed options (after null), and the images no
-- longer used hidden. Result: {event_id, hidden_paths} (the public files
-- to delete after the RPC).
create or replace function public.admin_delete_event(
  p_event_id uuid,
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
  v_event public.events;
  v_plan jsonb;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_event', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select o.credit_id
    from public.credit_options o
    where o.event_id = p_event_id
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_delete_event(p_event_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  delete from public.credit_options where event_id = v_event.id;

  begin
    delete from public.events where id = v_event.id;
  exception
    -- bookings and entitlements.pinned_event_id are on delete restrict.
    when foreign_key_violation then
      raise exception 'EVENT_HAS_BOOKINGS' using errcode = 'P0001';
  end;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_event', 'events', v_event.id,
    null, v_event.id,
    to_jsonb(v_event) || jsonb_build_object(
      'concept_name', v_plan -> 'concept_name',
      'work_dishes_count', v_plan -> 'work_dishes_count',
      'work_tasks_count', v_plan -> 'work_tasks_count',
      'shopping_items_count', v_plan -> 'shopping_items_count',
      'credit_options', v_plan -> 'credit_options'
    ),
    null
  );

  v_paths := private.hide_unused_media(v_actor);

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_event.id,
      'hidden_paths', to_jsonb(v_paths)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.plan_admin_delete_event(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_delete_event(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_delete_event(uuid) to authenticated;

revoke execute on function public.admin_delete_event(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_event(uuid, boolean, uuid) to authenticated;
