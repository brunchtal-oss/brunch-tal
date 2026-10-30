---
title: '6.6 Acceptance suite: payment, accounts, permissions, booking'
type: 'chore'
created: '2026-10-30'
status: 'done'
baseline_commit: 'ffb4e442477a704f515063037f6e00d6b52facf1'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment', 'mutation']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/acceptance-criteria.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/supabase/tests/support/db.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 35 acceptance clauses of "תשלום וחשבון" (P1–P9), "הרשאות" (R1–R3), "הרשמה ומכסה" (B1–B11), "השלמות › תשלום, אמצעי תשלום ושיוך רכישה" (SP1–SP8) and "השלמות › היכרות, מפגשים והמתנה" (SI1–SI4) were tested story by story; nobody has shown that every claim of every clause is proven. Today 11 clauses are fully proven; the rest have a missing or weak claim.

**Approach:** Map every claim to the it() that proves it (verified by reading its assertions), add DB/unit tests for every missing or weak claim, list the claims only a browser can show, and publish `acceptance-report-6-6.md` from a full `npm run test:db` run. No product code changes unless a new test exposes a bug and the planning session approves the fix.

## Boundaries & Constraints

**Always:** new DB tests use `inRollback`, `asAuthenticated`, `testName`, `onCleanup`; concurrency uses two pool connections and proves the second waits on the lock (`waitsOnLock`, as in `booking-concurrency.test.ts`); time claims use fixed 2099 dates or the pure `private` helpers, never `now()`-dependent branches; every assertion checks an outcome (row counts by identity, error code, state), never only "did not throw". New tests go in new `acceptance-*.test.ts` files named by topic, except the one concurrency case (needs `booking-concurrency.test.ts` helpers) and unit tests next to their module.

**Never:** change, weaken or delete an existing test; fix code before reporting a failing test (clause, actual, source doc, recommendation) to the planning session; add Playwright or any dependency; write a migration without approval (none expected); cover 6.7 chapters; touch `.env*`, `demo:*`, `video:*`, `*@video.example.com`, dev-customer or dev-admin; run `test:db` without the planning session's go.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New test passes | claim already enforced | row in report: עובר | — |
| New test fails | code breaks the claim | stop, report to the planning session | no fix, no test change before approval |
| Claim superseded | later decision (memlog, completion-plan, fixes-log) | report: "הוחלף בהחלטה" + source + date | no code change |
| Browser-only claim | logic only in the screen | spec row "בדיקה ידנית בדפדפן" with steps; the planning session runs it on local dev | — |

</frozen-after-approval>

## Code Map

- `supabase/tests/support/db.ts`, `support/money.ts` (`seedMoney`, `approve`, `insertProduct`) -- reuse.
- Patterns to copy (not exported): `join.test.ts` (`approveCard`, `testPhone`, join_begin/insertAuthUser/join_complete), `existing-account.test.ts:22-165` (`giveAccount`, `claimAs`, `tokenRow`), `pinned-approval.test.ts` (`insertEvent`, `fill`, `pinnedInput`, `createdFor`), `business-cancel.test.ts` (`pendingCredit`), `auto-extend.test.ts` (`job_auto_extend(p_today, ids)`), `booking-concurrency.test.ts` (`seedRace`, `race`, `waitsOnLock`).
- Signatures: latest definitions in `supabase/migrations/20261022154256_refactor_sweep_db.sql` (join_begin, claim_join, join_complete, bind_purchase, plan_funding), `20261001162630_create_money_schema.sql:312` (`issue_token`, hard-coded 48h), `20261005080440_intro_only_without_bookings.sql` (`intro_blocked`); types in `lib/supabase/database.types.ts`.
- `vitest.config.mts` -- `db` project `hookTimeout: 60_000` (full-run fix, see Spec Change Log).
- `lib/supabase/proxy.ts` + `proxy.test.ts`; `components/shared/contact-text.tsx` -- unit targets.
- Do not change: any existing `supabase/tests/*.test.ts` body, product code.

## Coverage map

