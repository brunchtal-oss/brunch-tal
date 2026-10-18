# Epic 3 Context: Sessions and booking, from atomic booking to cancellation, credit and refund

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the core of sessions and bookings: sessions created from concepts, atomic self-booking (single and multi-date), registration close and manual booking, pinned products (single, intro, couple) booked at payment approval, couple and intro bookings, self-cancel and admin cancel, cancellation credits with alternatives, refund requests and their completion, business cancel or change of a session, moving a booking, session deletion, eligible products per session, session completion, entitlement corrections and the empty-week auto-extend rule. At the end, a customer with a card books on her phone without approval, sees the balance drop, cancels 48h or more ahead and gets the entry back on the same card; two customers racing for the last place get one confirmation; Tal cancels a session and sees correct credits and refunds. The RPCs here are the same ones the E4 admin UI uses.

## Stories

- Story 3.1: Concepts and session management (done)
- Story 3.2: Self-booking tracer with a card (done)
- Story 3.3: Multi-date booking and registration close (done)
- Story 3.4: Session details and manual booking (done)
- Story 3.11: Pinned product approval and placement (done)
- Story 3.5: Couple and intro bookings (done)
- Story 3.6: Self-cancel within 48 hours and admin cancel (done)
- Story 3.7: Cancellation credits, alternatives and refund requests (done)
- Story 3.8: Business cancels or changes a session (done)
- Story 3.9: Refund completion (done)
- Story 3.10: Move a booking
- Story 3.16: Admin credit adjustments
- Story 3.12: Session completion job (done)
- Story 3.17: Delete a session
- Story 3.18: Eligible products per session
- Story 3.13: Entitlement corrections
- Story 3.14: Auto-extend rule for empty weeks
- Story 3.19: Manual booking improvements

(3.15 was cancelled and folded into the unified cleanup 5.20.)

## Requirements & Constraints

