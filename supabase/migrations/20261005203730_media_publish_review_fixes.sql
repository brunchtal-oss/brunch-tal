-- Story 5.4, review fixes (create or replace only; same signatures, so the
-- grants stay).
-- 1. private.hide_unused_media also hides an unused image stuck in copying,
--    so a public file it already copied comes back in the returned paths
--    and is deleted (no public orphan).
-- 2. admin_publish_content refuses a pending draft that shows an image in
--    copying or hidden (hidden, e.g., by a concurrent publish between the
--    Action's image step and this RPC): MEDIA_NOT_COPIED, and the Action's
--    retry publishes the image again (begin: hidden -> copying).

-- ---------------------------------------------------------------------------
-- private.hide_unused_media
-- ---------------------------------------------------------------------------

-- Hiding (AD-16, AD-21): every published or copying image that is no longer
-- in use becomes hidden, with an audit row, before its public file is
-- deleted. Returns the public_path of every hidden image whose public file
-- still exists, so a delete that failed is done again on the next call.
create or replace function private.hide_unused_media(p_actor uuid)
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
    where m.publish_state in ('published', 'copying')
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
-- admin_publish_content
-- ---------------------------------------------------------------------------

-- Publishes a page (CAP-27, CAP-29), as in story 5.1, and in story 5.4:
-- before anything changes, an image that a pending draft shows and that is
-- copying or hidden -> MEDIA_NOT_COPIED (the Server Action publishes the
-- images first; its retry publishes them again). An image in state draft (an
-- upload that did not finish) does not stop the publish; the site does not
-- show it. After the publish, every published image that is no longer used
-- becomes hidden (private.hide_unused_media), also when nothing changed, so
-- a delete that failed is done again. Result: {published_version, changed,
-- hidden_paths}.
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
      and m.publish_state in ('copying', 'hidden')
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
