---
title: 'Customers CSV export (4.4)'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'bd377881a5e6c8a3d4ccd46c13f1582f2f8698c1'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal cannot take her customer list out of the system (source §7 "לקוחות": full or partial export to CSV; CAP-25).

**Approach:** One admin RPC that returns export rows and logs the export, a route handler `app/api/admin/export/route.ts` that builds a safe CSV from a closed column list, and an "ייצוא" button on `/admin/customers` that opens a sheet with scope and column choice.

## Boundaries & Constraints

**Always:**
- **Decisions (user, 2026-10-13):** closed column list is name, phone and email only; customers only, no payments or bookings file; every export is logged in `audit_log`; email comes from a new definer RPC (an AD-3 exception, recorded in the architecture `.memlog.md`). Because there are no payment columns, the ticket's "payment method name from the approval day" check is dropped (`tickets.toml` and the completion plan updated).
- **Build order (user, 2026-10-13):** first the migration, `lib/csv.ts`, `lib/admin/customer-export.ts`, the route and their tests. Nothing under `app/admin/(shell)/customers/` (button, sheet) until 4.3 is merged and origin/main is merged into this branch.
- **Scope.** The customers list has no date filter (4.2, user decision 2026-10-07), so "the filtered list" is the current live-search result. `all` = every customer. `search` = customers matching `q` (2–100 chars after trim) by `private.customer_matches`. Who is a customer, and the order, as `admin_list_customers` (not anonymized, not admin, not-activated included; `last_activity_on desc nulls last, full_name, id`). No 200 cap.
- **Closed column list** (file order; keys in code, headers in `lib/copy/admin.ts`): `full_name` "שם"; `phone` "טלפון" (`formatLocalPhone`); `email` "מייל" (from `auth.users`; empty if none).
- **RPC `admin_export_customers(p_scope text, p_query text, p_columns text[])`:** new, `security definer`, volatile (it writes the log), `set search_path = ''`, first line `if not private.is_admin() then raise exception 'NOT_AUTHORIZED'`; revoke from `public, anon, authenticated, service_role`, grant execute to `authenticated` only. Validates: scope `all|search`; `search` needs 2–100 chars after trim; `p_columns` non-empty, no duplicates, subset of `full_name, phone, email` → else `INVALID_INPUT`. Returns `{rows: [{full_name, phone_e164, email}]}`; only selected fields are filled. Writes one `private.audit(actor, 'admin', 'admin_export_customers', 'profiles', null, null, null, null, jsonb_build_object('scope', …, 'columns', …, 'row_count', …))` — never the query text. Exempt from idempotency (read with a log row; a repeat is harmless); noted as an AD-5 exemption in the architecture `.memlog.md`. Additive only: `admin_list_customers`, `admin_get_customer`, `admin_get_attention_items` and money functions are not touched.
- **Never in the file:** ids, tokens, link ids, push data, passwords, `pending_email`, any column outside the closed list.
- **Route `GET /api/admin/export?scope=all|search&q=&cols=full_name,phone,email`:** session client (`lib/supabase/server.ts`) → `callRpc` → CSV. `NOT_AUTHORIZED`, no session or 42501 → 403; malformed params or `INVALID_INPUT` → 400; other → 500. Error body `{code}` JSON. Success: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="customers-YYYY-MM-DD.csv"` (Jerusalem local date), `Cache-Control: private, no-store`.
- **CSV:** UTF-8 with BOM, comma separator, CRLF, every field quoted, `"` doubled. Formula guard: a cell whose first char is `=`, `+`, `-`, `@`, tab or CR gets a leading `'`. Header row always present.
- **Screen** (starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md:367): button "ייצוא" on `/admin/customers` opens a bottom sheet (`WorkPanel` pattern) titled "ייצוא לקוחות": `RadioCardGroup` "כל הלקוחות" / "תוצאות החיפוש ({n})" (the second only when the search has ≥2 chars; `{n}` is the shown count, "200+" when `has_more`); then checkboxes "שם", "טלפון", "מייל", all checked. None checked → button `aria-disabled` with "יש לבחור לפחות עמודה אחת". The button locks while preparing; download via `fetch` → blob → `<a download>`; then `inline-notice` success "הקובץ ירד" or error (`errorMessage(code)`).
- Audit viewer label `admin_export_customers`: "ייצוא לקוחות". Micro-copy in `lib/copy/admin.ts` under `customers.export`; new error codes only in `lib/errors.ts`.

