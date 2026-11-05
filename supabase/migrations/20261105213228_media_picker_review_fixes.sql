-- fix-media-picker, review fixes (20261105211043_media_picker is applied on
-- dev, so the two RPCs are replaced here with the same signatures).
-- 1. admin_copy_media copies only a family on the site now (a member in
--    private.used_media_ids()); an image taken off the site (hidden, or
--    never used) is NOT_FOUND, even from a stale list or another tab.
-- 2. admin_list_media: alt and focus come first from a member in use (a
--    copy just taken off the site has the latest updated_at, set by
--    hide_unused_media, and must not override the one on the site); then
--    the latest updated_at. Each row also has public_path: the published
--    member in use with the latest updated_at, for a small optimized
--    thumbnail (next/image) instead of the full draft file.

create or replace function public.admin_list_media()
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
        'focus_y', case when f.alt_text is not null then f.focus_y else o.focus_y end,
        'public_path', p.public_path
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
    order by (m.id = any (v_used)) desc, m.updated_at desc, m.id desc
    limit 1
  ) f on true
  left join lateral (
    select m.public_path
    from public.media_assets m
    where (m.id = o.id or m.source_id = o.id)
      and m.id = any (v_used)
      and m.publish_state = 'published'
    order by m.updated_at desc, m.id desc
    limit 1
  ) p on true
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

create or replace function public.admin_copy_media(p_source_id uuid, p_idempotency_key uuid)
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
  v_root uuid;
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

  v_root := coalesce(v_source.source_id, v_source.id);

  -- Only an image on the site now (the list's rule).
  if not exists (
    select 1
    from public.media_assets u
    where (u.id = v_root or u.source_id = v_root)
      and u.id = any (private.used_media_ids())
  ) then
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
  values (v_id, v_id::text, v_id::text || '.jpg', v_actor, v_root)
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
