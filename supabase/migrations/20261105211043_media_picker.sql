-- fix-media-picker: choose an already uploaded image in every admin image
-- field (user decision 2026-11-05). Choosing makes a copy: a new media_assets
-- row in state draft whose draft file is copied (by the admin's own session,
-- under the existing storage insert policy) from the chosen one. From there
-- it is a fresh upload: the same save, publish and hide. One media_id is
-- never shared between two places, since alt text and focus live on the row.
-- 1. media_assets.source_id: the original a copy was made from (always the
--    original: a copy of a copy points at the first one). No grant on the
--    new column to anon or authenticated (the column grants stay as they are).
-- 2. admin_list_media(): the images on the site now, one row per family
--    (original + copies) that has a member in private.used_media_ids(),
--    keyed by the original whose draft file exists. Read only, no key (AD-5).
-- 3. admin_copy_media(p_source_id, p_idempotency_key): the new draft row.
--    Idempotent (AD-5). No audit row, like admin_create_media.
-- No change to hide_unused_media, used_media_ids, the publish RPCs or
-- admin_set_*_image.

alter table public.media_assets
  add column source_id uuid references public.media_assets (id);

create index media_assets_source_id_idx on public.media_assets (source_id);

-- ---------------------------------------------------------------------------
-- admin_list_media
-- ---------------------------------------------------------------------------

-- Result: [{id, created_at, alt_text, focus_x, focus_y}], newest first. id is
-- the family's original. alt_text and the focus come from the family row
-- with the latest updated_at and an alt text, else from the original.
create function public.admin_list_media()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_used uuid[];
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_used := private.used_media_ids();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'created_at', o.created_at,
        'alt_text', case when f.alt_text is not null then f.alt_text else o.alt_text end,
        'focus_x', case when f.alt_text is not null then f.focus_x else o.focus_x end,
        'focus_y', case when f.alt_text is not null then f.focus_y else o.focus_y end
      )
      order by o.created_at desc, o.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.media_assets o
  left join lateral (
    select m.alt_text, m.focus_x, m.focus_y
    from public.media_assets m
    where (m.id = o.id or m.source_id = o.id)
      and m.alt_text is not null
    order by m.updated_at desc, m.id desc
    limit 1
  ) f on true
  where o.source_id is null
    and exists (
      select 1
      from public.media_assets u
      where (u.id = o.id or u.source_id = o.id)
        and u.id = any (v_used)
    )
    and exists (
      select 1
      from storage.objects so
      where so.bucket_id = 'media-drafts'
        and so.name = o.storage_path
    );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_copy_media
-- ---------------------------------------------------------------------------

-- A new draft row copied from p_source_id: its source_id is the source's
-- original. The source's draft file must exist (MEDIA_NOT_UPLOADED); an
-- unknown id -> NOT_FOUND. The server action then copies
-- media-drafts/<source_path> to media-drafts/<media_id>.
-- Result: {media_id, storage_path, source_path}.
create function public.admin_copy_media(p_source_id uuid, p_idempotency_key uuid)
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
  v_source public.media_assets;
  v_new public.media_assets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_copy_media', p_idempotency_key,
    jsonb_build_object('source_id', p_source_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select m.* into v_source
  from public.media_assets m
  where m.id = p_source_id;

  if v_source.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media-drafts'
      and o.name = v_source.storage_path
  ) then
    raise exception 'MEDIA_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  insert into public.media_assets (id, storage_path, public_path, created_by, source_id)
  values (
    v_id, v_id::text, v_id::text || '.jpg', v_actor,
    coalesce(v_source.source_id, v_source.id)
  )
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_copy_media', p_idempotency_key,
    jsonb_build_object(
      'media_id', v_new.id,
      'storage_path', v_new.storage_path,
      'source_path', v_source.storage_path
    )
  );
end;
$$;

revoke execute on function public.admin_list_media() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_media() to authenticated;

revoke execute on function public.admin_copy_media(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_copy_media(uuid, uuid) to authenticated;
