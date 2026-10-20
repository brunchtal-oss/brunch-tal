---
title: 'Waitlist (5.6)'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '37ad1d0ac13e5a9861950c9d2477378e72be3632'
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

**Problem:** A customer who finds a session full has no way to hear when a place frees up (source §5 lines 215–221, §7 line 256 "ממתינות", §8 line 293). `events.waitlist_cycle` and the `waitlist_spot` template exist but nothing uses them.

**Approach:** A `waitlist_entries` table with join/leave RPCs for a logged-in customer (no funding needed), one `private.notify_waitlist` called wherever a place is released, removal from the list on a successful booking, a recheck before each push, and the list on the customer session page, "ההרשמות שלי" and the admin session details.

**User decisions (2026-10-20):** when Tal cancels a session, its waiters leave the list silently (no notification). Binding a purchase with a place in a session she waits for binds normally and removes her from the list (source §5 line 221 wins over SPEC line 221's conflict rule).

**Build gate (user):** before building, confirm 3.16 is merged and merge `origin/main` into `story-5-6-waitlist`. No `test:db` and no migration until then.

## Boundaries & Constraints

**Always:**
- **Table:** `waitlist_entries(id, customer_id not null → profiles, event_id → events on delete cascade, party_size 1|2, joined_at, status active|left|booked|closed, last_notified_cycle int null, closed_at)`. Unique partial index `(customer_id, event_id) where status = 'active'`; index `(event_id) where status = 'active'`. RLS: customer selects own (`customer_id = (select private.current_customer_id())`), admin selects all (`(select private.is_admin())`). Explicit grants: `select` to `authenticated`, all to `service_role`; no browser writes.
- **`join_waitlist(p_event_id, p_idempotency_key)`** (granted to `authenticated`): `private.current_customer_id()` null (guest, admin, inactive) → `NOT_AUTHORIZED` → `idempotent_begin` → lock profile → event. Checks in order: not `published` → `NOT_FOUND`; `now() >= registration_closes_at` → `REGISTRATION_CLOSED`; she has a real booking → `ALREADY_BOOKED`; active entry → `ALREADY_WAITLISTED`; `occupied_places + party_size <= capacity_adults` → `EVENT_NOT_FULL`. Inserts with `party_size` 2 for `couple`, else 1. No funding check.
- **`leave_waitlist(p_event_id, p_idempotency_key)`**: same caller rule, lock profile → event → entry; no active entry → `NOT_WAITLISTED`; sets `left`, `closed_at`. Allowed any time.
- **`private.notify_waitlist(p_event_id uuid, p_free_before int)`**: caller holds the event lock and passes `capacity_adults - occupied_places` read before its change. Returns at once unless the event is `published`, `now() < registration_closes_at` and not started. `s` = the event's party size. Only when `p_free_before < s` and the free places now `>= s`: `waitlist_cycle + 1`, then for each active entry (`order by id for update`) `private.enqueue_notification(customer_id, 'waitlist_spot', event_id||':'||s||':'||cycle, {date: format_day_month(local day)}, '/me/sessions/<event_id>?from=waitlist')` and `last_notified_cycle := cycle`. A single place never triggers a couple session; a second release before the session fills sends nothing new; filled then freed again → new cycle.
- **Callers (redefine from the live definition, only the added lines):** `private.cancel_core` reads free places at its start and calls `notify_waitlist` after its refresh calls and before its own `enqueue_notification`. This covers `cancel_booking`, `admin_cancel_booking`, the source of `move_booking`/`admin_move_booking` (via `move_core`) and is a no-op in `admin_cancel_event` (event already `cancelled`). `admin_update_event` calls it when `capacity_adults` rises. `choose_credit_outcome` frees no place (the booking was cancelled by `admin_cancel_event`) and is not changed.
- **Removal on booking:** `private.book_core` sets her active entry for that event to `booked` (`closed_at`) after its refresh and audit, before `notify_booking_confirmed`; skipped when `customer_id` is null. Covers `book_session`, `book_sessions`, `admin_book_customer`, pinned placement and the move target. `private.bind_purchase` does the same for each confirmed booking it binds.
- **Lock rule:** every write to an event's entries holds that event's lock (join, leave, notify, `book_core` callers, `admin_cancel_event`), except `bind_purchase` (one customer, under her profile lock) and the cleanup (`skip locked`). `notify_waitlist` does not lock other customers' profiles; the event lock serializes. Order stays `… refund_requests ← waitlist_entries ← notification_jobs`.
- **Business cancel:** `admin_cancel_event` sets the event's active entries to `closed` after the cancel loop.
- **Recheck before send:** redefine `claim_push_jobs` from live (keep `notification_id` in the output): a `waitlist_spot` job whose event (dedupe key part 3) is no longer `published`, has `now() >= registration_closes_at`, has fewer than `party_size` (part 4) free places, has `waitlist_cycle` ≠ part 5, or whose recipient has no active entry → `skipped`, not returned. The in-app notification stays.
- **Reads:** new `get_my_waitlist()` → her active entries whose event is `published` and still open, `[{event_id, starts_at, concept_name, kind, joined_at}]` by `starts_at`. Redefine `admin_get_event_details` from live + `waitlist:[{customer_id, customer_label, joined_at, notified bool}]` (active, by `joined_at`; `notified` = `last_notified_cycle` not null).
- **Customer session page** (`frontend-design` first; after `BookingPanel`, the companion note stays where it is): preview `EVENT_FULL` and no entry → `השולחן מלא הפעם. אפשר להצטרף לרשימת ההמתנה ונעדכן אם יתפנה מקום` + `להצטרף לרשימת ההמתנה`. Active entry (any preview) → `status-chip` pending `ברשימת ההמתנה` + `אם יתפנה מקום נשלח לך הודעה. המקום לא נשמר, ומי שנרשמת ראשונה מקבלת אותו` + `לצאת מרשימת ההמתנה`; with `?from=waitlist` and still full: `המקום כבר נתפס. את עדיין ברשימת ההמתנה`. Join result: `הצטרפת לרשימת ההמתנה`; leave result: `יצאת מרשימת ההמתנה למפגש ב־{DD.MM}. לא נשלח לך עדכון על המפגש הזה`. Button swaps in place, result in `inline-notice` (focus moves to it), no sheet or dialog.
- **"ההרשמות שלי":** a section `רשימת ההמתנה` after upcoming bookings, a `SessionCard` per entry with the pending chip and `לצאת מרשימת ההמתנה`; the page is not "empty" when only this section has items.
- **Admin details:** a section `ממתינות ({n})` after "מי מגיעה", hidden when empty; each row: name linking to the customer card, `הצטרפה ב־{DD.MM HH:MM}`, and `קיבלה הודעה` when notified.
- New buttons use `OnlineButton`/`useOnlineGuard`. Server Actions in the page folders' `actions.ts` (shape check → `callRpc`). New codes (`ALREADY_WAITLISTED`, `EVENT_NOT_FULL`, `NOT_WAITLISTED`) only in `lib/errors.ts`.
- **Audit:** `join_waitlist`, `leave_waitlist` → `private.audit` on `waitlist_entries`, shown. Labels `הצטרפות לרשימת המתנה` / `יציאה מרשימת המתנה`; results `נוספה לרשימת ההמתנה` / `יצאה מרשימת ההמתנה`. Booking/bind/cancel-event/notify changes ride on the existing audit rows.
- **Template:** `waitlist_spot` (`allowed_vars ['date']`) unchanged; its body already says a matching entry is needed and the place is guaranteed only after booking.

**Never:** a queue or priority (`joined_at` is stored only); reserving a place; changing `preview_book_session`, `plan_funding`, `get_event_availability`, the push route/worker, the public session page (guests see no waitlist), the `waitlist_spot` wording; summing `party_size` outside `occupied_places`; touching 3.16's credit functions; "טל" in customer copy; `←`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Join, no funding | full session, customer with no card | active entry; she still cannot book | — |
| Twice | active entry | nothing | `ALREADY_WAITLISTED` |
| Booked | confirmed booking | nothing | `ALREADY_BOOKED` |
| Not full | free place | nothing | `EVENT_NOT_FULL` |
| Guest / admin | no customer | nothing | `NOT_AUTHORIZED` |
| Closed | after `registration_closes_at` | nothing | `REGISTRATION_CLOSED` |
| Release | full regular, 2 waiting, one cancels | cycle +1; both get one `waitlist_spot` | — |
| Second release | then another cancels before refill | no new notification | — |
| Refill + free | someone books, then cancels | new cycle, new notification | — |
| Couple, one place | couple session, free 0 → 1 | nothing; free 1 → 2 notifies | — |
| Capacity up | full, Tal raises capacity | notification | — |
| After close | release after `registration_closes_at` | no cycle, nothing | — |
| Books | waiting customer books (self, admin, move target) | entry `booked`, gone from lists | — |
| Move | booking moved out of a full session | source waiters notified | — |
| Business cancel | event cancelled | entries `closed`, no `waitlist_spot` | — |
| Stale push | spot taken (or she left/booked) before claim | job `skipped`, no send | — |
| Bind | claim of a pinned purchase for a session she waits for | entry `booked` | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261018075214_move_booking.sql` -- live `private.book_core` (:272), `private.cancel_core` (:33), `move_booking` (:1256), `admin_move_booking` (:1339); `move_core` live in `20261018092457_move_booking_review_fixes.sql:184`. Always copy from `pg_get_functiondef`.
- `supabase/migrations/20261010141240_cancellation_credits.sql` -- `cancel_booking` (:1473), `admin_cancel_booking` (:1592), `book_session` (:1733), `book_sessions` (:1834), `admin_book_customer` (:1962), `admin_update_event` (:2435, capacity check, locks event only).
- `supabase/migrations/20261013162639_business_cancel_event.sql` -- `admin_cancel_event` (:682, sets `cancelled` then `cancel_core(...,'pending')`), `choose_credit_outcome` (:1256, frees nothing).
- `supabase/migrations/20261014114926_refund_completion_targets.sql:273` -- `private.bind_purchase` (locks profile → bookings → …; no event lock; `BIND_CONFLICT` for a real booking).
- `supabase/migrations/20261013182941_pinned_single_notification.sql:267` -- live `claim_push_jobs`; skip pattern = the 24h `skipped` branch. Statuses include `skipped`.
- `supabase/migrations/20261001184225_create_notification_core.sql:223` -- `enqueue_notification(recipient, type, discriminator, vars, target_path, body_override)`.
- `supabase/migrations/20261007183144_two_photo_consents.sql` -- last `admin_get_event_details` found; confirm live.
- `supabase/migrations/20261004143612_concepts_and_events.sql:74` -- `events.waitlist_cycle` exists. Template row `waitlist_spot` exists (title `התפנה מקום ב{date}`).
- `private.occupied_places`, `private.format_day_month`, `private.lock_customer`, `private.idempotent_begin/finish`, `private.audit` -- reuse.
- `app/me/sessions/[id]/page.tsx`, `booking-panel.tsx` (`blocked` branch :180), `booking-preview.ts` -- session page; actions live in `app/me/sessions/actions.ts` (`bookSessionAction` pattern).
- `app/me/bookings/bookings-list.tsx`, `cancel-result.ts`, `actions.ts` -- "ההרשמות שלי".
- `app/admin/(shell)/sessions/[id]/page.tsx`, `load-details.ts` (`parseEventDetails` :65), `attendee-list.tsx`.
- `components/shared/online-button.tsx`, `components/shared/status-chip.tsx` (tone `pending`), `lib/time.ts` `formatDayMonth`.
- `lib/copy/customer.ts`, `lib/copy/admin.ts` (`sessions` :602), `lib/copy/audit-actions.ts` (`SHOWN_AUDIT_ACTIONS`; test scans migrations), `lib/errors.ts`.
- Tests: `supabase/tests/push.test.ts` (:408/:422 skip models), `settings-and-templates.test.ts` (`fillAllFields` :667, `expectRendered`), `self-booking.test.ts:830` (party_size scan), booking/cancel/move/couple/business-cancel/bind/events-admin suites.

## Tasks & Acceptance

**Execution:**
- [ ] (main session) Confirm 3.16 merged; merge `origin/main` into the branch; regenerate nothing yet.
- [ ] `supabase/migrations/<ts>_waitlist.sql` (`npx supabase migration new waitlist`) -- table, RLS, grants, `join_waitlist`, `leave_waitlist`, `get_my_waitlist`, `notify_waitlist`, redefinitions of `cancel_core`, `book_core`, `bind_purchase`, `admin_update_event`, `admin_cancel_event`, `claim_push_jobs`, `admin_get_event_details`; revoke/grant per AD-5. Additive: the user runs it in the SQL Editor, the main session records it; then advisors and `database.types.ts`.
- [ ] `supabase/tests/waitlist.test.ts` -- every matrix row via the real RPCs, plus grants and RLS (customer sees only hers, no insert).
- [ ] `supabase/tests/push.test.ts` -- stale `waitlist_spot` cases (spot taken, she left, old cycle, closed) → `skipped`; valid one returned.
- [ ] `supabase/tests/settings-and-templates.test.ts` -- `fillAllFields('waitlist_spot')`, real flow (`cancel_booking` frees a place), `expectRendered`.
- [ ] `lib/errors.ts`, `lib/copy/customer.ts`, `lib/copy/admin.ts`, `lib/copy/audit-actions.ts` -- codes, copy, audit entries and labels.
- [ ] `app/me/sessions/actions.ts`, `app/me/sessions/[id]/waitlist-panel.tsx`, `page.tsx` -- `frontend-design` first; join/leave actions and panel with tests.
- [ ] `app/me/bookings/` -- waitlist section, leave action, tests.
- [ ] `app/admin/(shell)/sessions/[id]/` -- `load-details.ts` parse `waitlist`, `waitlist-list.tsx` after `AttendeeList`, tests.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- close 5.6's part of the 4.7 item (line 469); add for 5.10: `job_cleanup` sets active entries of started/cancelled/completed events to `closed` (unless 5.10 merged first, then add it to `job_cleanup` here); add for 4.6: `admin_anonymize_customer` deletes her `waitlist_entries`.
- [ ] Rerun all E3 booking, cancel, move, couple, business-cancel and bind suites (`npm run test:db`).

**Acceptance Criteria:**
- Given two waiting customers and one release, when the worker runs twice, then each gets exactly one push and one in-app notification.
- Given a customer on a waitlist, when she opens "ההרשמות שלי" offline, then `לצאת מרשימת ההמתנה` is `aria-disabled` and sends nothing.
- Given a waiting customer, when Tal opens the session details, then she appears under `ממתינות` with her join time.

## Implementation Notes

- **Night run 2026-10-20 (user, via the manager session):** 3.16 merged (PR #102) and `origin/main` merged into the branch (baseline above). Write code, migration files (`npx supabase migration new`) and tests; run `npm test`, `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, `npm run build`. **Do not** apply any migration (no MCP `apply_migration`/`execute_sql` writes), run `test:db`, `demo:seed`/`demo:clear`, regenerate types via MCP, commit, push or open a PR. Write `supabase/tests/*` DB tests without running them. Without a regenerated `database.types.ts`, hand-add the new RPCs (`join_waitlist`, `leave_waitlist`, `get_my_waitlist`) to `lib/supabase/database.types.ts` in the generator's exact shape so `callRpc` typechecks; the morning regeneration replaces it.
- **State at the end of the night run:** code, migration `20261019233604_waitlist.sql` (additive, one file) and tests written; review pass 1 patched; `npm test`, lint, format, typecheck and build pass. Status stays `in-review` (not `done`) until the user runs the migration in the SQL Editor, the main session records it, runs `get_advisors`, regenerates `database.types.ts` and `npm run test:db` passes (all DB tests unrun so far). Then phone check, commit and PR, each after her OK.
- **Morning 2026-10-20:** the user ran the migration in the SQL Editor; the main session recorded it (`20261019233604 waitlist`), `get_advisors` shows only the approved WARNs, `database.types.ts` regenerated (identical to the hand-written shape). `npm run test:db`: 1165 passed, 2 failed — `waitlist.test.ts` "refill then free" (test ordered by `created_at`, equal inside one transaction; now ordered by `dedupe_key`, the file passes 25/25) and `notifications.test.ts` "hold the approved seed" (known, pre-existing since 3.14/3.16, already in `deferred-work.md`). All E3 suites pass.
- **Phone check 2026-10-20 (user decisions, logged in the SPEC memlog):** waiter line only `אם יתפנה מקום נשלח לך הודעה`, then the push card with `רוצה לקבל התראה לטלפון כשמתפנה מקום?` while push is not on and can still be asked, also after "לא עכשיו" in the center, until she answers "לא עכשיו" to this offer (`shouldOfferOnWaitlist`, localStorage `push-waitlist-declined`; `PushCard`/`PushOffer` take optional `askText`, `askWhenOff`, `onChoice`); `waitlist_spot` body `המקום מובטח רק אחרי שההרשמה מאושרת` (migration `20261020091519_waitlist_wording.sql`, only an unedited template; overrides source §5 line 219). In the customer notification center a `waitlist_spot` whose place is gone shows `המקום כבר נתפס` and stays in the list: `get_taken_waitlist_spots(p_ids)` (migration `20261020091901_waitlist_spot_taken.sql`; published session, new cycle or fewer free places than the party size, not when she booked it), called by `lib/notifications/load.ts` for the customer surface only.
- **Main-session change after the build:** on a full session (`waitlistShowsFull`) the page hides `BookingPanel`, whose own `EVENT_FULL` notice duplicated the waitlist offer; `WaitlistPanel` ends with `לכל המפגשים` instead.
- **Copy from the latest migration file**, not the live DB: newest definitions include 3.16's `20261019204039_credit_adjustments.sql`, `20261019211608_credit_adjustments_review_fixes.sql`, `20261019230219_credit_card_in_use_booking.sql`. Grep all of `supabase/migrations` for each function before redefining it.

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-10-20, night run; DB tests written but not run).** Verdicts: high 0, medium 1, low 8, false 3, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Join/leave error vanishes: `router.refresh()` in `finally` re-renders or unmounts the button | medium | patch | Refresh only on success. |
| 2 | Session page shows "waiting" after registration closed, unlike `get_my_waitlist` | low | patch | `waitlistState` → none on `REGISTRATION_CLOSED`. |
| 3 | `isWaiting` `.maybeSingle()` without a limit | low | patch | `.limit(1)`. |
| 4 | `get_my_waitlist` fetched sequentially on "ההרשמות שלי" | low | patch | Parallel read. |
| 5 | `joinedAt("")` copy function misused | low | patch | Plain label. |
| 6 | Untested: couple join with one free place; size-2 push recheck; claim twice; leave after close; leave replay | low | patch | Tests added. |
| 7 | Reopening registration with free places notifies no one | low | defer | `deferred-work.md` (5.20). |
| 8 | Session page has no render test | low | defer | `deferred-work.md` (5.20). |

