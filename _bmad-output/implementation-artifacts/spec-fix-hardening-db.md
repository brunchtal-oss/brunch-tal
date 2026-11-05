---
title: 'Fix: database hardening (credits, waitlist, duplicate, products)'
type: 'bugfix'
created: '2026-11-04'
status: 'done'
baseline_commit: '8172ad9cb82c57c5d0eeb4f727ec9764e655862b'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Eight small database gaps found before 6.1: a public column leaks when a full session frees a place; a re-picked passed credit option is lost; a reschedule that reopens registration never tells the waitlist; a duplicated session keeps the source's kind; an option Tal adds while moving a booking can vanish; pinned placement takes the party size from the product; cards of anonymized customers keep being extended and listed; the product RPCs still accept the retired post-join fields.

**Approach:** One migration that redefines each function from its live `pg_get_functiondef` with a minimal change, plus one revoke and one data fix, and db tests for each item. The production database will then be built with these fixes.

## Boundaries & Constraints

**Always:** Every function is re-created from the live definition (not an old file), keeping its signature, `security definer`/`search_path = ''`, grants and lock order. No `drop`. Party size from a session kind is `case when kind = 'couple' then 2 else 1 end`, as every other path.

**Never:** No change to `rate_limit_hit`, login/phone TypeScript, screens, `product-screens.test.tsx` or `session-editor.tsx` (other tabs). No product-form change. Columns `post_join_*` stay (R17). Entitlements of anonymized customers are not revoked (4.6). Q1 (an intro credit used after attending elsewhere) stays as is; R5 and Q2 are out.

Decisions (user via the work manager, 2026-11-04): R8 mismatched products are fixed in the migration (couple → 2, regular → 1), count reported. Dev has 0 mismatched products, entitlements, credits or bookings today; the fix is a plain `update` without an audit row (a migration has no actor, and prod runs it before any product exists). R8 forward: `apply_product_changes` rejects a row whose `party_size` disagrees with `eligible_event_kind` (`INVALID_INPUT`, `detail.field = 'party_size'`); the form's defaults agree, so normal use never hits it. R4 price: the display price is cleared only when the kind changed; same kind copies it as today (a null price is already normal: drafts save and publish with it, and both session pages show a price only when it is not null). R2: a re-picked `passed` option still goes through the existing plan checks (started, full, not fitting are rejected as today).

## I/O & Edge-Case Matrix

| Item | State | Expected |
|---|---|---|
| S6 | anon / authenticated select `events.waitlist_cycle` | permission denied; other granted columns unchanged |
| R2 | credit: A `passed` (registration reopened), B `active`; Tal picks A+B | A and B `active`, `options_count` = used + passed + active after the upsert |
| R2 | picks only A | A `active`, B `replaced('admin')`, credit has an active option |
| R2 | picks a `passed` option whose session started, is full or does not fit | rejected by the plan as today; the option stays `passed` |
| R3 | registration already open, a place and a waiter, moved to another date | no `waitlist_spot` (no duplicate notice) |
| R3 | published, registration closed, a place free, waiter; reschedule moves close to the future | one `waitlist_spot` per active waiter (`notify_waitlist(id, 0)`) |
| R3 | registration was already open, or close overridden (does not move), or session full | no waitlist notice |
| R4 | concept now `regular`, source session `couple` | copy `regular`, capacity `default_capacity_regular`, only regular eligible products, display price null |
| R4 | concept kind = source kind | as today (source capacity and price) |
| R7 | admin moves a booking to a target outside the options | option `added_by = 'admin'`, also when the row existed (on conflict) |
| R8 | product `party_size` disagrees with kind | preview, placement and parked settle use the session kind: couple 2 places, credit `party_size` 2 |
| R9 | card of a customer with `profiles.anonymized_at` | not extended by `job_auto_extend`; absent from `admin_get_home.expiring_cards` and `admin_list_open_cards`; an unbound purchase (no customer) still listed |
| R17 | create / update product with `post_join_message` or `post_join_button_label` | `INVALID_INPUT` with `detail.field` = that key |
| R8 | create / update product so `party_size` disagrees with `eligible_event_kind` | `INVALID_INPUT`, `detail.field = 'party_size'`; agreeing values save as today |

</frozen-after-approval>

## Code Map

