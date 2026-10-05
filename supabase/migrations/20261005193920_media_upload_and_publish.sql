-- Story 5.4: image upload and publishing (CAP-27, CAP-12, CAP-41; AD-5,
-- AD-16, AD-19, AD-21).
-- 1. Buckets: media-drafts (private, every upload) and media-public (public
--    URL, no API policy, no listing). 5MB, jpeg/png/webp only.
-- 2. storage.objects policies: an admin uploads to media-drafts only under
--    the name of a media_assets row in state draft, and reads media-drafts
--    (signed preview URLs). No update or delete for any API role; the copy
--    and the delete run with the service role (lib/server/privileged/media.ts).
-- 3. media_assets: one row per image. publish_state draft -> copying ->
--    published -> hidden (hidden -> copying when it is used again). No write
--    grant to any role: every change is an admin RPC with an audit row. The
--    public reads only published rows, and only the display columns.
-- 4. events.image_id and concepts.default_image_id (set null on delete).
-- 5. private.visible_media_ids(content): the images a section's content
--    shows (lib/content/visible.ts › visibleMediaIds is the same rule).
--    private.hide_unused_media: every published image that is no longer used
--    becomes hidden; returns the public files still to delete.
-- 6. RPCs: admin_create_media (idempotent), admin_begin_media_publish and
--    admin_finish_media_publish (the two steps around the copy, AD-21;
--    absolute transitions, no key), admin_set_event_image (an absolute
--    value, no key). admin_publish_content and admin_duplicate_event are
--    replaced with the same signatures.
-- 7. The section gallery/photos (kind gallery).
-- User decision 2026-10-05: no consent column and alt text is not required
-- (the UX memlog); an empty alt is rendered as alt="".

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-drafts', 'media-drafts', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('media-public', 'media-public', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']);

-- ---------------------------------------------------------------------------
-- media_assets
-- ---------------------------------------------------------------------------

-- storage_path: the object's name in media-drafts (the id); public_path: its
-- name in media-public (<id>.jpg). Both follow the id (checks), so a path is
-- never taken from input. focus_x / focus_y: the point that stays in view
-- in every aspect (object-position, percent). alt_text: optional (trimmed,
-- empty = null).
create table public.media_assets (
  id uuid primary key,
  storage_path text not null unique,
  public_path text not null unique,
  alt_text text check (alt_text is null or char_length(alt_text) between 1 and 300),
  focus_x smallint not null default 50 check (focus_x between 0 and 100),
  focus_y smallint not null default 50 check (focus_y between 0 and 100),
  publish_state text not null default 'draft'
    check (publish_state in ('draft', 'copying', 'published', 'hidden')),
  publish_started_at timestamptz,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_storage_path_check check (storage_path = id::text),
  constraint media_assets_public_path_check check (public_path = id::text || '.jpg')
);

alter table public.media_assets enable row level security;

create index media_assets_publish_state_idx on public.media_assets (publish_state);

-- The site reads only published images (through a join from content or a
-- session); the admin reads every row (the editor, the preview).
create policy media_assets_anon_select on public.media_assets
  for select to anon
  using (publish_state = 'published');

create policy media_assets_authenticated_select on public.media_assets
  for select to authenticated
  using (publish_state = 'published' or (select private.is_admin()));

revoke all on table public.media_assets from public, anon, authenticated, service_role;
grant select (id, public_path, alt_text, focus_x, focus_y, publish_state)
  on table public.media_assets to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Session and concept images
-- ---------------------------------------------------------------------------

alter table public.events
  add column image_id uuid references public.media_assets (id) on delete set null;

alter table public.concepts
  add column default_image_id uuid references public.media_assets (id) on delete set null;

create index events_image_id_idx on public.events (image_id);
create index concepts_default_image_id_idx on public.concepts (default_image_id);

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------

