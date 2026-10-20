# Epic 3 Context: Sessions and booking, from atomic booking to cancellation, credit and refund

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the core of sessions and bookings: sessions created from concepts, atomic self-booking (single and multi-date), registration close and manual booking, pinned products (single, intro, couple) booked at payment approval, couple and intro bookings, self-cancel and admin cancel, cancellation credits with alternatives, refund requests and completion, business cancel or change of a session, moving a booking, session deletion, session completion, entitlement corrections, the empty-week auto-extend rule, and eligible products per session. At the end, a customer with a card books on her phone without approval, sees the balance drop, cancels 48h or more ahead and gets the entry back on the same card; two customers racing for the last place get one confirmation; Tal cancels a session and sees correct credits and refunds. The RPCs here are the same ones the admin UI uses. All stories are done except 3.18 (eligible products per session), the last one in the epic.

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
- Story 3.10: Move a booking (done)
- Story 3.16: Admin credit adjustments (done)
- Story 3.12: Session completion job (done)
- Story 3.17: Delete a session (done)
- Story 3.18: Eligible products per session
- Story 3.13: Entitlement corrections (done)
- Story 3.14: Auto-extend rule for empty weeks (done)
- Story 3.19: Manual booking improvements (done)

(3.15 was cancelled and folded into the unified cleanup 5.20.)

## Requirements & Constraints

- **Self-booking:** server checks published, registration open, no duplicate, enough places, valid funding; then saves the booking and reserves funding in one transaction. Failure takes no place and deducts nothing. Pinned products are never self-booked.
- **Occupancy to customers:** only "available / last places / full", sized to the booking (couple with one free place = full), never a number. Babies don't count. Guests see no occupancy.
- **Registration close:** default 20:00 the day before, Asia/Jerusalem, server time, DST-safe; overridable per setting and per session. Admin books any time with the same funding and capacity checks; no silent over-capacity.
- **Session kind** follows the concept's `default_kind`. Couple sessions are never funded from a card, not even by Tal (no couple offset; `admin_offset_paired` is not built).
- **Intro:** only for a customer with no `confirmed`/`completed` booking and no active intro; cancel before the session doesn't count, no-show counts.
- **Cancel:** 48h window inclusive, server-checked. Card: entry returns to the same card. Pinned self-cancel: refund or credit; business cancel: choice with no deadline (`choice_pending`).
- **Credit:** one booking to one of the next N matching sessions (N snapshotted), same kind, counted from the cancelled session's date; full or cancelled alternatives are replaced by the next. Admin-added/removed alternatives keep their `added_by` / `replaced` semantics.
- **Refund:** total refunds never exceed what was paid; "refunded" only after Tal confirms date, amount and optional reference.
- **Auto-extend:** +7 days per local week (Sun-Sat) overlapping validity with no published or completed matching session (couple doesn't count for a regular card, cancelled not counted, full counts). Once per week, idempotent; only cards with something left.
- **Eligible products (3.18):** the source lists "eligible products" as a session field, overriding the temporary 2026-10-04 deferral. A session can be marked with the products whose entitlements may fund it; an entitlement from an unmarked product does not fund it, in self-booking and in Tal's manual booking, with a clear reason. The check applies only to new bookings; existing bookings stay unchanged. Changing the selection is audited (old -> new). Customers never write to `event_products`. On the public session page, when `display_price_agorot` is empty, the eligible product's price is shown as the default; display only, never changes what a payment or entitlement costs. A session that does not accept a card's product is not a matching week session for auto-extend. Open: meaning of a session with no product marked, and which price to show when several are eligible; settle in the spec with the user.
- Every reason field is optional; every action is audited. Fake data only.

## Technical Decisions

- **Lock order:** `activation_tokens` > `profiles` > `events` > `bookings` > `entitlements` > `cancellation_credits` > `credit_options` > `payments` > `refund_requests` > `waitlist_entries` > `notification_jobs`, by `id` within a table. `profiles` is the customer mutex; take all locks at the start. Never lock a child to find its parent. Move: profile, then both events by id.
- **Places:** only `private.occupied_places` sums `party_size` of `private.is_real_booking` rows; no stored counter.
- **Funding:** `private.plan_funding(customer, event, party_size, mode)` (`self`/`admin`/`move`/`online`) is the only funding chooser, called by `book_session`, `book_sessions`, `admin_book_customer`, `move_booking`, the booking sheet RPC, every preview and the manual-booking session list (3.19). Priority: available credit whose active alternative is this event, then an entitlement matching kind, weekday and intro and valid on the session date, by `expires_on`, `id`. Pinned funds only its `pinned_event_id`. 3.18 adds the eligible-products filter here, so every caller inherits it; rerun all booking and waitlist tests after.
- **`event_products`:** `(event_id, product_id)`; matches products to a session without changing existing entitlements. Admin writes only through an RPC; RLS on.
- **Core paths:** `private.book_core` and `private.cancel_core`; `move_booking` uses both. `private.can_self_cancel` is the only boundary check.
- **RPC contract:** security definer, `search_path = ''`, auth check first line, revoke all then one grant, `p_idempotency_key` via `private.idempotent_begin` before any lock. Errors as codes with `P0001`; new code goes into `lib/errors.ts`.
- **Ledger:** `reserve` negative, `release` positive, `use` = 0 at completion, `adjust` non-zero for corrections. Balance only via `entitlement_balances`, never below zero.
- **Pinned without customer:** confirmed booking with `customer_id = null` counts in capacity. Any new table with `customer_id` extends `private.bind_purchase` and its test.
- **Sensitive actions:** one `private.plan_<name>` behind `preview_<name>` and the action; `p_confirmed` / `CONFIRM_REQUIRED`; register in `lib/admin/sensitive-actions.ts`.
- **Notifications:** only `private.enqueue_notification` in the same transaction. Adding a type to the `notification_templates.type` check is a `drop constraint` migration the user runs in the SQL Editor.
- **Auto-extend:** `private.week_has_eligible_session` decides a matching week; 3.18 makes it respect eligible products. Scheduled by 5.10.
- **Caching:** availability, `/me` and `/admin` are dynamic with `Cache-Control: private, no-store`; public session pages refresh after session changes.

## UX & Interaction Patterns

- Every screen or component change starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. Mockups: `key-booking-sheet.html`, `key-public-session.html`.
- Customer copy never mentions Tal; the contact button is "צרי קשר". No regular/couple label to the customer.
- Results always in `inline-notice`, no optimistic confirmation; button busy until response; idempotency key on sheet open. Blocks show the reason and the alternative action.
- Admin session form fields: concept first, date, start and end time, description, image, kind (`chip-type` only in admin), eligible products, adult capacity, registration close, optional display price; no menu field. Value changes in `value-change-row`; session cancel and delete in `sensitive-confirm-dialog`.

## Cross-Story Dependencies

- 3.18 runs in round 7 alongside 4.6 and 5.11, after 3.10, 3.5, 3.14 and 5.6 (all merged), and merges first in its round.
- 5.6 (waitlist) already redefined the booking, cancel and move functions and added "booked and waiting" plus `notify_waitlist`; 3.18 builds on those definitions, not the earlier E3 ones.
- 3.18 closes two deferred items: `event_products` with the funding check, and the default price from the product on public session pages (5.16 currently shows only `display_price_agorot`).
- After every migration, regenerate `lib/supabase/database.types.ts` and run the security advisor.
- Reusable: `components/admin/sensitive-confirm-dialog.tsx`, `components/admin/value-change-row.tsx`, `components/shared/session-card.tsx`, `components/shared/concept-header.tsx`, `components/shared/inline-notice.tsx`.
