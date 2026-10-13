-- Story 4.3 (CAP-42, AD-14): the open cards overview for Tal. A read RPC
-- over entitlement_balances and booking_allocations; no stored table.
--
-- Open card: kind = 'card', status = 'active', not expired, and
-- available + reserved > 0 (a unit not used yet). Pinned entitlements are
-- never listed. An import's opening balance counts by itself (an
-- opening_balance movement on the card).
--
-- p_filter: 'all', 'available' (available > 0) or 'expiring' (available > 0
-- and days_left <= business_settings.admin_expiring_days, read at call time:
-- the home's expiring_cards rule, so both are the same set). Anything else:
-- INVALID_INPUT.
--
-- Numbers come only from entitlement_balances; days_left is the Jerusalem
-- date formula of get_my_entitlements and admin_get_customer. entries is a
-- copy of admin_get_customer.entries (20261007183144): one per allocated
-- unit, cancelled bookings excluded, by starts_at, so a card reads the same
-- on both screens. Order: expires_on, customer label, entitlement_id.
create function public.admin_list_open_cards(p_filter text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold integer;
  v_today date;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_filter is null or p_filter not in ('all', 'available', 'expiring') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'paid_on', x.paid_on,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'days_left', x.days_left,
        'is_expiring', x.is_expiring,
        'entries', x.entries
      )
      order by x.expires_on, x.customer_label nulls last, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      p.paid_on,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.expires_on - v_today as days_left,
      -- The home's expiring_cards rule (admin_get_home, 20261010141240).
      coalesce(
        b.available > 0 and b.expires_on - v_today <= v_threshold,
        false
      ) as is_expiring,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and e.pinned_event_id is null
      and b.available + b.reserved > 0
  ) x
  where p_filter = 'all'
    or (p_filter = 'available' and x.available > 0)
    or (p_filter = 'expiring' and x.is_expiring);

  return v_result;
end;
$$;

revoke execute on function public.admin_list_open_cards(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_open_cards(text) to authenticated;
