-- Story 2.4: link lifecycle and mid-join recovery (AD-3, AD-5, AD-6, AD-10,
-- AD-19, AD-21).
-- 1. activation_tokens.claiming_at (set on entering claiming) and the
--    conflict reason too_many_attempts.
-- 2. entitlements.bound_at (set by private.bind_purchase) and
--    entitlement_balances.expired_before_bound, so /me shows a card that
--    expired before it was bound.
-- 3. private.join_link_status, the one status of a join link (the links
--    screen now, "to handle" in E4).
-- 4. admin_issue_link (join only until 2.8), admin_revoke_link and
--    admin_list_links (authenticated, admin).
-- 5. join_begin: other input in claiming or awaiting_login is checked again
--    (deferred 1, 2) instead of LINK_IN_USE: expired -> LINK_EXPIRED; two
--    corrections already -> conflict too_many_attempts; claiming whose Auth
--    user exists -> {outcome: discard_pending_user} (the server deletes that
--    user and calls again with a new key); otherwise the link goes back to
--    pending and the input is classified again.
-- Grants as before for the replaced functions; one grant per new RPC.

-- ---------------------------------------------------------------------------
-- activation_tokens: claiming_at, too_many_attempts
-- ---------------------------------------------------------------------------

alter table public.activation_tokens
  add column claiming_at timestamptz;

-- Existing claiming links: the creation time is the best known start.
update public.activation_tokens
set claiming_at = created_at
where state = 'claiming';

alter table public.activation_tokens
  add constraint activation_tokens_claiming_at_check
    check (state <> 'claiming' or claiming_at is not null);

alter table public.activation_tokens
  drop constraint activation_tokens_conflict_reason_check,
  drop constraint activation_tokens_conflict_state_check;

-- A link in conflict that Tal revokes keeps its reason (the history of the
-- links screen); any other state has none.
alter table public.activation_tokens
  add constraint activation_tokens_conflict_reason_check
    check (
      conflict_reason in (
        'two_accounts', 'not_activated', 'phone_taken', 'bind_conflict',
        'too_many_attempts'
      )
    ),
  add constraint activation_tokens_conflict_state_check
    check (
      (state <> 'conflict' or conflict_reason is not null)
      and (conflict_reason is null or state in ('conflict', 'revoked'))
    );

-- ---------------------------------------------------------------------------
-- entitlements.bound_at and entitlement_balances.expired_before_bound
-- ---------------------------------------------------------------------------

-- When the purchase was bound to its customer (null: not bound yet, or bound
-- at creation for an existing customer, 2.5). Never extends the validity.
alter table public.entitlements
  add column bound_at timestamptz;

-- As in 20261001165149, plus expired_before_bound: the validity ended
-- before the purchase reached the customer (bound_at, or created_at for a
-- purchase bound at creation). /me shows such a card with "expired".
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
  now() >= e.expires_at as is_expired,
  e.expires_at < coalesce(e.bound_at, e.created_at) as expired_before_bound
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

-- As in 20261001195103, plus bound_at = now() on the entitlement.
create or replace function private.bind_purchase(p_payment_id uuid, p_customer_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_payment public.payments;
  v_payment_new public.payments;
begin
  if p_payment_id is null or p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null
  for update;

  if v_profile_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = p_payment_id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  if v_payment.id is null or v_entitlement.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_payment.customer_id is not null or v_entitlement.customer_id is not null then
    raise exception 'BIND_CONFLICT' using errcode = 'P0001';
  end if;

  update public.payments
  set customer_id = p_customer_id
  where id = v_payment.id
  returning * into v_payment_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'payments', v_payment.id,
    p_customer_id, null, to_jsonb(v_payment), to_jsonb(v_payment_new)
  );

  update public.entitlements
  set customer_id = p_customer_id, bound_at = now()
  where id = v_entitlement.id
  returning * into v_entitlement_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'entitlements', v_entitlement.id,
    p_customer_id, v_entitlement.pinned_event_id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
  );

  -- Skipped at approval because there was no customer (AD-23).
  if v_entitlement.kind = 'card' then
    perform private.enqueue_notification(
      p_customer_id, 'purchase_new_card', p_payment_id::text, '{}'::jsonb, '/me'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- The one status of a join link (the links screen, "to handle" in E4):
--   consumed | revoked | expired (pending or awaiting_login after expires_at)
--   | stuck (claiming for 15 minutes or more) | pending | awaiting_login
--   | claiming | conflict.
-- A claiming link may still finish after its expiry (AD-10), so it is never
-- "expired". Reads now(); changes nothing.
create function private.join_link_status(p_token public.activation_tokens)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_token.state = 'consumed' then 'consumed'
    when p_token.state = 'revoked' then 'revoked'
    when p_token.state in ('pending', 'awaiting_login') and now() > p_token.expires_at
      then 'expired'
    when p_token.state = 'claiming' and p_token.claiming_at <= now() - interval '15 minutes'
      then 'stuck'
    else p_token.state
  end;
$$;

-- Locks the join links of a payment before it revokes or replaces one (AD-6):
-- an advisory lock per payment (so two replacements cannot both issue), then
-- every join link of the payment by id, then the payment FOR SHARE. Raises
-- INVALID_INPUT for an unknown payment; LINK_USED when the purchase is bound
-- or a link of it was consumed; LINK_IN_PROGRESS while a claiming link
-- started less than 15 minutes ago. Returns the live (not revoked) link, or
-- a row of nulls when there is none.
create function private.lock_join_payment(p_payment_id uuid)
returns public.activation_tokens
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_token public.activation_tokens;
  v_live public.activation_tokens;
  v_customer_id uuid;
  v_found boolean;
begin
  if p_payment_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('activation_tokens:join:' || p_payment_id::text));

  for v_token in
    select t.*
    from public.activation_tokens t
    where t.payment_id = p_payment_id
      and t.purpose = 'join'
    order by t.id
    for update
  loop
    if v_token.state = 'consumed' then
      raise exception 'LINK_USED' using errcode = 'P0001';
    end if;
    if v_token.state <> 'revoked' then
      v_live := v_token;
    end if;
  end loop;

  select true, pay.customer_id into v_found, v_customer_id
  from public.payments pay
  where pay.id = p_payment_id
  for share;

  if v_found is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_customer_id is not null then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_live.id is not null and private.join_link_status(v_live) = 'claiming' then
    raise exception 'LINK_IN_PROGRESS' using errcode = 'P0001';
  end if;

  return v_live;
