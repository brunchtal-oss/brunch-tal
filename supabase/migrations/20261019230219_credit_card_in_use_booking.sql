-- Story 3.16, phone check (user decision 2026-10-20): the customer card
-- names the session an in-use credit funds and links to it.
--
-- admin_list_customer_credits as in 20261019204039, plus per credit
-- in_use_booking: {booking_id, event_id, starts_at, concept_name} of the
-- confirmed booking allocated to the credit (the one that keeps it in use),
-- or null. Same signature, revoke and grant.

create or replace function public.admin_list_customer_credits(p_customer_id uuid)
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'credit_id', c.id,
        'status', c.status,
        'choice_pending', c.choice_pending,
        'party_size', c.party_size,
        'origin_starts_at', c.origin_starts_at,
        'concept_name', oc.name,
        'monetary_basis_agorot', c.monetary_basis_agorot,
        'refund', case
          when rr.id is not null then jsonb_build_object(
            'refund_request_id', rr.id,
            'status', rr.status,
            'amount_agorot', rr.amount_agorot,
            'requested_at', rr.requested_at,
            'refunded_on', rr.refunded_on,
            'reference', rr.reference
          )
        end,
        'options_count', c.options_count,
        'options', coalesce(o.options, '[]'::jsonb),
        'in_use', u.in_use,
        'in_use_booking', ub.item,
        'exhausted', c.status = 'active'
          and not c.choice_pending
          and not u.in_use
          and coalesce(o.active_count, 0) = 0
          and coalesce(o.counted, 0) >= c.options_count
      )
      order by c.created_at desc, c.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.cancellation_credits c
  join public.bookings ob on ob.id = c.origin_booking_id
  join public.events oe on oe.id = ob.event_id
  join public.concepts oc on oc.id = oe.concept_id
  left join public.refund_requests rr on rr.credit_id = c.id
  cross join lateral (
    select private.credit_in_use(c.id) as in_use
  ) u
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'event_id', e.id,
          'starts_at', e.starts_at,
          'concept_name', cc.name,
          'state', op.state,
          'added_by', op.added_by
        )
        order by e.starts_at, e.id
      ) as options,
      count(*) filter (where op.state = 'active') as active_count,
      count(*) as counted
    from public.credit_options op
    join public.events e on e.id = op.event_id
    join public.concepts cc on cc.id = e.concept_id
    where op.credit_id = c.id
      and op.state in ('active', 'used', 'passed')
  ) o on true
  left join lateral (
    select jsonb_build_object(
      'booking_id', b.id,
      'event_id', e.id,
      'starts_at', e.starts_at,
      'concept_name', cc.name
    ) as item
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    join public.events e on e.id = b.event_id
    join public.concepts cc on cc.id = e.concept_id
    where a.credit_id = c.id
      and b.status = 'confirmed'
    order by e.starts_at, b.id
    limit 1
  ) ub on true
  where c.customer_id = p_customer_id;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_customer_credits(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_customer_credits(uuid) to authenticated;
