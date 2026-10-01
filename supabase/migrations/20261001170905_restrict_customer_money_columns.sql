-- Story 2.1 review fixes.
-- 1. Tal's internal fields stay out of the API (user decision 2026-10-01):
--    authenticated reads payments and entitlement_movements only through
--    column grants. Hidden: payments.payment_method_id, recorded_by, reference,
--    note, amount_override_reason, provider, provider_transaction_id;
--    entitlement_movements.reason, actor_id. The method name is in
--    product_snapshot. Admins read the internal fields through admin_* RPCs
--    (story 2.5).
-- 2. admin_approve_payment locks the product FOR SHARE before planning, so the
--    CONFIRM_REQUIRED decision and the core's plan read the same price.

revoke select on table public.payments from authenticated;
grant select (
  id, customer_id, product_id, source, amount_agorot, paid_on, status,
  product_snapshot, created_at
) on table public.payments to authenticated;

revoke select on table public.entitlement_movements from authenticated;
grant select (
  id, entitlement_id, booking_id, action, units, reverses_id, created_at
) on table public.entitlement_movements to authenticated;

create or replace function public.admin_approve_payment(
  p_product_id uuid,
  p_event_id uuid,
  p_amount_agorot integer,
  p_amount_override_reason text,
  p_paid_on date,
  p_payment_method_id uuid,
  p_reference text,
  p_note text,
  p_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_plan jsonb;
  v_payment_id uuid;
  v_entitlement public.entitlements;
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'event_id', p_event_id,
      'amount_agorot', p_amount_agorot,
      'amount_override_reason', p_amount_override_reason,
      'paid_on', p_paid_on,
      'payment_method_id', p_payment_method_id,
      'reference', p_reference,
      'note', p_note,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- The price cannot change between this plan and the core's plan.
  perform 1
  from public.products p
  where p.id = p_product_id
  for share;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if (v_plan ->> 'price_changed')::boolean and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_payment_id := private.approve_payment_core(
    'manual', v_actor, 'admin', null, p_product_id, p_event_id,
    p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id,
    p_reference, p_note, null, null, 'raise'
  );

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

  v_token := private.issue_token('join', null, v_payment_id);

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  perform private.audit(
    v_actor, 'admin', 'admin_approve_payment', 'activation_tokens', v_token_row.id,
    null, p_event_id, null, to_jsonb(v_token_row)
  );

  v_result := private.idempotent_finish(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'entitlement_id', v_entitlement.id,
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'expires_on', v_entitlement.expires_on,
      'reissue_required', true
    )
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;
