-- Story 6.11, round 2 (after review, user decision 2026-11-11).
--
-- 1. Every email leaves through one database function, private.send_email
--    (pg_net -> the Resend API; the key in Vault, resend_api_key, entered by
--    the user per project). The dashboard SMTP is no longer used.
-- 2. A Postgres Send Email Hook (public.send_email_hook): Auth's public
--    endpoints (/recover, /otp) email any account with the publishable key,
--    and a Magic Link logs in. The hook sends only a recovery email, and only
--    to a verified, eligible account; every other type is dropped silently.
-- 3. Verification uses our own one-time token (not an Auth login token):
--    request_email_verification issues it and sends the link;
--    consume_email_verification uses it and writes the record only if the
--    token's email_hash still matches the current email (an old link never
--    verifies a new address). Replaces set_email_verified.
-- 4. begin_my_email_change / finish_my_email_change become service_role with
--    p_user_id: the server calls them only after it checked her current
--    password (granted to authenticated, a held session could skip it). Begin
--    refuses while another email change is pending.
--
-- The first file (20261111191636_email_verification.sql) is applied in dev
-- and stays as it is. Redefinitions start from the live definitions in dev.
-- Has drops, so it is run in the SQL Editor (AGENTS.md).

-- 1. Verification tokens -------------------------------------------------------

-- Only the sha256 of the raw token is stored; the raw token goes only into
-- the email. email_hash: the address it was sent to. No grants.
create table private.email_verification_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_verification_tokens_user_idx
  on private.email_verification_tokens (user_id)
  where used_at is null;

alter table private.email_verification_tokens enable row level security;
revoke all on table private.email_verification_tokens from public, anon, authenticated, service_role;

-- The pg_net request ids of the emails, so the push worker's check
-- (scripts/prod-check.mjs) can tell its responses from Resend's. No address,
-- only the id and when. No grants.
create table private.email_requests (
  request_id bigint primary key,
  created_at timestamptz not null default now()
);

alter table private.email_requests enable row level security;
revoke all on table private.email_requests from public, anon, authenticated, service_role;

-- 2. Sending -------------------------------------------------------------------

-- One email through the Resend API. Without the Vault key (or an address)
-- nothing is sent: a warning, and null. Returns the pg_net request id; the
-- request leaves only when the transaction commits.
create function private.send_email(p_to text, p_subject text, p_html text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id bigint;
begin
  if nullif(btrim(coalesce(p_to, '')), '') is null
     or nullif(btrim(coalesce(p_subject, '')), '') is null
     or nullif(btrim(coalesce(p_html, '')), '') is null then
    raise warning 'send_email: missing address, subject or body';
    return null;
  end if;

  select btrim(s.decrypted_secret) into v_key
  from vault.decrypted_secrets s
  where s.name = 'resend_api_key';

  if coalesce(v_key, '') = '' then
    raise warning 'send_email: no resend_api_key in Vault, nothing sent';
    return null;
  end if;

  v_id := net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object(
      'from', 'בראנץ׳ אצל טל <noreply@morethanfood.co.il>',
      'to', jsonb_build_array(btrim(p_to)),
      'subject', p_subject,
      'html', p_html
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 10000
  );

  insert into private.email_requests (request_id) values (v_id)
  on conflict do nothing;
  -- Old ids go a little at a time (pg_net keeps responses for 6 hours).
  delete from private.email_requests
  where request_id in (
    select r.request_id from private.email_requests r
    where r.created_at < now() - interval '7 days'
    limit 100
  );

  return v_id;
end;
$$;

-- A link as an href value and as text.
create function private.html_escape(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''),
    '&', '&amp;'), '"', '&quot;'), '<', '&lt;'), '>', '&gt;');
$$;

-- A site URL as Auth or the server passes it: http(s), no quotes or spaces,
-- without a trailing slash; null when it is not one.
create function private.clean_site_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_url, '')) ~ '^https?://[A-Za-z0-9.:\[\]-]+(/[A-Za-z0-9._~/-]*)?$'
      then rtrim(btrim(p_url), '/')
    else null
  end;
$$;

