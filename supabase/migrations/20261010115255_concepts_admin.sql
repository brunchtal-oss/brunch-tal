-- Story 4.8: concepts in the admin (CAP-41). Additive only: no change to an
-- existing function, table or policy.
-- 1. RPCs: admin_create_concept, admin_update_concept (name, description,
--    default_kind), admin_set_concept_archived, admin_delete_concept (only
--    when no session uses it) and admin_set_concept_image (a published image
--    or null, as admin_set_event_image). AD-5 grants; create, update and
--    delete take an idempotency key, the two set_* are absolute values. Every
--    change writes its audit row (before / after) in the same transaction.
-- 2. A concept's default_kind and description are copied into a session at
--    its creation (admin_create_event, AD-15): a new kind applies to new
--    sessions only. A session without its own description shows the
--    concept's (the session pages read it through the join), as do the name
--    and the image, so those change on every such session of the concept.
-- 3. The name is unique among all concepts, archived ones too (btrim,
--    case-insensitive), checked here and not by an index, so duplicates
--    already in the dev data do not block the migration. Creates and renames
--    take one advisory lock, so two of them never pass the check together.

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- Applies a jsonb of field changes to a concept row and returns the new row.
-- Keys: name (a string, trimmed, 1-100 characters), description (a string
-- up to 2000 characters, trimmed, empty = null; or null), default_kind
-- ('regular' | 'couple'). Any other key, a wrong JSON type or a value out of
-- range raises INVALID_INPUT with detail.field.
create function private.apply_concept_changes(
  p_row public.concepts,
  p_changes jsonb
)
returns public.concepts
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row public.concepts := p_row;
  v_key text;
  v_value jsonb;
  v_text text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    case v_key
      when 'name' then
        if jsonb_typeof(v_value) <> 'string' then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = '{"field": "name"}';
        end if;
        v_text := btrim(v_value #>> '{}');
        if char_length(v_text) not between 1 and 100 then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = '{"field": "name"}';
        end if;
        v_row.name := v_text;
      when 'description' then
        if jsonb_typeof(v_value) = 'null' then
          v_row.description := null;
        elsif jsonb_typeof(v_value) = 'string' then
          v_text := nullif(btrim(v_value #>> '{}'), '');
          if v_text is not null and char_length(v_text) > 2000 then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = '{"field": "description"}';
          end if;
          v_row.description := v_text;
        else
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = '{"field": "description"}';
        end if;
      when 'default_kind' then
        if jsonb_typeof(v_value) <> 'string'
           or (v_value #>> '{}') not in ('regular', 'couple') then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = '{"field": "default_kind"}';
        end if;
        v_row.default_kind := v_value #>> '{}';
      else
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
    end case;
  end loop;

  return v_row;
end;
$$;

-- CONCEPT_NAME_TAKEN when another concept (archived ones too) has this name,
-- compared trimmed and case-insensitive. The caller holds the advisory lock
-- of concept names.
create function private.check_concept_name(p_name text, p_except uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.concepts c
    where lower(btrim(c.name)) = lower(btrim(p_name))
      and c.id is distinct from p_except
  ) then
    raise exception 'CONCEPT_NAME_TAKEN' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_concept
-- ---------------------------------------------------------------------------

-- Tal adds a concept. p_concept: name and default_kind (required),
-- description (optional). The new concept is last in the order (sort_order
-- = max + 1) and uses the generic identifier (theme_key 'generic', paper
-- 'olive': themes are not used since 2026-10-04, and the table's check needs
-- a paper for generic). Result: {concept_id}.
create function public.admin_create_concept(p_concept jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_row public.concepts;
  v_saved public.concepts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_concept', p_idempotency_key, p_concept
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_concept is null or jsonb_typeof(p_concept) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if not p_concept ? 'name' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "name"}';
  end if;
  if not p_concept ? 'default_kind' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "default_kind"}';
  end if;

  v_row := private.apply_concept_changes(v_row, p_concept);

  perform pg_advisory_xact_lock(hashtext('public.concepts.name'));
  perform private.check_concept_name(v_row.name, null);

  insert into public.concepts (
    name, description, default_kind, theme_key, generic_paper_key, sort_order
  )
  values (
    v_row.name, v_row.description, v_row.default_kind, 'generic', 'olive',
    (select coalesce(max(c.sort_order), 0) + 1 from public.concepts c)
  )
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_create_concept', 'concepts', v_saved.id,
    null, null, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_concept', p_idempotency_key,
    jsonb_build_object('concept_id', v_saved.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_concept
-- ---------------------------------------------------------------------------

-- Tal changes a concept. p_changes: a non-empty subset of name, description,
-- default_kind. Allowed also when the concept has sessions: a session keeps
-- the kind and description it was created with, and the next new session
-- takes the new ones; a session without its own description shows the
-- concept's. Locks the row. A change that leaves the row as it was writes
-- nothing. Result: {concept_id}.
create function public.admin_update_concept(
  p_concept_id uuid,
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
  v_old public.concepts;
  v_row public.concepts;
  v_saved public.concepts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_concept', p_idempotency_key,
    jsonb_build_object('concept_id', p_concept_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The name lock first (a rename checks the names under it), then the row.
  if p_changes ? 'name' then
    perform pg_advisory_xact_lock(hashtext('public.concepts.name'));
  end if;

  select c.* into v_old
  from public.concepts c
  where c.id = p_concept_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_row := private.apply_concept_changes(v_old, p_changes);

  if v_row.name is distinct from v_old.name then
    perform private.check_concept_name(v_row.name, v_old.id);
  end if;

  if v_row is distinct from v_old then
    update public.concepts
    set name = v_row.name,
        description = v_row.description,
        default_kind = v_row.default_kind
    where id = v_old.id
    returning * into v_saved;

    perform private.audit(
      v_actor, 'admin', 'admin_update_concept', 'concepts', v_saved.id,
      null, null, to_jsonb(v_old), to_jsonb(v_saved)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_concept', p_idempotency_key,
    jsonb_build_object('concept_id', v_old.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_concept_archived
-- ---------------------------------------------------------------------------

-- Archive (true) or restore (false). An archived concept is not offered for a
-- new session (/admin/sessions/new and admin_create_event filter
-- archived_at); its sessions keep it, with its name and image. The same
-- value writes nothing. An absolute value, so no idempotency key. Result:
-- {concept_id, archived_at}.
create function public.admin_set_concept_archived(p_concept_id uuid, p_archived boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.concepts;
  v_new public.concepts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_archived is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "archived"}';
  end if;

  select c.* into v_old
  from public.concepts c
  where c.id = p_concept_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_new := v_old;
  if p_archived and v_old.archived_at is null then
    update public.concepts
    set archived_at = now()
    where id = v_old.id
    returning * into v_new;
  elsif not p_archived and v_old.archived_at is not null then
    update public.concepts
    set archived_at = null
    where id = v_old.id
    returning * into v_new;
  end if;

  if v_new is distinct from v_old then
    perform private.audit(
      v_actor, 'admin', 'admin_set_concept_archived', 'concepts', v_new.id,
      null, null, to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  return jsonb_build_object(
    'concept_id', v_new.id,
    'archived_at', v_new.archived_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_concept
-- ---------------------------------------------------------------------------

-- Deletes a concept that no session uses (any status): otherwise
-- CONCEPT_IN_USE and nothing changes (archiving is the way out). Locks the
-- row first: a session being created for it holds a key-share lock on the
-- row, so the check and the delete see every session. Its image may stop
-- being used, so the result has hidden_paths (private.hide_unused_media),
-- the public files to delete after the RPC. Result: {concept_id,
-- hidden_paths}.
create function public.admin_delete_concept(p_concept_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.concepts;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_concept', p_idempotency_key,
    jsonb_build_object('concept_id', p_concept_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select c.* into v_old
  from public.concepts c
  where c.id = p_concept_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.events e where e.concept_id = v_old.id) then
    raise exception 'CONCEPT_IN_USE' using errcode = 'P0001';
  end if;

  begin
    delete from public.concepts where id = v_old.id;
  exception
    -- events.concept_id is on delete restrict: a session made in between.
    when foreign_key_violation then
      raise exception 'CONCEPT_IN_USE' using errcode = 'P0001';
  end;

  perform private.audit(
    v_actor, 'admin', 'admin_delete_concept', 'concepts', v_old.id,
    null, null, to_jsonb(v_old), null
  );

  v_paths := private.hide_unused_media(v_actor);

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_concept', p_idempotency_key,
    jsonb_build_object(
      'concept_id', v_old.id,
      'hidden_paths', to_jsonb(v_paths)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_concept_image
-- ---------------------------------------------------------------------------

-- A concept's image (CAP-41), shown on every session of the concept without
-- an image of its own: a published image, or null to remove it (otherwise
-- MEDIA_NOT_PUBLISHED). As admin_set_event_image: an unknown concept ->
-- NOT_FOUND, the same value writes nothing, an image no longer used becomes
-- hidden and hidden_paths are the public files to delete. An absolute
-- value, so no idempotency key. Result: {concept_id, image_id,
-- hidden_paths}.
create function public.admin_set_concept_image(p_concept_id uuid, p_media_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.concepts;
  v_new public.concepts;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select c.* into v_old
  from public.concepts c
  where c.id = p_concept_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_media_id is not null and not exists (
    select 1
    from public.media_assets m
    where m.id = p_media_id
      and m.publish_state = 'published'
  ) then
    raise exception 'MEDIA_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  if v_old.default_image_id is distinct from p_media_id then
    update public.concepts
    set default_image_id = p_media_id
    where id = v_old.id
    returning * into v_new;

    perform private.audit(
      v_actor, 'admin', 'admin_set_concept_image', 'concepts', v_new.id,
      null, null, to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  v_paths := private.hide_unused_media(v_actor);

  return jsonb_build_object(
    'concept_id', v_old.id,
    'image_id', p_media_id,
    'hidden_paths', to_jsonb(v_paths)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer RPCs (as owner).
revoke execute on function private.apply_concept_changes(public.concepts, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.check_concept_name(text, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_create_concept(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_concept(jsonb, uuid) to authenticated;

revoke execute on function public.admin_update_concept(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_concept(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.admin_set_concept_archived(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_concept_archived(uuid, boolean) to authenticated;

revoke execute on function public.admin_delete_concept(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_concept(uuid, uuid) to authenticated;

revoke execute on function public.admin_set_concept_image(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_concept_image(uuid, uuid) to authenticated;
