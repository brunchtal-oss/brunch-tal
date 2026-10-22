-- Fix 13: the notes tab without topics (user 2026-10-21). One board of all
-- notes; the first line of notes.body is shown as the title. Topics are
-- removed entirely: the note_topics table, its RPCs and helpers, and
-- notes.topic_id. Pin, done, archive/restore, order, edit and delete stay.
--
-- With no parent row to lock, every note write takes one advisory lock for
-- the whole board first (AD-6), then locks and re-reads the note (for
-- update); an unknown note -> NOT_FOUND. A call that changes nothing
-- returns without an update and without an audit row. The audit is
-- unchanged (entity_type notes; private.audit_diff masks notes.body).
-- Display order: pinned notes first, then the rest, each by sort_order (one
-- sort_order for the whole board). Archived notes keep pinned, done and
-- sort_order, so a restore puts them back in the same place.
--
-- Contains drop statements: run in the SQL Editor (not apply_migration).

-- ---------------------------------------------------------------------------
-- One board order (topic 1's notes first, then topic 2's, ...)
-- ---------------------------------------------------------------------------

update public.notes n
set sort_order = o.rn
from (
  select n2.id,
         row_number() over (order by t.sort_order, t.id, n2.sort_order, n2.id)::integer as rn
  from public.notes n2
  join public.note_topics t on t.id = n2.topic_id
) o
where n.id = o.id;

-- ---------------------------------------------------------------------------
-- Drop the topic RPCs, the old note RPC signatures and the topic helpers
-- (functions that return the note_topics row type go before the table)
-- ---------------------------------------------------------------------------

drop function public.admin_add_note_topic(text, uuid);
drop function public.admin_rename_note_topic(uuid, text, uuid);
drop function public.preview_admin_delete_note_topic(uuid);
drop function public.admin_delete_note_topic(uuid, boolean, uuid);
drop function public.admin_set_note_topic_order(uuid[]);
drop function public.admin_add_note(uuid, text, uuid);
drop function public.admin_update_note(uuid, uuid, text, uuid);
drop function public.admin_set_note_order(uuid, uuid[]);
drop function private.lock_topic_of_note(uuid);
drop function private.lock_note_topic(uuid);
drop function private.note_top_order(uuid);
drop function private.plan_delete_note_topic(uuid);

-- The index notes_topic_id_idx and the foreign key go with the column.
alter table public.notes drop column topic_id;

drop table public.note_topics;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The board lock (AD-6, no parent row): one transaction-scoped advisory lock
-- that every note write takes first.
create function private.lock_notes_board()
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('notes'));
$$;

-- A note, locked (for update) after the board lock. Unknown -> NOT_FOUND.
create function private.lock_note(p_note_id uuid)
returns public.notes
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_note public.notes;
begin
  perform private.lock_notes_board();
  select n.* into v_note from public.notes n where n.id = p_note_id for update;
  if v_note.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_note;
end;
$$;

revoke execute on function private.lock_notes_board() from public, anon, authenticated, service_role;
revoke execute on function private.lock_note(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- A new note at the top of the unpinned notes (the board's lowest
-- sort_order minus one; the display puts pinned notes first). Result:
-- {note_id}.
create function public.admin_add_note(p_body text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_body text;
  v_note public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_note', p_idempotency_key,
    jsonb_build_object('body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  perform private.lock_notes_board();
  v_body := private.note_text(p_body, 'body', 2000);

  insert into public.notes (body, sort_order)
  values (
    v_body,
    coalesce((select min(n.sort_order) from public.notes n), 1) - 1
  )
  returning * into v_note;

  perform private.audit(
    v_actor, 'admin', 'admin_add_note', 'notes', v_note.id,
    null, null, null, to_jsonb(v_note)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_note', p_idempotency_key,
    jsonb_build_object('note_id', v_note.id)
  );
end;
$$;

-- Changes a note's body; its place, pinned, done and archived stay. The same
-- body changes nothing. An unknown note -> NOT_FOUND. Result: {note_id}.
create function public.admin_update_note(
  p_note_id uuid,
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
  v_body text;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_old := private.lock_note(p_note_id);
  v_body := private.note_text(p_body, 'body', 2000);

  if v_old.body = v_body then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_note', p_idempotency_key,
      jsonb_build_object('note_id', v_old.id)
    );
  end if;

  update public.notes
  set body = v_body, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_update_note', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', v_new.id)
  );
end;
$$;

-- Deletes a note (not restorable; the archive is the way to keep one).
-- Result: {note_id}.
create or replace function public.admin_delete_note(p_note_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_old := private.lock_note(p_note_id);

  delete from public.notes where id = v_old.id;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_note', 'notes', v_old.id,
    null, null, to_jsonb(v_old), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_note', p_idempotency_key,
    jsonb_build_object('note_id', v_old.id)
  );
end;
$$;

-- Pins or unpins a note: an absolute value, exempt from idempotency
-- (AD-5). Its sort_order stays. Result: {note_id, pinned}.
create or replace function public.admin_set_note_pinned(p_note_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_pinned is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if v_old.pinned = p_pinned then
    return jsonb_build_object('note_id', v_old.id, 'pinned', v_old.pinned);
  end if;

  update public.notes
  set pinned = p_pinned, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_pinned', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('note_id', v_new.id, 'pinned', v_new.pinned);
end;
$$;

-- Marks a note done or not done (exempt, AD-5). Result: {note_id, done}.
create or replace function public.admin_set_note_done(p_note_id uuid, p_done boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if v_old.done = p_done then
    return jsonb_build_object('note_id', v_old.id, 'done', v_old.done);
  end if;

  update public.notes
  set done = p_done, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_done', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('note_id', v_new.id, 'done', v_new.done);
end;
$$;

-- Archives a note or restores it (exempt, AD-5). A restore keeps pinned,
-- done and sort_order, so the note returns to the same place. Result:
-- {note_id, archived}.
create or replace function public.admin_set_note_archived(p_note_id uuid, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_archived is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if (v_old.archived_at is not null) = p_archived then
    return jsonb_build_object('note_id', v_old.id, 'archived', p_archived);
  end if;

  update public.notes
  set archived_at = case when p_archived then now() else null end,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_archived', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('note_id', v_new.id, 'archived', p_archived);
end;
$$;

-- The full list of all notes (archived ones included) in their new order
-- (AD-5 ordering; exempt from idempotency). The order is stored as is; the
-- display still puts pinned notes first. A list that is not exactly the
-- notes -> CONCURRENT_CHANGE; the same order changes nothing. Result:
-- {note_ids}.
create function public.admin_set_note_order(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform private.lock_notes_board();
  perform 1 from public.notes n order by n.id for update;

  select coalesce(array_agg(n.id order by n.pinned desc, n.sort_order, n.id), '{}'::uuid[])
  into v_old
  from public.notes n;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('note_ids', to_jsonb(p_ids));
  end if;

  update public.notes n
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where n.id = o.id and n.sort_order is distinct from o.n::integer;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_order', 'notes', null,
    null, null,
    jsonb_build_object('note_order', to_jsonb(v_old)),
    jsonb_build_object('note_order', to_jsonb(p_ids))
  );

  return jsonb_build_object('note_ids', to_jsonb(p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_add_note(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_note(text, uuid) to authenticated;

revoke execute on function public.admin_update_note(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_note(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_delete_note(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_note(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_note_pinned(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_pinned(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_done(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_done(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_archived(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_archived(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_order(uuid[]) to authenticated;
