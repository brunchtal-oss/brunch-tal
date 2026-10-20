---
title: '4.6 Remove personal details on request'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'ab8e648ea05a9f324db869ea3d7b0ea00b6dcbf3'
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

**Problem:** A customer can ask Tal to delete her details (source §3, CAP-30), but nothing removes them; `anonymization_pending` and `anonymized_at` exist with no flow writing them.

**Approach:** A sensitive, two-step operation (AD-7, AD-21) from the customer card: (1) `admin_anonymize_customer` cleans every identifying value in one transaction, sets `anonymized_at` and `account_op_state='anonymization_pending'`; (2) a Server Action deletes the Auth user through `lib/server/privileged`; (3) `admin_finish_anonymize_customer` closes. Payments and bookings stay, nameless; money totals do not change.

## Boundaries & Constraints

**Always:**
- Blockers (memlog 2026-09-29; user decision 2026-10-20): a confirmed booking in a session that has not started, a `refund_requests` row in `requested`, a `cancellation_credits` row in `choice_pending`. Tal handles them first (cancel from the session page with refund or credit; complete the refund; make the choice), each listed with a link. Remaining entries on active entitlements and active credits do not block: the dialog shows them under "יאבדו" and they stay as they are, unused.
- Step 1 per table: `profiles` full_name = `'לקוחה שפרטיה הוסרו'` (NOT NULL check), null `phone_e164`, `pending_email`, `dietary_notes`; both photo consents false with `_at`/`_text_version` null; keep `privacy_consent_at`/`privacy_policy_version`. Delete: `babies`, `customer_notes`, `waitlist_entries`, `push_subscriptions` (deliveries cascade), her `notifications` (recipient) and admin notifications whose `target_path` starts with `/admin/customers/<id>`, with their `notification_jobs`. `payments`: null `payer_label`, `note`. `bookings`: null `guest_details`. `activation_tokens` (customer/bound/pending = her): null `input_hash`; live tokens revoked, `awaiting_login` join → `conflict`. `private.idempotency_results`: delete scope = her id or `token:<her token ids>`, and admin-scoped rows whose `result::text` contains her id. `audit_log` (customer_id = her): replace `note` in before/after with `"<removed>"` (the one unmasked free-text key).
- Keep untouched: amounts and states of payments, refunds, entitlements, credits, movements, corrections; `payments.reference`, `amount_override_reason`, `refund_requests.reference`, correction `reason` (admin business text); `rate_limits` (hash only).
- Auth delete: `auth.admin.deleteUser`; 404 / `user_not_found` = already deleted. Logs ids and codes only.
- Retry resumes: step 1 on a pending profile returns `pending` without cleaning again; finish on a closed one returns `not_pending`.
- Lock order (AD-6): her activation_tokens → babies → profile → bookings → payments → waitlist_entries → notification_jobs. Admin deletes of babies skip `babies_guard`'s profile lock and LAST_BABY.
- `admin_issue_link('reset')` refuses `anonymization_pending` (`RESET_TARGET_INVALID`). `private.job_reminders` and `private.job_expiry_alerts` skip `anonymized_at`. `private.similar_payments_for` returns the name `'לקוחה שפרטיה הוסרו'` instead of null for an anonymized profile (2.5 deferred; source wording overrides EXPERIENCE "לקוחה אנונימית").
- Redefinitions start from live `pg_get_functiondef`; keep all 15 attention-items branches and grants.
- Screens start with `frontend-design`; data-changing buttons use `OnlineButton`.

