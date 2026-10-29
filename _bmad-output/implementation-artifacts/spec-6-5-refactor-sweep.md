---
title: '6.5 Refactor sweep before the acceptance suite'
type: 'refactor'
created: '2026-10-29'
status: 'done'
baseline_commit: 'bf4d5cc74abc378cc08cfcd720a2e2b4bcf128fb'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three 2.14 items stay open in `deferred-work.md` (target "תיקונים"): `admin_reschedule_event` still rewrites `expires_on` of a voided (`revoked`) pinned entitlement, and the void's `MANUAL_HANDLING_REQUIRED` and `CONCURRENT_CHANGE` paths have no DB test. A little dead code remains, and one deferred item still waits for a confirmation that already happened.

**Approach:** One small migration (dev only; 6.5 comes before 6.1, user decision 2026-10-29) plus DB tests, a dead-code removal with no visible change, and a deferred-work closure check. One PR.

**Decisions (this spec, the work manager may override at the gate):**
- Findings since 5.20 (2.14, 5.23, 5.24, 5.25, fixes #125, #128, #133, #135): the only `defer` rows are 2.14 #6 and #7, already in deferred-work (items 1.2, 1.3 here). 5.23–5.25 deferred nothing; the four fix PRs had no review defers. Nothing new to present.
- Reschedule filter: skip `status = 'revoked'` only. `active` and `refunded` keep today's behaviour (3.9 keeps a refunded purchase's terms).
- `CONCURRENT_CHANGE` branches are reached by a holder transaction that changes the row the void waits on, as in `concurrent-change.test.ts` (5.20). No RPC today moves a bound payment to another customer or books outside the customer lock, so branches 2 and 3 are defensive; the test proves the guard, the holder's direct write stands in for the race.
- Dead code: `KindField` (unused since 3.11), `PAGE_SIZE` in `audit-data.ts` (never read), `ImageProblem` type (never used). Lint and typecheck have zero warnings; no `TODO` in code.
- Not removed: unused `components/ui/*` files and their packages (shadcn, never edited; package removal would break their imports), schema `*Content` types (one per block, a pattern), knip false positives (scripts run by `node`, exports used inside their file).

## Boundaries & Constraints

**Always:**
- Redefine `admin_reschedule_event` from live `pg_get_functiondef` (md5 `0906c3007c4e7c0db1449ac945a7a9a9`; last defining file `20261013162639_business_cancel_event.sql`). Only change: the loop's `where` gains `and e.status <> 'revoked'`. Keep `security definer`, `search_path = ''`, grants untouched (`create or replace`, same signature).
- Migration via `npx supabase migration new reschedule_skip_revoked_pinned`; the work manager runs it (dry run, `db push`, `get_advisors`); then `generate_typescript_types`. `test:db` only after the work manager's go.
- Tests follow existing fixtures; committed rows `test_`-named and removed in `onCleanup`.

**Never:** a `drop`; prod steps; `.env*`, Vercel; `demo:*`/`video:*`; `*@video.example.com` data; any change the customer or Tal sees; `components/ui/`. Out of scope: items targeted 6.1, 6.4, 6.7, 6.9 or "סבב הסליקה"; items marked "לא נבנה"; where payment instructions show (business decision); a DB test for the `video:seed` transaction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Reschedule, active pinned | pinned single `active` on the session, new day | `expires_on` = new day, one audit row | — |
| Reschedule, voided pinned | another pinned single on it voided by `admin_void_purchase` | `expires_on` unchanged, no `entitlements` audit row for it | — |
| Mixed funding | card purchase whose future booking has allocations from a card and a single | preview `{ok:false, code}`; void refused, nothing changes | `MANUAL_HANDLING_REQUIRED` |
| Joined meanwhile | unbound purchase; holder binds the payment while the void waits in `lock_join_payment` | void refused, payment still `approved` | `CONCURRENT_CHANGE` |
| Customer changed | bound purchase; holder sets another `customer_id` while the void waits on the payment lock | refused | `CONCURRENT_CHANGE` |
| Booking outside the lock | bound pinned purchase; holder adds a confirmed future booking on its payment while the void waits on the payment lock | refused, the booking stays `confirmed` | `CONCURRENT_CHANGE` |

</frozen-after-approval>

## Code Map

