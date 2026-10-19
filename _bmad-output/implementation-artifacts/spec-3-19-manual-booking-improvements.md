---
title: 'Story 3.19: Manual booking improvements (only fundable sessions)'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'd8bc591ea1c6c9a9308f9b6f1e8579590833db4c'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manual booking screen (`/admin/sessions/book?customer=`) lists every open session, so Tal is offered sessions the customer's entitlements can't fund (a couple "עם סבתוש" session for a card-only customer) and learns it only from the refusal in the sheet (user decision 2026-10-13, 4.3 local check).

**Approach:** A new admin read RPC lists the open sessions for one customer, keeping only those `private.plan_funding(..., 'admin')` can fund plus those she is already booked for, and returns how many were hidden. The screen shows that list and, when something was hidden, one explanatory line (user decision 2026-10-18: hide plus an explanatory line).

## Boundaries & Constraints

**Always:**
- Funding is decided only by `private.plan_funding(p_customer_id, event_id, party, 'admin')`, party = 2 for a `couple` session, else 1 (as `admin_book_customer`). No funding logic in TS; the page only reads the returned list and count.
- Base set as `admin_list_bookable_events`: `status = 'published'` and `starts_at > now()`, same row fields, same order (`starts_at`, `id`). A session is kept when `plan_funding` returns `ok` or she has a `confirmed` booking there; every other base session counts in `hidden`.
- Fullness is not a filter: a full fundable session stays listed, as today.
- RPC contract (AD-5): `security definer`, `search_path = ''`, `volatile`, `private.is_admin()` check first (`NOT_AUTHORIZED`), then the customer must exist, be activated and not anonymized, else `CUSTOMER_NOT_AVAILABLE` (as `admin_book_customer`), then `private.refresh_customer_credits(customer)` before reading funding, as `preview_admin_book_customer` does (user decision 2026-10-19, review). Read, so no idempotency key. Revoke from `public, anon, authenticated, service_role`, one grant to `authenticated`.
- Kept as built in 4.3: the "רשומה" mark (`loadBookedEventIds` + `markBooked`), multi-select with the free-entries cap (`loadFreeEntries`, `MultiBooking`), the `cap === 0` notice.
- Screen work starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md.
- Microcopy (in `lib/copy/admin.ts`, `sessions`):
  - Hidden line: one hidden: "מפגש אחד לא מוצג כי אין לה זכות שמתאימה לו"; several: "{n} מפגשים לא מוצגים כי אין לה זכות שמתאימה להם".
  - Nothing fundable, something hidden: "אין מפגש פתוח שהזכויות שלה מתאימות לו", with the existing "הוספת תשלום" button (`/admin/payments/new/existing/{id}`).

