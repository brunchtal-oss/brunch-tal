-- Story 2.3, phone test fix: token_view returns bound_user_id for a join
-- link in awaiting_login (null otherwise), so /join/[token] shows the
-- confirm screen only to the account the link is bound to; any other
-- signed-in customer gets "another account" at once.
-- Server-side only: lib/server/privileged/join.ts compares it with the
-- session user and passes only the screen choice on; it is never sent to the
-- browser. Same signature (create or replace); service role only.

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
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  v_state := case
    when v_token.id is null then 'not_found'
    when v_token.state = 'consumed' then 'used'
    when v_token.state = 'conflict' then 'conflict'
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
  end if;

  return jsonb_build_object(
    'state_public', v_state,
    'purpose', v_token.purpose,
    'product_name', v_product_name,
    'amount_agorot', v_amount_agorot,
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

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;
