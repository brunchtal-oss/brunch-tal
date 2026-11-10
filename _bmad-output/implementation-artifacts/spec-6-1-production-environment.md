---
title: '6.1 Production environment (free tier)'
type: 'chore'
created: '2026-11-10'
status: 'done'
baseline_commit: 'a92fddf55ac123e505ae2a8b8bc4486052619286'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vercel production and preview both run on the dev Supabase project (fictitious data). Before Tal's meeting (6.4) and the email story (id 11), the live site needs its own empty production project, built once from the final migrations, holding only the real site content and Tal's real admin account.

**Approach:** The user creates a free production project; repo scripts (reading secrets from a git-ignored `.env.prod.local`, printing none) rehearse and push all migrations, copy the real content and images from dev, create admin accounts with a one-time link, and check the result read-only. Vercel Production switches to the new project; Preview stays on dev; the lock and noindex stay.

## Decisions (user, 2026-11-10)

- No other active free Supabase project: production is created on the free tier now.
- Organization: a new free organization for the business, production only; dev stays in the current free org.
- Dev Vault: both `app_url` and `cron_secret` emptied in dev after the switch; the dev cron then calls nothing (no 401).
- Post-merge check: public part on production as today; admin screens on production with the user's own production admin account (her email, she types her password in the browser window; read-only, no action buttons; kept or removed at handover, id 10); customer screens before merging on a local dev server from the PR worktree on the dev project (dev-customer). AGENTS.md is updated to this.
- Copied besides content: products, business settings, notification template texts, concepts, payment methods, marketing reminder texts.
- (א) Tokens in Vercel request logs: accepted, closed. (ב) No attempt limit on `POST /site-lock`: accepted, closed. `issue_reset_token` stays in production.
- (ח) Images: copy every media id referenced from any copied row (`draft_content` and `published_content_full` of sections, page content, hidden items and sections included, `concepts.default_image_id`) plus their `source_id` chain, rows and files (20 in dev today); only media no row references stay in dev. Orphan-draft cleanup in production is deferred to after launch.
- Production `VAPID_SUBJECT` = `mailto:` the business owner's email (Tal's email, from the user), typed only in Vercel.

## Boundaries & Constraints

**Always:**
- Production secrets live only in `.env.prod.local` (matched by `.env*` in `.gitignore`; Next.js never loads this name). The user creates and fills it. Scripts never print a secret, a connection string, a token (except the one-time link `prod-admin` exists to print) or an email.
- Every prod script first checks: `.env.prod.local` exists; `PROD_DATABASE_URL` pooler user / host carries the ref of `PROD_SUPABASE_URL`; that ref differs from the dev ref in `.env.local`. Otherwise it stops before connecting.
- Writing scripts default to a dry run and write only with `--apply`. Writes to production (push, copy, admin, auth-guard check) run only after the user's explicit OK for that step; read-only scripts and the rehearsal may run any time.
- The copy refuses to run when production holds any profile, event, payment, entitlement or booking, and refuses any copied row whose text key starts with `test_` or mentions `video.example.com`.
- Copy `content_sections.draft_content` and `published_content_full` (the trigger derives `published_content`); never write `published_content` alone.
- `updated_by` / `created_by` are set to null on copied rows (dev user ids mean nothing in production).
- Tal's email: from the user in chat, passed as a command argument by whoever runs `prod-admin`; never in any repo file, spec, commit or PR. Nobody asks for or receives Tal's password.
- Supabase MCP and `.env.local` stay dev only: no `execute_sql`, `apply_migration` or MCP call against production.

