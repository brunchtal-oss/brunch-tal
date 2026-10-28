-- Story 5.24 (user decision 2026-10-28): the marketing tags. Three tool IDs
-- (Google Analytics 4, Google Tag Manager, Meta Pixel) that the public site
-- loads for every visitor; never code. A null ID turns that tool off.
--
-- 1. public.marketing_tags: one row (like business_settings), all IDs null.
--    Read by anyone (the public layout reads it cached with the anon
--    client), but anon sees only the three ID columns. No write grant.
-- 2. admin_update_marketing_tags: the only writer (AD-5).
--
-- The formats are the same as lib/marketing-tags.ts.

-- ---------------------------------------------------------------------------
-- 1. public.marketing_tags
-- ---------------------------------------------------------------------------

create table public.marketing_tags (
  id boolean primary key default true check (id),
  ga4_measurement_id text
    check (ga4_measurement_id ~ '^G-[A-Z0-9]{4,15}$'),
  gtm_container_id text
    check (gtm_container_id ~ '^GTM-[A-Z0-9]{4,12}$'),
  meta_pixel_id text
    check (meta_pixel_id ~ '^[0-9]{10,20}$'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

insert into public.marketing_tags (id) values (true)
on conflict do nothing;

alter table public.marketing_tags enable row level security;

create policy marketing_tags_public_select on public.marketing_tags
  for select to anon, authenticated
  using (true);

revoke all on table public.marketing_tags from public, anon, authenticated, service_role;
grant select (ga4_measurement_id, gtm_container_id, meta_pixel_id)
  on table public.marketing_tags to anon;
grant select on table public.marketing_tags to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. admin_update_marketing_tags
-- ---------------------------------------------------------------------------

-- Sets all three IDs against the version the screen read (STALE_VERSION,
-- checked right after the lock, before the values, like 4.7). Each value is
-- trimmed (also NBSP) and upper-cased; blank = null = off; any other value
-- must match its format (INVALID_INPUT with the field). The same values
-- change nothing (no new version, no audit). Result: the three IDs and the
-- version.
create function public.admin_update_marketing_tags(
  p_ga4_measurement_id text,
  p_gtm_container_id text,
  p_meta_pixel_id text,
  p_expected_version integer,
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
  v_ga4 text := nullif(upper(btrim(p_ga4_measurement_id, E' \t\r\n' || chr(160))), '');
  v_gtm text := nullif(upper(btrim(p_gtm_container_id, E' \t\r\n' || chr(160))), '');
  v_pixel text := nullif(btrim(p_meta_pixel_id, E' \t\r\n' || chr(160)), '');
  v_strip text[] := array['id', 'version', 'updated_at'];
  v_old public.marketing_tags;
  v_new public.marketing_tags;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_marketing_tags', p_idempotency_key,
    jsonb_build_object(
      'ga4_measurement_id', p_ga4_measurement_id,
      'gtm_container_id', p_gtm_container_id,
      'meta_pixel_id', p_meta_pixel_id,
      'expected_version', p_expected_version
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select t.* into v_old
  from public.marketing_tags t
  where t.id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
  end if;

  if v_ga4 is not null and v_ga4 !~ '^G-[A-Z0-9]{4,15}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"ga4_measurement_id"}';
  end if;

  if v_gtm is not null and v_gtm !~ '^GTM-[A-Z0-9]{4,12}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"gtm_container_id"}';
  end if;

  if v_pixel is not null and v_pixel !~ '^[0-9]{10,20}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"meta_pixel_id"}';
  end if;

  v_new := v_old;
  if v_ga4 is distinct from v_old.ga4_measurement_id
     or v_gtm is distinct from v_old.gtm_container_id
     or v_pixel is distinct from v_old.meta_pixel_id then
    update public.marketing_tags t
    set ga4_measurement_id = v_ga4,
        gtm_container_id = v_gtm,
        meta_pixel_id = v_pixel,
        version = t.version + 1,
        updated_at = now()
    where t.id
    returning t.* into v_new;

    perform private.audit(
      v_actor, 'admin', 'admin_update_marketing_tags', 'marketing_tags',
      null, null, null, to_jsonb(v_old) - v_strip, to_jsonb(v_new) - v_strip
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_marketing_tags', p_idempotency_key,
    jsonb_build_object(
      'ga4_measurement_id', v_new.ga4_measurement_id,
      'gtm_container_id', v_new.gtm_container_id,
      'meta_pixel_id', v_new.meta_pixel_id,
      'version', v_new.version
    )
  );
end;
$$;

revoke execute on function public.admin_update_marketing_tags(text, text, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_marketing_tags(text, text, text, integer, uuid) to authenticated;
