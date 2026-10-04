-- Story 5.1: publish the hero to the home page (tracer; AD-5, AD-15, AD-16,
-- AD-19).
-- 1. Rows: content_pages 'home' (not published) and its section
--    home/hero (kind hero, sort_order 1, no draft). No new columns.
-- 2. admin_get_content_page (read, admin): the page with its sections,
--    draft and published.
-- 3. admin_set_content_draft (set_*, admin, no idempotency): the draft of an
--    existing section; an object only.
-- 4. admin_publish_content (admin, idempotent): publishes every section whose
--    draft is not empty and differs from what is published, then marks the
--    page published and raises published_version. Nothing changed: the
--    version stays.
-- The shape of each kind is checked by the Server Action (zod,
-- lib/content/schema.ts) before saving and before publishing; the RPCs
-- enforce the admin, the object and the version. The site parses again.

-- ---------------------------------------------------------------------------
-- Rows
-- ---------------------------------------------------------------------------

insert into public.content_pages (slug) values ('home');

insert into public.content_sections (page_slug, key, kind, sort_order)
values ('home', 'hero', 'hero', 1);

-- ---------------------------------------------------------------------------
-- admin_get_content_page
-- ---------------------------------------------------------------------------

-- The editor's view of a page (CAP-27): {slug, published_version,
-- published_at, sections: [{id, key, kind, sort_order, hidden,
-- draft_content, published_content, published_at, updated_at}]} by
-- sort_order. An unknown page -> NOT_FOUND.
create function public.admin_get_content_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page public.content_pages;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_page
  from public.content_pages p
  where p.slug = p_slug;

  if v_page.slug is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'slug', v_page.slug,
    'published_version', v_page.published_version,
    'published_at', v_page.published_at,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'key', s.key,
            'kind', s.kind,
            'sort_order', s.sort_order,
            'hidden', s.hidden,
            'draft_content', s.draft_content,
            'published_content', s.published_content,
            'published_at', s.published_at,
            'updated_at', s.updated_at
          )
          order by s.sort_order, s.key
        )
        from public.content_sections s
        where s.page_slug = v_page.slug
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_content_draft
-- ---------------------------------------------------------------------------

-- Saves the draft of an existing section (an absolute value, so no
-- idempotency key, AD-5). Not an object -> INVALID_INPUT; an unknown page or
-- key -> NOT_FOUND. Nothing public changes until admin_publish_content.
-- Result: {key, updated_at}.
create function public.admin_set_content_draft(
  p_slug text,
  p_key text,
  p_content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old public.content_sections;
  v_new public.content_sections;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "content"}';
  end if;

  select s.* into v_old
  from public.content_sections s
  where s.page_slug = p_slug
    and s.key = p_key
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.content_sections
  set draft_content = p_content,
      updated_by = v_actor,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  perform private.audit(
    v_actor, 'admin', 'admin_set_content_draft', 'content_sections', v_new.id,
    null, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object('key', v_new.key, 'updated_at', v_new.updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_publish_content
-- ---------------------------------------------------------------------------

-- Publishes a page (CAP-27, CAP-29). The page is locked first, then its
-- sections by sort_order. Every section whose draft is not empty (null or
-- {}) and differs from its published content becomes published, with an
-- audit row. When at least one changed, the page is marked published ({}
-- when it had no content) and published_version goes up by one; otherwise
-- nothing changes. An unknown page -> NOT_FOUND.
-- Result: {published_version, changed}.
create function public.admin_publish_content(
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

  return private.idempotent_finish(
    v_actor::text,
    'admin_publish_content',
    p_idempotency_key,
    jsonb_build_object(
      'published_version', v_page.published_version,
      'changed', v_changed
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_get_content_page(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_content_page(text) to authenticated;

revoke execute on function public.admin_set_content_draft(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_content_draft(text, text, jsonb) to authenticated;

revoke execute on function public.admin_publish_content(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_content(text, uuid) to authenticated;
