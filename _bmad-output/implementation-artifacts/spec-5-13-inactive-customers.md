---
title: 'Story 5.13: inactive customers'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '37ad1d0ac13e5a9861950c9d2477378e72be3632'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Source §7 (CAP-28, CAP-25): a customer with no participation for `business_settings.inactivity_months` calendar months (default 3), and nothing open, is "inactive". Tal needs to see who is inactive and list each group.

**Approach:** `private.customer_activity(customer_id)`, derived at read time (AD-14; nothing stored, no job). The search shows every match with a "לא פעילה" tag; three buttons list a whole category; the export exports what the screen shows. (User decision 2026-10-20, phone check, recorded in the SPEC `.memlog.md`: inactive customers are not hidden — overrides source §7 / CAP-28 "מוסתרת ברירת מחדל".)

## Boundaries & Constraints

**Always:**
- Inactive ⇔ all of: (a) `anchor + inactivity_months months <= today` (both `Asia/Jerusalem` local dates), where `anchor = greatest(private.customer_last_activity_on(id), profiles.created_at local date)`; (b) no `confirmed` booking; (c) no entitlement in `entitlement_balances` with `status = 'active'`, not `is_expired`, and `available > 0 or reserved > 0`; (d) no `cancellation_credits` with `status in ('active','refund_requested')`; (e) no `refund_requests` with `status = 'requested'`. Otherwise active.
- `customer_last_activity_on` already takes the latest of a completed session, an approved payment and a booking's creation, so a new purchase or booking makes her active again (source §7) with no extra code. Never-participated counts from account creation via `created_at`.
- Signature for 5.12 (broadcast "active only"): `private.customer_activity(p_customer_id uuid) returns text` — `'active'` or `'inactive'`; `stable`, `set search_path = ''`, reads `now()` and `business_settings`; no grant, called only from definer functions. Already applied (`20261019233358`); unchanged.
- `admin_list_customers(p_query text, p_activity text)` (signature unchanged): `p_activity in ('all','active','inactive')`, else `INVALID_INPUT` (activity). Query trimmed; > 100 → `INVALID_INPUT` (query). Empty query → the whole category (browse). 1 character → empty list. 2+ → the matches within the category. Same order and 200 cap + `has_more`; each row has `inactive boolean`; no `inactive_hidden`.
- `admin_export_customers(p_scope, p_query, p_columns, p_activity)` (signature unchanged): `p_activity in ('all','active','inactive')` always, else `INVALID_INPUT` (activity). `'all'` = the whole category; `'search'` = query (2–100) within the category. No cap. The audit after-json keeps `activity`.
- Screen `/admin/customers` opens as today: the search field, no list, no button selected. Under the field one row of three equal buttons (link chips, open-cards style, `aria-current` on the selected one), in reading order: "כל הלקוחות" (right), "פעילות" (middle), "לא פעילות" (left).
  - A button shows the whole category (`?activity=all|active|inactive`) and clears the search field.
  - Typing (2+ characters) searches every customer (`activity = 'all'`), no button selected; the URL keeps only `q` (`replaceState`). Clearing the field returns to the button's list if one was open.
  - Any row of an inactive customer shows `StatusChip` "לא פעילה" (search and every category).
  - Empty texts: search "לא נמצאו לקוחות"; "כל הלקוחות" "אין עדיין לקוחות"; "פעילות" "אין לקוחות פעילות"; "לא פעילות" "אין לקוחות לא פעילות". Over 200: the existing `hasMore` line.
- Export sheet: the scope radio ("מה לייצא") is removed. In its place one line by what the screen shows: "בחרת לייצא את כל הלקוחות" / "בחרת לייצא את כל הלקוחות הפעילות" / "בחרת לייצא את כל הלקוחות הלא פעילות" / "בחרת לייצא את תוצאות החיפוש ({count})"; nothing shown → all customers. Columns unchanged. Requests: category → `scope=all&activity=X`; search → `scope=search&q=…&activity=all`.
- The marking neither blocks sign-in nor deletes anything; the card (`admin_get_customer`) is unchanged.
- Screen work starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. The buttons are links (navigation), not `OnlineButton`.
- New migration with `create or replace` of both RPCs (no `drop`), from the bodies in `20261019233358_inactive_customers.sql`, with the exact revoke/grant pair. The user runs it in the SQL Editor; the main session records it, runs `get_advisors`, regenerates types.

