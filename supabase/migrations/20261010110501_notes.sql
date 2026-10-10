-- Story 4.11: the notes tab (CAP-39). Topics Tal creates and free notes
-- inside them. Admin only: RLS select for admins, no write grant; every
-- write is an RPC here (AD-1, AD-5). Every note write locks its topic row
-- first (for update) and reads the note again (AD-6); a move locks both
-- topics in id order. A call that changes nothing returns without an update
-- and without an audit row. Notes about interested people hold names and
-- phones, so private.audit_diff masks notes.body (AD-19).
-- Display order: pinned notes first, then the rest, each by sort_order (one
-- sort_order per topic). Archived notes keep their pinned, done and
-- sort_order, so a restore puts them back in the same place.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.note_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order integer not null,
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.note_topics (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  pinned boolean not null default false,
  done boolean not null default false,
  archived_at timestamptz,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_topic_id_idx on public.notes (topic_id, sort_order);

alter table public.note_topics enable row level security;
alter table public.notes enable row level security;

create policy note_topics_authenticated_select on public.note_topics
  for select to authenticated
  using ((select private.is_admin()));

create policy notes_authenticated_select on public.notes
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.note_topics from public, anon, authenticated, service_role;
revoke all on table public.notes from public, anon, authenticated, service_role;
grant select on table public.note_topics to authenticated;
grant select on table public.notes to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Locks a topic (for update) and returns it. An unknown topic -> NOT_FOUND.
create function private.lock_note_topic(p_topic_id uuid)
returns public.note_topics
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_topic public.note_topics;
begin
  select t.* into v_topic from public.note_topics t where t.id = p_topic_id for update;
  if v_topic.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_topic;
end;
$$;

-- A note's topic, locked (AD-6: the parent is read without a lock, locked,
-- and the note read again in that topic). An unknown note -> NOT_FOUND.
create function private.lock_topic_of_note(p_note_id uuid)
returns public.note_topics
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_topic_id uuid;
  v_topic public.note_topics;