Live definitions (`pg_get_functiondef`, 2026-11-04) are in `C:/Users/ligal/AppData/Local/Temp/claude/5e0876a824e90cc4/7777f526-db3b-4445-8d12-dd7a114346ba/scratchpad/defs/*.sql`: start each redefinition from that file, not from the migration. Last migration of each:
- `events` column grant -- `20261022154256_refactor_sweep_db.sql:4886`; `supabase/tests/grants.test.ts:76-77` expected rows. S6 sweep (2026-11-04): no app/lib/components read selects `*` or `waitlist_cycle` from `events` (all use explicit column lists: `SESSION_COLUMNS`, `PUBLIC_SESSION_COLUMNS`, short `id, starts_at, concepts(name)`); no view reads `events`; no realtime channel; the invoker functions that read `events` are all in `private` with no execute grant to anon/authenticated (they run inside definer RPCs); the `concepts` select policies read only `concept_id`, `status`. No TS change needed.
- `public.admin_change_credit_options` -- `20261019211608_credit_adjustments_review_fixes.sql`. Upsert `where o.state = 'replaced'` → `in ('replaced','passed')`; `options_count` from a count of `used`/`passed`/`active` after the upsert (replaces `v_counted + cardinality`).
- `public.admin_reschedule_event` -- `20261029204903_reschedule_skip_revoked_pinned.sql`. `v_event` is the locked row before, `v_saved` after (trigger moves the close). Add the reopened check of `admin_update_event` (`20261022154256`, lines ~95-101) after `refresh_credits_for_event`, before the `event_changed` loop.
- `public.admin_duplicate_event` -- `20261022154256_refactor_sweep_db.sql:2368`. Read `default_kind` from the concept row already share-locked; capacity default as `admin_create_event` (`20261020200233_eligible_products.sql:1066-1071`). Product filter already uses `v_saved.kind`.
- `private.move_core` -- `20261018092457_move_booking_review_fixes.sql`. Admin-only branch (customer raises `MOVE_TARGET_NOT_ALLOWED`): insert and on-conflict set `added_by = 'admin'`.
- `private.plan_pinned_placement` -- `20261020200233_eligible_products.sql` (occupancy uses `v_product.party_size`); `private.place_pinned_booking` -- `20261004215859_pinned_product_approval.sql` (passes `eligibility_snapshot ->> 'party_size'`); `public.admin_settle_parked_purchase` -- `20261018084612_entitlement_corrections.sql:706` (booking `party_size` from the snapshot, credit copies it).
- `private.job_auto_extend` -- `20261019203305_auto_extend.sql` (outer loop); `public.admin_get_home` -- `20261013215833_refund_completion.sql` (`v_cards`); `public.admin_list_open_cards` -- `20261018084612_entitlement_corrections.sql`. Filter as `job_expiry_alerts` (`20261020200750_remove_personal_details.sql:865`): `pr.anonymized_at is null` on the existing left join.
- `private.apply_product_changes` -- `20261004103954_product_catalog_admin.sql`: remove both keys from the allow-list, the type check and the `case`; after the loop, reject `(eligible_event_kind = 'couple') <> (party_size = 2)` with `field = 'party_size'` (on the merged row, so an update of one field is checked against the stored other).
- Tests to extend: `credit-adjustments.test.ts`, `waitlist.test.ts` or `business-cancel.test.ts`, `events-admin.test.ts`, `move-booking.test.ts`, `pinned-approval.test.ts`, `entitlement-corrections.test.ts`, `auto-extend.test.ts`, `admin-home.test.ts`, `open-cards.test.ts`, `product-catalog.test.ts` (lines 274-292 write post-join keys: change to the rejection).
- Do not touch: `audit-data.ts` field lists (`waitlist_cycle`, `post_join_*` stay valid audit field names).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261104212518_hardening_db.sql` (`npx supabase migration new hardening_db`) -- revoke + re-grant the events column list without `waitlist_cycle`; the nine function redefinitions above; R8 data fix `update public.products set party_size = case when eligible_event_kind = 'couple' then 2 else 1 end where party_size is distinct from (...)` -- one file, no drop. Main session hands it to the work manager to apply.
- [x] `supabase/tests/grants.test.ts` -- drop the two `waitlist_cycle` rows.
- [x] `supabase/tests/*` (Code Map list) -- one test per matrix row, `inRollback`, `testName`.
- [ ] `lib/supabase/database.types.ts` -- regenerate after apply (no signature changes expected).
- [x] `_bmad-output/implementation-artifacts/fixes-log.md` and `deferred-work.md` -- record the fix if an entry exists; none known.

**Acceptance Criteria:**
- Given the migration is applied, when `get_advisors` runs, then no new WARN/ERROR beyond the accepted ones.
- Given the db tests of this fix and of 3.7, 3.8, 3.10, 3.11, 3.14, 3.18, 4.3, 4.6, 3.1, 2.6 and grants, when `npm run test:db` runs them, then all pass.

## Implementation Notes

- Built from the live definitions by a script (each edit asserted to match once); the migration is ASCII only. Grants re-stated for each function as live (definer RPCs to `authenticated`, private helpers revoked). `place_pinned_booking` and `apply_product_changes` signatures written schema-qualified (`public.payments`, `public.products`), same types.
- `eligible-products.test.ts`: three kind-change updates now send `party_size: 2` with the kind (R8 forward). `product-catalog.test.ts` create test no longer sends post-join keys.
- Risk for the main session (R8 forward): the product editor saved the kind and the party size separately, so a kind change was always refused. Resolved by the 2026-11-05 Spec Change Log entry.
- No fixes-log / deferred-work entry existed. Applied to dev by the work manager (db push, 2026-11-05) after the CLI's statement splitter cut `plan_pinned_placement` at a line ending in `case ... end` followed by `>`: the party size moved to `v_party` assignments and no line ends in `end` mid-expression. Advisors: only the accepted WARNs. `database.types.ts` regenerated: unchanged.
- test:db (main session): 20 files, 495 tests. Fixed in tests: the second events grant test (5.20) also excludes `waitlist_cycle`; the "started" setup moves the close; audit rows of one transaction matched, not ordered; the session-hours test no longer pins 14:30 (Tal set 14:00 on 2026-11-03, a business value), and the R4 test reads `default_capacity_regular` from the settings.

## Spec Change Log

- 2026-11-05, implementation risk (R8 forward), work manager's decision on behalf of the user. Trigger: the product editor saves the kind and the party size as separate rows, so a kind saved alone was always refused, and the editor's draft (`useState`, not re-read on refresh) kept the old size as a pending change. Amended: (1) `apply_product_changes`: a kind sent without a party size sets it (couple 2, regular 1), in the caller's one audit row; a party size alone that disagrees with the stored kind, or a disagreeing pair, is refused. (2) The refusal is a new code `PARTY_SIZE_KIND_MISMATCH` (`P0001`, `detail.field = 'party_size'`), message in `lib/errors.ts`: "מספר המשתתפות צריך להתאים לסוג המפגש: 2 בזוגי, 1 ברגיל" (replaces `INVALID_INPUT` for this case). (3) Boundary widened from "no product-form change" to: in `product-create-form.tsx` and `[id]/product-editor.tsx`, picking a kind also sets the draft's party size (`eventKindPatch` in `product-draft.ts`, unit-tested in `product-draft.test.ts`), and the editor's kind cancel returns both. `product-fields.tsx` and `product-screens.test.tsx` stay untouched (tab C). Avoids: a product whose kind cannot be changed, and a generic error. KEEP: party size from the session kind in every placement path; the data fix with no audit row.
- 2026-11-05, review finding 1. The editor still allowed saving the party-size row before the kind row (always refused). Amended within the same two form files and `product-draft.ts`: picking a party size sets the kind too (`partySizePatch`), the size row sends the kind with it, and either row's cancel returns both. Avoids: a valid edit refused because of save order. KEEP: everything in the entry above.

## Review Triage Log

**Pass 1 (2026-11-05), lenses: blind-hunter, edge-case-hunter, verification-gap, intent-alignment** (the first diff held only the migration; blind-hunter, edge-case-hunter and verification-gap ran again on the app and test changes). Verdicts: medium 1, low 5, false 8, rejected low 12.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Editor: after picking couple, saving the party-size row first (or cancelling only it) sends `{party_size}` alone against the stored kind and is always refused (4 reviewers) | medium | patch | `partySizePatch` in `product-draft.ts`: the size sets the kind in both forms; the size row sends the kind with it (`fieldChange`); each row's cancel returns both (`DRAFT_KEYS`). Unit tests in `product-draft.test.ts`. |
| 2 | R4 test pins `capacity_adults: 12`, a business value | low | patch | Reads `default_capacity_regular` from `business_settings`. |
| 3 | Session-hours test wrote and read back its own values | low | patch | Checks the live row has the end after the start, plus the constraint. |
| 4 | R2 matrix "does not fit" not covered | low | patch | Third passed option on a session made couple: refused, stays passed. |
| 5 | Migration header and the events grant lack the 2026-11-05 R8 rule and why `waitlist_cycle` is left out; `product-draft.ts` comment said "refuses any other pair" | low | patch | Comments only (the applied SQL is unchanged). |
| 6 | No render-level test that the forms wire `eventKindPatch`/`partySizePatch` and the cancel keys | low | defer | Home is `product-screens.test.tsx` (tab C); no interaction library. deferred-work. |
| 7 | No table check `(eligible_event_kind = 'couple') = (party_size = 2)` | low | defer | Needs a migration and seed checks; placement no longer reads the product size. deferred-work. |

Rejected: false -- `used` option re-picked (a used credit is not active: `CREDIT_NOT_ACTIVE`/`CREDIT_IN_USE`); R4 "regular product copied" (a couple source cannot hold a regular product); R4 same-kind already covered (events-admin, capacity 16, price 25000); S6 grant test equals access; R7 state assert (the moved booking uses the option); spec counts 9 vs 11 functions; tests outside the first diff (rerun); R8 matrix says `INVALID_INPUT` (change log, frozen). Low, unlikely or pre-existing, fix adds guards -- anonymize racing the hourly job under the lock; `move_core` keeps `assigned_at` and `options_count` (pre-existing, 3.10 (z)); snapshot readers `returned_expiry`/cancel (products and snapshots agree; dev 0 mismatches); data fix count notice (reported: 0); job vs lists customer join; R4 result flag for the screen; one query for the concept row; R17 stored post-join values; data-fix assertion; R9 other listings (intent names home and open cards).

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` -- pass.
- `npm run test:db -- <files>` -- pass. Run only by the main session, after the work manager applies the migration; an implementing subagent writes the tests but never runs `test:db` and never applies the migration.

**Manual checks:**
- Work manager, phone width, local dev server: duplicate a couple session of a concept now regular → a regular draft with regular capacity; reschedule a full session with a waiter after cancelling one booking past its close → the waiter gets the notice.
