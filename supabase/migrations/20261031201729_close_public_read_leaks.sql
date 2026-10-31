-- Fix fix-public-read-leaks (deferred-work; spec-6.7 gate decision 1).
--
-- PC8: hidden content no longer reaches a public read. content_sections
-- keeps the whole published content in a new column, published_content_full,
-- which anon and authenticated cannot select (the table's grants are per
-- column, 20261001201839_create_join_flow.sql). published_content becomes
-- the public copy without hidden content: a trigger derives it from
-- published_content_full on every insert and update, whoever writes it.
-- admin_publish_content compares and writes the full copy, and
-- admin_get_content_page returns it under the same published_content key,
-- so the editor and the deployed site read exactly what they read before.
--
-- SC5: an archived concept is readable by anon and customers only while a
-- session that is not a draft shows it (the session's page, past bookings);
-- the admin reads every concept through a separate policy, because
-- private.is_admin() cannot be executed by anon.
--
-- Nothing is dropped; the RPCs keep their signatures, so their grants stay
-- as they are.

-- ---------------------------------------------------------------------------
-- 1. The strip rule (the site's rule, lib/content/visible.ts)
-- ---------------------------------------------------------------------------

-- A hidden section -> {"hidden": true}; otherwise every element of items
-- whose hidden is true is removed, in order; anything else is unchanged.
-- null -> null.
create function private.public_content(p_content jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_content -> 'hidden' = 'true'::jsonb then '{"hidden": true}'::jsonb
    when jsonb_typeof(p_content -> 'items') = 'array' then jsonb_set(
      p_content,
      '{items}',
      coalesce(
        (
          select jsonb_agg(t.i order by t.n)
          from jsonb_array_elements(p_content -> 'items') with ordinality as t(i, n)
          where (t.i -> 'hidden') is distinct from 'true'::jsonb
        ),
        '[]'::jsonb
      )
    )
    else p_content
  end
$$;

revoke execute on function private.public_content(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The full published content (no grant to anon or authenticated)
-- ---------------------------------------------------------------------------

alter table public.content_sections
  add column published_content_full jsonb;

comment on column public.content_sections.published_content_full is
  'The whole published content, hidden content included. Read only by admin RPCs; published_content is its public copy (trigger content_sections_public_copy).';

-- ---------------------------------------------------------------------------
-- 3. The public copy, derived on every write
-- ---------------------------------------------------------------------------

-- On insert, the full copy is published_content_full or else
-- published_content. On update, a write of published_content alone (tests,
-- seed scripts, an unpublish that sets it to null) becomes the full copy;
-- a write of published_content_full wins. Then published_content is always
-- the public copy of the full one, so it can never hold hidden content.
create function private.content_sections_public_copy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.published_content_full := coalesce(new.published_content_full, new.published_content);
  elsif new.published_content_full is not distinct from old.published_content_full
    and new.published_content is distinct from old.published_content then
    new.published_content_full := new.published_content;
  end if;

  new.published_content := private.public_content(new.published_content_full);
  return new;
end;
$$;

revoke execute on function private.content_sections_public_copy()
  from public, anon, authenticated, service_role;

create trigger content_sections_public_copy
  before insert or update on public.content_sections
  for each row execute function private.content_sections_public_copy();

-- ---------------------------------------------------------------------------
-- 4. Backfill: what is published today is the full copy; the trigger strips
--    the public one.
-- ---------------------------------------------------------------------------

update public.content_sections
set published_content_full = published_content
where published_content is not null;

-- ---------------------------------------------------------------------------
-- 5. admin_publish_content: compares and writes the full copy
-- ---------------------------------------------------------------------------

-- As in 20261005203814_media_publish_review_fixes.sql (the live definition);
-- the only changes: both comparisons are against published_content_full,
-- and the publish sets published_content_full (the trigger derives
-- published_content). Result: {published_version, changed, hidden_paths}.
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
      and s.draft_content is distinct from s.published_content_full
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
      and s.draft_content is distinct from s.published_content_full
    order by s.sort_order, s.key
    for update
  loop
    update public.content_sections
    set published_content_full = draft_content,
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
-- 6. admin_get_content_page: the editor reads the full copy
-- ---------------------------------------------------------------------------

-- As in 20261004122904_content_publish.sql (the live definition); the only
-- change: published_content is s.published_content_full, so the editor, its
-- chips, the preview and "back to what the site shows" see hidden content as
-- before. {slug, published_version, published_at, sections: [{id, key, kind,
-- sort_order, hidden, draft_content, published_content, published_at,
-- updated_at}]} by sort_order. An unknown page -> NOT_FOUND.
create or replace function public.admin_get_content_page(p_slug text)
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
            'published_content', s.published_content_full,
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
-- 7. SC5: an archived concept, only through a session that is not a draft
-- ---------------------------------------------------------------------------

-- The subquery reads events under the caller's own policies (anon and
-- customers see only sessions that are not drafts); events policies do not
-- read concepts, so there is no recursion (index events_concept_id_idx).
alter policy concepts_public_select on public.concepts
  using (
    archived_at is null
    or exists (
      select 1
      from public.events e
      where e.concept_id = concepts.id
        and e.status <> 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- 8. The admin reads every concept (archived ones included)
-- ---------------------------------------------------------------------------

create policy concepts_admin_select on public.concepts
  for select to authenticated
  using ((select private.is_admin()));
