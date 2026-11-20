---
title: '6.3 External backup and restore drill'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_commit: '2754c31e662e0a1bb270d11a61749e9442d05fa0'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-1-production-environment.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The production project is on the Supabase free plan, which has no backups. Before content is edited in production or a real customer enters, the database and the public images need a protected external backup and a restore that was actually tested (source doc, "תחזוקה ונתונים"; security-and-rpc-rules line 68).

**Approach:** A daily GitHub Actions workflow in a private repo of the business dumps the production database (Supabase's documented roles / schema / data split), encrypts it with gpg to a public key (private half held by the user and Tal), stores it there, and copies new files from the public bucket. This repo holds only the scripts, workflow templates and Hebrew restore instructions, never a secret or a backup. One restore drill proves the backup decrypts and restores with equal row counts.

## Decisions (user, 2026-11-20, via the work manager)

- DB login: dedicated read-only role `backup_reader` (migration: NOLOGIN, `bypassrls`, member of `pg_read_all_data`; login + password set by the user in the SQL Editor, dev then prod).
- Drill: inside the private repo's Actions on a throwaway local Supabase stack (`supabase start` on the runner); the private key is a temporary Actions secret for the drill and is deleted right after. Dev keeps running.
- Private key: two copies, the user's and Tal's (her private Google Drive folder or her password manager), **no passphrase** (losing the key is the bigger risk; the backups sit in a private repo anyway). Tal's guide and README say only where the key is and whom to contact, never the key. Replaces "only Tal holds the key" (2026-11-01).
- `media-drafts` is not backed up: after a restore the site shows every image; re-cropping an old image needs a re-upload.

## Boundaries & Constraints

**Always:**
- Production secrets live only in the private repo's Actions secrets (typed by the user) and `.env.prod.local` (read only via `scripts/prod-env.mjs`). Nothing prints a secret, a connection string, or a row of data; logs show only file names, sizes and row counts.
- The backup file is encrypted before it is written anywhere; the workflow never holds the private key (except during the drill, per Decisions).
- Backup workflow failure (paused project, bad secret) fails the run. GitHub emails a failed scheduled run to the user who last changed the cron line, not the repo owner; README says who that is.
- Each daily DB backup is one GitHub Release (`db-<date>`, `gh release create/delete`), so retention really frees space (git history never does; 100 MB file limit). Images are committed to git under `media/` (add-only).
- Full rehearsal on the dev project first (fictitious data, dev `backup_reader` login): dump (roles / schema / data incl. `auth.users`, `storage.objects`), encrypt, store, drill. Only then production.
- `supabase db dump` runs `pg_dump` inside Docker on the runner; the CLI image and the drill's local stack match Postgres 17. Workflows use one `concurrency` group (no two runs push at once).
- Restore instructions in README, plain Hebrew: download, decrypt with Git for Windows' `gpg` (nothing to install), restore DB into a new project, re-upload images, re-enter Vault values (`app_url`, `cron_secret`; the dump holds them encrypted with the old project's key), reset login roles' passwords.

**Never:**
- No paid resource, no plan upgrade (id 10); no production smoke paths (6.8).
- No customer data anywhere except the encrypted backup; never use the dev project as the restore target.
- No change to payment code (`approve_payment_core`, `plan_funding`, `occupied_places`, `bookings`); never `demo:*`, `video:*`, `supabase db reset`.
- A subagent never pushes, writes `.env*`, or creates/changes the private repo or its secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Daily run | cron, prod reachable | Release `db-<date>` with `db-<date>.tar.gpg` (roles, schema, data) + `counts-<date>.json` (row count per table in `public`, `auth.users`, `storage.objects`); new `media-public` files committed | — |
| Restricted role | `backup_reader` (not superuser, no `pg_authid`) | `--role-only`, schema and data dumps all succeed (proved on dev first) | a failing part fails the run; nothing stored |
| Paused / unreachable prod | free project paused | run fails with a short Hebrew/English line, no partial file stored | GitHub failure email |
| Same day rerun | Release for the date exists | replaced, not duplicated | — |
| Retention | > 30 daily Releases | delete all but the last 30 daily + the first of each month for 12 months | — |
| Decrypt on Windows | `.gpg` file + private key file (no passphrase) | `gpg --import` once, then `gpg --decrypt` with Git's gpg yields the tar | wrong / missing key: gpg "no secret key", nothing written |
| Drill | latest backup | restored DB counts equal `counts-<date>.json` for every table; image count equals bucket | any mismatch: drill fails, names the table |

</frozen-after-approval>

## Code Map

