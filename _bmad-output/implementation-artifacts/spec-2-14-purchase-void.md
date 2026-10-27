---
title: 'Purchase void (2.14)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: 'bdd4f074e62859d160db0167168a941d813f24dd'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A payment recorded by mistake (wrong customer, wrong product, money never arrived) cannot be undone: it stays in the month total, its card or single keeps funding bookings, and its unredeemed join link stays live. The source document does not define a void; this is the user's decision of 2026-10-26 (`completion-plan-2026-10-10.md`).

**Approach:** One final sensitive admin action, "ביטול הרכישה", on the admin purchase page. In one transaction: payment `voided`, entitlement `revoked`, live join link revoked, future bookings funded by the purchase cancelled with no credit and no returned entry (place freed, waitlist notified), audit with reason. The customer gets no notification; the purchase disappears from her personal area. Every reader of payments and entitlements treats the result consistently.

**User decisions (2026-10-26):**
- Future bookings do not block; they are cancelled and listed in the dialog. Blocks: an entry already used, an existing credit or refund request, already voided. No undo: after a mistake Tal records a new payment.
- `/admin/payments`: the whole row is a link to the purchase page (no separate button); a voided payment shows the tag `בוטל`. Customer card history: `בוטל`.
- No customer notification of any kind, also not for the cancelled bookings (a void is Tal's own mistake). The dialog always shows `הלקוחה לא תקבל התראה`. Only for a card (`kind = 'card'`) with bookings to cancel, it adds `כבר בוצע רישום בכרטיסייה, יש לעדכן את הלקוחה על הביטול` (e.g. a card loaded to the wrong customer, who already booked with it). Never for `single`, `intro` or `couple`: their booking always exists and the customer did not make it, so after Tal's mistake there is nothing to tell her.
- The customer does not see a voided purchase at all: not on the home, not in her purchases, and its page is not found. Her cancelled bookings stay in `ההרשמות שלי` as cancelled, as today.

## Boundaries & Constraints

**Always:**
- **RPCs** (AD-5, AD-7): `private.plan_admin_void_purchase(p_payment_id)`, `preview_admin_void_purchase(p_payment_id)` (admin check + plan), `admin_void_purchase(p_payment_id, p_reason, p_confirmed, p_idempotency_key)`; `authenticated`, admin first line, revoke all, one grant each.
- **Plan** → `{ok, code}` or `{ok, payment_id, entitlement_id, kind, customer_id, customer_label, product_name, amount_agorot, paid_on, link_will_be_revoked, bookings: [{booking_id, event_id, starts_at, concept_name, party_size, guest_details}]}`. Bookings = `confirmed` bookings with `payment_id` = this payment or an allocation on this entitlement, session not started. Codes, first match: `NOT_FOUND`; `PURCHASE_VOIDED` (payment not `approved` or entitlement not `active`); `PURCHASE_ENTRY_USED` (such a booking `completed`, or `confirmed` with `starts_at <= now()`); `PURCHASE_HAS_CREDIT` (any `cancellation_credits.source_entitlement_id` or `refund_requests.payment_id`); `MANUAL_HANDLING_REQUIRED` (a listed booking with `private.needs_manual_cancel`); `INVALID_INPUT` (reason > 2000).
- **Action order:** admin check → `idempotent_begin` → unlocked read of payment and customer → bound: `private.lock_customer`; unbound: `private.lock_join_payment` (token advisory + rows; `LINK_IN_PROGRESS` for `claiming`, binding meanwhile → `CONCURRENT_CHANGE`) → events of the listed bookings by id → those bookings → entitlement → payment `for update`; recheck customer (`CONCURRENT_CHANGE`) → plan → `CONFIRM_REQUIRED` unless `p_confirmed` → `cancel_core(booking, actor, 'admin', 'admin_void_purchase', reason, 'void')` per booking → entitlement `revoked` (audit) → payment `voided`, `voided_at = now()` (audit, reason) → live token `private.revoke_join_token` → `idempotent_finish` → `{payment_id, cancelled_count}`.
- **`cancel_core` void mode** (`p_choice = 'void'`, signature unchanged, allowed only for `p_action = 'admin_void_purchase'`, any funding): every entitlement allocation gets `release` (the ledger closes; the card is revoked, so nothing is usable); no credit, no refund request, no per-booking notification; booking audit, `refresh_credits_for_event` and `notify_waitlist` as today.
- **Schema:** `payments.voided_at timestamptz null`, `check ((status = 'voided') = (voided_at is not null))`.
- **Readers** (from live `pg_get_functiondef`, nothing removed): `admin_list_payments` + `status`, `entitlement_id`; `admin_get_entitlement` + `payment_id`, `payment_status`, `voided_at`, `void_reason` (reason of the payment's `admin_void_purchase` audit row); `get_my_entitlements` leaves out entitlements whose payment is `voided`; `token_view`: revoked token whose payment is `voided` → `state_public = 'voided'`; `private.bind_purchase`: payment not `approved` or entitlement not `active` → `PURCHASE_VOIDED`, nothing bound (a refunded purchase, 3.9, keeps both and still binds); `private.lock_join_payment`: payment `voided` → `PURCHASE_VOIDED` (no new or replaced link); `admin_list_links`: `can_revoke`/`can_replace` also need `pay.status = 'approved'`. Already safe, unchanged: `admin_get_home` month sum and `similar_payments*` (`approved`), `plan_funding` and the card jobs (`active`), `admin_list_open_cards`, `admin_get_attention_items` (the void revokes conflict tokens; other kinds need active rows or are blockers), the export (no payment columns), `admin_get_customer` (already returns both statuses).
- **Admin UI** (`frontend-design` first): section `ביטול הרכישה` on the purchase page (also `customers/unbound/...`, card or pinned), only when the payment is `approved` and the entitlement `active`; reason `סיבה (לא חובה)`; `OnlineButton`; sensitive key `purchase_void`, question `האם לבטל את הרכישה?`; impact rows (product, amount, paid on); list `הרשמות שיבוטלו, בלי זיכוי` (date, concept, `זוגית` and `guest_details` when `party_size` 2), or `אין הרשמות עתידיות מהרכישה`; line `קישור ההצטרפות יבוטל` when `link_will_be_revoked`; the notification lines above (plan returns `kind`); notice `הביטול סופי. אם זו טעות, רושמים תשלום חדש`. After a void the page shows chip `בוטל`, `הרכישה בוטלה ב-{date}` and `סיבה: {reason}` when present, and hides the corrections section and its not-correctable note. `/admin/payments`: the whole row links to `entitlementHref(customer_id, entitlement_id)`; voided row: chip `בוטל`, amount struck through. Customer card payment line: `בוטל` (was `בוטלה`). Links list: no revoke or replace on a voided purchase.
- **Customer UI:** join page state `voided`: only `הקישור הזה בוטל.`, no contact line or link; also in `claim-join`. `/me` needs no change beyond the RPC filter (an unknown purchase id is already not found).
- New codes only in `lib/errors.ts`; copy in `lib/copy/*`; audit action `admin_void_purchase` (name `ביטול רכישה`, rule, result sentence) in `lib/copy/audit-actions.ts`.
- One migration, only after the build go; the planning tab runs it (`supabase db push` from this worktree); registered; no drop.

**Never:** undoing a void; any customer notification about it; touching an existing credit, refund request or 3.9/3.16 paths; a credit or returned entry for a voided booking; cancelling a started or completed booking; voiding a `claiming` link mid-join; unpaid-payment tracking; online payments; "טל" in customer copy; `←` in any screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card, future booking | active card, 1 confirmed future booking | booking cancelled, `release`, no credit; payment `voided`, entitlement `revoked`; place freed; waitlist notified on transition; no customer notification; purchase gone from `get_my_entitlements`; dialog shows the card line | — |
| Pinned couple | pinned couple, unbound, future booking | dialog lists it with `זוגית`, no card line; cancelled, no credit | — |
| Pinned single | bound single with its booking | dialog shows only `הלקוחה לא תקבל התראה`, never the card line | — |
| Unbound, live link | pending link | link `revoked`; `token_view` → `voided`; `bind_purchase`/join refused | `PURCHASE_VOIDED` |
| Mid-join | link `claiming` | nothing changes | `LINK_IN_PROGRESS` |
| Used entry | booking completed, or confirmed and started | nothing changes | `PURCHASE_ENTRY_USED` |
| Credit or refund | a credit from this purchase or a refund request | nothing changes | `PURCHASE_HAS_CREDIT` |
| Again | already voided | nothing changes | `PURCHASE_VOIDED` |
| No checkbox | `p_confirmed` false | nothing changes | `CONFIRM_REQUIRED` |
| Idempotent | same key twice | one void, one set of audit rows | — |
| Customer calls | any new RPC or preview | nothing | `NOT_AUTHORIZED` |
| Totals | voided payment this month | out of `admin_get_home` month sum; `/admin/payments` row tagged `בוטל` | — |
| Links | voided unbound purchase | `can_revoke`/`can_replace` false; `admin_issue_link` refused | `PURCHASE_VOIDED` |

</frozen-after-approval>

## Code Map

- Live sources (verify with `pg_get_functiondef` before redefining): `cancel_core`, `bind_purchase` `20261022154256_refactor_sweep_db.sql` (bind) and `20261019233604_waitlist.sql` (cancel_core, notify_waitlist); `token_view` `20261005112857_pinned_display_and_duplicates.sql:581-629` (revoked → expired :606); `get_my_entitlements` `20261010141240_cancellation_credits.sql:2624`; `admin_get_entitlement` `20261019203305_auto_extend.sql:222-342`; `admin_list_payments` `20261004072550_payer_label.sql:512-555`; `admin_list_links` `20261004075417_payer_label_review_fixes.sql:296-302`; `lock_join_payment` `20261003190437_link_lifecycle_and_recovery.sql`. Helpers: `private.lock_customer`, `revoke_join_token` (returns an orphan user id only for `claiming`, which the void refuses), `needs_manual_cancel`, `idempotent_begin/finish`, `audit`. No notification type or template changes.
- Admin purchase page `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/`: `page.tsx` (terms end :157, history :159; chip :76-101; not-correctable note :133-137), `entitlement-items.ts` (`UNBOUND_SEGMENT`/`entitlementHref` :102-114, type :76-98, `parseCorrectionPlan` :354-391, `affectedLine` :414), `actions.ts` (pattern :20-123), `correction-row.tsx` (preview, dialog :53-140, `SensitiveConfirmDialog` :377-433); tests beside them. Pinned purchases render there already.
- `app/admin/(shell)/payments/`: `page.tsx:68-126` (only the title links today), `payment-items.ts:15-79`; tests. `components/shared/status-chip.tsx`.
- Customer card: `customers/[id]/card-items.ts:378-389` (`toPaymentLine` already marks non-approved), `lib/copy/admin.ts:1946` (`voided`).
- Links: `app/admin/(shell)/links/{link-items.ts, links-list.tsx:104-106}`.
- Join: `lib/server/privileged/join.ts:46-110` (`state_public` switch), `lib/auth/join-link-state.ts:3-4`, `app/(auth)/join/[token]/{join-view.ts:7-28, join-form.tsx:200-230, claim-join.tsx}`, `lib/copy/join.ts` (:43-70).
- Customer: `app/me/purchases/[id]/page.tsx` derives the purchase from `get_my_entitlements` (missing id → not found); `app/me/purchase-items.ts` unchanged.
- Registries: `lib/errors.ts`, `lib/admin/sensitive-actions.ts:7-38`, `lib/copy/audit-actions.ts` (`SHOWN_AUDIT_ACTIONS` :175; examples :197-214, :346-358; scanned by `audit-actions.test.ts:65-87`), `lib/copy/admin.ts` (`paymentsList` :144, `customers.entitlement` :1707, `audit.actions` :2228, `audit.results` :2150).
- DB tests: `grants` (`EXPECTED_GRANTS`), `bind-purchase`, `session-role-and-token-view` (:94-216), `cancel`, `cancellation-credits`, `waitlist`, `my-entitlements`, `entitlement-corrections`, `admin-home`, `repeat-purchase` (`admin_list_payments`), `link-lifecycle`, `open-cards`, jobs.
- Not changed: `admin_reschedule_event` still rewrites `expires_on` of a revoked pinned entitlement (harmless; logged in deferred-work); export (`admin_export_customers` has no payment columns).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_purchase_void.sql` -- **planning tab runs it:** column and check, `cancel_core` void mode, plan/preview/action, the redefined readers above; grants.
- [ ] `lib/supabase/database.types.ts` -- hand-edit until applied, then regenerate.
- [x] `supabase/tests/purchase-void.test.ts` -- every matrix row; update the listed DB tests.
- [x] `lib/errors.ts`, `lib/copy/{admin,customer,join,audit-actions}.ts`, `lib/admin/sensitive-actions.ts` -- codes, copy, key, audit action.
- [x] Admin screens (`frontend-design` first): void section and action, voided state, payments row link and chip, card wording, links buttons; parser, action and render tests.
- [x] Customer screens: join `voided` state; tests (a voided purchase absent from `/me` is covered by the DB test).
- [x] Docs -- ARCHITECTURE-SPINE (AD-10 and status table: `voided` set by `admin_void_purchase`, "2.14, החלטת המשתמשת 2026-10-26"), `data-model.md` (payments row, `voided_at`), `deferred-work.md` (close the 2.2 bind/token item and the 4.12 item "נסגר ב-2.14"; add the reschedule note), `completion-plan-2026-10-10.md`; `tickets.toml` id 14 done in the PR.

**Acceptance Criteria:**
- Given a voided purchase, when Tal opens it from `/admin/payments` or the customer card, then she sees `בוטל`, the date and the reason, and no void or correction controls.
- Given a void that cancelled bookings, when Tal opens each session, then the booking is cancelled and the free places grew by its party size.

## Implementation Notes

- 2026-10-26 (planning): work only in this worktree (`.claude/worktrees/story-2-14`); run `npm install` there first (not `npm ci`). Create the migration with `npx supabase migration new purchase_void`, write it, but never apply it (no MCP `apply_migration`, no `db push`, no `execute_sql` DDL/DML): the planning tab applies it. MCP `execute_sql` only for read-only `pg_get_functiondef`. No `npm run test:db`, no demo/video seed or clear, no git commit/push, no writes to `.env*`. Until applied, hand-edit `lib/supabase/database.types.ts`. Load `supabase-postgres-best-practices` before writing SQL and `frontend-design` before screens. Stop only node processes you started (by PID or port), never all node.
- 2026-10-26 (implementation): migration `20261026212957_purchase_void.sql` (no drop; 9 redefinitions md5-checked against live, 3 new functions). A `claiming` link past 15 minutes ("stuck") does not block: it is revoked as `admin_revoke_link` does, the RPC returns `revoked_pending_user_id`, and `voidPurchaseAction` deletes that orphan Auth user (`deleteOrphanUser`); a live `claiming` link still gets `LINK_IN_PROGRESS`. Unbound path: `LINK_USED` from `lock_join_payment` (she joined meanwhile) becomes `CONCURRENT_CHANGE`. A booking also funded by another card of the same kind releases that card's unit too (that part was paid). `admin-home.test.ts` sets `voided_at` with `voided` (new check). `npm run build` in the worktree needs the main folder's `.env.local` values in the environment (read only). DB tests written, not yet run (waiting for the planning tab to apply the migration).

## Spec Change Log

- 2026-10-27 (phone check, user decision): the customer card's `יתרות ותוקף` leaves out a voided card (`balanceViews` skips `status = 'revoked'`); it stays only in the history with `בוטל`. A booking cancelled by a void stays in `ההרשמות שלי` with `בוטל`, as specified (user kept it).

## Review Triage Log

**Round 1 (2026-10-27):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. medium 1, low 4, false 6, rejected low 6; no intent_gap or bad_spec.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | vgap, blind, edge | Join form open while Tal voids: `join_begin` raises `LINK_EXPIRED`, so the customer sees "expired" with the contact line | low | patch | `submitJoinAction` re-reads the link on `LINK_EXPIRED` and returns `voided`; tests |
| 2 | vgap | `getJoinTokenView` `voided` mapping untested | low | patch | test + loop case in `join.test.ts` |
| 3 | blind, intent | Voided purchase page still shows the meter and free entries (void-mode `release`) | medium | patch | `showsBalance`: balance section hidden when voided; helper test |
| 4 | blind | No DB test for `NOT_FOUND` and for voiding a `conflict` link | low | patch | two tests in `purchase-void.test.ts` |
| 5 | blind | New deferred entry lacks `target`/`status` | low | patch | fields added |
| 6 | vgap | `MANUAL_HANDLING_REQUIRED` refusal untested | low | defer | write path guarded by `cancel_core`; deferred-work |
| 7 | blind | `CONCURRENT_CHANGE` branches untested | medium (unverified) | defer | needs a paused concurrent transaction, as 3.13 #15 |

Rejected: booking created between the events and bookings locks (false: bookings are made under the profile lock, unbound purchases get none); refund request without a credit (false: `refund_requests.credit_id` is not null); product name of the voided purchase leaking in "ההרשמות שלי" (false: shown only for a confirmed booking's cancel); `PURCHASE_VOIDED` too broad (false: nothing else sets `revoked`/`refunded`); `deleteOrphanUser` throwing after commit (false: it catches; only a missing service env would throw); migration header "db push" (false: that is how it was applied); anonymized customer's purchase refused with `NOT_FOUND`, `בוטלה` chip on the card plate (correct feminine for a card), queued pushes not purged (sent within a minute; same as any cancel), reason lost on a refused confirm, unbound back link to open cards, `<time>` wrapping the title (rare or cosmetic, fix adds branches); payments row no longer links the customer and render-level tests (user decision; review-accepted).

## Design Notes

`release` in void mode keeps `entitlement_balances` honest (no "reserved" units for a cancelled booking); the entitlement is `revoked`, and `plan_funding`, the card jobs and `/me` home all require `active`, so the released units are never usable. Refusing `claiming` reuses `lock_join_payment` exactly as link revoke does, so no Auth user is orphaned. No notification: `cancel_core` void mode skips its per-booking message, and the void sends none.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run format:check`, `npm run build` -- pass.
- After apply (planning tab's go): `get_advisors` (only approved WARNs), `npm run test:db` on the new and listed files -- pass.

**Manual checks (if no CLI):**
- Phone, on purchases made for the check (dev-customer), never `*@video.example.com`: (a) card with a future booking; (b) used entry blocked; (c) unbound purchase voided from the payments row, link opens as cancelled; (d) payments row, tag and month sum; (e) card history `בוטל`; (f) as the customer: no notification, the purchase is gone, the booking shows cancelled.
