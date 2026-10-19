-- A concise audit log (spec-audit-log-concise, user decision 2026-10-18).
-- admin_list_audit now lists only the actions worth checking later: the
-- caller passes the whitelist (p_shown, from lib/copy/audit-actions.ts) as
-- "{action}/{entity_type}" pairs, or "{action}/{entity_type}/insert" when
-- only a created row of that pair is the operation's main row. Each listed
-- row brings the other rows of the same operation (same created_at, action
-- and actor, and the same customer, or none, when the main row has one;
-- rows with no visible change are left out) as related,
-- so one operation is one item and paging and counts stay correct.
--
-- The customer of a row is derived at read time: customer_id, else the
-- profile itself, else the current customer of the payment, link,
-- booking, entitlement, credit or refund request (bind_purchase fills them
-- later), else customer_id in before/after. The session and customer
-- filters match an operation when its main row or any related row matches.
-- Derived at read time too: a booking's funding, a subject (a product's or concept's name, a
-- content section's "{page}/{key}", a template's type) and a refund
-- request's current amount.
--
-- Nothing that writes the log changes (audit_log, private.audit and every
-- writer stay as they are). A read, no idempotency key. Has a drop: run in
-- the SQL Editor (AGENTS.md).

drop function public.admin_list_audit(uuid, uuid, date, date, timestamptz, uuid);

-- One row's changes, one entry per key, as admin_list_audit returned them
-- (story 4.5): keys id, *_id, created_at, updated_at, *_hash, sort_order and
-- any token, password or url key are dropped; "<changed>" stays as is; a key
-- missing on one side is null there.
create function private.audit_changes(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', k.key,
          'before', p_before -> k.key,
          'after', p_after -> k.key
        )
        order by k.key
      )
      from (
        select jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) as key
        union
        select jsonb_object_keys(coalesce(p_after, '{}'::jsonb)) as key
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
  );
$$;

-- A session's label parts: {id, title (the concept), local_date}, or null
-- when the session is gone.
create function private.audit_event_label(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'title', c.name,
    'local_date', (e.starts_at at time zone 'Asia/Jerusalem')::date
  )
  from public.events e
  left join public.concepts c on c.id = e.concept_id
  where e.id = p_event_id;
$$;

