---
title: 'Scheduled jobs: expiry alerts, auto-extend, credit options, cleanup (5.10)'
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

**Problem:** CAP-21/22/35/36/18 and AD-11/AD-22: nothing warns a customer or Tal before a card or a credit runs out, 3.14's auto-extend is not scheduled, credit options are refreshed only when the customer acts, nothing deletes old rows, and a failed or silent job or missing Vault values are invisible.

**Approach:** Four `private.job_*` functions on pg_cron (one `cron.schedule` each, safe to run twice, decisions in SQL by `Asia/Jerusalem`), one new template, and new branches in `admin_get_attention_items`.

**Gate (user, 2026-10-20):** build starts only after 3.16 is merged and `origin/main` is merged into the branch. Until then: no migration, no `test:db`.

**Decision (user, 2026-10-20):** the credit days live in a new column `business_settings.credit_expiring_days integer not null default 5 check (between 1 and 30)`, with no settings field yet (the field goes to a fixes round; entry in `deferred-work.md`).

## Boundaries & Constraints

**Always:**
- Every job: `security definer`, `search_path = ''`, revoke from `public, anon, authenticated, service_role`, **no grant**, returns `integer` (rows acted on), each unit in its own `begin … exception when others then raise warning` block (as `job_complete_events`), no idempotency key. Schedules in one migration: `expiry_alerts` `0 * * * *`, `auto_extend` `5 * * * *` (`select private.job_auto_extend()`, 3.14 unchanged), `refresh_credit_options` `*/15 * * * *`, `cleanup` `30 0 * * *`.
- **Cards** = 3.14's set: `status = 'active'`, `pinned_event_id is null`, `eligibility_snapshot ->> 'validity_mode' = 'days'`, `customer_id is not null`, `available > 0` (`entitlement_balances`), `days_left = expires_on - <local today>` with `0 <= days_left`.
- **`private.job_expiry_alerts()`:**
  - `days_left <= business_settings.admin_expiring_days` → `private.enqueue_admin_notification('admin_card_expiring', '<entitlement_id>:<expires_on>', {customer: profiles.full_name, units: available, expires_on: DD.MM}, '/admin/customers/<customer_id>')`.
  - `days_left <= customer_expiring_days` → `enqueue_notification(customer, 'card_expiring', same discriminator, {units, expires_on}, '/me/sessions')`.
  - **Credits:** `cancellation_credits.status = 'active'`, not `choice_pending`, not in use (3.16's `private.credit_in_use`), options in (`active`,`passed`) = `options_count`, at least one `active`. `v_last` = the active option with the latest `events.registration_closes_at`. When `now() >= closes_at - credit_expiring_days` and `now() < closes_at` → `enqueue_notification(customer, 'credit_expiring', '<credit_id>:<v_last.event_id>', {date: session DD.MM, closes_on: closes_at local DD.MM}, '/me/bookings')`. A new last option (replaced or changed by Tal) allows a new alert.
- **`credit_expiring` template** (customer, push on, `body_mode 'template'`, `allowed_vars ['date','closes_on']`): title `הזיכוי שלך עומד לפוג`, body `ההרשמה למפגש החלופי האחרון, ב-{date}, נסגרת ב-{closes_on}. זה הזמן להירשם`. Label in the settings template list: `זיכוי עומד לפוג`. The type is already in the check (3.7): insert only, no constraint change.
- **`private.job_refresh_credit_options()`:** for each customer with an active, non-`choice_pending` credit, `order by customer_id`: lock her profile `for update skip locked` (locked → next run), then `private.refresh_customer_credits(customer)`, unchanged after 3.16 (the owner path: profile → credits, nothing else held, so no 3.7 deadlock; 3.16's refresh rule applies as is).
- **`private.job_cleanup()`:** deletes notifications with `read_at < now() - 90 days`; `notification_jobs` with `finished_at < now() - 30 days` (the notification stays; deliveries cascade); `private.idempotency_results` with `created_at < now() - 7 days`; `cron.job_run_details` with `end_time < now() - 14 days`. 5.6 merged (2026-10-20): also closes, by 5.6's rule (its `deferred-work.md` entry), the active `waitlist_entries` of sessions that started, were cancelled or completed (`status 'closed'`, `closed_at = now()`, `for update skip locked`).
- **`private.job_intervals()`** (`returns table(jobname text, every interval)`, immutable, no grant): one row per scheduled job: `reminders` 1 min, `invoke_push_worker` 1 min, `complete_events` 5 min, `refresh_credit_options` 15 min, `expiry_alerts` 1 h, `auto_extend` 1 h, `cleanup` 1 day. 5.11 adds its row with `create or replace`.
- **`admin_get_attention_items`** redefined from live `pg_get_functiondef`, existing branches unchanged, same grant, plus:
  - `job_failed` (one item per job, text id = jobname, fields `job`, `reason`): `reason 'failed'` when the job's latest run in `cron.job_run_details` has `status = 'failed'`; `'late'` when it has runs but no `succeeded` run ending within 3 × `every`; `'missing'` when the job is not in `cron.job` or not `active`. A job with no runs at all is not flagged.
  - `vault_missing` (singleton): `app_url` or `cron_secret` absent or empty in `vault.decrypted_secrets`. Returns only the item, never a value.
  - `push_stuck` (singleton, `count`): `notification_jobs` in `queued` with `next_attempt_at < now() - 15 minutes` (wrong secret or URL; deferred from 5.8).
- **Admin copy** (`lib/copy/admin.ts`, `items`), href `/admin/notifications` for all three:
  - `job_failed` (user decision 2026-10-20: late and missing read the same): failed `{name}: לא עבד בפעם האחרונה` / `המערכת תנסה שוב לבד. אם ההודעה לא נעלמת עד מחר, צריך לפנות לתמיכה הטכנית`, chip `לא עבד` (warning); late or missing `{name}: לא פועל כבר זמן מה` / `לבירור יש לפנות לתמיכה הטכנית`, chip `לא פועל` (error); the reason stays in the item. Names: `reminders` `תזכורות ללקוחות לפני מפגש`, `invoke_push_worker` `שליחת התראות פוש`, `complete_events` `סגירת מפגשים שהסתיימו`, `refresh_credit_options` `עדכון מפגשים חלופיים לזיכויים`, `expiry_alerts` `התראות על כרטיסיות וזיכויים שעומדים לפוג`, `auto_extend` `הארכה אוטומטית של כרטיסיות`, `cleanup` `מחיקת נתונים ישנים`; unknown → the jobname.
  - `vault_missing`: title `שליחת הפוש לא מוגדרת`, detail `חסרות הגדרות שליחה, ולכן התראות פוש לא יוצאות. ההתראות עצמן נשמרות במרכז ההתראות. צריך לפנות לתמיכה הטכנית`, chip `לא מוגדר`.
  - `push_stuck`: title `התראת פוש אחת ממתינה ולא נשלחת` / `{count} התראות פוש ממתינות ולא נשלחות`, detail `ייתכן שהגדרות הפוש של האתר שגויות. ההתראות עצמן נשמרו במרכז ההתראות`, chip `ממתין`.
- Attention rows use the existing row component; `frontend-design` first (AGENTS.md), no new layout.
- **Free-project pausing:** document in `README.md` (environment checklist) and `deferred-work.md` (target 6.9): pg_cron is not a documented guarantee against pausing a Free project after 7 days without activity; pausing stops every job. Decision before launch.

**Never:** a grant on any job or helper; changes to `job_auto_extend`, `refresh_credit_options`, `refresh_customer_credits`, `move_option_candidates`, `enqueue_*`, the push worker or existing templates; a type-check change; Vercel Cron or `setTimeout`; reading a Vault value into any result; deleting unread notifications; storage cleanup of media drafts (needs the Storage API; stays in `deferred-work.md`); `private.rate_limits` cleanup; marketing reminders (5.11); "טל" in customer copy; `←` on any screen.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Tal threshold | card, 21 days left, 2 free | one `admin_card_expiring` per admin; rerun: nothing |
| Customer threshold | 10 days left | one `card_expiring`; the admin one not repeated |
| After extension | extended card reaches 21/10 again | new alerts (new `expires_on`) |
| Nothing free | `available = 0` (all reserved) | no alert |
| Pinned / unbound | `pinned_event_id` set, or `customer_id` null | no alert |
| Expired | `days_left < 0` | no alert |
| Credit window | all options set, last closes within the credit days | one `credit_expiring`; rerun: nothing |
| Credit not full | fewer options than `options_count`, or `choice_pending`, or in use | no alert |
| Last option replaced | last option full → replaced by a later one | new alert for the new last option, once in its window |
| Refresh | an option's session became full | job replaces it (3.7/3.16 rule) |
| Admin option | option with `added_by = 'admin'` | not replaced for a move; a removed option never returns; never topped up above `options_count` |
| Profile locked | another transaction holds her profile | skipped, done next run |
| One card fails | `job_auto_extend()` with no args, one card raises | others extended, the failing card unchanged |
| Cleanup | rows just before and after each limit | only the older ones deleted; unread kept |
| Job failed / late / missing | as defined | one `job_failed` item with the reason |
| Vault empty | `app_url` missing | `vault_missing`; no value in the output |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261019203305_auto_extend.sql:92` -- `job_auto_extend(p_today, p_entitlement_ids)`; no-arg call = all cards; schedule only.
- `supabase/migrations/20261010141240_cancellation_credits.sql:430-490` -- `refresh_credits_for_event` (non-owner, no fill) and `refresh_customer_credits` (owner, fills); `cancellation_credits` :50, `credit_options` :81; `get_my_entitlements` `is_expiring` :2666 (same card rule).
- 3.16 (after merge): `private.refresh_credit_options(p_credit_id, p_fill default true)`, `credit_in_use`, `credit_options.added_by`.
- `supabase/migrations/20261001184225_create_notification_core.sql:223,309` -- `enqueue_notification` / `enqueue_admin_notification`; templates seeded :79-87; target_path check :120.
- `supabase/migrations/20261006183915_business_settings_and_templates.sql:42` -- `allowed_vars`; `20261001162630_create_money_schema.sql:256` -- `admin_expiring_days`, `customer_expiring_days`.
- `supabase/migrations/20261018084612_entitlement_corrections.sql:1089` -- live `admin_get_attention_items` (12 kinds, `items(since, id, item)` CTE, singleton id `null::uuid` + text id); grant :1768.
- `supabase/migrations/20261006184326_push_pipeline.sql:417` -- Vault read pattern (`vault.decrypted_secrets`, `app_url`, `cron_secret`).
- `app/admin/(shell)/home-items.ts:148,291` -- `toAttentionItem` (pattern: `push_failed`); `lib/copy/admin.ts:1046` `items`.
- Template type labels: same map that holds `entitlement_auto_extended`'s label (settings template list).
- Tests: `supabase/tests/auto-extend.test.ts`, `session-reminders.test.ts`, `session-completion.test.ts:725` (`cron.job` check), `settings-and-templates.test.ts` (all-vars check), `notifications.test.ts` (seed count; `deferred-work.md` notes it fails), `app/admin/(shell)/home-items.test.ts`, `supabase/tests/admin-home.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] (main session) 3.16 merged (37ad1d0), `origin/main` merged; `refresh_credit_options` / `credit_in_use` live in `20261019204039_credit_adjustments.sql` (+ `_review_fixes`); `admin_get_attention_items` latest still `20261018084612`; no `waitlist_entries` then; 5.6 merged later (98cc76a, `origin/main` fast-forwarded on 2026-10-20) → waitlist close added to `job_cleanup`.
- **Night run (user, 2026-10-20):** write the migration file and the DB tests, but do NOT apply any migration (no MCP), do NOT run `npm run test:db`, `demo:seed`, `demo:clear`, and no commit/push/PR. Write `database.types.ts` changes by hand only if the build needs them (the new jobs take no RPC from TS, so none expected). The user applies and runs `test:db` in the morning.
- [x] `supabase/migrations/20261019233918_scheduled_jobs.sql` (file written; NOT applied: apply, register, advisors and `database.types.ts` regeneration remain for the main session) (`npx supabase migration new scheduled_jobs`) -- template, `credit_expiring_days`, the four jobs, `job_intervals`, `admin_get_attention_items`, schedules -- additive only; user runs it in the SQL Editor, main session registers it; advisors; regenerate `database.types.ts`.
- [x] `supabase/tests/scheduled-jobs.test.ts` (written, not run) -- the matrix, inside `inRollback`, own rows only (`testName`), dates relative to `now()`, plus `cron.job` rows for the four schedules.
- [x] `supabase/tests/settings-and-templates.test.ts`, `notifications.test.ts` -- add `credit_expiring`; all-vars test runs the real job.
- [x] `lib/copy/admin.ts`, `app/admin/(shell)/home-items.ts` (+ test) -- three kinds; template label (`frontend-design` first).
- [x] `README.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- pausing note; settings field for `credit_expiring_days` (fixes round); close the 3.14 and 5.8 entries for 5.10.

**Acceptance Criteria:**
- Given the jobs run twice in the same hour, when the notifications are counted, then each alert exists once.
- Given the migration applied, when the advisor runs, then no new WARN or ERROR beyond the approved ones.
- Given a customer, when she calls `admin_get_attention_items`, then `NOT_AUTHORIZED`.

## Verification

**Commands:**
- `npm run test:db` -- expected: all pass (after the migration)
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` -- expected: pass
</content>
</invoke>

## Implementation Notes

- 2026-10-20: migration applied by the user in the SQL Editor and registered; security advisor shows only the approved WARNs; `database.types.ts` gained only `credit_expiring_days` (the regenerated file also carried 5.13's unmerged signatures, left out).
- DB tests: the test role has no usage on `cron.runid_seq` and cannot write `cron.job`, so fake runs take an explicit `runid` and the job toggles go through `cron.alter_job` / `cron.unschedule` (rolled back). `scheduled-jobs.test.ts` 29/29, plus `settings-and-templates`, `notifications`, `auto-extend`, `admin-home`, `push` pass. The full `test:db` run's other failures are 5.13's (`customers`, `customers-export`, `grants`: its changed signatures are live, its tests not merged) and `media.test.ts` (Storage keys not passed to that run).
- Live: the four jobs ran and succeeded; the first `expiry_alerts` run sent one `credit_expiring` to a demo customer.

## Review Triage Log

**Pass 1 (2026-10-20, night run; DB tests written, not run):** 4 lenses; 3 medium and 5 low entries patched, the rest rejected.

| # | Finding | Verdict | Route | Action |
|---|---|---|---|---|
| 1 | `job_refresh_credit_options` holds every processed profile/credit lock until the run ends; a fill waiting on a session Tal is cancelling can deadlock with her cancel | medium | patch | `set lock_timeout = '500ms'` (below `deadlock_timeout`): the job gives up first, that customer retried next run |
| 2 | credit alert can name a last option whose session is cancelled or full but not yet replaced (refresh and alerts both at :00) | medium | patch | skip this run when the last option's event is not `published` or is full (same test as `refresh_credit_options`) |
| 3 | settings test counts every dev-DB `admin_card_expiring` for the fresh admin; fails as dev cards age | medium | patch | filter by the test card's entitlement id in `dedupe_key` |
| 4 | a job whose first run is still running shows as `late` | low | patch | `late` also needs a success or a run older than 3 x every |
| 5 | `job_runs` aggregates all of `cron.job_run_details` on every admin home load | low | patch | per-job lateral `order by runid desc limit 1` lookups |
| 6 | `job_intervals` immutable though 5.11 replaces it | low | patch | `stable` |
| 7 | tests missing: x3 boundary, failure then success clears, closed registration, cancelled/full last option, `cron_secret` missing, running first run | low | patch | seven tests added |
| 8 | media-drafts deferred entry left with no target | low | patch | target 5.20 |

Rejected: one `job_failed` detail line for every reason incl. `missing` (frozen spec copy; raised to the user); `since = now()` for `missing`/`vault_missing` (cosmetic); anonymized-profile guard (4.6 not built, no recipient FK); other jobs' exception blocks untested, weak auto-extend count (dev data, low); README runbook, renamed cron jobs (speculative); 24 h credit days, no admin credit alert, extras beyond intent, direct job calls, pages untested, seed test checks only count (as specified or pre-existing); duplicates of rows 1-5.