- `scripts/prod-env.mjs` -- guard and `connect()` (read-only session); reuse for any local prod read (e.g. counts check). Do not change its env names.
- `scripts/prod-check.mjs` -- read-only check pattern (✓/✗ lines); add a line: role `backup_reader` exists, NOLOGIN or login, `bypassrls`, member of `pg_read_all_data`, nothing more. Payments track may touch it: keep changes small.
- `supabase/config.toml` -- `major_version = 17` (dev is 17.6); the drill's local stack and `pg_dump` must be 17.
- `supabase/tests/grants.test.ts` -- `EXPECTED_GRANTS`; role check at line ~311 lists only Supabase roles. add `backup_reader` membership/attribute expectations here (and its grants, if any, in `EXPECTED_GRANTS`).
- Pooler (Supavisor) username for a custom role is `backup_reader.<project-ref>`; write it in `ops/backup/README.md` next to the secret names and prove it in the dev rehearsal.
- `README.md` -- "סביבות" (line ~172) gains "גיבוי ושחזור"; keep the 6.1 runbook intact.
- Supabase docs (backup-restore): `supabase db dump --remote=<url> -f roles.sql --role-only`, `-f schema.sql`, `-f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes`; restore `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql`. Storage objects are not in the dump. CLI pinned `supabase@3.1.0` (`--remote`, like `prod-migrate.mjs`).
- Facts (checked 2026-11-20): dev `postgres` role is not superuser, has `bypassrls`, `createrole`, and `pg_read_all_data` with admin option, so a read-only `bypassrls` login role is possible. Free plan: 2 active free projects per user across orgs; paused projects don't count; a paused project restores within 1 year with its data. Pausing: "insufficient user database activity over the past week"; docs don't say whether a pg_dump connection counts.

## Tasks & Acceptance