create function private.email_subject(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'verification' then 'אימות כתובת המייל'
    when 'reset' then 'קישור לאיפוס סיסמה'
  end;
$$;

-- The Hebrew RTL email (story 6.11; the copy of the former dashboard
-- templates): the verification email or the reset email, with the button
-- and the plain link. Colours from DESIGN.md.
create function private.email_html(p_kind text, p_link text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_link text := private.html_escape(p_link);
  v_title text;
  v_intro text;
  v_button text;
  v_footer text;
begin
  if p_kind = 'verification' then
    v_title := 'אימות כתובת המייל';
    v_intro := 'כדי לאמת את כתובת המייל של החשבון שלך, לוחצים על הכפתור ובעמוד שנפתח על "אימות המייל". אחרי האימות אפשר יהיה לאפס סיסמה לבד.';
    v_button := 'לאימות המייל';
    v_footer := 'הקישור בתוקף שעה ופועל פעם אחת. אם לא ביקשת את המייל הזה, אפשר להתעלם ממנו.';
  elsif p_kind = 'reset' then
    v_title := 'איפוס סיסמה';
    v_intro := 'קיבלנו בקשה לאיפוס הסיסמה של החשבון שלך. לבחירת סיסמה חדשה, לוחצים על הכפתור.';
    v_button := 'לבחירת סיסמה חדשה';
    v_footer := 'הקישור בתוקף שעה ופועל פעם אחת. אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל הזה, והסיסמה נשארת כמו שהיא.';
  else
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
    || '<meta name="viewport" content="width=device-width, initial-scale=1">'
    || '<title>' || v_title || '</title></head>'
    || '<body dir="rtl" style="margin:0;padding:0;background-color:#faf6ee;color:#2e2a1f">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf6ee"><tr><td align="center" style="padding:32px 16px">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:480px;background-color:#fffdf8;border:1px solid #e6dfcf;border-radius:12px"><tr>'
    || '<td dir="rtl" style="padding:32px 24px;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.6;color:#2e2a1f">'
    || '<h1 style="margin:0 0 16px;font-size:24px;font-weight:normal;line-height:1.3">' || v_title || '</h1>'
    || '<p style="margin:0 0 24px">' || v_intro || '</p>'
    || '<p style="margin:0 0 24px"><a href="' || v_link || '" style="display:inline-block;padding:12px 24px;background-color:#4a4a2a;color:#faf6ee;text-decoration:none;border-radius:8px;font-size:17px">' || v_button || '</a></p>'
    || '<p style="margin:0 0 8px;font-size:15px;color:#6b6450">הכפתור לא נפתח? אפשר להעתיק את הקישור לדפדפן:</p>'
    || '<p dir="ltr" style="margin:0 0 24px;font-size:14px;text-align:left;word-break:break-all"><a href="' || v_link || '" style="color:#4a4a2a">' || v_link || '</a></p>'
    || '<p style="margin:0;font-size:15px;color:#6b6450">' || v_footer || '</p>'
    || '</td></tr></table></td></tr></table></body></html>';
end;
$$;

-- 3. Who may reset by email -------------------------------------------------------

-- A verified, activated, non-anonymized customer, or a verified admin. One
-- rule for the forgot page (get_email_reset_eligibility) and the hook.
create function private.email_reset_eligible(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.email_verified(p_user_id), false) and (
    exists (select 1 from public.admin_roles r where r.user_id = p_user_id)
    or exists (
      select 1 from public.profiles p
      where p.id = p_user_id
        and p.activated_at is not null
        and p.anonymized_at is null
    )
  );
$$;

-- From the live definition; the rule moves to private.email_reset_eligible.
create or replace function public.get_email_reset_eligibility(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
  v_user uuid;
  v_eligible boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_email is null or char_length(v_email) > 254 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email
  order by u.id
  limit 1;

  if v_user is not null then
    v_eligible := private.email_reset_eligible(v_user);
  end if;

  return jsonb_build_object('user_id', v_user, 'eligible', v_eligible);
end;
$$;

-- 4. Our verification token ---------------------------------------------------------

drop function public.set_email_verified(uuid);

-- Sends the verification email to the user's current address: nothing when
-- it is verified already ({sent: false}); otherwise her unused tokens are
-- voided (only the newest link works), a new one is issued (32 random bytes,
-- base64url, as private.issue_token; only the sha256 is stored, with the
-- address's hash and a 1 hour expiry) and the link
-- <p_site_url>/verify-email?token=<raw> is sent. The raw token never leaves
-- this function except in the email. Exempt from idempotency: each call is
-- one send (the server rate-limits it).
create function public.request_email_verification(p_user_id uuid, p_site_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- /verify-email, on the button press: uses the token once, in one
-- transaction with the record. Unknown, used or expired, or an address that
-- changed since the link was sent: LINK_INVALID and nothing is written. It
-- never logs anyone in. is_admin tells the page where its button goes.
-- Exempt from idempotency: the token itself is single use.
create function public.consume_email_verification(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- 5. The Send Email Hook ------------------------------------------------------------

-- Auth calls it instead of sending any email (Authentication -> Hooks ->
-- Send Email -> Postgres -> public.send_email_hook). Only a recovery email
-- to an eligible user is sent, to her current address, with the link
-- <site_url>/reset-password?token_hash=<token_hash> (verified on the server
-- with verifyOtp). Every other type (magic link, signup, invite, email
-- change, reauthentication) and every ineligible user: nothing is sent.
-- Always answers '{}', so Auth's answer never tells which case it was. The
-- one function outside AD-5's grant rule: execute only for
-- supabase_auth_admin.
create function public.send_email_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_type text := event -> 'email_data' ->> 'email_action_type';
  v_token_hash text := event -> 'email_data' ->> 'token_hash';
  v_site text := private.clean_site_url(event -> 'email_data' ->> 'site_url');
  v_email text;
begin
  begin
    v_user := (event -> 'user' ->> 'id')::uuid;
  exception when others then
    v_user := null;
  end;

  if v_type is distinct from 'recovery'
     or v_user is null
     or v_site is null
     or coalesce(v_token_hash, '') !~ '^[A-Za-z0-9_-]{16,255}$'
     or not private.email_reset_eligible(v_user) then
    return '{}'::jsonb;
  end if;

  select btrim(u.email) into v_email from auth.users u where u.id = v_user;

  perform private.send_email(
    v_email,
    private.email_subject('reset'),
    private.email_html('reset', v_site || '/reset-password?token_hash=' || v_token_hash)
  );

  return '{}'::jsonb;
exception when others then
  -- A failed send never tells the caller anything; the warning is in the
  -- database log (no address).
  raise warning 'send_email_hook failed: %', sqlstate;
  return '{}'::jsonb;
end;
$$;

-- 6. Her own email change: service_role, after the password check ---------------------

drop function public.begin_my_email_change(text, uuid);
drop function public.finish_my_email_change(boolean, uuid);

-- Step 1 of her own email change (AD-21). The server calls it only after it
-- checked her current password, with her user id. The same checks as
-- admin_begin_email_change; another change already pending with a
-- different address: ACCOUNT_CHANGE_BLOCKED (the same address resumes).
create function public.begin_my_email_change(p_user_id uuid, p_email text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := 'user:' || coalesce(p_user_id::text, '');
  v_email text := lower(btrim(p_email));
  v_hash text := private.email_hash(p_email);
  v_prev jsonb;
  v_old public.profiles;
  v_current text;
  v_match jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- The request is hashed; the address itself never reaches the row.
  v_prev := private.idempotent_begin(
    v_scope, 'begin_my_email_change', p_idempotency_key,
    jsonb_build_object('email_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_email is null
     or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "email"}';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_user_id
  for update;

  if v_old.id is null
     or v_old.anonymized_at is not null
     or v_old.activated_at is null
     or v_old.account_op_state = 'anonymization_pending'
     or exists (select 1 from public.admin_roles r where r.user_id = v_old.id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_old.account_op_state = 'email_change_pending' then
    -- The same change again (a crash between the steps): resume from Auth.
    if v_old.account_op_target_hash = v_hash then
      return private.idempotent_finish(
        v_scope, 'begin_my_email_change', p_idempotency_key,
        jsonb_build_object('result', 'pending', 'user_id', v_old.id)
      );
    end if;
    -- Another change (hers to another address, or Tal's) is in progress.
    raise exception 'ACCOUNT_CHANGE_BLOCKED' using errcode = 'P0001';
  end if;

  select u.email into v_current from auth.users u where u.id = v_old.id;
  if lower(btrim(v_current)) = v_email then
    raise exception 'EMAIL_UNCHANGED' using errcode = 'P0001';
  end if;

  v_match := private.find_identity(v_email, null);
  if v_match ->> 'match' <> 'none'
     and (v_match ->> 'customer_id') is distinct from v_old.id::text then
    -- Blocked: nothing changes; the answer carries no address.
    return private.idempotent_finish(
      v_scope, 'begin_my_email_change', p_idempotency_key,
      jsonb_build_object('result', 'taken')
    );
  end if;

  update public.profiles
  set account_op_state = 'email_change_pending',
      account_op_started_at = now(),
      account_op_target_hash = v_hash
  where id = v_old.id;

  return private.idempotent_finish(
    v_scope, 'begin_my_email_change', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', v_old.id)
  );
end;
$$;

-- Step 3: clears the state and logs the change by the customer (the address
-- masked by audit_diff). Safe to repeat: without a pending change it answers
-- not_pending. Mirrors admin_finish_email_change.
create function public.finish_my_email_change(p_user_id uuid, p_succeeded boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := 'user:' || coalesce(p_user_id::text, '');
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_current text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_scope, 'finish_my_email_change', p_idempotency_key,
    jsonb_build_object('succeeded', p_succeeded)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_succeeded is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_user_id
    and p.activated_at is not null
    and p.anonymized_at is null
  for update;

  if v_old.id is null
     or v_old.account_op_state is distinct from 'email_change_pending' then
    return private.idempotent_finish(
      v_scope, 'finish_my_email_change', p_idempotency_key,
      jsonb_build_object('result', 'not_pending')
    );
  end if;

  select u.email into v_current from auth.users u where u.id = v_old.id;

  if p_succeeded and private.email_hash(v_current) is distinct from v_old.account_op_target_hash then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  update public.profiles
  set account_op_state = null,
      account_op_started_at = null,
      account_op_target_hash = null
  where id = v_old.id
  returning * into v_new;

  if p_succeeded then
    perform private.audit(
      p_user_id, 'customer', 'finish_my_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old) || jsonb_build_object('email', 'previous'),
      to_jsonb(v_new) || jsonb_build_object('email', 'current')
    );
  else
    perform private.audit(
      p_user_id, 'customer', 'finish_my_email_change', 'profiles', v_old.id,
      v_old.id, null,
      to_jsonb(v_old),
      to_jsonb(v_new) || jsonb_build_object('result', 'taken')
    );
  end if;

  return private.idempotent_finish(
    v_scope, 'finish_my_email_change', p_idempotency_key,
    jsonb_build_object('result', case when p_succeeded then 'changed' else 'taken' end)
  );
end;
$$;

-- 7. Grants (AD-5) --------------------------------------------------------------------

revoke execute on function private.send_email(text, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.html_escape(text) from public, anon, authenticated, service_role;
revoke execute on function private.clean_site_url(text) from public, anon, authenticated, service_role;
revoke execute on function private.email_subject(text) from public, anon, authenticated, service_role;
revoke execute on function private.email_html(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.email_reset_eligible(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.get_email_reset_eligibility(text) from public, anon, authenticated, service_role;
grant execute on function public.get_email_reset_eligibility(text) to service_role;

revoke execute on function public.request_email_verification(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.request_email_verification(uuid, text) to service_role;

revoke execute on function public.consume_email_verification(text) from public, anon, authenticated, service_role;
grant execute on function public.consume_email_verification(text) to service_role;

revoke execute on function public.begin_my_email_change(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_my_email_change(uuid, text, uuid) to service_role;

revoke execute on function public.finish_my_email_change(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_my_email_change(uuid, boolean, uuid) to service_role;

-- The hook: Auth's own role only.
revoke execute on function public.send_email_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_email_hook(jsonb) to supabase_auth_admin;
