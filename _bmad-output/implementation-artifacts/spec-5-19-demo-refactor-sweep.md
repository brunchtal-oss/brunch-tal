---
title: '5.19 ניקוי מאוחד לפני ההדגמה'
type: 'refactor'
created: '2026-10-10'
status: 'done'
baseline_commit: 'efb15a8f6f4e69f871a5e691e3d7040627047c2f'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-18-demo-data.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** שלושה פריטים ב-deferred-work מחכים ל-5.19: ‏`dev-seed-media` מנתק את אדמין הפיתוח בכל המכשירים, ל-SQL של `demo-clear` ול-`step()` אין בדיקה, ו-build בלי `.env*` נכשל. בנוסף יש בקוד כפילויות קטנות, קוד מת ופונקציות טהורות בלי בדיקה. ניקוי אחד מאוחד במקום ניקויי האפיקים (demo-scope).

**Approach:** תיקון של שורה ב-`dev-seed-media`, הוצאת בניית ה-SQL ושל `step()` לפונקציות טהורות עם בדיקות unit, בדיקת התאמה של הקאסט לתסריט, ורשימת ניקוי סגורה (א–ח) שלא משנה התנהגות, מראה או נוסח.

**החלטות המשתמשת (2026-10-10):**
- build בלי `.env*`: מוותרים על הדרישה של 1.2. אין שינוי קוד. README מציין ש-`npm run build` צריך `.env.local`, ופריט deferred-work של 5.16 נסגר. נימוק: הגדרה חסרה בפרודקשן צריכה להיכשל בקול ולא להציג אתר ריק.
- בדיקת הקאסט (target "5.18 חלק ב׳") נכנסת ל-5.19. חלק ב׳ נשאר בלי קוד.
- פריט סבב העיצוב (כרטיס הלקוחה באדמין מול יומן התנועות) מתורגם לעברית ב-deferred-work עם target "סיפור חדש אחרי ההגשה". לא נבנה כאן.
- אי-התאמה בין שמות קובצי המיגרציה לגרסה שבמסד: לא משנים שמות. נרשם פריט ב-deferred-work עם target 6.1.
- רשימת הניקוי: א–ח בלבד. בלי איחוד ה-UUID (‏31 קבצים) ובלי איחוד עזרים בין הסקריפטים.

## Boundaries & Constraints

**Always:** כל שינוי שומר על הפלט: אותו SQL בדיוק מ-`demo-clear` (חוץ מהשמירה החדשה על אדמינים, שזורקת רק במקרה שגיאה), אותו טקסט, אותו מראה. עזר משותף זהה תו בתו לעותקים שהוא מחליף. מודול שמיובא מ-`"use client"` לא מייבא `lib/server/**`. כל בדיקה חדשה רצה ב-`npm test`, בלי מסד, בלי רשת ובלי `.env`.

