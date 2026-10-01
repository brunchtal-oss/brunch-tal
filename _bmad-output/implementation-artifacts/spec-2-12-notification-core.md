---
title: '2.12 Notification core — ליבת ההתראות'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '5c16c7d2ff7abbae880124f0bee4ed93c616ccf6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין במסד התראות. כל RPC מ-2.2 ואילך צריך להכניס התראה באותה עסקה, עם נוסח מטבלה, בלי כפילות ובלי נמענת ריקה.

**Approach:** מיגרציה אחת: `notification_templates` עם seed, ‏`notifications`, ‏`notification_jobs`, ו-`private.enqueue_notification` / ‏`enqueue_admin_notification` (AD-12). בלי מסכים, עובד או RPC חשוף. בדיקת מסד לכל שורה ב-verify.

## Boundaries & Constraints

**Always:** AD-5 לכל טבלה ופונקציה. עברית רק ב-seed (נתונים). הנוסח נשמר בהתראה כשהיא נוצרת, ועריכת תבנית לא משנה התראה קיימת.

**Decisions:**
- **גבולות:** עכשיו הטבלאות, ה-seed וה-enqueue. ‏5.7: ‏`mark_notifications_read` ומסכים. ‏5.8: ‏`claim_push_jobs`/`finish_push_job`, ‏`notification_deliveries`, ‏`push_subscriptions`, עובד. ‏4.7: עריכת תבניות. ‏5.10: ניקוי. ‏2.1 לא משתנה (ללקוחה חדשה אין נמענת; ‏`purchase_new_card` נכנסת ב-`bind_purchase`, 2.2).
- **`notification_templates`:** ‏`type` (מפתח, ‏check עם 13 הסוגים של AD-12), ‏`recipient_kind`, ‏`push`, ‏`body_mode` (template / template_or_override / override), ‏`title`, ‏`body` (ריק רק ב-override), ‏`version`, ‏`updated_by`, ‏`updated_at`, ‏unique ‏`(type, recipient_kind)`. רק כותרת וגוף נערכים (4.7). בלי grant.
- **`notifications`:** ‏`recipient_id` (בלי FK), ‏`recipient_kind`, ‏`type`, ‏FK ‏`(type, recipient_kind)`, ‏`payload` ‏`{title, body, template_version}`, ‏`target_path` חובה, ‏`dedupe_key` ייחודי, ‏`created_at`, ‏`read_at`. check: לקוחה `^/me(/|\?|$)`, אדמין `^/admin(/|\?|$)`, בלי `//`, רווח או `\`. ‏RLS ‏`recipient_id = (select auth.uid())`, ‏`select` בלבד ל-`authenticated`, אינדקס `(recipient_id, created_at desc)`.
- **`notification_jobs`:** ‏`notification_id` ייחודי (FK ‏`on delete cascade`), ‏`status` (queued, sending, sent, failed), ‏`scheduled_at`, ‏`next_attempt_at`, ‏`lease_until` (מלא ב-sending), ‏`attempt_count ≥ 0`, ‏`last_error`, ‏`finished_at` (מלא ⇔ sent/failed). ‏RLS בלי policy ובלי grant.
- **`private.enqueue_notification(p_recipient_id, p_type, p_discriminator, p_vars jsonb, p_target_path, p_body_override default null)` ← uuid:** הכותבת היחידה ל-`notifications` ול-`notification_jobs`. נקראת אחרונה ב-RPC (AD-6). נמענת null ← לא נוצר כלום ומוחזר null, בלי שגיאה (AD-23; החלטת המשתמשת). ‏`INVALID_INPUT`: סוג לא קיים, discriminator ריק, לקוחה שאינה ב-`profiles`, אדמין שאינה ב-`admin_roles`, override בסוג template, בלי override בסוג override, ‏`{שם}` שנשאר. מחליפה `{key}` בערכי `p_vars` (טקסט שהקורא עיצב). ‏`dedupe_key = type:recipient_id:discriminator`, ‏`on conflict do nothing`. סוג עם `push` ← משימה `queued`. מחזירה מזהה, או null כשלא נוצר כלום.
- **`private.enqueue_admin_notification(p_type, p_discriminator, p_vars, p_target_path, p_body_override default null)` ← int:** קוראת ל-enqueue לכל אדמין לפי `user_id`, ומחזירה כמה נוצרו.
- **תבנית אחת לסוג.** נוסח לכל מקרה ב-`booking_cancelled` וב-`entitlement_changed` נדחה ל-3.6 ול-3.13/3.14 (החלטת המשתמשת).
- **seed** (מאושר; ‏`{שדה}` = ערך מהקורא, והסיפור שמשתמש בסוג רשאי לשנות שמות שדות במיגרציה שלו עד שיש פרודקשן):

  | סוג | נמענת · ערוץ · mode | כותרת | גוף |
  |---|---|---|---|
  | purchase_new_card | לקוחה · פוש | הכרטיסייה שלך מוכנה. | מומלץ להירשם מראש לארבעת המפגשים כדי לבחור את התאריכים שנוחים לך |
  | purchase_repeat | לקוחה · פוש | הרכישה נוספה לחשבון שלך | {product}, בתוקף עד {expires_on} |
  | booking_confirmed | לקוחה · אזור אישי | ההרשמה אושרה | {date} · {time} · {kind} |
  | reminder | לקוחה · פוש | מחכים לך בבראנץ׳ | {date} בשעה {time}. נתראה! |
  | waitlist_spot | לקוחה · פוש | התפנה מקום ב{date} | כדי להירשם צריך כניסה מתאימה, והמקום מובטח רק אחרי שההרשמה מאושרת |
  | booking_cancelled | לקוחה · אזור אישי | ההרשמה ל{date} בוטלה | {outcome} |
  | event_changed | לקוחה · פוש · template_or_override | שינוי בבראנץ׳ של {date} | הבראנץ׳ עבר ל{new_date} בשעה {new_time}. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי |
  | event_cancelled | לקוחה · פוש · template_or_override | הבראנץ׳ של {date} בוטל | מצטערות על השינוי. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי |
  | entitlement_changed | לקוחה · פוש | עדכון בכרטיסייה שלך | בתוקף עד {expires_on}, עם {units} כניסות פנויות. הפרטים באזור האישי |
  | card_expiring | לקוחה · פוש | הכרטיסייה שלך עומדת לפוג | נשארו לך {units} כניסות פנויות עד {expires_on}. זה הזמן לבחור מפגשים |
  | broadcast | לקוחה · פוש · override | הודעה מטל | — |
  | admin_card_expiring | אדמין · פוש | הכרטיסייה של {customer} עומדת לפוג | {units} כניסות פנויות, בתוקף עד {expires_on} |
  | marketing_reminder | אדמין · פוש · override | תזכורת שיווק | — |

**Never:** RPC ב-`public`, grant לפונקציות ה-enqueue, עברית בקוד מחוץ ל-seed, שינוי ב-2.1, ‏`mark_notifications_read`, מנויי פוש, עובד, cron, ‏`p_variant`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| התראה חדשה | A, ‏`card_expiring`, ‏D, ‏vars, ‏`/me` | שורה אחת עם הנוסח המרונדר + משימה `queued` |
| אותו discriminator | אותה קריאה שוב | null; שורה ומשימה אחת |
| discriminator אחר | D2 | שורה שנייה |
| סוג בלי פוש | `booking_confirmed` | שורה בלי משימה |
| נמענת null | | null; אין שורות חדשות |
| נתיב לא תקין | לקוחה ‏`/admin`, ‏`/meow`, ‏`/me//x`; אדמין ‏`/me` | ‏23514 |
| var חסר / override אסור / סוג לא קיים / נמענת לא מתאימה | | `INVALID_INPUT`, כלום לא נוצר |
| שתי אדמיניות | ‏`admin_card_expiring` פעמיים | 2 שורות `admin`, ואז 0 |
| עריכת תבנית אחרי יצירה | update ל-body כבעלים | ההתראה הקיימת לא השתנתה |
| קריאה | A; ‏B; אדמין; ‏anon | רק שלה; רק שלה; רק שלה; ‏42501 |
| כתיבה ישירה | לקוחה: insert/update/delete ל-notifications; select ל-jobs ול-templates | ‏42501 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- ‏`profiles`, ‏`admin_roles`, ‏`is_admin`; ‏`activation_tokens` = דפוס טבלה פנימית ב-`public` (RLS בלי policy ובלי grant).
- `supabase/migrations/20261001162630_create_money_schema.sql` -- דפוס ה-seed העברי, ה-policies, ‏`revoke … ; grant` לטבלה ו-`revoke execute` לעזרים בסוף. לא עורכים מיגרציה שהוחלה.
- `supabase/migrations/20260930193304_fix_reset_begin_and_audit.sql` -- ‏`private.audit` (invoker, בלי grant) = הדפוס ל-enqueue. התראות לא נכתבות ליומן.
- `supabase/tests/support/db.ts` (`inRollback`, ‏`asAuthenticated`, ‏`queryError`, ‏`testName`), ‏`support/money.ts` (`seedMoney`: אדמין ושתי לקוחות בלי Auth).
- `supabase/tests/grants.test.ts` -- ‏`EXPECTED_GRANTS`.
- `lib/errors.ts` -- ‏`INVALID_INPUT` קיים; אין קוד חדש.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_create_notification_core.sql` (`npx supabase migration new create_notification_core`) -- כל ה-Decisions וה-seed. הסשן הראשי מחיל ב-`apply_migration`, ואז `get_advisors` ו-`generate_typescript_types`.
- [ ] `lib/supabase/database.types.ts` -- נוצר מחדש.
- [ ] `supabase/tests/notifications.test.ts` -- ה-seed (13 סוגים, נמענת, ערוץ ו-mode כבטבלה, נוסח §2 מילה במילה, ‏check הסוגים), כל שורות המטריצה, ו-`pg_proc`: רק `enqueue_notification` מכניסה ל-`notifications` ול-`notification_jobs`.
- [ ] `supabase/tests/grants.test.ts` -- `table public.notifications authenticated SELECT`.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- רשומות: 3.6/3.13/3.14 (נוסח לכל מקרה בסוג), 5.8 (משימות `queued` שהצטברו לפני שהיה עובד), 3.5 (התראה זוגית בפוש מול ערוץ קבוע לסוג, memlog של ה-SPEC ‏264), 2.5 (עזר SQL אחד לעיצוב תאריך וסכום ב-vars).

**Acceptance Criteria:**
- Given המיגרציה הוחלה, then ה-advisor בלי WARN או ERROR חוץ מ-0029 ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (כולל invisible-chars) ו-build עוברים.

## Implementation Notes

- נוסף עזר `private.render_notification_text` (בלי grant): מחליף כל `{key}` במעבר אחד, כך שסוגריים בתוך ערך לא מרונדרים שוב. ‏`INVALID_INPUT` על שדה בלי ערך, סוגר בודד, או ערך שאינו מחרוזת או מספר. ה-override נשמר כמו שהוא ולא מרונדר.
- הבדיקות של הסוג, ה-override והרינדור רצות לפני הדילוג על נמענת null, ולכן קריאה שגויה זורקת גם בלי נמענת.
- ה-policy נקראת `notifications_authenticated_select` (מוסכמת `<table>_<role>_<action>`); השם תוקן לפני ההחלה.
- המיגרציה הוחלה ב-`apply_migration` של ה-MCP מהסשן הראשי. ב-`schema_migrations` הגרסה היא `20261001184827` והקובץ `20261001184225`, כמו בשאר המיגרציות שהוחלו כך.
- כל השורות שנוצרות בעסקה אחת מקבלות אותו `created_at`, ולכן בדיקה לא נשענת על סדר שורות (שתי בדיקות נכשלו על זה ותוקנו).

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 2, low 20, false 2. patch 4 (בדיקות בלבד), defer 3, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | `enqueue_admin_notification` עם override לא נבדק | low | verification-gap: ‏`marketing_reminder` עובר רק דרך enqueue ישיר | patch: בדיקה שמחזירה 2 עם ה-override לכל אדמין |
| 2 | ענפי הסוגריים ב-`render_notification_text` לא נבדקים | low | verification-gap + blind-hunter: אין תבנית עם `}` בודד או `{` לא סגור | patch: בדיקות `'{units}}'`, ‏`'}{units}'`, ‏`'{units'` |
| 3 | ערך מספרי ב-vars ו-vars ריק בלי placeholders לא נבדקים | low | blind-hunter | patch: שתי בדיקות |
| 4 | RLS נבדק רק ל-admin1, ולא שאדמין לא רואה התראה של לקוחה | low | blind-hunter | patch: הרחבת בדיקת ה-RLS |
| 5 | תבנית שנערכה עם `{שדה}` שהקורא לא מעביר, או סוגריים לא מאוזנים, מפילה את ה-RPC של הכסף או ההרשמה | medium | blind-hunter + edge-case: הבדיקה רק בזמן ה-enqueue | defer ל-4.7: לבדוק את התבנית בשמירה (שדות מותרים לכל סוג, סוגריים) |
| 6 | `version` לא עולה לבד, ‏`updated_by` בלי אכיפה, ושום דבר לא חוסם שינוי של `push`/`body_mode`/`recipient_kind` | low | blind-hunter + edge-case | defer ל-4.7 (RPC העריכה היחיד או trigger) |
| 7 | הודעה כללית עד 2000 תווים בעברית עלולה לעבור את מגבלת ה-payload של Web Push (כ-4KB) | medium | blind-hunter: override עד 2000, ובלי גבול אחרי הרינדור | defer ל-5.8 (קיצור בעובד או גבול ב-`admin_send_broadcast`) |

Reject (17): אורך discriminator ו-`dedupe_key` (הקוראים מעבירים מזהים), נתיב שגוי עם נמענת null וקוד 23514 במקום `INVALID_INPUT` (ה-check בטבלה מחייב כל כותב, ובדיקות הקורא משייכות), ‏`../` בנתיב (הנתיבים נבנים ב-SQL שלנו), ערך ריק ב-var ו-override שנשמר בלי `btrim` (שגיאת קורא, קוסמטי), אפס אדמיניות (תמיד יש אחת), אינדקסים לתור ולמונה הלא-נקראו (5.7 ו-5.8 מוסיפים עם השאילתות שלהם), פרופיל לא מופעל או שפרטיו הוסרו (החלטת ה-spec: רק קיום ב-`profiles`; ‏4.6 מנקה), קלט שגוי עם נמענת null זורק (כשל רועש הוא התנהגות נכונה), ‏42501 מגיע מ-USAGE על `private` (שגוי: ל-`authenticated` יש USAGE, וה-revoke נבדק ב-`grants.test.ts`), ‏regex של `pg_proc` בלי update/delete (העובד ו-`mark_notifications_read` יעדכנו בכוונה), ופערי intent-alignment שמתארים את מה שנבנה (דילוג על null לפי החלטת המשתמשת, קורא באותה עסקה נבדק ב-2.2, ערוץ לסוג נדחה ל-3.5).

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