end;
$$;

-- Revokes a locked live join link and audits it. Returns the pending Auth
-- user of a claiming link that has no profile (the server deletes it), or
-- null. Never an id that has a profile.
create function private.revoke_join_token(p_token public.activation_tokens, p_actor_id uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_new public.activation_tokens;
begin
  update public.activation_tokens
  set state = 'revoked', revoked_at = now()
  where id = p_token.id
  returning * into v_new;

  perform private.audit(
    p_actor_id, 'admin', 'revoke_link', 'activation_tokens', p_token.id,
    null, null, to_jsonb(p_token), to_jsonb(v_new)
  );

  if p_token.state = 'claiming'
     and p_token.pending_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_token.pending_user_id) then
    return p_token.pending_user_id;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

-- Tal issues a link (AD-10). Until 2.8 only purpose 'join', where
-- p_target_id is the payment: the live link of that payment (pending, also
-- expired, awaiting_login, conflict or a stuck claiming) is revoked and a new
-- pending link is issued for 48 hours, in one transaction. The payment and
-- the entitlement do not change. Refused: LINK_USED (the purchase is bound or
-- a link was consumed), LINK_IN_PROGRESS (claiming less than 15 minutes).
-- The raw token is returned once; a repeat with the same key returns the
-- stored result without it (reissue_required: true).
-- Result: {token_id, token, link_expires_at, revoked_pending_user_id,
-- reissue_required}.
create function public.admin_issue_link(
  p_purpose text,
  p_target_id uuid,
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
  v_live public.activation_tokens;
  v_pending_user_id uuid;
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_issue_link', p_idempotency_key,
    jsonb_build_object('purpose', p_purpose, 'target_id', p_target_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- reset and claim arrive with 2.8 and the import.
  if p_purpose is distinct from 'join' or p_target_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_live := private.lock_join_payment(p_target_id);

  if v_live.id is not null then
    v_pending_user_id := private.revoke_join_token(v_live, v_actor);
  end if;

  v_token := private.issue_token('join', null, p_target_id);

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  perform private.audit(
    v_actor, 'admin', 'admin_issue_link', 'activation_tokens', v_token_row.id,
    null, null, null, to_jsonb(v_token_row)
  );

  v_result := private.idempotent_finish(
    v_actor::text, 'admin_issue_link', p_idempotency_key,
    jsonb_build_object(
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'revoked_pending_user_id', v_pending_user_id,
      'reissue_required', true
    )
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$$;

-- Tal revokes a join link: the same rules as admin_issue_link, without a new
-- link. A link that is already revoked is left as it is. Result:
-- {token_id, revoked_pending_user_id} (the pending Auth user of a revoked
-- claiming link without a profile; the server deletes it).
create function public.admin_revoke_link(p_token_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_payment_id uuid;
  v_live public.activation_tokens;
  v_pending_user_id uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_revoke_link', p_idempotency_key,
    jsonb_build_object('token_id', p_token_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select t.payment_id into v_payment_id
  from public.activation_tokens t
  where t.id = p_token_id
    and t.purpose = 'join';

  if v_payment_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_live := private.lock_join_payment(v_payment_id);

  -- Otherwise the link was revoked already (the live one is another link,
  -- or there is none).
  if v_live.id = p_token_id then
    v_pending_user_id := private.revoke_join_token(v_live, v_actor);
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_revoke_link', p_idempotency_key,
    jsonb_build_object('token_id', p_token_id, 'revoked_pending_user_id', v_pending_user_id)
  );
end;
$$;

-- The join links for /admin/links, newest first. Read only (no
-- idempotency, AD-5); never a token or its hash. status: pending (pending,
-- awaiting_login, claiming, stuck, conflict) | consumed | expired | revoked;
-- detail: awaiting_login (with the bound account's name), stuck, conflict
-- (with conflict_reason), or null. The product and amount come from the
-- payment's snapshot; customer_name after the link was consumed.
-- can_revoke / can_replace follow private.lock_join_payment.
create function public.admin_list_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with links as (
    select
      t.*,
      private.join_link_status(t) as fine_status,
      pay.customer_id as payment_customer_id,
      pay.product_snapshot ->> 'name' as product_name,
      pay.amount_agorot,
      pay.paid_on,
      -- The link a replacement starts from: the live one, or, when every
      -- link of the payment is revoked, the last one revoked.
      case
        when t.state <> 'revoked' then true
        else not exists (
          select 1
          from public.activation_tokens t2
          where t2.payment_id = t.payment_id
            and t2.purpose = 'join'
            and t2.state <> 'revoked'
        )
        and t.id = (
          select t2.id
          from public.activation_tokens t2
          where t2.payment_id = t.payment_id
            and t2.purpose = 'join'
          order by t2.revoked_at desc nulls last, t2.created_at desc, t2.id desc
          limit 1
        )
      end as is_latest,
      exists (
        select 1
        from public.activation_tokens t3
        where t3.payment_id = t.payment_id
          and t3.purpose = 'join'
          and (
            t3.state = 'consumed'
            or private.join_link_status(t3) = 'claiming'
          )
      ) as payment_blocked
    from public.activation_tokens t
    join public.payments pay on pay.id = t.payment_id
    where t.purpose = 'join'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'token_id', l.id,
        'payment_id', l.payment_id,
        'status', case
          when l.fine_status in ('consumed', 'revoked', 'expired') then l.fine_status
          else 'pending'
        end,
        'detail', case
          when l.fine_status in ('awaiting_login', 'stuck', 'conflict') then l.fine_status
        end,
        'detail_name', case
          when l.fine_status = 'awaiting_login' then bound.full_name
        end,
        'conflict_reason', case when l.fine_status = 'conflict' then l.conflict_reason end,
        'product_name', l.product_name,
        'amount_agorot', l.amount_agorot,
        'paid_on', l.paid_on,
        'created_at', l.created_at,
        'expires_at', l.expires_at,
        'consumed_at', l.consumed_at,
        'revoked_at', l.revoked_at,
        'customer_name', case when l.fine_status = 'consumed' then customer.full_name end,
        'can_revoke',
          l.state not in ('consumed', 'revoked')
          and l.payment_customer_id is null
          and not l.payment_blocked,
        'can_replace',
          l.is_latest
          and l.payment_customer_id is null
          and not l.payment_blocked
      )
      order by l.created_at desc, l.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from links l
  left join public.profiles bound on bound.id = l.bound_user_id
  left join public.profiles customer on customer.id = l.customer_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- join_begin: correcting the input (deferred 1, 2) and claiming_at
-- ---------------------------------------------------------------------------

-- As in 20261002194018, except:
-- - entering claiming sets claiming_at;
-- - other input in claiming or awaiting_login (after the lock, under the
--   idempotency key of this input): expired -> LINK_EXPIRED;
--   identity_attempts >= 2 -> conflict too_many_attempts; claiming whose
--   pending Auth user exists -> {outcome: discard_pending_user, token_id,
--   pending_user_id} without a state change (the server deletes that user,
--   then calls again with a new key); otherwise the link goes back to
--   pending (pending_user_id, input_hash, claiming_at and bound_user_id
--   cleared, identity_attempts + 1) and the input is classified as on a
--   pending link. The same input as before: unchanged (claiming continues,
--   also after the expiry).
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

    if v_token.identity_attempts >= 2 then
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
    elsif v_token.state = 'claiming'
          and exists (select 1 from auth.users u where u.id = v_token.pending_user_id) then
      -- The Auth user of the previous input goes first; nothing changes here.
      v_result := jsonb_build_object(
        'outcome', 'discard_pending_user',
        'token_id', v_token.id,
        'pending_user_id', v_token.pending_user_id
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

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from security definer RPCs (run as owner).
revoke execute on function private.bind_purchase(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.join_link_status(public.activation_tokens) from public, anon, authenticated, service_role;
revoke execute on function private.lock_join_payment(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.revoke_join_token(public.activation_tokens, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.admin_issue_link(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_issue_link(text, uuid, uuid) to authenticated;

revoke execute on function public.admin_revoke_link(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_link(uuid, uuid) to authenticated;

revoke execute on function public.admin_list_links() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_links() to authenticated;

revoke execute on function public.join_begin(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_begin(text, text, text, uuid) to service_role;