**Never:** delete payments, bookings, entitlements or audit rows; touch `plan_funding`, `entitlement_fits_event`, the session editor (3.18), `job_intervals` or marketing jobs (5.11); network calls inside a transaction; delete an Auth user other than a test-created fake one; import tables (6.2 adds itself).

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| Clean | no blockers | preview: no blockers; confirm → cleaned, Auth user deleted, closed; card shows tombstone | — |
| Blocked | future booking / refund requested / credit choice pending | preview lists them with links; no dialog | RPC re-checks: `ANONYMIZE_BLOCKED` with detail |
| Forfeit | 3 entries left, active credit | dialog row "יאבדו": "3 כניסות וזיכוי פתוח"; removal proceeds | — |
| Auth delete fails | step 1 done | action returns `SERVER_ERROR`; card tombstone shows "השלמת ההסרה" | stays pending |
| Stuck | pending > 15 min | "לטיפול" item `anonymization_stuck` → card | — |
| Retry | pending | button reruns 1(resume)→2→3 | — |
| Twice | already closed | step 1 returns `done` | — |
| Not confirmed / customer calls | — | — | `CONFIRM_REQUIRED` / `NOT_AUTHORIZED` |
| Admin target | admin_roles | — | `CUSTOMER_NOT_AVAILABLE` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261019233918_scheduled_jobs.sql:399` -- live `admin_get_attention_items`; template branch `email_change_stuck` (:737); `job_expiry_alerts` (:75).
- `supabase/migrations/20261013203359_account_admin_and_rate_limit.sql` -- `admin_issue_link` reset check (:154), `admin_begin/finish_email_change` (pattern), `account_op_*` checks (target_hash must be null for anonymization), auth.users update guards (delete unaffected).
- `supabase/migrations/20261006220218_session_reminders.sql:27` -- `job_reminders` WHERE.
- `supabase/migrations/20261019204039_credit_adjustments.sql:1185` -- `admin_get_customer` (live adds `last_activity_on`); returns NOT_FOUND for anonymized today.
- `supabase/migrations/20261005160954_duplicate_warning_by_name.sql:18` -- `similar_payments_for`.
- `lib/server/privileged/account.ts` -- `changeEmail` two-step pattern; `join.ts` `deleteOrphanUser` (404 handling) to mirror.
- `app/admin/(shell)/customers/[id]/page.tsx` -- marked spot at bottom of "פרטים" cube; `load-card.ts`, `actions.ts`, `card-items.ts` (`toBookingItem`).
- `app/admin/(shell)/concepts/[id]/concept-editor.tsx` `DeleteBox` -- dialog + key pattern.
- `components/admin/sensitive-confirm-dialog.tsx`, `lib/admin/sensitive-actions.ts`, `lib/errors.ts`, `lib/copy/admin.ts` (`customers.card`, `home.items`, `audit`), `lib/copy/audit-actions.ts`.
- `app/admin/(shell)/home-items.ts` (switch :174) and `home-items.test.ts`.
- `supabase/tests/support/db.ts` -- `insertAuthUser`, `inRollback`; seed like `account-admin.test.ts:17`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_remove_personal_details.sql` -- `private.plan_admin_anonymize_customer`, `preview_admin_anonymize_customer(p_customer_id)` → `{blockers:{bookings:[{booking_id,event_id,starts_at,concept}], refund_requests:[{id,amount_agorot}], pending_choices:[{credit_id}]}, forfeits:{entries_left, active_credits}}`, `admin_anonymize_customer(p_customer_id, p_confirmed, p_idempotency_key)` → `{result:'pending'|'done', user_id}`, `admin_finish_anonymize_customer(p_customer_id, p_idempotency_key)` (raises if the auth user still exists); `admin_get_customer` returns `{profile:{id, anonymized_at, removal_pending}}` for an anonymized profile; redefinitions above; attention branch `anonymization_stuck` (no `anonymized_at` filter, link `customer_id`). Grants: one each to `authenticated`. Audit: begin `{anonymized_at}` only.
- [ ] SQL Editor run by the user; session records it, `get_advisors`, regenerate `lib/supabase/database.types.ts`.
- [x] `lib/server/privileged/anonymize.ts` -- `anonymizeCustomer(customerId, key)`: step 1 → deleteUser → finish (fresh key).
- [x] `app/admin/(shell)/customers/[id]/actions.ts` -- `previewRemoveDetailsAction`, `removeDetailsAction` (also the retry).
- [x] `app/admin/(shell)/customers/[id]/remove-details.tsx` + `page.tsx`/`load-card.ts` -- button, blocked panel, dialog, tombstone (skip account/credits loads when anonymized). Run `frontend-design` first.
- [x] Copy: `sensitive-actions.ts` `customer_anonymize`, `errors.ts` `ANONYMIZE_BLOCKED`, `lib/copy/admin.ts`, `audit-actions.ts` (begin shown, finish hidden), `home-items.ts` case.
- [x] Tests: `supabase/tests/remove-personal-details.test.ts` (every matrix row; after: no PII in any listed table/audit; home sum and refunds report unchanged; reset refused; reminders and expiry alerts skip; stuck appears at 15 min); extend `grants.test.ts`, `admin-home.test.ts`; unit `anonymize.test.ts`, `home-items.test.ts`, `remove-details.test.tsx`.
- [x] `deferred-work.md` -- close the 9 items targeting 4.6 (lines 114, 129, 134, 400, 478, 505, 510, 598, 642).

**Acceptance Criteria:**
- Given a removed customer, when Tal opens the list, search, export or session booking search, then she is absent; her card shows the tombstone only.
- Given removal finished, when she tries to sign in or use a reset link, then it fails.

## Design Notes

Microcopy: button "הסרת פרטים אישיים"; question "האם להסיר את הפרטים האישיים?"; impact "יימחקו": "שם, טלפון, מייל, תינוקות, אלרגיות והעדפות, הסכמות לתמונות, הערות והתראות", "יישארו בלי שם": "תשלומים והרשמות. הסכומים בבית ובדוחות לא ישתנו"; checkbox "הלקוחה ביקשה להסיר את פרטיה. אי אפשר לבטל את ההסרה"; confirm "להסיר את הפרטים". Forfeit row "יאבדו": "{n} כניסות" / "זיכוי פתוח" (joined with "ו"). Blocked panel: "אי אפשר להסיר את הפרטים עדיין. קודם מטפלים בעניינים הפתוחים שלה:", groups "הרשמות עתידיות (מבטלים בעמוד המפגש, עם החזר או זיכוי)", "בקשות החזר שממתינות", "זיכויים שממתינים לבחירה". Tombstone: title "לקוחה שפרטיה הוסרו", "הפרטים הוסרו ב-{date}."; pending: "ההסרה לא הושלמה: החשבון שלה עדיין קיים." + "השלמת ההסרה". Attention: "הסרת פרטים לא הושלמה" / "אפשר להשלים אותה מהכרטיס". Error `ANONYMIZE_BLOCKED`: "אי אפשר להסיר את הפרטים: יש ללקוחה הרשמות עתידיות או עניינים פתוחים".

