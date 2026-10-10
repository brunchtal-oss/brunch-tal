---
title: 'Cancellation credits, alternatives and refund requests (3.7)'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '2490d9827df9467b10ff316a46c6307ff17b9093'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/cancellation-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A cancelled pinned booking (single, intro, couple) becomes a regular entitlement (3.6 demo stopgap). Source §6 requires a refund-or-credit choice, a credit for alternative sessions, and refund requests Tal sees.

**Approach:** One migration adds `cancellation_credits`, `credit_options`, `refund_requests` and redefines cancel, funding, booking, bind, completion and admin-home functions: a cancelled pinned booking always becomes a credit; a refund is a credit row with an open request. Customer screens show the choice and the credit's options; the admin home and "לטיפול" show open requests.

**User decisions (2026-10-10):**
- 3.7 replaces the 3.6 stopgap, per the source.
- Existing 3.6 "returned" entitlements stay as regular entitlements (dev has one, Maya's demo cancel) and cancel like a card (`release`). Removed: trigger `events_refresh_returned`, `private.refresh_returned_entitlements`, `private.return_pinned_entitlement`, `private.returned_expiry`, `entitlements_awaiting_sessions_idx`, `get_my_entitlements.awaiting_sessions`/`returned`, the "ממתינה למפגשים הבאים" UI.
- Templates: `booking_cancelled_pinned` now means "credit" (also a second cancel of a credit-funded booking): title `ההרשמה ל{date} בוטלה`, body `קיבלת זיכוי להרשמה לאחד המפגשים המתאימים הבאים. אפשר לבחור מפגש בהרשמות שלך`. New `booking_cancelled_refund`: title `ההרשמה ל{date} בוטלה`, body `בקשת ההחזר התקבלה. נעדכן אותך כשההחזר יבוצע`. `allowed_vars` of both: `['date']`.
- Tal cancelling a pinned booking 48h or more before the session chooses refund or credit; inside the window it is a credit.

## Boundaries & Constraints

**Always:**
- **Tables.** `cancellation_credits(id, customer_id null, origin_booking_id unique, source_entitlement_id, event_kind, party_size, options_count, origin_starts_at, original_cancelled_at, monetary_basis_agorot int >= 0, status in ('active','used','refund_requested','refunded'), choice_pending bool default false, created_at)`. `credit_options(id, credit_id, event_id, state in ('active','used','passed','replaced'), assigned_at, replaced_at, replaced_reason in ('full','event_cancelled'), unique(credit_id, event_id))`. `refund_requests(id, customer_id null, credit_id unique, payment_id, booking_id, amount_agorot, status in ('requested','completed'), requested_at, completed_at, reference, handled_by)`, completion fields null while `requested`. FK `booking_allocations.credit_id` → credits. RLS select: own rows via `(select private.current_customer_id())` (options through their credit), admin via `(select private.is_admin())`; indexes on policy/FK columns; explicit grants, select only, none to `anon`.
- **Cancel outcome** (`cancel_core`, one transaction). Card or returned entitlement → `release`, as today. Pinned → no `release`; a `use` movement (units 0, `booking_id`) closes the reserve; a credit with `options_count = greatest(credit_options_count,1)` read now, `origin_starts_at` = the session's `starts_at`, `monetary_basis_agorot = private.monetary_basis(booking_id)` (once, AD-20, integer); then options fill. Choice `refund` → credit `refund_requested` + `refund_requests` row (`amount_agorot` = basis, `requested`), no options. Credit-funded → the same credit is usable again: its `used` option back to `active`, then refresh; never a new cycle. Returns `{booking_id, outcome: 'card'|'credit'|'refund', entitlement_id?, credit_id?, refund_request_id?}`. Notification `booking_cancelled` / `booking_cancelled_pinned` / `booking_cancelled_refund`, vars `{date}` only, discriminator = audit id, target `/me/bookings`, none for a null customer.
- **Choice.** `cancel_booking(p_choice)`: pinned-funded → `p_choice in ('refund','credit')` required; card-, returned- or credit-funded → must be null; otherwise `INVALID_INPUT` (detail `choice`). `admin_cancel_booking` gets `p_choice text default null` (new signature, old one dropped): pinned-funded and `can_self_cancel` true → choice required; else must be null and pinned → credit. `plan_admin_cancel_booking` returns `choice_required`. `needs_manual_cancel` flags only mixed entitlement kinds, not a credit allocation.
- **`private.refresh_credit_options(credit_id)`** (idempotent, exempt from idempotency, AD-5) runs only for `status='active'`, not `choice_pending`, with no `confirmed` booking funded by the credit. (1) Active option whose event is `cancelled` → `replaced/event_cancelled`; whose `registration_closes_at <= now()` → `passed`; without room for `party_size` → `replaced/full`. (2) While options in (`active`,`used`,`passed`) < `options_count`, add the next `published` event (`starts_at, id`): `kind = event_kind`, `starts_at > origin_starts_at`, registration open, room for `party_size`, not the origin, not already an option in any state, not booked by her (`confirmed`). Fewer found → the credit waits.
- **Refresh callers.** Owner paths (booking RPCs, cancel, `get_my_credits`, previews) lock and refresh her credits. `book_core`, `cancel_core` and a capacity change in `admin_update_event` call `private.refresh_credits_for_event(event_id)`: credits with an active option there, or with unfilled slots and the same `event_kind`, `for update skip locked`.
- **Locks (AD-6).** `book_session`, `book_sessions`, `admin_book_customer`: profile → event(s) → her active entitlements by id → her active credits by id → refresh → `plan_funding` → recheck. Cancel: profile → event → booking → allocation entitlements → allocation credit → `cancel_core`.
- **Funding (AD-18).** `plan_funding`, every mode, first takes an active, unreserved, not `choice_pending` credit with matching `party_size` whose `active` option is this event (`created_at, id`); then entitlements as today. Source `{kind: 'credit', id, units: 1}`. `book_core`: allocation with `credit_id`, option → `used`, no movement.
- **Elsewhere.** `bind_purchase` also moves the payment's credits (via `source_entitlement_id`) and refund requests, with audit, and sends `booking_cancelled_pinned` per moved active credit (discriminator `bind:<credit_id>`). `job_complete_events` marks a credit that funded a completed booking `used` (after entitlements, `skip locked`). Funding kinds in `get_my_bookings`/`preview_book_session`: `card`, `pinned`, `credit` (`returned` → `card`). `preview_book_sessions.available` also counts unreserved active credits. `get_my_entitlements` drops `awaiting_sessions`/`returned`, adds `credit_status` (null or the credit's status), other fields unchanged.
- **`get_my_credits()`** (`authenticated`, definer, volatile, no idempotency): locks her profile, refreshes, returns `active`, `refund_requested` and `refunded` credits: `{credit_id, status, party_size, origin_starts_at, origin_concept_name, reserved_booking: {booking_id, event_id, starts_at}|null, options: [{event_id, starts_at, concept_name, state}] (active, used), waiting, refund: {amount_agorot, status, requested_at}|null}`.
- **Admin home** (extend the latest versions, keep every field). `admin_get_home.totals` adds `refunded_count`, `refunded_agorot` (completed, `completed_at` in the local month); `net_agorot = approved_agorot - refunded_agorot`; new `open_refunds: [{refund_request_id, customer_id, customer_label, amount_agorot, requested_at, event_id, concept_name, starts_at}]`. `admin_get_attention_items` adds kind `refund_requested` with `{customer_id, amount_agorot, event_id, concept_name, starts_at}`. No "בוצע" or "הוחזר" before 3.9.
- **Screen copy (verbatim).** Customer cancel sheet, pinned: options `זיכוי למפגש אחר` (`אפשר להירשם לאחד מ-{n} המפגשים המתאימים הבאים`) and `החזר כספי` (`בקשת ההחזר תגיע אלינו, ונעדכן כשההחזר יבוצע`); "כן, לבטל" disabled until one is chosen. Done: `ההרשמה בוטלה. הזיכוי מחכה לך בהרשמות שלך` / `ההרשמה בוטלה. בקשת ההחזר התקבלה`. Credit-funded: `הזיכוי יחזור אלייך עם אותן חלופות`. `/me/bookings` credit card: `זיכוי מהמפגש ב-{date}`, `אפשר להירשם לאחד מהמפגשים האלה:` + option cards to `/me/sessions/[id]`; waiting: `המפגשים המתאימים הבאים יופיעו כאן כשיתפרסמו`. Refund card: `בקשת החזר של {amount} התקבלה`, `נעדכן אותך כשההחזר יבוצע`. Home line `יש לך זיכוי להרשמה` → `/me/bookings`. Purchases chip `הומרה לזיכוי` / `בקשת החזר`. Admin cancel dialog: choice `זיכוי למפגשים חלופיים` / `החזר כספי` when required; impact `ייווצר ללקוחה זיכוי ל-{n} מפגשים חלופיים` / `תיפתח בקשת החזר של {amount}` / `הזיכוי יחזור ללקוחה עם אותן חלופות`. Admin home: section `בקשות החזר פתוחות` (row `{customer} · {amount} · בראנץ׳ {concept} {date}` → customer card), totals line `החזרים שבוצעו ({n})` always shown, attention item `{customer} ביקשה החזר של {amount} על בראנץ׳ {concept} {date}`. No "טל" in customer copy; contact is "צרי קשר".
- Error codes only in `lib/errors.ts`; copy in `lib/copy/customer.ts`, `lib/copy/admin.ts`. Screens start with the `frontend-design` skill within DESIGN.md and EXPERIENCE.md.
- **Migration timing.** Not applied before Tuesday 2026-10-13. Until then the SQL is a draft and `database.types.ts` is hand-edited. Tuesday: `npx supabase migration new`, each redefinition re-based on `pg_get_functiondef` of the live DB, apply via MCP, `get_advisors`, regenerate types, full `npm run test:db`, `npm run demo:seed`.

