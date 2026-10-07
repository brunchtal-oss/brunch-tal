---
title: '5.17 24-hour session reminder — תזכורת 24 שעות לפני מפגש'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'd47148fadc41876388020ec78da3361a473ac071'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין תזכורת למפגש. מסמך המקור (§8, ‏§11) דורש תזכורת בפוש ובאזור האישי 24 שעות לפני המפגש, פעם אחת בלבד, בלי משימה שגויה אחרי הרשמה מאוחרת, ביטול או שינוי שעה. כשל פוש לא מבטל הרשמה.

**Approach:** מיגרציה אחת: `private.job_reminders()` שנגזרת מהמצב (AD-13) ונרשמת ב-pg_cron כל דקה. היא מכניסה `reminder` לתור דרך `enqueue_notification`, והעובד של 5.8 שולח. בלי מסך חדש.

**החלטות המשתמשת 2026-10-07:** (1) פריט "לטיפול" לצנרת פוש שלא עובדת נשאר ל-5.10. (2) אין אייפון: הבדיקה אחרי המיזוג רק ב-Android, ופריט האייפון נשאר פתוח ב-deferred-work. (3) התזכורות שיגיעו ללקוחה הבדויה עם הפוש במסד הפיתוח (7 הרשמות עד 01.11, הראשונה ב-07.10 ב-10:30) נשארות. (4) `concept` נוסף ל-`allowed_vars` של `reminder` ("פרטי המפגש" במקור), והנוסח של התבנית לא משתנה.

## Boundaries & Constraints

**Always:**
- **בחירה (AD-13, ‏AD-23):** ‏`b.status = 'confirmed'`, ‏`b.customer_id is not null`, ‏`e.status = 'published'`, ‏`now() >= e.starts_at - lead`, ‏`now() < e.starts_at`, ‏`b.confirmed_at < e.starts_at - lead`. ‏`lead = make_interval(hours => (b.policy_snapshot ->> 'reminder_lead_hours')::int)`, תמיד מה-snapshot ואף פעם לא מ-`business_settings`.
- **נעילה:** ‏`order by b.id for update of b skip locked`. הרשמה שעסקה אחרת מחזיקה (למשל ביטול באמצע) מטופלת בהרצה הבאה, והמשימה לא ממתינה (AD-6).
- **לכל הרשמה:** ‏`private.enqueue_notification(b.customer_id, 'reminder', b.id || ':' || e.revision, vars, '/me/sessions/' || e.id)`. ‏vars הם כל `allowed_vars`: ‏`date` (‏`private.format_day_month` של היום המקומי), ‏`time` (‏`HH24:MI`, ‏`Asia/Jerusalem`) ו-`concept` (‏`concepts.name`), כמו `notify_booking_confirmed`. הרצה כפולה לא יוצרת כלום (`dedupe_key`).
- הפונקציה `security definer`, ‏`set search_path = ''`, ‏`volatile`, מחזירה את מספר ההתראות החדשות. ‏`revoke execute … from public, anon, authenticated, service_role` בלי grant, כי pg_cron קורא לה כבעלים (כמו `job_complete_events`).
- ‏`cron.schedule('reminders', '* * * * *', 'select private.job_reminders()')`. ‏pg_cron כבר מופעל (3.12).
- ‏`update notification_templates set allowed_vars = array['date','time','concept'] where type = 'reminder'` באותה מיגרציה (החוזה של 4.7).
- **נתוני הדגמה (5.18):** פוש נשלח רק למנוי שנרשם לאותה לקוחה. לקוחות בדויות של 5.18 נוצרות בלי `push_subscriptions`, ולכן התזכורות שלהן נשמרות רק במרכז ההתראות והמשימה נסגרת `skipped`. אין צורך בקוד.

