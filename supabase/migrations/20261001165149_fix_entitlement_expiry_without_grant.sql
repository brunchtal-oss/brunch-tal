-- Story 2.1 fix: the time helpers have no grant (AD-8). entitlement_balances
-- (security_invoker) called private.local_day_end as the caller, which needed
-- a grant to authenticated. The exact expiry is now a generated column on
-- entitlements, computed by the owner on every write with the same helper,
-- and the view reads it. "Expired" stays derived (now() against it).

revoke execute on function private.local_day_end(date) from public, anon, authenticated, service_role;

alter table public.entitlements
  add column expires_at timestamptz
    generated always as (private.local_day_end(expires_on)) stored;

create or replace view public.entitlement_balances
with (security_invoker = true)
as
select
  e.id as entitlement_id,
  e.customer_id,
  e.payment_id,
  e.kind,
  e.status,
  e.original_units,
  e.valid_from,
  e.expires_on,
  coalesce(a.available, 0)::integer as available,
  coalesce(r.reserved, 0)::integer as reserved,
  coalesce(r.used, 0)::integer as used,
  e.expires_at,
  now() >= e.expires_at as is_expired
from public.entitlements e
left join lateral (
  select sum(m.units) as available
  from public.entitlement_movements m
  where m.entitlement_id = e.id
) a on true
left join lateral (
  select
    sum(-b.net) filter (where not b.has_use) as reserved,
    sum(-b.net) filter (where b.has_use) as used
  from (
    select
      m.booking_id,
      coalesce(sum(m.units) filter (where m.action in ('reserve', 'release')), 0) as net,
      bool_or(m.action = 'use') as has_use
    from public.entitlement_movements m
    where m.entitlement_id = e.id
      and m.booking_id is not null
    group by m.booking_id
  ) b
) r on true;
