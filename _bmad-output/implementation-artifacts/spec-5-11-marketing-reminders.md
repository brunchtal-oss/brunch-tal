---
title: 'Marketing reminders for Tal (5.11)'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'ab8e648ea05a9f324db869ea3d7b0ea00b6dcbf3'
route: 'full'
route_source: 'auto'
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

**Problem:** CAP-35/34, AD-11: Tal gets no marketing reminders. `business_settings.marketing_reminder_schedule` (weekday 0 = Sunday, `"HH:MM"`) and the `marketing_reminder` template (admin, push, `override`) exist, but there are no texts, no job, no screen and no home strip. Source doc: no section; the change is the user's (SPEC memlog 2026-09-26).

**Approach:** One migration: `marketing_reminder_texts` seeded with the 10 texts of notification-matrix, a slot log, `private.job_marketing_reminders` on pg_cron every 5 minutes, admin RPCs for the texts, and the schedule in `admin_update_business_settings`. Plus `/admin/settings/marketing` and a `reminder-strip` on the admin home.

**Decision (user, 2026-10-20):** the days and times are editable on the screen (not fixed).

**Decision (user, 2026-10-20): seed texts.** notification-matrix's 10, with #5 replaced and the morning/evening words removed from #1 and #10, plus 10 new ones in the same voice so the rotation repeats slowly:
1. טל, השולחן לא יתמלא מעצמו. פוסט אחד, עכשיו.
2. האינסטגרם שלך שולח דרישת שלום. הוא מתגעגע. תעלי משהו.
3. יש אמא אחת בחופשת לידה שעוד לא יודעת עלייך. זה התפקיד שלך היום.
4. לא, לסדר את המגירה זה לא שיווק. סטורי אחד. קדימה.
5. ספרי בפוסט למה התחלת את כל זה. אנשים מתחברים לסיפורים, לא למבצעים.
6. תמונה של השקשוקה של השבוע עושה יותר מכל פרסומת. צלמי ותעלי.
7. בקשי המלצה מלקוחה מרוצה. היא תשמח, ואת תרוויחי. חמש דקות.
8. תזכורת ידידותית ולגמרי לא פסיבית-אגרסיבית: מתי פרסמת בפעם האחרונה?
9. שתפי בקבוצת אמהות אחת את המפגש הקרוב. אחת. זה הכול.
10. סטורי מאחורי הקלעים של הבראנץ׳ הבא עושה חשק לבוא. את יודעת מה לעשות.
11. שלושה סטוריז השבוע. לא ארבעה, לא אפס. שלושה. מתחילות עכשיו.
12. הלקוחות שלך מתות לשתף, הן רק מחכות שתבקשי. תבקשי.
13. צילום של שולחן ערוך שווה אלף מילים. אין צורך באלף מילים. רק בצילום.
14. מישהי בקבוצת אמהות שואלת עכשיו "מה עושים עם התינוק כל היום?". יש לך תשובה.
15. חמש דקות של שיווק עכשיו שוות שעה של דאגה אחר כך. טיימר. קדימה.
16. עוד לא סיפרת השבוע מה מבשלים בבראנץ׳ הבא. זה סוד? כי זה לא אמור להיות סוד.
17. תעני היום לכל תגובה ולכל הודעה שמחכה. כן, גם לזו מלפני שבוע.
18. האלגוריתם לא יודע כמה את מוכשרת. צריך להראות לו.
19. תגיבי היום לחמישה פוסטים של אמהות. נוכחות זה גם שיווק.
20. פוסט לא צריך להיות מושלם. הוא צריך להתפרסם. לחצי על "שיתוף".

## Boundaries & Constraints