**Never:** לא לגעת ב-`enqueue_notification`, ‏`render_notification_text`, ‏`claim_push_jobs`, ‏`finish_push_job`, בעובד, ב-`admin_get_attention_items`, ב-`job_complete_events`, ב-`invoke_push_worker` ובטבלאות של 4.2 ו-4.10. בלי audit (אין שינוי עסקי), בלי Vercel Cron, בלי שליחה מתוך עסקה, ובלי התראות תפוגה, הארכה, ניקוי או "לטיפול" (5.10). בלי אינדקס חדש (`events_starts_at_idx` ו-`bookings_event_id_idx` קיימים).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| תזכורת | הרשמה מלפני 3 ימים, מפגש בעוד 23 שעות, snapshot ‏24 | התראה אחת `reminder` עם הנוסח המרונדר, `target_path` ‏`/me/sessions/<event>`, ומשימת פוש אחת | — |
| הרצה כפולה | אותה הרשמה, הרצה שנייה | אין התראה חדשה, המשימה מחזירה 0 | — |
| בוטלה | הרשמה `cancelled` בחלון | אין התראה | — |
| הרשמה מאוחרת | ‏`confirmed_at` אחרי `starts_at - 24h` | אין התראה | — |
| בלי לקוחה | הרשמה של מוצר מוצמד שלא שויך (`customer_id` ריק) | אין התראה ואין שגיאה | — |
| snapshot גובר | snapshot ‏24, ההגדרה שונתה ל-2; מפגש בעוד 23 שעות | נשלחת. snapshot ‏2 ומפגש בעוד 23 שעות ← לא | — |
| שינוי שעה | נשלחה, ואז `starts_at` זז ונשאר בחלון | ‏revision עלה ← התראה שנייה עם discriminator חדש | — |
| שינוי לא מהותי | נשלחה, ואז שינוי שלא מעלה revision (מכסה) | אין התראה נוספת | — |
| התחיל | ‏`starts_at <= now()` | אין התראה | — |
| כל השדות | תבנית `reminder` נערכה ב-`admin_update_notification_template` ל-`{concept} {date} {time}` | המשימה האמיתית מרנדרת את שלושתם | — |
| נעולה | עסקה אחרת מחזיקה את ההרשמה | מדולגת עכשיו ונשלחת בהרצה הבאה | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261006111121_session_completion_job.sql` -- תבנית: `job_complete_events` (definer, ‏revoke בלי grant, l.281) ו-`cron.schedule` (l.290). לא לגעת.
- `supabase/migrations/20261004183409_bookings_and_self_booking.sql:297` -- `notify_booking_confirmed`: ה-vars וה-`target_path` להעתקה. ‏`policy_snapshot` עם check על `reminder_lead_hours` (l.44).
- `supabase/migrations/20261001184225_create_notification_core.sql:223` -- `enqueue_notification` (‏null ← ‏null, ‏`on conflict do nothing`, משימת פוש רק להתראה חדשה). ‏render זורק `INVALID_INPUT` על שדה חסר.
- `supabase/migrations/20261006183915_business_settings_and_templates.sql:29` -- `allowed_vars` של כל סוג; `template_sample_vars` גנרית.
- `supabase/migrations/20261004143612_concepts_and_events.sql:155` -- trigger ‏`events_revision`.
- `supabase/tests/session-completion.test.ts` -- תבנית הבדיקה: `seed`, ‏`insertEvent`, הזזת מפגש אחרי הרשמה, בדיקת `cron.job` (l.680), בדיקת נעילה עם commit ו-`onCleanup`. ‏`supabase/tests/support/money.ts`, ‏`pinned-approval.test.ts` (הרשמה בלי לקוחה), ‏`settings-and-templates.test.ts` (עריכת תבנית).
- `app/admin/(shell)/settings/templates/[type]/template-editor.tsx:115` -- העורך כבר מציג `concept` (תווית ודוגמה), בלי שינוי ב-TS.
- `supabase/tests/grants.test.ts` -- פונקציה ב-`private` בלי grant לא דורשת שורה. לא לשנות אלא אם הבדיקה נכשלת.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_session_reminders.sql` -- סשן ראשי: ‏`npx supabase migration new session_reminders` רק לפני ההחלה, ואז `apply_migration` עם אותו תוכן. בתוכו `private.job_reminders`, ‏revoke, עדכון `allowed_vars` ו-`cron.schedule`, עם הערת כותרת כמו ב-3.12.
- [ ] `supabase/tests/session-reminders.test.ts` -- בדיקה לכל שורה במטריצה, ובדיקה ש-`cron.job` מכיל את `reminders` כל דקה. הרשמה דרך `book_session` למפגש פתוח, ואז כבעלים מזיזים את `starts_at` ומחזירים את `confirmed_at` אחורה. המשימה נקראת ישירות בתוך `inRollback`, והבדיקות בודקות רק את ההרשמות שלהן.
- [ ] `lib/supabase/database.types.ts` -- סשן ראשי: יצירה מחדש אחרי ההחלה.
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/tickets.toml` -- ‏`after = [8, "4.7", "3.12"]` לרשומה 17.
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/story-session-reminder-24h.md` -- קובץ סיפור עם `status: done`, במבנה של `story-business-settings-and-templates.md`.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- רשומה ל-5.18: לקוחות בדויות בלי מנויי פוש. בפריט `allowed_vars` של 4.7: ‏reminder בוצע ב-5.17.