begin
  select n.topic_id into v_topic_id from public.notes n where n.id = p_note_id;
  if v_topic_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_topic := private.lock_note_topic(v_topic_id);
  if not exists (
    select 1 from public.notes n where n.id = p_note_id and n.topic_id = v_topic.id
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_topic;
end;
$$;

-- A topic name or a note body: every whitespace trimmed (as
-- private.work_text), 1 to p_max characters, else INVALID_INPUT with
-- detail.field.
create function private.note_text(p_value text, p_field text, p_max integer)
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
  if p_value is null or char_length(v_text) not between 1 and p_max then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', p_field)::text;
  end if;
  return v_text;
end;
$$;

-- The sort_order that puts a note at the top of a topic's unpinned notes
-- (display sorts pinned first, so the topic's lowest order minus one).
create function private.note_top_order(p_topic_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(min(n.sort_order), 1) - 1
  from public.notes n
  where n.topic_id = p_topic_id;
$$;

-- The plan of a topic delete (AD-7), shared by the preview and the delete:
-- {topic_id, name, note_count} (archived notes included). An unknown topic
-- -> NOT_FOUND.
create function private.plan_delete_note_topic(p_topic_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_topic public.note_topics;
  v_count integer;
begin
  select t.* into v_topic from public.note_topics t where t.id = p_topic_id;
  if v_topic.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_count from public.notes n where n.topic_id = p_topic_id;
  return jsonb_build_object(
    'topic_id', v_topic.id,
    'name', v_topic.name,
    'note_count', v_count
  );
end;
$$;

revoke execute on function private.lock_note_topic(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.lock_topic_of_note(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.note_text(text, text, integer) from public, anon, authenticated, service_role;
revoke execute on function private.note_top_order(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.plan_delete_note_topic(uuid) from public, anon, authenticated, service_role;

-- The audit masks a note's body (AD-19): as in 20261006215608, plus
-- notes.body. Topic names are not masked.
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
        or (p_table = 'notes' and k = 'body')
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
-- Topics
-- ---------------------------------------------------------------------------

-- A new topic, last. Result: {topic_id}.
create function public.admin_add_note_topic(p_name text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_name text;
  v_topic public.note_topics;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_note_topic', p_idempotency_key,
    jsonb_build_object('name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_name := private.note_text(p_name, 'name', 60);

  insert into public.note_topics (name, sort_order)
  values (
    v_name,
    coalesce((select max(t.sort_order) from public.note_topics t), 0) + 1
  )
  returning * into v_topic;

  perform private.audit(
    v_actor, 'admin', 'admin_add_note_topic', 'note_topics', v_topic.id,
    null, null, null, to_jsonb(v_topic)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_note_topic', p_idempotency_key,
    jsonb_build_object('topic_id', v_topic.id)
  );
end;
$$;

-- Renames a topic; the same name changes nothing. Result: {topic_id}.
create function public.admin_rename_note_topic(
  p_topic_id uuid,
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
  v_name text;
  v_old public.note_topics;
  v_new public.note_topics;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_rename_note_topic', p_idempotency_key,
    jsonb_build_object('topic_id', p_topic_id, 'name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_old := private.lock_note_topic(p_topic_id);
  v_name := private.note_text(p_name, 'name', 60);

  if v_old.name = v_name then
    return private.idempotent_finish(
      v_actor::text, 'admin_rename_note_topic', p_idempotency_key,
      jsonb_build_object('topic_id', v_old.id)
    );
  end if;

  update public.note_topics
  set name = v_name
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_rename_note_topic', 'note_topics', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_rename_note_topic', p_idempotency_key,
    jsonb_build_object('topic_id', v_new.id)
  );
end;
$$;

-- The plan of a topic delete, for the sensitive dialog (AD-7): {topic_id,
-- name, note_count}. A read, so no idempotency key.
create function public.preview_admin_delete_note_topic(p_topic_id uuid)
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
  return private.plan_delete_note_topic(p_topic_id);
end;
$$;

-- Deletes a topic and its notes (cascade, archived ones too). A topic with
-- notes needs p_confirmed (the sensitive dialog), else CONFIRM_REQUIRED; an
-- empty one does not. The audit before holds the topic and its note count.
-- Result: {topic_id, note_count}.
create function public.admin_delete_note_topic(
  p_topic_id uuid,
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
  v_topic public.note_topics;
  v_plan jsonb;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_note_topic', p_idempotency_key,
    jsonb_build_object('topic_id', p_topic_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_topic := private.lock_note_topic(p_topic_id);
  v_plan := private.plan_delete_note_topic(v_topic.id);
  v_count := (v_plan ->> 'note_count')::integer;

  if v_count > 0 and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  delete from public.note_topics where id = v_topic.id;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_note_topic', 'note_topics', v_topic.id,
    null, null,
    to_jsonb(v_topic) || jsonb_build_object('note_count', v_count), null
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_note_topic', p_idempotency_key,
    jsonb_build_object('topic_id', v_topic.id, 'note_count', v_count)
  );
end;
$$;

-- The full list of the topics in their new order (AD-5 ordering; exempt
-- from idempotency). Every topic is locked in id order first. A list that
-- is not exactly the topics -> CONCURRENT_CHANGE; the same order changes
-- nothing. Result: {topic_ids}.
create function public.admin_set_note_topic_order(p_ids uuid[])
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

  perform 1 from public.note_topics t order by t.id for update;

  select coalesce(array_agg(t.id order by t.sort_order, t.id), '{}'::uuid[])
  into v_old
  from public.note_topics t;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('topic_ids', to_jsonb(p_ids));
  end if;

  update public.note_topics t
  set sort_order = o.n
  from unnest(p_ids) with ordinality as o(id, n)
  where t.id = o.id and t.sort_order is distinct from o.n::integer;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_topic_order', 'note_topics', null,
    null, null,
    jsonb_build_object('topic_order', to_jsonb(v_old)),
    jsonb_build_object('topic_order', to_jsonb(p_ids))
  );

  return jsonb_build_object('topic_ids', to_jsonb(p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- A new note at the top of the topic's unpinned notes. Result: {note_id}.
create function public.admin_add_note(
  p_topic_id uuid,
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
  v_topic public.note_topics;
  v_body text;
  v_note public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_note', p_idempotency_key,
    jsonb_build_object('topic_id', p_topic_id, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_topic := private.lock_note_topic(p_topic_id);
  v_body := private.note_text(p_body, 'body', 2000);

  insert into public.notes (topic_id, body, sort_order)
  values (v_topic.id, v_body, private.note_top_order(v_topic.id))
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

-- Changes a note's body and topic. A move locks both topics in id order,
-- gives the note the target's lowest sort_order minus one (the top of the
-- target's unpinned notes, or of its pinned notes for a pinned note) and
-- keeps pinned, done and archived. The same body and topic change nothing. An unknown
-- note or target topic -> NOT_FOUND. Result: {note_id, topic_id}.
create function public.admin_update_note(
  p_note_id uuid,
  p_topic_id uuid,
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
  v_from uuid;
  v_body text;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id, 'topic_id', p_topic_id, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_topic_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select n.topic_id into v_from from public.notes n where n.id = p_note_id;
  if v_from is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Both topics in id order (one when it stays).
  perform private.lock_note_topic(least(v_from, p_topic_id));
  if v_from <> p_topic_id then
    perform private.lock_note_topic(greatest(v_from, p_topic_id));
  end if;

  select n.* into v_old from public.notes n where n.id = p_note_id;
  if v_old.id is null or v_old.topic_id <> v_from then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_body := private.note_text(p_body, 'body', 2000);

  if v_old.body = v_body and v_old.topic_id = p_topic_id then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_note', p_idempotency_key,
      jsonb_build_object('note_id', v_old.id, 'topic_id', v_old.topic_id)
    );
  end if;

  update public.notes n
  set body = v_body,
      topic_id = p_topic_id,
      sort_order = case
        when n.topic_id = p_topic_id then n.sort_order
        else private.note_top_order(p_topic_id)
      end,
      updated_at = now()
  where n.id = p_note_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_update_note', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', v_new.id, 'topic_id', v_new.topic_id)
  );
end;
$$;

-- Deletes a note (not restorable; the archive is the way to keep one).
-- Result: {note_id}.
create function public.admin_delete_note(p_note_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_topic public.note_topics;
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

  v_topic := private.lock_topic_of_note(p_note_id);

  delete from public.notes where id = p_note_id
  returning * into v_old;

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
create function public.admin_set_note_pinned(p_note_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_topic public.note_topics;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_pinned is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_topic := private.lock_topic_of_note(p_note_id);

  select n.* into v_old from public.notes n where n.id = p_note_id;
  if v_old.pinned = p_pinned then
    return jsonb_build_object('note_id', v_old.id, 'pinned', v_old.pinned);
  end if;

  update public.notes
  set pinned = p_pinned, updated_at = now()
  where id = p_note_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_pinned', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('note_id', v_new.id, 'pinned', v_new.pinned);
end;
$$;

-- Marks a note done or not done (exempt, AD-5). Result: {note_id, done}.
create function public.admin_set_note_done(p_note_id uuid, p_done boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_topic public.note_topics;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_topic := private.lock_topic_of_note(p_note_id);

  select n.* into v_old from public.notes n where n.id = p_note_id;
  if v_old.done = p_done then
    return jsonb_build_object('note_id', v_old.id, 'done', v_old.done);
  end if;

  update public.notes
  set done = p_done, updated_at = now()
  where id = p_note_id
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
create function public.admin_set_note_archived(p_note_id uuid, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_topic public.note_topics;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_archived is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_topic := private.lock_topic_of_note(p_note_id);

  select n.* into v_old from public.notes n where n.id = p_note_id;
  if (v_old.archived_at is not null) = p_archived then
    return jsonb_build_object('note_id', v_old.id, 'archived', p_archived);
  end if;

  update public.notes
  set archived_at = case when p_archived then now() else null end,
      updated_at = now()
  where id = p_note_id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_note_archived', 'notes', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('note_id', v_new.id, 'archived', p_archived);
end;
$$;

-- The full list of a topic's notes (archived ones included) in their new
-- order (AD-5 ordering; exempt from idempotency). The order is stored as is;
-- the display still puts pinned notes first. A list that is not exactly the
-- topic's notes -> CONCURRENT_CHANGE; the same order changes nothing.
-- Result: {note_ids}.
create function public.admin_set_note_order(p_topic_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_topic public.note_topics;
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_topic := private.lock_note_topic(p_topic_id);

  select coalesce(array_agg(n.id order by n.pinned desc, n.sort_order, n.id), '{}'::uuid[])
  into v_old
  from public.notes n
  where n.topic_id = v_topic.id;

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
    v_actor, 'admin', 'admin_set_note_order', 'note_topics', v_topic.id,
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

revoke execute on function public.admin_add_note_topic(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_note_topic(text, uuid) to authenticated;

revoke execute on function public.admin_rename_note_topic(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_rename_note_topic(uuid, text, uuid) to authenticated;

revoke execute on function public.preview_admin_delete_note_topic(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_delete_note_topic(uuid) to authenticated;

revoke execute on function public.admin_delete_note_topic(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_note_topic(uuid, boolean, uuid) to authenticated;

revoke execute on function public.admin_set_note_topic_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_topic_order(uuid[]) to authenticated;

revoke execute on function public.admin_add_note(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_note(uuid, text, uuid) to authenticated;

revoke execute on function public.admin_update_note(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_note(uuid, uuid, text, uuid) to authenticated;

revoke execute on function public.admin_delete_note(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_note(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_note_pinned(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_pinned(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_done(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_done(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_archived(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_archived(uuid, boolean) to authenticated;

revoke execute on function public.admin_set_note_order(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_order(uuid, uuid[]) to authenticated;