**Always:**
- **Texts:** `public.marketing_reminder_texts(id uuid, body text check btrim 1..500, active boolean default true, sort_order integer, last_sent_at timestamptz null, version integer, created_at, updated_at)`. RLS: select for `(select private.is_admin())` only; grant select to `authenticated`; no insert/update/delete grant. Seed the 20 texts below in order (`sort_order` 1..20).
- **RPCs** (definer, AD-5, idempotency key, `private.audit` before/after, grant `authenticated`): `admin_add_marketing_reminder_text(p_body, p_idempotency_key)` (`sort_order` = max+1) and `admin_update_marketing_reminder_text(p_text_id, p_body, p_active, p_expected_version, p_idempotency_key)` (`STALE_VERSION`, `NOT_FOUND`). Body trimmed like 4.7 (tabs, line breaks, NBSP). No delete (user: add, edit, on/off).
- **Schedule:** `admin_update_business_settings`, redefined from live `pg_get_functiondef`, gains a `marketing_reminder_schedule` branch: an array of 0–7 objects with exactly `weekday` (integer 0–6, distinct) and `time` (`^([01][0-9]|2[0-3]):[0-5][0-9]$`), stored sorted by weekday. An empty array = no reminders. Other branches unchanged.
- **Job** `private.job_marketing_reminders(p_now timestamptz default now()) returns integer` (definer, `search_path = ''`, revoke all, no grant; `p_now` for tests and the manual check):
  - Slot = local date + time `at time zone 'Asia/Jerusalem'`, for today and yesterday (local), from the schedule. It takes only the **latest** slot with `slot <= p_now` and `slot > p_now - 1 hour`. An older missed slot is skipped, never sent late.
  - No active text → returns 0, records nothing.
  - Records the slot in `private.marketing_reminder_slots(slot_key text primary key, text_id, created_at)` with `on conflict do nothing`; already there → returns 0, no rotation. `slot_key` = local `YYYY-MM-DD HH:MM` = the discriminator.
  - Text = active, `order by last_sent_at nulls first, sort_order, id`, `for update`. Sets `last_sent_at = p_now`, then `enqueue_admin_notification('marketing_reminder', slot_key, null, '/admin', body)`.
  - Deletes slot rows older than 30 days. No exception swallowing, so a failure shows in "לטיפול".
- `private.job_intervals()` redefined from live, adding `('marketing_reminders', 5 minutes)`. `cron.schedule('marketing_reminders', '*/5 * * * *', 'select private.job_marketing_reminders()')`.
- **`/admin/settings/marketing`** (`frontend-design` first; DESIGN.md, EXPERIENCE.md; `PageHeading`, `sectionTitleClass`; `OnlineButton` on every save). Linked from `/admin/settings` with a `LinkGroup` after the templates group: title `תזכורות שיווק`, link `ללוח הזמנים ולנוסחים`, note `מתי מגיעה אלייך תזכורת לעשות שיווק, ובאיזה נוסח`.
  - Section `לוח זמנים`: one row per day, `ראשון` to `שבת`. Each row has a checkbox with the day's name and a time field shown only when checked. One `שמירה` with the version the page read. Saved: `לוח הזמנים נשמר`. No arrows.
  - Section `נוסחים`: list in `sort_order`. Each item shows the body, a chip `פעיל` / `כבוי`, the chip `הבא בתור` on the next text, and `נשלח לאחרונה ב-DD.MM` or `עוד לא נשלח`. `עריכה` opens in place a textarea, a checkbox `פעיל`, and `שמירה` / `ביטול`. `הוספת נוסח` opens an empty textarea with `שמירה` / `ביטול`. With no active text: `אין נוסח פעיל, ולכן תזכורות השיווק לא נשלחות`.
- **Strip:** on `/admin`, right under the h1, in its own `<Suspense>` (fallback none). It shows the admin's newest `marketing_reminder` notification (RLS), and only while it is unread. `reminder-strip` per DESIGN.md: muted, `body-sm`, `סגירה` as a link-style `OnlineButton` calling the existing `markRead([id])`. On success it disappears and the page refreshes (bell count). On failure: the message from `lib/errors.ts`.
- Audit (`audit-actions.ts`), shown: `admin_add_marketing_reminder_text` `הוספת נוסח לתזכורות השיווק` (result `נוסח חדש נוסף למאגר`), `admin_update_marketing_reminder_text` `עריכת נוסח לתזכורות השיווק` (`edit: true`). Field labels: `marketing_reminder_schedule` `לוח תזכורות השיווק` (value shown as `א׳ 09:00, ב׳ 20:00`), `last_sent_at` `נשלח לאחרונה`, `sort_order` `סדר`. Job name `marketing_reminders`: `תזכורות שיווק`.