**Acceptance Criteria:**
- Given המיגרציה הוחלה, when `get_advisors` רץ, then אין WARN או ERROR חדש.
- Given כל השינויים, when `npm run test:db` רץ במלואו, then כל הבדיקות עוברות, כולל 3.12, ‏5.8 ו-4.7.
- Given מפגש בדוי שמתחיל בעוד 24 שעות ו-5 דקות ב-production, when לקוחה עם פוש פעיל נרשמת והאפליקציה סגורה, then תוך כ-5 דקות מגיעה תזכורת אחת, ולחיצה פותחת את המפגש. הרשמה שנייה שבוטלה לפני הזמן לא מקבלת תזכורת.

## Implementation Notes

- **בדיקה בטלפון אחרי המיזוג (2026-10-07), מול production:** ‏Android, לקוחה בדויה עם פוש: מפגש למחר ב-11:10, הרשמה מיידית ← תזכורת אחת נוצרה ב-11:10 בדיוק (24 שעות לפני) והגיעה בפוש כשהאפליקציה סגורה, עם התאריך והשעה הנכונים; לחיצה פתחה את דף המפגש. הרשמה שנייה שבוטלה לפני הזמן לא קיבלה תזכורת. התזכורת האמיתית של 10:30 (מפגש קיים) נוצרה ונשלחה בזמן, אבל לדפדפן המחשב, כי הטלפון נרשם לפוש רק ב-11:06; לא תקלה. אייפון: לא נבדק (deferred-work).

## Spec Change Log

## Review Triage Log

**סבב 1 (2026-10-07):** ‏blind-hunter ‏9, ‏edge-case-hunter ‏5, ‏verification-gap ‏0, ‏intent-alignment ‏6 פערים. ‏high 0, ‏medium 0, ‏low 5, ‏false 9, ‏maybe-false 0 (חלק מהממצאים כפולים בין העדשות).

| # | ממצא | verdict | route | ראיה / פעולה |
|---|------|---------|-------|--------------|
| 1 | ‏`expectedText` לא ממלא `{concept}`, ובדיקות נשברות אם התבנית במסד הפיתוח נערכת | low | patch | ממלאים גם `{concept}` |
| 2 | אין בדיקות לגבולות `>=` ו-`<` | low | patch | שתי בדיקות: מפגש בעוד 24 שעות בדיוק (נשלחת), ‏`confirmed_at = starts_at - lead` (לא) |
| 3 | בדיקת הנעילה עלולה להיכשל כשה-cron האמיתי מחזיק את השורה ברגע הבדיקה הסופית | low | patch | הבדיקה הסופית חוזרת עד 3 פעמים |
| 4 | לקוחה שפרטיה הוסרו (`anonymized_at`) עם הרשמה עתידית תקבל תזכורת | low | defer | אין עדיין זרימה שמסירה פרטים (4.6); נרשם ל-4.6 ב-deferred-work |

נדחו: (5) תזכורת שנייה כשרק `ends_at` או `kind` משתנים: ‏discriminator ‏`booking_id:revision` נקבע ב-AD-12/13 ובבקשת המשתמשת, ושינוי כזה ב-24 השעות האחרונות נדיר ומלווה ב-`event_changed`. (6) שורה אחת שנכשלת עוצרת את כל הריצה: ‏`customer_id` הוא FK ל-`profiles` והתבנית נבדקת מול `allowed_vars` בשמירה, כך שהכשל לא ניתן להשגה, ושגיאה תיראה ב-`cron.job_run_details` (5.10). (7) המרת `reminder_lead_hours` ל-integer: נכתב רק מעמודת integer בהגדרות. (8) מקום מוצמד שמשויך בתוך החלון מקבל תזכורת: זו ההתנהגות הנכונה (אושר לפני זמן התזכורת). (9) רשומת 5.18 בלי פעולה: הפעולה כתובה (בלי `push_subscriptions`). (10) ‏`update` של `allowed_vars` בלי assert: השורה נוצרת באותה שרשרת מיגרציות. (11) המפגש לא ננעל: חלון של מילישניות, ותיקון שעה מחשב תזכורת חדשה ממילא. (12–14) ‏intent: "פעם אחת" לכל revision נקבע בבקשה; פוש שכבר בתור אחרי ביטול ותזכורת ישנה אחרי שינוי שעה הם AD-13 ו-5.8; אין מסך חדש לפי ה-Approach.

## Verification

**Commands:**
- `npm run test:db` -- expected: הכול עובר.
- `npm run build`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm test` -- expected: נקי.

**Manual checks (if no CLI):**
- אחרי המיזוג, בטלפון Android מול production: התרחיש ב-AC האחרון.
