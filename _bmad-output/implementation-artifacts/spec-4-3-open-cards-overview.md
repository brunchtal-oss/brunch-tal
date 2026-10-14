---
title: '4.3 Open cards overview'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
baseline_commit: '5d7466465c573e76d512c125655ada855ca84e2b'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal has no single place to see every open card with its entries, so she can't tell who still has free entries before expiry. The home "expiring" rows lead only to one customer's card.

**Approach:** One read RPC `admin_list_open_cards(p_filter)` over `entitlement_balances` and `booking_allocations`, returning entries in the exact shape `admin_get_customer` already returns, so the new screen `/admin/customers/open-cards` renders them with the customer card's existing entry lines. The home "expiring" rows link to the filtered list.

## Boundaries & Constraints

**Always:**
- Open card = `kind = 'card'`, `status = 'active'`, `not is_expired`, `available + reserved > 0` (from `entitlement_balances`). Pinned entitlements (`pinned_event_id is not null`) are never listed. Import opening balances count automatically (an `opening_balance` movement on a card).
- Numbers (`available`, `reserved`, `used`, `expires_on`, `days_left`) come only from `entitlement_balances`, with the same `days_left` formula (Jerusalem date) as `get_my_entitlements` and `admin_get_customer`.
- "עומדת לפוג" = `available > 0 and days_left <= business_settings.admin_expiring_days`, read at call time: exactly the home `expiring_cards` rule (user decision 2026-10-10), so the home rows and the filtered list are the same set.
- `p_filter in ('all','available','expiring')`, otherwise `INVALID_INPUT`. "יש כניסות פנויות" = `available > 0`. Order: `expires_on`, then customer label, then `entitlement_id`.
- `entries` per card = the same shape and rule as `admin_get_customer.entries` today (`{status, starts_at, concept_name, event_id}`, one per allocated unit, cancelled bookings excluded, by `starts_at`). The list renders them with the existing `entryLines` and the same `EntryRow`, so a card reads the same in both places: "השתתפה · {יום DD.MM}", "נרשמה · {יום DD.MM}", "פנויה, יש לשריין", session title "בראנץ׳ {concept}" under it.
- Each list row (`open-card-row`, not clickable as a whole): customer label, product, "נרכשה {DD.MM}", "בתוקף עד {DD.MM}", `status-chip` "עומדת לפוג" when expiring, the entry lines, and two separate buttons "לרישום למפגש" (`/admin/sessions/book?customer={id}`) and "לפרופיל" (`/admin/customers/{id}`). A row with no `customer_id` (unbound purchase) shows the payer label and, instead of the buttons, "עוד לא הצטרפה" (user decision 2026-10-13). Row anchor `id="card-{entitlement_id}"`.
- `segmented-switch` "לקוחות | כרטיסיות פתוחות" as two links in a `nav` (`aria-current="page"`) on both pages. Filters "הכול" · "יש כניסות פנויות" · "עומדת לפוג" as links (`?filter=`), one selected (`aria-current`). Empty: `empty-state` "אין כרטיסיות פתוחות כרגע", with "להצגת כל הכרטיסיות" when a filter is on.
- Home "כרטיסיות שעומדות לפוג": the customer name in each row links to `/admin/customers/open-cards?filter=expiring#card-{entitlement_id}` and the targeted card is visibly highlighted (user decision 2026-10-10; replaces the link to the customer card). One target per row; also for rows without `customer_id`.
- Manual booking screen `/admin/sessions/book?customer={id}` (reached by "לרישום למפגש"; user decision 2026-10-13, phone check): a session where the customer has a `confirmed` booking shows `status-chip` "רשומה" and is not a link. Read through RLS (`bookings`), no RPC change.
- Multi-session manual booking on that screen (user decision 2026-10-13): every other row is a real checkbox (whole row is its `<label>`), up to 20. A bar above the bottom-tab-bar with "לרישום למפגש אחד" / "לרישום ל-{n} מפגשים" opens one `bottom-sheet` "רישום של {name}": per chosen date the existing `preview_admin_book_customer` result (what funds it, or the refusal via `refusalMessage`), and one confirm "לאשר את הרישום". The Server Action books the dates one after another with the existing `admin_book_customer` (one idempotency key per date, made when the sheet opens, kept on retry, new after an answer) and returns `{results:[{event_id, ok, code, booking_id}]}`. The results replace the selection: heading "נרשמה ל-{k} מתוך {n}", per date `status-chip` "נשמר" (success) or "לא נשמר" (expired) with the reason, then "חזרה לרשימה" (re-reads the page). Reuse `app/me/sessions/select/selection.ts` helpers (`toggleSelection`, `parseBookResults`) — not the customer component or its copy. Selection cap (user decision 2026-10-13, local check): at most her free entries, counted as `preview_book_sessions` counts them (sum of `available` of her `active`, non-pinned entitlements with `expires_on` ≥ today in Jerusalem, plus her `active`, not `choice_pending` credits not funding a `confirmed` booking), read through RLS, and never above 20. A line above the list: "אין לה כניסות פנויות" / "יש לה כניסה פנויה אחת" / "יש לה {n} כניסות פנויות"; the bar shows "נבחרו {k} מתוך {n}"; at the cap the other rows are `aria-disabled`. With 0: no checkboxes, an `inline-notice` with `refusalMessage("NO_MATCHING_ENTITLEMENT")` and the existing payment link (as `[id]/book/manual-booking.tsx`). No migration, no new RPC. The single-session page `/admin/sessions/{id}/book` is not changed (it is still reached from a session's own page); the list rows no longer link to it.
- RPC: `security definer`, `search_path = ''`, `private.is_admin()` check first → `NOT_AUTHORIZED`; revoke from all, `grant execute` to `authenticated` only; no idempotency (read).
- Screens start with the `frontend-design` skill, inside DESIGN.md and EXPERIENCE.md.

**Never:**
- The customer card stays exactly as today, including "פירוט הכניסות": no "בוטלה" lines, no new lines or links (user decision 2026-10-10). Cancelled history stays in the existing "היסטוריית הרשמות" page. `admin_get_customer` is not changed. Moving `EntryRow` to a shared file must not change its output.
- No change to `get_my_entitlements`, cancel/booking functions, `admin_get_home` or `admin_get_attention_items` (3.8 changes them). No stored open-cards table.
- On the manual booking screen: no hiding of sessions her entitlements can't fund (depends on 3.5's `plan_funding`; story 3.19). Until then such a date shows its refusal in the sheet and "לא נשמר" if confirmed.
- No credits/refunds (3.9/3.16), corrections or "(כולל הארכה)" (3.13), export (4.4), anonymization (4.6), bell notification (5.10). No `drop` in the migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card 3 used + 1 reserved | `all` | listed; 3 "השתתפה" + 1 "נרשמה" lines, no free line; numbers equal `get_my_entitlements` and `admin_get_customer` | — |
| Last session completes | job runs | card drops from list; stays in customer card unchanged | — |
| Booking on card cancelled | release | line gone, one more "פנויה, יש לשריין"; numbers still equal on all three | — |
| Expired / revoked / refunded / pinned | any filter | not listed | — |
| Reserved only, `available = 0` | `available` / `expiring` | excluded from both; included in `all` | — |
| 5 days left, threshold 21, 1 free | `expiring` | listed with chip; same ids as home `expiring_cards` | — |
| Home row tapped | name link | filtered list, that card highlighted | — |
| Bad filter | `p_filter = 'x'`; URL `?filter=x` | RPC error; page falls back to `all` | `INVALID_INPUT` |
| Customer or anon calls | direct RPC | — | `NOT_AUTHORIZED` / 42501 |
| Already booked | manual booking screen; she has a `confirmed` booking for a session | that row: "רשומה" chip, no checkbox | — |
| Multi booking, all fit | 3 dates chosen, card with 3 free | 3 × "נשמר"; "נרשמה ל-3 מתוך 3"; back to list shows 3 × "רשומה" | — |
| Multi booking, one refused | 3 dates; one is a couple session (card only) or full | 2 × "נשמר", 1 × "לא נשמר" + reason; the 2 are booked | per-date code, no rollback of the others |
| Cap at free entries | card with 1 free (Roni) | one date can be ticked; other rows `aria-disabled`; "נבחרו 1 מתוך 1" | — |
| No free entries | nothing active to fund | no checkboxes; notice + payment link | — |
| Retry after a lost answer | same keys resent | no double booking (each key returns its first result) | — |
| Bad input | 0 or >20 ids, duplicates, non-UUID | nothing booked | `INVALID_INPUT` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql:68-109` -- `entitlement_balances` (latest); no `pinned_event_id` (join `entitlements`).
- `supabase/migrations/20261010141240_cancellation_credits.sql:2903-2935` -- home `expiring_cards`: filter and `customer_label` (`coalesce(b.customer_id,p.customer_id)`, `full_name` or `payer_label`). Copy the rule, don't edit. `:2624-2722` `get_my_entitlements` (`days_left`, `paid_on`): read only.
- `supabase/migrations/20261007183144_two_photo_consents.sql:473-492` -- `admin_get_customer.entries` subquery: copy it verbatim for the list's `entries`. Don't redefine `admin_get_customer`.
- `business_settings.admin_expiring_days` (`20261001162630:245-270`), read with a direct select.
- `app/admin/(shell)/customers/page.tsx`, `customer-items.ts:48,55` (`listHref`, `customerHref`) -- list page gets the switch.
- `app/admin/(shell)/customers/[id]/card-items.ts:44-51,192` (`CardEntry`, `CardEntitlement`, `entryLines`), `[id]/page.tsx:255` (`EntryRow`) -- reuse; `card-items.test.ts:146-188` must still pass unchanged.
- `app/admin/(shell)/home/expiring-cards.tsx`, `home-items.ts:54,288` (`ExpiringCardRow`, `toExpiringCard`), `home-items.test.ts`.
- `app/admin/(shell)/notes/notes-view.tsx:116` -- link-based `TopicSwitcher` pattern (don't refactor it). `components/shared/{status-chip,page-heading}.tsx`, `components/ui/empty.tsx`, `buttonClass`, `lib/time.ts` `formatDayMonth`. Copy: `lib/copy/admin.ts:1218` (`adminCopy.customers`).
- `lib/nav.ts:42` -- `/admin/customers` prefix already covers the route; no nav change.
- Tests: `supabase/tests/customers.test.ts`, `my-entitlements.test.ts`, `session-completion.test.ts` (`book`, `runJob`), `cancel-booking.test.ts`, `admin-home.test.ts:694-720`, `support/{db,money}.ts`, `grants.test.ts` `EXPECTED_GRANTS`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_open_cards.sql` -- `public.admin_list_open_cards(p_filter text)` returning `[{entitlement_id, customer_id, customer_label, product_name, paid_on, original_units, available, reserved, used, expires_on, days_left, is_expiring, entries}]`. Grants per Always. User applies in SQL Editor; register in `schema_migrations`, `get_advisors`, regenerate `lib/supabase/database.types.ts` -- session main.
- [ ] `supabase/tests/open-cards.test.ts` -- every matrix row; numbers equal `get_my_entitlements` (as the customer) and `admin_get_customer` after reserve, cancel and completion; `expiring` ids = home `expiring_cards` ids. Add the grant to `grants.test.ts`.
- [ ] `app/admin/(shell)/customers/entry-lines.tsx` -- `EntryRow` moved out of `[id]/page.tsx` unchanged; the card imports it.
- [ ] `app/admin/(shell)/customers/open-cards/{page.tsx,open-cards-items.ts(+test),open-card-row.tsx}` -- load via `callRpc`, parse `?filter=` (unknown → `all`), filters, empty state, rows, highlight of the `#card-` target. Start with `frontend-design`.
- [ ] `app/admin/(shell)/customers/customers-switch.tsx` -- the switch; used on `customers/page.tsx` and the open-cards page.
- [ ] `app/admin/(shell)/home/expiring-cards.tsx`, `home-items.ts` (+test) -- name link to the filtered list.
- [ ] `lib/copy/admin.ts` -- new strings only (`customers.openCards.*`).
- [ ] `app/admin/(shell)/sessions/book/{page.tsx,load-customer.ts,book-items.ts(+test)}` -- read the customer's `confirmed` bookings, mark those sessions "רשומה" (existing copy `customers.card.bookingStatus.confirmed`), no link. `frontend-design` first.
- [ ] `app/admin/(shell)/sessions/book/{actions.ts(+test),multi-booking.tsx,booking-results.ts(+test)}` and `lib/copy/admin.ts` -- the multi-session booking per Always (Server Action shape check: 1–20 distinct UUIDs, one UUID key each, a UUID customer; sequential `callRpc("admin_book_customer")`; previews via the existing `previewAdminBookAction`). `frontend-design` first; follow DESIGN `session-row` selection variant and `bottom-sheet`.
- [ ] `supabase/tests/admin-booking.test.ts` -- add: three `admin_book_customer` calls for one customer and card, one of them on a full session, leave exactly two bookings; repeating a key returns the first result.
- [ ] `completion-plan-2026-10-10.md`, `deferred-work.md`, `tickets.toml` (3.19 now only the hiding) -- record the follow-up story (hide unfundable sessions, multi-session booking; after 3.5) -- session main.
- [ ] `deferred-work.md` -- close the design-round item (customer card vs log) as "not changing, user decision 2026-10-10"; close the 4.1 home-link item and the 4.12/3.12 comparison items with the test name. `tickets.toml`: mark story 3 `done` in the PR -- session main.

