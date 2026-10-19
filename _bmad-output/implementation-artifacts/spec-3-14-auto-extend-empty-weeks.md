---
title: 'Auto-extend rule for empty weeks (3.14)'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '9cbdb08d4fd5899d4075eadfc5d9d1cba49951ed'
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

**Problem:** CAP-36 (joint decision overriding "אין הארכה אוטומטית" in source §2/§6, SPEC memlog): a card gets +7 days for every local week (Sun–Sat, Asia/Jerusalem) that overlaps its validity and has no published, non-cancelled session it can be used in. Nothing does this yet.

**Approach:** A system job function, idempotent per card and week, that records each extension as a system correction (3.13 table), audits it and notifies the customer with a new editable template. Scheduling is 5.10.

**Decisions (2026-10-19):**
- Applies to cards only: `status = 'active'`, `pinned_event_id is null`, `eligibility_snapshot ->> 'validity_mode' = 'days'` (products-catalog: single, intro and couple are pinned), expired or not.
- New notification type `entitlement_auto_extended` (user recommendation; 3.13 precedent of one type per case), not `entitlement_changed`.
- One notification per card per run (a catch-up run that extends several weeks sends one, with the final expiry).
- A week counts as having a brunch if a fitting session took place anywhere in it, even before the card's `valid_from` or after its `expires_on` (partial first and last weeks do not extend because of the card's dates).
- A card with nothing left (`available = 0` and `reserved = 0` in `entitlement_balances`) is not extended at all (user: there is no case of adding an entry to a finished card). A card with a reserved entry is extended.

## Boundaries & Constraints

**Always:**
- **`private.week_has_eligible_session(p_entitlement public.entitlements, p_week_start date) → boolean`**: an event with `status in ('published','completed')`, `starts_at` in `[p_week_start, p_week_start + 7)` local (bounds via `at time zone 'Asia/Jerusalem'`, index-friendly), for which `private.entitlement_fits_event(v, ev)` is true, where `v` = the entitlement with `status := 'active'`, `valid_from := p_week_start`, `expires_on := p_week_start + 6`. So only kind, weekdays and "no card for couple" decide; full or past sessions count; drafts and cancelled do not. No copy of the checks; `entitlement_fits_event` and `plan_funding` unchanged. 3.18 will extend it.
- **`private.job_auto_extend(p_today date default null, p_entitlement_ids uuid[] default null) → integer`** (extensions made). `security definer`, `search_path = ''`, revoke all, **no grant** (pg_cron and tests call it as owner). `p_today` null = local today; `p_entitlement_ids` null = all cards (tests pass their own). For 5.10: `select private.job_auto_extend();` hourly (AD-11).
  - Candidates: the cards above with `available + reserved > 0`. Per card, `order by id`, `for update skip locked` on the entitlement only (a locked card waits for the next run); each card in its own `begin … exception when others then raise warning` block, as `job_complete_events`.
  - Weeks `w` from `private.local_week_start(valid_from)`, step 7, while `w <= expires_on` (re-read after each extension, so added weeks are checked in the same run once ended) and `w + 7 <= p_today` (week ended). Skip `w` with a correction row for the card; skip when `week_has_eligible_session`.
  - Extension: `expires_on + 7`; insert `entitlement_corrections` (`field 'expires_on'`, old/new as JSON dates, `actor_kind 'system'`, `actor_id null`, `week_start w`, `reason null`); `private.audit(null, 'system', 'job_auto_extend', 'entitlements', id, customer_id, null, old row, new row)`.
  - After the card's weeks, if any extension and `customer_id` is not null: `private.enqueue_notification(customer, 'entitlement_auto_extended', <last correction id>, {expires_on: DD.MM, units: available}, '/me/purchases/<id>')`.