**Never:**
- No paid resource, no plan upgrade, no private repo, no domain (handover, id 10). No mail provider (id 11), backup (6.3), smoke test (6.8), unlock (6.9), payments.
- No new migration (none is needed: Data API schemas, Auth and Vault are dashboard settings).
- Never `demo:*`, `video:*`, `supabase db reset`; never `test:db` during a phone check.
- Never copy events, customers, profiles, bookings, payments, entitlements, credits, credit options, waitlist, notifications, jobs, audit, tokens, notes, work sheets, push subscriptions, idempotency or rate-limit rows, `marketing_tags` values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rehearsal | empty prod, all 132 files | every file runs in one transaction in version order, then ROLLBACK; prints file count and "OK" | first failing file name + SQLSTATE; nothing kept. A failure that only exists inside one big transaction (statement not allowed in a transaction block, enum value added and used in the same transaction) is not chased: `db push` (one transaction per file, stops at the first failure, resumable) is itself the real run; worst case the empty project is deleted and recreated |
| Paused / unreachable prod | free project paused | every prod script stops with "הפרויקט מושהה או לא זמין: Dashboard ← Restore" | exit 1, no retry loop |
| Wrong project | `PROD_DATABASE_URL` ref = dev ref, or ≠ `PROD_SUPABASE_URL` ref | stop, Hebrew message, no connection | exit 1 |
| Push | rehearsal passed | `prod-migrate --apply` runs `supabase db push --db-url` (dry run first); `schema_migrations` = file list | CLI error shown without the URL |
| Copy dry run | dev content | per table: insert/update/delete counts, media file count; no write | — |
| Copy with prod data | prod has a profile/event/payment | refuse, list table names | exit 1 |
| Copy rerun | already copied | same end state, 0 file uploads for files already there | idempotent |
| Media | content/concepts reference media ids | copy referenced rows + their `source_id` chain; draft file always, public file when `published` | missing dev file: stop, name the id |
| Admin | `--email <e> --name <n>` | Auth user (no password, email confirmed), `admin_roles` row, `full_name` metadata, prints one prod `/reset/<token>` link (48 h) | rerun reuses user, revokes old link |
| Read-only check | prod | session `default_transaction_read_only`; every check line ✓/✗ | any ✗ → exit 1 |

</frozen-after-approval>

## Code Map