**Execution:**
- [x] `ops/backup/backup.sh`, `ops/backup/counts.sql` -- dump, tar, `gpg --encrypt --recipient-file`, counts; strict mode, no `set -x`, secrets only from env.
- [x] `ops/backup/media.mjs` -- list `media-public` objects via the DB connection (`storage.objects`), download new ones by public URL (no API key), skip existing.
- [x] `ops/backup/workflows/backup.yml` -- daily cron + `workflow_dispatch` (input: `dev` or `prod` target, separate secrets), pinned action SHAs, `permissions: contents: write` only, `concurrency` group, CLI pinned, Release per day, retention step.
- [x] `ops/backup/workflows/restore-drill.yml`, `ops/backup/drill.sh` -- `workflow_dispatch` only: pick a Release, decrypt with the temporary key secret, `supabase start` (Postgres 17), restore per Supabase docs, upload images, compare counts; prints only table names and counts; fails with a clear line when the key secret is absent.
- [x] `ops/backup/restore-media.mjs` -- upload a backup's image folder to a target project (target URL + secret key from `.env.restore.local`, never printed).
- [x] `ops/backup/README.md` -- what to copy into the private repo, exact secret names; `test/backup-*.test.ts` for pure helpers (retention choice, counts comparison, no secret in messages).
- [ ] Migration -- `npx supabase migration new backup_reader_role`: role `backup_reader` NOLOGIN, `bypassrls`, member of `pg_read_all_data`, explicit, idempotent (`if not exists`); the user enables login + a password in the SQL Editor (dev for the rehearsal, then prod); the password never enters a file. Then SQL Editor run (user), `schema_migrations` row, `get_advisors`, types, `grants.test.ts` updated, `test:db` (work manager go).
- [x] `README.md` -- "גיבוי ושחזור": daily backup, where it lives, key custody, decrypt + restore steps in plain Hebrew, drill record.
- [x] `_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md` -- round 13 row: track C `fix-push-key-change` ✅ (PR #162, 2026-11-15); decision lines (verbatim): "2026-11-20, החלטת המשתמשת: סדר סבב 13. 6.3 והסליקה רצים במקביל. 6.8 מתחיל רק אחרי ש-6.3 והסליקה ממוזגים, כדי שהבדיקה התפעולית תרוץ על הגרסה הסופית ותבדוק גם שהסליקה כבויה באתר החי." and "2026-11-20, החלטת המשתמשת: מפתח הפענוח של הגיבוי בשני עותקים, אצל המשתמשת ואצל טל, בלי סיסמה על המפתח; המדריך אומר רק איפה הוא נמצא."; plus the other gate decisions (role, drill location, no drafts). `guide-additions.md`: where the key is and whom to contact.
- [x] `deferred-work.md` -- pause item (id 10 target): the answer from Design Notes; new id 10 item: Tal also gets the backup failure email (who last edited the cron), or it is known where it goes.
- [ ] Main session with the user -- key pair, private repo, secrets; dev rehearsal (backup + drill); then prod: first real run, encrypted check, local decrypt, drill; `tickets.py pull` + `mark done`.

**Acceptance Criteria:**
- Given the private repo's first manual run, when it ends, then the stored file is not readable as text (gpg packet header only) and `gpg --decrypt` with the private key on Windows yields roles/schema/data.
- Given the drill, when it ends, then every table's restored count equals the backup's counts and the image count matches.
- Given this public repo, when grepped, then no connection string, key, backup file or real data is in it.

## Design Notes

Pausing (item 6, deferred id 10): the docs count "user database activity", and the daily dump is a real login and queries through the pooler, so it probably helps, but this is not documented. Not relied on: if the project pauses, the backup run fails and an email goes out the same day (to whoever last changed the cron), an early warning. The paid upgrade (id 10) remains the fix.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` -- pass.
- `shellcheck` not available: review `set -euo pipefail`, quoting.

**Manual checks:**
- Private repo: one real run, file encrypted, local decrypt; drill passes; Actions log shows no secret or row data.

## Implementation Notes

- **`--role "postgres"`:** CLI 3.1.0's `db dump --dry-run` shows every dump (roles, schema, data) runs `pg_dump(all) --role "postgres"`, which needs membership in `postgres` (write access) and would break the read-only `backup_reader`. So the CLI only prints its scripts (placeholder URL, never connects); `prepareDumpScript` (`ops/backup/lib.mjs`) drops `--role "postgres"` and the `export PG*` lines, keeps Supabase's exclusions and sed filters, and the scripts run in a pinned `postgres:17.6` image with libpq vars from a docker `--env-file`. The same image runs `psql` (counts, media list, drill restore), so `\restrict` and versions match 17. Checked: all three real dry-run outputs prepare and pass `bash -n`.
- One secret per target (`PROD_BACKUP_DB_URL`, `DEV_BACKUP_DB_URL`: full session pooler URL with `backup_reader.<ref>` and its password); `tool.mjs pg-env` splits it and `::add-mask::`s password, host and user. The public image URL comes from the ref. Public key lives in the private repo as `keys/backup-public.asc`.
- Counts: `counts-<date>.json` counts the COPY rows of `data.sql` itself (consistent with the backup, no race); `counts.sql` live counts only fail the run when a live table is missing from the dump. Also holds `media_public_objects`.
- Media: `media-list.sql` (psql, as backup_reader) -> `media.mjs` (fetch by public URL, add-only, `manifest.json`, re-download when `updated_at` changes). `restore-media.mjs` uses plain `fetch` to the Storage API (no npm deps on the runner), dry run unless `--apply`, refuses the dev project and the current production ref (`.env.prod.local` via `scripts/prod-env.mjs`). Review fixes: Release before media (media/push failure keeps the Release, retention still runs, run fails), `git pull --rebase` before push, gpg `--list-only` packet check, `BACKUP_KEY_FINGERPRINT` Variable (the compare strips all whitespace, so a fingerprint pasted with spaces or a line break matches; fixed after the first dev run), image pinned to its digest, drill in its own concurrency group.
- First dev drill (2026-11-20) failed at restore: `column "link_token_hash" of relation "one_time_tokens" does not exist`. CLI 3.1.0 pins gotrue v2.197.0 / storage-api v1.90.1 (`apps/cli/src/shared/services/Dockerfile`); `link_token_hash` came in auth v2.198.0 (migration `20260911120000`). Verified in the v3.1.0 source: legacy `start` reads `supabase/.temp/{gotrue,storage}-version` through `readServiceVersionOverrides` (`resolveDbBootstrapConfig` -> `resolveStartImagePlan`) with no link check (skipped only in stack-state mode; auth gated on major > 14), adds the `v` prefix, rejects `vv`; gotrue's root command runs `migrate` then `serve`. So `drill.sh` writes both pins, fixed in the script (`AUTH_VERSION=v2.198.0`, `STORAGE_VERSION=v1.98.2`, the versions the first dev drill passed with; explicit pins at the work manager's request so a drill is reproducible; update them when hosted moves ahead). Second dev drill passed: 42 tables equal, 9 cron jobs, 21/21 images. Residual risk: hosted can run an unreleased migration (auth master already has `20261116120000_add_client_auth_method_to_custom_oauth_providers`); the drill would then fail the same way until that release ships. A real restore goes to a new hosted project, whose services are current.
- Dev Release tags `dev-db-<date>`, media `media-dev/`; retention only touches the run's own prefix.
- The dump excludes the `vault` schema (Supabase's list), so README says the Vault values (`app_url`, `cron_secret`, `resend_api_key`, `site_url`, `email_image_url`) are re-entered. Cron: the first dev run (2026-11-20) showed `supabase db dump` skips the `cron` schema's rows too (the earlier "data dump keeps cron" reading was wrong; `cron.job` was removed from the counts). So `cron-dump.sql` writes `cron.sql` (one `cron.schedule(%L, %L, %L)` per job, ordered by jobname) into the encrypted tar, `counts-<date>.json` gets a separate `cron_jobs` field (not in `tables`), the drill runs `cron.sql` after the table compare and fails unless `cron.job` equals `cron_jobs` (older backups without it: skipped with a line), and README restore step 5 runs `cron.sql`, keeping the migration list only as the fallback for an old backup; `supabase_migrations` is excluded too, so README adds `migration repair --status applied`.
- Migration checked on dev inside a rolled-back transaction (pg, `DEV_DATABASE_URL`): role created NOLOGIN, `bypassrls`, not super/createrole/createdb/replication, member of `pg_read_all_data` only, rerun is a no-op; as `backup_reader` reading `public.profiles` works, `update` is refused (42501); `counts.sql` returned 40 tables incl. `auth.users`/`storage.objects`; `media-list.sql` 21 objects; the prod-check and grants-test queries return the expected rows. Rolled back: the role does not exist on dev.
- Not done (main session / user): SQL Editor run + `schema_migrations` row, `get_advisors`, types (a role changes no types), `test:db`, private repo, key pair, secrets, dev rehearsal, prod run, drill, tickets. Not run here: Docker, gpg (no gpg-agent in the sandbox), any workflow.
- Post-merge (2026-11-20): `prod-migrate --apply` 137/137; `prod-check` all ✓ incl. `backup_reader`; prod Security Advisor 135 WARN (134 × 0029, 1 leaked password), all accepted. First prod backup `db-2026-11-20` (40 tables, 200 rows, 8 cron jobs, 21 images, 155 KB encrypted); prod drill passed (40 tables equal, 8 cron jobs, 21/21 images). `npm run prod:grants` fails in the main folder before any test ("Vitest failed to find the current suite", `supabase/tests/support/setup.ts:18`), also with the pre-6.3 `grants.test.ts`, so not caused by 6.3; likely a duplicated vitest in the main folder's node_modules. Deferred to the work manager (npm ci in the main folder with the Next.js patch PR), then rerun `prod:grants`.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-20; lenses: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Verdicts: high 2, medium 10, low 3, false 1, maybe-false 0. All routed patch except where noted; no bad_spec / intent_gap.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `gpg --list-packets` with an empty keyring exits 2 under pipefail: every good run dies | high | patch | `--list-only`, output captured, `|| true` |
| 2 | One failed image fetch / push before the Release loses the day's DB backup | high | patch | Release first, then images (`pull --rebase`), then retention; failure still emails |
| 3 | Drill shares the backup concurrency group: a pending scheduled backup can be cancelled | medium | patch | drill group `restore-drill` |
| 4 | `safeErrorLines` keeps quoted row values (`malformed array literal: "…"`) | medium | patch | mask quoted segments after the prefix; test |
| 5 | README Vault list misses `email_image_url`; pg_cron jobs not checked after restore | medium | patch | Vault step; jobs kept as `cron.sql` (dump skips `cron`, first dev run), counted as `cron_jobs`, checked by the drill; README step 5 runs it |
| 6 | Windows decrypt leaves the passphrase-less key in the default keyring | medium | patch | temporary `GNUPGHOME`, deleted after |
| 7 | Decrypted `roles/schema/data.sql` not ignored by git | medium | patch | root-anchored `.gitignore` lines |
| 8 | `restore-media` guards only dev, and the default manifest is the newest listing | medium | patch | refuses prod ref (via `prod-env.mjs`); README passes `--objects` from the restored DB |
| 9 | `postgres:17.6` mutable tag with prod creds in env | medium | patch | pinned by sha256 digest |
| 10 | Public key used without a fingerprint check | medium | patch | `BACKUP_KEY_FINGERPRINT` Variable, run dies on mismatch |
| 11 | `prod-check` role query differs from `grants.test.ts` (inherit, column ACLs) | medium | patch | same checks |
| 12 | No test runs `tool.mjs` (`errors` redaction, `count-dump`/`compare` contract) | medium | patch | `test/backup-tool.test.ts` |
| 13 | Drill: missing `.tar.gpg` blamed on the key; `db_port` not numeric-checked | low | patch | two guards |
| 14 | No drill cadence / key-copy check | low | patch | README line (every 3 months, after `ops/backup/` changes); deferred id 10 |
| 15 | Image history grows the private repo (re-download on `updated_at`) | low | defer | deferred-work, id 10 size check |

Rejected: guide-additions.md "missing" (false: it lives outside the repo, row 2 rewritten). Intent-alignment notes (backup/drill not yet run; drill path ≠ hosted restore) are the main-session tasks, not code defects.