**Never:** מיגרציה, RPC, policy, טבלה או יצירת טיפוסים. הרצה של `demo:seed`, ‏`demo:clear`, ‏`dev:seed-media` או כל סקריפט נתונים. ‏`npm run test:db` בלי אישור המשתמשת. שינוי נוסח, תוכן או מראה. ניקויי האפיקים (2.11, ‏3.15, ‏4.13, ‏5.14). מיזוג ל-main בלי אישור מפורש על הזמן. עריכה של `components/ui/`. סוכן משנה לא מוחק קבצים ולא כותב ל-`.env*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SQL מלא | `buildClearSql` עם מזהים בכל הטבלאות, `mode` = demo | `begin` ← בלוק השמירה (`dev-admin@example.com`) ← מחיקות בסדר הקיים ← `update audit_log` ← `profiles` ← `auth.users` ← `commit`. ‏`replica` רק בשורה שלפני `entitlement_movements`, ו-`origin` מיד אחריה | אין |
| טבלה ריקה | רשימה ריקה לטבלה | `-- <table>: nothing` במקום `delete` | אין |
| אדמין ברשימה | מזהה מ-`admins` מופיע ב-`users`, ‏`customers` או ברשימת מחיקה אחרת | לא נכתב קובץ | זורק שגיאה |
| מזהה לא חוקי | ערך שאינו uuid | לא נכתב קובץ | זורק `unexpected id` (כמו היום) |
| `step` בהרצה חוזרת | המפתח כבר ב-state | מחזיר את הערך השמור, לא קורא ל-`fn`, סופר "כבר קיים" | אין |
| `step` שמחזיר undefined | ‏`fn` מחזיר undefined | לא נשמר ב-state, ‏ונוסה שוב בהרצה הבאה | אין |

</frozen-after-approval>

## Code Map

- `scripts/dev-seed-media.mjs:369` -- ‏`admin.auth.signOut()` ← ‏`{ scope: "local" }`. שורות 45–71: עותק של `devRef()` שקורא env בתוכו. מחליפים בייבוא מ-`./dev-guard.mjs` עם `{ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL }`. השמירה נשארת לפני כל פעולה אחרת, עם אותה הודעה.
- `scripts/demo-clear.mjs:103-108, 348-405` -- ‏`literal`, ‏`del` ומערך ה-SQL. עוברים ל-`scripts/demo-clear-sql.mjs` חדש (טהור, בלי env ובלי pg, בסגנון `demo-plan.mjs`), שמייצא את `buildClearSql(ids, mode)`. ‏`ids` כולל את כל רשימות המחיקה ואת `admins`. ‏`mode` הוא `"demo"` או `"dev-test-data"` (משפיע רק על שורת הכותרת). ‏`ADMIN_EMAIL` עובר לקבוע מיוצא, וחותמת הזמן מגיעה כפרמטר (`now`), כדי שהבדיקה תהיה דטרמיניסטית. ‏`demo-clear.mjs` קורא לה וכותב את הקובץ כמו היום.
- `scripts/demo-seed.mjs:185-198` -- ‏`step()` שנשען על `state`, ‏`saveState`, ‏`created`/`existing` ו-`demoKey` גלובליים. מוציאים ל-`createStep({ state, save, keyOf, log })` ב-`scripts/demo-plan.mjs`, שמחזירה `step` ומונים. ב-`demo-seed` חיבור בלבד: אותן הודעות ואותו סדר.
- `scripts/demo-cast.mjs` -- ‏`SESSIONS`, ‏`CUSTOMERS`, ‏`CONFLICT`, ‏`ADMIN_BOOKINGS`, ‏`SELF_BOOKINGS`, ‏`SELF_CANCEL`, ‏`NOTES`, ‏`LOGIN_CUSTOMER`. אין לו env בייבוא. התסריט נמצא ב-`spec-5-18-demo-data.md`: E5 תפוס 10 מתוך 12, ולמאיה נשארת כניסה פנויה.
- `test/demo-plan.test.ts`, ‏`test/dev-guard.test.ts` -- הדפוס לבדיקה של `.mjs` מ-TS.
- `lib/errors.ts:20` -- ‏`PINNED_NOT_AVAILABLE`: אין לו raise מאז `20261004212706_pinned_product_approval.sql`. נמחק. לבדוק ב-`lib/errors.test.ts` שאין רשימה קשיחה.
- `lib/copy/customer.ts:76` -- ‏`sessionsSoon`: אין לו שימוש. נמחק.
- `parsePositiveInt` -- זהה ב-`products/product-draft.ts:110` וב-`sessions/session-draft.ts:181` (תחת `app/admin/(shell)/`).
- `isPlainObject` -- זהה ב-`products/actions.ts:19` וב-`sessions/actions.ts:20`.
- `validVersion` -- זהה ב-`settings/actions.ts:34` וב-`settings/templates/actions.ts:18`.
- `text(value: unknown)` -- זהה ב-`app/me/sessions/[id]/booking-preview.ts:33` וב-`app/me/sessions/select/selection.ts:37`. ה-`text` האחרים (‏join-input, ‏load-details, ‏profile, ‏lib/sessions/public) שונים ונשארים.
- `asSaveResult` -- זהה ב-`products/[id]/product-editor.tsx:58` וב-`sessions/[id]/edit/session-editor.tsx:51`. עובר לייצוא מ-`components/admin/value-change-row.tsx`, ליד `ValueSaveResult`.
- `hhmm` -- זהה ב-`sessions/new/page.tsx:86` וב-`settings/page.tsx:37`. ‏`sessionDay` -- זהה ב-`customers/[id]/card-items.ts:189` וב-`payments/new/payment-form.tsx:986` (‏`"use client"`).
- `formatLocalDate(new Date())` -- ב-`app/(auth)/join/[token]/page.tsx:179` וב-`payments/new/form-data.ts:66`. זהה ל-`localToday()` (‏`lib/time.ts:181`).
- `lib/idempotency.ts`, ‏`lib/auth/join-link-state.ts` -- טהורים ובלי בדיקה.
- `lib/content/pages.ts:143` ("arrive in 5.5"), ‏`lib/copy/customer.ts:90` ("comes in 3.6") -- הערות שהתיישנו.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- שורות 305 (build), ‏488 (demo-clear), ‏493 (קאסט), ‏498 (signOut), ‏502–504 (פריט באנגלית), ‏143 (מסנן `/admin/sessions`: יש `sessionsListFilter` ובדיקה ב-`load-session.test.ts`. לאמת גם את חלק המפגש שבוטל לפני הסגירה).
- לא לגעת: ה-UUID regex ב-31 קבצים, ‏`listUsers`/`rpc`/כניסה בסקריפטים, ‏`displayPhone`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/dev-seed-media.mjs` -- ‏`signOut({ scope: "local" })`, ו-`devRef` מיובא מ-`dev-guard.mjs` -- תיקון ה-deferred, ושמירה אחת שנבדקת.
- [x] `scripts/demo-clear-sql.mjs` (חדש), `scripts/demo-clear.mjs` -- ‏`buildClearSql` טהורה ושמירה על אדמינים. ‏`demo-clear` רק אוסף מזהים וכותב -- אפשר לבדוק בלי מסד.
- [x] `scripts/demo-plan.mjs`, `scripts/demo-seed.mjs` -- ‏`createStep` -- דילוג בהרצה חוזרת נבדק.
- [x] `test/demo-clear.test.ts` (חדש) -- כל שורות המטריצה, כולל `mode` של dev-test-data ושני ה-`replica`, ואינדקס השמירה קטן מאינדקס ה-`delete` הראשון.
- [x] `test/demo-plan.test.ts` -- בדיקות ל-`createStep` (שתי שורות ה-`step` במטריצה, והמונים).
- [x] `test/demo-cast.test.ts` (חדש) -- כל `customer`/`event` ב-`ADMIN_BOOKINGS`, ‏`NOTES`, ‏`CONFLICT`, ‏`SELF_*` ו-`LOGIN_CUSTOMER` קיים ב-`CUSTOMERS`/`SESSIONS`. ‏E5 יוצא 10 מתוך 12. למאיה נשארת כניסה פנויה. החישוב לפי מבנה הקאסט, ואת הספירה מתעדים בהערה.
- [x] `lib/errors.ts`, `lib/copy/customer.ts` -- מחיקת `PINNED_NOT_AVAILABLE` ו-`sessionsSoon` (א, ב).
- [x] `lib/form-values.ts` (חדש) + `lib/form-values.test.ts` -- ‏`parsePositiveInt`, ‏`isPlainObject`, ‏`validVersion` ו-`nonEmptyText` (לשעבר `text`), תו בתו. מעדכנים את הקוראים ואת הייבוא בבדיקות הקיימות. אין ייצוא חוזר מקובצי ה-draft (ד).
- [x] `components/admin/value-change-row.tsx` + שני העורכים -- ‏`asSaveResult` מיוצא ומיובא (ד).
- [x] `lib/time.ts` + `lib/time.test.ts` -- ‏`formatClockTime(time)` (‏`"HH:MM:SS"` ← ‏`"HH:MM"`) עם בדיקה. ‏`sessionDay` מוחלף ב-`formatSessionDate` הקיים (זהה), גם בעותקים ב-`sessions/book/page.tsx`, ‏`lib/server/privileged/join.ts` ובגוף של `dayText`. מחליפים את ארבעת העותקים (ו), ואת שני `formatLocalDate(new Date())` ב-`localToday()` (ה).
- [x] `lib/idempotency.test.ts`, `lib/auth/join-link-state.test.ts` (חדשים) -- פורמט v4 וביטים עם `random` מוזרק, וכל ערך ב-`CONFLICT_REASONS` מול ערך לא מוכר (ז).
- [x] `lib/content/pages.ts`, `lib/copy/customer.ts` -- הערות מעודכנות. רק הערות, לא מחרוזות (ח).
- [x] `README.md` -- שורה: ‏`npm run build` דורש `.env.local` (החלטה 1).
- [x] `deferred-work.md` -- ‏`status:` לשורות 305, ‏488, ‏493, ‏498 ו-143 (אם אומת). הפריט שבשורות 502–504 בעברית, עם target "סיפור חדש אחרי ההגשה". פריט חדש: אי-התאמת גרסאות המיגרציה, target 6.1.
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/story-demo-refactor-sweep.md` (חדש) -- קובץ הסיפור בעץ עם `status: done`, בפורמט של `story-session-reminder-24h.md`. סשן ראשי, ב-PR.

**Acceptance Criteria:**
- Given ה-SQL שהופק לפני השינוי, when מריצים את `buildClearSql` על אותם מזהים ועם אותו `now`, then הפלט זהה מילה במילה.
- Given הניקוי, when מריצים `npm run lint`, ‏typecheck, ‏`npm test`, ‏`npm run format:check` ו-`npm run build` (עם `.env.local`), then כולם עוברים, ו-`grants.test.ts` לא השתנה.
- Given כל עזר מאוחד, when משווים את העותק שהוסר לעזר המשותף, then הגוף זהה ואף קורא לא שינה התנהגות.
- Given ה-preview של ה-PR מאחורי הנעילה, when עוברים על מסלול ההצגה של 5.18 כאורחת, כלקוחה בדויה וכאדמין, then אין שינוי נראה. מה שנראה שבור מדווחים ולא מתקנים.

## Implementation Notes

- 2026-10-10, ‏`test:db` (באישור המשתמשת): 772 עברו, 2 נכשלו ב-`self-booking.test.ts`. הבדיקה קבעה מפגש ב"יום שני הראשון מהיום + 2" ב-10:00, ובשבת אחרי 10:00 הוא פחות מ-48 שעות קדימה (‏`can_self_cancel` ‏false). תלוי בשעה, לא בשינוי הזה. תוקן באישור המשתמשת: ‏`localDay(db, d, 3)` בכל הקובץ (לפחות 58 שעות קדימה). הקובץ עובר (21).

## Spec Change Log

- 2026-10-10, ביקורת סבב 1 (ממצא R1): ה-Code Map ביקש `formatWeekdayDayMonth` חדש, אבל `formatSessionDate` ב-`lib/time.ts` זהה לו ונבדק. תוקן: `sessionDay` מוחלף ב-`formatSessionDate` הקיים (`hhmm` נשאר `formatClockTime`) (ובעותקים נוספים: `sessions/book/page.tsx`, ‏`lib/server/privileged/join.ts`, הגוף של `dayText`), ו-`formatWeekdayDayMonth` נמחק. המצב הרע שנמנע: עותק מיוצא נוסף בתוך ניקוי כפילויות. KEEP: כל שאר המימוש. חריגה מה-workflow: תיקון ממוקד במקום revert ובנייה מחדש, כי הטעות היא פונקציה אחת שמוחלפת בקיימת.

## Review Triage Log

סבב 1 (‏blind ×2, ‏edge-case, ‏verification-gap, ‏intent-alignment): ‏medium 1, ‏low 5, ‏false/reject 19.

| # | ממצא | verdict | route | evidence / פעולה |
|---|---|---|---|---|
| R1 | `formatWeekdayDayMonth` כפול ל-`formatSessionDate`; עוד 3 עותקים inline | low | bad_spec (תוקן במקום) | גוף זהה ב-`lib/time.ts`. ראו Spec Change Log |
| R2 | `buildClearSql` מקבל רשימה או `admins` חסרים כריקים (blind, edge, verification-gap) | medium | patch | ‏`ids[name] ?? []`: שם שגוי בקורא מוחק פחות בשקט ומכבה את השמירה. זורק כשמפתח חסר, עם בדיקה |
| R3 | `asSaveResult` עוד בשני עורכי ההגדרות | low | patch | `settings-editor.tsx:92`, ‏`template-editor.tsx:92`: ייבוא מהעזר |
| R4 | שגיאות `buildClearSql` החדשות באנגלית, שאר הפלט בעברית | low | patch | הודעות חדשות בעברית עם "לא נכתב קובץ" |
| R5 | ‏JSDoc של `formatClockTime` לא מבחין מ-instant | low | patch | הבהרה: עמודת `time` של Postgres |
| R6 | ‏README: "בכוונה" ו-`/contact` כעמוד היחיד | low | patch | ניסוח: העמודים הציבוריים, עם ההחלטה |

נדחו: שמירה בזמן הרצת ה-SQL ואדמין הפיתוח בלי `admin_roles` (קיים מלפני, מסד פיתוח, לא סביר); השוואת אדמין מול טבלאות לא קשורות, אותיות גדולות ב-uuid, ‏`mode`/`now` לא נבדקים, ‏`step` לפני `bindStep` (נכשל בקול), ‏`null` ב-`createStep` (זהה לקוד הקודם); בדיקת הקאסט רק ל-E5 ו-`CARD_ENTRIES` קבוע, הנחת הכניסות של מאיה (בהיקף שנקבע); בדיקה סטטית לשמירה בכל סקריפט, fixture עם כמה מזהים, בדיקת קודי שגיאה מול SQL, ערכים דומים ב-`toConflictReason` (תוספות מעבר לניקוי); שם `isPlainObject` ושם `lib/form-values.ts` (הועבר כמו שהוא); בדיקת הזמן החלשה (נמחקת עם R1); ‏`signOut` ו-binding של `demo-seed` בלי בדיקה (תיאורי, ‏intent-alignment).

## Design Notes

שוויון ה-SQL: לפני ההוצאה כותבים בבדיקה fixture קטן (uuid קבועים לכל רשימה). בונים את הציפייה מהקוד הישן פעם אחת ושומרים אותה כמחרוזת צפויה בבדיקה. אחרי ההוצאה הבדיקה צריכה לעבור בלי שינוי.

שמירת האדמינים: `buildClearSql` זורקת `admin in delete list` אם מזהה מ-`ids.admins` מופיע באחת מרשימות המחיקה. כך "אדמינים לא נכנסים לקובץ" נבדק בלי מסד. השאילתות ב-`demo-clear` כבר מוציאות אותם, ולכן במצב תקין אין שינוי.

## Verification

**Commands:**
- `npm run lint` -- expected: נקי
- `npx tsc --noEmit` -- expected: נקי
- `npm test` -- expected: הכל עובר, כולל הבדיקות החדשות
- `npm run format:check` -- expected: נקי
- `npm run build` -- expected: עובר עם `.env.local`. בלי `.env*` נכשל ב-`/contact` כמתועד (החלטה 1)

**Manual checks (if no CLI):**
- ‏`git diff` על `scripts/`: אין הדפסה של `SUPABASE_SECRET_KEY`, ‏סיסמה או קישור. שמירת הפיתוח בכל סקריפט שנגעו בו עדיין רצה לפני כל קריאה לרשת.
- ‏security advisor: ‏`get_advisors` אחד לאימות שהוא נקי (אין מיגרציה).