**Never:** a stored inactive flag, a `job_mark_inactive`, blocking or deleting an inactive customer; editing `20261019233358_inactive_customers.sql` (already applied); touching booking/cancel functions, "לטיפול", the customer card; a broadcast (5.12); `test:db` without asking the user first; `demo:seed` / `demo:clear`.

## I/O & Edge-Case Matrix

| Scenario | State (inactivity_months = 3, today 2026-10-20) | Expected |
|---|---|---|
| Last session 2026-07-20, nothing open | anchor 07-20 | inactive |
| Last session 2026-07-21 | anchor 07-21 | active |
| Never participated, account created 2026-06-01 | anchor 06-01 | inactive |
| Old, but a `confirmed` future booking | | active |
| Old, card with `available > 0` or `reserved > 0`, not expired | | active |
| Old, card expired or used up | | inactive |
| Old, credit `active` or `refund_requested`, or refund `requested` | | active |
| Old, then an approved payment today | anchor today | active |
| `inactivity_months` changed to 6 | anchor 07-20 | active |
| List, query 2+ chars, `'all'` | active + inactive match | both, inactive flagged |
| List, empty query, `'active'` / `'inactive'` / `'all'` | | that whole category |
| List, 1-character query | | empty list |
| List or export, `p_activity` null or `'bogus'` | | `INVALID_INPUT` (activity) |
| Export `'all'` + `'inactive'` / `'search'` + `'all'` | | every inactive / every match |
| Non-admin calls either RPC | | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

The first build (filter chips, `inactive_hidden`, filter-bound export) is in the working tree, uncommitted; rework it in place.

