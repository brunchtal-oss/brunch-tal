-- Story 2.15: Tal fills the join form for a customer who paid (user decision
-- 2026-11-09, SPEC .memlog.md; overrides source lines 109 and 351).
--
-- admin_begin_join_fill replaces the purchase's live join link with a fresh
-- internal one and returns its raw token once (AD-10). The server then runs
-- the unchanged join core (join_begin -> Auth -> join_complete) with it,
-- without signing in. Nothing here is written to the audit log: the details
-- and the consents are the customer's own, and the join itself is audited
-- exactly as a self-join.
--
-- token_view: a revoked join link whose purchase is bound reads 'used', so a
-- customer whose link was replaced by Tal's fill sees "already used, log in".

create or replace function public.admin_begin_join_fill(
  p_payment_id uuid,
  p_email text,
  p_phone text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_identity jsonb;
  v_prev jsonb;
  v_live public.activation_tokens;
  v_pending_user_id uuid;
  v_match jsonb;
  v_token jsonb;
  v_token_id uuid;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null or p_payment_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The same normalization and checks as join_begin (field in detail).
  v_identity := private.join_identity(p_email, p_phone);

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_begin_join_fill', p_idempotency_key,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'input_hash', v_identity ->> 'input_hash'
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): the payment's join tokens, then the payment. Raises
  -- LINK_USED (bound or consumed), PURCHASE_VOIDED and LINK_IN_PROGRESS (a
  -- join in progress for less than 15 minutes: the first to finish wins).
  v_live := private.lock_join_payment(p_payment_id);

  -- Details of an existing account (or of two, or of one not activated):
  -- nothing changes, the customer's link stays as it is.
  v_match := private.find_identity(v_identity ->> 'email', v_identity ->> 'phone');
  if v_match ->> 'match' <> 'none' then
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_join_fill', p_idempotency_key,
      jsonb_build_object('outcome', 'details_taken')
    );
  end if;

  -- The live link (pending, awaiting_login, expired, conflict or stuck) is
  -- revoked without an audit row (user decision: no record of the fill).
  -- The Auth user of a stuck claiming link without a profile is returned
  -- for deletion, as private.revoke_join_token does.
  if v_live.id is not null then
    update public.activation_tokens
    set state = 'revoked', revoked_at = now()
    where id = v_live.id;

    if v_live.state = 'claiming'
       and v_live.pending_user_id is not null
       and not exists (select 1 from public.profiles p where p.id = v_live.pending_user_id) then
      v_pending_user_id := v_live.pending_user_id;
    end if;
  end if;

  v_token := private.issue_token('join', null, p_payment_id);
  v_token_id := (v_token ->> 'token_id')::uuid;

  -- Nobody but Tal's open form holds this link: one hour, so an abandoned
  -- fill shows in "לטיפול" (purchase_without_link) soon. A claiming link may
  -- still finish after it (AD-10).
  update public.activation_tokens
  set expires_at = now() + interval '1 hour'
  where id = v_token_id;

  v_result := private.idempotent_finish(
    v_actor::text, 'admin_begin_join_fill', p_idempotency_key,
    jsonb_build_object(
      'outcome', 'ready',
      'token_id', v_token_id,
      'revoked_pending_user_id', v_pending_user_id,
      'reissue_required', true
    )
  );

  -- The raw token once, never stored (AD-10).
  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

revoke execute on function public.admin_begin_join_fill(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_join_fill(uuid, text, text, uuid)
  to authenticated;

-- token_view: the live definition (story 2.14) plus the 'used' case for a
-- revoked join link whose purchase is bound.
create or replace function public.token_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_state text;
  v_product_name text;
  v_amount_agorot integer;
  v_session_starts_at timestamptz;
  v_concept_name text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  v_state := case
    when v_token.id is null then 'not_found'
    when v_token.state = 'consumed' then 'used'
    when v_token.state = 'conflict' then 'conflict'
    -- Story 2.14: the link of a voided purchase.
    when v_token.state = 'revoked'
      and v_token.purpose = 'join'
      and exists (
        select 1
        from public.payments pay
        where pay.id = v_token.payment_id
          and pay.status = 'voided'
      ) then 'voided'
    -- Story 2.15: the purchase was bound through another link (Tal's fill,
    -- or a replacement): the customer can log in.
    when v_token.state = 'revoked'
      and v_token.purpose = 'join'
      and exists (
        select 1
        from public.payments pay
        where pay.id = v_token.payment_id
          and pay.customer_id is not null
      ) then 'used'
    when v_token.state = 'revoked' then 'expired'
    when v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at then 'expired'
    when v_token.purpose = 'reset' and not private.reset_target_valid(v_token.bound_user_id) then 'expired'
    when v_token.state = 'awaiting_login' then 'awaiting_login'
    else 'active'
  end;

  if v_state in ('active', 'awaiting_login') and v_token.purpose = 'join' then
    select pay.product_snapshot ->> 'name', pay.amount_agorot
    into v_product_name, v_amount_agorot
    from public.payments pay
    where pay.id = v_token.payment_id;

    -- A pinned purchase: its session, shown instead of the product name.
    select ev.starts_at, c.name
    into v_session_starts_at, v_concept_name
    from public.entitlements e
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.payment_id = v_token.payment_id;
  end if;

  return jsonb_build_object(
    'state_public', v_state,
    'purpose', v_token.purpose,
    'product_name', v_product_name,
    'amount_agorot', v_amount_agorot,
    'session_starts_at', v_session_starts_at,
    'concept_name', v_concept_name,
    'bound_user_id', case
      when v_state = 'awaiting_login' and v_token.purpose = 'join' then v_token.bound_user_id
    end,
    'conflict_reason', case
      when v_state = 'conflict' and v_token.purpose = 'join' then v_token.conflict_reason
    end,
    'expires_on', case
      when v_state in ('active', 'awaiting_login')
        then (v_token.expires_at at time zone 'Asia/Jerusalem')::date
    end
  );
end;
$$;