-- A uuid inside before/after (customer_id), or null.
create function private.audit_json_uuid(p_value jsonb, p_key text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value -> p_key) = 'string'
     and (p_value ->> p_key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (p_value ->> p_key)::uuid
  end;
$$;

revoke execute on function private.audit_changes(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.audit_event_label(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.audit_json_uuid(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.admin_list_audit(
  p_shown text[],
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

  -- The whitelist: "{action}/{entity_type}" or "{action}/{entity_type}/insert".
  if p_shown is null
     or cardinality(p_shown) = 0
     or exists (
       select 1 from unnest(p_shown) as s
       where s is null or s !~ '^[a-z_]+/[a-z_]+(/insert)?$'
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'shown')::text;
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

  -- The cursor is the last main row of the previous page: both parts or none.
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'cursor')::text;
  end if;

  with shown as (
    select
      split_part(s, '/', 1) as action,
      split_part(s, '/', 2) as entity_type,
      split_part(s, '/', 3) = 'insert' as insert_only
    from unnest(p_shown) as s
  ),
  -- Every row in the date range, with its derived customer and whether it
  -- is a main row (its pair is shown; an insert-only pair needs a created
  -- row: private.audit stores an empty before for it).
  scoped as (
    select
      a.id,
      a.created_at,
      a.actor_id,
      a.actor_kind,
      a.action,
      a.entity_type,
      a.entity_id,
      a.event_id,
      a.before,
      a.after,
      a.reason,
      coalesce(
        a.customer_id,
        case a.entity_type
          when 'profiles' then a.entity_id
          when 'payments' then (
            select pay.customer_id from public.payments pay
            where pay.id = a.entity_id
          )
          when 'activation_tokens' then (
            select t.customer_id from public.activation_tokens t
            where t.id = a.entity_id
          )
          when 'bookings' then (
            select b.customer_id from public.bookings b
            where b.id = a.entity_id
          )
          -- Filled later by bind_purchase.
          when 'entitlements' then (
            select en.customer_id from public.entitlements en
            where en.id = a.entity_id
          )
          when 'cancellation_credits' then (
            select cc.customer_id from public.cancellation_credits cc
            where cc.id = a.entity_id
          )
          when 'refund_requests' then (
            select rr.customer_id from public.refund_requests rr
            where rr.id = a.entity_id
          )
        end,
        private.audit_json_uuid(a.after, 'customer_id'),
        private.audit_json_uuid(a.before, 'customer_id')
      ) as customer_id,
      exists (
        select 1
        from shown s
        where s.action = a.action
          and s.entity_type = a.entity_type
          and (
            not s.insert_only
            or (
              coalesce(a.before, '{}'::jsonb) = '{}'::jsonb
              and coalesce(a.after, '{}'::jsonb) <> '{}'::jsonb
            )
          )
      ) as is_primary
    from public.audit_log a
    where (p_from is null or a.created_at >= private.local_day_end(p_from - 1))
      and (p_to is null or a.created_at < private.local_day_end(p_to))
  ),
  primaries as (
    select p.*
    from scoped p
    where p.is_primary
      and (
        p_before_created_at is null
        or (p.created_at, p.id) < (p_before_created_at, p_before_id)
      )
  ),
  -- The other rows of each main row's operation. A row with no visible
  -- change (empty, or only dropped keys such as moved_to_booking_id) is
  -- noise and is left out.
  links as (
    select p.id as primary_id, r.*
    from primaries p
    join scoped r
      on r.created_at = p.created_at
     and r.action = p.action
     and r.actor_id is not distinct from p.actor_id
     and r.id <> p.id
     and not r.is_primary
     and (
       p.customer_id is null
       or r.customer_id is null
       or r.customer_id = p.customer_id
     )
     and private.audit_changes(r.before, r.after) <> '[]'::jsonb
  ),
  -- Each operation's sessions and customers from its related rows, once.
  link_keys as (
    select
      l.primary_id,
      array_agg(l.event_id) filter (where l.event_id is not null) as event_ids,
      array_agg(l.customer_id) filter (where l.customer_id is not null)
        as customer_ids
    from links l
    group by l.primary_id
  ),
  page as (
    select p.*
    from primaries p
    left join link_keys k on k.primary_id = p.id
    where (
        p_event_id is null
        or p.event_id = p_event_id
        or coalesce(p_event_id = any (k.event_ids), false)
      )
      and (
        p_customer_id is null
        or p.customer_id = p_customer_id
        or coalesce(p_customer_id = any (k.customer_ids), false)
      )
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  ),
  -- The related rows of the page only.
  page_links as (
    select l.*
    from links l
    join page pg on pg.id = l.primary_id
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
              'name', (
                select case when pr.anonymized_at is null then pr.full_name end
                from public.profiles pr
                where pr.id = n.customer_id
              )
            )
          end,
          'event', private.audit_event_label(n.event_id),
          -- What the row is about when it is not a customer or a session:
          -- a product's or concept's name (a deleted concept: its name in
          -- before), a content section's "{page}/{key}", a template's type.
          'subject', case n.entity_type
            when 'products' then (
              select pd.name from public.products pd where pd.id = n.entity_id
            )
            when 'concepts' then coalesce(
              (select c.name from public.concepts c where c.id = n.entity_id),
              n.before ->> 'name',
              n.after ->> 'name'
            )
            when 'content_sections' then (
              select cs.page_slug || '/' || cs.key
              from public.content_sections cs
              where cs.id = n.entity_id
            )
            when 'notification_templates' then
              coalesce(n.after ->> 'type', n.before ->> 'type')
          end,
          -- A refund request's current amount: a full refund leaves it
          -- unchanged, so it is not in the row's changes.
          'amount_agorot', case n.entity_type
            when 'refund_requests' then (
              select rr.amount_agorot from public.refund_requests rr
              where rr.id = n.entity_id
            )
          end,
          -- How a booking was paid ('card', 'credit' or 'pinned', from
          -- private.booking_funding), read now: cancelling a credit-paid
          -- booking returns the credit without an audit row of its own.
          'funding', case n.entity_type
            when 'bookings' then private.booking_funding(n.entity_id) ->> 'funding'
          end,
          'changes', private.audit_changes(n.before, n.after),
          'related', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'entity_type', l.entity_type,
                  'changes', private.audit_changes(l.before, l.after),
                  'event', private.audit_event_label(l.event_id)
                )
                order by l.entity_type, l.id
              )
              from page_links l
              where l.primary_id = n.id
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
  from numbered n;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_audit(text[], uuid, uuid, date, date, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_audit(text[], uuid, uuid, date, date, timestamptz, uuid)
  to authenticated;
