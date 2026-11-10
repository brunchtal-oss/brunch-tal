---
title: 'Admin-assisted join form (2.15)'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '7da840e75f1d133ffc1dfc47adeb3047bc5bf918'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A customer who paid but struggles with the join link has no way in: only she can fill the form. User decision 2026-11-09 (SPEC `.memlog.md`, overrides source lines 109 and 351): Tal fills the full join form for her, as technical help.

**Approach:** On an unbound purchase's admin page, "מילוי טופס ההצטרפות" opens the same join form. On submit, a new admin RPC replaces the purchase's live link with a fresh internal one, and the existing join core (`join_begin` → Auth → `join_complete`) runs with it, exactly as for the customer, minus the sign-in. Tal stays signed in and gets a done screen.

**User decisions (2026-11-09):** payment stays required; full form incl. password Tal chooses; Tal reads the photo questions and privacy policy word for word; no record anywhere that Tal filled it (profile and consents are the customer's; audit as today's join); works while unbound, also after the 48h link expired; an unredeemed link is revoked; first to finish wins, the other gets a clear message; a voided purchase blocks.

**Spec gate (work manager and user, 2026-11-09):** internal link of 1 hour; the password shown on the done screen with a copy button; not a sensitive action (no confirm dialog): the two-step form is already the deliberate step and nothing money-related changes beyond the usual join.

## Boundaries & Constraints