- `.env.prod.local` (user-created, already given to the user with these exact names): `PROD_SUPABASE_URL`, `PROD_SUPABASE_PUBLISHABLE_KEY`, `PROD_SUPABASE_SECRET_KEY`, `PROD_DATABASE_URL` (session pooler, port 5432). Scripts read only these from it. The worktree has no `node_modules` yet: run `npm install` first (not `npm ci`).
- `scripts/dev-guard.mjs` -- `devRef()` ref check; reuse its logic for the prod ref check (add `prodRef` + `assertDistinctProjects`, pure, tested).
- `scripts/dev-reset-link.mjs` -- pattern for Auth Admin `createUser` (email_confirm, random password never printed), `admin_roles` upsert, `issue_reset_token`; `prod-admin` follows it.
- `scripts/dev-clean-media-drafts.mjs` -- media reference scan (sections, pages, concepts); reuse its reference SQL for the copy's media set.
- `supabase/tests/support/db.ts` -- `devDatabaseUrl()` guard and pool; add an explicit prod read-only target (`DB_TARGET=prod`: `PROD_DATABASE_URL` from `.env.prod.local`, ref vs `PROD_SUPABASE_URL`, `set default_transaction_read_only = on` in `onConnect`). Default behavior unchanged.
- `supabase/tests/support/setup.ts` -- loads `.env.local`; also loads `.env.prod.local` only when `DB_TARGET=prod`.
- `supabase/tests/grants.test.ts` -- read-only `describe("grants")` runs against prod; `"grants check catches a mistake"` stays dev only (needs DDL in rollback).
- `supabase/migrations/20261109224659_special_brunch_interest_drop_old.sql` / `20261110135810_special_brunch_interest_multi.sql` -- version order differs from dev apply order; in an empty DB 224655 creates, 224659 drops, 135810 recreates: valid. The rehearsal proves it.
- `supabase/migrations/20261021064354_notes_without_topics.sql` -- renumbering on an empty `notes` table; check it runs and `notes` is empty.
- `supabase/migrations/20261005194206_media_upload_and_publish.sql:31` -- creates `media-drafts` / `media-public` buckets.
- `private.invoke_push_worker` -- no call when Vault `app_url` or `cron_secret` is empty; `admin_get_attention_items` then shows `vault_missing`.
- `README.md` -- "Checklist לכל סביבה (AD-22)", "סביבות", "נעילת האתר".
- `AGENTS.md` -- post-merge production check line; Supabase dev-only line.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/prod-env.mjs` -- load `.env.prod.local` (never `process.env` from `.env.local` for prod values), guards above, `pg` client with SSL, Storage/Auth clients; pure helpers exported -- one guard for every prod script.
- [x] `test/prod-env.test.ts` -- unit tests: same ref refused, mismatched ref refused, missing vars refused, no secret in any error message -- guards are the safety net.
- [x] `scripts/prod-migrate.mjs` -- `--rehearse` (one transaction, all files sorted, always ROLLBACK), default dry run (`supabase db push --dry-run`), `--apply` -- real from-zero run before the push.
- [x] `scripts/prod-copy-content.mjs` -- dry run / `--apply`; tables: `content_pages` (by slug), `content_sections` (by page_slug+key: kind, sort_order, hidden, draft_content, published_content_full, published_at), referenced `media_assets` (same ids) + Storage files, `concepts`, `products`, `payment_methods`, `marketing_reminder_texts` (replace migration seeds with dev rows, same ids), `notification_templates` (by type: title, body, push), `business_settings` (editable columns) -- the content copy.
- [x] `scripts/prod-admin.mjs` -- `--email`, `--name`, dry run / `--apply`; prints only the link and "created/exists" -- Tal's and the user's production admins.
- [x] `scripts/prod-check.mjs` -- read-only: `schema_migrations` = files; 8 cron jobs; Vault names non-empty (values never read out); last `invoke_push_worker` responses 200; `marketing_tags` row with 3 nulls; legal pages + `cookie-notice` published; copied tables equal dev (hash per row); every media id referenced by a copied row exists in prod `media_assets` and its files in Storage; no `test_`/`video.example.com`; admin count; `guard_identity_change` enabled and `private.guard_auth_user_change` definition hash = dev -- one command for the prod checks.
- [x] `scripts/prod-auth-guard-check.mjs` -- with `--apply`: throwaway Auth user, self email change and phone change refused, admin email change without pending state refused, user deleted -- deferred (ג).
- [x] `supabase/tests/support/db.ts`, `supabase/tests/support/setup.ts`, `package.json` (`prod:grants`: node wrapper setting `DB_TARGET=prod`, running only `describe("grants")`) -- grants on prod, read-only.
- [x] `README.md` -- "סביבות" rewritten (two projects, which env points where), production runbook (step by step), adding an admin, Tal's local practice server (`npm run dev` on the dev project, fictitious admin `dev-admin@example.com`, filming logins), Data API row in the checklist, heading "נעילת האתר" without "עד תחילת E5".
- [x] `AGENTS.md` -- post-merge production check per Decisions; `.env.prod.local` rule.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- statuses for (א)–(ח), 5.15 rate limit, `issue_reset_token`; new entries: production media-draft cleanup (after launch); target id 10: keep or remove the user's own production admin account; target id 10: the paid upgrade ends free-tier pausing; target id 10: domain switch list for `morethanfood.co.il` (Vault `app_url`, Auth Site URL + redirect URLs, `NEXT_PUBLIC_SITE_URL`, `VAPID_SUBJECT` if it uses the domain).
- [ ] `_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md` -- gate decisions; `tickets.toml` -- `tickets.py pull`, `mark done` (main session).
- [ ] Main session with the user -- runbook steps in Design Notes, each with her OK.

**Acceptance Criteria:**
- Given the new project, when `prod-check` runs, then every line is ✓.
- Given prod, when `npm run prod:grants` runs, then `describe("grants")` passes with a read-only session.
- Given the Security Advisor in the prod dashboard, then only the accepted WARNs (`0029` definer RPC to authenticated, leaked-password protection) appear.
- Given Tal's link, when she sets a password at `/admin/login`, then the admin home opens (she or the user on her behalf).
- Given the dev project after the switch, when `net._http_response` is read (MCP), then no 401 since the switch.
- Given the live site (lock creds), then home, `/sessions`, gallery, legal pages and cookie notice show the copied content, `/sessions` has no session, and responses carry `X-Robots-Tag: noindex`.
- Given 9 wrong passwords for one non-existent address (never Tal's or the user's email) on `/login` and on `/admin/login`, then the 9th shows the `TOO_MANY_ATTEMPTS` message.

## Design Notes

Runbook (README holds the Hebrew copy-paste version): 1 org + project (two-active-free-projects limit per user: no other active one, checked 2026-11-10) (same region as dev, DB password in her password manager) → 2 `.env.prod.local` → 3 `prod-migrate --rehearse` → 4 dry run, `--apply` → 5 dashboard: Auth (signup off, anonymous off, confirm email off, Site URL + redirects = production URL, same min password length as dev), Data API exposed schemas `public` only, pg_graphql off, automatic table exposure off → 6 her terminal: new `CRON_SECRET`, VAPID pair → Vault (`app_url` = `https://brunch-at-tals.vercel.app`, `cron_secret`) in the prod SQL Editor → 7 `prod-admin` for Tal and for the user → 8 copy dry run, `--apply` → 9 Vercel: Production vars → prod (URL, publishable, secret, CRON_SECRET, VAPID ×3, `VAPID_SUBJECT` = `mailto:` the owner's email, typed only in Vercel), Preview vars unchanged on dev, redeploy production → 10 empty the dev Vault values → 11 checks. The Tal link is sent to her with the lock credentials (the site is locked).

