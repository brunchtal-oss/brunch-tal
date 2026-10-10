-- Story 4.5: the audit log viewer (CAP-26, Flow 9). One read RPC for the
-- admin's /admin/audit screen: filters (session, customer, Jerusalem days),
-- keyset paging (50 rows, has_more) and names derived at read time. No
-- write, no idempotency key, no change to audit_log, private.audit or
-- private.audit_diff, and no new index (created_at, customer_id and
-- event_id are indexed). Every filter is optional (default null).
--
-- Each row's changes are built here from before/after, one entry per key,
-- so the raw jsonb never reaches the browser. Dropped keys: id, *_id,
-- created_at, updated_at, *_hash, sort_order, and (defensively) any token,
-- password or url key. "<changed>" (masked by private.audit_diff) stays as
-- is. A key missing on one side is null there.

create function public.admin_list_audit(
  p_event_id uuid default null,
  p_customer_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 50;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_from is not null and p_to is not null then
    if p_from > p_to then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'to')::text;
    end if;
    -- Both ends are included: over 366 days is refused.
    if p_to - p_from + 1 > 366 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'from')::text;
    end if;
  end if;

  -- The cursor is the last row of the previous page: both parts or none.
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'cursor')::text;
  end if;

  with page as (
    select a.*
    from public.audit_log a
    where (p_event_id is null or a.event_id = p_event_id)
      and (p_customer_id is null or a.customer_id = p_customer_id)
      and (p_from is null or a.created_at >= private.local_day_end(p_from - 1))
      and (p_to is null or a.created_at < private.local_day_end(p_to))
      and (
        p_before_created_at is null
        or (a.created_at, a.id) < (p_before_created_at, p_before_id)
      )
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ),
  numbered as (
    select
      p.*,
      row_number() over (order by p.created_at desc, p.id desc) as rn
    from page p
  )
  select jsonb_build_object(
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'created_at', n.created_at,
          'actor_kind', n.actor_kind,
          'action', n.action,
          'entity_type', n.entity_type,
          'customer', case
            when n.customer_id is null then null
            else jsonb_build_object(
              'id', n.customer_id,
              'name', case when pr.anonymized_at is null then pr.full_name end
            )
          end,
          'event', case
            when e.id is null then null
            else jsonb_build_object(
              'id', e.id,
              'title', c.name,
              'local_date', (e.starts_at at time zone 'Asia/Jerusalem')::date
            )
          end,
          'changes', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'key', k.key,
                  'before', n.before -> k.key,
                  'after', n.after -> k.key
                )
                order by k.key
              )
              from (
                select jsonb_object_keys(n.before) as key
                union
                select jsonb_object_keys(n.after) as key
              ) k
              where not (
                k.key in ('id', 'created_at', 'updated_at', 'sort_order',
                          'token', 'password', 'url')
                or k.key like '%\_id'
                or k.key like '%\_hash'
                or k.key like '%token%'
                or k.key like '%password%'
                or k.key like '%\_url'
                or k.key like 'url\_%'
              )
            ),
            '[]'::jsonb
          ),
          'reason', n.reason
        )
        order by n.rn
      ) filter (where n.rn <= v_limit),
      '[]'::jsonb
    ),
    'has_more', coalesce(max(n.rn) > v_limit, false)
  )
  into v_result
  from numbered n
  left join public.profiles pr on pr.id = n.customer_id
  left join public.events e on e.id = n.event_id
  left join public.concepts c on c.id = e.concept_id;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_audit(uuid, uuid, date, date, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_audit(uuid, uuid, date, date, timestamptz, uuid)
  to authenticated;
