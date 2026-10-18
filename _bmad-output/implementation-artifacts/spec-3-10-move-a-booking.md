---
title: 'Story 3.10: move a booking'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'ac81ca96c7c422c519a18541f0c5b2b152c32733'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A customer who cannot make her session must cancel and book again, and Tal has no way to move a registrant. Source §6: a move is a cancel plus a new booking in one atomic transaction; the target's place and right are checked first, and a failure leaves the original booking exactly as it was.

**Approach:** `move_booking` (customer, only while `can_self_cancel`) and `admin_move_booking` (Tal, any time, sensitive) run the existing `private.cancel_core` and `private.book_core` in one transaction, funding the target from the same source as the original. Previews list the allowed targets. One `booking_moved` notification replaces the cancel and confirm notifications.

## Boundaries & Constraints

**Always:**
- Locks (AD-6): customer's `profiles` row; both events by id ascending; the original booking (re-read, else `CONCURRENT_CHANGE`); its entitlements, then its credits, by id. All before any plan or core call.
- Before any write, `private.plan_move` checks the target; any failure raises and nothing changes.
- Target, common: published; same `kind` as the original session; not the original session; she has no confirmed booking there; `occupied_places + party_size <= capacity_adults`. Customer: `clock_timestamp() < registration_closes_at`. Tal: `ends_at > clock_timestamp()`.
- Funding is the original's source, never a new one (a move grants no extra entry):
  - **card** (incl. 3.6 leftover regular entitlements): the same entitlement(s) and units. Each must fit the target as in `plan_funding` step (2) (active, `eligible_event_kind`, weekdays, no card for a couple session, `valid_from <= day <= expires_on`), but not the balance check, since its own reserve comes back. `expires_on` already includes any extension (memlog 2026-10-05). Same rule for Tal.
  - **pinned** (single, intro, couple): `cancel_core` with choice `credit`, then the new credit funds the target. Customer: the target must be one of that credit's active options after the cancel (the first N per `refresh_credit_options` rule (2), counted from the original session). Tal: any matching target (USER 2026-10-18). If it is not an option, an active `credit_options` row is inserted for it before `book_core`.
  - **credit-funded**: the same credit. Customer: one of its active options. Tal: any matching target, via the same option insert.
- After `book_core`: the new booking gets the original's `policy_snapshot` and `guest_details`; the original gets `moved_to_booking_id`.
- `cancel_core` and `book_core` keep their signatures. When `p_action` is `move_booking` or `admin_move_booking`, they skip their own notifications. The move enqueues one `booking_moved` (discriminator: the new booking id).
- Audit: `cancel_core`/`book_core` rows carry the move action; the move adds one `bookings` row for the original (before/after).
- A moved pinned booking is credit-funded. A later cancel returns the same credit, never money (source §6; USER 2026-10-18). Tal's refund override belongs to 3.16.
- Reminder: the new booking id gets its own reminder (AD-13). A move into the lead window sends none; `booking_moved` carries the date and time (USER 2026-10-18).
- Customer UI: "הזזה" sits next to "ביטול" on the session page only (USER 2026-10-18; not on home or /me/bookings). Past the window, tapping either shows the same closed notice with "צרי קשר" (no "טל").

