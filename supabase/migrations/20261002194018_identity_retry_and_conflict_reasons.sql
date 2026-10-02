-- Story 2.3, round 2 (after the phone test, user decision 2026-10-02).
-- 1. activation_tokens.identity_attempts: a two_accounts match keeps a
--    pending link pending for attempts 1 and 2 (join_begin answers
--    {outcome: identity_retry, token_id}); the third locks it in conflict
--    (two_accounts). Other input on a retry is classified again.
-- 2. The conflict results of join_begin and join_complete carry `reason`,
--    and token_view returns conflict_reason for a join link in conflict, so
--    a later opening shows the wording of the reason. Never the field that
--    matched.
-- Same signatures (create or replace); grants as in
-- 20261002181416_existing_account_and_conflicts.sql.

alter table public.activation_tokens
  add column identity_attempts integer not null default 0
    constraint activation_tokens_identity_attempts_check
    check (identity_attempts between 0 and 3);

-- ---------------------------------------------------------------------------
-- token_view: conflict_reason
-- ---------------------------------------------------------------------------

-- As in 2.3 round 1, plus conflict_reason for a join link in conflict (null
-- otherwise).
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

-- ---------------------------------------------------------------------------
-- join_begin: identity_retry and the conflict reason
-- ---------------------------------------------------------------------------

