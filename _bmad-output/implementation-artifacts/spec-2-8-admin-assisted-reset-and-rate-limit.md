---
title: 'Story 2.8 — Admin-assisted reset, email and phone change, rate limit'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'bd377881a5e6c8a3d4ccd46c13f1582f2f8698c1'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production is open (no site lock since 2026-10-10) and login has no app-level attempt limit; Tal can only reset a password with the dev script, and nobody can change a customer's email or phone. Worse, a signed-in customer can change her own Auth email today with `auth.updateUser` and the public key (Confirm email is off, so it applies at once).

**Approach:** One DB rate limiter called from every login and token action; an "חשבון" section on the admin customer card for a reset link, email change (two-step, AD-21) and phone change, all through `find_identity` and the audit log; a trigger on `auth.users` that refuses any email/phone change that Tal did not start; a stuck-email-change item in "לטיפול".

**Decisions (user, 2026-10-13):**
- Rate limiter: table + RPC in our Supabase (`private.rate_limits`, `rate_limit_hit`), 0 ₪; not Vercel WAF, not Upstash.
- Self email change: blocked by a `before update` trigger on `auth.users` in the migration; no dashboard change. An admin's own email also changes only through this flow or the SQL Editor.
- Thresholds, fixed 15-minute window, blocked until it ends: login 20 per IP and 8 per account (normalized email); token actions 20 per IP and 10 per token. Message `TOO_MANY_ATTEMPTS`: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות". Accepted risk: someone who knows an email can block that account for 15 minutes.
- Build order: phase 1 — migration (limiter, `account_op_*`, trigger, all RPCs, attention item), `rate-limit.ts`, `account.ts`, login and token actions, errors/copy, `home-items.ts`, tests. Phase 2 — the "חשבון" section in `app/admin/(shell)/customers/[id]/` only after 4.3 is merged and origin/main is merged into the branch again.

## Boundaries & Constraints

**Always:**
- Source §10 wins: manual reset through Tal; phone match alone never proves ownership; a clash between accounts is blocked and logged, never merged.
- Email lives only in `auth.users` (AD-3). The pending target is stored only as `account_op_target_hash = sha256(lower(btrim(email)))`, never the address. `private.audit_diff` masks it as `"<changed>"`.
- Every new RPC follows AD-5 (definer, `search_path = ''`, auth check first, revoke all + one grant, idempotency key on writes). Reads exempt.
- A blocked change (email or phone of another account, or `find_identity` conflict) **commits** an audit row: the RPC returns `{ result: 'taken' }` instead of raising, so the row is not rolled back. The action maps it to `EMAIL_TAKEN` / `PHONE_TAKEN`.
- Rate limit answers one code, `TOO_MANY_ATTEMPTS`, for the IP key and the account key alike, counted whether the account exists or not. Supabase's own 429 maps to the same code.
- Logs carry no email, phone, IP, token or password (AD-22).
- Screens start with the `frontend-design` skill, inside DESIGN.md and EXPERIENCE.md. Customer-facing copy never says "טל".
- Every redefined function starts from `pg_get_functiondef` of the live DB. `admin_get_attention_items` keeps every item and field it has after 3.8.

