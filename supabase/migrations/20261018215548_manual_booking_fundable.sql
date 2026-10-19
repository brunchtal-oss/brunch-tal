-- Story 3.19: the manual booking screen (/admin/sessions/book?customer=)
-- lists only the open sessions one customer can be booked for.
--
-- Additive only: admin_list_bookable_events stays as it is (the pinned
-- product approval form needs the unfiltered list), and private.plan_funding,
-- admin_book_customer and preview_admin_book_customer are unchanged.

-- The open sessions of admin_list_bookable_events (published and not
-- started, same row fields, same order: starts_at, id), keeping only those
-- private.plan_funding(customer, event, party, 'admin') funds (party = 2 for
-- a couple session, else 1, as admin_book_customer) and those she already
-- has a confirmed booking for. Fullness is not a filter. Returns
-- {events: [...], hidden: int}, hidden = every other open session. Admin
-- only; the customer must exist, be activated and not anonymized
-- (CUSTOMER_NOT_AVAILABLE, as admin_book_customer, no lock). Her credits'
-- options are refreshed first (private.refresh_customer_credits, as
-- preview_admin_book_customer), so a replacement option is funded; that
-- write makes the function volatile. A read for the caller, so no
-- idempotency key (AD-5).
create function public.admin_list_customer_bookable_events(p_customer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_events jsonb;
  v_hidden integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.id into v_customer
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null;

  if v_customer is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  perform private.refresh_customer_credits(v_customer);

  with open_events as (
    select
      e.id,
      e.starts_at,
      e.kind,
      e.capacity_adults,
      c.name as concept_name,
      (
        exists (
          select 1
          from public.bookings b
          where b.customer_id = v_customer
            and b.event_id = e.id
            and b.status = 'confirmed'
        )
        or (
          private.plan_funding(
            v_customer,
            e.id,
            case when e.kind = 'couple' then 2 else 1 end,
            'admin'
          ) ->> 'ok'
        )::boolean
      ) as kept
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.starts_at > now()
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'starts_at', o.starts_at,
          'kind', o.kind,
          'local_date', (o.starts_at at time zone 'Asia/Jerusalem')::date,
          'weekday', extract(dow from (o.starts_at at time zone 'Asia/Jerusalem'))::integer,
          'concept_name', o.concept_name,
          'occupied', private.occupied_places(o.id),
          'capacity', o.capacity_adults
        )
        order by o.starts_at, o.id
      ) filter (where o.kept),
      '[]'::jsonb
    ),
    count(*) filter (where not o.kept)::integer
  into v_events, v_hidden
  from open_events o;

  return jsonb_build_object('events', v_events, 'hidden', v_hidden);
end;
$$;

revoke execute on function public.admin_list_customer_bookable_events(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customer_bookable_events(uuid) to authenticated;