**Never:**
- Change `private.plan_funding`, `admin_list_bookable_events` (still used by `/admin/payments/new`), `admin_book_customer`, `preview_admin_book_customer`, or any 3.10 / 3.13 function. Migration is additive only (no `drop`).
- Eligible products per session (3.18), move (3.10), changes to 4.3's multi-booking or cap.
- `/admin/sessions/[id]/book` (a session's own page) is unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card only | Regular card with balance; open regular and couple sessions | Regular listed; couple hidden, `hidden` = 1 | None |
| Couple entitlement | Couple entitlement with balance | Couple session listed | None |
| Couple credit | No couple entitlement; active couple credit whose active option is a couple session | That session listed; other couple sessions hidden | None |
| Already booked | Confirmed booking on a session, no entry left | That session listed (shown "רשומה"); others hidden | None |
| Expired on date / weekday | Card expires before a session, or weekday not allowed | That session hidden | None |
| No entitlements | Nothing to fund | `events` = [], `hidden` = all open sessions; screen shows the nothing-fundable notice | None |
| No open sessions | No published future session | `events` = [], `hidden` = 0; screen shows "אין מפגש פתוח לרישום" as today | None |
| Draft / past | Draft or started session | Never listed, never counted | None |
| Customer caller | Authenticated non-admin | — | `NOT_AUTHORIZED` |
| Bad customer | Unknown, not activated or anonymized id | — | `CUSTOMER_NOT_AVAILABLE` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004212706_pinned_product_approval.sql:1027` -- `admin_list_bookable_events`: copy its row shape and base filter; do not change it.
- `supabase/migrations/20261013161248_couple_and_intro.sql:197` -- live `private.plan_funding` (3.10 and 3.13 don't redefine it; verify against the live DB before coding). Returns `{ok, code, sources}`.
- `supabase/migrations/20261005193624_admin_session_details_and_manual_booking.sql:151,186` -- customer availability check and party rule to mirror.
- `app/admin/(shell)/sessions/book/page.tsx` -- calls `admin_list_bookable_events`; switch to the new RPC, parse `events` with `toBookableEvents`, branch on empty list / `hidden`.
- `app/admin/(shell)/sessions/book/multi-booking.tsx` -- add a `hiddenCount` prop; render the hidden line after the list.
- `app/admin/(shell)/payments/new/event-options.ts` -- `toBookableEvents` (reuse, unchanged).
- `lib/copy/admin.ts:714,747` -- `addPayment`, `noBookableSessions`; add the two new strings next to them.
- `supabase/tests/admin-booking.test.ts`, `couple-and-intro.test.ts`, `cancellation-credits.test.ts` -- fixtures for cards, couple entitlements and couple credits (`support/money`: `seedMoney`, `approve`).
- `supabase/tests/grants.test.ts:114` -- grants list.

## Tasks & Acceptance

**Execution:**
- [x] (session main, after 3.10 is merged) merge `origin/main`; read the live `plan_funding` with `execute_sql` (`pg_get_functiondef`) and confirm the `admin` mode is as in the Code Map.
- [x] `supabase/migrations/<ts>_manual_booking_fundable.sql` -- `public.admin_list_customer_bookable_events(p_customer_id uuid) returns jsonb` = `{events: [...], hidden: int}`, per the Always rules, with grants. The user runs it in the SQL Editor; the session checks the function exists, records it in `schema_migrations`, runs `get_advisors`, regenerates `lib/supabase/database.types.ts`.
- [x] `supabase/tests/manual-booking-funding.test.ts` -- one test per matrix row. If 3.13 is merged first, add: after an entitlement correction (expiry or session kind), the list follows the new values.
- [x] `supabase/tests/grants.test.ts` -- add the new function line.
- [x] `lib/copy/admin.ts` -- the two strings.
- [x] `app/admin/(shell)/sessions/book/page.tsx`, `multi-booking.tsx` -- frontend-design first; wire the RPC, the nothing-fundable notice (warning `InlineNotice` with the add-payment button) and the hidden line (muted text after the list; no second add-payment button when the `cap === 0` notice already shows one).
- [x] Unit test for the hidden-line copy and the page branch (pure helper in `book-items.ts` if a branch function is extracted).

**Acceptance Criteria:**
- Given a card-only customer, when Tal opens her manual booking screen, then no couple session is offered and the hidden line shows the count.
- Given she is booked for a session, when the list renders, then it still shows "רשומה", and multi-select still stops at her free entries.
- Given `/admin/payments/new` for a pinned product, when it loads, then its session list is unchanged.

## Implementation Notes

- 2026-10-19 (session main): merged `origin/main` (3.10, 3.17). Live `private.plan_funding` checked with `execute_sql`: the 3.5 definition (card never funds couple; pinned funds its own session outside `self`/`online`). 3.10 did not redefine it.
- Session constraints (user, 2026-10-19): work only inside the worktree `.claude/worktrees/story-3-19`. Do NOT run `npm run test:db` and do not apply the migration (no `apply_migration`, no `execute_sql` writes); the shared DB is busy with 3.13's merge. Write the migration and DB tests; the session main applies and runs them later. Code, `npm test`, lint, typecheck and build are allowed. No git operations.
- 2026-10-19 (subagent): built. Migration `20261018215548_manual_booking_fundable.sql` written, NOT applied; `database.types.ts` gets the new function by hand (same shape `generate_typescript_types` gives) -- session main regenerates after applying. 3.13 not merged, so its extra test is not added. `manual-booking-funding.test.ts` not run. Couple-credit row: plan_funding also funds the credit's origin session, so it is listed too (the test asserts the option is listed and another couple session hidden). Page branch extracted as `bookListView` / `parseCustomerBookable` in `book-items.ts`. Build: compiles and typechecks; prerender fails only because the worktree has no `.env.local`.
- 2026-10-19 (subagent, review fixes): function `volatile` + `perform private.refresh_customer_credits(v_customer)` after the customer check; hidden line carries "הוספת תשלום" unless the `cap === 0` notice shows it; DB tests added (pinned entitlement, cancelled booking only, order) -- not run; render test `multi-booking.test.tsx`.

- 2026-10-19 (session main): merged 3.13 and the audit-log fix. Migration run by the user in the SQL Editor, checked (volatile, definer, grant only to `authenticated`, refreshes credits) and recorded in `schema_migrations`; advisors: only the approved WARNs; regenerated types match. Added the 3.13 test (extended expiry opens a hidden session). `test:db`: manual-booking-funding 16/16; admin-booking, open-cards, couple-and-intro, cancellation-credits, pinned-approval, multi-booking, entitlement-corrections, grants pass. `demo:seed` refused (demo data in the DB, `.demo-data.local.json` missing everywhere; unrelated, nothing changed). lint, typecheck, format, `npm test` (2342), build pass.

## Spec Change Log

- **2026-10-19, review pass 1 (user decision):** finding 1 (stale credit options). Frozen RPC contract amended by the user: `volatile` and `refresh_customer_credits` before funding, as the previews. Avoids a credit's replacement option staying hidden. KEEP: everything else in the RPC and screen as built.

- **2026-10-19, phone check (user decisions):** (1) the manual booking screen shows the customer's name only, without the phone (the payment form and `/admin/sessions/[id]/book` keep name and phone); (2) the customer card (`/admin/customers/[id]`) gets a "לרישום למפגש" button after the balances, linking to `/admin/sessions/book?customer={id}`, shown only once she is activated (the page comment said 4.2 would add it; it never did). KEEP: everything else as checked on the phone.
- **2026-10-19, phone check 2 (user decision):** the top of the manual booking screen had four headings with no hierarchy. Now one heading only: her name as the page `h1`, in the old "בחירת מפגש" style (22px, light); "רישום ידני" and "בחירת מפגש" are removed from the screen ("רישום ידני" stays the tab title and the heading of the customer-not-available notice). The free-entries line keeps its size, without "יש לה": "{n} כניסות פנויות", "כניסה פנויה אחת", "אין כניסות פנויות".

## Review Triage Log

Pass 1 (2026-10-19): high 0, medium 2, low 4, false 0, maybe-false 0.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | edge | RPC skips `private.refresh_customer_credits`, so a credit's replaced option (old one full) stays hidden until another path refreshes | medium | intent_gap | Every admin/customer preview refreshes first (`cancellation_credits.sql:2105`); frozen block says `stable`, no lock. User amended the frozen contract (2026-10-19): `volatile` + refresh after the checks; patched. |
| 2 | edge | Hidden line has no "הוספת תשלום" button when cap > 0 (all rows booked, nothing else fundable: no way forward) | medium | patch | Spec task: button on the hidden line unless the `cap === 0` notice shows one; implementation omitted it. |
| 3 | blind | No test for a pinned entitlement (the only `admin` vs `self` difference) | low | patch | Add: pinned entitlement lists its session, hides another. |
| 4 | blind, vgap | `status = 'confirmed'` keep rule not pinned by a test | low | patch | Add: cancelled booking (refund, no credit) on an unfundable session is hidden. |
| 5 | vgap | Row order not pinned by a test | low | patch | Add: three sessions inserted out of order list by date. |
| 6 | blind, vgap | Hidden line in `MultiBooking` has no render test | low | patch | Add `multi-booking.test.tsx` (shown at 2, absent at 0). |

Rejected: CUSTOMER_NOT_AVAILABLE race between the page check and the RPC (rare, adds a branch); pinned-only customer with cap 0 (pre-existing 4.3 cap, pinned entries are placed at approval); credit origin session also listed (existing `plan_funding` rule, user decision 2026-10-10; spec forbids changing it); 3.13 follow-up test (task stays open, runs after 3.13 merges); no count in the nothing-fundable notice (copy per spec); test drafts every published session in rollback (existing 3.5/3.7 pattern); intent R2/R3/R5 (per-session funding, fullness and pinned null-customer bookings are outside the intent).

## Design Notes

A new RPC rather than a parameter on `admin_list_bookable_events`: adding a parameter changes the signature (a `drop`, run by hand) and the pinned-approval form needs the unfiltered list. `hidden` comes from SQL so the screen never counts or decides funding.

## Verification

**Commands:**
- `npm run test:db -- supabase/tests/manual-booking-funding.test.ts` plus `admin-booking`, `open-cards`, `couple-and-intro`, `cancellation-credits`, `pinned-approval`, `grants` -- pass (not while the user tests on the phone).
- `npm run lint && npm run typecheck && npm test && npm run build` -- pass.
- `npm run demo:seed` -- runs clean after the migration.

**Manual checks:**
- Phone, dev server: card-only customer sees no couple session and the hidden line; couple-credit customer sees its alternative session; a booked session shows "רשומה"; multi-select stops at the cap.