C = covered (file:line, it). N = new test in this story (T#). M = manual browser (M#). S = superseded. Short names: AP approve-payment, RP repeat-purchase, J join, LL link-lifecycle, EA existing-account, AA account-admin, SR session-role-and-token-view, BC booking-concurrency, PA pinned-approval, BP bind-purchase, SB self-booking, MB multi-booking, CI couple-and-intro, WL waitlist, BUS business-cancel, AE auto-extend, SC session-completion, ME my-entitlements, AH admin-home, TP time-and-phone-helpers, MR money-rls, G grants.

| Cl | Claim | St | Proof |
|---|---|---|---|
| P1 | approval: same key → stored result, no new rows | C | AP:161 "returns the stored result for the same key…"; AP:194 IDEMPOTENCY_KEY_REUSED |
| P1 | approval: new key (2nd click) needs confirm | C | RP:334 "are shown within the window and need the confirmation" |
| P1 | join: same key / retry after mid-failure | C | J:337 "…LINK_USED for another, all once"; J:376 "survives a failure in the middle…"; LL:618 |
| P1 | approve ×2 → join with retries: one auth user, one profile (by email/phone), one payment, entitlement, grant | N | T1 |
| P2 | 05X/+972/00972 → one E.164 | C | TP:105 "%j is +972541234567" |
| P2 | other format finds the same account | C | EA:178, EA:323, J:209 |
| P2 | second link with +972 after joining with 05X → her account | N | T2 |
| P3 | link works once | C | J:337; J:579 "answers a %s link with %s"; EA:605 |
| P3 | replacement link 48h, old one revoked | C | LL:238 "revokes a %s link and issues a new pending one for 48 hours…"; LL:565 LINK_EXPIRED; AA:100 |
| P3 | approval link exactly 48h; no setting changes it | N | T3 |
| P3 | preview (token_view) does not activate a pending / awaiting_login link | N | T4 (LL:957 covers only claiming) |
| P4 | reset link exposes no customer data; touches only its target | N | T5 (SR:333, R:64 partial) |
| P5 | existing email/phone → no account, nothing bound | C | EA:282 "moves the link to awaiting_login…"; EA:323 |
| P5 | bound only after logging in to that account | C | EA:605 "binds the purchase to the signed-in account…"; EA:697 refuses others |
| P6 | expired card not extended at join | C | LL:869 "…expiry unchanged, marked expired_before_bound…"; LL:919 |
| P6 | contact option shown (copy "צרי קשר", see S notes) | N + M | T22 (unit); M5 |
| P7 | no account without consent | C | J:464 CONSENT_REQUIRED, 0 profiles; join actions.test.ts:120 |
| P7 | consent saved with version / with time | C / N | J:807 version; T6 `privacy_consent_at = now()` |
| P8 | stays logged in after close/reopen | N + M | T21 (cookie options kept); M1 |
| P9 | no self change of email / phone in auth.users / profiles | C | AA:446, AA:479, AA:513, J:851 |
| P9 | `phone_change` and `pending_email` self-writes refused | N | T7 |
| P9 | change through Tal blocked for another account's email | C | AA:259 "…is taken: nothing changes…"; AA:308 |
| P9 | the block is logged | S | fixes-log #6 (2026-10-18, 5.20); AA:259 asserts 0 rows |
| R1 | no entitlement: waitlist yes, booking no | C | WL:221; SB:350 NO_MATCHING_ENTITLEMENT |
| R1 | anon: nothing | C | WL:826; SB:772; MB:528; G:426, G:460 |
| R1 | signed in without active profile: nothing | C | WL:292; SB:787 |
| R2 | per-table read isolation | C | rls:60,79; MR:69,105,122; SB:805; WL:782; cancellation-credits:1009; notifications:893; and per-table tests listed in the report |
| R2 | RLS on for every public table; every table readable by `authenticated` has a policy | N | T8 |
| R2 | `booking_allocations` isolation | N | T9 |
| R2 | corrections, correction_bookings, work_tasks isolation with real rows | N | T10 (existing tests read empty tables) |
| R2 | every `admin_%`/`preview_admin_%` RPC refuses a customer, writes nothing | N | T11 |
| R2 | no write grant beyond profiles/babies | C | G:426 "match the explicit list"; J:851, J:875 |
| R3 | role / payment / balance | C | MR:177 "a customer cannot write to the money tables or admin_roles"; AP:441; MR:225 |
| B1 | last place: one confirmed (two connections) | C | BC:278, 317, 445, 482 |
| B1 | one entry cannot fund two bookings in parallel | N | T12 |
| B2 | couple: 2 places; 1 free not enough; no couple waitlist notice | C | PA:312; CI:686; CI:718; PA:441; WL:542 |
| B3 | card of 4 after reserve / cancel / attend | C | SB:204; cancel-booking:352; SC:258 |
| B3 | one sequence as read by `get_my_entitlements` | N | T13 |
| B4 | outside validity refused though valid today | C | SB:319; MB:290 |
| B5 | expires_on = paid_on + 49; end of local day | C | AP:62; TP:62, TP:70 |
| B5 | session at 23:30 local day 49 bookable, 00:30 day 50 refused | N | T14 |
| B5 | bookable after extension | C | entitlement-corrections:302 |
| B6 | couple paid separately, no card offset by her or Tal | C | SB:517; CI:747 |
| B6 | "אדמין יכולה, כחריגה מתועדת" | S | completion-plan:9, memlog:290 (2026-10-10) |
| B7 | no session → refused; one transaction; retry; unsuitable → nothing | C | PA:375; PA:236; PA:356; PA:399, 722, 941, 487 |
| B7 | full regular session via `admin_approve_payment` → EVENT_FULL, nothing created | N | T15 |
| B7 | counted before join | C | PA:236; SB:437 |
| B7 | moves to her through the real `join_complete` | N | T16 (PA:552/BP:131 call bind_purchase directly) |
| B8 | 12/14 on new sessions; regular setting applies | C | events-admin:134,171; settings-and-templates:247 |
| B8 | couple setting applies | N | T17 |
| B9 | empty week +7 once, audit, notice; full week no; DST week | C | AE:169, 241, 548, 349, 272, 405, 421 |
| B9 | only-couple week / only session cancelled: expiry +7 and one notice | N | T18 (AE:254, 263 check only the count) |
| B10 | 20:00 day before, both DST directions (helper) | C | TP:44, TP:52 |
| B10 | sent before, processed after → server time | C | BC:351; MB:423 |
| B10 | real sessions on DST edges, open branch | N | T19 (MB:460 depends on `now()`) |
| B11 | no-show used, no more intro | C | SC:408; PA:759 |
| SP1 | card: preview expiry = stored | C | AP:212 "preview and the saved entitlement agree…" |
| SP1 | pinned: preview `event_starts_at` = stored session | N | T20 (PA:236 checks event_id only) |
| SP2 | new card does not merge / reset | C | RP:117 |
| SP3 | phone+email of two accounts → stop, to Tal | C | EA:192; EA:400; AH:176 |
| SP4 | hidden method rejected | C | AP:395 PAYMENT_METHOD_NOT_SELECTABLE |
| SP4 | first method preselected | M | M2 |
| SP4 | add/rename/hide/show/reorder, used not deleted, last visible | S | completion-plan:8 (2026-10-10, 2.7 out) |
| SP5 | rename keeps old name, also in export | S | completion-plan:8; completion-plan:22 (2026-10-13) |
| SP6 | recorder + method on every payment; only approval creates | C | AP:62; AP:625, 631, 640; G:426; MR:177 |
| SP7 | credit moves to her with choice pending + one notice | C | BP:384 |
| SP7 | she sees it and can choose | N | T23 |
| SP8 | booked / took part: nothing bound (bind level) | C | BP:461, 497, 527, 583 |
| SP8 | end to end via join_begin → claim_join: conflict, nothing bound, `link_conflict` in "לטיפול", no raw error | N | T24 |
| SP8 | message shown, not an error | C | join actions.test.ts:475; claim-join.test.tsx:108 |
| SP8 | waitlisted → nothing bound | S | reversed: memlog:306 (2026-10-20), source §5 line 221; WL:699 |
| SI1 | second active intro right / booking refused | C | PA:487; BP:583; CI:779; PA:839 |
| SI1 | intro cancelled to credit, then second intro → INTRO_NOT_ELIGIBLE | N | T25 |
| SI1 | cancel before session is not a visit | C | PA:529, 881; cancel-booking:655 |
| SI2 | draft invisible on site and /me | C | events-admin:215; lib/sessions/public.test.ts:128,158,166; SB:401 |
| SI2 | date change with bookings: impact preview + notice | C + M | BUS:974, 1019; events-admin:350; M3 |
| SI3 | not both; booking removes; one notice per release | C | WL:256, 270, 625, 650, 666, 699, 462, 511, 886 |
| SI4 | not-chosen shown to Tal; at-risk list before cancel | C + M | AH:943; BUS:816; BUS:493, 450; M4 |
| SI4 | no deadline to choose (after aging + jobs) | N | T26 |

## Tasks & Acceptance

**Execution:**
- [x] `supabase/tests/acceptance-payment-account.test.ts` -- T1 three steps: (1) same key twice (double click) → same result, one payment; (2) second click with a new key and no `p_confirmed` → DUPLICATE_CONFIRM_REQUIRED, nothing created; (3) join with retries; at the end one auth user, one profile, one payment, one entitlement (by email/phone/product); T2 05X then +972 → existing_account, bound_user_id her; T3 approval link `expires_at - now() = 48h`, again after changing every business_settings value and product validity, and no `%link%`/`%token%` column in business_settings/products; T4 token_view ×3 on pending and awaiting_login: row (state, consumed_at, claiming_at, identity_attempts) unchanged, payment unbound; T5 reset token_view exact shape, no name/email/phone/id of A or B, reset_complete user_id = A, B's rows unchanged; T6 `privacy_consent_at = now()`; T7 `auth.users.phone_change` → ACCOUNT_CHANGE_BLOCKED, customer `update profiles set pending_email` → 42501, `admin_change_phone` with another account's number in 05X → taken; T20 pinned preview `event_starts_at` = `events.starts_at`; T23 after BP:384-style bind, `get_my_credits` as her shows the credit pending and `choose_credit_outcome` succeeds; T24 already booked and took-part cases end to end.
- [x] `supabase/tests/acceptance-permissions.test.ts` -- T8 `pg_class.relrowsecurity` true for every public table, and a policy exists for each table `authenticated` can SELECT; T9 `booking_allocations` B sees only hers, admin both; T10 seed a correction and a work_task as admin, admin sees ≥1, customer 0; T11 every `public.admin_%`/`preview_admin_%`, called as a customer with NULL args → P0001 NOT_AUTHORIZED, or 42501 when not granted to authenticated (both accepted); audit_log/payments/movements counts unchanged. Any other result or any write is an AD-5 finding: stop and report; never exclude the function or adapt the test.
- [x] `supabase/tests/booking-concurrency.test.ts` -- add T12 only (new it, existing bodies untouched): card with 1 entry, A holds `book_session(e1)`, second connection as A `book_session(e2)` proven waiting by `waitsOnLock`, then NO_MATCHING_ENTITLEMENT; one booking, balance 0/1; variant Tal's `admin_book_customer`.
- [x] `supabase/tests/acceptance-booking-quota.test.ts` -- T13 reserve E1,E2 → cancel E2 → complete E1, each step `get_my_entitlements` = movements; T14 card 2099-01-01 + 49, E1 local 2099-02-19 23:30 ok, E2 2099-02-20 00:30 ENTITLEMENT_EXPIRED_ON_DATE (preview and book); T15 full regular session, pinned single → EVENT_FULL, 0 payments/entitlements/bookings/tokens, occupancy unchanged; T16 pinned single for a new customer → join_begin/join_complete: booking hers, occupancy unchanged, one booking_confirmed, replay no second bind; T17 `default_capacity_couple` change applies to couple sessions created after; T18 only-couple and only-cancelled weeks: expires_on +7 and one `entitlement_auto_extended`; T19 sessions 2099-10-26 and 2099-03-28 close at 2099-10-25T18:00Z / 2099-03-27T17:00Z and are bookable (open branch).
- [x] `supabase/tests/acceptance-intro-business-cancel.test.ts` -- T25 intro booked, cancelled to credit, second intro approval and preview → INTRO_NOT_ELIGIBLE, no payment; T26 `pendingCredit`, age all sessions 30 days back, run `job_complete_events`, `job_refresh_credit_options`, `job_expiry_alerts`, `job_cleanup`: still `choice_pending` in attention items, `choose_credit_outcome(...,'refund')` → refund_requested.
- [x] T18, T26 (`job_*` calls) -- run inside `inRollback`; afterwards assert nothing of theirs remains, incl. `notification_jobs` and `net.http_request_queue`.
- [x] `lib/supabase/proxy.test.ts` -- T21 add it: refreshed cookie keeps its `maxAge`/`path` options on the response.
- [x] `components/shared/contact-text.test.tsx` -- T22 new: the expired-card explanation renders "צרי קשר" as an `<a>` to the WhatsApp href.
- [x] `_bmad-output/implementation-artifacts/acceptance-report-6-6.md` -- date, commit, passed count from the full `test:db` + `npm test` run; per clause עובר / לא עובר / הוחלף בהחלטה, relative link to test files; the M list. Before writing it, open every C row's it() and confirm the assertion proves the claim; a weak one becomes N with a test; state in the report that this was done row by row. Add a line listing where the old B6 offset wording remains.
- [x] `_bmad-output/initiative-brunch-at-tal-v1/epic-launch/tickets.toml` -- id 6 done (in the PR).

**Manual browser checks (planning session, local dev):**
- M1 (P8): log in as dev-customer, open /me, close the browser fully, reopen /me → no login screen; repeat after >1h; repeat as dev-admin on /admin.
- M2 (SP4): dev-admin → /admin/payments/new, pick a product → first method "ביט" is already selected.
- M3 (SI2): on a session with a booking, edit its time → nothing saved yet; the dialog shows old/new time, booking count, at-risk list and message before confirm; confirm is blocked without the checkbox. Stop before confirming; save nothing.
- M4 (SI4): on a session with a single-entry customer, "cancel session" shows the at-risk list with links to customer cards before confirm. Stop before confirming; save nothing.
- M5 (P6): log in as a customer with an expired-before-bound card, open /me/purchases, tap the info button on the expired card → the bubble's "צרי קשר" is a link to WhatsApp (T22 covers ContactText alone; the open toggletip has no automated test, no DOM harness).

**Acceptance Criteria:**
- Given the full `npm run test:db` and `npm test`, when they finish, then every N test passes and the report marks each of the 35 clauses עובר or הוחלף בהחלטה, with no `test_` rows left (`node scripts/dev-clean-test-data.mjs` dry run).
- Given any new test fails, when it is first seen, then work stops and the planning session gets clause, actual, source doc text and a recommendation.

## Superseded / wording notes

- P9 "ונרשם ביומן": superseded by fixes-log #6 (user decision 2026-10-18, 5.20): a step nobody needs to review later is not logged. No migration, AA:259 unchanged (planning session, 2026-10-30, option a).

- P6, SP8: "לפנות לטל" / "טל תחזור אליה" → copy is "צרי קשר" (UX memlog:119, 2026-10-02; no-Tal-in-customer-copy). Behaviour unchanged.
- B9 contradicts source lines 48, 234; overridden by joint decision 2026-09-26 (memlog:194). The partial-first-week rule is in spec 3.14 decisions (2026-10-19).
- B6 offset still named in `acceptance-criteria.md:27`, `coverage.md:86`, `ARCHITECTURE-SPINE.md:241, 460` (not edited here).

## Implementation Notes

- Planning session go (2026-10-30): single-file runs `npx vitest run --project db <new or changed file>` are allowed now, one at a time (never two db runs at once). The full `npm run test:db` and the report's final numbers need a separate go: write the report with the per-file results and leave the header's full-run count as pending. No git operations.

## Spec Change Log

- 2026-10-30, full `npm run test:db` (planning session): 74 files, 1391 passed, 1 failed. The afterAll cleanup of `booking-concurrency.test.ts` (`support/setup.ts:16`, `runCleanups`) hit the 10 s hook timeout and left 34 `test_` rows (two seedRace fixtures); `content.test.ts:264` then saw two extra card products. The planning session removed the rows (`dev-clean-test-data --apply`). Measured alone: cleanup 9.9 s and 10.0 s (two runs). No slow query: tables are tiny (audit_log 355 rows, seq scan); the time is about 19 sequential round trips per seedRace fixture over the remote pooler, and T12 added two fixtures. Amended: `hookTimeout: 60_000` on the `db` project in `vitest.config.mts`, with a comment. Avoids: a cleanup cut short that leaves committed rows and breaks later files. KEEP: T12 stays in `booking-concurrency.test.ts`; no existing test body changed.

## Review Triage Log

### Pass 1 (2026-10-30): blind-hunter, edge-case-hunter, verification-gap, intent-alignment, mutation

Verdicts: high 0, medium 3, low 5, false 0, rejected 13. Mutation lens: T3, T1 (link once), T11, T14, T15, T25 all fail when the guarded code is broken (rolled-back DDL only; functions re-dumped identical; no `test_` rows).

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | VG, EC, BH | T26 ages only the sessions, not the credit; a deadline keyed on the credit's age would pass | medium | patch | credit `created_at`, `original_cancelled_at`, `origin_starts_at` aged 30 days too |
| 2 | VG | T22 renders ContactText alone; the open expired-card bubble on /me/purchases is untested | medium | patch (report) + manual | no DOM harness in repo; M5 added to report and spec manual list |
| 3 | EC | T19 sessions close on the same UTC offset as they start; the DST crossing is not exercised | medium | patch | sessions on the DST-edge days added (close on the other offset) |
| 4 | BH, mutation | T14 name says "paid 2099-01-01" but sets expires_on by hand | low | patch | renamed; paid_on+49 proven by AP:62 (mutation 4c fails 4 tests there) |
| 5 | BH, EC | T3 changes only integer/time settings | low | patch | asserts the remaining columns are exactly id, default_prep_days, marketing_reminder_schedule, updated_at |
| 6 | BH, VG | report summary says all 35 pass while P6, P8, SP4, SI2, SI4 rest on pending M-checks | low | patch | summary reworded |
| 7 | BH | spec map cites MR:176, PA:528, J:561 (report corrected them) | low | patch | map fixed |
| 8 | BH | no legend/links for short file names in the report (story verify asks a link per clause) | low | patch | legend with relative links added |

Rejected: BH-status-done (story file `done` is PR content, as in 6.5; merge only after the full run); BH/EC T6 now() (inside one transaction now() cannot separate approval from join; consent-required path is J:464); BH/EC/expectNothingKept tautological (kept on the planning session's explicit request; rollback is Postgres's guarantee); EC T11 "nothing written" after savepoint and T15 zero counts (the refusal/error code is the proof; mutation 3 and 5a' fail); BH/EC T8 views (entitlement_balances and any new view are pinned by money-rls:90 and the explicit grant list in G:426); BH T11 prefix-only sweep (non-prefixed RPCs are per-story tested; service_role-only RPCs refused to authenticated by G:460); BH T21 mock-only and server.ts path (M1 is the proof, stated in the map); BH/IA T23 calls bind_purchase directly (join_complete calls it with no pre-check; real path in T16); EC T18 no control week / once / audit (AE:272, 349, 241, 169); mutation T12 any-lock (behaviour correct either way); BH tickets.toml unchanged (no status field; story file as in 6.5); IA surface-vs-rule readings (descriptive; browser surfaces are M1–M5 by design); IA superseded category (approved by the planning session at the spec gate).

## Verification

**Commands:**
- `npx vitest run --project db <new or changed file>` -- after the planning session's go; passes.
- `npm run test:db` (full, incl. `grants.test.ts`) -- after go; passes.
- `node scripts/dev-clean-test-data.mjs` (dry run) -- no `test_` rows.
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` -- pass.
