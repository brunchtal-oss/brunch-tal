---
title: 'Couple and intro bookings (3.5)'
type: 'feature'
created: '2026-10-10'
baseline_commit: '5d7466465c573e76d512c125655ada855ca84e2b'
status: 'done'
route: 'full'
route_source: 'pinned'
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

**Problem:** Couple booking, couple funding and the intro rules already work (3.11, 3.7), but the customer cannot give the companion's dietary note, a couple confirmation does not lead to it, a cancelled session's page hides her booking, and `bind_purchase` misses a `completed` duplicate.

**Approach:** One migration: an RPC that writes `bookings.guest_details`, a couple confirmation type with push, and redefinitions of `notify_booking_confirmed`, `get_my_bookings`, `preview_book_session`, `bind_purchase` and `plan_funding`. A small second migration (SQL Editor) adds the type and rebuilds the index. `/me/bookings` gets the companion field; the session page shows her booking in a cancelled session. Tests pin what already works.

**User decisions (2026-10-10):**
- New type `booking_confirmed_couple`, push on, own template Tal edits.
- The companion note is editable until the session's registration close; after that it is read-only, with "צרי קשר".
- A couple session without a couple entitlement or credit keeps today's `NO_MATCHING_ENTITLEMENT` notice and "צרי קשר".
- A cancelled session's page shows "she was booked" also when her booking was cancelled together with the session. A booking she cancelled herself before that is not shown.

**User decisions (2026-10-13, phone check):**
- A pinned product (single, intro, couple) approved for an existing customer sends only the booking notification (`booking_confirmed` / `booking_confirmed_couple`), no `purchase_repeat`. A card keeps its purchase notification. Overrides the 2.5/3.11 decision for pinned products.
- Opening the notifications screen marks all her notifications read (the bell count resets); rows that were unread stay highlighted for that visit. Opening a push marks its notification read.
- Past booking chips read `בוטל` / `התקיים` (the brunch, masculine), not `בוטלה` / `התקיימה`.

## Boundaries & Constraints

**Always:**
- **`set_booking_guest_details(p_booking_id uuid, p_guest_details text, p_idempotency_key uuid)`** (`authenticated`, definer, AD-5 contract). Locks: profile → event → booking. Booking must be hers (`customer_id = private.current_customer_id()`), else `NOT_FOUND`. It must be `confirmed` with `party_size = 2`, else `INVALID_INPUT` (detail `booking`). Requires `now() < private.registration_closes_at(event)`, else `REGISTRATION_CLOSED`. The text is trimmed; empty → null; > 1000 chars → `INVALID_INPUT` (detail `guest_details`). Audit `before`/`after` through `private.audit_diff` (already masks `guest_details`). No notification. Returns `{booking_id, guest_details}`.
- **`get_my_bookings`** adds per booking `party_size`, `guest_details`, `guest_details_editable` (confirmed, couple, before close). Every other field stays.
- **Notification.** In `private.notify_booking_confirmed`, `party_size = 2` → type `booking_confirmed_couple`, target `/me/bookings#booking-<id>`; otherwise `booking_confirmed` as today. Same discriminator (`booking.id`) and vars (`date`, `time`, `concept`). It covers self, admin, pinned approval and the deferred send in `bind_purchase`: exactly one notification per booking. Template: push `true`, title `ההרשמה אושרה`, body `{date} · {time} · בראנץ׳ {concept}. אפשר להוסיף בהרשמות שלך הגבלות תזונה או אלרגיות של המלווה`.
- **`preview_book_session`, cancelled event.** It looks for her booking before checking status: `confirmed`/`completed`, or `cancelled` together with the session. "Together" means the mechanism 3.8 merges (it merges first); re-read it from the live DB at build time. It returns `{ok:false, code:'EVENT_CANCELLED', booked:true, booking_id}`. Without such a booking it returns `EVENT_CANCELLED` with `booked:false`. A non-published, non-cancelled event stays `EVENT_NOT_BOOKABLE`.
- **`bind_purchase`.** The "already booked in this session" check uses `private.is_real_booking`. Index `bookings_confirmed_customer_event_uidx` becomes `where status in ('confirmed','completed') and customer_id is not null`; dev has 0 violating rows (checked 2026-10-10). This is the rule 5.6 keeps when it redefines `bind_purchase`.
- **`plan_funding`.** The card exclusion for couple sessions applies in every mode, not just `self`/`online`. No couple offset, even by Tal.
- **Screen copy (verbatim).** `/me/bookings`, upcoming couple booking card, a section under it with id `booking-<id>`:
  - Label `הגבלות תזונה או אלרגיות של המלווה`.
  - Saved text, or `לא נמסרו`.
  - Button `עריכה` (or `הוספה` when empty), which opens a sheet with one textarea (`maxLength` 1000) and `שמירה`. The result shows in `inline-notice` (`נשמר`).
  - After close: read-only, plus `אפשר לשנות דרך צרי קשר` with the contact link.