**Acceptance Criteria:**
- Given the 3-used-1-reserved card, when Tal opens the list and the customer card and the customer opens `/me/purchases`, then available, reserved, used and expiry are identical on all three.
- Given the customer card before and after the change, when rendered, then its markup is identical.
- Given `npm run build`, lint, typecheck and `npm test`, then all pass.

## Implementation Notes

## Spec Change Log

- **2026-10-13, local check (user decision):** from "לרישום למפגש" Tal couldn't see which sessions the customer is already booked for. Added: the "רשומה" mark on the manual booking screen (Always, matrix row). Moved to a separate story after 3.5: hiding sessions she can't fund (a couple session listed for a card) and booking several sessions at once. Avoids a mark built on the funding rule 3.5 is changing. **KEEP:** everything already built and reviewed in pass 1.
- **2026-10-13, second local check (user decision):** multi-session booking moves back into 4.3, built on the existing `admin_book_customer` and `preview_admin_book_customer` (no migration); 3.19 keeps only hiding sessions she can't fund. An unbound purchase in the list shows "עוד לא הצטרפה" instead of the buttons. **KEEP:** the "רשומה" mark and the 6 dev sessions.
- **2026-10-13, third local check (user decision):** Tal could tick two dates for a customer with one free entry; the sheet showed both as funded and one failed. Added the selection cap at her free entries (Always, two matrix rows). The "משהו השתבש" on that run was a deadlock (`40P01`) with another session's DB tests on the shared dev database, not this code. **KEEP:** everything from passes 1–2.