-- As in 2.3 round 1, except: a two_accounts match on a pending link raises
-- identity_attempts; attempts 1 and 2 keep the link pending and answer
-- {outcome: identity_retry, token_id} (the caller retries with a new key:
-- the previous key is stored with the previous input hash); the third moves
-- it to conflict (two_accounts). Every conflict result is
-- {outcome: conflict, token_id, reason}.
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

  -- claiming or awaiting_login with other input.
  if v_token.state <> 'pending' and v_token.input_hash is distinct from v_hash then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

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
  elsif v_token.state <> 'pending' then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  else
    v_match := private.find_identity(v_identity ->> 'email', v_identity ->> 'phone');

    if v_match ->> 'match' = 'none' then
      update public.activation_tokens
      set state = 'claiming', pending_user_id = gen_random_uuid(), input_hash = v_hash
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
      null, 'system', 'join_begin', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );
  end if;

  return private.idempotent_finish(v_scope, 'join_begin', p_idempotency_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- join_complete: the conflict reason
-- ---------------------------------------------------------------------------

-- As in 2.3 round 1, except every conflict result carries `reason` (the
-- stored conflict_reason, or phone_taken / bind_conflict of this call).
create or replace function public.join_complete(
  p_token text,
  p_profile jsonb,
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
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_full_name text;
  v_dietary_notes text;
  v_babies jsonb;
  v_item record;
  v_name text;
  v_birth_text text;
  v_birth date;
  v_names text[] := '{}';
  v_births date[] := '{}';
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_privacy_version integer;
  v_photo_version integer;
  v_profile public.profiles;
  v_baby public.babies;
  v_conflict_reason text;
  v_constraint text;
  i integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;
  v_prev := private.idempotent_begin(v_scope, 'join_complete', p_idempotency_key, '{}'::jsonb);
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens, then profiles, entitlements,
  -- payments and notification_jobs inside private.bind_purchase.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
      )
    );
  end if;

  -- A claiming link may finish after its expiry (AD-10).
  if v_token.state <> 'claiming' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_identity := private.join_identity(p_profile ->> 'email', p_profile ->> 'phone');

  if v_identity ->> 'input_hash' is distinct from v_token.input_hash then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  -- The Auth user of step 2 exists, with the email of this input.
  if not exists (
    select 1
    from auth.users u
    where u.id = v_token.pending_user_id
      and lower(u.email) = v_identity ->> 'email'
  ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_full_name := btrim(p_profile ->> 'full_name');
  if v_full_name is null or char_length(v_full_name) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "full_name"}';
  end if;

  if (p_profile -> 'privacy_consent') is distinct from 'true'::jsonb then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- "Private" is a full answer; only a missing answer is refused.
  if jsonb_typeof(p_profile -> 'photo_consent') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "photo_consent"}';
  end if;

  if coalesce(jsonb_typeof(p_profile -> 'dietary_notes'), 'null') not in ('string', 'null') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;
  v_dietary_notes := nullif(btrim(p_profile ->> 'dietary_notes'), '');
  if char_length(v_dietary_notes) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;

  -- At least one baby (user decision 2026-10-01), at most 10 per form.
  v_babies := p_profile -> 'babies';
  if jsonb_typeof(v_babies) is distinct from 'array'
     or jsonb_array_length(v_babies) not between 1 and 10 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
  end if;

  for v_item in
    select b.value as item, (b.ordinality - 1)::integer as idx
    from jsonb_array_elements(v_babies) with ordinality as b (value, ordinality)
  loop
    if jsonb_typeof(v_item.item) <> 'object' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
    end if;

    v_name := btrim(v_item.item ->> 'name');
    if v_name is null or char_length(v_name) not between 1 and 100 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'baby_name', 'index', v_item.idx)::text;
    end if;

    v_birth_text := v_item.item ->> 'birth_date';
    v_birth := null;
    if v_birth_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_birth := v_birth_text::date;
      exception when others then
        v_birth := null;
      end;
    end if;

    -- Not after the local today (AD-8).
    if v_birth is null or v_birth > v_today then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'birth_date', 'index', v_item.idx)::text;
    end if;

    v_names := v_names || v_name;
    v_births := v_births || v_birth;
  end loop;

  -- The published versions at the time of consent (0 = the seed).
  select cp.published_version into v_privacy_version
  from public.content_pages cp
  where cp.slug = 'privacy';

  select cp.published_version into v_photo_version
  from public.content_pages cp
  where cp.slug = 'join-form';

  if v_privacy_version is null or v_photo_version is null then
    raise exception 'join_complete: content pages missing' using errcode = 'XX000';
  end if;

  -- Everything of the customer in one sub-block: a unique violation (the
  -- phone taken since join_begin, or any other) or BIND_CONFLICT undoes it
  -- all and the link goes to conflict.
  begin
    insert into public.profiles (
      id, full_name, phone_e164, dietary_notes, activated_at,
      privacy_consent_at, privacy_policy_version,
      photo_consent, photo_consent_at, photo_consent_text_version
    )
    values (
      v_token.pending_user_id, v_full_name, v_identity ->> 'phone', v_dietary_notes, now(),
      now(), v_privacy_version,
      (p_profile ->> 'photo_consent')::boolean, now(), v_photo_version
    )
    returning * into v_profile;

    perform private.audit(
      v_profile.id, 'customer', 'join_complete', 'profiles', v_profile.id,
      v_profile.id, null, null, to_jsonb(v_profile)
    );

    for i in 1 .. cardinality(v_names) loop
      insert into public.babies (customer_id, name, birth_date)
      values (v_profile.id, v_names[i], v_births[i])
      returning * into v_baby;

      perform private.audit(
        v_profile.id, 'customer', 'join_complete', 'babies', v_baby.id,
        v_profile.id, null, null, to_jsonb(v_baby)
      );
    end loop;

    perform private.bind_purchase(v_token.payment_id, v_profile.id);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_conflict_reason := case
        when v_constraint = 'profiles_phone_e164_key' then 'phone_taken'
        else 'bind_conflict'
      end;
    when raise_exception then
      if sqlerrm <> 'BIND_CONFLICT' then
        raise;
      end if;
      v_conflict_reason := 'bind_conflict';
  end;

  if v_conflict_reason is not null then
    update public.activation_tokens
    set state = 'conflict', conflict_reason = v_conflict_reason
    where id = v_token.id
    returning * into v_new;

    perform private.audit(
      null, 'system', 'join_complete', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );

    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_conflict_reason
      )
    );
  end if;

  update public.activation_tokens
  set state = 'consumed', consumed_at = now(), customer_id = v_profile.id
  where id = v_token.id
  returning * into v_new;

  perform private.audit(
    v_profile.id, 'customer', 'join_complete', 'activation_tokens', v_token.id,
    v_profile.id, null, to_jsonb(v_token), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_scope, 'join_complete', p_idempotency_key,
    jsonb_build_object(
      'outcome', 'joined',
      'token_id', v_token.id,
      'customer_id', v_profile.id,
      'payment_id', v_token.payment_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): unchanged, restated.
-- ---------------------------------------------------------------------------

revoke execute on function public.token_view(text) from public, anon, authenticated, service_role;
grant execute on function public.token_view(text) to service_role;

revoke execute on function public.join_begin(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_begin(text, text, text, uuid) to service_role;

revoke execute on function public.join_complete(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_complete(text, jsonb, uuid) to service_role;