- Live `admin_reschedule_event`: pinned loop after the `events` audit (`-- A pinned product is valid only on its session (AD-8).`). Live body uses CRLF; write the migration from the live text.
- `admin_void_purchase` (`20261026212957_purchase_void.sql`): unlocked read → `lock_customer` or `lock_join_payment` (payment `for share` after token rows; `LINK_USED` → `CONCURRENT_CHANGE`) → events → bookings (`v_locked`) → entitlements → payment `for update` (customer re-check) → plan → bookings not in `v_locked` → `CONCURRENT_CHANGE`. `private.needs_manual_cancel` = allocations from more than one entitlement `kind`. No triggers on `payments`, `bookings`, `booking_allocations`, `entitlements`.
- `supabase/tests/business-cancel.test.ts` -- `pinned()`, `reschedule()`, `localInstant`; model test "a new day: the pinned entitlements' expires_on follows" (~:1019).
- `supabase/tests/purchase-void.test.ts` -- `seed`, `buy`, `buyFor`, `insertEvent`, `book`, `previewAs`, `voidError`, `snapshot`; mixed allocation pattern in `cancel-booking.test.ts:606-648`.
- `supabase/tests/concurrent-change.test.ts` -- `raceError`, `waitsOnLock`, `admin`, `customer`, `session`, `purchase`, `booking`, `made` + cleanup (deletes bookings by `payment_id`, tokens, payments).
- `app/admin/(shell)/sessions/session-fields.tsx:194-221` `KindField`; `app/admin/(shell)/audit/audit-data.ts:34-35` `PAGE_SIZE` + comment; `lib/media/resize.ts:17` `ImageProblem`.
- `deferred-work.md`: three "תיקונים" items (~:794-810); `notifications.test.ts` seed item (~:704-710, confirmed by the 5.20 full `test:db`, spec 5.20 Triage Log "Item 29 … passed").

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_reschedule_skip_revoked_pinned.sql` -- live body + the one filter; header names the source file and md5 -- item 1.1.
- [x] `supabase/tests/business-cancel.test.ts` -- matrix rows 1–2 in one test (void the second pinned via `admin_void_purchase`, then reschedule) -- 1.1.
- [x] `supabase/tests/purchase-void.test.ts` -- mixed funding row (preview and void; `snapshot` unchanged) -- 1.2.
- [x] `supabase/tests/concurrent-change.test.ts` -- three race tests; extend header comment -- 1.3.
- [x] `session-fields.tsx`, `audit-data.ts`, `resize.ts` -- remove the dead code; drop imports lint then reports.
- [x] `lib/supabase/database.types.ts` -- regenerate after the migration (expect no diff: signature unchanged).
- [x] `deferred-work.md` -- three items "נסגר ב-6.5 (2026-10-29)" with evidence; seed item "נסגר ב-6.5 (בדיקת סגירה)": passed in the 5.20 full `test:db` (2026-10-22). No other item lacks a status with a built target.
- [ ] `completion-plan-2026-10-10.md` row 10 ✅ and PR; `tickets.py pull` + `mark done` for epic-launch id 5 (main session, in the PR).

**Acceptance Criteria:**
- Given the migration applied, when `get_advisors` runs, then only the approved WARNs; `grants.test.ts` passes.
- Given `test:db` on `business-cancel`, `purchase-void`, `concurrent-change`, `move-booking`, `entitlement-corrections`, `session-reminders`, `settings-and-templates`, `grants` (the last two also call `admin_reschedule_event`), then all pass.
- Given the diff, then no file under `app/`, `components/`, `lib/copy/` changes rendered output.

## Implementation Notes

- Migration `20261029204903_reschedule_skip_revoked_pinned.sql`: body checked against the live one (md5 of `prosrc` with CR removed equals the file's body with the filter and its comment line reverted). Applied to dev by the work manager on 2026-10-29 (dry run, `db push`; live body equals the file; `get_advisors`: only the approved WARNs plus one existing INFO).
- `database.types.ts`: `generate_typescript_types` before the migration is byte-identical to the file; the signature is unchanged, so no regeneration diff is expected after it.
- Race "booking outside the lock": the purchase is pinned with no booking yet (the void locks no session), and the holder's booking has `customer_id` null: a key share on her profile would make the void wait in `lock_customer` and then see the booking (no `CONCURRENT_CHANGE`).
- Remaining for the main session: completion-plan row 10 with the PR number; `tickets.py pull` + `mark done` (epic-launch id 5).
- 2026-10-29: full `npm run test:db` after the grants fix: 70 files, 1365 tests passed; dry run of `dev-clean-test-data.mjs`: no test data left.
- 2026-10-29 (test:db, work manager's OK): `grants.test.ts` failed on six `marketing_tags` grants (three anon column SELECTs, authenticated and service_role table SELECT, `admin_update_marketing_tags` EXECUTE). They match `20261028093236_marketing_tags.sql` exactly; 5.24 never added them to `EXPECTED_GRANTS`. Fixed in the test list only, no DB change.

## Spec Change Log

## Review Triage Log

**Pass 1** (blind-hunter, edge-case-hunter, verification-gap, intent-alignment; with `review-accepted.md`): high 0, medium 0, low 3 routed; edge-case-hunter none; rest rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `refunded` pinned entitlement keeps moving, but no test pins it (vgap, blind, intent) | low | patch | a filter narrowed to `active` would pass; third pinned single set `refunded` in the reschedule test, moves with one audit row |
| 2 | Voided `expires_on` check could pass vacuously (blind) | low | patch | assert the voided entitlement's day differs from the new day before the reschedule |
| 3 | Mixed funding checked only from the card's payment (blind) | low | patch | same preview/void/snapshot assertions for the single's payment |

Rejected: race tests' "nothing changed" asserts are covered by the rollback (same pattern as the 5.20 tests in that file; the code is the evidence); mixed fixture uses a single pinned to another session (same synthetic state as `cancel-booking.test.ts`; `needs_manual_cancel` counts kinds only); `sessions.fields.kind` copy now unrendered (anchors the negative assertion in `session-screens.test.tsx`; no copy change in this story); grants fix not traced outside Implementation Notes and the seed item's old `target` (history kept, status says where it closed); items closed before merge (migration applied to dev; status names the merge); reschedule still locks revoked pinned rows (harmless, lock set unchanged by design).

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` -- pass.
- After the work manager's go: `npx vitest run --project db supabase/tests/{business-cancel,purchase-void,concurrent-change,move-booking,entitlement-corrections,session-reminders,settings-and-templates,grants}.test.ts` -- pass.
