-- Story 3.11: an intro only for a customer without bookings (user decision
-- 2026-10-05, SPEC memlog). private.intro_blocked (same signature, create or
-- replace) is also true when the customer has any booking that is confirmed
-- or completed, future ones included, other than the bookings of
-- p_payment_id (the purchase being checked). A cancelled booking never
-- counts. An intro for a couple session stays EVENT_NOT_FIT
-- (private.plan_pinned_placement). AD-5 grants re-stated.

-- The customer cannot get an intro: she took part (private.has_participated),
-- she has a confirmed or completed booking other than the ones of
-- p_payment_id, or she has an active intro entitlement (kind 'intro' or
-- intro_only) other than the one of p_payment_id (null before it exists).
create or replace function private.intro_blocked(p_customer_id uuid, p_payment_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_participated(p_customer_id)
    or exists (
      select 1
      from public.bookings b
      where b.customer_id = p_customer_id
        and b.status in ('confirmed', 'completed')
        -- A self-booking has no payment_id: it always counts.
        and (p_payment_id is null or b.payment_id is distinct from p_payment_id)
    )
    or exists (
      select 1
      from public.entitlements e
      where e.customer_id = p_customer_id
        and e.status = 'active'
        and (
          e.kind = 'intro'
          or coalesce((e.eligibility_snapshot ->> 'intro_only')::boolean, false)
        )
        and e.payment_id is distinct from p_payment_id
    );
$$;

revoke execute on function private.intro_blocked(uuid, uuid) from public, anon, authenticated, service_role;
