-- Story 3.6 fix: since 20261005232647 the booked state of
-- public.preview_book_session carries product_name (what a cancel returns).
-- public.preview_book_sessions copied product_name from every date, so a
-- booked date now showed one. As in 20261005171826, except product_name is
-- taken only from a date that is ok (the entitlement that would be used).

create or replace function public.preview_book_sessions(p_items uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_available integer;
  v_id uuid;
  v_preview jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_items is null
     or cardinality(p_items) > 200
     or exists (select 1 from unnest(p_items) i where i is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select coalesce(sum(b.available), 0)::integer into v_available
  from public.entitlements e
  join public.entitlement_balances b on b.entitlement_id = e.id
  where e.customer_id = v_customer
    and e.status = 'active'
    and e.pinned_event_id is null
    and e.expires_on >= (now() at time zone 'Asia/Jerusalem')::date;

  for v_id in
    select d.i
    from (select distinct i from unnest(p_items) i) d
    left join public.events e on e.id = d.i
    order by e.starts_at nulls last, d.i
  loop
    v_preview := public.preview_book_session(v_id);

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'event_id', v_id,
        'ok', (v_preview ->> 'ok')::boolean,
        'code', case
          when (v_preview ->> 'booked')::boolean then 'ALREADY_BOOKED'
          else v_preview ->> 'code'
        end,
        'product_name', case
          when (v_preview ->> 'ok')::boolean then v_preview ->> 'product_name'
        end,
        'cancel_deadline', v_preview -> 'cancel_deadline'
      ))
    );
  end loop;

  return jsonb_build_object('available', v_available, 'results', v_results);
end;
$$;

revoke execute on function public.preview_book_sessions(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.preview_book_sessions(uuid[]) to authenticated;