Rejected: 9 no `ResultNoticeHost` on the session page (false, `page.tsx` wraps the panels in one); 10 recheck at claim not at send (false, the worker sends right after claiming); 11 waiting + bookable shows the "we'll notify" line (spec rule "active entry (any preview)"); 12 `notified` never resets after a refill (spec defines it as `last_notified_cycle` not null); 13 `party_size` column unread, no `×2` for couple waiters (cosmetic); 14 bookings leave reuses the sessions action (reuse over duplication); 15 test names say "quit" (the RTL lint bans "left"); 16 hiding the BookingPanel's full notice on a full session (main-session fix: the two "full" notices duplicated; the panel still comes after it in every other state).

## Design Notes

`p_free_before` is passed in because the transition must compare before/after in the same locked transaction (AD-14); `cancel_core` knows it at entry, `admin_update_event` before `save_event`. One `waitlist_cycle` per event is enough: an event has one party size (kind can't change once booked), so the discriminator `event:size:cycle` is unique per release. `?from=waitlist` lets the page show "already taken" only to someone arriving from the notification.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, `npm run build` -- pass.
- `npm run test:db` -- all suites pass, including the E3 suites.
- `get_advisors` (security) -- only approved WARNs.

**Manual checks:**
- Phone: full session → join → leave; cancel as another customer → push arrives once and opens the session page.
