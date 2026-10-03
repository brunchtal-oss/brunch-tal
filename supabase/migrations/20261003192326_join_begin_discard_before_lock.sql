-- Story 2.4, review round 1: join_begin checks the discard (claiming whose
-- pending Auth user exists) before the identity_attempts >= 2 lock, so a
-- locked link never keeps an orphan Auth user: the lock happens on the call
-- after the server deleted it. Otherwise as in
-- 20261003141504_link_lifecycle_and_recovery.sql.

create or replace function public.join_begin(
  p_token text,
  p_email text,
  p_phone text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_orig public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_match jsonb;
  v_hash text;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Unlocked read: builds the scope and answers the closed states. The raw
  -- token never reaches the stored request hash.
  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;

  if v_token.state = 'consumed' then
    -- Completed by this key, only the response was lost: no Auth change.
    select r.result into v_prev
    from private.idempotency_results r
    where r.actor_scope = v_scope
      and r.rpc = 'join_complete'
      and r.key = p_idempotency_key
      and r.result is not null;
    if v_prev is not null then
      return v_prev;
    end if;
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return jsonb_build_object(
      'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
    );
  end if;

  v_identity := private.join_identity(p_email, p_phone);
  v_hash := v_identity ->> 'input_hash';

  v_prev := private.idempotent_begin(
    v_scope, 'join_begin', p_idempotency_key,
    jsonb_build_object('input_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens first; re-check after the lock.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  v_orig := v_token;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    v_result := jsonb_build_object(
      'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
    );
  elsif v_token.state = 'claiming' and v_token.input_hash = v_hash then
    v_result := jsonb_build_object(
      'outcome', 'claiming',
      'token_id', v_token.id,
      'pending_user_id', v_token.pending_user_id
    );
  elsif v_token.state = 'awaiting_login' and v_token.input_hash = v_hash then
    v_result := jsonb_build_object('outcome', 'existing_account', 'token_id', v_token.id);
  elsif v_token.state in ('claiming', 'awaiting_login') then
    -- A correction of the input (user decision 2026-10-03).
    if now() > v_token.expires_at then
      raise exception 'LINK_EXPIRED' using errcode = 'P0001';
    end if;

    -- The Auth user of the previous input goes first (also before the
    -- lock below, so no orphan stays behind a locked link).
    if v_token.state = 'claiming'
       and exists (select 1 from auth.users u where u.id = v_token.pending_user_id) then
      -- Nothing changes here.
      v_result := jsonb_build_object(
        'outcome', 'discard_pending_user',
        'token_id', v_token.id,
        'pending_user_id', v_token.pending_user_id
      );
    elsif v_token.identity_attempts >= 2 then
      update public.activation_tokens
      set state = 'conflict',
          conflict_reason = 'too_many_attempts',
          bound_user_id = null
      where id = v_token.id
      returning * into v_new;

      perform private.audit(
        null, 'system', 'join_begin', 'activation_tokens', v_token.id,
        null, null, to_jsonb(v_orig), to_jsonb(v_new)
      );

      v_result := jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_new.id, 'reason', v_new.conflict_reason
      );
    else
      update public.activation_tokens
      set state = 'pending',
          pending_user_id = null,
          input_hash = null,
          claiming_at = null,
          bound_user_id = null,
          identity_attempts = identity_attempts + 1
      where id = v_token.id
      returning * into v_token;
    end if;
  elsif v_token.state <> 'pending' then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  -- A pending link (also one reset just above): classify the input.
  if v_result is null then
    v_match := private.find_identity(v_identity ->> 'email', v_identity ->> 'phone');

    if v_match ->> 'match' = 'none' then
      update public.activation_tokens
      set state = 'claiming',
          pending_user_id = gen_random_uuid(),
          input_hash = v_hash,
          claiming_at = now()
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object(
        'outcome', 'claiming',
        'token_id', v_new.id,
        'pending_user_id', v_new.pending_user_id
      );
    elsif v_match ->> 'match' = 'account' then
      update public.activation_tokens
      set state = 'awaiting_login',
          bound_user_id = (v_match ->> 'customer_id')::uuid,
          input_hash = v_hash
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object('outcome', 'existing_account', 'token_id', v_new.id);
    elsif v_match ->> 'reason' = 'two_accounts' and v_token.identity_attempts < 2 then
      -- Attempts 1 and 2: the link stays pending and the customer may check
      -- her details (user decision 2026-10-02).
      update public.activation_tokens
      set identity_attempts = identity_attempts + 1
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object('outcome', 'identity_retry', 'token_id', v_new.id);
    else
      -- The third two_accounts attempt locks the link; any other reason
      -- stops at once.
      update public.activation_tokens
      set state = 'conflict',
          conflict_reason = v_match ->> 'reason',
          identity_attempts = case
            when v_match ->> 'reason' = 'two_accounts' then identity_attempts + 1
            else identity_attempts
          end
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_new.id, 'reason', v_new.conflict_reason
      );
    end if;

    perform private.audit(
      null, 'system', 'join_begin', 'activation_tokens', v_orig.id,
      null, null, to_jsonb(v_orig), to_jsonb(v_new)
    );
  end if;

  return private.idempotent_finish(v_scope, 'join_begin', p_idempotency_key, v_result);
end;
$$;

revoke execute on function public.join_begin(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_begin(text, text, text, uuid) to service_role;
