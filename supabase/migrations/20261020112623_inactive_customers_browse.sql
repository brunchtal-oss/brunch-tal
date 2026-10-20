-- Story 5.13, iteration 1 (user decision 2026-10-20, phone check): inactive
-- customers are not hidden. The search shows every match with its inactive
-- flag; three categories (all / active / inactive) each list a whole group;
-- the export exports what the screen shows. Same signatures as
-- 20261019233358_inactive_customers.sql (create or replace, no drop);
-- private.customer_activity is unchanged.
--
-- * admin_list_customers(p_query, p_activity): p_activity in ('all',
--   'active', 'inactive'), else INVALID_INPUT (activity). The query is
--   trimmed; over 100 characters -> INVALID_INPUT (query). An empty query
--   lists the whole category (browse); 1 character -> an empty list; 2+ ->
--   the matches within the category. Same order, 200 rows + has_more; each
--   row has inactive. No inactive_hidden.
-- * admin_export_customers(p_scope, p_query, p_columns, p_activity):
--   p_activity in ('all', 'active', 'inactive') for both scopes, else
--   INVALID_INPUT (activity). 'all' = the whole category; 'search' = the
--   query (2-100 characters) within the category. No cap. The audit
--   after-json keeps activity.

-- ---------------------------------------------------------------------------
-- The customers list
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_customers(p_query text, p_activity text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := coalesce(btrim(p_query), '');
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_activity is null or p_activity not in ('all', 'active', 'inactive') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'activity')::text;
  end if;

  if char_length(v_query) > 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'query')::text;
  end if;
  -- One character: nothing yet (the search starts at two).
  if char_length(v_query) = 1 then
    return jsonb_build_object('customers', '[]'::jsonb, 'has_more', false);
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
      and (
        v_query = ''
        or private.customer_matches(p.full_name, p.phone_e164, v_query)
      )
  ),
  ranked as (
    select
      m.*,
      row_number() over (
        order by m.last_activity_on desc nulls last, m.full_name, m.id
      ) as rn
    from matched m
    where p_activity = 'all' or m.inactive = (p_activity = 'inactive')
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
    'has_more', coalesce(max(r.rn) > 200, false)
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

create or replace function public.admin_export_customers(
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

  if p_activity is null or p_activity not in ('all', 'active', 'inactive') then
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
        or private.customer_matches(p.full_name, p.phone_e164, v_query)
      )
      and (
        p_activity = 'all'
        or private.customer_activity(p.id) = p_activity
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