**Never:** business-side session cancel, `choice_pending` flow, `choose_credit_outcome` (3.8); completing a refund, "הוחזר" (3.9); moving a booking (3.10); Tal changing options or extending a credit (3.16); scheduled `job_refresh_credit_options` (5.10); waitlist (5.6); couple offset (cancelled 2026-10-10); credits or refunds in the admin customer card (3.9/3.16).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sunday cancel of Thursday | Pinned single on Thursday; matching sessions that Monday, next Sunday, next Monday | Options = next Sunday and next Monday, never the earlier Monday | — |
| Choice credit | Pinned, 72h before, `credit` | Credit `active`, 2 options, entitlement available 0 / used 1, place freed, one `booking_cancelled_pinned` | — |
| Choice refund | Pinned, 72h before, `refund` | Credit `refund_requested`, no options, request `requested` with amount = paid, one `booking_cancelled_refund` | — |
| No choice on pinned | Pinned, `p_choice` null | Nothing changes | `INVALID_INPUT` |
| Choice on card | Card booking, `credit` | Nothing changes | `INVALID_INPUT` |
| Admin inside window | Pinned, 24h before, Tal confirms | Credit | — |
| Admin outside window | Pinned, 72h before, Tal chooses `refund` / no choice | Refund request / nothing changes | — / `INVALID_INPUT` |
| Option fills | Option A full after another customer books | A → `replaced/full`, next matching session added | — |
| Backward change | A replaced, then a place frees in A | A stays replaced | — |
| No future sessions | None matching | Credit waiting, 0 options; after a session is published, her next view shows it | — |
| She fills the last place | Books option A with the credit, A becomes full | A `used`, no new option, no extension | — |
| Second cancel | She cancels the credit-funded booking ≥48h | Same credit and options (A back to `active`), no new cycle | `p_choice` must be null |
| Option passed | 2 options; the first one's registration closes unused | First `passed`, still counts; no third added | — |
| Option cancelled by the business | An active option's event becomes `cancelled` | `replaced/event_cancelled`, next matching session added | — |
| Settings change | `credit_options_count` 2→3 after the credit exists | Existing credit keeps 2 | — |
| Unbound seat | Pinned booking, null customer, Tal cancels; later bind | Credit, no notification; bind moves it and sends `booking_cancelled_pinned` | — |
| Completion | Credit-funded booking, session ends | Booking `completed`, credit `used` | — |
| Card unchanged | Card booking cancelled | `release` to the same card | — |
| Idempotent | Same key twice | Same result, one credit | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261005232647_cancel_booking.sql` -- `booking_funding` (`:269`), `needs_manual_cancel` (`:295`), `cancel_core` (`:326`), `cancel_booking` (`:550`, choice refusal `:581`), `admin_cancel_booking`/preview (`:639-769`), `get_my_entitlements` (`:987`), trigger (`:247-263`), index (`:49`), templates (`:35-46`).
- `20261006001058_cancel_booking_review_fixes.sql` -- `returned_expiry` (`:25`), `return_pinned_entitlement` (`:98`), `refresh_returned_entitlements` (`:153`), `plan_admin_cancel_booking` (`:206`), `get_my_bookings` (`:291`).
- `20261004212706_pinned_product_approval.sql:476` `plan_funding`; `20261004191220_bookings_review_fixes.sql:10` `book_core` (credit placeholder `:71-79`); `20261005171826_multi_date_booking.sql` `book_session` (`:20`, party from kind `:78`), `book_sessions` (`:132`); `20261005193624_*:118,233` `admin_book_customer` + preview; `20261006111121_*:143` `preview_book_session`; `20261005234204_*` `preview_book_sessions`.
- `20261004221450_*:216` `bind_purchase`; `20261006142736_*:17` `job_complete_events` (skips credits via `entitlement_id is not null`); `20261005111717_*:114` `admin_update_event` (capacity `:181`).
- `20261006215608_*:661` `admin_get_home` (`net_agorot` `:752`); `20261006184326_*:484` `admin_get_attention_items`.
- `20261001162630_create_money_schema.sql` -- products, payments, entitlements (`payment_id` unique; `party_size` in `eligibility_snapshot`), movements, `credit_options_count`. `20261003141504` `entitlement_balances` (`use` turns a reserve into used). `20261006183915_*:24-66` `allowed_vars`, sample vars. `20261005231322_*` type check. `20261004183409_*:73-110` `booking_allocations`.
- Tests: `supabase/tests/cancel-booking.test.ts` (pinned/returned `:640-844`, choice `:427`), `bind-purchase.test.ts` (`BOUND` `:64`), `admin-home.test.ts`, `session-completion.test.ts`, `settings-and-templates.test.ts` (count `:640,668`, `fillAllFields` `:672`, flows `:686-734`), `grants.test.ts` (one function per name `:331`), `my-entitlements.test.ts`; `support/db.ts`, `support/money.ts`.
- UI: `app/me/bookings/{page.tsx,cancel-booking.tsx,cancel-result.ts,actions.ts}`; `app/me/sessions/[id]/{booking-panel.tsx,booking-preview.ts}`; `app/me/home.tsx:129-150`, `app/me/purchase-items.ts:35-39,159`, `app/me/purchases/page.tsx:59`, `app/me/purchases/[id]/page.tsx:124`, `components/customer/{balance-card,purchase-row}.tsx`; `app/admin/(shell)/sessions/[id]/{attendee-cancel.tsx,cancel-plan.ts,actions.ts}`; `app/admin/(shell)/{page.tsx,home-items.ts,home/month-totals.tsx,home/attention-list.tsx}`; `lib/copy/customer.ts:182-223`, `lib/copy/admin.ts:616-639,746-840,1081`, `lib/errors.ts`.
- `scripts/demo-seed.mjs:652-670` -- Maya's cancel, no `p_choice`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/drafts/3-7-cancellation-credits.sql` -- the full migration (tables, RLS, grants, helpers, redefinitions, templates). Moved into `migration new` on Tuesday; the main session deletes the draft.
- [ ] `supabase/drafts/3-7-type-and-drops.sql` -- **main session; the user runs it in the SQL Editor first:** type check with `booking_cancelled_refund`; drop the trigger, the three returned helpers, the index and the old `admin_cancel_booking` signature. Registered in `schema_migrations`.
- [ ] `lib/supabase/database.types.ts` -- hand-edited now, regenerated Tuesday.
- [ ] `supabase/tests/cancellation-credits.test.ts` -- every matrix row. Update `cancel-booking.test.ts` (pinned/returned and choice), `bind-purchase.test.ts` (`BOUND` + move test), `session-completion.test.ts` (credit `used`), `admin-home.test.ts` (totals, `open_refunds`, item), `settings-and-templates.test.ts` (15 templates, `fillAllFields` real flows for credit and refund), `my-entitlements.test.ts`, `grants.test.ts`.
- [ ] `lib/errors.ts`, `lib/copy/customer.ts`, `lib/copy/admin.ts` -- copy above, template label `booking_cancelled_refund`, remove awaiting/returned copy.
- [ ] `app/me/bookings/*` -- choice in the cancel sheet (`frontend-design` first), action passes `choice`, credit and refund cards via `get_my_credits`; tests.
- [ ] `app/me/sessions/[id]/*`, `app/me/home.tsx`, `app/me/purchase-items.ts`, `app/me/purchases/*`, `components/customer/*` -- `credit` funding, home line, purchases chip, remove awaiting; tests.
- [ ] `app/admin/(shell)/sessions/[id]/*`, `app/admin/(shell)/home-items.ts`, `home/*`, `page.tsx` -- choice and outcome in the cancel dialog, refunds line, open refunds section, attention item; tests.
- [ ] `scripts/demo-seed.mjs` -- Maya cancels with `p_choice: 'credit'`.
- [ ] Docs -- SPEC `.memlog.md` (stopgap replaced; refund = credit row; option passes at registration close; Tal's choice outside the window), `completion-plan-2026-10-10.md`, `deferred-work.md` (close the 2.12/3.6, 4.1 and 3.12 items), `tickets.toml` id 7 done in the PR.

**Acceptance Criteria:**
- Given a credit, when she opens `/me/bookings`, then she sees its active options and can book one, and the booking sheet says it uses the credit.
- Given an open refund request, when Tal opens the admin home, then it shows under "בקשות החזר פתוחות" and in "לטיפול", and the month totals are unchanged until 3.9.

## Design Notes

A refund is a credit row in `refund_requested`, so the monetary basis, the bind move and 3.8's `choice_pending` share one shape; 3.9 sets `refunded`. An option passes at registration close, since she cannot use it herself after that. Non-owner refreshes skip locked rows: the owner's next view or booking refreshes again, and no wait can form a cycle across customers.

## Implementation Notes

- Implementer additions: `drop` of the old `private.cancel_core` signature (p_choice added); `scripts/demo-clear*` also clears credits, options and refund requests; admin label copy `צריך לבחור זיכוי או החזר כספי כדי להמשיך`; template labels `ביטול הרשמה עם זיכוי` / `ביטול הרשמה עם בקשת החזר`. DB tests ran against the drafts inside rolled-back transactions (temporary hook, `support/db.ts` restored); the committing "locked session" test of `session-completion` was not verified against the drafts.
- Review round 1: non-owner refresh (`refresh_credits_for_event`) only changes option states and never inserts options, because inserting an option takes a key-share lock on that session and could deadlock with the owner's booking; options are filled only on the owner's paths. An option on a session she already booked becomes `replaced/booked`. Exhausted credit (user decision 2026-10-10): muted card `זיכוי מהמפגש ב-{date}` / `המפגשים החלופיים עברו בלי הרשמה. אפשר לפנות אלינו` + "צרי קשר", no home line. `credit_expiring` is added to the type check for 5.10 (user decision 2026-10-10: alert 5 days before the credit's last option closes).
- Applied and merged on 2026-10-10 (user decision), not on Tuesday: migrations `20261010141237_cancellation_credits_type_and_drops` and `20261010141240_cancellation_credits` run by the user in the SQL Editor in one transaction, then `20261010184900_credit_funds_origin_session`; all registered in `schema_migrations`; advisors clean; full `test:db` 860/860. `demo:seed` was not re-run: its state file is gone, and the planned `demo:clear` + `demo:seed` on Monday 2026-10-12 runs it with this code.
- Phone test (user decisions 2026-10-10, SPEC memlog): a credit also funds a new booking of its own cancelled session (overrides source §6; migration `20261010184900`); the customer home always ends with "לכל ההרשמות שלי" and shows "בקשת ההחזר שלך התקבלה" while a refund is open; a cancelled booking in the purchase history reads "ביטלת" (never "השתתפת"); the home card bar is used (dark) → booked (light) → free (grey), legend booked and used only.
- Planned earlier: run the drops file and the main migration back to back; if the main one fails, restore by re-running the 3.6 definitions from `20261005232647`/`20261006001058` (or run both inside one `begin … commit` in the SQL Editor and register both).

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-10):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. high 1, medium 7, low 12, false 1. No intent_gap or bad_spec after the user's answer on the exhausted credit.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | verification-gap | `preview_admin_book_customer` returns a credit source without `expires_on`; `parseBookPreview` → SERVER_ERROR, Tal cannot book a customer into her credit's option | high | patch | `book/preview.ts:24-46` requires `expires_on`; parser + unit and DB tests |
| 2 | edge, verification-gap | No-Tal regex lost `\s` in `cancel-result.test.ts:50` | medium | patch | file shows `[s"(]`; restore |
| 3 | blind, edge | Option on a session she already booked stays active (two credits sharing it; unbound credit moved by bind) | medium | patch | step (1) has no such case; `replaced/booked` + refresh in bind, tests |
| 4 | edge | Deadlock: non-owner refresh inserts an option (key-share on the session) while the owner holds it and waits on her credit | medium | patch | fill only on owner paths |
| 5 | blind, edge | Credit with all options passed shows "waiting" and the home line forever | medium | patch | user decision: `exhausted` + muted card with contact |
| 6 | blind, intent | Refund requested on an unbound seat is never notified at bind | low | patch | bind sends only for `active`; also `booking_cancelled_refund` |
| 7 | blind, edge | `preview_book_sessions.available` counts credits for sessions they cannot fund | low | patch | count a credit only for its active options among the items |
| 8 | blind | Idempotency key not renewed when the choice (or Tal's reason) changes | low | patch | project rule "one key per form load or change" |
| 9 | verification-gap | No test: credit already funding a booking does not fund a second | medium | patch | add test |
| 10 | verification-gap | No test: fill skips a session she is booked to | medium | patch | add test (with #3) |
| 11 | verification-gap | No visibility test for `refund_requests`; no admin cancel of a credit-funded booking | low | patch | add tests |
| 12 | intent | No render tests for the choice sheet, credit/refund cards, open refunds | low | patch | `renderToStaticMarkup` tests |
| 13 | blind | Changing a session's date/time does not refresh credits; an option can move before the origin | medium | defer | session changes with options belong to 3.8 (event_changed) |
| 14 | verification-gap | `CREDIT_LOCKED` path of `job_complete_events` untested | low | defer | needs two committing connections |
| 15 | blind | Drops file runs separately; a failed main migration leaves no cancel | medium | patch | Tuesday procedure in Implementation Notes |

Rejected: cancel_core with a null credit (false: `booking_funding` says credit only when the allocation has `credit_id`); dialog open across the 48h boundary (low, rare, needs a new code); customer sheet imports `components/admin/radio-card` (low, a move); repeated refresh per date in `preview_book_sessions` (low, few dates); read pages lock (by design, AD-14) and home parallel vs sequential reads (low); ₪0 fallback for a malformed amount (low, parser already rejects); Prettier-only lines in `demo-clear.mjs` (format:check); `starts_at > origin_starts_at` vs "after the date" (AD-14 says after `starts_at`); drafts not applied and screens wired to missing RPCs (by plan, Tuesday).

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` -- pass before review.
- Tuesday after apply: `get_advisors` (only approved WARNs), `npm run test:db` (all files), `npm run demo:seed` -- pass.

**Manual checks (if no CLI):**
- Phone (Tuesday): pinned cancel >48h shows the choice and two options; Tal's cancel <48h creates a credit; a refund request shows on the admin home and in "לטיפול"; a card still returns to the same card.
