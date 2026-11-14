---
title: 'Fix after 6.11: push tests, verification banner, failed pushes in prod-check'
type: 'bugfix'
created: '2026-11-15'
status: 'done'
baseline_commit: 'e677b6cf960e71d425de30d50c9be241b2fcb16f'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 6.1 emptied the dev Vault (`app_url`, `cron_secret`; spec-6-1 lines 30, 84) the dev push worker never runs, and three db tests fail on main (deferred-work, entry "PR קטן מיד אחרי 6.11"; plus the 6.11 email test); the verification banner still says "הקישור בתוקף שעה." (user request); and production shows "2 התראות פוש לא נשלחו השבוע" with no way to see why.

**Approach:** Fix the tests only (no code under test changes), drop one sentence from the banner copy, and add one read-only line to `scripts/prod-check.mjs` that lists the failed push jobs of the last 7 days.

## Boundaries & Constraints

**Always:** tests change, not the push sending code; Vault values only seeded inside `inRollback` with fake values (`https://app.example.test/`, `test-secret`), as `push.test.ts` lines 931–936 already do; prod-check stays read-only and prints no recipient id, name, email or endpoint.

**Never:** refill the dev Vault; any write to the prod Vault or prod DB; MCP/`execute_sql` against prod; a migration (if one turns out needed: stop and report); fixing the cause of the prod push failures in this PR without the work manager's approval; `demo:*`/`video:*` scripts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Notes |
|---|---|---|---|
| Two workers test | dev has real `queued` jobs younger than 24h with a subscription (worker no longer drains dev) | worker `one` claims one of the test's own jobs, never a foreign one | diagnosed: passes now only because all 18 dev queued jobs are >24h old (claim skips those); fails whenever a fresh one exists |
| Real `invoke_push_worker()` | dev Vault empty | the test seeds both values in its rollback, gets an id and 2 own queued requests; `expectNothingKept` proves nothing committed | — |
| Recovery email | Vault image URL on `supabase.co` | no `href` points at `supabase.co` | the logo `src` may |
| prod-check, no failed jobs | 0 rows | `✓ התראות פוש שנכשלו ב-7 הימים האחרונים: 0` | — |
| prod-check, failed jobs | N ≥ 1 | `✗ התראות פוש שנכשלו ב-7 הימים האחרונים: N`, then one indented line per job: `finished_at` (Asia/Jerusalem), notification type, `attempt_count`, `last_error` | `last_error` holds only codes (`HTTP_403`, `LEASE_EXPIRED`, ≤200 chars, `push-worker.ts:187`) |

</frozen-after-approval>

## Code Map

- `supabase/tests/push.test.ts:548-607` -- "every job is taken once": call `isolate(one, jobs)` on connection `one` after `begin` and before `asServiceRole(one)` (it writes as postgres). It pushes foreign queued jobs a day ahead inside `one`'s transaction; `two` claims with `for update skip locked`, so it skips those locked rows and never blocks. Comment why (dev worker idle since 6.1).
- `supabase/tests/acceptance-notifications.test.ts:482-511` -- seed `app_url`/`cron_secret` (delete + `vault.create_secret`, as push.test.ts:931-936) at the start of the rollback; replace the comment "The dev Vault has app_url and cron_secret…".
- `supabase/tests/email-verification.test.ts:534` -- `not.toContain("supabase.co")` becomes `not.toMatch(/href="[^"]*supabase\.co/)`.
- `lib/copy/customer.ts:221` -- `sentAfter: ". לא הגיע? כדאי לבדוק גם בתיקיית הספאם."`; fix the comment on line 218. No test quotes it; no guide/video additions file in the repo.
- `scripts/prod-check.mjs` -- new `checkFailedPushes(prod)` after `checkPushWorker`; same 7-day rule as `push_failed` in `admin_get_attention_items` (`status = 'failed' and finished_at >= now() - interval '7 days'`), joined to `notifications` for `type`. Update the header comment.
- `_bmad-output/implementation-artifacts/fixes-log.md` -- row 25: 2026-11-12, אדמין › בית ואזור אישי › בית (`/me`), באנר "שלחנו מייל אימות אל…", remove "הקישור בתוקף שעה.", "מצב: סגור ב-fix-after-6-11".
- `_bmad-output/implementation-artifacts/deferred-work.md:1022-1026` -- status "נסגר ב-fix-after-6-11" + what was done (the real cause of the push.test failure).

## Tasks & Acceptance

**Execution:**
- [ ] the five code/test files above
- [ ] the two docs above
- [ ] `node ../brunch-at-tals-fix-after-6-11/scripts/prod-check.mjs` from the main folder (reads its `.env.prod.local`, prints no secret); report the failed jobs and a hypothesis to the work manager

**Acceptance Criteria:**
- Given the three db test files, when run against dev (after the work manager's go), then they pass with the dev Vault still empty and no `test_` rows or HTTP requests kept.
- Given `components/shared/email-verification-notice.tsx`, when the "sent" banner renders, then its text comes only from `sentBefore` + email + `sentAfter`, reading "שלחנו מייל אימות אל {email}. לא הגיע? כדאי לבדוק גם בתיקיית הספאם." (code check; "שליחה חוזרת" is never pressed: a real Resend email to the fake dev-customer address would bounce and hurt the sender's reputation — work manager, 2026-11-15).

## Implementation Notes

- Oneshot: ~120 lines across 5 code/test files and 3 docs.
- `push.test.ts` diagnosis: the test passed alone on 2026-11-15 because all 18 dev `queued` jobs were >24h old (claim skips those). On 2026-11-11 fresh reminder jobs with a subscription existed and `claim(1)` took one of them. `claim_push_jobs` locks only with `for update of j skip locked`, so `two` never waits on `one`'s `isolate` locks.
- Added after the spec (work manager, 2026-11-15): the `invoke_push_worker` response line shows pg_net's `error_msg` when there is no status; the failed-push line shows the jobs sent in the same 7 days and each failed recipient's subscriptions, under a running number. New deferred-work entry, target "תיקונים": 403 is not `gone`.
- prod-check output (read-only, 2026-11-15): 2 failed `marketing_reminder` jobs (11-11, 11-12), both `HTTP_403` after 5 attempts. Sent in 7 days: 0. One recipient, whose only subscription (android) was registered 2026-11-15 00:00, after both failures. The other ✗ is a single pg_net "Error in the HTTP2 framing layer". No test push was sent (work manager).
- test:db, the three files: 92/92 passed against dev, with the dev Vault still empty.

## Review Triage Log

Quick review, one reviewer, with `review-accepted.md`.

| # | Finding | Verdict | Route | Action |
|---|---|---|---|---|
| 1 | prod-check header comment not updated (spec asks for it), new outputs not listed | low | patch | header now lists the indented detail lines and every new output |
| 2 | failed-recipient subscriptions printed as one flat list, not tied to a recipient | medium | patch | one query; each recipient under a running number ("נמענת 1") with her jobs and subscriptions, no id |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` -- all pass
- `npx vitest run --project db supabase/tests/push.test.ts supabase/tests/acceptance-notifications.test.ts supabase/tests/email-verification.test.ts` -- pass (only after the work manager's go)

**Manual checks:**
- Code check instead of a browser check (work manager, 2026-11-15): `sentAfter` is the only source of the sentence in `email-verification-notice.tsx`; no click on "שליחה חוזרת".
