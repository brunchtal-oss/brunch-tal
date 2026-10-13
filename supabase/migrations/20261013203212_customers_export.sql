-- Story 4.4: the customers CSV export (CAP-25, user decisions 2026-10-13).
-- admin_export_customers returns the rows of the file and writes one audit
-- row in the same call. Additive only: admin_list_customers,
-- admin_get_customer and the money functions are not touched.
--
-- * Scope: 'all' is every customer; 'search' is the customers matching the
--   query (2-100 characters after trimming) by private.customer_matches, the
--   live search of the list. Who is a customer and the order as in
--   admin_list_customers (not anonymized, not an admin, not-activated
--   included; last activity desc nulls last, full_name, id), without the
--   200 cap.
-- * Columns: a closed list (full_name, phone, email), non-empty, without
--   duplicates. Only the selected fields are filled; the others are null, so
--   an unselected email is never read.
-- * The email comes from auth.users (an AD-3 exception, recorded in the
--   architecture .memlog.md).
-- * The audit row holds the scope, the columns and the row count, never the
--   query text or a name. A failed validation writes nothing.
-- * Exempt from idempotency (a read with a log row; a repeat is harmless;
--   an AD-5 exemption recorded in the architecture .memlog.md).

create function public.admin_export_customers(
  p_scope text,
  p_query text,
  p_columns text[]
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
      'row_count', v_count
    ),
    null
  );

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke execute on function public.admin_export_customers(text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_export_customers(text, text, text[]) to authenticated;