-- An admin uploads a draft only under the name of a row in state draft
-- (admin_create_media gives the id). No upsert: an existing name is refused.
create policy media_drafts_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media-drafts'
    and (select private.is_admin())
    and exists (
      select 1
      from public.media_assets m
      where m.id::text = objects.name
        and m.publish_state = 'draft'
    )
  );

-- The admin's preview (signed URLs of media-drafts).
create policy media_drafts_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media-drafts' and (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The images a section's content shows: none for a hidden section
-- ("hidden": true); otherwise $.image.media_id and the image of every item
-- that is not hidden. Values that are not uuids are ignored. Pure.
create function private.visible_media_ids(p_content jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct refs.id_text::uuid), '{}'::uuid[])
  from (
    select p_content #>> '{image,media_id}' as id_text
    union all
    select item #>> '{image,media_id}'
    from jsonb_array_elements(
      case when jsonb_typeof(p_content -> 'items') = 'array'
        then p_content -> 'items' else '[]'::jsonb end
    ) as item
    where jsonb_typeof(item) = 'object'
      and (item -> 'hidden') is distinct from 'true'::jsonb
  ) refs
  where jsonb_typeof(p_content) = 'object'
    and (p_content -> 'hidden') is distinct from 'true'::jsonb
    and refs.id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- Every image in use: shown by published content of a section that is not
-- hidden, a session's image, or a concept's default image.
create function private.used_media_ids()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from (
    select unnest(private.visible_media_ids(s.published_content)) as id
    from public.content_sections s
    where s.published_content is not null
      and not s.hidden
    union all
    select e.image_id from public.events e where e.image_id is not null
    union all
    select c.default_image_id from public.concepts c where c.default_image_id is not null
  ) u;
$$;

