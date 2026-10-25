---
title: 'Story 5.22: fictional data for the explainer videos (Video data)'
type: 'chore'
created: '2026-10-22'
status: 'done'
baseline_commit: 'da0f51f23c4276cd3d85fb723c9307f4860ac992'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-18-demo-data.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user films explainer videos (customer, Tal, public site) on the current site against the dev database, before 6.1. The 5.18 demo is stale (dates passed), its clear relied on a local id file and, without it, deleted everything.

**Approach:** New `video:seed` / `video:clear`. The seed builds a clean fictional world dated from the run day (Asia/Jerusalem) through the same RPCs the screens use, acting as a dedicated filming admin and as the customers. Everything is detectable in the DB without a file (reserved email domain + rows of the filming admin), so `video:clear` deletes exactly that world, including actions performed live while filming.

**Starting state (user decision 2026-10-22):** before the first seed, the user runs a one-time full cleanup SQL written by the planning session (not part of this story): all customers and their accounts, sessions, bookings, payments, entitlements, credits, refunds, waitlists, notifications, links, audit log and work sheets go. Kept: settings (content, concepts, products, payment methods, business settings, templates, reminder texts), the existing board notes, `dev-admin`, and `dev-customer` (נועה בדויה) with no bookings or entitlements. The seed assumes this clean DB; "גלית ותיקה בדויה" and "מאיה ברק" no longer exist (דורית is the inactive customer). First seed only after 5.20(B) is merged and the cleanup ran, on the planning session's go.

