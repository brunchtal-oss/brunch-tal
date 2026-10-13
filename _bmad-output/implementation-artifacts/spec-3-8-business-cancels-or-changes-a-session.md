---
title: 'Business cancels or changes a session (3.8)'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '7b9dcdeee0ae088537a475ac3baf8988751e0837'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/cancellation-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal cannot cancel a whole session, and `admin_update_event` refuses a time change once anyone is booked (`EVENT_HAS_BOOKINGS`, 3.2 stopgap). Source §6/§7: on a business cancel a card entry returns to the card and a single/couple entry gets a refund-or-credit choice with no deadline; Tal sees in advance who may be stuck with an unusable entitlement; a session is never moved silently.

**Approach:** Two sensitive actions, one plan each (AD-7): cancel a session, change its time. Each previews the impact and the template text, Tal edits the body, and the action sends one `event_cancelled`/`event_changed` per customer. A business cancel creates `choice_pending` credits that the customer closes with `choose_credit_outcome`.

**User decisions (2026-10-10):**
- Customer screen: a card at the top of `/me` and of `/me/bookings`: chip `ממתינה לבחירה שלך`, title `המפגש ב-{DD.MM} בוטל`, text `מה מתאים לך: זיכוי למפגש אחר או החזר כספי?`, button `לבחירה`. The sheet reuses the 3.7 options `זיכוי למפגש אחר` / `החזר כספי`, confirm `לאישור הבחירה`; done `הזיכוי מחכה לך בהרשמות שלך` / `בקשת ההחזר התקבלה`. EXPERIENCE.md's "טל ביטלה" is dropped (no Tal in customer copy).
- At-risk cards: a warning in the preview (customer, expiry, reason `כבר פגה` / `אין מפגש מתאים לפני התפוגה`) with a link to the customer card; no extend button (3.13). The same warning in a time change for a card not valid on the new day; never blocks.
- Notice text: templates unchanged; Tal edits only the body (1–1000 chars); the title stays from the template. A seat bound later gets the template body.
- After a time change the 48h rule is unchanged: inside the window she sees "צרי קשר" and Tal's cancel of a pinned booking gives a credit.
- A credit-funded booking in a cancelled session: the same credit returns with `choice_pending`; its option for this session becomes `replaced/event_cancelled`; choosing credit continues the same options, never a new cycle.

**User decisions (2026-10-13, phone check):**
- New default bodies (titles unchanged), migration `20261013185902_business_cancel_texts.sql`, updating only a body still equal to the old default: `event_cancelled` `אם נרשמת עם כרטיסייה, הכניסה חזרה אלייך. אם שילמת על המפגש בנפרד, ראי פרטים באזור האישי`; `event_changed` `לידיעתך! מועד הבראנץ׳ שונה ל-{new_date} בשעה {new_time}`.
- A time-change result (refusal or success) scrolls into view and takes focus.

**User decisions (2026-10-13, review round 1):**
- A business cancel gives the refund-or-credit choice at any time, also inside 48h (source §6, business-cancel row).
- Parked pinned purchase (an active entitlement pinned to the session with no booking, "paid without place"), joined or not: never blocks the cancel. The plan returns `parked: [{customer_id|null, customer_label, payment_id}]`. The dialog shows per purchase `{name} שילמה למפגש הזה ואין לה מקום. אחרי הביטול היא תופיע ב'לטיפול', ותצטרכי לסגור איתה החזר או זיכוי ידנית.` and, only then, a second required checkbox `ידוע לי שיש לקוחה שצריכה טיפול ידני אחרי הביטול`; one confirm button. `admin_cancel_event` gets `p_parked_acknowledged boolean`; parked purchases without it → `CONFIRM_REQUIRED`. The purchase itself is not changed. Its `paid_without_place` attention item on a cancelled session reads `שילמה לבראנץ׳ {concept} {date} והמפגש בוטל. צריך לסגור איתה החזר או זיכוי ידנית`, chip `בוטל`.