**Never:** customer import (6.2), active/inactive filter (5.13), audit-log export, payments or bookings export, any other column, service-role client, edits to `components/ui/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full export | admin, `scope=all`, 3 cols | every customer; BOM, then "שם","טלפון","מייל" | — |
| Partial | `scope=search&q=רונ&cols=full_name,phone` | only matching customers, only 2 columns | `q` of 1 char → 400 |
| Formula cell | name `=HYPERLINK("x")`, `+1`, `-1`, `@a`, leading tab/CR | `"'=HYPERLINK(""x"")"`, `"'+1"`, … | — |
| Who | admin, anonymized, not activated | only the not-activated one | — |
| Log | any successful export | one `audit_log` row: action, scope, columns, row_count; no `q`, no names | failed validation: no row |
| Customer calls | logged-in customer | 403 `{code:"NOT_AUTHORIZED"}` | no session → 403 |
| Bad columns | `cols=` or `cols=full_name,dietary_notes` | 400 `INVALID_INPUT` | — |
| No match | `scope=search&q=zzz` | header row only, log row with `row_count: 0` | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261007121030_customers_phone_check.sql:14-81` -- latest `admin_list_customers`: who/order pattern to copy (without the cap).
- `supabase/migrations/20261006215608_customers_list_and_card.sql:43-118` -- `private.customer_last_activity_on`, `private.customer_matches` (reuse).
- `supabase/migrations/20261007183144_two_photo_consents.sql:394-581` -- latest `admin_get_customer`: the `auth.users` email join to copy.
- `supabase/migrations/20260930193304_fix_reset_begin_and_audit.sql:69` -- `private.audit` signature; entity-less call pattern: `20261006194417_business_settings_review_fixes.sql:203`.
- `app/api/jobs/push/route.ts` -- only existing route handler (own `Cache-Control`). `lib/auth/require-role.ts` redirects, unusable in a route. `next.config.mjs:98-101` sets no-store only for pages. `/api/admin` stays behind the preview site lock.
- `lib/rpc.ts:38` `callRpc`; `lib/errors.ts` (`ActionResult`, `errorMessage`); `lib/phone.ts:11` `formatLocalPhone`; `lib/time.ts` `localToday`.
- `app/admin/(shell)/customers/{page.tsx,customer-live-search.tsx,customer-items.ts}` -- live search, `q` via `replaceState`, `LIST_LIMIT`, `has_more`; the sheet needs the current `q` and count. 4.3 adds `<CustomersSwitch>` under the heading in `page.tsx`: merge origin/main first.
- `components/admin/edit-kit.tsx:54` `WorkPanel`; `components/admin/radio-card.tsx` `RadioCardGroup`; `components/ui/checkbox.tsx` (as in `products/product-fields.tsx:213`). No download pattern exists yet.
- `lib/copy/admin.ts:1313` `customers`; `:1520-1561` audit action labels.
- `supabase/tests/customers.test.ts` helpers (`seed`, `insertCustomer`, `asAdmin`); `grants.test.ts:15` `EXPECTED_GRANTS` (sorted).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_customers_export.sql` -- `admin_export_customers` per Always. Created with `npx supabase migration new customers_export` only after "מתחילים לבנות"; applied by the user in the SQL Editor and registered in `schema_migrations` (main session); then `get_advisors`, `generate_typescript_types`.
- [x] `supabase/tests/customers-export.test.ts` + `grants.test.ts` -- RPC rows of the matrix: scope, who, order, columns, log row, `INVALID_INPUT`, `NOT_AUTHORIZED`, anon 42501.
- [x] `lib/csv.ts` (+test) -- pure `toCsv(headers, rows)`: BOM, quoting, CRLF, formula guard (all formula cases).
- [x] `lib/admin/customer-export.ts` (+test) -- closed column list (key, header, formatter), `parseExportParams` (→ typed or `INVALID_INPUT`), `exportFileName`.
- [x] `app/api/admin/export/route.ts` -- GET per Always; status mapping 400/403/500.
- [x] `app/admin/(shell)/customers/export-sheet.tsx` + `customer-live-search.tsx` / `page.tsx` -- button and sheet (frontend-design first). **Only after 4.3 is merged and origin/main is merged here.**
- [x] `lib/copy/admin.ts` (`customers.export`, headers, audit label); `lib/errors.ts` if a new code is needed.
- [x] Architecture `.memlog.md` -- AD-3 exception (email via `admin_export_customers`) and AD-5 idempotency exemption, user decision 2026-10-13.
- [x] `tickets.toml` id 4 `verify` without the payment-method check; `completion-plan-2026-10-10.md` scope note now, 4.4 ✅ in the PR; `story-csv-export.md` with `status: done` (in the PR).

**Acceptance Criteria:**
- Given Tal on desktop and phone, when she exports full and partial, then both files open in Excel with correct Hebrew and only the chosen rows and columns.
- Given a customer named `=1+1`, when exported and opened in Excel, then the cell shows the text, not 2.
- Given a logged-in customer, when she requests `/api/admin/export`, then the response is 403 and no CSV.
- Given an export, when Tal opens the audit log, then she sees "ייצוא לקוחות" with no customer names.
- Given the migration, when the advisor runs, then no WARN/ERROR beyond the approved ones; `lint`, `typecheck`, `npm test`, `npm run test:db`, `build` pass.

## Implementation Notes

- **2026-10-13, phase 1 done (backend):** migration `20261013203212_customers_export.sql` applied by the user in the SQL Editor and registered in `schema_migrations`; advisor clean (approved WARNs only); `database.types.ts` regenerated (same as the hand edit). `customers-export` db tests 9/9 pass; `grants` differs only by `admin_list_open_cards` (4.3, applied to the shared dev DB, not yet merged). Review pass 1 patched. lint, format, typecheck, `npm test` (2140), build pass.
- **2026-10-14, phase 2 done (screen):** origin/main (4.3) merged, no conflicts. `export-sheet.tsx` + button in `customer-live-search.tsx`; new legends "מה לייצא" / "עמודות"; default scope is the search when results are shown. Review pass 2 patched. lint, format, typecheck, `npm test` (2171), build pass. `grants` db test differs only by 2.8's functions (applied to dev, not merged).
- **2026-10-14, phone check (user decision):** everything else passed and the copy is approved (including "מה לייצא" / "עמודות"). The "ייצוא" trigger moved below the search field, as a small borderless text button (`TEXT_BUTTON` from `edit-kit`).
- **Was next (phase 2):** after 4.3 is merged, merge origin/main, then the screen task (frontend-design first), then review of the screen diff, then the PR tasks. Copy for the sheet is already in `lib/copy/admin.ts` (`customers.export`).

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-10-13), four lenses, backend slice only (UI waits for 4.3).** high 0 · medium 0 · low 6 · false 2 · maybe-false 0. Three patches; no intent_gap, no bad_spec.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| Audit viewer shows the `columns` array as English codes (blind, edge, verification) | low | patch | `formatValue` maps only strings via `copy.values`; arrays now mapped too, `values.columns` added |
| No test of how the viewer shows an export row (verification) | low | patch | case in `audit-data.test.ts`: action label, scope, columns, row_count |
| Route tests miss `scope=all` (`p_query ""`) and the email column (blind) | low | patch | one route test with all three columns |

**Rejected (16):** false: `=1+1` → `'=1+1` still meets the AC (text, not 2; OWASP); no confirmation dialog (export is not in the source's sensitive-action list). Low, unlikely, fix adds guards: 42501 not mapped to 403 (`getClaims` validates the same JWT PostgREST gets); GET writes a log row on a cross-site top-level link (no data leaks, only a log row); foreign phone shows `'+44…` (rare, value intact); repeated query params; per-row `auth.users` lookup and no cap (tens of customers); weak row-shape check (RPC builds the strings); `concepts[0]` in the test (dev DB always has one); global `scope` value key; duplicated `QUERY_MAX` (`lib` cannot import from `app`). By design: sheet copy before the screen (build order); empty email for customers without an Auth user (`pending_email` forbidden); ticket description still accurate. Intent-alignment: descriptive, UI deferred by the user's build order.