## Review Triage Log

**Pass 1 (2026-10-13), four lenses.** high 0 · medium 0 · low 13 · false 1 · maybe-false 1. Two patches; no intent_gap, bad_spec or defer.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| `decodeURIComponent` throws on a malformed hash (`#card-%E0`) in `open-card-target.tsx` (blind, edge) | low | patch | try/catch, no mark on failure |
| Pinned fixture is a `single`, so the `pinned_event_id is null` clause is untested (verification) | low | patch | the test also seeds a `card` product with `validity_mode = 'session'` and asserts it is absent from all filters |

Rejected: home `expiring_cards` may hold a pinned card the list excludes (a 4-entry card valid for one session is nonsensical; schema allows it, the test now pins the list side); targeted card absent after a race, no focus/announcement of the target, possible double scroll (maybe-false, same element), home vs list tie-break order, opening balance untested (the view sums every movement), unbound row has no next step (user decision: one target, no buttons), markup AC untested (verbatim move, confirmed in the diff), generic error on RPC failure (as other admin loaders), unused RPC fields (used by the equality tests), duplicated "עומדת לפוג" key (false: chip and filter are separate strings by design).

**Pass 2 (2026-10-13), multi-session booking, two lenses (blind, edge).** high 0 · medium 2 · low 11 · false 2 · maybe-false 0. Four patches; no intent_gap, bad_spec or defer.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| Reopening the sheet after a lost answer makes new keys; dates already booked return "לא נשמר" (blind, edge) | medium | patch | keys kept per date until an answer |
| Previews of an earlier opening overwrite the current one (blind, edge) | low | patch | opening counter, older results ignored |
| A refused date loses the payment / capacity follow-up of the single-date screen, which the list no longer links to (blind) | medium | patch | the same `refusalAction` links under "לא נשמר" |
| "חזרה לרשימה" shows stale unbooked rows until the refresh lands (blind) | low | patch | refresh in `useTransition`, results kept until done |