**Never:** touching `admin_get_attention_items` (4.6), `plan_funding`, `entitlement_fits_event` or the session editor (3.18); changing `enqueue_*`, the push worker, other jobs, or the template type/check; text delete or "send to test" (EXPERIENCE lists them; user scope omits them); customer access to texts, slots or admin notifications; `demo:seed`/`demo:clear`; `←` anywhere.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Slot reached | Sun 09:00, `p_now` 09:01 local, 2 active texts | one `marketing_reminder` per admin, body = oldest text; that text's `last_sent_at` = `p_now` |
| Rerun / parallel | same slot again, or two runs at once | nothing new; `last_sent_at` unchanged |
| Next slot | Mon 20:00 after Sun 09:00 | the other text |
| One active text | two slots | same text both times (allowed) |
| No active text | slot reached | 0 sent, slot not recorded; a text activated within the hour still sends |
| Before / late | 08:59; or 10:30 for 09:00 | nothing |
| DST | Sun 2026-10-25 09:00 (IST) = 07:00 UTC; Sun 2026-03-29 09:00 (IDT) = 06:00 UTC | fires at those UTC times, not an hour off |
| Empty schedule | `[]` | nothing ever; save accepted |
| Bad schedule | weekday 7, two Sundays, `"9:00"`, extra key | `INVALID_INPUT` field `marketing_reminder_schedule` |
| Edit stale | text changed since load | `STALE_VERSION` |
| Customer | select on texts / slots, RPC call, read admin notifications | no rows / `NOT_AUTHORIZED` / none |
| Strip | newest reminder read, older unread | no strip |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql:263` -- schedule column and default.
- `supabase/migrations/20261001184225_create_notification_core.sql:88,223,309` -- `marketing_reminder` template (`override`); `enqueue_notification` / `enqueue_admin_notification` (reuse as is).
- `supabase/migrations/20261006194417_business_settings_review_fixes.sql:9` -- `admin_update_business_settings` (live hash matches this file; redefine from live, add the branch and the `update` column).
- `supabase/migrations/20261019233918_scheduled_jobs.sql:378,897` -- `job_intervals` (live matches), `cron.schedule` pattern; `job_expiry_alerts` as job style.
- `app/admin/(shell)/settings/settings-editor.tsx:221` -- `LinkGroup`, `Group`, `sectionTitleClass`; `settings/templates/` as the sub-page pattern (page + `actions.ts`).
- `app/admin/(shell)/page.tsx` -- home order; strip goes after `PageHeading`. `app/admin/(shell)/notifications/actions.ts` `markRead`.
- `lib/copy/admin.ts:1216` job names, `:2139` audit action labels, `:2261` field labels; `settings` copy block. `lib/copy/audit-actions.ts:337` rules.
- Tests to update: `app/admin/(shell)/home-items.test.ts:547` (uses `marketing_reminders` as the unknown name), `supabase/tests/settings-and-templates.test.ts:344` (`[]` is now valid), `supabase/tests/grants.test.ts`, `business-settings.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_marketing_reminders.sql` (`npx supabase migration new marketing_reminders`) -- everything above, additive. Main session: the user runs it in the SQL Editor; register in `schema_migrations`; `get_advisors`; regenerate `database.types.ts`.
- [ ] `supabase/tests/marketing-reminders.test.ts` -- the matrix, in `inRollback`. Set the schedule and own texts (`testName`) inside the test, deactivate the others, fixed `p_now` dates far from today. Plus `cron.job` row and `job_intervals` row.
- [ ] `supabase/tests/settings-and-templates.test.ts`, `business-settings.test.ts`, `grants.test.ts` -- schedule validation, new RPCs and table grants.
- [ ] `app/admin/(shell)/settings/marketing/{page.tsx,actions.ts,*.tsx}` (+ unit tests for the schedule draft) -- the screen (`frontend-design` first).
- [ ] `app/admin/(shell)/settings/settings-editor.tsx` -- the `LinkGroup`.
- [ ] `app/admin/(shell)/home/reminder-strip.tsx`, `page.tsx` (+ test) -- the strip.
- [ ] `lib/copy/admin.ts`, `lib/copy/audit-actions.ts`, `lib/errors.ts` if a new code is needed, `home-items.test.ts` -- copy, audit, job name.
- [ ] `_bmad-output/specs/spec-brunch-at-tal/notification-matrix.md`, its `.memlog.md` -- the seed list = the 20 above (user decision 2026-10-20).
- [ ] Main session: `tickets.py pull` then `mark done` for id 11 in the PR.

**Acceptance Criteria:**
- Given the migration applied, when the advisor runs, then no WARN or ERROR beyond the approved ones.
- Given the job raises, when "לטיפול" loads, then `marketing_reminders` shows as `תזכורות שיווק: לא עבד בפעם האחרונה`.

## Implementation Notes

- Implementation agent (user rule): write the migration and the DB tests but do NOT apply any migration (no MCP writes) and do NOT run `npm run test:db`, `demo:seed` or `demo:clear`; the main session does that after the user runs the SQL and agrees. Until then, update `lib/supabase/database.types.ts` by hand to match the migration. Stop only node processes you started.

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-10-20):** 4 lenses; 1 medium and 7 low patched, 2 deferred, the rest rejected.

| # | Finding | Verdict | Route | Action |
|---|---|---|---|---|
| 1 | moving a day's time after its slot fired (09:00 → 09:20) sends a second reminder that day; each rerun locks a text before the slot conflict | medium | patch | new migration: at most one slot per local day, checked before the text lock; DB test |
| 2 | the three marketing Server Actions have no test (a wrong `p_active` or a `< 7` cap would pass CI) | low | patch | `marketing/actions.test.ts` |
| 3 | two constants named `MAX_TEXT` (2000 raw, 500 trimmed) | low | patch | rename to `MAX_RAW_INPUT` |
| 4 | no test for a failed strip dismiss; `scheduleText` null case untested | low | patch | two tests |
| 5 | dead `sort_order` audit label; stale settings-copy comment; over-wide comment | low | patch | removed, reworded, rewrapped |
| 6 | notification-matrix lacks the job's rules (one per day, no late send, empty schedule) | low | patch | one line |
| 7 | the memlog line attributes spec decisions to the user | low | patch | reworded: only the schedule, seed texts and no-delete are hers |
| 8 | an on/off-only edit of a text shows no subject in the audit log (`audit_concise` has no subject for `marketing_reminder_texts`) | low | defer | needs `audit_concise`'s subject branch; `deferred-work.md` |
| 9 | `ReminderStrip`'s query (type filter, order) is not unit-tested | low | defer | needs a mocked client or a loader; phone check covers it; `deferred-work.md` |

Rejected: STALE_VERSION "stuck" editors (the message says to reload, as in 4.7); a time saved within the past hour fires (spec: the slot window); no cancel for the schedule, add-draft lost on "עריכה", "הבא בתור" with an empty schedule (low, extra branches); manual `p_now` skews rotation (the manual check uses a past slot, low); old unread strip (a newer reminder replaces it within days); fragile default test, `role="status"` (matches the mockup), parallel-run DB test (one connection cannot race); #10 reworded rather than trimmed (the user approved the exact text).

## Verification

**Commands:**
- `npm run test:db` (after asking the user; new file + `scheduled-jobs`, `notifications`, `push`, `settings-and-templates`, `admin-home`, `grants`) -- pass.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` -- pass.

**Manual checks:** phone: as admin, edit a text and the schedule; in the SQL Editor `select private.job_marketing_reminders('<a slot + 1 min>')` → one reminder in the bell and by push, a second run adds nothing; strip shows and disappears after `סגירה`; as customer nothing.