**Never:**
- No paid resource; no new external service; no `.env*` or Vercel writes by an agent.
- No anonymization (4.6), no "participated before" fix, no self profile edit changes, no lock/noindex work (5.15).
- No change to `admin_get_customer` (3.9 territory); account data comes from a new read RPC.
- No email/phone change for an admin or an anonymized profile; no email change for a not-activated profile (import, E6).
- `scripts/dev-reset-link.mjs` and `issue_reset_token` stay as they are (dev only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reset link | Tal, activated customer | `admin_issue_link('reset', id)` revokes her pending reset links, returns raw token once; card shows LinkShare + status "ממתין" | admin / not activated / anonymized → `RESET_TARGET_INVALID` |
| Email change OK | new email, no match | begin → pending + hash; `updateUserById(email, email_confirm)`; finish clears state; "המייל עודכן. מעכשיו נכנסים איתו" | Auth `email_exists` → finish(false) clears state, `EMAIL_TAKEN` |
| Email taken | email of another account / pending import | nothing changes, audit row `result = taken` | `EMAIL_TAKEN` "המייל הזה כבר שייך לחשבון אחר" |
| Same email | her own email | nothing changes | `EMAIL_UNCHANGED` |
| Stuck | pending > 15 min (crash between steps) | item `email_change_stuck` → card; saving the same email again resumes | — |
| Phone change | new number | `phone_e164` updated, audited as `"<changed>"` | other account → `PHONE_TAKEN` "המספר הזה כבר שייך לחשבון אחר"; invalid → `INVALID_PHONE` |
| Self change | customer: `auth.updateUser({ email })` or `profiles.update({ phone_e164 })` | refused; email and phone unchanged | trigger raises `ACCOUNT_CHANGE_BLOCKED`; column grant → permission denied |
| Login flood | > IP or account limit in the window | no call to Supabase | `TOO_MANY_ATTEMPTS` |
| Token flood | join submit / claim / reset submit over the limit | no RPC call | `TOO_MANY_ATTEMPTS` |

</frozen-after-approval>

## Code Map

- `app/(auth)/login/actions.ts` -- `loginAction`, shared by `/login` and `/admin/login`. Add the limiter before `signInWithPassword`; map Supabase `over_request_rate_limit`/429 to `TOO_MANY_ATTEMPTS`.
- `app/(auth)/join/[token]/actions.ts` -- `submitJoinAction`, `claimJoinAction`; `app/(auth)/reset/[token]/actions.ts` -- `completeResetAction`. Limiter first.
- `lib/server/privileged/reset.ts` -- reset flow (reset_begin → updateUserById → reset_complete); reuse as is.
- `lib/server/privileged/join.ts` -- pattern for an Auth Admin step between two RPCs; logs ids/codes only.
- `lib/server/join-link.ts` -- `joinLinkFor`/`requestOrigin`; add `resetLinkFor` (`/reset/<token>`).
- `components/admin/link-share.tsx` -- `LinkShare` (WhatsApp + copy) for the issued link; reuse.
- `components/admin/value-change-row.tsx` -- old ← new + save, one idempotency key per change; use for email and phone.
- `app/admin/(shell)/customers/[id]/page.tsx`, `actions.ts`, `card-items.ts`, `load-card.ts` -- the card (4.2); add the "חשבון" section after "פרטים". 3.9 adds its own section here.
- `app/admin/(shell)/home-items.ts` -- maps attention kinds; unknown kinds are filtered. Add `email_change_stuck` → `customerHref`.
- `lib/copy/admin.ts` (`customers.card`, `home.items`), `lib/errors.ts`, `lib/rpc.ts`, `lib/supabase/database.types.ts`.
- Live DB: `admin_issue_link` (join only, comment "reset and claim arrive with 2.8"), `private.issue_token`, `private.reset_target_valid` (true for admins too), `private.find_identity`, `private.audit_diff`, `admin_get_attention_items` (3.8 version). `profiles` has no `account_op_*` columns yet; customer `update` grant is only `(full_name, dietary_notes)`.
- `supabase/tests/support/db.ts` -- `inRollback`, `asAuthenticated`, `testName`, `onCleanup`. Existing: `reset.test.ts`, `link-lifecycle.test.ts`, `admin-home.test.ts`, `grants.test.ts`, `profile.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_account_admin_and_rate_limit.sql` (via `npx supabase migration new`) -- `profiles.account_op_state` (check `email_change_pending | anonymization_pending`), `account_op_started_at`, `account_op_target_hash`; `private.rate_limits(bucket, key_hash, window_start, hits)` PK on the three, no grants to anon/authenticated; `public.rate_limit_hit(p_bucket, p_keys text[])` service_role only: hashes keys in SQL, fixed window, increments all, returns `{ allowed }`, deletes up to 100 rows older than 1 day; `admin_issue_link` adds `reset` (customer only, advisory lock as `issue_reset_token`, revoke pending, `issue_token('reset', id)`, audit like join); `admin_begin_email_change`, `admin_finish_email_change(p_customer_id, p_succeeded, key)`, `admin_change_phone`, `admin_get_customer_account(p_customer_id)` (op state, stuck flag, latest reset link status/expiry/consumed_at); `private.guard_auth_user_change()` + `before update on auth.users` trigger: email or `email_change` change allowed only when the profile is `email_change_pending` and the hash matches; any `phone`/`phone_change` change refused; `audit_diff` masks the hash; `admin_get_attention_items` + `email_change_stuck`. **Session main:** user runs it in SQL Editor; register in `schema_migrations`; `get_advisors`; regenerate types.
- [ ] `lib/server/privileged/rate-limit.ts` -- `hitRateLimit(bucket, keys)`; client IP from `x-real-ip`, else first `x-forwarded-for`, else `unknown`. The only caller of `rate_limit_hit`.
- [ ] `lib/server/privileged/account.ts` -- `changeEmail(customerId, email, key)`: begin → Auth → finish; retry resumes.
- [ ] login, join, claim and reset actions -- call the limiter first.
- [ ] `app/admin/(shell)/customers/[id]/` -- **phase 2: only after 4.3 is merged and origin/main is merged in.** Run `frontend-design`; "חשבון" section: email + phone rows (ValueChangeRow), reset link (button, LinkShare, status line), stuck notice; actions in `actions.ts`.
- [ ] `lib/errors.ts`, `lib/copy/admin.ts`, `app/admin/(shell)/home-items.ts` -- codes and copy below; the new kind.
- [ ] Tests -- `supabase/tests/account-admin.test.ts`, `rate-limit.test.ts`, update `grants.test.ts`, `admin-home.test.ts`; unit tests for the limiter wrapper, IP parsing, login/token actions, card items and home item.
- [ ] Docs -- spine Deferred bullet points to this story's decision; AGENTS.md one line on the limiter; completion plan; `tickets.toml` done (in the PR); `scripts/dev-reset-link.mjs` header comment.

**Acceptance Criteria:**
- Given a customer's session and the publishable key, when she calls `auth.updateUser({ email })`, then Auth fails and `auth.users.email` is unchanged.
- Given Tal changed an email, when the customer logs in with the new email, then she reaches `/me`; the old email fails with `INVALID_CREDENTIALS`.
- Given the reset link Tal issued, when the customer saves a new password, then the card shows the link as used and the previous pending reset link is revoked.
- Given any blocked change, when the audit log is read, then a row exists with `customer_id`, no email or phone value.

## Review Triage Log

### Pass 1 (2026-10-14)

Counts: high 0, medium 4, low 10, false 4, maybe-false 0 (plus 5 pre-verified gaps).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind, edge | Stuck change after Auth took the address: saved = edited, Save never shows | medium | patch | `emailChange` returns null on equal values; allow when `view.stuck` |
| 2 | edge | Key renewed only on ok; a stored `taken`/`pending` answer makes the next different value hit IDEMPOTENCY_KEY_REUSED | medium | patch | `value-change-row.tsx` save(); renew after every answer |
| 3 | edge | Auth 4xx other than `email_exists` leaves the state pending forever | medium | patch | `account.ts` maps only `email_exists`; finish(false) + INVALID_INPUT |
| 4 | gap | No unit case for finish failing after Auth | medium | patch | add to `account.test.ts` |
| 5 | gap | `resetLinkFor` never run by a test | medium | patch | add `lib/server/join-link.test.ts` |
| 6 | gap | Claim rate-limit test does not check bucket/keys | low | patch | one `toHaveBeenCalledWith` |
| 7 | gap, blind | No component test for the account section (key rotation, link once, `savedText`) | low | patch | add `account-section.test.tsx` |
| 8 | gap, intent | Trigger never tested against real GoTrue | low | defer | Checked by hand on dev 2026-10-14 (throwaway user): Tal's matching change passes, unmatched admin change and self change refused, sign-in/password/metadata pass. Self change also stops earlier today: secure email change needs a mail provider ("Error sending email change email") |
| 9 | edge | `admin_issue_link('reset')` does not refuse `anonymization_pending` | low | defer | state unreachable until 4.6; 4.6 must add the check |
| 10 | blind | AGENTS.md line: phone in auth.users is always refused; the SQL Editor switch is not documented | low | defer | agent-context file |
| 11 | blind | Completion plan still shows phase 2 as not built | low | patch | row updated in the main session |

Rejected: false: trigger blocks 4.6 (4.6 deletes the Auth user, claim inserts; trigger is update-only); 404 for anonymized (admin_get_customer already NOT_FOUND); XFF spoofing (Vercel overwrites x-forwarded-for, x-real-ip always set); Promise.all (loadAccount relies on loadCard's id check). low: self-change leaves no audit row (fix edits the spec AC); unpeppered hashes (private, 1-day rows, migration already applied); `link: null` same message for a missing Origin; phone format compare; action shape-check consistency; copy repetition, date formats, 15-minute constant twice; pending A then B overwrite; window may end before 15 minutes.

## Design Notes

Copy (micro-copy, new): section "חשבון"; "שינוי מייל", "שינוי מספר טלפון", "הפקת קישור איפוס" / "הפקת קישור חלופי"; status "קישור איפוס ממתין עד {date}" / "קישור האיפוס מומש {date}" / "קישור האיפוס פג"; "המספר עודכן"; stuck notice "שינוי המייל לא הושלם. כדי לסיים, שמרי שוב את המייל החדש"; attention `email_change_stuck`: title "שינוי המייל של {name} לא הושלם", chip "תקוע"; `EMAIL_UNCHANGED` "זה כבר המייל של החשבון"; `PHONE_UNCHANGED` "זה כבר המספר של החשבון"; `INVALID_PHONE` "מספר הטלפון לא תקין"; `TOO_MANY_ATTEMPTS` as in Decisions.

Direct calls to Supabase Auth (`/auth/v1/token` with the public key) skip our limiter; they stay under Supabase's own per-IP limit (by the caller's real IP). Our limiter covers our forms and adds the per-account key. Since our login runs on Vercel, Supabase counts its own limit by Vercel's IP.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- pass.
- `npm run test:db` (new files, join, existing-account, link-lifecycle, admin-home, grants, reset, profile) -- pass; then `npm run demo:seed`.
- `npm run build` -- pass.

**Manual checks:** phone check as listed in the story prompt (reset from the card, email/phone change and block, no self change, login flood message).