**Pass 2 (2026-10-14), four lenses, screen diff (after 4.3 merged).** high 0 · medium 0 · low 9 · false 1 · maybe-false 0. Four patches; no intent_gap, no bad_spec.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| Reopening the sheet keeps last time's unchecked columns (blind) | low | patch | columns reset to all on open, with scope and notice |
| `revokeObjectURL` at 0 ms can cancel the download in Safari/Firefox (edge) | low | patch | revoke after a delay |
| Container decisions untested: scope/query sent, shown count, `errorCodeOf` (verification, intent) | low | patch | pure helpers + unit tests |
| Dead `raw.length === 0` in `parseExportParams` (blind) | low | patch | removed; `cols=` still rejected and tested |

**Rejected (11):** false: the search scope label differs from EXPERIENCE.md (spec wording, user-approved). Low, by spec or user-approved copy: search scope offered at 0 results (spec offers it from 2 chars; file is header-only, honest); label without the query text; same "ייצוא" on both buttons and "הקובץ ירד" (approved copy). Low, unlikely, fix adds guards: `q` in the GET URL reaches request logs/history (admin's own search; spec chose GET); 200 response that is not CSV; expired session → 403 without a login redirect. Style: Hebrew literals in tests. Second time, now in `review-accepted.md`: global audit keys; foreign phone `'`.

## Design Notes

**Why the RPC takes the columns:** the log records what left the system, and the RPC returns only what was asked, so unselected email never reaches the route.

**Why `'`:** OWASP CSV-injection guidance; Excel shows the cell as text. Phones are written in local dashed form (`054-123-4567`), so Excel keeps the leading zero.

**Why fetch → blob:** EXPERIENCE.md asks for a locked button and an inline notice; a plain link gives neither.

## Verification

**Commands:**
- `npm run test:db` -- expected: all pass, including `customers-export` and `grants`.
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks:**
- Phone and desktop as admin: full and partial export open in Excel with Hebrew intact; a `=` name shows as text; the audit log shows the export. As a customer: `/api/admin/export` → 403.
