-- Story 2.15 (review fix): admin_begin_join_fill ignores the orphan Auth
-- user of the purchase's live link (a stuck claiming link, or a conflict
-- whose orphan delete failed). That user never got a profile and the server
-- deletes it right after this call (revoked_pending_user_id, now for any
-- revoked link state), so details that match only it are not details_taken.
-- Everything else is identical to 20261109210949: no audit row, same grants.

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
  v_orphan uuid;
  v_email text;
  v_phone text;
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

  -- The Auth user of the live link (a stuck claiming link, or a conflict
  -- whose orphan delete failed) that never got a profile: it is deleted by
  -- the server after this call, so it does not count as an account here.
  if v_live.id is not null
     and v_live.pending_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = v_live.pending_user_id) then
    v_orphan := v_live.pending_user_id;
  end if;

  v_match := private.find_identity(v_identity ->> 'email', v_identity ->> 'phone');
  -- The same normalization as private.find_identity: if the orphan is the
  -- only identity the details match, they are free.
  if v_match ->> 'match' <> 'none'
     and v_orphan is not null
     and exists (select 1 from auth.users u where u.id = v_orphan) then
    v_email := nullif(lower(btrim(v_identity ->> 'email')), '');
    v_phone := private.normalize_phone(v_identity ->> 'phone');
    if not exists (
      select 1 from auth.users u
      where v_email is not null and lower(u.email) = v_email and u.id <> v_orphan
    ) and not exists (
      select 1 from public.profiles p
      where v_email is not null and p.pending_email = v_email
    ) and not exists (
      select 1 from public.profiles p
      where v_phone is not null and p.phone_e164 = v_phone
    ) then
      v_match := jsonb_build_object('match', 'none');
    end if;
  end if;

  -- Details of an existing account (or of two, or of one not activated):
  -- nothing changes, the customer's link stays as it is.
  if v_match ->> 'match' <> 'none' then
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_join_fill', p_idempotency_key,
      jsonb_build_object('outcome', 'details_taken')
    );
  end if;

  -- The live link (pending, awaiting_login, expired, conflict or stuck) is
  -- revoked without an audit row (user decision: no record of the fill).
  -- The Auth user of the revoked link without a profile (any state) is
  -- returned for deletion, as private.revoke_join_token does for claiming.
  if v_live.id is not null then
    update public.activation_tokens
    set state = 'revoked', revoked_at = now()
    where id = v_live.id;

    v_pending_user_id := v_orphan;
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

revoke execute on function public.admin_begin_join_fill(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_join_fill(uuid, text, text, uuid)
  to authenticated;