Free-tier pause: a free project pauses after about 7 days without API activity, and the locked site gets almost no traffic (pg_cron inside the database likely does not count). Signs: the live site shows errors, prod scripts stop with the paused message, the dashboard shows "Paused". Fix: Dashboard → Restore (a few minutes; data kept). Check before 6.4 and 6.8; the upgrade at handover (id 10) ends it.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` -- pass.
- `node scripts/prod-migrate.mjs --rehearse` -- "OK", 132 files.
- `node scripts/prod-check.mjs`, `npm run prod:grants` -- all pass.

**Manual checks:**
- Prod dashboard Security Advisor; production in a real browser: Tal or the user logs in as admin; rate limit on both logins; live content without fictitious data.

## Implementation Notes

- Supabase CLI 3.1.0 (pinned in `prod-migrate.mjs` as `npx supabase@3.1.0`) has no `--db-url`; the push is `supabase db push --remote=<PROD_DATABASE_URL> --skip-vault [--dry-run | --yes]`, spawned through Node's own `npx-cli.js` (no shell parses the URL), output redacted (URL, password, user, host). Checked read-only against dev: `--dry-run` answered "Remote database is up to date" for all 132 files (no `--db-url`, no login needed).
- Pure copy rules live in `scripts/prod-copy-plan.mjs` (TABLES with key / copy / compare columns and mode replace / update / add, planTable, refusedRows, sourceFirst, mediaFiles, REFERENCED_MEDIA_SQL), tested in `test/prod-copy-plan.test.ts`; `prod-check` reuses them for the hash comparison.
- Rows are written through `jsonb_populate_record` (json, arrays and times keep their types). Round trip checked on dev in a rolled-back transaction: every dev row of every copied table upserted onto itself left all compare columns unchanged and the `_by` columns null. Dev today: 20 referenced media (all published, 40 files), 7 concepts, 4 products, 4 payment methods, 21 reminder texts, 23 templates, 12 pages, 27 sections; no refused row.
- `marketing_reminder_texts` replace: the production job may already have recorded `private.marketing_reminder_slots` against seeded texts (FK without cascade), so before deleting a seed the copy re-points its slots to the dev text with the same body, else the first dev text (the slot is only a once-a-day marker).
- `prod-check` push-worker line: the last 10 `net._http_response` rows must be 200; with none in pg_net's 6-hour retention it passes only when no push job is overdue (no admin push subscription means a quiet project makes no calls).
- `prod-admin` refuses `@example.com` / `@video.example.com`; it creates the user with `user_metadata.full_name`, no password.
- Prod pg connections use TLS without certificate verification, like the dev scripts (added to the existing deferred TLS-helper item). All connections `set timezone = 'UTC'` so dev and prod timestamps hash equally.
- `grants.test.ts`: `describe.skipIf(DB_TARGET === "prod")` on "grants check catches a mistake" (re-indents that block). `prod:grants` = `scripts/prod-grants.mjs` (guards, then Vitest `--project db supabase/tests/grants.test.ts` with `DB_TARGET=prod`).
- Not run (no `.env.prod.local` yet; main session with the user): `prod-migrate --rehearse` / `--apply`, `prod-copy-content`, `prod-admin`, `prod-check`, `prod:grants`, `prod-auth-guard-check`, and `npm run test:db` (not run on dev either, to avoid clashing with other tabs). Every prod script was run without the file and stopped with the missing-file message.
- Review fixes: the CLI gets the URL without its password and reads PGPASSWORD (dev dry run: up to date); optional 5th variable PROD_CRON_SECRET for prod-check (Vault cron_secret sha256 match, POST /api/jobs/push 200, a recent succeeded invoke_push_worker run), plus Auth settings, pg_graphql and RLS lines; DB_TARGET=prod needs PROD_GRANTS_RUN=1 and reads .env.prod.local into an object; prod-admin --name-file and refuses a user with a profile; reminder texts upsert, then slots move (slotTarget), then seeds go; auth-guard steps count only a GoTrue database error.
- `tickets.toml` (`tickets.py pull`, `mark done`) left to the main session.
- Runbook run 2026-11-10 (main session, each write with the user's OK): Auth/Data API settings verified from outside; `--rehearse` OK (132 files, rollback); `--apply` 132/132; Security Advisor 0 errors, only `0029` warnings (133, as dev); `prod:grants` passed read-only; Vault checked by hash; `prod-copy-content --apply`; two admins (`--name-file`, first names only); Vercel Production switched (two failed builds: the new variables were first named `PROD_*` / without `NEXT_PUBLIC_`; the old deployment kept serving); `prod-check` all ✓ (worker POST 200); live site: 401 without lock creds, public pages 200 + noindex, `/sessions` empty, images from prod Storage, `/me` and `/admin` redirect to login; dev Vault emptied; auth-guard check: phone and admin email change blocked, self email change "not proven" (Auth rejects the example.com target first; stays with id 11); rate limit: 9th attempt blocked on `/login` and `/admin/login`.
- User decision during the run (2026-11-10): only five concepts reach production (אמהות בחל״ד, יווני, זוגות, עם סבתוש, עם סבוש); `EXCLUDED_CONCEPT_IDS` in `prod-copy-plan.mjs` drops 60+ and פרסי from the copy and the check, and the 60+ image is still copied (20 images).
- Live finding: a `PROD_SUPABASE_URL` copied with `/rest/v1/` made Auth calls 404; the guard now refuses a URL with a path.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-10; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 9, low 6, false 3, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Slot re-point to a not-yet-inserted dev text breaks the FK and rolls back the copy | medium | patch | Dev rows upserted first, then slots, then seed delete; pure `slotTarget` + tests |
| 2 | Auth-guard check passes on any error | medium | patch | Only a GoTrue database error is ✓; other errors "לא הוכח", exit 1 |
| 3 | Wrong `cron_secret` / `app_url` undetected | medium | patch | `PROD_CRON_SECRET` (5th, optional); sha256 compare, `app_url` compare, worker POST 200, recent `invoke_push_worker` success |
| 4 | Dashboard settings not checked | medium | patch | `/auth/v1/settings`, pg_graphql absent, RLS on every public table |
| 5 | `DB_TARGET=prod` reachable from any `test:db`; PROD_* from process.env | medium | patch | Needs `PROD_GRANTS_RUN=1` from the wrapper; `.env.prod.local` read with `parseEnv` |
| 6 | Read-only prod pool untested | medium | patch | `it.runIf(prod)`: `default_transaction_read_only` = on |
| 7 | DB password in the CLI's argv | medium | patch | Password-less `--remote`, password in `PGPASSWORD`; dev dry run verified |
| 8 | Hebrew `--name` garbled through the shell | medium | patch | `--name-file` (UTF-8), stored length printed |
| 9 | Existing customer could become admin | medium | patch | Refused when `public.profiles` has the user |
| 10 | Every connect failure reported as "paused" | low | patch | "Tenant or user not found" / ENOTFOUND own message |
| 11 | `content_pages`/`content_sections` must stay last in TABLES | low | patch | Test pins it |
| 12 | `@example.com` leftovers and bad migration names pass prod-check | low | patch | Both ✗ now |
| 13 | epic-6-context keep-alive line; 5.15 entry status | low | patch | Aligned; status "פתוח" |
| 14 | `PROD_SUPABASE_URL` with a path (`/rest/v1/`) accepted (found live) | low | patch | Guard refuses a path; test |
| 15 | No rule for applying later migrations to production | medium | patch | Rule added to AGENTS.md › הרצה ובדיקה (work manager, 2026-11-10: belongs in this PR); deferred-work entry closed |

Rejected: storage rerun skips on name only (Storage uploads are whole-object, no partial file); dry-run wording on `admin_roles` (cosmetic); push line reads all `net._http_response` (the push worker is the only pg_net caller); intent-alignment notes are descriptive (writes in checks are gated by her OK).