## Boundaries & Constraints

**Always:**
- **Cancel plan** `private.plan_admin_cancel_event(event_id)` (stable) → `{ok, code}` or `{ok, event_id, concept_name, starts_at, booking_count, places, card_count, choice_count, unbound_count, at_risk: [{customer_id, customer_label, product_name, expires_on, reason: 'expired'|'no_session_before_expiry'}], title, body}`. Not `published` or already started → `EVENT_NOT_CANCELLABLE`. `at_risk` = card-funded bookings whose card is expired, or has no other `published`, open, not-full session of a kind it funds before `local_day_end(expires_on)`. `title`/`body` rendered from `event_cancelled` with `{date}`.
- **`admin_cancel_event(p_event_id, p_confirmed, p_message, p_idempotency_key)`** (`authenticated`, admin): admin check → `idempotent_begin` → `p_message` trimmed 1–1000 (`INVALID_INPUT`, detail `message`) → read registrants' `customer_id`s unlocked → lock their `profiles` by id → event → its `confirmed` bookings by id, recheck the set (`CONCURRENT_CHANGE`) → allocation entitlements → allocation credits → plan → `CONFIRM_REQUIRED` unless `p_confirmed` → status `cancelled` (trigger bumps `revision`) → `cancel_core(..., 'admin', 'admin_cancel_event', null, 'pending')` per booking → `refresh_credits_for_event` → one `event_cancelled` per distinct non-null customer (`p_body_override = p_message`, vars `{date}`, discriminator `event_id:revision`, target `/me/bookings`) → audit before/after. Returns `{event_id, cancelled, card_count, choice_count}`.
- **`cancel_core` business mode** (same signature, no drop): `p_choice = 'pending'` only with `p_action = 'admin_cancel_event'`, else `INVALID_INPUT`. Card/returned → `release` as today. Pinned → credit `active`, `choice_pending = true`, no options, no refund row. Credit-funded → per decision. No `booking_cancelled*` in this mode.
- **`choose_credit_outcome(p_credit_id, p_choice, p_idempotency_key)`** (`authenticated`, owner via `private.current_customer_id()`): lock profile → credit; hers, `active`, `choice_pending`, else `CHOICE_NOT_PENDING`. `refund` → `refund_requested` + `refund_requests` (`amount_agorot` = basis). `credit` → `choice_pending = false`, then `refresh_credit_options` fills. Audit; no notification; no deadline. Returns `{credit_id, outcome}`.
- **Time change**: `private.plan_admin_reschedule_event(event_id, starts_at, ends_at)`, `preview_admin_reschedule_event`, `admin_reschedule_event(p_event_id, p_starts_at, p_ends_at, p_confirmed, p_message, p_idempotency_key)`, same locks as cancel. Plan: `published`, not started, new start in the future and before the end, something changed (`INVALID_INPUT`); returns `{booking_count, at_risk, title, body}` from `event_changed` with `{date, new_date, new_time}`. Action: update times (trigger: `revision`, registration close) → entitlements pinned to the event get `expires_on` = new local day → `refresh_credits_for_event` → one `event_changed` per customer. `admin_update_event` keeps `EVENT_HAS_BOOKINGS`; the editor sends that save to this flow. Kind never changes (concept).
- **Moved option**: `refresh_credit_options` replaces an active option whose session now starts `<= origin_starts_at` with reason `moved` (new check value, separate drop migration).
- **Reminders (5.17)**: `job_reminders` already keys on `booking_id:revision` and reads `starts_at` live; no redefinition, only a DB test.
- **Bind**: for a moved `choice_pending` credit `bind_purchase` sends `event_cancelled` (template body, discriminator `event_id:revision`) instead of `booking_cancelled_pinned`.
- **Reads** (extend latest, keep every field): `get_my_credits` adds `choice_pending`; a pending credit has no options and is not `waiting`. `admin_get_attention_items` adds kind `choice_pending` `{customer_id, event_id, concept_name, starts_at, amount_agorot}` for bound customers.
- **Admin UI**: `ביטול מפגש` (`button-destructive`) on the session page when not read-only → `SensitiveConfirmDialog` (`event_cancel: "האם לבטל את המפגש?"`) with impact rows, the at-risk list and a new prefilled `message` slot (max 1000). The editor's "when" row, with bookings, opens the same dialog (`event_reschedule: "האם לשנות את מועד המפגש?"`). Done: `המפגש בוטל ו-{n} נרשמות קיבלו הודעה` / `המפגש הוזז ו-{n} נרשמות קיבלו הודעה`. Sessions list shows cancelled sessions not yet ended with chip `בוטל`. Attention row `{customer} עוד לא בחרה זיכוי או החזר על בראנץ׳ {concept} {date}` → customer card.
- Every caller passes all `allowed_vars`; a DB test edits both templates to use every field and runs the real flows. Codes only in `lib/errors.ts`; copy in `lib/copy/*`; screens start with `frontend-design`; no "טל" in customer copy.
- Migration only after "מתחילים לבנות": `migration new`, each redefinition from `pg_get_functiondef` of the live DB; the `moved` check is a separate migration the user runs in the SQL Editor, registered in `schema_migrations`; then `get_advisors`, types, full `test:db`, `demo:seed`.