Step 1 sets `anonymized_at` immediately so she loses access and disappears from lists at once; only the Auth row remains until step 2.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- pass
- `npx vitest run --project db supabase/tests/remove-personal-details.test.ts` plus admin-home, customers, customers-export, account-admin, session-reminders, waitlist, push, notifications, grants -- pass (ask the user first)

**Manual checks:**
- Phone, a fresh fake customer: blocked with a booking; after cancel removal succeeds; tombstone; not in list/search; home sum unchanged; sign-in fails.

## Implementation Notes

- Migration `20261020200750_remove_personal_details.sql`; redefinitions copied from the repo files of the live versions (migration list matched dev on 2026-10-20). `babies_guard` needed no change (its DELETE branch already skips an admin caller). Join `awaiting_login` -> `conflict` uses `conflict_reason = bind_conflict`. Finish raises `CONCURRENT_CHANGE` while the Auth user exists. `admin_get_customer` keeps NOT_FOUND for missing/admin, returns the tombstone for anonymized.
- `database.types.ts` hand-edited for the 3 new RPCs (regenerate after the SQL Editor run). DB tests written, not run (migration not applied).
- 2026-10-21: the user ran both migrations in the SQL Editor (recorded; advisors clean). Generated types matched the hand edit; 3.18/5.11 tables left out of the branch. test:db: all 4.6 suites pass (14/14 removal); `grants` and `scheduled-jobs` differ only by 3.18/5.11 rows already in the dev DB.
- 2026-10-21 phone check passed. One change (user, fixes-log #12): the button moved from the bottom of "פרטים" to the bottom of the card, after "הערות", above a rule; the unused `remove.section` copy key was dropped.

## Spec Change Log

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap, intent-alignment): 2 high, 5 medium, 5 low, 9 false, 2 maybe-false. Migration 20261020200750 is already applied, so SQL patches go in a new migration.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `customers.test.ts:405` still expects NOT_FOUND for an anonymized id | high | patch | `admin_get_customer` now returns the tombstone; expect it there, NOT_FOUND only for admin and random id |
| 2 | Auto-extend (`entitlement_auto_extended`) and any other customer notifier still enqueue for a removed customer (forfeited cards stay) | high | patch | Only reminders and expiry alerts skip her; `private.enqueue_notification` returns null for an `anonymized_at` recipient, plus a test |
| 3 | Her unbound payment behind her join link keeps `payer_label`/`note` | medium | patch | Step 1 cleans only `customer_id = her`; also clean payments of her join tokens |
| 4 | Audit rows of those payments written with `customer_id` null keep `note` | medium | patch | Mask also rows with `entity_type='payments'` and `entity_id` in her payment ids |
| 5 | Tokens revoked or set to conflict with no `revoke_link` audit row | medium | patch | Audit each changed token, as `admin_issue_link` does |
| 6 | `admin_anonymize_customer` in `SHOWN_AUDIT_ACTIONS` has no result sentence (AGENTS.md) | medium | patch | Add a result sentence without details |
| 7 | Credit loop of `job_expiry_alerts` skip is untested | medium | patch | Case in `scheduled-jobs.test.ts` credits block |
| 8 | `RemoveDetails`: stale blockers on a failed re-preview; `CUSTOMER_NOT_AVAILABLE` shows an error instead of refreshing to the tombstone; `ANONYMIZE_BLOCKED` with an empty re-read shows nothing; comment says a thrown call resends its key (it never does) | low | patch | Clear blockers at start; refresh on CUSTOMER_NOT_AVAILABLE; show the error when the re-read is empty; correct the comment |
| 9 | Missing DB tests: preview/removal on a removed or missing profile; `admin_list_payments` after removal | low | patch | Add both |
| 10 | Screen readers hear the button label twice (`dt` sr-only = button text); `isBlocked` used only by tests; `removedProfileOf` turns a missing id into "undefined" | low | patch | Distinct `dt` label; drop `isBlocked`; reject a tombstone without id |
| 11 | A `claiming` join token with a `pending_user_id` Auth user may leave an orphan Auth user | maybe-false (medium) | defer | Needs a check of whether `pending_user_id` can differ from her id on her own tokens |

Rejected: concurrent self-booking slipping past the plan (false for `admin_book_customer`, which locks with `anonymized_at is null`; `book_session` window is the same second and needs a booking-RPC redefinition); `reference`/`amount_override_reason`/correction `reason` kept and the in-progress session not blocking (spec decisions); `user_id` unused (same value); no interaction tests (repo pattern is static render); idempotency `like` scan (small table, no identified admin result with her name but not her id); null RPC data guards (RPCs always return an object); intent-alignment notes (descriptive; Auth covered by the phone check); deferred-work statuses before test:db (updated after the run).
