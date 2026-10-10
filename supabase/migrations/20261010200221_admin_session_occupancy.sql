-- The admin sessions list (/admin/sessions) shows each session's occupancy
-- (out-of-tree fix 2026-10-10). One read RPC: for the listed ids, the places
-- taken, only from private.occupied_places (AD-6: the single place that sums
-- party_size; a couple booking counts 2, a pinned booking with no customer
-- yet counts, a cancelled one does not). Admin only; a read, so no
-- idempotency key (AD-5). No cardinality cap: the ids come from the admin's
-- own list. Unknown ids are omitted. No change to private.occupied_places.

create function public.admin_list_session_occupancy(p_event_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_event_ids is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', e.id,
        'occupied', private.occupied_places(e.id)
      )
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.events e
  where e.id = any (p_event_ids);

  return v_result;
end;
$$;

revoke execute on function public.admin_list_session_occupancy(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_session_occupancy(uuid[]) to authenticated;