Rejected: per-date previews ignore a running total on one card (superseded: the user rejected this in the third local check; now the selection cap), confirm enabled when all refused, no hint at the 20 cap, no component test for keys (no DOM test environment in the repo), extra DB cases (covered by the single-booking tests), failed preview looks like a refusal, `loadBookedEventIds` reads past bookings (small), ok without `booking_id` (false: the RPC always returns it), "לא נשמר" in expired tone (false: DESIGN status-chip).

## Design Notes

- The list copies `admin_get_customer`'s entries rule instead of a new builder, so the card is untouched and the two can't drift in shape; the DB test asserts equal entries for the same card.
- No paging: active cards are bounded by the business size (tens). Revisit above ~200.
- EXPERIENCE's chip wording ("נוצלה"/"משוריינת") yields to the card's existing log-style lines (2026-10-08) so both screens read alike.

## Verification

**Commands:**
- `npx vitest run --project db supabase/tests/open-cards.test.ts supabase/tests/my-entitlements.test.ts supabase/tests/customers.test.ts supabase/tests/grants.test.ts` -- all pass.
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` -- all pass.

**Manual checks (phone):** the 3-used-1-reserved card shows a date per entry and drops after the 4th session ends while the customer card is unchanged; filters work; home "expiring" leads to the filtered list; the admin card matches `/me/purchases`.
