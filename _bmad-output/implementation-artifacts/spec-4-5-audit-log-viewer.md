---
title: 'Story 4.5: Audit log viewer'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'e94f8c94d0f3a7135fdb78effa9849f81aef77d2'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every change is written to `audit_log`, but Tal cannot read it. Source §7: who, when, which customer or session, what changed and why, filterable by session and date, without passwords or full links (CAP-26, Flow 9: "טל מוצאת למה יתרה של לקוחה השתנתה").

**Approach:** One read RPC `admin_list_audit` that filters, pages and derives names at read time, and a read-only screen `/admin/audit` under "עוד".

## Boundaries & Constraints

**Always:**
- `admin_list_audit(p_event_id uuid, p_customer_id uuid, p_from date, p_to date, p_before_created_at timestamptz, p_before_id uuid) returns jsonb`: `security definer`, `set search_path = ''`, `is_admin` first → `NOT_AUTHORIZED`, revoke then one grant to `authenticated`; a read, no idempotency key. Filters are AND, each optional. Dates are Jerusalem days, both ends included: `created_at >= private.local_day_end(p_from - 1) and created_at < private.local_day_end(p_to)`; `p_from > p_to` → `INVALID_INPUT` `{field:"to"}`; a range over 366 days → `INVALID_INPUT` `{field:"from"}`.
- Order `created_at desc, id desc`; keyset paging: 50 rows, `has_more`, and the next page passes the last row's `(created_at, id)`. "טעינת עוד" appends.
- Each row: `id, created_at, actor_kind, action, entity_type, customer {id, name} | null, event {id, title, local_date} | null, changes [{key, before, after}], reason`. Names are derived now: customer = `profiles.full_name`, anonymized → `null` name (shown "לקוחה אנונימית"); session = `concepts.name` + Jerusalem date of `starts_at`.
- `changes` is built in SQL from `before`/`after`: one entry per key; keys `id`, `*_id`, `created_at`, `updated_at`, `*_hash` and `sort_order` are dropped. The RPC never returns a token, hash, URL or password; `"<changed>"` stays as is and the screen shows "השתנה". A key missing on one side is `null` there.
- Screen: phone-first, starts with `frontend-design`, inside DESIGN.md and EXPERIENCE.md. Filters in the URL (`?event=&customer=&from=&to=`): session select (all sessions, newest first, "{קונספט} · {date}"), customer search (`admin_search_customers`, chosen name shown with "ניקוי"), two date inputs, "ניקוי סינון". Row: time (date + hour), actor, action label, customer and/or session, each change as "{שדה}: {ישן} ← {חדש}" (an add shows only the new value, a delete only the old), reason when present. Empty: "אין פעולות בטווח הזה" + "ניקוי סינון". Desktop: a table; phone: stacked rows.
- Labels: `adminCopy.audit` maps every existing `action` to a Hebrew label and common keys to Hebrew field names; an unknown action or key falls back to its code. Values: booleans "כן"/"לא", `*_agorot` as ₪ (`lib/money.ts`), ISO timestamps/dates via `lib/time.ts`, `null` "—", arrays/objects as compact text.
- Decisions (user, 2026-10-10): "מי" by `actor_kind`: admin "טל" (admin-only screen, one admin), customer "הלקוחה" (her name is in the customer column), system "המערכת". Default range when `from`/`to` are absent: today minus 30 days to today (Jerusalem). All actor kinds are listed, customers' own bookings, cancels and join steps included.
- Nav: "יומן פעולות" in `adminMoreNav` before "הגדרות" (settings stays last), new `audit` icon.

