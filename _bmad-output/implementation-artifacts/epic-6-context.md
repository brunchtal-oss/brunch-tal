# Epic 6 Context: Launch: acceptance tests, production, backup and operations

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Take the finished system from the shared dev database to a separate, real production environment and open it to the public. At the end of the epic the site runs on its own production Supabase project with the real site content copied from dev, Tal's real admin account, a tested external backup, paid plans and a private repo, the business domain, and the lock and noindex removed. Success means Tal can run the business on it: payment approval, account join, booking and cancellation work in production with no duplicate or lost record. The only new capability originally planned (customer import) was cancelled: at launch every customer is new.

## Stories

- Story 6.5: Refactor sweep before acceptance tests (done)
- Story 6.6: Acceptance suite: payment, accounts, permissions, booking (done)
- Story 6.7: Acceptance suite: cancellation, notifications, content, screens, accessibility (done)
- Story 6.1: Production environment (free tier part)
- Story 6.11: Email verification and self-service password reset
- Story 6.3: External backup and restore drill
- Story 6.8: Production smoke rehearsal
- Story 6.4: Meeting with Tal: practice and real content
- Story 6.10: Handover: paid plans, private repo, domain
- Story 6.9: Go-live
- Story 6.2: Customer import and claim links (cancelled, not built)

## Requirements & Constraints

- No real customer data, real photos of women or babies, or secrets enter the repo; it stays public until the handover story. Real data lives only in Supabase.
- Production is a separate Supabase project that receives the same migration files via `supabase db push` into an empty database; the run from zero (including `create extension` and the trigger on `auth.users`) must actually succeed there. The dev project is kept forever (paused after handover, never deleted), and holds only fictional data.
- Content copy dev to production: copy all real site content (everything except the sessions schedule), including the legal pages (privacy, terms, accessibility) and the `cookie-notice` block, published before the site opens. Never copy sessions, customers, bookings, payments, entitlements, credits, notifications, audit log or tokens, nor any `*@video.example.com` or `test_` data. Products, settings, templates and payment methods: recommendation is to copy, confirmed at the 6.1 spec gate. For `content_sections`, copy `draft_content` and `published_content_full` (the trigger derives `published_content`); never write `published_content` directly.
- Production must show no fictional data; missing business fields stay in draft rather than invented content.
- Costs: nothing paid is created without an explicit user decision. 6.1 is free tier only; all paid upgrades (Vercel paid plan, Supabase plan and org structure, private repo, domain hookup) happen only in the handover story, with prices checked on official pricing pages first.
- The site stays locked (`SITE_LOCKED=true`, noindex) until go-live; removing it requires the rate limit to be verified active on `/login` and `/admin/login` and a real policy version published.
- Production smoke (6.8) uses fictional data and afterwards deletes only what it created (Auth users, their rows, Storage files) by targeted delete with a dry run first. Never `supabase db reset` on production, since the real content is already there.
- Tal's practice happens on a local dev server against the dev database with the fictional admin account; no `test:db` runs during practice and the video seed data is not reset.
- Backup (6.3): daily encrypted backup of the production database (and the public bucket) to a private GitHub repo of the business; only Tal holds the decryption key. A restore drill must pass before real data enters, with matching row counts on the main tables; the dev project is not used as the restore target.
- Email (6.11): free provider as Supabase Auth SMTP, SPF/DKIM on the business domain, email verification for both self-join and the form Tal fills for a customer, a "forgot password" page guarded by `hitRateLimit`, Hebrew email copy. An unverified email is never shown as verified and gets no reset link. Provider key server-side only. Until handover, links in emails point to the vercel.app URL.

## Technical Decisions

- Environments: production has its own Vault values (`app_url`, `cron_secret`), its own VAPID pair and `CRON_SECRET`, a business `VAPID_SUBJECT`, and Vercel production env pointed at it. Decide at the 6.1 spec gate where the dev Vault `app_url` points so the dev cron never calls production (and does not get 401).
- Auth settings are not in migrations and live in the README checklist per environment: public sign-up off, confirm email off (until 6.11), `site_url` and redirects, "Automatically expose new tables" off, pg_graphql not enabled, `sb_secret_` key verified. Only the `public` schema exposed in the Data API (consider revoking `net` usage from anon/authenticated).
- Admin access is a row in `admin_roles`; the README needs a line on adding Tal. Decide whether the dev tool `issue_reset_token` stays in production. Production cleanup of media drafts is decided in 6.1 (dev uses `scripts/dev-clean-media-drafts.mjs`).
- Manual checks owed on production: the `auth.users` guard trigger (`private.guard_auth_user_change`), the rate limit (single mechanism: `rate_limit_hit` via `lib/server/privileged/rate-limit.ts`, code `TOO_MANY_ATTEMPTS`), and the migration file name/version alignment from a clean push.
- Verifying production: security advisor clean (only approved WARNs), `grants.test.ts` read-only against the new project, pg_cron calls the push worker, Tal logs in as admin, live site shows copied content.
- Free Supabase project pausing: a free project pauses after about 7 days without API activity; pg_cron inside the database likely does not count, and the locked site gets almost no traffic, so pausing is expected in production until the paid upgrade at handover (id 10). Signs and the fix (Dashboard → Restore) are in the README; check before 6.4 and 6.8.
- Go-live: search/SEO code was prebuilt and is switched off; 6.9 only turns it on after the domain, sets the final URL, applies Tal's home H1, adds login CAPTCHA and the leaked-password decision (which also fixes the `weak_password` copy), and redirects vercel.app to the domain. `/me`, `/admin`, login, `/offline`, `/install` and preview keep noindex.
- Secrets stay server-side only; machine-to-machine routes exempt from the lock go only into `SITE_LOCK_EXEMPT_PREFIXES` with their own secret.

## UX & Interaction Patterns

- Story 6.11 adds a "forgot password" screen and Hebrew emails; screen work starts with the `frontend-design` skill within DESIGN.md and EXPERIENCE.md. Until it ships, password reset stays manual through Tal.
- Phone checks that depend on an https address (PWA install, push) run in production in 6.8 and again briefly on the domain at handover.

## Cross-Story Dependencies

- Build order: 6.5, 6.6, 6.7, 6.1, 6.11, 6.3, 6.8, 6.4, 6.10, 6.9.
- 6.1 builds production once from the final code, after all code stories and fix rounds, so no migration is applied twice. It also absorbs what remained of story 5.15 (rate limit check, optional preview lock).
- 6.11 needs the production Supabase project and the purchased domain (`morethanfood.co.il`) for DNS records; the site itself is connected to the domain only at handover (6.10).
- 6.3 depends on the Supabase plan; the backup must exist before content is edited in production or any real customer enters.
- 6.4 (the single meeting with Tal) needs production running: Tal gets her real admin account and approves content in the production editor.
- 6.9 comes after handover (domain, paid plans, private repo).
- Bugs found in these stories become `bug` tickets in the epic that built the capability, or in E6 if that epic is closed. Online payments are out of scope (separate round after a provider is chosen).