- **Screen copy, cancelled session page.** `המפגש הזה בוטל`. When `booked`, also `היית רשומה למפגש הזה. הפרטים בהרשמות שלך` and the button `להרשמות שלי` → `/me/bookings`. No "טל" in customer copy.
- Codes: `EVENT_CANCELLED` is new in `lib/errors.ts` (`המפגש הזה בוטל`). Admin template label `booking_confirmed_couple`: `אישור הרשמה זוגית`. Screens start with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md.
- **Migrations.**
  - Each redefinition is re-based on `pg_get_functiondef` of the live DB.
  - `supabase/migrations/<ts>_couple_type_and_index.sql` (drop constraint + index): the user runs it in the SQL Editor first; the main session registers it in `schema_migrations`. It includes every type in the live check at that moment, including any 3.8 added.
  - The main one via MCP.
  - Timing per completion plan: this changes functions visitors use, so it is applied Tuesday 2026-10-13 or later, unless the user decides otherwise. Until then the SQL is a draft (`supabase/drafts/`) and `database.types.ts` is hand-edited.

**Never:** couple offset / `admin_offset_paired`; manual "participated before" (6.2); waitlist (5.6); business session cancel, choice flow (3.8); eligible products (3.18); `admin_cancel_event`, `admin_update_event`, `admin_get_attention_items`, `job_reminders`; a companion name; a new error message for couple sessions without an entitlement.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save note | Her confirmed couple booking, before close, `"צמחונית "` | Saved `צמחונית`; Tal's details and work sheet show `מלווה: צמחונית` | — |
| Clear note | Same, `"  "` | `guest_details` null | — |
| After close | Close passed | Nothing changes | `REGISTRATION_CLOSED` |
| Not couple / not hers / cancelled | Single booking; another customer's; cancelled | Nothing changes | `INVALID_INPUT` / `NOT_FOUND` / `INVALID_INPUT` |
| Too long | 1001 chars | Nothing changes | `INVALID_INPUT` (`guest_details`) |
| Idempotent | Same key twice | Same result, one audit row | — |
| Pinned couple approval | Tal approves a couple product for an existing customer | One `booking_confirmed_couple`, target `/me/bookings#booking-<id>`, a push job | — |
| Unbound couple seat | New customer joins | On bind: one `booking_confirmed_couple` | — |
| Single booking | Card self-booking | `booking_confirmed`, target unchanged, no push | — |
| Couple self-booking from credit | Couple credit, option = couple session | Booked, `party_size` 2, `booking_confirmed_couple` | — |
| Couple session, 1 place | Self preview and book | Label `full`; `EVENT_FULL`, nothing created | — |
| Card for couple | Card with `eligible_event_kind = 'couple'`, self and admin | Not offered / not funded | `NO_MATCHING_ENTITLEMENT` |
| Second intro booking | Active intro booking; Tal books her into another session | Nothing created | `NO_MATCHING_ENTITLEMENT` |
| Cancelled session, booked | Event set to `cancelled`, her booking `confirmed` (and, after 3.8, cancelled with it) | `booked:true`, page shows her booking | `EVENT_CANCELLED` |
| Cancelled session, self-cancelled earlier | She cancelled, then the event was cancelled | `booked:false`, only `המפגש הזה בוטל` | `EVENT_CANCELLED` |
| Bind after completion | Unbound pinned seat in session X; she has a `completed` booking in X | Nothing bound | `BIND_CONFLICT` |
| Pinned approval, existing customer | Tal approves a single / intro / couple product into a session | Exactly one notification (the booking one), no `purchase_repeat` | — |
| Card approval | Tal approves a card for an existing customer | `purchase_repeat` as today | — |
| Unbound pinned seat binds | New customer joins | Only the booking notification (unchanged) | — |
| Open notifications screen | 3 unread | All marked read, bell 0; the 3 rows still highlighted on this visit | Mark fails → rows stay unread, screen still renders |
| Open a push | Push for notification N | N marked read; she lands on its target | Mark fails → she still lands on the target |
| Past chips | Past cancelled / held booking | `בוטל` / `התקיים` | — |