**Never:** refund completion (3.9), moving a booking (3.10), Tal changing options or extending a credit or card (3.13/3.16), deleting a session (3.17), couple offset, Tal choosing for the customer, `preview_book_session` for a cancelled session (3.5), a choice deadline, a new notification type, a changed `admin_update_event` signature.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mixed cancel | Card, pinned, unbound pinned; Tal confirms | Card `release`; two credits `choice_pending`; event `cancelled`; 2 `event_cancelled` with her body | — |
| No checkbox | `p_confirmed` false | Nothing changes | `CONFIRM_REQUIRED` |
| Inside 48h | Pinned booking, session in 30h, Tal cancels the session | Credit `choice_pending`; she may choose refund | — |
| Parked purchase | Pinned entitlement on the session, no booking; second checkbox missing / given | Nothing changes / session cancelled, purchase unchanged, attention item reads "והמפגש בוטל" | `CONFIRM_REQUIRED` / — |
| At risk | Card expires before any other matching session | Listed, `no_session_before_expiry` | — |
| Credit-funded | Booking funded by an older credit | Same credit `choice_pending`; option `replaced/event_cancelled` | — |
| Choose refund | Pending credit, `refund` | `refund_requested`, request = basis; attention item gone | — |
| Choose credit | Pending credit, `credit` | Options counted from the original cancelled session | — |
| Choose twice / not hers | Already chosen, or another customer's | Nothing changes | `CHOICE_NOT_PENDING` |
| Unbound then bind | Unbound seat cancelled, later bind | Credit moves, one `event_cancelled`, pending card shows | — |
| Option cancelled | Her active option is the cancelled session | `replaced/event_cancelled`; next session on her next view | — |
| Concurrent | `cancel_booking` and `admin_cancel_event` | No deadlock; one may fail cleanly | `CONCURRENT_CHANGE` |
| Reschedule | 10 bookings, 10:30→11:00 | 10 `event_changed`; new reminder at the new time; pinned `expires_on` follows | — |
| Moved before origin | Option moved before the credit's origin | `replaced/moved` | — |
| Cancelled reminder | Session cancelled before the reminder | No reminder | — |
| Customer preview | `preview_admin_cancel_event` as customer | — | `NOT_AUTHORIZED` |
| Idempotent | Same key twice | Same result, one notification each | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010141240_cancellation_credits.sql` (latest of most): `booking_funding` `:227`, `refresh_credit_options` `:290` (choice_pending early return `:310`, event_cancelled `:341`), `refresh_credits_for_event` `:430`, `refresh_customer_credits` `:463`, `cancel_core` `:802` (choice check `:851`, credit insert `:907`, credit-funded `:948`, notify `:978`), `plan_admin_cancel_booking` `:1011`, `bind_purchase` `:1100` (notify `:1299`), `admin_cancel_booking` `:1592` (profile lock `:1643`), `admin_update_event` `:2435` (`EVENT_HAS_BOOKINGS` `:2488`, capacity refresh `:2518`), `get_my_credits` `:2737`, `admin_get_attention_items` `:3007`; credit tables `:50-121`.
- `20261010141237_*_type_and_drops.sql:26-35` type check (has both types). `20261001184225_create_notification_core.sql:70-75` templates, `:223` `enqueue_notification` (override only for `template_or_override`). `20261006183915_*:39-40` allowed_vars. `20261004143612_concepts_and_events.sql:71` status check, `:132-157` revision trigger. `20261006220218_session_reminders.sql:29` `job_reminders`. `20261010184900_*:20` `plan_funding` (excludes choice_pending).
- Tests: `cancellation-credits`, `cancel-booking`, `events-admin`, `session-reminders`, `admin-home`, `bind-purchase`, `settings-and-templates` (count 15 unchanged `:634,662`, `fillAllFields` `:668`, flows `:683`), `grants`, `booking-concurrency`.
- Admin UI: `app/admin/(shell)/sessions/[id]/{page.tsx (action row ~108-138), attendee-cancel.tsx + cancel-plan.ts (pattern), actions.ts}`, `edit/session-editor.tsx` (when row `:121-143`, `saveField` `:83`), `load-session.ts` (`sessionsListFilter` `:58`, `isReadOnlySession` `:66`), `sessions-list.tsx` (occupancy per row since fix-admin-sessions-list, from `admin_list_session_occupancy`, `20261010200221_admin_session_occupancy.sql`), `session-status-chip.tsx` (draft/published only); `components/admin/sensitive-confirm-dialog.tsx` (reason textarea is 500 max, add `message`), `lib/admin/sensitive-actions.ts`; `home-items.ts` (`toAttentionItem` `:136`, refund `:209`, `customerHref`); `lib/copy/admin.ts` (`sessions` `:542`, `sensitive` `:712`, `home.items` `:804-895`).
- Customer UI: `app/me/bookings/{page.tsx (:58-108), credits.ts (:15,:32,:58), credit-cards.tsx, cancel-booking.tsx (PinnedCancelChoice :283)}`, `app/me/home.tsx (:46-64, :142)`, `lib/copy/customer.ts (:183-229)`, `lib/errors.ts` (`EVENT_HAS_BOOKINGS` `:67`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261013162129_credit_option_moved.sql` -- **main session; user runs in SQL Editor:** `replaced_reason` check adds `moved`. Written by the main session.
- [x] `supabase/migrations/<ts>_business_cancel_event.sql` -- plans, previews, actions, `choose_credit_outcome`; redefine `cancel_core`, `refresh_credit_options`, `bind_purchase`, `get_my_credits`, `admin_get_attention_items`; revoke all, one grant each.
- [x] `lib/supabase/database.types.ts` -- regenerate.
- [x] `supabase/tests/business-cancel.test.ts` -- every matrix row; update `session-reminders`, `admin-home`, `bind-purchase`, `settings-and-templates` (real flows, all vars), `grants`, `cancellation-credits`.
- [x] `lib/errors.ts` (`EVENT_NOT_CANCELLABLE`, `CHOICE_NOT_PENDING`, `EVENT_HAS_BOOKINGS` text), `lib/copy/{admin,customer}.ts`, `lib/admin/sensitive-actions.ts`.
- [x] Admin screens (`frontend-design` first): cancel button and dialog, reschedule from the editor, message slot, at-risk list, chip `בוטל`, attention row; parser and render tests.
- [x] Customer screens (`frontend-design` first): pending-choice card and sheet on `/me` and `/me/bookings`; parser and render tests.
- [ ] Docs -- `deferred-work.md` (close the 3.1→3.2 time-block item and the 3.7 moved-option item), `completion-plan-2026-10-10.md`, `tickets.toml` id 8 done in the PR.