- **Template** (`customer`, push on, `body_mode 'template'`, `allowed_vars ['expires_on','units']`): title `הכרטיסייה הוארכה`, body (user wording, two lines) `לא היו בראנצ׳ים בשבוע שעבר ולכן הארכנו לך את תוקף הכרטיסייה!` (user, 2026-10-20; was `השבוע`) newline `הכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות.` Type name in settings: `הארכה אוטומטית של כרטיסייה`.
- **Type check:** separate migration from the live `pg_get_constraintdef` plus the new type (and 3.16's type if it was applied first). User runs it first in the SQL Editor; registered.
- **`admin_get_entitlement`** redefined from live `pg_get_functiondef`, adding only `week_start` to each correction.
- **Admin entitlement page:** a `system` correction shows `הארכה אוטומטית: היה {ישן}, עכשיו {חדש}` and the line `שבוע {DD.MM}–{DD.MM} בלי בראנץ׳ מתאים`; actor stays `המערכת`. `(כולל הארכה)` keeps working (`entitlement_is_extended`). `frontend-design` first.
- **Audit (`lib/copy/audit-actions.ts`):** `job_auto_extend` shown, label `הארכה אוטומטית`, result `הכרטיסייה הוארכה בשבוע, כי לא היה בראנץ׳ מתאים`.
- Customer purchase page and open cards: no change (they read `expires_on`).

**Never:** a grant on the job or helper; scheduling (5.10); pre-expiry alerts (5.10); per-session eligible products (3.18); credit changes (3.16); update/delete on `entitlement_corrections`; touching `plan_funding`, `book_core`, `cancel_core`, `move_booking`, `refresh_credit_options`, credit tables, `preview_book_session`, `notify_booking_confirmed`; extending pinned products; "טל" in customer copy; `←` in any screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Empty week | ended week, no session | +7, one correction (`week_start`), audit, one notification |
| Rerun | same call twice | second run: 0, nothing new |
| Couple only | only a couple session that week | extends (regular card) |
| Cancelled only | the only session cancelled | extends |
| Full / completed | a fitting session, full or completed | no extension |
| Draft only | only a draft session | extends |
| Weekday | card Sun only; session Tue | extends |
| Expiry inside empty week | expires Tue of that week | extends past it |
| Added week | the added week also ended and empty | extended again (same run) |
| Week not ended | current week empty | nothing |
| Pinned / revoked | pinned single, revoked card | nothing |
| Finished card | available 0, reserved 0, empty week | nothing |
| Only reserved | available 0, one reserved entry, empty week | extends |
| Partial week | card from Thu; that week's only session on Mon | no extension |
| Unbound card | `customer_id` null | extends, no notification |
| Locked card | another transaction holds it | skipped, next run does it |
| All vars | template edited to use every allowed var | real flow renders |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261018084612_entitlement_corrections.sql` -- table `:33-49` (`week_start` unique per entitlement), `entitlement_fits_event` `:130-152` (reuse via modified record), `entitlement_is_extended` `:156`, `admin_get_entitlement` `:942-1082` (corrections `:1031-1053`; redefine from live), template insert pattern `:95-119`.
- `20261018084607_entitlement_correction_types.sql:20-33` -- last type check (20 templates; `credit_expiring` has none).
- `20260930171231_create_time_and_phone_helpers.sql:67` -- `local_week_start`.
- `20261010141240_cancellation_credits.sql:1333-1457` -- `job_complete_events`: skip locked, per-item exception, system audit, revoke at `:3291`.
- Helpers: `private.audit` (`20260930193304:69`), `private.enqueue_notification` (`20261001184225:223`); `entitlement_balances` for `available`/`reserved`; 3.13's `admin_correct_entitlement` for the `DD.MM` var format.
- `lib/copy/audit-actions.ts` -- `SHOWN_AUDIT_ACTIONS` `:146` (pattern `admin_correct_entitlement` `:282-294`); labels in `lib/copy/admin.ts` `audit.actions`; tests `lib/copy/audit-actions.test.ts` (`:84`, `:120` every `private.audit` action decided).
- `lib/copy/admin.ts` -- template names `:1438-1460`; entitlement copy `:1556-1644` (`historyChange :1640`, `historyWho :1642`).
- `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/` -- `entitlement-items.ts` (type `:55-66`, `historyItems :200-221`), `page.tsx:159-184` history render; `entitlement-items.test.ts:119-130`.
- Tests: `settings-and-templates.test.ts` (counts `:634`, `:662` → 21; names `:638`; real flow `:866-893`), `notifications.test.ts:~259` (seeded list), `grants.test.ts` (no new grant; revoke checked by ACL), `audit-data.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_auto_extended_type.sql` -- **main session; user runs first:** live check + `entitlement_auto_extended`; registered.
- [x] `supabase/migrations/<ts>_auto_extend.sql` -- template insert, `week_has_eligible_session`, `job_auto_extend`, `admin_get_entitlement` (live + `week_start`); revoke all, grant only `admin_get_entitlement` as before.
- [x] `lib/supabase/database.types.ts` -- regenerate.
- [x] `supabase/tests/auto-extend.test.ts` -- every matrix row (own cards via `p_entitlement_ids`, weeks in 2099 with `p_today`); update `settings-and-templates`, `notifications`, `entitlement-corrections` (`week_start` in `admin_get_entitlement`).
- [x] `lib/copy/{admin,audit-actions}.ts` + tests -- template name, audit rule, history copy.
- [x] Entitlement page (`frontend-design` first) -- system row text and week line; `entitlement-items.test.ts`.
- [x] Docs -- `deferred-work.md` (close 3.14 part of the 2.12 item `:33-37`; note `job_auto_extend` for 5.10), `completion-plan-2026-10-10.md`, `tickets.toml` id 14 done in the PR.

**Acceptance Criteria:**
- Given an extended card, when the customer opens her purchase page, then the new expiry shows and she has the `הכרטיסייה הוארכה` notification.
- Given an extended card, when Tal opens the entitlement page and the audit log, then the page shows the `הארכה אוטומטית` row with its week, and the log shows one `הארכה אוטומטית` row per extended week.

## Implementation Notes

- 2026-10-19 (planning): work in this worktree only. Write migrations with `npx supabase migration new`, but do not apply them (the user runs them in the SQL Editor). Build the type check and `admin_get_entitlement` from the live DB (MCP `execute_sql`, read-only: `pg_get_constraintdef`, `pg_get_functiondef`). Until applied, DB tests run the migration SQL inside each rolled-back test through a temporary hook in `supabase/tests/support/db.ts` (as in 3.13; restore the file afterwards), and `database.types.ts` is hand-edited. Do not run `test:db` without the main session's go-ahead (the user must not be testing on the phone at the same time). Load `supabase-postgres-best-practices` before SQL and `frontend-design` before the page change. No git commit/push, no file deletion, no `.env*` writes.

- 2026-10-20 (implementation, applied): migrations `20261019203302_auto_extended_type.sql` and `20261019203305_auto_extend.sql`; the user ran both in the SQL Editor and they are registered. Advisors: approved WARNs only. `database.types.ts` regenerated: no change (no public signature changed). `test:db` on the eight listed files: 165/166 pass; the failing one is `notifications.test.ts` seed list, because 5.21's `booking_confirmed_couple` wording is already applied to dev (whoever merges 5.21 updates that list, keeping `entitlement_auto_extended`). `notifications.test.ts` seed list was still on the pre-3.13 seed (old `entitlement_changed` wording, 18 types) and was brought up to date here. The template body has a line break; push shows it, the in-app notification center (`components/shared/notification-item.tsx`) shows it as a space (customer screens unchanged per this spec).
- 2026-10-20 (phone check, user decision): body says `בשבוע שעבר` (the notification arrives after the week ended). Migration `20261019211850_auto_extended_wording.sql` updates the template only if Tal has not edited it (version 2); tests updated. Everything else in the phone check passed.

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-20):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. medium 3, low 1, defer 1, rejected 13.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind, edge | History labels every `system` correction `הארכה אוטומטית`, any field | low | patch | require `week_start`; test |
| 2 | vgap | "Full / completed" test uses an empty open 2099 session; a "bookable only" filter would pass it | medium | patch | full published session, registration closed; test |
| 3 | vgap | No run over several cards (per-card reset, total, notification per card) | medium | patch | multi-card test |
| 4 | blind | Local-week edges (Sat 23:30, Sun 00:30, DST) untested | medium | patch | edge test |
| 5 | vgap | Null `p_today`/`p_entitlement_ids` and the per-card exception block untested | medium (unverified) | defer | needs an all-cards run; with the 5.10 schedule |

Rejected: old expired card with units extended through later empty weeks (CAP-36 as decided, "expired or not"); hourly rescan cost (small data, as `job_complete_events`); manual + automatic extension for the same week (separate rules, Tal sees the history); `השבוע` wording and `0`/`1 כניסות` (user's wording; same `{units}` pattern as 3.13; Tal edits templates); audit row without its week (the entitlement page shows it); fixed type list in the type migration (already applied from the live list; the completion plan tells 3.16 to rebuild from live); finished card getting units back (user: no such case); card set to couple (3.13 forbids it); a past session cancelled after its week (completed sessions cannot be cancelled); 2099 dev events (none, checked); days-mode non-card products (the spec's card definition, as 3.13 `correctable`); spec checkboxes and `audit-data.test.ts` path (bookkeeping; the file exists under `app/admin/(shell)/audit/`).

## Design Notes

Reusing `entitlement_fits_event` with the week as the card's validity keeps one definition of "the card fits this session" (kind, weekdays, couple), so 3.18 changes one place. The unique `(entitlement_id, week_start)` makes reruns and races harmless; the row lock makes them rare. The job only extends and never locks events or profiles, so it cannot deadlock with booking paths (they lock the entitlement last).

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run format:check`, `npm run build` -- pass.
- After apply (ask the user first): `get_advisors` (approved WARNs only), `npm run test:db` on the new and listed files, `npm run demo:seed`.

**Manual checks:**
- Phone: run the job in the SQL Editor on a fake card → customer sees the new expiry and notification; admin sees `הארכה אוטומטית` and one log row.
