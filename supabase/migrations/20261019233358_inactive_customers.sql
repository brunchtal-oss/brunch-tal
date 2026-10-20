-- Story 5.13: inactive customers (source §7, CAP-28, CAP-25; AD-14).
-- "Inactive" is derived at read time by private.customer_activity; nothing
-- is stored and no job marks it. The marking neither blocks sign-in nor
-- deletes anything; admin_get_customer is unchanged.
--
-- * private.customer_activity(customer_id): 'inactive' when all of
--   (a) anchor + business_settings.inactivity_months months <= today, both
--       Asia/Jerusalem local dates, where anchor = the latest of
--       private.customer_last_activity_on (a completed session, an approved
--       payment, a booking's creation) and the profile's created_at day
--       (a customer who never participated counts from her account);
--   (b) no confirmed booking;
--   (c) no active, unexpired entitlement with available or reserved entries;
--   (d) no cancellation credit active or refund_requested;
--   (e) no refund request still requested.
--   Otherwise 'active'. Also used by 5.12 (broadcast "active only"). No
--   grant: called only from definer functions. It does not exclude
--   anonymized profiles or admins: a caller (5.12) filters them itself, as
--   admin_list_customers does. An unknown id returns null.
-- * admin_list_customers(p_query, p_activity): as in
--   20261007121030_customers_phone_check.sql, filtered by p_activity
--   ('active' | 'inactive', else INVALID_INPUT, detail field activity). Each
--   row adds inactive; the result adds inactive_hidden = the matching
--   inactive customers when p_activity = 'active', else 0.
-- * admin_export_customers(p_scope, p_query, p_columns, p_activity): as in
--   20261013203212_customers_export.sql. 'search' exports what the list
--   shows (the query with the chosen filter, p_activity required); 'all'
--   stays every customer, active and inactive (p_activity must be null).
--   The audit after-json adds activity.
-- Contains a drop: run it in the SQL Editor, not through apply_migration.

create function private.customer_activity(p_customer_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select
    case
      when (
          greatest(
            private.customer_last_activity_on(p.id),
            (p.created_at at time zone 'Asia/Jerusalem')::date
          ) + make_interval(months => s.inactivity_months)
        )::date <= (now() at time zone 'Asia/Jerusalem')::date
        and not exists (
          select 1
          from public.bookings b
          where b.customer_id = p.id
            and b.status = 'confirmed'
        )
        and not exists (
          select 1
          from public.entitlement_balances e
          where e.customer_id = p.id
            and e.status = 'active'
            and not e.is_expired
            and (e.available > 0 or e.reserved > 0)
        )
        and not exists (
          select 1
          from public.cancellation_credits c
          where c.customer_id = p.id
            and c.status in ('active', 'refund_requested')
        )
        and not exists (
          select 1
          from public.refund_requests r
          where r.customer_id = p.id
            and r.status = 'requested'
        )
      then 'inactive'
      else 'active'
    end
  from public.profiles p
  cross join public.business_settings s
  where p.id = p_customer_id;
$$;

revoke execute on function private.customer_activity(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The customers list
-- ---------------------------------------------------------------------------

drop function public.admin_list_customers(text);

create function public.admin_list_customers(p_query text, p_activity text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(p_query);
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_activity is null or p_activity not in ('active', 'inactive') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'activity')::text;
  end if;

  if char_length(v_query) > 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object(
      'customers', '[]'::jsonb,
      'has_more', false,
      'inactive_hidden', 0
    );
  end if;

  with matched as (
    select
      p.id,
      p.full_name,
      p.phone_e164,
      p.activated_at is not null as activated,
      private.customer_last_activity_on(p.id) as last_activity_on,
      private.customer_activity(p.id) = 'inactive' as inactive
    from public.profiles p
    where p.anonymized_at is null
      and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
      and private.customer_matches(p.full_name, p.phone_e164, v_query)
  ),
  ranked as (
    select
      m.*,
      row_number() over (
        order by m.last_activity_on desc nulls last, m.full_name, m.id
      ) as rn
    from matched m
    where m.inactive = (p_activity = 'inactive')
  )
  select jsonb_build_object(
    'customers', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'full_name', r.full_name,
          'phone_e164', r.phone_e164,
          'activated', r.activated,
          'last_activity_on', r.last_activity_on,
          'inactive', r.inactive
        )
        order by r.rn
      ) filter (where r.rn <= 200),
      '[]'::jsonb
    ),
    'has_more', coalesce(max(r.rn) > 200, false),
    'inactive_hidden', case
      when p_activity = 'active' then (
        select count(*)::integer from matched m where m.inactive
      )
      else 0
    end
  )
  into v_result
  from ranked r
  where r.rn <= 201;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_customers(text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customers(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The customers export
-- ---------------------------------------------------------------------------

drop function public.admin_export_customers(text, text, text[]);

create function public.admin_export_customers(
  p_scope text,
  p_query text,
  p_columns text[],
  p_activity text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_query text := btrim(p_query);
  v_name boolean;
  v_phone boolean;
  v_email boolean;
  v_rows jsonb;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_scope is null or p_scope not in ('all', 'search') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'scope')::text;
  end if;

  if p_scope = 'search'
     and (v_query is null or char_length(v_query) not between 2 and 100) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;

  if (p_scope = 'all' and p_activity is not null)
     or (
       p_scope = 'search'
       and (p_activity is null or p_activity not in ('active', 'inactive'))
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'activity')::text;
  end if;

  if p_columns is null
     or coalesce(cardinality(p_columns), 0) = 0
     or not (p_columns <@ array['full_name', 'phone', 'email']::text[])
     or cardinality(p_columns)
        <> (select count(distinct c) from unnest(p_columns) c) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'columns')::text;
  end if;

  v_name := 'full_name' = any (p_columns);
  v_phone := 'phone' = any (p_columns);
  v_email := 'email' = any (p_columns);

  with matched as (
    select
      p.id,
      p.full_name,
      p.phone_e164,
      private.customer_last_activity_on(p.id) as last_activity_on
    from public.profiles p
    where p.anonymized_at is null
      and not exists (select 1 from public.admin_roles a where a.user_id = p.id)
      and (
        p_scope = 'all'
        or (
          private.customer_matches(p.full_name, p.phone_e164, v_query)
          and private.customer_activity(p.id) = p_activity
        )
      )
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'full_name', case when v_name then m.full_name end,
          'phone_e164', case when v_phone then m.phone_e164 end,
          'email', case when v_email then (
            select u.email from auth.users u where u.id = m.id
          ) end
        )
        order by m.last_activity_on desc nulls last, m.full_name, m.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_rows, v_count
  from matched m;

  perform private.audit(
    v_actor, 'admin', 'admin_export_customers', 'profiles',
    null, null, null, null,
    jsonb_build_object(
      'scope', p_scope,
      'columns', to_jsonb(p_columns),
      'activity', p_activity,
      'row_count', v_count
    ),
    null
  );

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke execute on function public.admin_export_customers(text, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.admin_export_customers(text, text, text[], text) to authenticated;