**5.20(B) (PR #121) is the target:** merge `origin/main` into the branch after #121 lands, before any DB run. It changes what the seed relies on: `admin_duplicate_event` refuses an archived concept and copies only products matching the event kind; `admin_update_product` refuses a kind change for a product eligible on a future session; `babies_guard` / `join_complete` accept a birth date from 2 years back to 9 months ahead of the local today; removing details is refused while the customer has a parked pinned purchase or an `awaiting_login` place; `register_push_subscription` accepts known push services only; hidden actions write no audit row (incl. `admin_approve_payment`, `join_begin`, `claim_join`, `set_booking_guest_details`, every work-sheet and note RPC, `admin_set_event_image`); a cancelled session's credit alternatives are only sessions that accept the credit's product.

## User guidelines (mandatory)

1. Regular brunches only on Monday and Thursday; couple brunches only on Friday.
2. No fictional customer holds two active cards.
3. No fictional customer holds a card and a future single entry.
4. A customer may hold a couple session in addition to a single or a card.
5. Every capability of the system has a way to be demonstrated (capability map below).

## Capability map

Video: **P** public (guest) · **C** customer · **A** admin (Tal). Live = performed while filming; it leaves data that `video:clear` removes unless marked "not cleaned".

| # | Capability (source) | Video | How it is shown | Data | Live |
|---|---|---|---|---|---|
| 1 | Public site CAP-1, Flow 1 | P | home → `/sessions` → session page (no occupancy) → about, how-it-works, gallery, contact, privacy, accessibility, terms; WhatsApp bar | published content (exists; seed writes none, warns if empty); published sessions | no |
| 2 | Occupancy chips CAP-13 | C | `/sessions`, `/me/sessions` as מיכל: "מלא" U2, "מקומות אחרונים" U4, "יש מקום" U5–U7 | occupancy targets | no |
| 3 | New-customer approval + link CAP-2/4, Flow 2 | A | payments → new → new customer → card → "אישור תשלום ויצירת קישור" → WhatsApp / copy | products, methods | yes |
| 4 | Join form + choose dates CAP-4/13, Flow 3 | C (new) | links list → "הפקת קישור חלופי" for חן לוינסון → form with a `@video.example.com` email → two consents → home with balance → "בואי נבחר תאריכים" → multi-select → sheet | open card link G2 | yes |
| 5 | Duplicate accounts CAP-5 | A | "לטיפול" link_conflict; links list "נעצר, צריך בירור" | conflict K | no (optional live: open a link with an existing video email → "חשבון קיים") |
| 6 | Repeat purchase CAP-6, pinned for existing CAP-37 | A | existing customer סתיו (card used up) → new card → "לרישום לתאריך"; single: session field "{תפוסים}/{מכסה}", full U2 not selectable | סתיו, U2 full | yes |
| 7 | Pinned purchase awaiting join CAP-37 | A | U1 details: row "לקוחה חדשה · ממתינה להצטרפות"; links "הקישור מחכה למימוש" | G | no |
| 8 | Login, forgot password, reset link CAP-7 | C + A | login with a filming account; "שכחתי סיסמה" explanation; admin issues a reset link for a non-filming persona (לירז) and opens it | — | yes (never on a filming account) |
| 9 | Phone / email change CAP-7 | A | customer card → change phone (`03-00002NN`) / email (must stay `@video.example.com`) | any persona | yes |
| 10 | Profile, babies CAP-8; consents CAP-40 | C | מיכל profile: name, add a baby, dietary, two consents | מיכל | yes |
| 11 | Balance & movements CAP-9; open cards CAP-42 | C + A | מיכל home balance card and purchase history; admin open cards (מיכל, אורית expiring) | cards | no |
| 12 | Entitlement corrections (3.13) | A | אורית's card → extend validity → sensitive dialog → customer notification | אורית | yes |
| 13 | Intro CAP-10 | A | הילה's intro on U2; a second intro for her is refused | הילה | optional live |
| 14 | Couple CAP-11 | C + A | מיכל's F1 couple on her home; יפעת's companion note "מלווה: …" in F1 details | F1 | no |
| 15 | Sessions admin CAP-12/41 | A | list: full U2, last places U4, near-empty U5, cancelled U3, draft U8, completed history; create, duplicate (active concept only), edit, publish, delete draft, capacity change | sessions | yes |
| 16 | Reschedule / cancel session, Flow 5 | A | U5 → "שינוי מועד" impact (2) or "ביטול מפגש" | U5 | yes |
| 17 | Self booking CAP-13 | C | מיכל books her free entry (U6/U7) | 1 free entry | yes |
| 18 | Registration close, manual booking CAP-14 | A + C | U1 closed for self-booking after 20:00 the day before (if so on filming day); admin "רישום ידני" | U1 | yes |
| 19 | Waitlist CAP-15 | C + A | מיכל in the waitlist group of "ההרשמות שלי"; admin sees 2 waiting on U2; live: admin cancels a U2 booking → waiters notified → מיכל books | U2 full + 2 waiters | yes |
| 20 | 48h window CAP-16 | C | inside: "…את הביטול עושה טל" notice on מיכל's U1 (only if U1 ≤ 48h away at filming); outside: נטע's U5 cancel button | U1 timing | depends on day |
| 21 | Cancel → credit CAP-17/18, Flow 4A | C | נטע cancels U5 → two alternatives → "הזיכוי שלך מחכה לך" (retake: refund) | נטע U5 | yes |
| 22 | Refunds CAP-19 | A + C | refund requests: רעות pending → complete; ירדן shows "הוחזר" | רעות, ירדן | yes |
| 23 | Credit adjustments (3.16) | A | עדי's credit: change alternatives / refund the credit | עדי | yes |
| 24 | Business cancel → pending choice CAP-17 | C + A | סיוון's home shows "בחירה ממתינה" first → she chooses; admin "לטיפול" choice_pending | U3 cancelled | yes |
| 25 | Move booking CAP-20 | C / A | מיכל moves U4 → U6 | מיכל | yes |
| 26 | Notification centers CAP-21/35 | C + A | customer bell (purchase, booking, credit, expiring); admin bell (expiring card, marketing) | RPCs + job calls | no |
| 27 | Push CAP-21 | C + A | push card; opt-in on the filming phone; a live admin action may push for real (the deployed site runs on dev); fallback: in-app center | subscription made live | yes, not guaranteed |
| 28 | 24h reminder | C | appears by itself the day before U1 (job every minute) | מיכל U1 | time-bound: film the day before U1, else skip |
| 29 | Background jobs CAP-22 | — | effects only (completed sessions, alerts, credit alternatives) | seed calls the job functions once | no |
| 30 | PWA install, offline CAP-23 | C | `/install`, add to home screen; airplane mode → disabled buttons + offline hint | — | yes (phone) |
| 31 | Admin home CAP-24, Flow 5 morning | A | U1 summary (bookings, babies, allergies) → day view; "לטיפול"; recent payments; expiring cards; month total | all | no |
| 32 | Customers, export CAP-25 | A | search; active/inactive and last-activity filters; card: history, notes, consents; CSV export | personas | yes |
| 33 | Audit log CAP-26, Flow 9 | A | filter by session and date; real rows from the seed's RPCs, backdated | backdating | no |
| 34 | Content editor, privacy, accessibility CAP-27/29/33, Flow 7 | A | open, edit, preview; publish only with revert | existing content | yes, **not cleaned** |
| 35 | Inactive CAP-28 | A | inactive filter shows דורית (took part ~4 months ago) | H0 + backdated rows | no |
| 36 | Remove details CAP-30, Flow 8 | A | לירז → "הסרת פרטים אישיים" → "לקוחה אנונימית" | לירז (no unsettled pinned purchase) | yes |
| 37 | Settings, templates, payment methods CAP-34; products CAP-3; concepts CAP-41 | A | show the screens; edit without saving, or save and revert (a product's kind cannot change while it is eligible on a future session) | existing | yes, **not cleaned** |
| 38 | Marketing strip + expiring alert CAP-35, Flow 11 | A | strip with a reminder; bell "הכרטיסייה של אורית…" → open cards | see D9 | no |
| 39 | Auto-extend CAP-36 | — | not shown: needs a week without sessions, and every week has sessions; a manual extension (row 12) looks the same to the customer | — | — |
| 40 | Work tab CAP-38, Flow 10 | A | U1 work: dishes per prep day (+ an extra day), tasks partly done, attendees, dietary, consents, shopping partly bought, print, WhatsApp list | U1 sheet | yes (tick items) |
| 41 | Notes board CAP-39 | A | pinned, done, archived notes, next to the user's own notes | 4 notes (D10) | yes |
| 42 | Links statuses CAP-4 | A | waiting (שני, חן), used, conflict (מורן), expired (נוי) → replacement link; "לטיפול" purchase_without_link | נוי expired | yes |
| 43 | Paid without place (3.11) | A | live: pinned approval on a full session with the "park" choice, if the screen offers it | U2 full | optional live |
| — | CAP-31 import, CAP-32 announcement, "השתתפה בעבר" | — | cancelled (decisions 2026-10-20, 2026-10-22) | — | — |

## Sessions (concept by weekday: Monday "אמהות בחל״ד", Thursday "יווני"; Fridays rotate "זוגות", "עם סבתוש", "עם סבוש"; 10:30–14:30 from settings, capacity 12 / 14 explicit)

- **U1–U8** = the next 8 Mondays/Thursdays after the run day (never today). U1 8/12 with the work sheet; U2 12/12 + 2 waiting; U3 cancelled by the business; U4 9/12; U5 2/12; U6 4/12; U7 1/12; U8 draft.
- **F1, F2** = the next 2 Fridays: F1 4/14 (two couples), F2 2/14.
- **History:** H1–H4 = the last 4 Mondays/Thursdays before the run day, 6–10 each, completed; HF = the last Friday, two couples, completed; H0 = the Monday 17 weeks before the run day (דורית only).

## Personas (all `@video.example.com`, phones `03-00002NN`, real-looking names unused in dev, no "בדויה"/`test_`)

Filming logins (password per D3): **מיכל אהרוני** (card paid D-24: H2 used, U1 and U4 reserved, 1 free; couple F1; waits for U2; Tal's note) · **נטע ברגר** (single H1 history; single U5 to cancel live) · **סיוון אשכנזי** (single U3, then U3 cancelled → pending choice).
Other states: **אורית נחום** card expiring D+7, H1+H3 used, 2 free · **עדי מלכה** cancelled single U4 → credit with 2 alternatives · **רעות גבאי** cancelled single U6 → refund pending · **ירדן שושן** cancelled single U7 → refund completed this month · **הילה כץ** intro U2 · **מורן סויסה** single H2 (history), then a card as "new" with her email and מיכל's phone ×3 → conflict · **שני אלמוג** (payer, not joined) single U1, live link · **חן לוינסון** (payer) card, live link · **נוי חזן** (payer) single U5, link expired · **דורית לנדאו** inactive (single H0, nothing since) · **לירז קפלן** single H4, nothing open (for live removal) · **יפעת מור** couple HF + couple F1 with companion note · **קרין סלע** couple F2 · **עינב דהרי** couple HF · **סתיו בכר** card used up in H1–H4, waits for U2 · ~10 card holders filling U1, U2, U4, U6, U7 and history (one with twins). Mixed consents, 4 dietary notes, 3 customer notes. Exact matrix: `scripts/video-cast.mjs`, enforced by its rules check.

## Boundaries & Constraints

**Always:**
- Before anything: `devRef()` (dev project) and `dev-admin@example.com` exists; otherwise exit 1, nothing written.
- Marker (no file): Auth users on `@video.example.com`, including the filming admin `admin@video.example.com` (D2). The world = those users and their profiles + rows the filming admin made (`payments.recorded_by`, `bookings.booked_by`, `customer_notes.created_by`, `audit_log.actor_id`) + events whose create/duplicate audit row has that actor + everything linked to them (bookings, allocations, entitlements, movements, credits, alternatives, refunds, corrections, waitlist, tokens, work sheets, babies, push subscriptions, notifications to these users or whose `dedupe_key` holds a world id, their jobs and deliveries, `idempotency_results` by actor scope or by the seed's computed keys) + board notes per D10. `notes` has no creator column and note RPCs write no audit row (5.20(B)).
- World anchor: the filming admin's Auth `app_metadata.video_world = { anchor_date, generation, complete }`. Keys = `demoKey(generation, item)`. A second run on the anchor day replays the same keys (stored results, no duplicates) and resumes after a crash; on another day it stops: "run video:clear, then video:seed".
- Writes through RPCs: `admin_create_event` (publish false for U8), `admin_approve_payment` (every purchase, AD-10; past `p_paid_on` allowed), the join flow (`join_begin` → Auth `createUser` with `pending_user_id` → `join_complete`, as 5.18), `admin_issue_link`, `admin_book_customer`, `admin_cancel_event`, `admin_complete_refund`, `admin_add_customer_note`, work-sheet RPCs incl. `admin_add_prep_day`, `admin_add_note` + pin/done/archive, `admin_set_event_image` (published gallery media only; never removes Storage files), and as customers `book_sessions`, `cancel_booking`, `join_waitlist`, `set_booking_guest_details`. Written against the 5.20(B) definitions.
- Direct writes (one pg transaction, `scripts/video-sql.mjs`, documented in Design Notes): DW1 the filming admin's `admin_roles` row; DW2 history time shift; DW3 backdating; DW4 נוי's token `expires_at` in the past; DW5 calling `private.job_complete_events`, `job_expiry_alerts`, `job_refresh_credit_options` (and the marketing enqueue, D9). No supabase-js `.insert/.update/.delete/.upsert`.
- Passwords set via the Auth Admin API from `VIDEO_LOGIN_PASSWORD` (≥ 8 chars, passed as an env var in the command, not written to any file; user decision 2026-10-25); never printed or written. Output holds no token, link, password or key.
- `video:clear`: read-only count per table first; refuses (exit 1, nothing deleted) when the set touches dev-admin, dev-customer, a board note not traced to the filming admin (D10), any `test_` row, a booking of a non-world customer in a world event, or a world payment's customer whose email is outside the domain and who is not anonymized. Then asks for `y`; `--dry-run` only counts; non-interactive stdin refuses. The delete transaction recomputes the set and aborts if counts changed; deletes in FK order with `session_replication_role = replica` only around append-only tables; deletes the Auth users in the same transaction. The seed creates no Storage files; clear warns about media uploaded by the filming admin and leaves them.
- Fictional copy: natural Hebrew, no "טל" in customer-facing text.

**Ask first:** running anything that writes to the DB (seed, clear, test:db) — only on the planning session's go, never alongside another tab's test:db or a phone check.

**Never:** migration; new or changed RPC, policy, screen or copy; touching `scripts/dev-clean-test-data.mjs`, `supabase/tests/support/db.ts`, `dev-seed-media.mjs`; running `demo:seed`/`demo:clear`; real photos or customer data; any project but dev; git push/PR/merge or deleting files (planning session).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| First run | no `@video.example.com` users | world built; summary: logins (emails only), session dates, warnings | — |
| Second run, same day | world complete | every step replays; row counts unchanged; "כבר קיים" | — |
| Resume | crash mid-run, same day | continues from replayed results; a lost join token → `admin_issue_link` with a fresh key (5.18) | `LINK_IN_PROGRESS` → warn, retry later |
| Other day | world from an earlier anchor | stops before writing | exit 1, "video:clear ואז video:seed" |
| Wrong project / no dev-admin / no password var | — | stops before writing | exit 1 |
| Rules broken | cast violates guidelines 1–4 or capacities | stops before writing | exit 1, names the rule |
| Clear | world exists | counts → `y` → deleted; table counts equal the pre-seed counts | other answer → nothing deleted |
| Clear blocked | guard hit (see Always) | lists the offending rows | exit 1, nothing deleted |
| Clear then seed | — | fresh generation and dates | — |
| Live leftovers | filming actions by the filming admin or customers | removed by clear | non-domain join email → guard |
| Old live note | a filming note whose stored result was purged (> 7 days) | not deleted | clear lists it as a warning |

## Decisions (user, 2026-10-22)

- **D1** Old dev data: the one-time full cleanup in "Starting state".
- **D2** A dedicated filming admin `admin@video.example.com` (one direct `admin_roles` row), so everything filmed as Tal is removed by clear.
- **D3** One `VIDEO_LOGIN_PASSWORD` for the 3 customer logins and the filming admin: the same password as the other fictional dev accounts, passed as an env var in the command, never written to `.env.local` or the repo (user decision 2026-10-25, replaces ".env.local").
- **D4** "Payment awaiting approval" has no state (Tal approves every payment): shown as a live approval (row 3) plus the refund awaiting completion (row 22).
- **D5** Backdating: rows that represent the past get that moment as `created_at` (Design Notes, DW3), so the log, the notification center and דורית's inactivity look real.
- **D6** `video:clear` deletes by itself (count + `y`), no SQL file.
- **D7** Old demo scripts go: `scripts/demo-*.mjs`, `test/demo-*.test.ts`, `demo:seed`/`demo:clear`, the `.demo-data.local.json` ignore line (planning session deletes); `dev-reset-link --email` moves to the video domain.
- **D8** Shared settings edited live are not cleaned: show without saving, or save and revert by hand; the filming guide says so per screen.
- **D9** The seed enqueues one marketing reminder for today through `private.enqueue_notification` with today's slot key (the job's own writer).
- **D10** Filming notes: a note is the filming admin's when `private.idempotency_results` (actor = filming admin, rpc `admin_add_note`) names its id (seed and live notes); results are purged after 7 days, so an older live note stays and clear warns. Rule: clear then seed before each filming day.

</frozen-after-approval>

## Code Map

- `scripts/demo-seed.mjs` -- reuse: `signedIn` (magic link, never printed), `rpc`, join flow `liveToken`/`join`/`ensureAuthUser`/`profileOf`, `deleteOrphanUser`, conflict loop, `signOut({ scope: "local" })`. Its state file goes.
- `scripts/demo-plan.mjs` -- reuse `localParts`, `addDays`, `weekday`, `demoKey`, `isUuid`, `createStep` (state held in memory, rebuilt by replay).
- `scripts/demo-clear-sql.mjs` -- FK delete order and `replica` window to extend: add `waitlist_entries`, `entitlement_corrections`, `entitlement_correction_bookings`, `credit_options`, `refund_requests`, `cancellation_credits`, `customer_notes`, `notes`, `event_products`, `audit_log` (deleted, not nulled), `private.idempotency_results`.
- `scripts/dev-guard.mjs` -- keep `devRef` (5.20(B) may import it); add `VIDEO_DOMAIN`, `isVideoEmail`; `parseEmail` accepts the video domain.
- `scripts/dev-reset-link.mjs` -- `--email` now for video personas.
- `supabase/migrations/20261004212706_pinned_product_approval.sql` (`private.plan_approve_payment`) -- `paid_on` ≤ today only; pinned `expires_on = greatest(event date, paid_on)`.
- `private.job_complete_events` (`20261010141240_cancellation_credits.sql`) -- completes `published` events with `ends_at <= now()`; `private.job_reminders` only for `now() < starts_at`, so shifted sessions get no reminder.
- Triggers on `events`: `events_registration_close` (recomputes close unless overridden), `events_revision`, `events_refresh_returned` -- a date shift fires them.
- `admin_get_attention_items` (`20261020200750_remove_personal_details.sql`) -- kinds used: `link_conflict`, `purchase_without_link`, `refund_requested`, `choice_pending`.
- `admin_finish_anonymize_customer` -- deletes the Auth user; the profile stays, found by `payments.recorded_by`.
- Admin notifications fan out to every `admin_roles` user (`create_notification_core.sql:334`).
- `lib/copy/audit-actions.ts` -- audit rows show no actor name, so the filming admin is invisible in the log. `lib/copy/retired-audit-actions.ts` (5.20(B)) lists the actions that no longer write audit rows.
- Until PR #121 is merged, 5.20(B) files are not in this worktree: read them with `git show origin/story-5-20b-refactor-sweep-db:<path>` (the migration below, `lib/copy/retired-audit-actions.ts`, any script it changed). Work only in `C:\Users\ligal\Desktop\Projects\brunch-wt-5-22`; `{project-root}` in `context:` means this worktree.
- 5.20(B) migration `20261022154256_refactor_sweep_db.sql` -- `private.birth_date_allowed(p_birth, p_today)`, `private.push_endpoint_allowed`; `admin_add_note` stores `{note_id}` in its idempotency result. `private.idempotency_results` rows older than 7 days are purged by the scheduled cleanup (`20261019233918_scheduled_jobs.sql`).
- `scripts/dev-clean-test-data.mjs` (changed by 5.20) -- its protected list names old demo customers; untouched here.
- Dev now: products card 4×49 days 472 ₪, single 128, intro 118, couple 250; methods ביט/פייבוקס/העברה בנקאית/מזומן; concepts without default images.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/video-plan.mjs` -- pure: `planVideoDates(now)` (U1–U8, F1–F2, H0–H4, HF; never today), `historyShift` (temporary future date of the same weekday within 7 days, shift back by whole weeks), backdate targets, `demoKey`, anchor check.
- [x] `scripts/video-cast.mjs` -- personas, sessions, booking matrix, notes, board notes, work sheet (data only).
- [x] `scripts/video-cast-rules.mjs` -- pure `checkCast(cast, products, settings)`: guidelines 1–4, per-card entries ≤ units and inside validity (also at the temporary date), occupancy targets (U2 = capacity, U4 within `last_places_threshold`, U5 ≤ 2), baby birth dates within 2 years back to 9 months ahead of the run day, every credit alternative a session accepting that product, unique emails/phones in the domain/range, no "טל" in fictional copy.
- [x] `scripts/video-sql.mjs` -- pure SQL builders: DW1–DW5 transaction, world-set CTE, guard queries, counts, delete statements; uuid literals validated.
- [x] `scripts/video-seed.mjs` -- orchestration in the Always order: guards → filming admin + anchor → sessions → purchases and joins → card bookings → customer actions → admin actions (cancel U3, refund ירדן, conflict, notes, sheet, board, images) → passwords → DW transaction → `complete: true` → summary.
- [x] `scripts/video-clear.mjs` -- count, guard, confirm, delete (Always).
- [x] `scripts/dev-guard.mjs`, `scripts/dev-reset-link.mjs` -- video domain.
- [x] `test/video-plan.test.ts`, `test/video-cast.test.ts`, `test/video-sql.test.ts`, `test/dev-guard.test.ts` -- dates on every weekday of the run incl. Saturday and DST weeks, the cast passes and broken copies fail each rule, SQL builders (order, `replica` window, guard predicates, invalid id).
- [x] `package.json` -- `video:seed`, `video:clear`.
- [x] `README.md` -- replace "נתוני הדגמה": seed, clear, filming accounts, "clear then seed before each filming session".
- [x] `_bmad-output/implementation-artifacts/video-filming-guide-5-22.md` -- Hebrew, per video: account, screen, what to show, live action, what clear removes.
- [ ] Planning session -- delete the old demo files (D7); runs against dev on go; push/PR/merge; tickets done.

**Acceptance Criteria:**
- Given a seeded world, when each map row marked "no" is opened, then its data shows as described.
- Given seed then clear, when counting rows in profiles, auth.users, events, payments, entitlements, bookings, movements, notifications, audit_log, notes, then they equal the pre-seed counts.
- Given the world, when listing sessions, then every regular one is on Monday/Thursday and every couple one on Friday.
- Given `git grep` on the new files, then no password, token, key, or supabase-js write call.

## Design Notes

**History by time shift (DW2):** history sessions are created through `admin_create_event` on a temporary date (same weekday, within the next 7 days), filled through the real booking and approval RPCs (allocations, reservations, audit), then in one transaction: `starts_at`/`ends_at` move back by whole weeks (triggers recompute the close), pinned entitlements of those sessions move `expires_on`/`expires_at` by the same amount (= what approval would compute, since `paid_on` ≤ the new date), notifications of those bookings (they name the temporary date) are deleted with their jobs, then `private.job_complete_events()` turns reservations into `use` exactly as cron does. Balances, places and the log stay consistent; cards stay inside validity because the cast rules check the temporary date.

**Backdating (DW3, D5):** `created_at` (and `confirmed_at`, `consumed_at`, consent and `activated_at` times) of world rows are set to plan targets: purchase → its `paid_on` 09:00–21:00; join → that day; history booking → between its purchase and the session; audit and notification rows → their row's time; complete-event rows → the session end. Upcoming bookings keep their real time (reminder logic reads `confirmed_at`). No logic reads these columns except last-activity and inactivity, which is the point.

**Why not a column marker:** no migration; the domain + filming-admin attribution are invisible on screen and also catch live filming actions.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build` -- all pass.
- On the planning session's go, against dev: `video:seed` → check each map row → `video:seed` again (counts identical) → `video:clear` (counts back to pre-seed) → final `video:seed` for filming; then `get_advisors` unchanged.

**Manual checks:**
- Log in as each filming account and as the filming admin on the deployed URL; walk the filming guide.

## Review Triage Log

Lenses: blind-hunter (B), edge-case-hunter (E), verification-gap (V), intent-alignment (I). Iteration 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | B1, E1, V-other1: clear leaves the filming admin's `admin_roles` row | medium | patch | no FK on `admin_roles.user_id`; admin fan-out keeps writing to it. Deleted + counted. |
| 2 | B2, E4, V-other2: `untraced_note` guard can never fire | low | patch | same predicate as `w_notes`; removed, comment says traced by construction (D10). |
| 3 | E2: non-world profile pulled in via `customer_notes.created_by` deleted unguarded | medium | patch | `foreign_customer` now covers every `w_profiles` row. |
| 4 | E3: begun live join with a non-domain email leaves its Auth user, no guard | medium | patch | new `foreign_join_user` guard. |
| 5 | B3, V-other3: waitlist / credit options / corrections of non-world rows deleted unguarded | medium | patch | `foreign_waitlist`, `foreign_credit_option`, `foreign_correction`. |
| 6 | B9, E5: recheck aborts when cron writes notification rows during the prompt | low | patch | notification tables left out of the abort comparison, still deleted. |
| 7 | B10: `old_notes` warning shows only a count | low | patch | prints id, local time, excerpt. |
| 8 | E6: skipped join still reaches DW2 + `complete: true` | medium | patch | stops before DW, exit 1, no complete flag. |
| 9 | E10: `job_complete_events` failure not detected | medium | patch | `do` block in the DW transaction raises unless every history event is completed. |
| 10 | E8: missing refund request crashes the seed | low | patch | warn and skip. |
| 11 | E9: no active marketing text, no warning | low | patch | summary warning. |
| 12 | B8, E11: `dev-reset-link --email` resets filming logins | medium | patch | refuses the 4 filming emails; tests. |
| 13 | I3a: guide's live actions can break guidelines 1–4 | medium | patch | a named buyer per live purchase; weekday rule for live sessions. |
| 14 | B6, B7: history sessions visible on upcoming dates during the run; audit snapshots keep the temporary date | low | patch | README + guide lines. |
| 15 | V1: world set, guards and deletes never executed against Postgres | medium | patch | `supabase/tests/video-clear.test.ts` (db), runs on the planning session's go. |
| 16 | V2: DW2–DW5 only checked as text | medium | defer | partly covered by the manual seed→clear→seed counts; deferred-work entry. |

Rejected: B4 (audit rows of the filming admin's D8 edits deleted: `audit_log.actor_id` is in the world by spec); B5 (other idempotency scopes: private, purged after 7 days); E7, I3b (media hidden by `hide_unused_media`: seed warns, same as 5.18, nothing deleted); I3d (credit-alternative check vacuous: the DB enforces it); I3f (starting state unchecked: cleanup ran and was verified); I3b DW3 backdating retired audit actions (no-op); B9 lock vs a parallel seed (every run needs the planning go); I3c, I3e, I3g, I3h (descriptive, match the spec).
