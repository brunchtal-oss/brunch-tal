---
title: 'סיפור 5.18 (חלק א׳): נתוני הדגמה בדויים, התסריט והנתונים'
type: 'chore'
created: '2026-10-07'
status: 'done'
baseline_commit: '2319bcd3ec02295d9297cb13a2e903a8e48fc337'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/demo-scope-2026-10-04.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** במסד הפיתוח אין נתונים שנראים כמו עסק אמיתי. אי אפשר להציג את המערכת למבקרים, וסבב העיצוב בודק מסכים ריקים או מסכים עם שמות בדיקה.

**Approach:** תסריט כתוב לפי פעולות, וסקריפט `scripts/demo-seed.mjs` שבונה עסק בדוי דרך אותם RPC ואותו תהליך הצטרפות שהמסכים משתמשים בהם. הוא פועל כאדמין הפיתוח וכלקוחות עצמן, עם מפתחות idempotency קבועים ורשימת מזהים מקומית. כניסת המבקרים עוברת דרך `dev-reset-link`. צילומים ומסלול ההצגה הסופי: חלק ב׳ (סבב 9).

## Boundaries & Constraints

**Always:**
- לפני כל קריאה: בדיקת `devRef()` כמו ב-`dev-seed-media.mjs` (‏`DEV_DATABASE_URL` מכיל את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`). אם היא נכשלת, הסקריפט עוצר ולא משנה כלום.
- כתיבה רק ב-RPC: ‏`admin_approve_payment` (כל רכישה, גם עם `p_paid_on` בעבר), ‏`join_begin` ‏← `auth.admin.createUser({ id: pending_user_id, … })` ‏← `join_complete` (פרופיל, תינוקות, תזונה ושתי ההסכמות, AD-10), ‏`admin_book_customer`, ‏`book_sessions` ו-`cancel_booking` כלקוחה, ‏`admin_create_event` עם `publish: true`, ‏`admin_set_event_image` (רק תמונה שכבר פורסמה), ‏`admin_add_customer_note`, ‏`admin_add_work_dish`, ‏`admin_add_work_task`, ‏`admin_add_shopping_items`, ‏`admin_set_work_task_done`, ‏`admin_set_shopping_item_bought`. אין `.from(...).insert/update/delete/upsert` בכלל.
- כניסה כאדמין הפיתוח (`dev-admin@example.com`) וכלקוחה: קישור חד-פעמי (`generateLink` ואז `verifyOtp`) שלא מודפס. לכל משתמשת Auth חדשה סיסמה אקראית (`randomBytes`) שלא מודפסת ולא נשמרת.
- בפלט וביומן אין טוקן, קישור, סיסמה או מפתח. בשגיאה מדפיסים רק קוד והודעה. ‏`SUPABASE_SECRET_KEY` נקרא רק מ-`.env.local`.
- מפתח idempotency = ‏UUID שנגזר מ-`sha256(generation + ":" + itemKey)`. ‏`generation`, ‏`anchor` (רגע ההרצה הראשונה) ומזהי כל מה שנוצר נשמרים ב-`.demo-data.local.json` בשורש (ב-`.gitignore`). הרצה חוזרת קוראת אותו, ולכן מקבלת את אותם מפתחות ואת אותם תאריכים.
- תאריכים יחסית ל-`anchor`, לפי `Asia/Jerusalem`, בלי שבת. כל מצב מרכזי נשאר נכון לפחות 10 ימים: מפגש כמעט מלא ב-D+5 ואילך, וכרטיסייה שפגה ב-D+9 (עד 10 ימים ללקוחה, עד 21 לאדמין).
- סימני זיהוי: מייל `<שם-לטיני>@demo.example.com` (תת-דומיין של דומיין שמור), טלפון `03-0000NNN` (מספר מקומי שמתחיל ב-0 לא מוקצה בישראל, ועובר את `normalize_phone`). אין `push_subscriptions` ללקוחות בדויות.
- שמות פרטיים ומשפחה נפוצים, שמות תינוקות רגילים, והערות ותזונה בניסוח טבעי. לא "בדויה" או "בדיקה", ולא שמות של אנשים מוכרים.
- תוכן האתר כבר מלא (הירו, אודות, שאלות נפוצות, צעדים, גלריה והמלצות), ולכן הסקריפט לא כותב תוכן. הוא רק מדפיס אזהרה אם אחד מהם ריק.

**Never:** מיגרציה, ושינוי RPC, ‏policy, טבלה, מסך או נוסח. העלאת תמונות או קובץ תמונה ב-repo. ריצה מול פרויקט שאינו הפיתוח. עריכה של `dev-seed-media.mjs`. סימון 5.18 כ-done.

**הקאסט (D = יום ה-anchor):** 15 לקוחות. מאיה ברק היא לקוחת הכניסה: כרטיסייה (‏4 כניסות), הרשמה ל-E0 (השתתפה), ול-E2 ול-E6 ב-`book_sessions` כלקוחה (כניסה אחת נשארת פנויה), ובודדת מוצמדת ל-E4 שהיא ביטלה (‏`cancel_booking`, הכניסה חוזרת, 3.6). נועה אברהם: כרטיסייה ששולמה ב-D-40 ופגה ב-D+9. ספיר רבינוביץ: בודדת מוצמדת ל-E2 בלי הצטרפות (שורת "ממתינה להצטרפות", AD-23). קרן וייס: ב-`join_begin` היא מזינה טלפון של לקוחה אחרת (‏`two_accounts`), והקישור עובר ל-`conflict` ומופיע ב"לטיפול". עוד: שתי היכרות (לא ב-E0), זוגית ל-E3, בודדות וכרטיסיות. תערובת של כן ולא בשתי ההסכמות, 4 לקוחות עם אלרגיה או תזונה מיוחדת, ו-3 הערות של טל. הרשימה המלאה ב-`scripts/demo-cast.mjs`.

**המפגשים (קונספטים קיימים, 10:30–14:30):** ‏E0 "אמהות בחל״ד" היום, 4 נרשמות, מסתיים (ראו Design Notes). ‏E1 ב-D+1, ‏E2 "יווני" ב-D+3. ‏E3 "זוגות" ב-D+5. ‏E4 ב-D+6. ‏E5 "אמהות בחל״ד" ב-D+7: ‏10 מתוך 12, כמעט מלא, ובו דף העבודה (4 מנות, משימות ב--1 וב-0 שחלקן בוצעו, 8 פריטי קניות שחלקם נקנו). ‏E6 ב-D+9. ‏E7 "עם סבתוש" ב-D+12, ריק. לכל מפגש תמונה מתוך תמונות הגלריה שכבר פורסמו.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| הרצה ראשונה | אין קובץ מזהים ואין מייל `@demo.example.com` | הכול נוצר, הקובץ נכתב אחרי כל פריט, וסיכום בעברית (מיילי הלקוחות, מספר המפגשים וההרשמות) | — |
| הרצה שנייה | יש קובץ מזהים | כל RPC מחזירה את התוצאה השמורה. אין שורה חדשה, והפלט "כבר קיים" | — |
| קובץ אבד | יש מיילי הדגמה ואין קובץ | עוצר לפני כל כתיבה ומסביר | יציאה 1 |
| פרויקט אחר | ה-ref לא תואם | עוצר לפני כל כתיבה | יציאה 1 |
| אין אדמין פיתוח | ‏`dev-admin@example.com` חסרה | עוצר עם ההוראה להריץ `dev-reset-link --admin` | יציאה 1 |
| הרצה מאוחרת | אחרי 23:30 שעון ישראל, בהרצה הראשונה | עוצר לפני כל כתיבה: E0 חייב להסתיים באותו יום | יציאה 1 |
| המשך אחרי קריסה | אישור תשלום כבר שמור (בלי טוקן) והצטרפות לא הושלמה | ‏`admin_issue_link` עם מפתח חדש ממשיך את ההצטרפות | — |
| המשך אחרי סוף E0 | ‏E0 כבר הסתיים | ההרשמות החסרות ל-E0 מדולגות עם אזהרה | — |
| אחרי מחיקה | יש קובץ מזהים, אבל אין במסד אף מייל הדגמה ואף מפגש מהקובץ | הקובץ מוחלף ב-`generation` ו-`anchor` חדשים, וזו הרצה ראשונה | — |
| מחיקת ההדגמה | ‏`demo:clear` | נכתב `.demo-clear.local.sql` (ב-`.gitignore`) עם מזהי ההדגמה בלבד. הפלט: מספרי השורות לכל טבלה והנתיב. הסקריפט לא מוחק כלום | אין קובץ מזהים ואין מיילי הדגמה ← "אין מה למחוק" |
| ניקוי נתוני הבדיקה | ‏`demo:clear --dev-test-data` | נכתב `.dev-test-clear.local.sql`: כל נתוני הלקוחות והמפגשים שאינם של ההדגמה | — |

**החלטות (המשתמשת, 2026-10-08):**
- **מחיקה (שאלה 1, ב׳):** הסקריפט לא מוחק. ‏`npm run demo:clear` רק מכין קובץ SQL, והמשתמשת בודקת אותו ומריצה ב-SQL Editor של פרויקט הפיתוח (כמו מיגרציית `drop`). הקובץ: עסקה אחת. היא מתחילה בבדיקת שמירה (‏`raise exception` אם אין `dev-admin@example.com` ב-`auth.users`), ומנטרלת את טריגר ה-append-only של `entitlement_movements` רק בתוך העסקה (‏`set local session_replication_role = replica`). אחר כך היא מוחקת לפי סדר ה-FK את כל השורות שנגזרות מלקוחות ההדגמה (דומיין המייל) וממפגשי הקובץ, כולל משתמשות Auth. ‏`audit_log` ו-`idempotency_results` נשארים (אין בהם מידע מזהה, ו-`generation` חדש לא מתנגש בהם).
- **נתוני הבדיקה הקיימים (שאלה 2, ב׳):** אותו מנגנון, עם `--dev-test-data`. נמחקים כל הלקוחות (חוץ ממיילי ההדגמה ומהאדמינים), התשלומים, הזכויות, ההרשמות, הקישורים, ההתראות, ההערות, המפגשים ודפי העבודה. נשארים המוצרים, הקונספטים, אמצעי התשלום, התוכן, התמונות, ההגדרות, האדמין, `audit_log` ו-`idempotency_results`. רץ פעם אחת, לפני ההרצה הראשונה של `demo:seed`.
- **תוכן האתר:** יוחלף כולו בהמשך, כי התוכן הנוכחי נוצר אוטומטית ולא הוכנס על ידי המשתמשת. לכן הסקריפט לא נוגע בתוכן (כמו שכתוב למעלה).

</frozen-after-approval>

## Code Map

- `scripts/dev-seed-media.mjs` -- הדפוס להעתיק: `devRef()`, ‏`adminClient()` (קישור שלא מודפס), ‏`rpc()`, ‏`hasPendingDraft`. לא לערוך.
- `scripts/dev-reset-link.mjs` -- יקבל `--email <x@demo.example.com>`: רק משתמשת קיימת בדומיין ההדגמה, בלי upsert לפרופיל, ובדיקת `devRef()` לפני הנפקה.
- `lib/server/privileged/join.ts:166-230, 320-410` -- סדר ההצטרפות (‏`join_begin`, ואז `getUserById`/`createUser` עם `pending_user_id`, ואז `join_complete`). את מבנה `p_profile` מעתיקים משם.
- `supabase/migrations/20261007183144_two_photo_consents.sql` (‏`join_complete`) -- שדות חובה: `full_name`, ‏`email`, ‏`phone`, ‏`privacy_consent: true`, ‏`photo_consent` ו-`personal_photo_consent` בוליאניים, ‏`babies` (‏1–10, ‏`name` ו-`birth_date`) ו-`dietary_notes` (עד 2000).
- `supabase/migrations/20261004212706_pinned_product_approval.sql:196-219` -- ‏`expires_on = p_paid_on + validity_days`. ‏`paid_on` בעבר מותר, בעתיד נדחה.
- `supabase/migrations/20261005193624_admin_session_details_and_manual_booking.sql` -- ‏`admin_book_customer` דוחה רק אחרי `ends_at` (לא אחרי סגירת ההרשמה).
- `supabase/migrations/20261006142736_session_completion_review_fixes.sql` -- ‏`job_complete_events` (‏cron כל 5 דקות) מסיים מפגש ש-`ends_at <= now()`.
- `supabase/migrations/20261002181416_existing_account_and_conflicts.sql` -- ‏`find_identity`: מייל של חשבון אחד וטלפון של אחר ← `conflict`/`two_accounts`.
- `public.products` -- ‏4 מוצרים: כרטיסייה (‏4 כניסות, 49 ימים), בודדת, היכרות וזוגית. ‏`business_settings`: ‏`admin_expiring_days=21`, ‏`customer_expiring_days=10`, ‏`last_places_threshold=4`, ‏`cancel_window_hours=48`. מוצאים לפי `type`, לא לפי שם.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/demo-plan.mjs` -- פונקציות טהורות: `planDates(anchor)` (בלי שבת, זמני E0, דחייה אחרי 23:30) ו-`demoKey(generation, item)` -- נבדקות בלי מסד
- [x] `test/demo-plan.test.ts` -- שבת מדולגת, ‏E0 מסתיים אחרי ההרצה ובאותו יום, דחייה מאוחרת, מפתח יציב, ו-`paid_on` של הכרטיסייה שפגה נותן D+9
- [x] `scripts/demo-cast.mjs` -- הקאסט וההערות, המנות, המשימות והקניות, כנתונים בלבד
- [x] `scripts/demo-seed.mjs` -- התזמור לפי Boundaries. הסדר: מפגשים, רכישות והצטרפות, הרשמות, ביטול, הערות, דף עבודה, תמונות
- [x] `scripts/demo-clear.mjs` -- מכין את שני קובצי ה-SQL לפי ההחלטות. רק קריאה מהמסד (לקוח השירות, בדיקת `devRef()`), ושום כתיבה. מזהים נכנסים לקובץ כ-uuid מאומת בלבד
- [x] `scripts/dev-reset-link.mjs` -- ‏`--email` (ראו Code Map)
- [x] `package.json` -- ‏`demo:seed` ו-`demo:clear`
- [x] `.gitignore` -- ‏`.demo-data.local.json` ו-`*.local.sql`
- [x] `_bmad-output/implementation-artifacts/demo-walkthrough-5-18.md` -- התסריט בעברית, לפי פעולות ולשלוש דמויות (אורחת, לקוחה, אדמין): מה עושים, מה רואים ואיזה סיפור זה מדגים. מקומות פתוחים לצילומים ולנוסח של סבב 9
- [x] `README.md` -- סעיף קצר "נתוני הדגמה": סדר ההרצה ואיך מגדירים סיסמה למבקרים
- [ ] סשן ראשי -- `demo:clear --dev-test-data`, המשתמשת מריצה את הקובץ ב-SQL Editor, ואז הרצה ראשונה מול הפיתוח, הרצה שנייה (ספירות זהות), ‏`get_advisors` ו-`npm run test:db`

**Acceptance Criteria:**
- Given הרצה שנייה, when סופרים ב-SQL את הפרופילים, התשלומים, ההרשמות, המפגשים וההערות של ההדגמה, then הספירות זהות להרצה הראשונה.
- Given כניסה כמאיה, then רואים כרטיסייה עם יתרה ותוקף, הרשמות קרובות, הרשמה שבוטלה, את E0 עם "השתתפת" והתראות.
- Given אדמין, then בבית מופיעים מפגשים ותפוסה, "עומדות לפוג" עם נועה ו"לטיפול" עם הקישור של קרן. בכרטיס לקוחה יש הערה ושתי הסכמות, ודף העבודה של E5 מלא.
- Given ‏`git grep` על הקבצים החדשים, then אין סיסמה, טוקן או מפתח, ואין `.insert(`/`.update(`/`.delete(`/`.upsert(`.

## Design Notes

**מפגש שהסתיים בלי כתיבה ישירה:** ‏`save_event` לא דוחה עבר, ו-`admin_book_customer` מאפשר הרשמה עד `ends_at`. לכן E0 נוצר היום, עם התחלה מוקדמת מ-10:30 ו-שעה לפני ההרצה (לא לפני 06:00), וסיום כ-6 דקות אחרי ההרצה (מעוגל ל-5). ההרשמות אליו נעשות מיד. ה-cron מסיים אותו תוך כ-10 דקות, והסקריפט מדפיס את זה. המחיר: E0 מוצג כמפגש של יום ההרצה, ובשעות לא עגולות.

**למה קובץ מזהים מקומי:** ‏`idempotency_results` פרטית, ולמפגשים אין עמודת סימון. הקובץ נותן מפתחות ותאריכים יציבים, והוא גם "רשימת המזהים שהסקריפט יצר".

## Implementation Notes

- 2026-10-08, סשן ראשי: ניקוי נתוני הבדיקה כבר בוצע. הקובץ `.dev-test-clear.local.sql` בשורש ה-worktree נכתב ביד, והמשתמשת הריצה אותו ב-SQL Editor. התוצאה: ‏0 פרופילים, ‏1 משתמשת Auth (האדמין), ‏0 מפגשים, תשלומים, הרשמות וזכויות, ‏4 מוצרים ו-5 קונספטים. ‏`--dev-test-data` של `demo-clear.mjs` מייצר את אותו SQL (העתיקו ממנו את סדר המחיקה, את בדיקת השמירה, את `replica` רק סביב מחיקת `entitlement_movements`, ואת `audit_log.customer_id = null`). ‏`profiles` בלי FK ל-`auth.users`, ו-`audit_log.customer_id` עם FK ‏NO ACTION. המחיקה הזו כבר לא נדרשת במשימת הסשן הראשי. משם מתחילים ישר ב-`demo:seed`.

## Spec Change Log

## Review Triage Log

**סבב 1 (2026-10-08):** ‏4 מבקרים (blind, ‏edge, ‏verification-gap, ‏intent). אחרי איחוד: 13 ‏patch, ‏3 ‏defer, ‏10 ‏reject.

| # | ממצא | פסק | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 1 | ‏`signOut()` בסוף `demo-seed` הוא global, ומנתק את האדמין ואת מאיה בכל מכשיר | medium | patch | ברירת המחדל של supabase-js היא `scope: 'global'`. מעבר ל-`{ scope: "local" }` |
| 2 | ‏`deleteOrphanUser` מוחק משתמשת Auth בלי לבדוק שהיא בדומיין ההדגמה | low | patch | שמירה זולה: מוחקים רק כשהמייל ב-`@demo.example.com` |
| 3 | ‏`storage.remove` של `hidden_paths` בלי בדיקת שגיאה | low | patch | ‏`error` ← אזהרה |
| 4 | ‏`demo-clear` לא מוחק התראת אדמין שה-dedupe שלה הוא מזהה קישור | medium | patch | ‏`refs` לא כולל את `tokens`. מוסיפים |
| 5 | ‏`demo-clear` (הדגמה): תשלום של לקוחה אחרת שמוצמד למפגש הדגמה נשאר בלי זכות | medium | patch | מרחיבים את `payments` ל-`payment_id` של הזכויות וההרשמות שנמחקות, ומחשבים מחדש את מה שנגזר מהם |
| 6 | בלי קובץ מזהים, `demo-clear` משאיר מפגשים ותשלומים בלי לקוחה, בלי אזהרה | low | patch | אזהרה מפורשת ב-`demo-clear`, והבהרה בהודעה של ה-seed |
| 7 | המשך אחרי קריסה באמצע הצטרפות: מפתח `join_begin`/`join_complete` קבוע, ולכן בקישור חדש מוחזרת תוצאה ישנה | medium | patch | אחרי `admin_issue_link` המפתח נגזר מ-`join:<key>:<token_id>`. המטריצה מבטיחה שההמשך יעבוד |
| 8 | הרשמות E0 רצות רק אחרי כל 15 ההצטרפויות, ו-E0 נגמר 6–10 דקות אחרי ה-anchor | medium | patch | ההרשמה של כל לקוחה ל-E0 רצה מיד אחרי ההצטרפות שלה |
| 9 | הקיבולת לא מועברת, ו"10 מתוך 12" תלוי בהגדרה שנערכת באדמין | low | patch | ‏`capacity_adults` מפורש לכל מפגש |
| 10 | התסריט: ספיר ב"לטיפול" רק מ-D+2 (‏`purchase_without_link` אחרי שהקישור פג), פעולות על E1 שכבר סגור, וטענת "10 ימים" | medium | patch | בתסריט: עד מתי כל מצב נכון, ספיר מ-D+2, ופעולות על E3/E7 |
| 11 | ‏README: ‏15 מיילי הדגמה, אבל לספיר אין | low | patch | ‏14 |
| 12 | הבדיקה "Israel date" לא בודקת את מה שההערה שלה אומרת | low | patch | קלט `T00:30` שעון ישראל |
| 13 | ‏`devRef` ו-`parseEmail` (השמירה היחידה מפני פרויקט אחר ולקוחה שאינה של ההדגמה) לא נבדקים | medium | patch | ‏`scripts/dev-guard.mjs` מיוצא, משותף לשלושת הסקריפטים, עם בדיקות unit |
| 14 | אין בדיקת unit לבניית ה-SQL של המחיקה ולהרצה חוזרת | low | defer | ‏deferred-work |
| 15 | אין בדיקה שהקאסט תואם לתסריט (מפתחות, E5 ‏10/12, היתרה של מאיה) | low | defer | ‏deferred-work. הבדיקה בטלפון מכסה |
| 16 | גם `dev-seed-media.mjs` עושה `signOut()` גלובלי | medium | defer | קיים מלפני הסיפור, ואסור לערוך אותו כאן ← deferred-work |

13 ה-patch יושמו (כולל `scripts/dev-guard.mjs` ו-`test/dev-guard.test.ts`). אחריהם עוברים lint, ‏typecheck, ‏format:check, ‏`npm test` ‏(128 קבצים, 1821 בדיקות) ו-build. בתסריט הסוכן הפנה את ההרשמה בכרטיסייה ל-E4 ולא ל-E3/E7, כי שני אלה זוגיים והכרטיסייה לא מתאימה להם.

Reject (‏10): ‏env מה-shell גובר על `.env.local` (אותו דפוס כמו `dev-seed-media`); אדמין עם מייל הדגמה (לא מציאותי); המשך אחרי ימים, כש-E4 בתוך 48 שעות או שמפגש מוצמד כבר הסתיים (נדיר, ומוסיף ענפים); קובץ שאבד לפני ההצטרפות הראשונה (נדיר); ‏`hide_unused_media` (התנהגות רגילה של המסכים); ‏`demo-clear` קורא דרך `pg` בעסקה לקריאה בלבד (נדרש ל-`auth.users`, לא מזיק); ההצטרפות כתובה מחדש ב-mjs ולא דרך `join.ts` (מודול TS של השרת. הערוץ הוא אותן RPC, כמו ב-Approach); ‏`fail()` בתוך `try` מדלג על `finally` (עם `scope: local` זה כבר לא משנה).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: הכול עובר
- `npm run demo:seed` פעמיים -- expected: בהרצה השנייה "כבר קיים" וספירות זהות

**Manual checks:**
- בטלפון, מול כתובת ה-Vercel הנעולה: ארבע הבדיקות שבבקשה (אורחת, מאיה, אדמין, ושהשמות נראים אמיתיים)
