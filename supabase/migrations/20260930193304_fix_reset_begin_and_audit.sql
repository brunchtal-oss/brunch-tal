-- Story 1.4 review fixes.
-- 1. reset_begin: the same-key already_completed branch now also requires an
--    unexpired link and a valid target, so a consumed link plus its page key
--    cannot change the password after the link expired or the target became
--    invalid (a revoked or expired link stays closed).
-- 2. private.audit: refuses an entity_type that is not a table in public, so
--    a misspelled name ('baby', 'profile') cannot bypass audit_diff masking.

create or replace function public.reset_begin(p_token text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'reset' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'consumed' then
    if exists (
      select 1
      from private.idempotency_results r
      where r.actor_scope = 'token:' || v_token.id::text
        and r.rpc = 'reset_complete'
        and r.key = p_idempotency_key
        and r.result is not null
    ) then
      if now() > v_token.expires_at
         or not private.reset_target_valid(v_token.bound_user_id) then
        raise exception 'LINK_EXPIRED' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'token_id', v_token.id,
        'user_id', v_token.bound_user_id,
        'already_completed', true
      );
    end if;
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state <> 'pending'
     or now() > v_token.expires_at
     or not private.reset_target_valid(v_token.bound_user_id) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'token_id', v_token.id,
    'user_id', v_token.bound_user_id,
    'already_completed', false
  );
end;
$$;

create or replace function private.audit(
  p_actor_id uuid,
  p_actor_kind text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_customer_id uuid,
  p_event_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_reason text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_diff jsonb;
  v_id uuid;
begin
  -- entity_type is the table name; masking in audit_diff depends on it.
  if p_entity_type is null
     or to_regclass(format('public.%I', p_entity_type)) is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_diff := private.audit_diff(p_old, p_new, p_entity_type);

  insert into public.audit_log (
    actor_id, actor_kind, action, entity_type, entity_id,
    customer_id, event_id, before, after, reason
  )
  values (
    p_actor_id, p_actor_kind, p_action, p_entity_type, p_entity_id,
    p_customer_id, p_event_id, v_diff -> 'before', v_diff -> 'after', p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Function grants (AD-5).
revoke execute on function private.audit(uuid, text, text, text, uuid, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated, service_role;

revoke execute on function public.reset_begin(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_begin(text, uuid) to service_role;