**Acceptance Criteria:**
- Given Tal opens "ביטול מפגש", when the preview loads, then she sees the count, outcomes per kind, who is at risk with a link, and the editable body, before any change.
- Given a pending choice, when the customer opens `/me`, then the card is at the top until she chooses, then it becomes the credit or refund card.
- Given an unchosen credit, when Tal opens "לטיפול", then the customer is listed.

## Implementation Notes

- 2026-10-13: `origin/main` merged (includes fix-admin-sessions-list). The user runs `20261013162129_credit_option_moved.sql` in the SQL Editor now; the main session registers it. The main migration is written with `npx supabase migration new`; `apply_migration` via MCP is declined, so the user runs it in the SQL Editor too. Until then DB tests may run the migration SQL inside a rolled-back transaction (as in 3.7), and `database.types.ts` is hand-edited, regenerated after apply.
- 2026-10-13 (implementation): the main migration is `20261013162639_business_cancel_event.sql`. Additions beyond the text: `private.credit_cancelled_booking` (which cancelled booking a credit's pending card and attention item name); `get_my_credits` also returns `cancelled_starts_at` and `options_count`; `admin_cancel_event` / `admin_reschedule_event` also return `notified` (the done messages' n); the reschedule plan's at-risk reason is `not_valid_on_new_day` (copy `לא בתוקף ביום החדש`) and its refusals are `{ok: false, code: 'INVALID_INPUT', field}`; a session with a card-offset booking is refused with `MANUAL_HANDLING_REQUIRED`. The server action sends the new time as `'YYYY-MM-DD HH:MM:00 Asia/Jerusalem'`, so the database converts (AD-8). The DB tests were run with a temporary hook in `supabase/tests/support/db.ts` that ran the migration inside each rolled-back test (removed; `support/db.ts` is unchanged). The new `booking-concurrency` tests commit, so they run only after apply. `tickets.toml` has no status field; id 8 is left for the PR.

