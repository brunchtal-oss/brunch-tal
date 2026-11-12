-- Story 6.11, review fixes after round 2 (2026-11-11).
--
-- 1. The Send Email Hook builds the reset link from Vault `site_url` (per
--    project, the site's address): Auth's email_data.site_url is its own API
--    address (https://<ref>.supabase.co/auth/v1), so links built from it
--    404. email_data.site_url and redirect_to are never used. No value:
--    nothing is sent (a warning).
-- 2. The hook throttles: Auth's own email limit does not apply with Confirm
--    email off, so direct /recover calls could flood a verified user and
--    use up the Resend quota. At most 3 recovery emails per user and 20 per
--    project in a rolling hour; the rest are dropped silently.
-- 3. private.send_email becomes security invoker: its callers are definer
--    functions of the same owner; no API role may execute it.
-- 4. request_email_verification: one call at a time per user (advisory
--    lock), and her used or expired token rows are deleted.
-- 5. consume_email_verification takes the browser session's user id (only
--    the account's own session verifies) and refuses (LINK_INVALID) while her details
--    are removed or being removed; admin_anonymize_customer also deletes her
--    verification tokens.
--
-- The earlier files (20261111191636, 20261111200341) are applied in dev and
-- stay as they are. Redefinitions from the live definitions in dev.

-- 1. The hook's throttle ---------------------------------------------------------

-- One row per recovery email the hook sent: who and when. Rows older than an
-- hour are pruned by the hook itself. No grants.
create table private.email_hook_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  sent_at timestamptz not null default now()
);

create index email_hook_sends_user_idx on private.email_hook_sends (user_id, sent_at);
create index email_hook_sends_sent_at_idx on private.email_hook_sends (sent_at);

alter table private.email_hook_sends enable row level security;
revoke all on table private.email_hook_sends from public, anon, authenticated, service_role;

-- 2. send_email runs with its caller's rights -------------------------------------

alter function private.send_email(text, text, text) security invoker;

-- 3. The hook -----------------------------------------------------------------------

-- Auth calls it instead of sending any email (Authentication -> Hooks ->
-- Send Email -> Postgres -> public.send_email_hook). Only a recovery email
-- to an eligible user is sent, to her current address, with the link
-- <Vault site_url>/reset-password?token_hash=<token_hash> (verified on the
-- server with verifyOtp). Every other type, every ineligible user, a missing
-- Vault site_url, and anything over 3 per user or 20 per project in an
-- hour: nothing is sent. Always answers '{}', so Auth's answer never tells
-- which case it was. Execute only for supabase_auth_admin.
create or replace function public.send_email_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_type text := event -> 'email_data' ->> 'email_action_type';
  v_token_hash text := event -> 'email_data' ->> 'token_hash';
  v_site text;
  v_email text;
  v_request bigint;
begin
  begin
    v_user := (event -> 'user' ->> 'id')::uuid;
  exception when others then
    v_user := null;
  end;

  if v_type is distinct from 'recovery'
     or v_user is null
     or coalesce(v_token_hash, '') !~ '^[A-Za-z0-9_-]{16,255}$'
     or not private.email_reset_eligible(v_user) then
    return '{}'::jsonb;
  end if;

  select private.clean_site_url(s.decrypted_secret) into v_site
  from vault.decrypted_secrets s
  where s.name = 'site_url';

  if v_site is null then
    raise warning 'send_email_hook: no valid site_url in Vault, nothing sent';
    return '{}'::jsonb;
  end if;

  -- The throttle, one hook call at a time.
  perform pg_advisory_xact_lock(hashtext('email_hook_sends'));
  delete from private.email_hook_sends
  where sent_at < now() - interval '1 hour';

  if (select count(*) from private.email_hook_sends h where h.user_id = v_user) >= 3
     or (select count(*) from private.email_hook_sends) >= 20 then
    return '{}'::jsonb;
  end if;

  select btrim(u.email) into v_email from auth.users u where u.id = v_user;

  v_request := private.send_email(
    v_email,
    private.email_subject('reset'),
    private.email_html('reset', v_site || '/reset-password?token_hash=' || v_token_hash)
  );

  if v_request is not null then
    insert into private.email_hook_sends (user_id) values (v_user);
  end if;

  return '{}'::jsonb;
exception when others then
  -- A failed send never tells the caller anything; the warning is in the
  -- database log (no address).
  raise warning 'send_email_hook failed: %', sqlstate;
  return '{}'::jsonb;
end;
$$;

-- 4. Our verification token -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_email_verification(p_user_id uuid, p_site_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_site text := private.clean_site_url(p_site_url);
  v_email text;
  v_hash text;
  v_raw text;
  v_request bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_user_id is null or v_site is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- One request at a time per user (story 6.11 fixes): never two live tokens.
  perform pg_advisory_xact_lock(hashtext('email_verification:' || p_user_id::text));

  -- Her used or expired tokens are gone for good.
  delete from private.email_verification_tokens
  where user_id = p_user_id
    and (used_at is not null or expires_at <= now());

  select btrim(u.email), private.email_hash(u.email) into v_email, v_hash
  from auth.users u
  where u.id = p_user_id;

  if v_hash is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if private.email_verified(p_user_id) then
    return jsonb_build_object('sent', false, 'reason', 'verified');
  end if;

  update private.email_verification_tokens
  set used_at = now()
  where user_id = p_user_id and used_at is null;

  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  insert into private.email_verification_tokens (token_hash, user_id, email_hash, expires_at)
  values (private.token_hash(v_raw), p_user_id, v_hash, now() + interval '1 hour');

  v_request := private.send_email(
    v_email,
    private.email_subject('verification'),
    private.email_html('verification', v_site || '/verify-email?token=' || v_raw)
  );

  return jsonb_build_object('sent', v_request is not null);
end;
$function$;

-- consume_email_verification gets the browser session's user id (new
-- signature: drop and create). From the live definition.
drop function public.consume_email_verification(text);

CREATE FUNCTION public.consume_email_verification(p_token text, p_session_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row private.email_verification_tokens;
  v_current text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,255}$' then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  select t.* into v_row
  from private.email_verification_tokens t
  where t.token_hash = private.token_hash(p_token)
  for update;

  if v_row.token_hash is null
     or v_row.used_at is not null
     or v_row.expires_at <= now() then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  -- Only the account's own session verifies (user decision 2026-11-11): the
  -- server passes the browser session's user id, never a form value. Another
  -- account (or none): LINK_INVALID, and the token stays unused (the raise
  -- rolls back), so the right account can still use it.
  if p_session_user_id is null or p_session_user_id <> v_row.user_id then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  -- Her details removed or being removed: the token is dead (story 6.11
  -- fixes), so no record comes back.
  if exists (
    select 1 from public.profiles p
    where p.id = v_row.user_id
      and (p.anonymized_at is not null
           or p.account_op_state = 'anonymization_pending')
  ) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  select private.email_hash(u.email) into v_current
  from auth.users u
  where u.id = v_row.user_id;

  if v_current is distinct from v_row.email_hash then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  update private.email_verification_tokens
  set used_at = now()
  where token_hash = v_row.token_hash;

  insert into private.email_verifications (user_id, email_hash, verified_at)
  values (v_row.user_id, v_row.email_hash, now())
  on conflict (user_id) do update
  set email_hash = excluded.email_hash,
      verified_at = excluded.verified_at;

  return jsonb_build_object(
    'is_admin', exists (
      select 1 from public.admin_roles r where r.user_id = v_row.user_id
    )
  );
end;
$function$;

-- 5. The removal of details -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_anonymize_customer(p_customer_id uuid, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_prev jsonb;
  v_profile public.profiles;
  v_plan jsonb;
  v_blockers jsonb;
  v_token_ids uuid[];
  v_payment_ids uuid[];
  v_old_token public.activation_tokens;
  v_new_token public.activation_tokens;
  -- Story 5.20: the Auth users of her claiming links, deleted by the
  -- caller after this call (they never have a profile).
  v_orphans uuid[] := '{}'::uuid[];
  v_prefix text := '/admin/customers/' || coalesce(p_customer_id::text, '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_confirmed is distinct from true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Locks (AD-6): her tokens, her babies (private.babies_guard locks a baby
  -- before its profile), her profile (the mutex), bookings, payments,
  -- waitlist entries, notification jobs.
  perform 1
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id
  order by t.id
  for update;

  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  into v_token_ids
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id;

  perform 1
  from public.babies b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_profile.id is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- A retry: cleaned already; never cleaned again.
  if v_profile.anonymized_at is not null then
    return private.idempotent_finish(
      v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
      jsonb_build_object(
        'result', case
          when v_profile.account_op_state = 'anonymization_pending' then 'pending'
          else 'done'
        end,
        'user_id', v_profile.id
      )
    );
  end if;

  -- Story 5.20: not while her email change is between its steps (AD-21).
  if v_profile.account_op_state = 'email_change_pending' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.bookings b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  -- The blockers again, under the locks (the preview may be stale).
  v_plan := private.plan_admin_anonymize_customer(p_customer_id);
  v_blockers := v_plan -> 'blockers';
  if jsonb_array_length(v_blockers -> 'bookings') > 0
     or jsonb_array_length(v_blockers -> 'refund_requests') > 0
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0
     or jsonb_array_length(v_blockers -> 'parked_purchases') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices'),
        'parked_purchases', jsonb_array_length(v_blockers -> 'parked_purchases')
      )::text;
  end if;

  -- Her payments, and the unbound ones behind her join links (a purchase
  -- waiting for her sign-in), by id.
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_payment_ids
  from public.payments p
  where p.customer_id = p_customer_id
     or p.id in (
       select t.payment_id
       from public.activation_tokens t
       where t.id = any (v_token_ids)
         and t.purpose = 'join'
         and t.payment_id is not null
     );

  perform 1
  from public.payments p
  where p.id = any (v_payment_ids)
  order by p.id
  for update;

  perform 1
  from public.waitlist_entries w
  where w.customer_id = p_customer_id
  order by w.id
  for update;

  perform 1
  from public.notification_jobs j
  join public.notifications n on n.id = j.notification_id
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix)
  order by j.id
  for update of j;

  -- Her links: a live link is revoked, except a join waiting for her
  -- sign-in, which can never bind now (a conflict in "to handle"); each
  -- one logged as admin_issue_link logs a revoke. Then no input hash stays.
  for v_old_token in
    select t.*
    from public.activation_tokens t
    where t.id = any (v_token_ids)
      and t.state in ('pending', 'awaiting_login', 'claiming')
    order by t.id
  loop
    update public.activation_tokens t
    set input_hash = null,
        state = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'conflict'
          else 'revoked'
        end,
        conflict_reason = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'bind_conflict'
          else t.conflict_reason
        end,
        revoked_at = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then t.revoked_at
          else v_now
        end
    where t.id = v_old_token.id
    returning * into v_new_token;

    if v_old_token.state = 'claiming'
       and v_old_token.pending_user_id is not null
       and v_old_token.pending_user_id <> p_customer_id then
      v_orphans := v_orphans || v_old_token.pending_user_id;
    end if;

    perform private.audit(
      v_actor, 'admin', 'revoke_link', 'activation_tokens', v_old_token.id,
      p_customer_id, null, to_jsonb(v_old_token), to_jsonb(v_new_token)
    );
  end loop;

  update public.activation_tokens t
  set input_hash = null
  where t.id = any (v_token_ids)
    and t.input_hash is not null;

  -- The profile: full_name is NOT NULL, so it becomes the removed wording;
  -- the privacy consent (when and which version) stays.
  update public.profiles
  set full_name = 'לקוחה שפרטיה הוסרו',
      phone_e164 = null,
      pending_email = null,
      dietary_notes = null,
      special_brunch_interests = '{}',
      photo_consent = false,
      photo_consent_at = null,
      photo_consent_text_version = null,
      personal_photo_consent = false,
      personal_photo_consent_at = null,
      personal_photo_consent_text_version = null,
      anonymized_at = v_now,
      account_op_state = 'anonymization_pending',
      account_op_started_at = v_now,
      account_op_target_hash = null
  where id = p_customer_id;

  -- Admin deletes skip babies_guard's profile lock and LAST_BABY (the
  -- caller is not the customer).
  delete from public.babies where customer_id = p_customer_id;
  delete from public.customer_notes where customer_id = p_customer_id;
  -- Story 6.11: her email verification record.
  delete from private.email_verifications where user_id = p_customer_id;
  -- Story 6.11 fixes: and her verification tokens.
  delete from private.email_verification_tokens where user_id = p_customer_id;
  delete from public.waitlist_entries where customer_id = p_customer_id;
  -- notification_deliveries go with them (on delete cascade).
  delete from public.push_subscriptions where user_id = p_customer_id;
  -- Their notification_jobs (and deliveries) go with them.
  delete from public.notifications n
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix);

  update public.payments
  set payer_label = null,
      note = null
  where id = any (v_payment_ids)
    and (payer_label is not null or note is not null);

  update public.bookings
  set guest_details = null
  where customer_id = p_customer_id
    and guest_details is not null;

  -- Stored results: hers, her links', and Tal's that name her. This call's
  -- own row has no result yet, so it stays.
  delete from private.idempotency_results r
  where r.actor_scope = p_customer_id::text
     or r.actor_scope = any (
       select 'token:' || x::text from unnest(v_token_ids) as x
     )
     or (
       r.actor_scope in (select a.user_id::text from public.admin_roles a)
       and r.result::text like '%' || p_customer_id::text || '%'
     );

  -- Her audit rows, and those of the payments above (written while
  -- customer_id was null too): note is the one free-text key audit_diff
  -- does not mask.
  update public.audit_log a
  set before = case
        when a.before ? 'note' then jsonb_set(a.before, '{note}', '"<removed>"'::jsonb)
        else a.before
      end,
      after = case
        when a.after ? 'note' then jsonb_set(a.after, '{note}', '"<removed>"'::jsonb)
        else a.after
      end
  where (
      a.customer_id = p_customer_id
      or (a.entity_type = 'payments' and a.entity_id = any (v_payment_ids))
    )
    and (a.before ? 'note' or a.after ? 'note');

  perform private.audit(
    v_actor, 'admin', 'admin_anonymize_customer', 'profiles', p_customer_id,
    p_customer_id, null,
    jsonb_build_object('anonymized_at', null),
    jsonb_build_object('anonymized_at', v_now)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object(
      'result', 'pending',
      'user_id', p_customer_id,
      'orphan_user_ids', to_jsonb(v_orphans)
    )
  );
end;
$function$;

-- 6. Grants (AD-5); create or replace keeps them, restated here -----------------------

revoke execute on function private.send_email(text, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.request_email_verification(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.request_email_verification(uuid, text) to service_role;

revoke execute on function public.consume_email_verification(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.consume_email_verification(text, uuid) to service_role;

revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;

revoke execute on function public.send_email_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_email_hook(jsonb) to supabase_auth_admin;