</frozen-after-approval>

## Code Map

**Exists vs. built here**

| Exists (verified 2026-10-10) | Built here |
|---|---|
| Couple party 2 (`book_session`, `book_core`, `preview_book_session`), one unit taken; couple label `full` when free < 2 (`get_event_availability`) | Companion note RPC and UI |
| Couple credit funds a couple session (`plan_funding` step 1); card excluded in `self`/`online` | Card excluded in all modes |
| Intro: `private.intro_blocked` at approval and bind; one active intro (`entitlements_active_intro_customer_uidx`); intro pinned, so no self-booking | Test: a second intro booking via `admin_book_customer` fails |
| Tal sees the note: `admin_get_event_details` → `load-details.ts:36,84,108`, `attendee-row.tsx:151`, `work-sheet-data.ts:197`, `shopping-message.ts:55` | Couple confirmation type + target |
| `preview_book_session` finds `confirmed`/`completed` before status, `EVENT_COMPLETED` (3.12) | `EVENT_CANCELLED` with her booking |
| `bind_purchase` duplicate check on `confirmed` only | `is_real_booking` + index |

- Live definitions: `plan_funding` (card line `20261010184900_credit_funds_origin_session.sql:110,139`), `preview_book_session` and `book_core` (same file); `bind_purchase`, `book_session`, `get_my_bookings` (`20261010141240_cancellation_credits.sql`, `get_my_bookings` ~2533); `notify_booking_confirmed` (`20261004183409_bookings_and_self_booking.sql:297`, target `:321`); index (`:60`); `guest_details` check (`:43`); template seed (`:136`); `allowed_vars` and sample vars (`20261006183915_business_settings_and_templates.sql:31`); type check (`20261010141237_*`); `audit_diff` (`20261010110501_notes.sql:195`).
- Notifications: `target_path` from SQL only; `lib/notifications/shared.ts:37` already accepts `#`. Push worker `app/api/jobs/push`.
- UI: `app/me/bookings/page.tsx` (`get_my_bookings` :60, upcoming `SessionCard` :124), `cancel-result.ts:64-109` (`MyBooking`, `parseMyBookings`), `actions.ts:23-46` (pattern); `app/me/sessions/[id]/page.tsx:69`, `booking-preview.ts:43,113` (`blockedAction`), `booking-panel.tsx:71-126`; textarea pattern `app/me/profile/details-section.tsx:134-151`, `actions.ts:80-105`; `lib/idempotency.ts`; `components/shared/inline-notice.tsx`; `lib/copy/customer.ts` (`contactPhrase` :72); `lib/copy/admin.ts:1153` (template labels); `lib/errors.ts`.
- Tests: `supabase/tests/self-booking.test.ts` (:350, :507, :715), `admin-booking.test.ts:348`, `pinned-approval.test.ts` (:442, :488), `bind-purchase.test.ts:329`, `cancellation-credits.test.ts:526`, `settings-and-templates.test.ts` (template count, `fillAllFields`), `grants.test.ts`; unit `app/me/bookings/{cancel-result,actions}.test.ts`, `app/me/sessions/[id]/{booking-panel.test.tsx,booking-preview.test.ts}`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/drafts/3-5-couple-type-and-index.sql` -- **main session; the user runs it in the SQL Editor:** type check plus `booking_confirmed_couple`; drop and recreate the index. Registered in `schema_migrations`.
- [x] `supabase/drafts/3-5-couple-and-intro.sql` -- template row, `set_booking_guest_details`, redefinitions above, grants. Moved to `npx supabase migration new` when applied; the main session deletes the draft.
- [x] `lib/supabase/database.types.ts` -- hand-edited now, regenerated after apply.
- [x] `supabase/tests/couple-and-intro.test.ts` -- every matrix row. Update `admin-booking.test.ts` (card for couple in admin), `bind-purchase.test.ts`, `self-booking.test.ts`, `settings-and-templates.test.ts`, `grants.test.ts`.
- [x] `lib/errors.ts`, `lib/copy/customer.ts`, `lib/copy/admin.ts` -- copy above.
- [x] `app/me/bookings/*` -- `frontend-design` first; parse the new fields, companion section + sheet, `setGuestDetailsAction` (shape only → `callRpc`); unit tests.
- [x] `app/me/sessions/[id]/*` -- `EVENT_CANCELLED` booked / not booked; unit tests.
- [x] `scripts/demo-seed.mjs` -- if it creates a couple booking, give it a note.
- Round 2 rule: no SQL against the shared dev DB from the implementer, not even inside a rolled-back test transaction (it locked `bookings` for production). The main session applies and runs `test:db`.
- [x] Round 2 (2026-10-13 decisions): `supabase/migrations/<ts>_pinned_single_notification.sql` (`npx supabase migration new`) -- redefine, from the live `pg_get_functiondef`, the function that enqueues `purchase_repeat` at approval so a pinned product skips it; no drop; the user runs it in the SQL Editor, the main session registers it. Tests: `pinned-approval.test.ts` and `couple-and-intro.test.ts` (one notification), card unchanged.
- [x] Round 2: notifications screen (`app/me/notifications/*`, `components/shared/notification-list.tsx`) marks all read on open via the existing `mark_notifications_read` (keep the visit's unread highlight; refresh the bell); push click (`public/sw.js` + push payload in `lib/server/privileged/push-worker.ts`) marks its notification read through the existing action/RPC, with no new public endpoint that skips the auth check; bump the SW `VERSION`. Admin surface behaves the same where the components are shared. Unit tests (`notification-list`, `sw.test.ts`, `push-worker.test.ts`).
- [x] Round 2: `lib/copy/customer.ts` `bookingCancelled` `בוטל`, `bookingHeld` `התקיים`; tests that assert the old words.
- [ ] Docs -- SPEC `.memlog.md` (decisions above, incl. the 2026-10-13 ones), `completion-plan-2026-10-10.md`, `deferred-work.md` (close the `preview_book_session` and `bind_purchase` items), `tickets.toml` id 5 done in the PR.

**Acceptance Criteria:**
- Given Tal approves a couple product, when the customer opens the notification, then she lands on her booking's companion section in `/me/bookings`, saves a note, and Tal sees it in the session details.
- Given the migrations are applied, when `get_advisors` runs, then only the approved WARNs remain.

## Implementation Notes

- 2026-10-13: 3.8 is not applied yet. "Cancelled together with the session" = a `cancelled` booking with an `audit_log` row `entity_type = 'bookings'`, `action = 'admin_cancel_event'` (3.8's `cancel_core(..., 'admin_cancel_event', ...)` audits each booking so). Re-check against 3.8's merged code before apply.
- Every redefinition in the draft matched the live DB on 2026-10-13 (md5 of `prosrc`). 3.8 also redefines `bind_purchase`: if it is applied first, take its live body and change only the "already booked" line.
- `guest_details_editable` is inlined in `get_my_bookings` (`confirmed`, `party_size = 2`, `now() < events.registration_closes_at`), the same rule `set_booking_guest_details` checks. An unchanged note writes no audit row.
- Cancelled session without her booking: the page shows `המפגש הזה בוטל` with the usual "לכל המפגשים" link (the blocked-notice pattern).
- The sheet treats `REGISTRATION_CLOSED` as "now read-only" (refresh), not as the self-booking message.
- DB tests were run once with both drafts applied inside each test transaction (a temporary harness, removed): `couple-and-intro` 17/17 and the touched files green except deadlocks with concurrent test runs from other worktrees. They must run again after apply.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-13, blind, edge, verification-gap, intent). Verdicts: high 0, medium 1, low 13, false 4, maybe-false 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `page.tsx` `isCouple` and `contactHref` condition untested (verification-gap) | medium | patch | Moved into helpers in `cancel-result.ts`, tested |
| 2 | "Unchanged note writes no audit row" and `guest_details_editable: false` for a single booking untested (verification-gap, blind) | low | patch | Cases added to `couple-and-intro.test.ts` |
| 3 | `admin_book_customer` → `booking_confirmed_couple` untested (blind) | low | patch | Case added |
| 4 | "Cancelled together" is tested against a hand-made `admin_cancel_event` audit row, not 3.8's real one (verification-gap, intent) | maybe-false | merge task | 3.8 merges first. At merge, re-read its mechanism, adjust the rule, and replace the hand-made row with a real `admin_cancel_event` call |
| 5 | `/me/bookings` past list says "בוטלה" without saying the session was cancelled (blind) | low | defer | Display of business-cancelled bookings belongs to 3.8 |
| 6 | A push to `#booking-<id>` may not scroll, since the anchor is inside Suspense (blind, intent) | maybe-false | phone check | Settled by the phone check "notification → companion section" |

Rejected: a confirmed booking in a cancelled session missing from `/me/bookings` (only before 3.8 or after a manual status change; after 3.8 it is cancelled with the session and listed as past); note editable on a non-published session (harmless, unreachable from the UI); the couple body invites an edit after Tal books past the close (approved copy, rare); silent read-only on `REGISTRATION_CLOSED`, stale sheet after a cancel in another tab, `aria-invalid` on a booking error, hidden 1000 limit, no schedule link in the booked panel, no client-flow tests, demo seed before apply, duplicate bind test, `preview_book_sessions` race (low, rare, or a design choice); null `registration_closes_at` (column is not null), contact link after close (`router.refresh` recomputes it), legacy card-funded couple move (none exist, `move_booking` not built), index rebuild outside a transaction (the SQL Editor runs the script as one implicit transaction) (false).

## Design Notes

The couple branch is in `notify_booking_confirmed`, the single enqueuer, so every path (self, admin, pinned approval, bind) sends exactly one notification with no caller changes. The note is a booking field, not a profile field: it belongs to that companion on that date.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` -- pass.
- After apply: `get_advisors` (only 0029 and `auth_leaked_password_protection`); `npm run test:db -- self-booking credits pinned-approval bind-purchase cancel-booking session-completion grants couple-and-intro admin-booking settings-and-templates`; `npm run demo:seed`.

**Manual checks (phone):**
- Couple approval → one notification → companion section → save → visible in Tal's session details.
- A session set to `cancelled` shows her booking.
- A couple session with one place left shows "מלא".