- 2026-10-13, after 3.5 applied `20261013161243`/`20261013161248` on dev: both 3.8 migrations move to timestamps after `20261013161248` (small one now `20261013162129_credit_option_moved.sql`). `bind_purchase` is rebuilt from the live definition, keeping 3.5's `private.is_real_booking(other.status)`. No new notification type (live check has 17). Contract with 3.5's `preview_book_session`: `admin_cancel_event` cancels every booking through `cancel_core` with `p_action = 'admin_cancel_event'`, which writes one `audit_log` row per booking with `entity_type = 'bookings'`, `entity_id = <booking id>`, `action = 'admin_cancel_event'`. The 3.5 item "a booking cancelled with its session shows only 'בוטלה' on /me/bookings" stays deferred: it needs `get_my_bookings` (redefined by 3.5) to return the session status.
- 2026-10-13, applied: the user ran both migrations in the SQL Editor (the main one in one `begin`/`commit`); both registered in `schema_migrations`. Advisors: only approved WARNs (`0029` on the five new RPCs, leaked password). `database.types.ts` regenerated (it also picks up 3.5 `set_booking_guest_details` and 4.3 `admin_list_open_cards`). Full `test:db`: 891/898. The 7 failures come from 3.5 and 4.3, applied on dev but not in this branch (grants list, template count 15→16 in 4 tests, couple `booking_confirmed_couple`, cancelled-session `preview_book_session`), and are left to them. `demo:seed` not run: `.demo-data.local.json` is missing everywhere, so a run would create a second demo set; 3.8 does not change the script.

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-13):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. intent_gap 1 (resolved by the user without a revert: the gap is an unhandled case, no code built on a wrong assumption), medium 7, low 10, false 3.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind | Parked pinned purchase on the cancelled session gets nothing and is not shown | medium | intent_gap → decided | user decision 2026-10-13 (warning, second checkbox, attention copy) |
| 2 | blind | `choice_count` already includes unbound seats, `unbound_count` counts them again | low | patch | plan `:507-520`; exclude unbound from `choice_count` in plan and result |
| 3 | blind, edge | Reschedule refusal `field` dropped; one generic sentence, wrong for `event_id` | medium | patch | `RescheduleDialog` passes only `code`; pass `field`, text per field |
| 4 | blind | `PendingChoiceCard` refusal vanishes: `router.refresh()` unmounts the card | medium | patch | refresh only on success; keep the error otherwise |
| 5 | edge | `SessionCancel` refusal vanishes after refresh (button unmounts) | medium | patch | same: no refresh on refusal |
| 6 | blind | No bookings: notice still required, done text "0 נרשמות קיבלו הודעה" | low | patch | done `המפגש בוטל` / `המפגש הוזז` when `notified = 0` |
| 7 | blind, edge | Refund from a business-cancelled credit-funded booking points at the origin session | medium | patch | `choose_credit_outcome` uses `origin_booking_id`; use `private.credit_cancelled_booking` |
| 8 | edge | At-risk ignores that she is already booked in the "other" session | low | patch | add `not exists` her confirmed booking there |
| 9 | blind | `EVENT_NOT_CANCELLABLE` Hebrew duplicated outside `lib/errors.ts`; untyped refusal map | low | patch | project rule; use `errorMessage`, type `Partial<Record<ErrorCode,string>>` |
| 10 | blind | Message textarea not linked to its hint/error | low | patch | `aria-describedby` |
| 11 | vgap | Editor `EVENT_HAS_BOOKINGS` → dialog routing untested | medium | patch | pure helper + unit test |
| 12 | vgap | Cancelled chip / no occupancy untested | low | patch | `listOccupancy` + `SessionsList` cases |
| 13 | vgap | `/me/bookings` pending card and empty state untested | medium | patch | page render test like `home.test.tsx` |
| 14 | vgap | "moved" test masked by `get_my_credits` refresh | medium | patch | assert options before `myCredits` |
| 15 | vgap | `'… Asia/Jerusalem'` literal never reaches Postgres in a test | medium | patch | DB test, summer and winter dates |
| 16 | vgap | Hand-set close after new start refusal untested | low | patch | add to refusals test |
| 17 | vgap | 3.7 "two credits share option X" weakened to one branch | low | patch | exact list in both branches |
| 18 | user | Business cancel inside 48h gives the choice: untested | low | patch | matrix row "Inside 48h" |
| 19 | blind | `CONCURRENT_CHANGE` (new booking or bind between the unlocked read and the locks) untested | medium | defer | needs a paused committing transaction, like 3.7 #14 |

Rejected: kind row `EVENT_HAS_BOOKINGS` (false, the editor has no kind row); bind discriminator revision drift (false, a cancelled session cannot be updated); refund leaves inert active options (low, funding needs `active`); credit-funded booking moved before origin (low, she is booked, the business moved it); `credit_cancelled_booking` cost (low, small tables); no preview spinner, no interaction tests, sheet note `{n}` (low); docs checkbox (spec edit); offset refusal blocks the cancel (couple offset cancelled 2026-10-10).

## Design Notes

`'pending'` as a `cancel_core` choice avoids a signature change (no drop). The edited body lives in each notification's payload; a later bind uses the template. Reminders need no change: the revision in the discriminator re-arms them. Pinned `expires_on` follows the session day, since a pinned product is valid only on its session.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` -- pass.
- After apply: `get_advisors` (only approved WARNs), full `npm run test:db`, `npm run demo:seed` -- pass.

**Manual checks (if no CLI):**
- Phone: Tal cancels a session with a card, a pinned and an unbound booking and sees who is at risk; the card entry returns; the pinned customer chooses; "לטיפול" lists who has not chosen; a time change notifies and the reminder follows.