- **Self-booking:** server checks published, registration open, no duplicate, enough places, valid funding; then saves the booking and reserves funding in one transaction. Failure takes no place and deducts nothing. Pinned products are never self-booked.
- **Occupancy to customers:** only "available / last places / full", sized to the booking (couple with one free place = full), never a number. Babies don't count. Guests see no occupancy.
- **Registration close:** default 20:00 the day before, Asia/Jerusalem, server time, DST-safe; overridable per setting and per session. Admin books any time with the same funding and capacity checks; no silent over-capacity (raise capacity first).
- **Session kind** always follows the concept's `default_kind`. Card is limited only by session kind (any weekday); couple sessions are never funded from a card, not even by Tal (no couple offset; `admin_offset_paired` is not built).
- **Intro:** only for a customer with no `confirmed`/`completed` booking and no active intro; regular sessions only; cancel before the session doesn't count, no-show counts. "Participated" derives only from completed sessions.
- **Cancel:** 48h window inclusive, checked on the server. Card: entry returns to the same card, no extension. Pinned self-cancel: choose refund or credit; admin cancel inside the window: credit; business cancel: choice with no deadline (`choice_pending`).
- **Credit:** one booking to one of the next N matching sessions (N snapshotted, default 2), same kind, counted from the cancelled session's date. Full or cancelled alternatives are replaced by the next; a passed alternative that had room is lapsed. A credit also funds re-booking the same cancelled session while open and with room, outside the N.
- **Refund:** total refunds never exceed what was paid; "refunded" only after Tal confirms date, amount and optional reference.
- **Move (3.10):** a cancel plus a new booking in one atomic action. First verify place and funding at the target, then cancel the source and reserve at the target; any failure leaves the source exactly as it was. A move grants no extra entry. Pinned: target only among the credit alternatives (counted from the original session date). Card: target within validity including extensions. Customer moves only inside the self-cancel window; Tal any time.
- **Auto-extend (3.14):** +7 days per local week (Sun-Sat) overlapping validity with no published matching session (couple doesn't count for a regular card, cancelled not counted, full counts). Once per week, idempotent.
- Every reason field is optional; every action is audited. Fake data only.

## Technical Decisions

- **Lock order:** `activation_tokens` > `profiles` > `events` > `bookings` > `entitlements` > `cancellation_credits` > `credit_options` > `payments` > `refund_requests` > `waitlist_entries` > `notification_jobs`, by `id` within a table. `profiles` is the customer mutex; take all locks at the start. Never lock a child to find its parent (read, lock parent, lock child, recheck, else `CONCURRENT_CHANGE`). Move: profile, then both events by id.
- **Places:** only `private.occupied_places` sums `party_size` of `private.is_real_booking` rows; no stored counter.
- **Funding:** `private.plan_funding(customer, event, party_size, mode)` with modes `self`/`admin`/`move`/`online` is the only funding chooser. Priority: available credit whose active alternative is this event, then an entitlement valid on the session date by `expires_on`, `id`. Pinned funds only its `pinned_event_id`. `booking_allocations` has exactly one of `entitlement_id`/`credit_id`. 3.10 and 3.18 still change it (different rounds); 3.19 only calls it in `admin` mode.
- **Core paths:** `private.book_core` and `private.cancel_core`; `move_booking` uses both. `private.can_self_cancel(booking_id)` is the only boundary check, rechecked inside `cancel_booking` and `move_booking`. `move_booking` copies the source `policy_snapshot`.
- **RPC contract:** security definer, `search_path = ''`, auth check first line, revoke all then one grant, `p_idempotency_key` via `private.idempotent_begin` before any lock. Errors as codes with `P0001`; new code goes into `lib/errors.ts` in the same commit.
- **Movements ledger:** `reserve` negative, `release` positive (card cancel), `use` = 0 with `booking_id` at completion, `adjust` non-zero for corrections. Balance only via view `entitlement_balances`, never below zero. Pinned cancel has no `release`; value moves to a credit.
- **Credits:** `cancellation_credits` with `origin_starts_at`, snapshotted `options_count` and `monetary_basis_agorot`; `credit_options` (active, used, lapsed, replaced) refreshed by `private.refresh_credit_options`. `refund_requests` (requested, completed).
- **Pinned without customer (AD-23):** confirmed booking with `customer_id = null` counts in capacity; jobs and notifications skip null. Any new table with `customer_id` extends `private.bind_purchase` and its test.
- **Sensitive actions:** one `private.plan_<name>` behind `preview_<name>` and the action; `p_confirmed` / `CONFIRM_REQUIRED`; register in `lib/admin/sensitive-actions.ts`. Sensitive in E3: cancel/delete session, refund completion, entitlement correction, extension, credit alternatives change.
- **Notifications:** only `private.enqueue_notification` in the same transaction, every caller passes all `allowed_vars`. Adding a type to the `notification_templates.type` check is a `drop constraint` migration the user runs in the SQL Editor.
- **Jobs:** pg_cron active; `private.job_complete_events` every 5 min, safe to rerun. Auto-extend is idempotent (unique week per entitlement in `entitlement_corrections`); scheduling in 5.10.
- **Deletion (3.17):** only for a session with no row in `bookings` (`on delete restrict`); otherwise cancel. `work_sheets` cascade, so audit its data too.
- **Caching:** availability, `/me` and `/admin` are dynamic with `Cache-Control: private, no-store`.

## UX & Interaction Patterns

- Every screen or component change starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. Mockups: `key-booking-sheet.html`, `key-public-session.html`.
- Customer copy never mentions Tal; the contact button is "צרי קשר". The cancel deadline is not shown to the customer; the cancel/move button knows if it is allowed. Sheet confirm button: "להרשמה".
- Shared `session-card` and `concept-header`; no regular/couple label to the customer.
- Results always in `inline-notice` (centered, icon at line start), no optimistic confirmation; button busy until response; idempotency key on sheet open. Blocks show the reason and swap the button for the alternative action. No waitlist button until 5.6.
- Admin: session cancel and delete in `sensitive-confirm-dialog`; value changes in `value-change-row`; manual booking to a full session: "המפגש מלא ({n}/{n})" plus "להעלות את המכסה".

## Cross-Story Dependencies

- Order: 3.10 after 3.9; 3.16 after 3.10; 3.17 after 3.4, 3.7 and 4.10; 3.18 after 3.10 and 3.5; 3.13 after 3.12; 3.14 after 3.13; 3.19 after 3.4 and 3.5.
- Rounds: round 4 runs 3.10, 3.13 and 3.17 then 3.19 in parallel; round 5 runs 3.16 and 3.14 (both send `entitlement_changed`); round 6 runs 3.18 alongside 5.6.
- E5: 5.6 (waitlist) comes after 3.10 and 3.5, redefines `move_booking` and the booking functions, and adds "booked and waiting" plus `notify_waitlist` wherever a place is released. Whoever merges second between 5.6 and 3.18 reruns all booking tests. Push in 5.8, reminders in 5.17, extension scheduling in 5.10.
- `admin_get_attention_items` is extended by several stories (3.13 adds bookings hit by a correction); never two in the same round.
- A paid pinned purchase left without a place after a business cancel is handled in 3.13.
- After every merge with a migration, regenerate `lib/supabase/database.types.ts`.
- Reusable: `components/admin/sensitive-confirm-dialog.tsx`, `components/admin/value-change-row.tsx`, `components/shared/session-card.tsx`, `components/shared/concept-header.tsx`, `components/shared/inline-notice.tsx`.