- `supabase/migrations/20261019233358_inactive_customers.sql` -- applied, do not edit; copy both RPC bodies into the new migration and change only the activity rules.
- `app/admin/(shell)/customers/customer-items.ts` -- `CustomerActivity` becomes `'all'|'active'|'inactive'`; `parseActivity` (absent → null = no category), `listHref(query)` / category href, `answerForFilter`, `toCustomerItem` (`inactive`).
- `app/admin/(shell)/customers/actions.ts` -- `listCustomersAction(query, activity)`: empty query allowed with a category.
- `app/admin/(shell)/customers/customer-live-search.tsx` -- three buttons (`grid-cols-3`), modes search/category, empty texts, row chip; remove the hidden line and `inactiveOnly`.
- `app/admin/(shell)/customers/page.tsx` -- passes `q` and the category.
- `app/admin/(shell)/customers/export-sheet.tsx` -- drop the scope `RadioCardGroup`; show the "בחרת לייצא את …" line; receives what is shown.
- `lib/admin/customer-export.ts`, `app/api/admin/export/route.ts` -- `activity` required for both scopes; remove `NONE`.
- `lib/copy/admin.ts` -- `customers` block (buttons, empty texts, export line; remove `inactiveHidden`, `inactiveOnly`, `showInactive`, `scopeAll`, `scopeSearch`, `scopeLegend` if unused); audit values `activity` gain `all`.
- Tests: `supabase/tests/inactive-customers.test.ts`, `customers.test.ts`, `customers-export.test.ts` (`grants.test.ts` unchanged); unit `customer-items`, `actions`, `customer-export`, `route`, `export-sheet`, `audit-data`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_inactive_customers_browse.sql` (`npx supabase migration new inactive_customers_browse`) -- `create or replace` both RPCs per the new rules -- browse + search + export.
- [ ] DB tests -- the new matrix rows; drop the `inactive_hidden` and old-filter cases.
- [ ] `app/admin/(shell)/customers/*` + `lib/copy/admin.ts` -- buttons, modes, row chip, empty texts; `frontend-design` first.
- [ ] Export sheet, `lib/admin/customer-export.ts`, route -- the "בחרת לייצא את" line and requests.
- [ ] Unit tests for the helpers, the action, the export params/request/label and the route.

**Acceptance Criteria:**
- Given an inactive and an active customer both matching "בדויה", when Tal types it, then both appear and only the inactive one has "לא פעילה".
- Given the screen with nothing selected, when Tal taps "לא פעילות", then the field is cleared, the button is selected and every inactive customer is listed; tapping "ייצוא" shows "בחרת לייצא את כל הלקוחות הלא פעילות" and the file holds exactly them.
- Given a search showing 5 results, when Tal taps "ייצוא", then the line reads "בחרת לייצא את תוצאות החיפוש (5)".

## Implementation Notes

- Build run (2026-10-20, user's night instructions): create the migration file with `npx supabase migration new inactive_customers` but never apply it (no MCP `apply_migration`/`execute_sql` writes); no `test:db`, `demo:*`, git commit/push, `rm` or `.env*` writes. `database.types.ts`: hand-edit only the two RPC signatures (`p_activity`) so typecheck passes; the main session regenerates it after the SQL Editor run.
- 2026-10-20: `20261019233358` applied by the user and recorded; advisors clean; types regenerated (same as the hand edit); `test:db` 52/52 (two slow tests got `30_000`). Phone check → redesign (Spec Change Log, iteration 1).
- Iteration 1 build: write the new migration file only — do not apply it, no `test:db`, no commit, no `rm`, no `.env*` writes. The signatures do not change, so `database.types.ts` stays.

## Spec Change Log

- 2026-10-20, iteration 1 (user, phone check; intent renegotiated): filter chips with hidden inactive customers were confusing. Amended: search shows everyone with a "לא פעילה" tag; three category buttons (all / active / inactive) each list a whole category; the export sheet loses the scope choice and exports what is shown. Avoids: an inactive customer missing from a name search, and an export scope that does not match the screen. KEEP: `private.customer_activity` and its tests (rule rows, `firstActiveDay`, order-independent audit asserts, 30 s timeouts), the `inactive` row flag and chip, `answerForFilter`-style pure helpers with unit tests, URL kept with `replaceState`, link chips in the open-cards style.

## Review Triage Log

Pass 1 (2026-10-20; blind, edge-case, verification-gap, intent-alignment): 7 patch, 0 defer, 0 bad_spec, 0 intent_gap.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Answer-for-filter guard in `customer-live-search.tsx` untested (VG) | low | patch | Moved to a pure helper with unit tests |
| 2 | Empty active result + `inactive_hidden` shows "לא נמצאו לקוחות" then "יש עוד…" (blind) | low | patch | One line "לא נמצאו לקוחות פעילות. יש …" + "להצגה" |
| 3 | "להצגה" link built from untrimmed live query (blind) | low | patch | Built from `shown.query` |
| 4 | `customer_activity` does not exclude anonymized/admins; 5.12 must know (blind) | low | patch | Header comment |
| 5 | `day(-3, 1)` anchors flaky on month-end days (edge) | medium | patch | Anchor derived in SQL as the first day still active |
| 6 | Audit rows tie on `created_at` in one transaction; ordered asserts flaky (edge ×2) | medium | patch | Order-independent asserts |
| 7 | Condition (c) not tested with `available = 0, reserved > 0` (blind) | low | patch | Test case added |

Rejected: UI render tests (static JSX over tested values; phone check covers); `NONE` null cast in the route (pinned by `route.test.ts`; types say string for every arg); other admin listings / card mark (source §7 names the list; card is fix 9); anchor counts payment and booking creation (spec decision from source §7 "רכישה או הרשמה"); no "show active" link and no browse-without-search (chips always visible; live search by user decision 2026-10-07); per-row cost (customers in the hundreds); null from missing `business_settings` (singleton row); refund-request test state (tests (e) alone); chips push history (same as open-cards chips); old export URLs (the sheet builds the URL fresh).

Pass 2 (2026-10-20, iteration 1; blind, edge-case — short, prod list broken until merge): 2 patch, 0 defer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Export target taken from the shown answer: while a category/search is pending or failed the sheet says and exports all customers (blind, edge) | medium | patch | Target derived from the current request; count only when answered |
| 2 | Category over 200 says "אפשר לחפש" but a search leaves the category (blind) | low | patch | Category line "מוצגות 200 הראשונות. בייצוא יופיעו כולן" |

Rejected: waitlist entry not "open" (source §7 lists booking, entitlement, credit, refund only); ctrl-click on a button clears the search (rare); per-row cost on browse/export (customers in the hundreds); category lost from the URL after typing (spec: clearing returns only within the screen); zero-row export (harmless header-only file); no count on category lines (not asked); "לא הופעלה" + "לא פעילה" together (two true facts); duplicated activity type/guard (no named divergence); audit "activity: all" on search exports (true value); search within a category unused by the screen (spec contract); browse tests weak on a large DB (dev DB small; search-scoped tests cover rows); long comment lines (cosmetic); stale past `confirmed` booking (the 5-minute completion job closes it); search hint (still true).

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` -- pass.
- `npm run test:db` (only after asking the user) -- new, customers, export, grants pass.

**Manual checks:**
- Phone: a search for a fake inactive customer shows her with "לא פעילה"; "לא פעילות" lists her; "פעילות" omits her; a customer with a future booking or an open credit has no tag; the export line matches the screen.
