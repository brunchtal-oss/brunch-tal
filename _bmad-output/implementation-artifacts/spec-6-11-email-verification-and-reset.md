---
title: '6.11 Email verification and self-service password reset'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '367dabd0c526cd55b3933a86b9659671d051ffd7'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment', 'spec-compliance', 'security']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every account is created with `email_confirm: true` (AD-10), so Auth's "confirmed" proves nothing, and the source allows automatic email reset only after a mail provider and real email verification. Until then reset is manual through Tal.

**Approach (revised 2026-11-11 after review):** All email leaves through one database send function (pg_net → Resend API, key in Vault). A Supabase Send Email Hook lets only recovery emails to verified, eligible addresses through; everything else Auth would send is dropped. Verification uses our own one-time token (not an Auth login token). A "forgot password" page sends the Auth recovery email only to a verified address, with the same answer in every case. A customer can change her own email (current password required). Hebrew email copy lives in a migration, so both projects are identical.

## Decisions (user, 2026-11-11)

- Unverified customers: banner with a resend button in the personal area until verified; new customers get the email automatically on join. No bulk send.
- Sender: `noreply@morethanfood.co.il`, name "בראנץ׳ אצל טל" (the published business name). The Resend domain is therefore `morethanfood.co.il`. Its records sit on `send.` and `resend._domainkey.` (plus `_dmarc`), not on the root SPF or MX, so a future Google Workspace does not conflict.
- Tal (admin) can reset her own password by email: the admin home shows the same verification banner, and a verified admin is eligible.
- Keep one spec (no split).
- After review (user, 2026-11-11, through the work manager): Auth's public endpoints (`/recover`, `/otp`) email any account with the publishable key, and a Magic Link is a login credential. So: (a) a Postgres Send Email Hook passes on only `recovery` to a verified, eligible address and silently drops every other type (magic link, signup, invite, email change, reauthentication); (b) verification uses our own token: 32 random bytes, only its hash stored with `user_id`, the `email_hash` of the address it was sent to, 1 h expiry, single use; consumed on POST by a service_role RPC that writes the record only if that `email_hash` still matches the current email; it never logs anyone in; (c) one DB send function (pg_net → Resend API) used by both; Resend key in Vault per project (entered by the user in the SQL Editor, Sending access); no key in Vercel or code; (d) the dashboard SMTP becomes unused. All review patches approved; the listed defers approved; the verify page shows "כתובת המייל אומתה" with a button (no auto-redirect).
- After review round 2 (user, 2026-11-11, through the work manager): verifying needs the account's own login. `/verify-email` for a signed-out visitor shows "כדי לאמת את המייל צריך להתחבר" with a login button that returns to the verify page; the consuming RPC checks that the session user equals the token's user; another account signed in → `LINK_INVALID` and its session is untouched. The return parameter accepts only an internal path (no open redirect), and the token is never logged (login with the return path gets the token routes' no-store / no-referrer). Reason: a stranger who receives a verification email for a mistyped address must not be able to verify and then reset.
- New: a customer can change her own email from her profile. This overrides "email change only through Tal" in `security-and-rpc-rules.md` (derived doc; the source does not restrict it). Recorded in the SPEC `.memlog.md`, `security-and-rpc-rules.md` and the completion plan.
- Phone check (user, 2026-11-12, through the work manager): the email change moves into the "הפרטים שלי" edit form ("עריכה"); the separate "שינוי מייל" link is removed. The form shows her email as a field; once it differs (case and spaces aside), "המייל החדש שוב" and "הסיסמה הנוכחית" open under it. One "שמירה": her password is checked first (wrong → nothing saved), then the details, then the existing begin / `updateUserById` / finish path, then the verification email to the new address. If only the email part fails, the details stay saved and the error shows on the email field. The phone is read only in the form, with a grey note "לשינוי הטלפון צרי קשר" ("צרי קשר" links to the business WhatsApp, `getWhatsappHref` / `ContactText`; plain text without business details). No self phone change: the source document, line 169: "שינוי מספר טלפון יתבצע דרך טל לאחר בדיקת זהות ומניעת כפילות. אין לאפשר השתלטות על חשבון באמצעות הזנת מספר טלפון בלבד."
- Phone check (user, 2026-11-12, through the work manager): the emails get a new look and shorter copy (subjects unchanged): an olive band with the business name, the home hero as a header image, the title, one line, a full-width button, a small grey note under it, then a line, the business name as a signature and the site's address (the origin of the email's own link), and at the very bottom, 12px grey, "הכפתור לא נפתח? אפשר להעתיק את הקישור לדפדפן:" with the raw link. Verification: "אימות המייל" / "לוחצים על הכפתור, ובעמוד שנפתח על "אימות המייל"." / button "לאימות המייל". Reset: "איפוס סיסמה" / "לבחירת סיסמה חדשה, לוחצים על הכפתור." / button "בחירת סיסמה חדשה". Note in both: "הקישור בתוקף לשעה. לא ביקשת? אפשר להתעלם מהמייל." No sentence breaks mid-line (her rule from the forgot page): each sentence, or a sentence's part up to its comma or question mark, is a `white-space:nowrap` unit, each measured to fit a 320px phone's card (widest 236px of 238). The image is a small JPEG (≈1120x520, ≤200 KB, made outside the repo) at `media-public/email/header.jpg`, its public URL in Vault `email_image_url`; per project, `scripts/dev-email-image.mjs` / `prod-email-image.mjs` upload the file (prod: dry run by default, `--apply` with her OK) and print the one SQL Editor line for Vault, which she runs (the scripts' database role has no Vault write privilege: 42501 on dev); no project URL in the migration; missing → no image. Migration `20261112204056_email_design.sql`: `create or replace private.email_html` only (now `stable`, it reads Vault).
- Phone check (user, 2026-11-12): after a password reset, other devices are signed out within at most 1 hour. The global sign-out revokes every session and refresh token at once, but pages check the session with `getClaims` (local JWT check) and RLS reads the JWT, so an access token already issued works until it expires (`jwt_expiry` 3600). Documented behaviour, no fix in 6.11.

## Boundaries & Constraints

**Always:**
- Verified = a row in `private.email_verifications` whose `email_hash` equals `private.email_hash(<current auth.users email>)`. Any email change therefore un-verifies by itself. Only the service_role RPC that consumes our verification token writes it.
- Verification link: `<site>/verify-email?token=<raw>` (our token). Reset link: `<email_data.site_url>/reset-password?token_hash=<token_hash>` built by the hook, verified on the server with `verifyOtp` (works across devices; no PKCE). A GET only renders a page. Consuming a token happens only on a button press (POST via Server Action), so mail scanners and previews never use the link.
- Reset is requested through a stateless server client (publishable key, `persistSession: false`, `flowType: 'implicit'`) with `resetPasswordForEmail`. `signInWithOtp` is not used.
- Every new action calls `hitRateLimit` first: `email` bucket for sending (new: 5 per IP and 3 per id per 15 min; id = normalized email for forgot, user id for resend), `token` bucket with id = `token_hash` on the two link pages.
- The forgot-password answer is identical for unknown, unverified, anonymized, inactive and eligible addresses. The send runs in `after()`, so timing does not differ. Auth errors are swallowed and logged without the address.
- New RPCs follow AD-5 (definer, `search_path = ''`, one grant). The hook function is the one exception: execute only for `supabase_auth_admin`, none for public/anon/authenticated/service_role.
- Screens start with the `frontend-design` skill within DESIGN.md and EXPERIENCE.md. Data-changing buttons use `OnlineButton`. Copy in `lib/copy/auth.ts` / `customer.ts` / `admin.ts`, error codes in `lib/errors.ts`. Customer copy never says "טל" (contact = "צרי קשר").
- The Resend key goes only into Vault (`resend_api_key`), entered by the user. It never goes into the repo, chat, Vercel or code. One Resend API key per project, Sending access.
- Function redefinitions start from the live `pg_get_functiondef` in dev, not from an old file.

**Never:**
- No self phone change. No change to the join-link mechanism beyond sending the verification email after it. No domain hookup for the site (id 10), no business mailbox, no marketing email.
- Never show an email as verified without the record. Never send a reset link to an unverified address. Never `demo:*`/`video:*`, MCP or `execute_sql` on production, or `test:db` during a phone check.
- Confirm email stays off. Security notification emails stay off.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Join (self or Tal's form, 2.15) | `runJoin` succeeds | verification email to the new address, in `after()` | send failure never fails the join; banner offers resend |
| Tal changes email | `changeEmail` finishes | old record no longer matches; verification email to the new address (which also voids any older link) | same as above |
| Customer changes her email | `/me/profile` "עריכה" form (user decision 2026-11-12): her email field changed, then the new email again + current password, "שמירה" | session → details' shape → limit (`email`, id = user id) → email's shape → password checked on a stateless client (session untouched) → details saved → `begin_my_email_change` (duplicate check, `email_change_pending`, audit) → `updateUserById(email, email_confirm: true)` → `finish_my_email_change` → session refreshed → "המייל עודכן. מעכשיו מתחברים עם {email}. שלחנו אליו מייל אימות." + verification email | wrong password → `WRONG_PASSWORD` "הסיסמה הנוכחית לא נכונה"; mismatch → `EMAILS_DONT_MATCH` "שתי הכתובות לא זהות"; existing `EMAIL_TAKEN`, `EMAIL_UNCHANGED`, `ACCOUNT_CHANGE_BLOCKED`; Auth failure after begin → stays pending (Tal's existing "stuck" item); a failure after the details were saved → on the email field, details stay saved |
| Unverified admin on admin home | no matching record | same banner and resend action as the customer | — |
| Unverified customer on `/me` | no matching record | warning banner "כתובת המייל שלך עוד לא אומתה. אחרי האימות אפשר יהיה לאפס סיסמה לבד." + button "שליחת מייל אימות"; profile shows "המייל עוד לא אומת" | — |
| Resend | button pressed | "שלחנו מייל אימות אל {email}. הקישור בתוקף שעה. לא הגיע? כדאי לבדוק גם בתיקיית הספאם." | limit / Auth 429 → `TOO_MANY_ATTEMPTS` |
| Verify link | `/verify-email?token=…` then "אימות המייל" | service_role RPC consumes our token; writes the record only if the token's `email_hash` still matches the current email → page shows "כתובת המייל אומתה" with a button to `/me` or `/admin`; nobody is logged in | used/expired/bad → `LINK_INVALID`: "הקישור לא תקף, כבר נוצל או שפג תוקפו. אפשר לשלוח מייל אימות חדש מהאזור האישי." |
| Forgot, eligible | verified, active account | recovery email sent | same answer as every other case |
| Forgot, any other case | unknown / unverified / anonymized / not active | no email | answer, two lines (user decision 2026-11-12, phone check): "אם המייל שלך רשום ומאומת, שלחנו לך קישור לאיפוס הסיסמה. לא הגיע? בדקי בספאם." / "עוד לא אימתת את המייל? צרי קשר." ("צרי קשר" links to the business WhatsApp, `getWhatsappHref`); a wrap only between sentences or at the long sentence's comma |
| Forgot, rate limit | 4th request for one email, or 6th from one IP, within 15 min | `TOO_MANY_ATTEMPTS` | — |
| Reset link | `/reset-password?token_hash=…`, new password twice, "שמירת הסיסמה" | shape checked first (no token used); `verifyOtp(type 'recovery')`; account still eligible; `updateUserById` password; sign out other sessions (another device stops within at most 1 h, its JWT's expiry; user decision 2026-11-12); `/me` | used/expired → `LINK_INVALID` with link "לבקשת קישור חדש" to `/forgot-password`; no longer eligible → sign out + `LINK_INVALID`; failure after verify → sign out + `SERVER_ERROR` |
| Second click on the same reset link | token already used | `LINK_INVALID` | — |
| Auth asked directly (`/recover`, `/otp`, any type) | publishable key, any address | hook sends only `recovery` to a verified, eligible address; everything else dropped silently | — |
| Old verification link after an email change | token's `email_hash` ≠ current | `LINK_INVALID`, no record | — |

</frozen-after-approval>

## Code Map

- `lib/server/privileged/join.ts` -- `runJoin` (L344), `submitJoin` (L334), `submitJoinFill` (L489); `createUser … email_confirm: true` L230-235 stays.
- `app/(auth)/join/[token]/actions.ts`, `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/join/actions.ts` -- callers where the verification email is queued after success.
- `lib/server/privileged/account.ts:30` `changeEmail` (begin → `updateUserById` → finish) and `app/admin/(shell)/customers/[id]/actions.ts:90`.
- `lib/server/privileged/rate-limit.ts` -- `hitRateLimit(bucket,{ip,id})`, `rateLimitCode`, `clientIp`. SQL `rate_limit_hit` + table CHECK allow only `login|token` (`20261013203359_account_admin_and_rate_limit.sql:78,84`).
- `private.email_hash` (same file L49); guard trigger L623/662 (unchanged).
- `admin_get_customer` (latest `20261109224655_special_brunch_interest.sql:364`), `admin_anonymize_customer` (latest `20261020200750_remove_personal_details.sql`).
- `app/(auth)/reset/[token]/*` + `lib/server/privileged/reset.ts` -- Tal's manual reset (2.8). It stays as the backup; reuse its password form pieces and the min-length rule.
- `app/(auth)/login/login-screen.tsx` (`area` prop) and `login-form.tsx:72-79` -- the `<details>` "שכחתי סיסמה" help.
- `app/me/home.tsx:50` (banner at top of list), `app/me/profile/page.tsx:65` + `details-section.tsx:213-224` (email row), `app/admin/(shell)/customers/[id]/account-section.tsx` (email row).
- `components/shared/inline-notice.tsx`, `components/shared/online-button.tsx`.
- `next.config.mjs:95,111-116` -- no-store / no-referrer / no request logging for token routes.
- `eslint.config.mjs:96-102` `PRIVILEGED_ALLOWED`.
- `scripts/prod-auth-guard-check.mjs`, `scripts/prod-check.mjs:194-201` (expects `mailer_autoconfirm === true`; unchanged), `scripts/prod-env.mjs`, `scripts/dev-guard.mjs`.
- `supabase/config.toml` (`[auth.email]`, `[auth.rate_limit] email_sent`).
- `supabase/tests/grants.test.ts` (`EXPECTED_GRANTS`), `account-admin.test.ts`, `join.test.ts`, `rate-limit.test.ts`, `remove-personal-details.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_email_verification.sql` -- `private.email_verifications(user_id uuid pk references auth.users on delete cascade, email_hash text not null, verified_at timestamptz not null)` with no grants. `private.email_verified(uuid)` helper. RPCs: `set_email_verified(p_user_id)` (service_role, hashes the current auth email, upsert); `get_email_reset_eligibility(p_email)` (service_role → `{ user_id, eligible }`; eligible only for an activated, non-anonymized customer or an admin, with a matching record); `get_my_email_verified()` (authenticated); `begin_my_email_change` / `finish_my_email_change` (authenticated, mirroring the live `admin_begin_email_change` / `admin_finish_email_change` for `current_customer_id()`, with idempotency and audit). Add the `email` bucket to the `rate_limit_hit` limits and the table CHECK (drop/add constraint). `admin_get_customer` adds `email_verified`. `admin_anonymize_customer` deletes the row. -- Has `drop`, so the user runs it in the SQL Editor (dev now, prod after merge) and the main session records it in `schema_migrations`.
- [ ] `lib/supabase/database.types.ts` -- regenerate; `get_advisors` clean (only approved WARNs).
- [ ] `lib/server/privileged/email-auth.ts` -- stateless sender (`sendVerificationEmail`, `sendResetEmail`), eligibility, `markVerified`.
- [ ] Join and email-change actions -- queue `sendVerificationEmail` in `after()`.
- [ ] `app/(auth)/forgot-password/{page,form,actions}.tsx` -- new screen.
- [ ] `app/(auth)/verify-email/*`, `app/(auth)/reset-password/*` -- token-hash pages and actions. Add both paths to `next.config.mjs` headers/logging and `PRIVILEGED_ALLOWED` only if a page needs it.
- [ ] `app/(auth)/login/login-form.tsx` -- both areas (customer and `/admin/login`, decision 3): replace the help `<details>` with a link "שכחתי סיסמה" to `/forgot-password`. After a reset or a verification, an admin lands on `/admin`, a customer on `/me` (by `get_my_session_role`).
- [ ] `app/me/home.tsx` (+ action), admin home, `app/me/profile/details-section.tsx`, `account-section.tsx` -- banner + resend, verified/unverified label ("המייל אומת" / "המייל עוד לא אומת").
- [ ] `app/me/profile/*` + `lib/server/privileged/account.ts` (`changeOwnEmail`, sharing the admin pipeline) -- self email change inside the details' edit form, phone read only with the WhatsApp note (frontend-design skill first).
- [ ] `lib/copy/*`, `lib/errors.ts` (`LINK_INVALID`, `WRONG_PASSWORD`, `EMAILS_DONT_MATCH`), `lib/copy/audit-actions.ts` (self email change) -- copy from the matrix.
- [ ] `_bmad-output/specs/spec-brunch-at-tal/.memlog.md`, `security-and-rpc-rules.md`, `completion-plan-2026-10-10.md` -- record the self email change decision (2026-11-11).
- [ ] `supabase/templates/verify-email.html`, `reset-password.html` + `config.toml` template paths -- Hebrew RTL, inline styles from DESIGN.md tokens, button + plain link, "בתוקף שעה, פועל פעם אחת, אם לא ביקשת אפשר להתעלם". Subjects: "אימות כתובת המייל", "קישור לאיפוס סיסמה". Unit test: each template has `dir="rtl"`, `{{ .SiteURL }}`, `{{ .TokenHash }}`, the right page path, no "טל", no invisible chars.
- [ ] `scripts/prod-auth-guard-check.mjs` + `scripts/dev-auth-guard-check.mjs` (shared runner) -- throwaway address on a domain that has MX (default `send.morethanfood.co.il`, override `--domain`); no email is sent (created confirmed, Confirm email off).
- [ ] Tests -- `supabase/tests/email-verification.test.ts` (record/hash/un-verify on change, eligibility matrix, grants, anonymize deletes); update `grants.test.ts`, `rate-limit.test.ts`; unit tests for the forgot action (same result for all cases, limit first) and both link actions (shape before `verifyOtp`).
- [ ] `README.md` -- new section "מייל (Resend)": Resend account, domain `morethanfood.co.il` (region eu-west-1), sender `noreply@morethanfood.co.il` / "בראנץ׳ אצל טל", LiveDNS records, DKIM lowercase check, API key per project, Supabase SMTP fields, templates, OTP expiry 3600, email rate limit, Site URL / Redirect URLs. Update the Auth checklist and runbook step 5.
- [ ] `deferred-work.md` -- close the 2.8/6.1 guard item after both runs; add to the id 10 item: email links follow Site URL; switching it moves them to the domain.
- [ ] Main session -- dev SQL Editor run + `schema_migrations`, guard check in dev and prod (`--apply` with OK), `tickets.py pull` then mark id 11 done in the PR.

**Round 2 (after review, 2026-11-11):**
- [ ] `supabase/migrations/<ts>_email_hook_and_own_token.sql` (follow-up; the first file is already applied in dev) -- (1) `private.email_verification_tokens(token_hash pk, user_id → auth.users on delete cascade, email_hash, expires_at, used_at, created_at)`, RLS on, no grants. (2) `private.send_email(p_to text, p_subject text, p_html text)`: `net.http_post` to `https://api.resend.com/emails`, Bearer key from `vault.decrypted_secrets` name `resend_api_key`, from `בראנץ׳ אצל טל <noreply@morethanfood.co.il>`; no key → no request, warning only; returns the pg_net request id. (3) `private.email_html(kind, link)` with the Hebrew RTL copy of today's two templates (verification and reset; same text, inline styles). (4) `request_email_verification(p_user_id uuid, p_site_url text)` service_role: no-op `{sent:false}` if already verified; else void that user's unused tokens, issue 32 random bytes (base64url, like `private.issue_token`), store sha256 + the current `email_hash` + 1 h expiry, send `<p_site_url>/verify-email?token=<raw>`. The raw token goes only into the email. (5) `consume_email_verification(p_token text)` service_role: one transaction, `for update`; unknown/used/expired or `email_hash` ≠ current → `LINK_INVALID`; else mark used, upsert the record, return `{is_admin}`. Replaces `set_email_verified` (drop it). (6) `public.send_email_hook(event jsonb)` Postgres Send Email Hook: definer, `search_path = ''`; type `recovery` and the user eligible (same rule as `get_email_reset_eligibility`) → send `<email_data.site_url>/reset-password?token_hash=<email_data.token_hash>`; any other type or not eligible → send nothing; always return `'{}'::jsonb`. Grant execute only to `supabase_auth_admin` (revoke from public, anon, authenticated, service_role). (7) `begin_my_email_change` / `finish_my_email_change`: drop and recreate as service_role with `p_user_id` (server passes it after the password check); begin also refuses `ACCOUNT_CHANGE_BLOCKED` when another email change is pending with a different hash. Has `drop`: the user runs it in the SQL Editor.
- [ ] `lib/server/privileged/email-auth.ts` and callers -- verification send = `request_email_verification(userId, siteUrl())` (`lib/site-url.ts`); join, Tal's fill, Tal's change, self change and resend call it in `after()` (resend awaits it). Remove `signInWithOtp` and `markVerified`'s `verifyOtp`; `/verify-email` takes `?token=` and calls `consume_email_verification`. Reset: `completeRecovery` signs out `global` on its client right after the password update; max 72 before `verifyOtp`; `same_password` = success; other Auth 4xx on update → `LINK_INVALID` copy that leads to a new link. One shared token-shape constant.
- [ ] Review patches -- self change reads the current email from `auth.getUser()`; rate-limit ids `resend:<uid>` and `change:<uid>`; resend returns ok without sending when already verified; `/verify-email` `LINK_INVALID` shows a link to login; the profile email row shows the resend notice when unverified.
- [ ] `scripts/prod-check.mjs` (and its dev counterpart if any) -- the `invoke_push_worker` check reads only `net._http_response` rows of requests to the push worker URL (or otherwise ignores Resend calls), so emails neither fake a ✗ nor hide one. Add a read-only line: Vault has `resend_api_key` (name only, never the value) and the hook function exists.
- [ ] Tests -- `grants.test.ts` (`EXPECTED_GRANTS`: new RPCs, hook to `supabase_auth_admin`, dropped `set_email_verified`, re-granted begin/finish); DB tests for token issue/consume (expiry, single use, mismatch after change, already verified no-op, previous token voided), the hook matrix (recovery eligible/not, every other type dropped, no Resend call when no key: assert on `net.http_request_queue`), begin/finish as service_role incl. the failure branches (`taken`, `CONCURRENT_CHANGE`, resume, inactive, foreign pending); unit tests for `changeOwnEmailAction`, `checkPassword`, the labels and the banner; template copy test now reads the migration.
- [ ] `supabase/templates/*.html`, `config.toml` template entries -- no longer used: remove the `config.toml` entries; list the two HTML files for deletion by the main session.
- [ ] `README.md` -- "מייל (Resend)": Vault `resend_api_key` per project (SQL Editor, never printed), enable the hook (Authentication → Hooks → Send Email → Postgres → `public.send_email_hook`), dashboard SMTP left off / its old keys deleted in Resend, no dashboard templates. Checklist and runbook step 5 updated.
- [ ] `deferred-work.md` -- three entries: notice to the old address on a self change; Tal's pending manual reset link survives a self reset; send failures / Resend quota invisible (6.8).

**Acceptance Criteria:**
- Given an unverified email, when anything renders it (customer profile, admin card), then it is never labelled verified.
- Given both projects configured, when a verification or reset email is sent, then it arrives in the user's real Gmail inbox (not spam), in Hebrew RTL, from the agreed sender.
- Given the guard check with a real-MX address, when run in dev and prod, then self email change is refused by the trigger (✓, not "לא הוכח").

## Design Notes

- `/verify-email` needs no login and never touches the browser's current session: `verifyOtp` runs on a stateless client (no cookies), and `set_email_verified` gets the user id `verifyOtp` returned, never the session user. If another account is logged in, it stays logged in and is not verified. `/reset-password` does sign in the user whose link it is (she just chose a password).
- One normalization everywhere: `private.email_hash` (`lower(btrim(...))`) in `set_email_verified`, eligibility and the verified check. The DB test asserts that "  Foo@X.com " and "foo@x.com" match.
- Why a private table and not a `profiles` column: admins have no customer profile, `profiles` is browser-readable, and a hash binding makes "email changed" un-verify with no hook in every change path.
- The Magic Link and recovery tokens share one slot per user in Auth, so a newer email voids an older link. After Tal changes an address, the new verification email voids any link sent to the old one.
- Confirm email stays off: our accounts are created confirmed anyway, and turning it on only adds Auth double-confirm flows we never use. `prod-check` keeps checking it.
- LiveDNS may lowercase TXT values (reported by Google Workspace), which breaks DKIM. After adding records, Resend "Verify" plus `nslookup -type=TXT resend._domainkey.morethanfood.co.il` shows it. If it breaks, the fallback is to move the domain's nameservers to Cloudflare's free DNS (the site is not on the domain yet, so nothing else moves) and add the records there. The user decides at that point.
- Resend free: 100 emails/day, 3,000/month, shared by both projects; no overage, sending just stops. Supabase custom SMTP: 30 emails/hour default; 60 s per user between links; OTP expiry 1 h; links single-use.
- Phone check runs on the dev project (LAN dev server from the worktree). For that check the dev Site URL is set to the LAN address, so links open on the phone; afterwards it goes back. The test account uses the user's own Gmail with a `+` tag.

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` -- pass.
- `npm run test:db` (not during the phone check) -- pass, including `grants.test.ts`, `join.test.ts`, `account-admin.test.ts`.

**Manual checks:**
- Phone: every matrix row, including a verification link opened on another device and a reset link after the email changed; self email change works and sends a verification email; verification and reset emails reach the inbox; the reset link works once, the second click shows `LINK_INVALID`; an unverified address gets no email; the 4th forgot request is blocked.
- After merge: `prod-migrate` (SQL Editor because of `drop`), Security Advisor, `prod-check`, `prod:grants`, prod guard check; browser check per AGENTS.md.

## Implementation Notes

- Round 1 built everything on the first approach (migration `20261111191636_email_verification.sql`, applied in dev by the user in the SQL Editor 2026-11-11, recorded in `schema_migrations`). Round 2 changes are in a follow-up migration, not by editing the applied file.
- Phone check 2026-11-12: the forgot answer was reworded twice by the user (now three unbreakable units plus a WhatsApp-linked line 2, measured at 360px: 159/180/129/195px of 280px). The profile's email change moved into the details form: `updateDetailsWithEmailAction` (replaces `changeOwnEmailAction`) passes the details' write to `changeOwnEmail` as `afterPasswordCheck`, so the password is always checked before anything is saved; `EmailRow` is display only. Step 7 finding: the other browser stayed signed in after the reset though `auth.sessions` / `refresh_tokens` held no row for the user: the JWT lives until expiry (decision above). Step 14: `/otp` and `/recover` straight to dev Auth: unverified `+611d` → no send recorded; verified → exactly one hook send (recovery), `/otp` dropped. Auth's own per-user 60 s limit applies between the two calls.

## Spec Change Log

- 2026-11-11, review round 1 (security S1/S2, blind B1, edge E4). **Trigger:** `begin_my_email_change` granted to `authenticated` lets a held session skip the password (begin via REST, then `auth.updateUser`, which the trigger accepts); Auth's public `/recover` and `/otp` email any account, and a Magic Link is a login credential, so a mistyped address could log in; an old verification link could verify a new address. **Amended (user decision through the work manager):** Intent approach, Decisions, Always, matrix (verify row, two new rows): Send Email Hook + own verification token + DB send function. **Known-bad state avoided:** any reachable email path that gives a stranger a login or a reset to an unverified address. **KEEP:** the pages, forms, copy, banner, profile/admin labels, forgot action (limit first, uniform answer, `after()`), reset action order (limit, shape, `verifyOtp` recovery, eligibility again, Admin password, sign-in, sign out others, role redirect), `private.email_verifications` + `private.email_verified`, eligibility RPC, `email` bucket, `admin_get_customer` / `admin_anonymize_customer` changes, `changeOwnEmail` shared pipeline, guard runner, README structure, docs records. Code was kept and amended, not reverted (most of it is unaffected; the user approved continuing).

## Review Triage Log

Round 1 (6 lenses: blind, edge, verification-gap, intent, spec-compliance, security). high 3, medium 6, low 6, false 0, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| S1 | Self email change: password skippable (begin RPC to `authenticated` + `auth.updateUser`) | high | bad_spec → patch | Real: trigger checks only pending + hash. Begin/finish become service_role with `p_user_id` from the server after the password check; begin refuses when another pending change exists. |
| S2 | Auth `/recover` and `/otp` email any account; Magic Link logs in | high | intent_gap → resolved | User decision: hook + own token (Decisions). |
| B1/E4/S3 | Old verification link verifies a new address | high | intent_gap → resolved | Own token carries the sent-to `email_hash`. |
| S4/C2 | Reset: other sessions survive when the browser sign-in fails | medium | patch | `signOut({ scope: 'global' })` on the recovery client right after the password update. |
| B3/E6/V-other | Self change checks the password against stale JWT email | medium | patch | Read the email from `auth.getUser()`. |
| B2/E1/E2 | Reset link burned when Auth rejects the password | medium | patch | Max 72 checked before `verifyOtp`; `same_password` = success; other 4xx → message leading to a new link. |
| E3 | Verify: link consumed but record write failed, "try again" leads to `LINK_INVALID` | low | patch | Own token: consume and record in one transaction. |
| B4/E8 | One `email` id shared by resend and self change; form errors burn attempts | medium | patch | Ids `resend:<uid>` / `change:<uid>`. |
| E10 | Resend callable when already verified | low | patch | Return ok without sending. |
| B6 | Verify page dead end on `LINK_INVALID` | low | patch | Link to login. |
| B7 | Profile shows "not verified" without an action | low | patch | Resend notice in the email row. |
| B9 | `TOKEN_HASH` duplicated, comment says hex | low | patch | One shared constant, correct comment. |
| V1-V4 | Missing tests: `changeOwnEmailAction`, `checkPassword`, self-change failure branches, labels/banner | medium | patch | Add them. |
| B5 | No notice to the old address on self change | medium | defer | deferred-work. |
| B10 | Tal's pending manual reset link survives a self reset | medium | defer | deferred-work. |
| B11 | Send failures / Resend quota invisible | medium | defer | deferred-work (6.8). |

Rejected: E7 (attacker can rate-limit a victim's forgot form: by design, keeps the inbox from flooding), E9 (extra email on a join replay: harmless, Auth/send dedupe), E11 (displayed email from claims: low, refreshed on next token), E12 / C3 (guard default domain: spec Code Map updated, MX checked before runs), C1 (verify page without redirect: approved by the user), S5 (link type cross-use: moot, verification no longer uses Auth tokens), B8 (part of V1-V4).

Round 2 (review of the hook + own-token build, 2026-11-11; routes approved by the user through the work manager). Recorded in summary, as reported then:

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| F1 | The hook's `email_data.site_url` is Auth's API URL, not the Site URL: the reset link pointed at the wrong host | high | patch | Reset link built from Vault `site_url` (migration `20261111202945_email_hook_fixes.sql`); test asserts it never reads `->> 'site_url'`, `redirect_to` or `token`. |
| F3 | Direct `/recover` calls could flood an inbox (Auth's email limit does not apply with Confirm email off) | medium | patch | Hook throttle: 3 per user and 20 per project per hour (`private.email_hook_sends`). |
| F4 | A stranger who receives a verification email for a mistyped address could verify it, then reset | high | intent_gap → resolved | User decision: verifying needs the account's own login; session user = token user; foreign session → `LINK_INVALID`, token kept (Decisions). |
| — | The 20-per-project hook cap can starve real resets under abuse | low | defer | deferred-work (project cap entry). |

Round 2 also applied the smaller patches reported with it (`send_email` security invoker; request takes an advisory lock and deletes older tokens; consume refuses anonymized profiles; anonymize deletes tokens; `/login` and `/admin/login` always no-store / no-referrer and out of request logs). Round 3 was the build of these patches plus the phone check; its changes are under Decisions (2026-11-12) and Implementation Notes.