**Never:**
- No writes, export (4.4), detail removal (4.6) or fix-from-log. No change to `private.audit`, `private.audit_diff`, `audit_log` or any writer. No new index (event, customer and created_at are indexed).
- No customer access; no raw `before`/`after` jsonb sent to the browser.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Session filter | two sessions with rows | only rows with that `event_id` | — |
| Date range | rows on 9.10 23:30 and 10.10 00:30 Jerusalem, from=to=10.10 | only the 00:30 row | — |
| Bad range | from 12.10, to 10.10 | nothing | `INVALID_INPUT` `{field:"to"}` |
| Paging | 51 matching rows | 50 + `has_more`; next page the 51st, `has_more` false | — |
| Masked value | `before.full_name = "<changed>"` | change before "<changed>"; screen "השתנה" | — |
| Hidden keys | activation_tokens row with `token_hash`, `id`, `customer_id` | none of them in `changes` | — |
| Anonymized | customer with `anonymized_at` | `customer.name` null → "לקוחה אנונימית" | — |
| Customer | any call | — | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260930191525_create_rpc_contract.sql:130-160` -- `audit_log` columns, indexes (created_at desc, customer_id, event_id), admin select RLS. `audit.test.ts` covers masking and no write.
- `supabase/migrations/20261007121030_customers_phone_check.sql:14-83` -- `admin_list_customers`: is_admin, INVALID_INPUT with detail.field, 201-row `has_more`, grants. The dropped 3-arg version (`20261006215608:228`) had the from/to check.
- `supabase/migrations/20260930171231_create_time_and_phone_helpers.sql:20` -- `private.local_day_end(date)`.
- Names: `profiles.full_name`, `anonymized_at`; `events.starts_at`, `concept_id` → `concepts.name` (`20261004143612:22,61`). Admins are in `admin_roles(user_id)`.
- Actions in use (map all): admin_* for customer notes, notes and topics, work sheet, events, media (`media_hidden`), products, content, settings, templates, links (`admin_issue_link`, `revoke_link`), `approve_payment`, `admin_book_customer`, `admin_cancel_booking`; customer `bind_purchase`, `claim_join`, `join_complete`, `set_photo_consent`, `set_personal_photo_consent`, `book_session(s)`, `cancel_booking`; system `complete_event`, `join_begin`, `migrate_identity_match`, `refresh_returned_entitlements`; `reset_complete` (admin or customer). `grep -o "'[a-z_]*'" ` on `private.audit(` calls gives the list.
- `app/admin/(shell)/customers/page.tsx`, `customer-items.ts` (`parseQuery`), `customer-live-search.tsx` -- filter page + search pattern; `payments/new/existing` uses `admin_search_customers`. `sessions/load-session.ts` reads events via RLS. Date input: `payments/new/payment-form.tsx:597`.
- `lib/time.ts` (`formatFullDate`, `formatTime`, `formatLocalDate`, `localToday`), `lib/money.ts` (`formatAgorot`).
- `lib/nav.ts:8-62`, `components/shared/nav-icon.tsx:19-34`, `lib/nav.test.ts:140,160-167`. `lib/copy/admin.ts` -- add `audit` after `notes`. `supabase/tests/customers.test.ts` -- read-RPC test template; `grants.test.ts` sorted entries.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_audit_viewer.sql` -- (`npx supabase migration new audit_viewer`) `admin_list_audit` and grants. Main session: apply, advisor, types.
- [ ] `supabase/tests/audit-viewer.test.ts` -- every matrix row, customer filter, combined filters, no hidden key ever returned; `grants.test.ts` row.
- [ ] `app/admin/(shell)/audit/{page.tsx,actions.ts,audit-data.ts,*.tsx}` -- start with `frontend-design`; Action for "טעינת עוד" and customer search; parsing; screen.
- [ ] `lib/copy/admin.ts` (`audit`: labels, empty state, filters), `lib/nav.ts`, `nav-icon.tsx`, `lib/nav.test.ts`.
- [ ] Pure tests: URL parsing, value formatting (masked, ₪, booleans, dates, null), label fallback, screen markup (empty state, add/delete rows, "השתנה").
- [ ] Ticket 4.5 done in the PR (`tickets.py pull` + `mark done`); `completion-plan-2026-10-10.md` round 1.

**Acceptance Criteria:**
- Given Tal changes a session's capacity 12 → 14, when she opens the log filtered to that session, then the row shows her, the time, the session, "מכסה: 12 ← 14" and the reason if given.
- Given a phone, when the list has 50 rows, then each row reads without horizontal scroll and "טעינת עוד" adds the next ones.

## Implementation Notes

- Migration file (created by the main session): `supabase/migrations/20261010125930_audit_viewer.sql`. Write the SQL into it; do not create another.
- The subagent does not apply the migration (the main session does, via the SQL Editor). Update `lib/supabase/database.types.ts` by hand for `admin_list_audit` (Args/Returns) so `callRpc` typechecks; the main session regenerates it later.
- No git commands and no file deletions by the subagent. `npm run test:db` may fail until the migration is applied; report that instead of working around it.
- Applied 2026-10-10 by the user in the SQL Editor; recorded in `schema_migrations`; advisor clean. `audit-viewer` and `audit` pass. `grants` differs only by story 4.8's five `*_concept*` functions, already on the shared dev DB but not on main; types regenerated with those five removed (4.8 adds them).

## Spec Change Log

- 2026-10-10, user phone check: (1) filter bar and list shared `key={href}` → duplicated bars, no filtering; distinct keys. (2) Phone opens on the list; filters behind "סינון (n)" with a one-line summary + "ניקוי סינון" when closed; open on desktop. (3) Technical keys hidden in TS (`*_by` except `booked_by`, `*_snapshot`, paths, versions, UUID-only values); objects/arrays as their text values; weekdays in Hebrew; labels for 4.8's concept actions and remaining dev-DB keys.

## Review Triage Log

Iteration 1 (lenses: blind-hunter, edge-case-hunter, verification-gap, intent-alignment).

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Insert rows show "— ← —" for every null column | medium | patch | `audit_diff` keeps all keys of an inserted row; dev DB: all 155 `approve_payment` rows have null/null keys. Dropped in `toAuditItem`. |
| 2 | Date input navigates per keystroke (`0002-10-10`), remounts, loses focus | medium | patch | `isPlainDate` accepts year 2; bar keyed by href. Navigate only when year >= 2000. |
| 3 | Enum values shown as raw English codes | medium | patch | `formatValue` maps only booleans/agorot/dates. Added `audit.values` with code fallback. |
| 4 | Distinct keys share one Hebrew label (units/original_units, name/full_name, kind/type, prep_days) | low | patch | Two "כניסות" lines on one entitlement row. Distinct labels. |
| 5 | Long unbroken values overflow the desktop table | low | patch | 720px main, auto-layout table; `break-words` does not break. `[overflow-wrap:anywhere]`. |
| 6 | `loadAuditAction`, `toSessionOptions` and the dateError mapping untested | gap | patch | No test imports `audit/actions`. Added `actions.test.ts`, helper + tests. |
| 7 | Two INSTANT regexes disagree | low | patch | Action's `[0-9:.]+` looser. One `isInstant`. |
| 8 | `searchAuditCustomersAction` duplicates tested `searchCustomersAction` | low | patch | Line-for-line copy; reuse the payments action. |
| 9 | Audit rows cannot show which card or how many units moved (Flow 9) | medium | defer | Writers (`book_session`, `cancel_booking`) audit bookings without units; spec forbids writer changes. |

Rejected: unknown customer UUID labelled anonymous, event UUID not in options, URL years < 100 (unlikely, fix adds branches); nested public content URLs (not secrets; intent targets activation links); arrays as compact text, masked add "השתנה", empty-state link, 30-day default under a session filter, actor kind as "who" (spec decisions); unbounded session select, key order (low, adds complexity); value-level secrets (masked upstream in `audit_diff`, covered by `audit.test.ts`); spec checkboxes / "31 days" (spec edit / matches spec).

## Verification

**Commands:**
- `npm run test:db` (audit-viewer, audit, grants) -- pass; not during a phone check.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass.
- `get_advisors` security -- only `0029` and `auth_leaked_password_protection`.

**Manual checks:**
- Phone, admin: change a session's capacity; the log filtered by that session and by today shows old ← new.
