-- Story 4.12: the customer's home and entitlement screens (CAP-9, CAP-13).
-- RPC: get_my_entitlements (authenticated only, a read, no idempotency).
-- The balances (available, reserved, used, is_expired, expired_before_bound)
-- come only from entitlement_balances (AD-14); days_left, is_expiring and
-- is_used_up are derived here, by the local date in Asia/Jerusalem (AD-8),
-- with business_settings.customer_expiring_days read now. TS only formats.
-- The booking functions are not touched.

-- Every entitlement of the signed-in customer, by expires_on, entitlement_id.
-- customer_id comes only from private.current_customer_id() (none: []).
-- days_left = expires_on - today (0 on the last day: the validity ends at the
-- local day's end). is_expiring: not expired, available > 0 and days_left
-- <= customer_expiring_days. is_used_up: nothing available or reserved and
-- not expired. Result: [{entitlement_id, kind, status, product_name,
-- amount_agorot, paid_on, original_units, available, reserved, used,
-- expires_on, is_expired, expired_before_bound, days_left, is_expiring,
-- is_used_up, validity_days, pinned_event_id, payment_id}].
create function public.get_my_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_threshold integer;
  v_today date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_customer := private.current_customer_id();
  if v_customer is null then
    return '[]'::jsonb;
  end if;

  select s.customer_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_snapshot ->> 'name',
        'amount_agorot', x.amount_agorot,
        'paid_on', x.paid_on,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'expired_before_bound', x.expired_before_bound,
        'days_left', x.days_left,
        'is_expiring', not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.available = 0 and x.reserved = 0 and not x.is_expired,
        'validity_days', case
          when jsonb_typeof(x.eligibility_snapshot -> 'validity_days') = 'number'
            then (x.eligibility_snapshot ->> 'validity_days')::integer
        end,
        'pinned_event_id', x.pinned_event_id,
        'payment_id', x.payment_id
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      b.entitlement_id,
      b.kind,
      b.status,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.is_expired,
      b.expired_before_bound,
      b.payment_id,
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      e.eligibility_snapshot,
      p.amount_agorot,
      p.paid_on,
      p.product_snapshot
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_customer
  ) x;

  return v_result;
end;
$$;

revoke execute on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;