-- Hiding (AD-16, AD-21): every published image that is no longer in use
-- becomes hidden, with an audit row, before its public file is deleted.
-- Returns the public_path of every hidden image whose public file still
-- exists, so a delete that failed is done again on the next call.
create function private.hide_unused_media(p_actor uuid)
returns text[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_used uuid[] := private.used_media_ids();
  v_old public.media_assets;
  v_new public.media_assets;
begin
  for v_old in
    select m.*
    from public.media_assets m
    where m.publish_state = 'published'
      and not (m.id = any (v_used))
    order by m.id
    for update
  loop
    update public.media_assets
    set publish_state = 'hidden',
        updated_at = now()
    where id = v_old.id
    returning * into v_new;

    perform private.audit(
      p_actor, 'admin', 'media_hidden', 'media_assets', v_new.id,
      null, null, to_jsonb(v_old), to_jsonb(v_new)
    );
  end loop;

  return coalesce(
    (
      select array_agg(m.public_path order by m.public_path)
      from public.media_assets m
      where m.publish_state = 'hidden'
        and exists (
          select 1
          from storage.objects o
          where o.bucket_id = 'media-public'
            and o.name = m.public_path
        )
    ),
    '{}'::text[]
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_media
-- ---------------------------------------------------------------------------

-- A new image row in state draft; the browser then uploads the file to
-- media-drafts/<media_id> (the storage policy allows only that name).
-- Result: {media_id, storage_path}.
create function public.admin_create_media(p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_id uuid := gen_random_uuid();
  v_new public.media_assets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_media', p_idempotency_key, '{}'::jsonb
  );
  if v_prev is not null then
    return v_prev;
  end if;

  insert into public.media_assets (id, storage_path, public_path, created_by)
  values (v_id, v_id::text, v_id::text || '.jpg', v_actor)
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_create_media', 'media_assets', v_new.id,
    null, null, null, to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_media', p_idempotency_key,
    jsonb_build_object('media_id', v_new.id, 'storage_path', v_new.storage_path)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_begin_media_publish
-- ---------------------------------------------------------------------------

-- Step 1 of publishing an image (AD-21): saves the alt text (trimmed, empty =
-- none) and the focus point, and marks the intent. The draft file must
-- exist (MEDIA_NOT_UPLOADED). draft, hidden and copying become copying (the
-- start time stays while copying); a published image stays published (only
-- its alt and focus change). An unknown id -> NOT_FOUND. An absolute value,
-- so no idempotency key. Result: {media_id, publish_state, storage_path,
-- public_path}.
create function public.admin_begin_media_publish(
  p_media_id uuid,
  p_alt_text text,
  p_focus_x integer,
  p_focus_y integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.media_assets;
  v_new public.media_assets;
  v_alt text := nullif(btrim(p_alt_text), '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_alt is not null and char_length(v_alt) > 300 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "alt_text"}';
  elsif p_focus_x is null or p_focus_x not between 0 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "focus_x"}';
  elsif p_focus_y is null or p_focus_y not between 0 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "focus_y"}';
  end if;

  select m.* into v_old
  from public.media_assets m
  where m.id = p_media_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media-drafts'
      and o.name = v_old.storage_path
  ) then
    raise exception 'MEDIA_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  update public.media_assets
  set alt_text = v_alt,
      focus_x = p_focus_x,
      focus_y = p_focus_y,
      publish_state = case when v_old.publish_state = 'published'
        then 'published' else 'copying' end,
      publish_started_at = case
        when v_old.publish_state = 'copying' then v_old.publish_started_at
        when v_old.publish_state = 'published' then v_old.publish_started_at
        else now() end,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  if to_jsonb(v_new) - 'updated_at' is distinct from to_jsonb(v_old) - 'updated_at' then
    perform private.audit(
      v_actor, 'admin', 'admin_begin_media_publish', 'media_assets', v_new.id,
      null, null, to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  return jsonb_build_object(
    'media_id', v_new.id,
    'publish_state', v_new.publish_state,
    'storage_path', v_new.storage_path,
    'public_path', v_new.public_path
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_finish_media_publish
-- ---------------------------------------------------------------------------

-- Step 3 (AD-21): copying -> published once the public file exists
-- (storage.objects; otherwise MEDIA_NOT_COPIED). Already published: the same
-- result, nothing written. draft or hidden (no begin) -> MEDIA_NOT_COPIED.
-- An unknown id -> NOT_FOUND. Result: {media_id, publish_state,
-- public_path}.
create function public.admin_finish_media_publish(p_media_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.media_assets;
  v_new public.media_assets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select m.* into v_old
  from public.media_assets m
  where m.id = p_media_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.publish_state = 'published' then
    return jsonb_build_object(
      'media_id', v_old.id,
      'publish_state', v_old.publish_state,
      'public_path', v_old.public_path
    );
  end if;

  if v_old.publish_state <> 'copying' or not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media-public'
      and o.name = v_old.public_path
  ) then
    raise exception 'MEDIA_NOT_COPIED' using errcode = 'P0001';
  end if;

  update public.media_assets
  set publish_state = 'published',
      published_at = now(),
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_finish_media_publish', 'media_assets', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object(
    'media_id', v_new.id,
    'publish_state', v_new.publish_state,
    'public_path', v_new.public_path
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_event_image
-- ---------------------------------------------------------------------------

-- A session's image (CAP-12): a published image, or null to remove it
-- (otherwise MEDIA_NOT_PUBLISHED). An unknown session -> NOT_FOUND. The same
-- value writes nothing. An image that is no longer used becomes hidden
-- (private.hide_unused_media); hidden_paths are the public files to delete.
-- An absolute value, so no idempotency key. Result: {event_id, image_id,
-- hidden_paths}.
create function public.admin_set_event_image(p_event_id uuid, p_media_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.events;
  v_new public.events;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
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

  if v_old.image_id is distinct from p_media_id then
    update public.events
    set image_id = p_media_id
    where id = v_old.id
    returning * into v_new;

    perform private.audit(
      v_actor, 'admin', 'admin_set_event_image', 'events', v_new.id,
      null, v_new.id, to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  v_paths := private.hide_unused_media(v_actor);

  return jsonb_build_object(
    'event_id', v_old.id,
    'image_id', p_media_id,
    'hidden_paths', to_jsonb(v_paths)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_publish_content (replaced; same signature)
-- ---------------------------------------------------------------------------

-- Publishes a page (CAP-27, CAP-29), as in story 5.1, and in story 5.4:
-- before anything changes, an image that a pending draft shows and that is
-- still copying -> MEDIA_NOT_COPIED (the Server Action publishes the images
-- first). An image in state draft (an upload that did not finish) does not
-- stop the publish; the site does not show it. After the publish, every
-- published image that is no longer used becomes hidden
-- (private.hide_unused_media), also when nothing changed, so a delete that
-- failed is done again. Result: {published_version, changed, hidden_paths}.
create or replace function public.admin_publish_content(
  p_slug text,
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
  v_page public.content_pages;
  v_old public.content_sections;
  v_new public.content_sections;
  v_changed integer := 0;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text,
    'admin_publish_content',
    p_idempotency_key,
    jsonb_build_object('slug', p_slug)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select p.* into v_page
  from public.content_pages p
  where p.slug = p_slug
  for update;

  if v_page.slug is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.content_sections s
    cross join lateral unnest(private.visible_media_ids(s.draft_content)) as ref(id)
    join public.media_assets m on m.id = ref.id
    where s.page_slug = v_page.slug
      and s.draft_content is not null
      and s.draft_content <> '{}'::jsonb
      and s.draft_content is distinct from s.published_content
      and m.publish_state = 'copying'
  ) then
    raise exception 'MEDIA_NOT_COPIED' using errcode = 'P0001';
  end if;

  for v_old in
    select s.*
    from public.content_sections s
    where s.page_slug = v_page.slug
      and s.draft_content is not null
      and s.draft_content <> '{}'::jsonb
      and s.draft_content is distinct from s.published_content
    order by s.sort_order, s.key
    for update
  loop
    update public.content_sections
    set published_content = draft_content,
        published_at = now(),
        updated_by = v_actor,
        updated_at = now()
    where id = v_old.id
    returning * into v_new;

    perform private.audit(
      v_actor, 'admin', 'admin_publish_content', 'content_sections', v_new.id,
      null, null, to_jsonb(v_old), to_jsonb(v_new)
    );

    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    update public.content_pages
    set published_content = coalesce(published_content, '{}'::jsonb),
        published_at = now(),
        published_version = published_version + 1,
        updated_by = v_actor,
        updated_at = now()
    where slug = v_page.slug
    returning * into v_page;
  end if;

  v_paths := private.hide_unused_media(v_actor);

  return private.idempotent_finish(
    v_actor::text,
    'admin_publish_content',
    p_idempotency_key,
    jsonb_build_object(
      'published_version', v_page.published_version,
      'changed', v_changed,
      'hidden_paths', to_jsonb(v_paths)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_duplicate_event (replaced; same signature)
-- ---------------------------------------------------------------------------

-- A new draft from an existing session on another date (CAP-12): the same
-- concept, kind, description, capacity, display price and, from story 5.4,
-- image; the close is computed again (never copied). The source does not
-- change. Result: {event_id}.
create or replace function public.admin_duplicate_event(
  p_event_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
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
  v_source public.events;
  v_row public.events;
  v_saved public.events;
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

  return private.idempotent_finish(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Rows
-- ---------------------------------------------------------------------------

-- The gallery's photos come before the testimonials on /gallery.
insert into public.content_sections (page_slug, key, kind, sort_order)
values ('gallery', 'photos', 'gallery', 0);

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.visible_media_ids(jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.used_media_ids() from public, anon, authenticated, service_role;
revoke execute on function private.hide_unused_media(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_create_media(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_media(uuid) to authenticated;

revoke execute on function public.admin_begin_media_publish(uuid, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_media_publish(uuid, text, integer, integer) to authenticated;

revoke execute on function public.admin_finish_media_publish(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_media_publish(uuid) to authenticated;

revoke execute on function public.admin_set_event_image(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_event_image(uuid, uuid) to authenticated;
