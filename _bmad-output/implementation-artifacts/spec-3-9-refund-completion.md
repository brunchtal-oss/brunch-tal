---
title: 'Refund completion (3.9)'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'bd377881a5e6c8a3d4ccd46c13f1582f2f8698c1'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/cancellation-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A refund request (3.7 self/admin cancel, 3.8 `choose_credit_outcome`) stays `requested` forever: Tal cannot record that she paid it, the customer never sees "הוחזר", and the month totals never subtract it. Source §6: "הוחזר" only after Tal confirms a date, an amount and an optional reference; the amount follows what was paid; acceptance (line 405): no refund above the original amount. §7: "אישור החזר" is sensitive ("האם לאשר החזר?").

**Approach:** One sensitive action (AD-7) closes a request: request `completed`, its credit `refunded`, a customer notification. Tal reaches it from a refunds section on `/admin/payments` (linked from the home section and the attention item) and from the customer card, which gains a credits-and-refunds section. The customer's refund card and purchase chip show "הוחזר".

**User decisions (2026-10-13):**
- A paid pinned purchase without a place in a cancelled session (3.8 "parked") stays outside 3.9: Tal settles it by hand, its attention item stays; recorded in `deferred-work.md` for 3.13.
- Any amount from 0 up to `max_agorot`; the request closes `completed` with the amount Tal entered. No remainder stays open.
- New notification type `refund_completed`, push on: title `ההחזר בוצע`, body `החזר של {amount} על הבראנץ׳ ב-{date} הועבר אלייך`, `allowed_vars` `['amount','date']` (`date` = the cancelled session's day).
- The list lives at the top of `/admin/payments` (section `בקשות החזר`, open first, then recent completed); the home rows and the attention item link to `/admin/payments#refund-<id>`.
- 2026-10-14 (local check, overrides the list wording above and below): the `/admin/payments` section shows **open requests only** and is not shown at all without one; completed refunds stay in the customer card. `admin_list_refund_requests` keeps returning the completed ones (already applied; the section filters). The done notice lives in a page-level `ResultNoticeHost`.
- 2026-10-14 (review round 1): `refund_completed` (from `admin_complete_refund` and from the bind) targets the purchase page `/me/purchases/<source_entitlement_id>`, where the chip `הוחזר` stays, not `/me/bookings` (a back-dated or late-bound refund would land on a page without its card). Small migration, no drop.
- 2026-10-14 (review round 1): the `/admin/payments` section also lists completed refunds of purchases not bound yet (no customer card to show them), under the open requests; it is shown when either exists. Once bound, they leave it for the customer card.
- The home month totals count a refund by `refunded_on` (like payments by `paid_on`): `admin_get_home` is redefined from live, only that filter changes.
- A refunded card stays in `/me/bookings` for 14 days after `refunded_on` (local days, computed in SQL), then only the purchase chip `הוחזר` remains.
- Build order: everything except the customer-card section first (migrations, RPCs incl. `admin_list_customer_credits`, payments refunds section, home/attention links, customer screens). The `app/admin/(shell)/customers/[id]/` section is built only after 4.3 is merged and `origin/main` is merged into this branch.

## Boundaries & Constraints

**Always:**
- **Plan** `private.plan_admin_complete_refund(refund_request_id)` (stable) → `{ok, code}` or `{ok, refund_request_id, customer_id, customer_label, requested_agorot, paid_agorot, refunded_before_agorot, max_agorot, paid_on, concept_name, starts_at}`. `paid_agorot` = the request's `payments.amount_agorot`; `refunded_before_agorot` = sum of `completed` requests on the same payment; `max_agorot = paid_agorot - refunded_before_agorot` (never below 0). Not `requested` → `REFUND_ALREADY_COMPLETED`. `preview_admin_complete_refund` = admin check + plan.
- **`admin_complete_refund(p_refund_request_id, p_refunded_on date, p_amount_agorot int, p_reference text, p_confirmed, p_idempotency_key)`** (`authenticated`, admin): admin check → `idempotent_begin` → shape (`INVALID_INPUT` with detail `field`: `refunded_on` after local today or before `paid_on`; `amount` < 0; `reference` trimmed > 200) → read the request unlocked → lock her profile (if bound) → credit → payment → request; recheck status and customer (`CONCURRENT_CHANGE`) → plan → `p_amount_agorot > max_agorot` → `REFUND_EXCEEDS_PAID` → `CONFIRM_REQUIRED` unless `p_confirmed` → request `completed` (`completed_at = now()`, `refunded_on`, `amount_agorot` = the refunded amount, `reference` null if empty, `handled_by`) → credit `refunded` → audit both rows before/after → `refund_completed` (vars `{amount, date}`) for a bound customer, discriminator = request id, target `/me/bookings`. Returns `{refund_request_id, amount_agorot}`. Same key twice → same result, one notification.
- **Schema (additive):** `refund_requests.refunded_on date` (null while `requested`, required when `completed`; extend `refund_requests_completion_check`).
- **Reads:** `admin_list_refund_requests()` → open requests (`requested_at`) then the latest 30 completed (`completed_at desc`): `{refund_request_id, status, customer_id, customer_label, amount_agorot, requested_at, refunded_on, reference, concept_name, starts_at, product_name, paid_agorot, max_agorot}`. `admin_list_customer_credits(p_customer_id)` → her credits: `{credit_id, status, choice_pending, party_size, origin_starts_at, concept_name, monetary_basis_agorot, refund: {refund_request_id, status, amount_agorot, requested_at, refunded_on, reference}|null}`. `get_my_credits` (from live) adds `refund.refunded_on` and returns a `refunded` credit only while local today ≤ `refunded_on` + 14.
- **Admin UI** (`frontend-design` first): sensitive key `refund_complete: "האם לאשר החזר?"`; the dialog's `choice` slot holds `תאריך ההחזר` (default today, max today), `סכום ההחזר` (default `requested_agorot`, `parseShekelsToAgorot`), `אסמכתה (לא חובה)`; impact rows `שולם {paid}`, `הוחזר כבר מהתשלום הזה {before}` (only when > 0), `אפשר להחזיר עד {max}`; confirm `לאישור ההחזר`; done `ההחזר נרשם`. Section `בקשות החזר` at the top of `/admin/payments`, row id `refund-<id>`, button `סימון שההחזר בוצע`; completed rows show `הוחזר {amount} ב-{DD.MM.YY}` and the reference. Customer card section `זיכויים והחזרים` after the balances, chips `זיכוי פעיל` / `נוצל` / `ממתינה לבחירה` / `בקשת החזר` / `הוחזר`, the same button on an open request.
- **Customer UI** (`frontend-design` first): refunded card chip `הוחזר`, title `ההחזר של {amount} בוצע`, note `בתאריך {DD.MM.YY}`; purchase chip `creditChip` refunded → `הוחזר`. Never "הוחזר" or "בוצע" while `requested`. No "טל" in customer copy.
- `admin_get_attention_items` is **not** redefined: its `refund_requested` item ends by itself once `completed`; only its TS href changes.
- Bind and token (deferred 2.2/4.12): a refund leaves the purchase bindable. `bind_purchase` (from live) moves a `refunded` credit and its request as today and sends `refund_completed` (discriminator `bind:<credit_id>`). `token_view` and `get_my_entitlements` are unchanged (`credit_status` already carries `refunded`); tests prove it.
- Codes `REFUND_ALREADY_COMPLETED`, `REFUND_EXCEEDS_PAID` only in `lib/errors.ts`; copy in `lib/copy/*`; audit action label.
- Migration only after "מתחילים לבנות": `migration new`, each redefinition from `pg_get_functiondef`; a new notification type is a separate drop migration built from the live check (keeps any type 2.8 or 4.3 added), run by the user in the SQL Editor and registered; then `get_advisors`, types, full `test:db`, `demo:seed`.

**Never:** opening or completing a refund without a request (parked purchases stay manual), voiding a payment, moving a booking (3.10), changing credit options or extending (3.16), entitlement corrections (3.13), online payments, redefining `admin_get_attention_items`, a second refund on one request.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full refund | Request ₪180 on a ₪180 payment, today, ref "1234" | Request `completed`, credit `refunded`, home refunded +1/+₪180, net −₪180, open list and attention item drop it, customer notified | — |
| No checkbox | `p_confirmed` false | Nothing changes | `CONFIRM_REQUIRED` |
| Above paid | ₪200 on a ₪180 payment | Nothing changes | `REFUND_EXCEEDS_PAID` |
| Two requests, one payment | ₪100 completed; second request, ₪100 on a ₪180 payment | Nothing changes; ₪80 succeeds | `REFUND_EXCEEDS_PAID` |
| Twice | Already `completed`, new key | Nothing changes | `REFUND_ALREADY_COMPLETED` |
| Idempotent | Same key twice | Same result, one notification | — |
| Future date / before paid | `refunded_on` tomorrow, or before `paid_on` | Nothing changes | `INVALID_INPUT` (`refunded_on`) |
| Unbound seat | Request with null customer | Completed, no notification; bind moves both (and sends `refund_completed`), customer sees "הוחזר" | — |
| Partial | ₪120 on a ₪180 request | `completed` with ₪120; nothing left open | — |
| Month | `refunded_on` last month, recorded today | Counted in last month's totals, not this month's | — |
| Card age | Refunded 15 days ago | Not in `/me/bookings`; purchase chip `הוחזר` | — |
| Customer before Tal | Request open | Card `בקשת החזר של {amount} התקבלה`, chip `בקשת החזר`; no "הוחזר" | — |
| Customer calls | `admin_complete_refund` / `preview_*` / `admin_list_*` as customer | Nothing | `NOT_AUTHORIZED` |
| Concurrent | Two completions on one payment | One waits on the payment lock; the ceiling holds | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010141240_cancellation_credits.sql` -- `refund_requests` `:104-121` (completion check `:116-120`, open index `:125-130`, RLS `:154`, grants `:164`), credit statuses `:61`, `monetary_basis` `:201`, `admin_get_home` `:2847` (refunded `:2937-2941`, net `:2950`, `open_refunds` `:2956`), `get_my_entitlements` `:2624` (`credit_status` `:2707`).
- `20261013162639_business_cancel_event.sql` -- `cancel_core` `:218` (refund branch `:330`), `choose_credit_outcome` `:1256`, `bind_purchase` `:1381` (refund lock `:1438`, move `:1542`, notify `:1581-1628`), `get_my_credits` `:1637` (refund `:1689`), `admin_get_attention_items` `:1761` (do not redefine).
- `20261005111717_*:581` `token_view` (check the live DB for a later one). `20261007183144_two_photo_consents.sql:394` `admin_get_customer` (not redefined; 2.8 may). `20261010141237_*:26-34` type check (16 types, 15 templates). `20261001184225_*:223` `enqueue_notification` (`push` per template `:77`). `20260930191525_*:211` `private.audit`. Pattern: `plan_admin_cancel_booking` / `admin_cancel_booking` (`cancellation_credits.sql:1011,1592`, confirm `:1700-1726`).
- Tests: `admin-home`, `bind-purchase`, `cancellation-credits`, `business-cancel`, `my-entitlements`, `session-role-and-token-view`, `settings-and-templates` (count `:634,:662`), `grants` (`EXPECTED_GRANTS` `:15`).
- Admin UI: `app/admin/(shell)/home/open-refunds.tsx`, `home-items.ts` (`toOpenRefund` `:353`, attention `refund_requested` `:225-238`), `home/month-totals.tsx`; `customers/[id]/{page.tsx (sections ~127-153), card-items.ts, load-card.ts}`; `payments/{page.tsx, payment-items.ts}` (`admin_list_payments`, 50 latest); `components/admin/sensitive-confirm-dialog.tsx` (`choice`, `choiceMissing`); `lib/admin/sensitive-actions.ts`; pattern `sessions/[id]/{attendee-cancel.tsx, cancel-plan.ts, actions.ts}`; money input `payments/new/payment-form.tsx` (`:167-205,:537,:594-606`), `lib/money.ts`; `lib/copy/admin.ts` (`home` `:962-1005`, `sensitive` `:797`, `customers.card` `:1322`, `audit.actions` `:1510`, template types `:1246`), `lib/admin/template-check.ts`.
- Customer UI: `app/me/bookings/{credits.ts (:15,:27,:78-103,isOpenRefund :156), credit-cards.tsx (RefundCard :108-129), bookings-list.tsx (:41-42,:88)}`, `app/me/purchase-items.ts:152-162`, `lib/copy/customer.ts:185-212`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_refund_completed_type.sql` -- **main session; user runs in SQL Editor:** live check + `refund_completed`; registered in `schema_migrations`.
- [x] `supabase/migrations/<ts>_refund_completion.sql` -- column + check, `refund_completed` template (push on), plan/preview/action, the two list RPCs, `get_my_credits`, `admin_get_home` (filter by `refunded_on`), `bind_purchase`; revoke all, one grant each.
- [x] `lib/supabase/database.types.ts` -- regenerate.
- [x] `supabase/tests/refund-completion.test.ts` -- every matrix row; update `admin-home` (totals after completion), `bind-purchase` (refunded credit moves), `session-role-and-token-view`, `settings-and-templates`, `grants`.
- [x] `lib/errors.ts`, `lib/copy/{admin,customer}.ts`, `lib/admin/sensitive-actions.ts`.
- [x] Admin screens (`frontend-design` first): `/admin/payments` refunds section, dialog, home and attention hrefs; parser and render tests.
- [x] Customer screens (`frontend-design` first): refunded card, purchase chip; tests.
- [x] **After 4.3 is merged and `origin/main` merged in:** `app/admin/(shell)/customers/[id]/` section `זיכויים והחזרים` (`frontend-design` first); parser and render tests.
- [ ] Docs -- `deferred-work.md` (2.2 and 4.12 items stay open for voiding with a note; new item: parked purchase in a cancelled session → 3.13), `completion-plan-2026-10-10.md`, `tickets.toml` id 9 done in the PR.

**Acceptance Criteria:**
- Given an open request, when Tal opens the home or "לטיפול", then one tap reaches the request with its complete button.
- Given a customer card with a credit and a refund, when Tal opens it, then both show with their status.

## Implementation Notes

- 2026-10-13: `origin/main` merged (includes 3.5 and 3.8). The customer-card task waits for 4.3 (user decision); do not touch `app/admin/(shell)/customers/[id]/`. Migrations are written with `npx supabase migration new` but not applied: `apply_migration` via MCP is declined, the user runs them in the SQL Editor. Until then DB tests may run the migration SQL inside each rolled-back test through a temporary hook in `supabase/tests/support/db.ts` (as in 3.8; restore the file afterwards), and `database.types.ts` is hand-edited. Build each redefinition from the live `pg_get_functiondef` (MCP `execute_sql`, read-only) and the live type check.

- 2026-10-13 (implementation): migrations `20261013215828_refund_completed_type.sql` (type check, user runs first) and `20261013215833_refund_completion.sql` (column, check, template, RPCs, redefinitions; also drops/adds `refund_requests_completion_check`, so the user runs it too). Not applied. Additions beyond the text: the plan also returns `today` (the local day, the date field's default and max; AD-8) and a missing request is `NOT_FOUND`; `refunded_on` before `paid_on` is checked after the plan (it needs the payment). `database.types.ts` hand-edited (regenerate after apply). DB tests ran with a temporary hook in `supabase/tests/support/db.ts` (removed). The refunds section sits under "הוספת תשלום" and the links link, above the payments list. Customer card section not built (waits for 4.3). `tickets.toml` id 9 left for the PR.

- 2026-10-14 (customer card): section `זיכויים והחזרים` (`card-credits`) after the balances, before the history links, untouched 2.8 account section. `credit-items.ts` (parser, chip and line; extra chip tones: active/refunded success, requested pending, pending choice warning, used expired), `credits-section.tsx` (muted plates like the single plates, a `ResultNoticeHost` around the list so "ההחזר נרשם" survives the refresh, `RefundComplete` from the payments folder on an open request), `loadCredits` in `load-card.ts`. A couple credit adds "· זוגי" to its title.

- 2026-10-14, applied and checked: the user ran `20261013215828`, `20261013215833` and `20261014114926` in the SQL Editor; all registered in `schema_migrations`. Advisors: only approved WARNs. `database.types.ts` regenerated (review-round-1 migration changes no signature). Full `test:db`: only `content.test.ts` fails (dev now has a second card product; unrelated). Local check by the user: home, "לטיפול" (the home cube shows the 3 newest items, so older requests sit in the full list), payments section, dialog, ₪500 refused, partial ₪100, customer card, customer "הוחזר" card and notification.
- 2026-10-14, audit log wording (user decisions during the local check, beyond the story): a change shows only the value after the action (`{שדה}: {ערך}`, no arrow and no old value; a removed value shows "—"); code values read per table (`adminCopy.audit.valuesByEntity`: events, bookings, entitlements, payments, credits, refund requests), e.g. a refund request "הוחזר" and a partial amount "100 ₪ מתוך 128 ₪" (`toChange`, `refund_requests.amount_agorot` lower than before); time fields read "מועד …"; a few action names tightened.

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-14):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. intent_gap 2 (decided by the user without a revert: unhandled cases, no code built on a wrong assumption), medium 3, low 6, false 1.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind, edge | `refund_completed` opens `/me/bookings` after the 14-day card is gone (back-dated or late bind) | medium | intent_gap → decided | user: target the purchase page; new migration |
| 2 | blind, intent | A completed refund of an unbound purchase shows on no admin screen | medium | intent_gap → decided | user: list it in the payments section |
| 3 | edge | A refusal (already completed elsewhere, not found) vanishes: `router.refresh()` unmounts the row | medium | patch | same as 3.8 #4/#5; no refresh on refusal |
| 4 | vgap | Audit row of `admin_complete_refund` shows raw `refunded_on`, `completed_at`, `requested` | low | patch | labels in `audit.fields`/`values.status`, keys in `audit-data.test.ts` |
| 5 | vgap | `/me/bookings` never rendered with a refunded credit | medium | patch | `bookings-list.test.tsx` case |
| 6 | blind | No DB test for `NOT_FOUND` and for the new completion check | low | patch | add tests |
| 7 | blind | Customer card awaits credits after the card (serial round-trip) | low | patch | `Promise.all` |
| 8 | blind | Dead branch, copy and comments from before the 2026-10-14 "open only" decision | low | patch | remove or reword (completed rows return with #2) |
| 9 | vgap | `CONCURRENT_CHANGE` (bind between the unlocked read and the locks) untested | medium | defer | needs a paused committing bind, like 3.8 #19 |

Rejected: per-payment vs per-right ceiling (one entitlement per payment, `payment_id` unique); `refunded_on` before the request day and the 0/max-0 cases (no flow creates them); anchor inside `Suspense` (false: the user checked the link lands on the row); stale link without a message, malformed refund shown as active, section failure takes the page, default `min(requested, max)`, untested dialog interactions and `pendingJoin` text (low); push vs in-app (user decision); spec bookkeeping (spec edit).

## Design Notes

`amount_agorot` becomes the refunded amount on completion (the requested amount stays in the audit `before`), so `admin_get_home` and 4.4's export read one column. The ceiling is per payment, not per request, so two cancelled entries of one purchase cannot refund more than it cost; locking the payment row serializes them. A new list RPC for the card (not `admin_get_customer`) avoids a collision with 2.8.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` -- pass.
- After apply: `get_advisors` (only approved WARNs), full `npm run test:db`, `npm run demo:seed` -- pass.

**Manual checks (if no CLI):**
- Phone: open request seen on the home, in "לטיפול" and in the list; completion updates the home totals; above-paid refused; customer sees "הוחזר" only after, with a notification; customer card shows the credit and the refund.