**Always:**
- **RPC** `public.admin_begin_join_fill(p_payment_id uuid, p_email text, p_phone text, p_idempotency_key uuid) returns jsonb`, definer, `search_path = ''`, `private.is_admin()` first line, revoke all, grant `authenticated` only. Order: admin check → key null → `INVALID_INPUT` → `private.join_identity(p_email, p_phone)` → `private.idempotent_begin(auth.uid()::text, 'admin_begin_join_fill', key, {payment_id, input_hash})` → `private.lock_join_payment(p_payment_id)` (raises `LINK_USED` when bound/consumed, `PURCHASE_VOIDED`, `LINK_IN_PROGRESS` for a non-stuck `claiming` link) → `private.find_identity` ≠ `none` → finish `{outcome: 'details_taken'}`, nothing changed → live link (any state, also expired or conflict) set `revoked`, `revoked_at = now()` **with no audit row**; its `pending_user_id` returned as `revoked_pending_user_id` when it was `claiming` without a profile (as `revoke_join_token`) → `private.issue_token('join', null, p_payment_id)`, then that row's `expires_at = now() + interval '1 hour'` (an abandoned fill shows in "לטיפול" within the hour, not after 48h) → `idempotent_finish` stores `{outcome: 'ready', token_id, revoked_pending_user_id, reissue_required: true}`; the live call returns it `|| {token, reissue_required: false}` (raw token once, AD-10). No audit row in this RPC.
- **`token_view`** (from live `pg_get_functiondef`, nothing removed): a `revoked` join token whose payment has `customer_id` → `state_public = 'used'` (after the existing `voided` case).
- **Server** `lib/server/privileged/join.ts`: extract the body of `submitJoin` after its arguments into one shared runner; `submitJoin` keeps its behavior; new `submitJoinFill(session, paymentId, input, pageKey, token | null)`: no token → `admin_begin_join_fill` via the admin's session client, key `joinStepKey(pageKey, email, phone, "fill")`; `reissue_required` → `CONCURRENT_CHANGE`; `deleteOrphanUser` for `revoked_pending_user_id`; then the shared runner with that token (service client, same step keys). Returns the outcome plus the token for the next attempt. `joined` gains `customerId` (from `join_complete`'s stored result).
- **Action** `.../[entitlementId]/join/actions.ts`: `get_my_session_role` via the session client must be `admin` (else `NOT_AUTHORIZED`), then shape check (`validateJoin`, UUIDs), then `submitJoinFill`. No rate limit, **no sign-in**: the admin's session is never touched.
- **Shared form:** `JoinForm` gets `action`, extra hidden fields and an optional `outcome(state)` render that replaces the form or adds a notice. Fields, steps, `validateJoin`, photo questions, privacy line and `rpcFieldError` (moved out of the `"use server"` file) exist once; the admin page copies none. Story 2.16 adds a field in one place for both paths. The customer page passes `submitJoinAction` and no `outcome`: unchanged.
- **Purchase page** (`frontend-design` first, phone width): section `הצטרפות הלקוחה` when `customer_id` is null and `payment_status = 'approved'`: `אם קשה ללקוחה למלא את הטופס בקישור, אפשר למלא אותו כאן יחד איתה.` + link-button `מילוי טופס ההצטרפות` → `/admin/customers/unbound/entitlements/<id>/join` (navigation: no `OnlineButton`; the form's submit already is one).
- **Fill page** (`frontend-design` first): back link `חזרה לרכישה`; heading `מילוי טופס ההצטרפות`; `ממלאים את הטופס יחד עם הלקוחה. את שאלות הצילום ואת מדיניות הפרטיות מקריאים לה מילה במילה, ומסמנים לפי התשובות שלה.` and `בשליחה נוצר ללקוחה חשבון, והרכישה עוברת אליו. קישור ההצטרפות שנשלח אליה מתבטל.`; a bound or voided purchase opens the matching outcome screen, not the form.
- **Admin outcomes** (copy in `lib/copy/admin.ts`):
  - joined: `החשבון נוצר` / `הרכישה שויכה לחשבון של {fullName}.` / `עכשיו צריך לשלוח ללקוחה את המייל ואת הסיסמה שבחרת, כדי שתוכל להתחבר.` / `המייל להתחברות: {email}` (`bdi`, ltr) / `הסיסמה: {password}` (`bdi`, ltr) / button `העתקת פרטי הכניסה` (plain `Button`, not `OnlineButton`: changes no data) copying `פרטי הכניסה לאזור האישי:\nמייל: {email}\nסיסמה: {password}\nלהתחברות: {origin}/login`, then status `הפרטים הועתקו` (failure: `לא הצלחנו להעתיק. אפשר לסמן את הפרטים ולהעתיק אותם ידנית.`) / `אם היא תרצה סיסמה אחרת, אפשר לשלוח לה קישור איפוס מכרטיס הלקוחה.` / link `לכרטיס הלקוחה`.
- **Password on the done screen** (user decision 2026-11-09): taken from the form's own client state at submit; the server never returns it, and it is never written to the URL, `localStorage`/`sessionStorage`, a log line or the audit. It lives only in the done screen's memory until Tal leaves the page.
  - `details_taken`, `existing_account`, `identity_retry`, `email_exists`: error on the email field, form stays (new key where the customer path gives one): `המייל או הטלפון כבר רשומים בחשבון אחר. אם זו אותה לקוחה, היא צריכה להיכנס בקישור ההצטרפות שלה, להתחבר לחשבון הקיים ולאשר את הרכישה. אם הקישור שלה פג או בוטל, אפשר להפיק לה קישור חלופי במסך קישורי הצטרפות.` ("קישורי הצטרפות" links to `/admin/links`; the customer path there is 2.3's `awaiting_login` → login → `claim_join`.)
  - `LINK_IN_PROGRESS` (form notice): `הלקוחה ממלאת את הטופס בקישור שלה ממש עכשיו. אם היא לא תסיים, אפשר לנסות שוב בעוד 15 דקות.`
  - `LINK_USED`: `הלקוחה כבר השלימה את ההצטרפות בעצמה, והרכישה משויכת לחשבון שלה.` + link `לרשימת הלקוחות`.
  - `PURCHASE_VOIDED`: `הרכישה הזו בוטלה, ולכן אי אפשר לצרף אליה לקוחה.`
  - conflict: `לא הצלחנו לשייך את הרכישה לחשבון החדש, כי הפרטים התנגשו עם חשבון אחר. אפשר למלא את הטופס שוב. אם לא ממשיכים עכשיו, צריך להפיק ללקוחה קישור חדש במסך קישורי הצטרפות.` + link `למילוי מחדש` (reloads: new key); "קישורי הצטרפות" links to `/admin/links`.
- **Customer side:** `submitJoinAction` on `LINK_EXPIRED` re-reads the view and returns `used` too; the customer sees the existing `used` screen with `goToLogin`.
- One migration after the build go; the work manager pushes it. Then advisors, types, `test:db`.

**Never:** an account without a payment; a sign-in or session change for Tal; any audit row, profile column or token column marking that Tal filled it; a copy of the form's fields; the special-brunch question (2.16); changing the customer's join form; touching `join_begin`/`join_complete`; `טל` in customer copy; `←`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy | unbound, pending link | old link `revoked`, new account bound, both consents, privacy stored; profile audited as `customer`; no admin audit row; Tal still admin; done screen | — |
| Done screen | joined | email and the password Tal typed shown; copy button puts both and the login address on the clipboard; the action's result has no password | copy fails: manual-copy notice |
| Expired link | link past 48h, or none | as happy | — |
| Customer first | she finished | nothing changes | `LINK_USED` screen |
| Customer mid-join | her link `claiming` < 15 min | nothing changes | `LINK_IN_PROGRESS` notice |
| Tal first | Tal joined, customer submits | her link reads `used` | `used` screen |
| Stuck | her link `claiming` ≥ 15 min | revoked, her orphan Auth user deleted, fill goes on | — |
| Fill fails or abandoned | Tal submitted (her link revoked), then conflict or Tal left | old link: existing revoked screen (`LINK_EXPIRED` copy); "לטיפול": internal link `conflict` → `link_conflict`, `claiming` ≥ 15 min → `link_stuck`, `pending`/`awaiting_login` after 1h → `purchase_without_link`; `/admin/links` offers `הפקת קישור חלופי` | — |
| Existing details | email or phone matches an account | customer's link untouched | `details_taken` field error |
| Retry | same page, Auth step failed | same token, same `pending_user_id`, one account | — |
| Repeat key | same input, response lost | stored result has no token | `CONCURRENT_CHANGE` |
| Voided | 2.14 void | nothing changes | `PURCHASE_VOIDED` screen |
| Not admin | customer or guest | nothing changes | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `lib/server/privileged/join.ts` -- `submitJoin`, `ensureAuthUser` (password only while `token_view` is `active`), `joinStepKey`, `deleteOrphanUser`: reuse all.
- `app/(auth)/join/[token]/join-form.tsx` -- the form, hard-wired to `submitJoinAction` and a `token` hidden input; `join-view.ts` (`joinView`, `nextIdempotencyKey`), `join-steps.ts`, `join-input.ts` (`validateJoin`, `JoinInput`).
- `app/(auth)/join/[token]/actions.ts` -- `rpcFieldError` (move), `LINK_EXPIRED` re-read.
- `app/(auth)/join/[token]/page.tsx` -- `JoinFormContent`: `getPhotoConsentContent`, `getPublishedPageSlugs(["privacy"])`, `localToday`, `randomUUID`; the fill page loads the same.
- `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/page.tsx`, `entitlement-items.ts` (`segmentMatches`, `UNBOUND_SEGMENT`, `canVoid`), `load-entitlement.ts`, `../../back-link`.
- `app/admin/(shell)/links/actions.ts` -- `deletePendingUser` pattern after `admin_issue_link`.
- Live SQL: `admin_issue_link` (template: lock, revoke, issue, return token once), `private.lock_join_payment`, `private.revoke_join_token` (do not call: it audits), `private.issue_token`, `private.find_identity`, `private.join_identity`, `token_view`.
- `supabase/tests/support/db.ts` -- Auth user helper (insert into `auth.users`); `supabase/tests/join.test.ts`, `link-lifecycle.test.ts` for patterns.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261109210949_admin_join_fill.sql` -- the RPC and `token_view` as above -- written by the main session; work manager pushes. Do not edit it; report any needed change.
- [x] `lib/supabase/database.types.ts` -- `admin_begin_join_fill` added by hand; the main session regenerates after the push.
- [ ] `lib/server/privileged/join.ts` + `join.test.ts` -- shared runner, `submitJoinFill`, `customerId`; tests: no sign-in, orphan delete, token carried, `reissue_required`.
- [ ] `app/(auth)/join/[token]/join-form.tsx`, `join-view.ts`, `join-input.ts`, `actions.ts` + tests -- `action`/hidden/`outcome` props, token from state, `rpcFieldError` moved, `used` on re-read; customer tests unchanged and green.
- [ ] `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/join/{page.tsx,actions.ts,fill-outcome.tsx}` + tests -- the fill page and admin outcomes (`frontend-design` first); the outcome test checks the password comes from the form state, the copied text, and that the action result has no password.
- [ ] `.../[entitlementId]/page.tsx`, `entitlement-items.ts` + test -- the section and `canFillJoin`.
- [ ] `lib/copy/admin.ts` -- the copy above.
- [ ] `supabase/tests/admin-join-fill.test.ts` -- every matrix row at the DB level (begin, then Auth user + `join_begin`/`join_complete` with the returned token); `grants.test.ts` EXPECTED_GRANTS.
- [ ] `ARCHITECTURE-SPINE.md` AD-10 -- name `admin_begin_join_fill` among the token issuers, with its 1-hour internal link.
- [ ] `tickets.toml` E2 id 15 -- `status = "done"` in the PR.

**Acceptance Criteria:**
- Given a joined fill, when the audit log of the customer is read, then it equals a self-join's (actor `customer`) and has no admin row for the begin.
- Given Tal finished the fill, when she navigates the admin, then she is still signed in as admin.
- Given the customer signs in with the email and password Tal chose, then she reaches `/me` with the purchase.

## Implementation Notes

- Main session wrote the migration (applied by the work manager, advisors clean) and added `admin_begin_join_fill` to `database.types.ts` by hand; the signature was checked against the live function.
- Main session patch: a repeat key whose raw link is gone (`CONCURRENT_CHANGE`) now hands a new key, as `LINK_EXPIRED` does; the copy button's work moved to `copyLoginDetails` (no DOM test environment) with a failure test.
- `test:db`: all story files green; the full run's only failures are `business-settings.test.ts` (dev data: `default_capacity_regular` 14, one product at 43200), not touched by this story.

## Spec Change Log

- 2026-11-10, review pass 1 (triage rows 2 and 3), change to the frozen copy approved by the work manager: (a) `LINK_USED` screen, shown also after Tal's own success, now neutral: `הרכישה הזו כבר משויכת לחשבון של לקוחה, ולכן אין צורך למלא את הטופס.` + link `לרשימת הלקוחות`; opening the fill page of a bound purchase, when the customer is known: `הרכישה הזו כבר משויכת לחשבון של {name}.` + link `לכרטיס הלקוחה`. (b) `LINK_IN_PROGRESS` notice, shown also for Tal's own unfinished fill, now `הטופס של הרכישה הזו כבר באמצע מילוי: בקישור של הלקוחה, או במילוי קודם שלא הסתיים. אפשר לנסות שוב בעוד 15 דקות.`, as a wait notice (not an error). Avoids telling Tal the customer acted when she did. KEEP: everything else in the frozen block.
- 2026-11-10, user's phone check (relayed by the work manager), four changes: (1) the first guidance line is now `יש למלא את הטופס עם הלקוחה. הסכמתה בעל פה שקולה לאישורה בטופס.` (the second unchanged), and both show only on step 1 (`JoinForm` renders `lead` only when `step === 1`). (2) Done screen: `שליחה בוואטסאפ` under `העתקת פרטי הכניסה`, a `wa.me` link (new tab, navigation only, no `OnlineButton`) to the customer's phone through `normalizePhone`, with the same text as the copy; a number it cannot normalize shows only the copy button. The phone comes from the form's own state at submit, like the password (`JoinFormSent.phone`). (3) Copied/sent text: `*להתחברות:* {loginUrl}\n\n*פרטי הכניסה לאזור האישי:*\nמייל: {email}\nסיסמה: {password}` (link first for WhatsApp's preview, headings in WhatsApp bold). (4) "הבא" already ran `validateJoin` on step 1, but its phone check was a loose regex, so a number the server's `private.normalize_phone` refuses (e.g. `123456789`, `972…` without `+`) reached step 2 and bounced only on submit. `validateJoin` now uses `customerPhoneE164` (`lib/phone.ts`), a rule-for-rule mirror of `private.normalize_phone`; `normalizePhone` (content phones) was not reused because it refuses foreign numbers the server keeps (`+1…`) and accepts bare `972…` the server refuses (work manager approved). Shared form, so the customer's own join gets the same check; errors appear only on "הבא"/submit, never while typing. KEEP: the server still decides.

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 3, low 7, false 2, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `find_identity` matches the live link's orphan Auth user (stuck `claiming`, or `conflict` with a failed orphan delete) by the same email: `details_taken` instead of the fill (edge 1, 2, 8) | medium | patch | Confirmed in the SQL order (identity before revoke; orphan still in `auth.users`); new migration ignores that orphan when nothing else matches and returns it for deletion; DB test with the same email. |
| 2 | `LINK_USED` screen says the customer joined herself, also after Tal's own success (reload, back, lost response) (blind 4, edge 4, verification other) | medium | patch (copy pending work manager) | Real; frozen copy, asked the work manager for neutral wording. |
| 3 | `in_progress` notice blames the customer when Tal's own earlier fill is still claiming (reload after an error); rendered as destructive (blind 5, edge 5) | medium | patch (copy pending work manager) | Real; variant fixed now, wording asked. |
| 4 | Fill hooks of `JoinForm` (`replace`, `notice`, `fieldMessage`) never rendered with a state (verification gap 1, blind 10) | low | patch | Render tests with a mocked `useActionState`. |
| 5 | DB test never sends a null `p_payment_id`; `token_view` replacement case untested (blind 10) | low | patch | Tests added. |
| 6 | Role RPC failure reads `NOT_AUTHORIZED` (edge 6) | low | patch | `SERVER_ERROR` for `!role.ok`. |
| 7 | AD-10 lines 143 and 216 still say every link lasts 48h (blind 1) | low | patch | Lines updated. |

Rejected: 8 (link revoked at Tal's submit, intent A1) spec decision approved at the gate; 9 (`detailsTaken` after begin points to a revoked link, blind 3) low, the message already names the replacement path; 10 (carried token not checked against `paymentId`, blind 7, edge 7) low, needs an admin tampering with her own form, and she can issue links anyway; 11 (done-screen password differs after two failures plus a password edit, blind 6, edge 3, 9) low, rare, reset from the customer card fixes it, fix adds branches; 12 (focus on outcome screens, blind 9) low, same `aria-live` pattern as the customer's screens; 13 (summary/photo errors skip `fieldMessage`, blind 8) false, `detailsTaken` always comes alone, so it never reaches the summary; 14 (carried-token retry with matching details ends in `conflict`, verification other) false, a conflict screen with "למילוי מחדש" is the designed outcome; 15 (idempotency and token rows as a trace, intent C2) false, the decision covers profile, consents and log, not technical rows.

## Design Notes

Why a fresh internal link instead of a token-free core: `join_begin`/`join_complete` stay untouched (2.16 changes `join_complete` once for both paths), all intermediate states and retries of AD-21 come free, and only one live join token per payment remains (unique index). The raw token sits only in Tal's form state (a hidden input) between attempts, like a link she copies: never in the URL, `localStorage`/`sessionStorage`, a log line or the audit; the action still checks the admin role first. Revoking the customer's link happens at Tal's submit, not on opening the page, so an abandoned fill leaves her link alive.

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` -- all pass.
- `npm run test:db` (work manager's go) -- new file, `grants.test.ts`, `join.test.ts`, `link-lifecycle.test.ts`, `purchase-void.test.ts`, `session-role-and-token-view.test.ts` pass.

**Manual checks:**
- Phone: Tal fills from the purchase page, stays in admin; the customer logs in with that email and password; an expired link does not block; a bound purchase shows no section; the customer opening her old link after Tal finished sees `הקישור הזה כבר שימש ליצירת חשבון`.