**Never:** change `plan_funding` (signature or behavior; 3.19 calls it in `admin` mode); refund choice on a move; moving a booking without a customer (`customer_id is null`) or one with `needs_manual_cancel`; Tal's credit changes or refund-instead-of-credit (3.16); entitlement corrections (3.13); waitlist (5.6); session delete (3.17).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Card move | card, 2 free; booked A, moves to B in validity | A cancelled with `moved_to_booking_id`; B confirmed on the same card; balance still 2 free; one `booking_moved` | — |
| Target full | B has no room | nothing changes; A confirmed, same allocations and movements | `EVENT_FULL` |
| Card outside validity | B after `expires_on` | unchanged | `ENTITLEMENT_EXPIRED_ON_DATE` |
| Pinned, customer | single on A, B is one of the first N after A | A cancelled, credit active, B funded by it, option B `used`; no refund request | — |
| Pinned, not an option | customer picks C, not in the first N | unchanged | `MOVE_TARGET_NOT_ALLOWED` |
| Pinned, Tal | Tal moves to C (not an option) | A cancelled, credit active, option C inserted and `used`, C funded by the credit | — |
| Couple | pinned couple, target couple with 1 place | unchanged | `EVENT_FULL` |
| Couple ok | 2 places | `party_size` 2 and `guest_details` copied | — |
| Inside 48h | customer, `can_self_cancel` false | unchanged | `SELF_CANCEL_CLOSED` |
| Tal inside 48h | same booking | moves | — |
| Same / booked | target = A, or already booked there | unchanged | `MOVE_TARGET_NOT_ALLOWED` / `ALREADY_BOOKED` |
| Not movable | `customer_id is null` or offset couple | unchanged | `BOOKING_NOT_MOVABLE` / `MANUAL_HANDLING_REQUIRED` |
| Repeat key | same idempotency key | previous result | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- live bodies to redefine from: `cancel_core` (20261013162639_business_cancel_event.sql), `book_core` (20261010184900_credit_funds_origin_session.sql), `get_my_bookings` (20261013161248_couple_and_intro.sql). Reuse unchanged: `can_self_cancel`, `booking_funding`, `needs_manual_cancel`, `refresh_customer_credits`, `refresh_credit_options`, `occupied_places`, `format_day_month`, `idempotent_begin/finish`, `audit`, `enqueue_notification`. Type-check pattern: 20261013215828_refund_completed_type.sql; template row: 20261013215833_refund_completion.sql:63.
- `public.cancel_booking` / `admin_cancel_booking` -- lock and recheck pattern to copy. `notify_booking_confirmed` -- target path and vars to copy for `booking_moved`.
- `app/me/bookings/cancel-booking.tsx` -- `CancelBooking` sheet, closed notice, `PinnedCancelChoice` radio-cards; `app/me/sessions/[id]/booking-panel.tsx:101` renders it in the `booked` branch; `app/me/bookings/actions.ts` and `cancel-result.ts` -- action and parse pattern.
- `app/me/sessions/select/selection.ts` -- session-row pattern for the target list.
- `app/me/bookings/bookings-list.tsx` -- `pastBookingStatus` (:188) for the moved label.
- `app/admin/(shell)/sessions/[id]/attendee-list.tsx:42`, `attendee-cancel.tsx`, `actions.ts`, `cancel-plan.ts` -- row action and preview/confirm pattern. `lib/admin/sensitive-actions.ts`, `components/admin/sensitive-confirm-dialog.tsx`.
- `lib/errors.ts`, `lib/copy/customer.ts` (`cancel` :223), `lib/copy/admin.ts` (`sessions` :602, templates `types` ~:1335, audit actions ~:1755).
- Tests: `supabase/tests/cancel-booking.test.ts` (`seed`, `insertEvent`, `grant`, `book`), `couple-and-intro.test.ts` (`pinned`), `cancellation-credits.test.ts` (`options`, `creditsOf`), `session-reminders.test.ts:470` (template-edit pattern), `settings-and-templates.test.ts:625` (count 17), `grants.test.ts` (`EXPECTED_GRANTS`).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_booking_moved_type.sql` -- drop/re-add `notification_templates_type_check` with `booking_moved` (keep all current types; if 3.13 merged first, include its types); insert the template: title `ההרשמה הועברה`, body `מ-{from_date} ל-{date} · {time} · בראנץ׳ {concept}`, `allowed_vars` `[from_date, date, time, concept]`. Add `bookings.moved_to_booking_id uuid null references bookings(id) on delete restrict` and a partial index on it. Session main: the user runs it in the SQL Editor.
- [ ] `supabase/migrations/<ts>_move_booking.sql` -- `private.plan_move(p_booking_id, p_target_event_id, p_actor_kind)` (null target returns the target list `[{event_id, starts_at, concept_name, outside_options}]`). `preview_move_booking(p_booking_id)` (customer, own booking, refreshes credits, returns `can_move`, `funding`, `targets`). `preview_admin_move_booking(p_booking_id)` (admin, adds customer name). `move_booking(p_booking_id, p_target_event_id, p_idempotency_key)`. `admin_move_booking(p_booking_id, p_target_event_id, p_confirmed, p_idempotency_key, p_reason default null)` (`CONFIRM_REQUIRED`). Each returns `{booking_id, from_booking_id}`. Redefine `cancel_core` and `book_core` (skip notify on the move actions) and `get_my_bookings` (past rows add `moved_to_starts_at`). Grants per AD-5.
- [ ] `supabase/tests/move-booking.test.ts` -- every matrix row, plus: lock-order deadlock-free with a parallel `admin_cancel_booking`; a customer calling the admin RPCs gets `NOT_AUTHORIZED`; the reminder goes to the new booking's session, not the old one; the edited `booking_moved` template renders all four vars in a real move.
- [ ] `supabase/tests/grants.test.ts`, `settings-and-templates.test.ts` -- new functions; 18 templates and the admin type name.
- [ ] `lib/errors.ts` -- `MOVE_TARGET_NOT_ALLOWED`: `אי אפשר לעבור למפגש הזה`; `BOOKING_NOT_MOVABLE`: `אי אפשר להזיז את ההרשמה הזו`.
- [ ] `app/me/bookings/move-booking.tsx`, `move-result.ts`, `actions.ts` -- start with the `frontend-design` skill. Button `הזזה למועד אחר` next to cancel. Sheet `לאיזה מפגש לעבור?` lists targets as radio-cards (date, time, concept). For pinned funding add the line `אחרי ההזזה, ביטול יחזיר זיכוי למפגש אחר ולא כסף.`. Confirm `כן, להזיז` is disabled until a choice is made. Empty list: `אין כרגע מפגש אחר שאפשר לעבור אליו.`. On success, go to the new session page with the notice `ההרשמה הועברה ל-{date}`. Closed copy for both buttons: `לא ניתן לבטל או להזיז עצמאית פחות מ-{n} שעות לפני המפגש.` with `צרי קשר`. Wire it in `booking-panel.tsx`.
- [ ] `app/me/bookings/bookings-list.tsx` -- a moved booking in history reads `הועברה ל-{date}`, not `בוטלה`.
- [ ] `app/admin/(shell)/sessions/[id]/attendee-move.tsx`, `move-plan.ts`, `actions.ts`, `attendee-list.tsx` -- start with `frontend-design`. Add `הזזה` beside `ביטול` on each registrant row. The target list marks a non-option as `מחוץ לחלופות הזיכוי`. `SensitiveConfirmDialog` with `booking_move: "האם להזיז את ההרשמה?"` in `sensitive-actions.ts` and an optional reason.
- [ ] `lib/copy/admin.ts` -- template type `booking_moved: "הזזת הרשמה"`; audit actions `move_booking` / `admin_move_booking`: `הזזת הרשמה`; field `moved_to_booking_id`: `הועברה להרשמה`.
- [ ] Docs (session main) -- record the 2026-10-18 user decisions in SPEC `.memlog.md` (Tal moves pinned to any matching session; no refund after a move, Tal's override in 3.16; move button placement). Add refund-instead-of-credit to 3.16 in `tickets.toml` and log it in `completion-plan-2026-10-10.md`. Add a line to the architecture `.memlog.md`: a move keeps its source and does not call `plan_funding`.

**Acceptance Criteria:**
- Given any failed move, when the RPC raises, then the original booking, allocations, movements, credits, options and notifications are byte-identical to before.
- Given a successful move, when balances are read via `get_my_entitlements` and `admin_list_open_cards`, then they agree, and the card count equals the count before.
- Given the session page inside 48 hours, when the customer taps "הזזה למועד אחר", then the closed notice with "צרי קשר" shows and no RPC is called.

## Implementation Notes

- Phone check 2026-10-18 (USER): customer `move.pinnedNote` = "לאחר שינוי התאריך, במקרה של ביטול תתאפשר קבלת זיכוי למפגש אחר בלבד, בהתאם למדיניות הביטולים, ולא החזר כספי."; Tal's dialog: `move.withinWindow(hours)` = "המפגש בעוד פחות מ־{hours} שעות, ולכן הלקוחה לא יכולה לשנות תאריך בעצמה." (hours from the booking's `policy_snapshot`, read in `previewAdminMoveAction`) and `move.pinnedNote` = "העברת ההרשמה תיחשב לביטול ושימוש בזיכוי. ביטול בהמשך יחזיר זיכוי למפגש אחר, ללא החזר כספי בהתאם למדיניות הביטולים." (pinned and credit funding; one notice box, one line each). The button under the self-service closed notice and on move refusals reads "ליצירת קשר" (`customerCopy.closedContact`); a global "צרי קשר" swap was tried and undone at the user's request. `ACCOUNT_NOT_ACTIVE` no longer names Tal ("החשבון הזה עוד לא פעיל. צרי קשר").
- `SQL Editor` trap: in PL/pgSQL a `case when … then` inside an `if/elsif` condition must be parenthesised (the first apply of 20261018075214 failed on it).

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-10-18), lenses: blind-hunter, edge-case-hunter, verification-gap, intent-alignment.** USER 2026-10-18 during triage: (z) an option Tal added outside the alternatives stays an option after a later cancel (N+1 is accepted); (h) a credit-funded booking may move back to the credit's origin session (as 3.7: a credit funds rebooking the cancelled session).

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Tal's move refusals go through `bookRefusal`, so `MANUAL_HANDLING_REQUIRED` etc. show customer copy ("צרי קשר") | medium | patch | `attendee-move.tsx:26`; add `moveRefusal` in `lib/copy/admin.ts` + unit test |
| 2 | Customer move refused with `SELF_CANCEL_CLOSED` / `MANUAL_HANDLING_REQUIRED` reads as a cancel | low | patch | `move-booking.tsx` uses `errorMessage`; move-specific copy in `customerCopy` |
| 3 | After a refusal the sheet keeps the stale list and choice | medium | patch | `move-booking.tsx:132-139` only `router.refresh()`; re-run the preview, clear the target |
| 4 | `?moved=1` notice reappears on reload/back; not announced | low | patch | `page.tsx:119`; strip the param after showing, `role="status"` |
| 5 | Credit-funded booking cannot move back to the credit's origin session (customer refused, Tal sees "outside") | medium | patch | `move_option_candidates` never adds the origin; decision (h): include it, `outside_options` false |
| 6 | New booking's snapshot/guest_details overwrite is not audited | low | patch | `move_core` after `book_core`; audit the update (before = book_core row) |
| 7 | `preview_admin_move_booking` skips `refresh_customer_credits`, so its list can differ from the move | low | patch | volatile + refresh before `plan_move` |
| 8 | Tal's dialog does not say a pinned move becomes credit-funded (later cancel = credit, no money) | low | patch | copy line in `attendee-move.tsx` for `funding = 'pinned'` |
| 9 | Admin action checks reason length before trim | low | patch | `actions.ts`; trim first, like the RPC |
| 10 | Untested: weekday card (`NO_MATCHING_ENTITLEMENT`), `REGISTRATION_CLOSED` vs Tal past close, `EVENT_ENDED`, credit-funded customer refusal, Tal reactivating a replaced option (+ audit before, + stays after later cancel per z), rule (2) fill, move back to origin (h), admin repeat key, the new audit row | medium | patch | `move-booking.test.ts` |
| 11 | Admin customer card and audit field show a moved booking as cancelled / raw UUID | low | defer | needs `admin_get_customer` change |
| 12 | "Past the window no RPC" tested only on the pure helper | low | defer | no interactive component tests in the repo; server `can_move` still guards |

Rejected: 60-target cap and empty-list reason (not met in practice); `now()` vs `clock_timestamp()` at the exact close instant (negligible, mirrors `refresh_credit_options`); "הועברה" chip gender (describes the booking, per-record wording); new booking without `payment_id` (only `bind_purchase` reads it, and a moved booking always has a customer).

## Design Notes

AD-18 names `move_booking` as a `plan_funding` caller. Source §6 ("כפוף לתוקף המקורי" / "לחלופות הזיכוי") requires the original source instead, so `plan_move` checks that source and `plan_funding` stays untouched (3.19 safe). Sequence inside the move RPC:

```
locks -> refresh_customer_credits -> plan_move(target) or raise
-> cancel_core(orig, action, choice := 'credit' if pinned)
-> [Tal, target not an active option] insert credit_options(credit, target)
-> book_core(customer, null, target, party, same sources, action)
-> copy snapshot/guest_details; set moved_to_booking_id; audit; enqueue booking_moved
```

3.17 (delete session) also locks the event, and its in-transaction "no bookings" check means a concurrent move and delete cannot both succeed.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: pass.
- `npm run test:db` (full: self-booking, multi-date, credits, cancel-booking, business-cancel, couple, session-reminders, grants, move-booking) -- expected: pass; not while the user tests on the phone.
- `get_advisors` security -- expected: only the approved WARNs.

**Manual checks:** phone: card move keeps the balance; full target fails and the original stays; pinned moves only to an alternative; couple moves with 2 places; Tal moves from the session page; the reminder follows the new session.
