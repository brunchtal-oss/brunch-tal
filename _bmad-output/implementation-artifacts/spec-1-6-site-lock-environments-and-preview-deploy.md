---
title: '1.6 Site lock, environments and preview deploy — נעילת אתר וסביבות'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '6ad9f494a68f48b15dcb30857f510aef94cbe0e6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין נעילה, ולכן אסור לפרוס ל-production, והניסוי של 1.1 רץ רק ברשת הביתית. ה-README, ‏`.env.example` וה-seed הם של הטמפלייט.

**Approach:** Basic Auth ב-`proxy.ts` לפי `SITE_LOCKED`, עם רשימת prefixes פטורים (`/api/jobs/`); קובצי סביבה, seed ו-README של הפרויקט; פריסה ל-preview ול-production באישור המשתמשת, ובדיקת הניסוי של 1.1 דרכן בטלפון.

## Boundaries & Constraints

**Always:** AD-22. שם המשתמש והסיסמה של הנעילה רק במשתני שרת (`SITE_LOCK_USER`, ‏`SITE_LOCK_PASSWORD`), אף פעם לא `NEXT_PUBLIC_*`, לא בקוד ולא בלוג. השוואה בזמן קבוע. נעילה שהופעלה בלי פרטים חוסמת הכול (fail-closed). הנעילה חלה על כל נתיב, כולל קבצים סטטיים. ‏`/api/jobs/` פטור ברמת הנעילה בלבד; כל נתיב כזה יאמת את `CRON_SECRET` בעצמו (E3). רענון ה-session של 1.1 נשמר. כל push או merge רק אחרי הסבר ואישור.

**Decisions (המשתמשת, 2026-09-29):**
- ברירת מחדל fail-closed: ב-Vercel (‏`VERCEL_ENV` הוא `production` או `preview`) האתר נעול תמיד, אלא אם `SITE_LOCKED=false` במפורש. מחוץ ל-Vercel נעול רק כש-`SITE_LOCKED=true`.
- סדר מיזוג: ה-PR של 1.6 ממוזג לתוך `story-1-1-phone-activation-tracer`, ואז PR #1 ל-main. ‏production נפרס פעם אחת, נעול. זה מחליף את הכלל "PR #1 לפני 1.6" ב-`AGENTS.md`.
- נתיבי טוקן ביומני Vercel: מקובל בינתיים, נרשם ב-`deferred-work.md` לבדיקה לפני ההשקה.

**Never:** GitHub Actions ו-`test:db` (1.2); נתיבים תחת `/api/jobs/` (E3); פרויקט Supabase לפרודקשן; כתיבת משתני Vercel (המשתמשת עושה בדשבורד); נתונים אמיתיים ב-seed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| נעול, בלי פרטים | כל נתיב (`/`, ‏`/login`, ‏`/_next/static/...`, ‏`/x.png`) | ‏401 עם `WWW-Authenticate: Basic`, בלי תוכן האתר |
| נעול, פרטים נכונים | `Authorization: Basic ...` | הבקשה ממשיכה, ה-session מתרענן כמו היום |
| נעול, פרטים שגויים או header פגום | שם או סיסמה שגויים, base64 שבור, סכמה אחרת | ‏401 |
| פטור | `/api/jobs/...` | ממשיך בלי Basic Auth |
| לא פטור למרות דמיון | `/api/jobsx`, ‏`/api/jobs` בלי `/` | ‏401 |
| נעול, חסר שם או סיסמה בשרת | `SITE_LOCKED=true` בלי `SITE_LOCK_PASSWORD` | ‏401 לכולם |
| Vercel בלי המשתנה | `VERCEL_ENV=preview` או `production`, ‏`SITE_LOCKED` חסר | נעול |
| Vercel, פתוח במפורש | `VERCEL_ENV=production`, ‏`SITE_LOCKED=false` | בלי Basic Auth |
| מחשב מקומי | בלי `VERCEL_ENV`, ‏`SITE_LOCKED` חסר | בלי Basic Auth, כמו היום |

</frozen-after-approval>

## Code Map

- `proxy.ts` -- היום רק `updateSession`, עם matcher שמדלג על `_next/static`, תמונות ו-favicon. הנעילה נכנסת כאן, לפני `updateSession`.
- `lib/supabase/proxy.ts` -- `updateSession`. לא לשנות.
- `next.config.mjs`, ‏`next.config.test.ts` -- כותרות ולוג של 1.1. לא לשנות.
- `.env.example` -- של הטמפלייט, עם `AI_GATEWAY_API_KEY`. ‏`.gitignore` מתעלם מ-`.env*`, והקובץ נשמר רק כי כבר עוקב.
- `supabase/config.toml` -- כבר `enable_signup = false` ו-`enable_confirmations = false`, ו-`sql_paths = ["./seed.sql"]` לקובץ שלא קיים.
- `scripts/dev-reset-link.mjs` -- מדפיס קישור ל-localhost ולרשת בלבד.
- `README.md` -- של הטמפלייט. ‏`AGENTS.md` שורה "ה-README.md הוא של הטמפלייט" תתעדכן.
- משתנים שבשימוש בקוד: `NEXT_PUBLIC_SUPABASE_URL`, ‏`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ‏`SUPABASE_SECRET_KEY`. ‏`NEXT_PUBLIC_APP_URL` לא בשימוש.
- Vercel: פרויקט `brunch-at-tals` (team brunch1). preview מוגן גם ב-Vercel Authentication.

## Tasks & Acceptance

**Execution:**
- [x] `lib/site-lock.ts` + `lib/site-lock.test.ts` -- פונקציה טהורה שמקבלת נתיב, header ו-env ומחליטה: לעבור או 401. ‏prefixes פטורים ברשימה אחת. בדיקות לכל שורות המטריצה.
- [x] `proxy.ts` -- matcher על כל הנתיבים; קודם הנעילה, ואז `updateSession` רק לנתיבים שאינם קבצים סטטיים (כמו היום).
- [x] `.env.example`, ‏`.gitignore` -- משתני הפרויקט עם הסבר ובלי ערכים (כולל `SITE_LOCKED`, ‏`SITE_LOCK_USER`, ‏`SITE_LOCK_PASSWORD`), בלי `AI_GATEWAY_API_KEY`; ‏`!.env.example`.
- [x] `supabase/seed.sql` -- seed בדוי בלבד, עם הערה שאין בו נתונים אמיתיים ושחשבונות dev נוצרים ב-`dev:reset-link`.
- [x] `scripts/dev-reset-link.mjs` -- דגל `--url <base>` שמדפיס גם קישור לכתובת preview או production.
- [x] `README.md` -- בעברית: מה הפרויקט, הרצה, פקודות (כולל `test` ו-`test:db` שנוסף ב-1.2), נעילת האתר, checklist של Auth, ‏Vault ו-Vercel לפי AD-22.
- [x] `AGENTS.md` -- עדכון שורת ה-README, שורה על הנעילה, והחלפת כלל סדר המיזוג בהחלטה החדשה.

**Acceptance Criteria:**
- Given `npm run build` ו-`next start` עם `SITE_LOCKED=true`, when `curl -I` ל-`/`, ל-`/reset/x` ול-`/api/jobs/x`, then ‏401, ‏401, ולא 401.
- Given push של ה-branch (באישור), when נכנסים ל-preview ול-production בטלפון, then מתבקשת סיסמה, והניסוי של 1.1 עובר.

## Implementation Notes

- סוכן הבנייה נעצר באמצע בגלל מגבלת שימוש. את `AGENTS.md`, את הבדיקות ואת תיקוני הסקירה השלים הסשן הראשי.
- `next start` מקומי, נעול עם פרטים זמניים: ‏`/`, ‏`/reset/x`, ‏`/login`, ‏`/_next/static/x.js`, ‏`/api/jobsx` החזירו 401. ‏`/api/jobs/x` החזיר 404, כלומר עבר את הנעילה. עם פרטים נכונים החזירו 200, ו-`/reset/x` שמר על `no-referrer` ו-`private, no-store`.
- `proxy.test.ts` מריץ את `proxy()` עצמו, עם `updateSession` מדומה.
- 2026-09-30, preview (‏`ae2a07d`): ‏`vercel curl` החזיר 401 עם `realm="brunch-at-tals"` ל-`/`, ‏`/login`, ‏`/reset/x`, ‏`/api/jobsx`, ו-404 ל-`/api/jobs/x`. בלי `SITE_LOCKED`, כלומר `VERCEL_ENV` זמין בזמן ריצה. הבדיקה בטלפון (נעילה, קישור, סיסמה, `/me`, נשארת מחוברת, "כבר שימש") עברה אצל המשתמשת.
- ב-PowerShell ‏`npm run dev:reset-link -- --url ...` נכשל, כי PowerShell מוחק את `--`. עובד: `node scripts/dev-reset-link.mjs --url ...`.
- 2026-09-30, production (‏`cda9a2b`): ‏curl החזיר 401 בכל נתיב ו-404 ל-`/api/jobs/x`, והבדיקה בטלפון עברה אצל המשתמשת. בקשת הסיסמה בדף ה-404 באה מקבצי `/_next/static` הנעולים, וזה תקין.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | אין בדיקה ל-`proxy.ts` עצמו: matcher, סדר "נעילה ואז דילוג על קבצים סטטיים", קריאת `process.env` | medium | אומת: רק `site-lock.test.ts` קיים, והוא בודק את הפונקציה הטהורה | patch: ‏`proxy.test.ts` |
| 2 | ערך עם רווח או ירידת שורה שהודבק ב-Vercel לא יתאים לעולם | low | תיקון ישיר: `trim` לערכים המוגדרים | patch |
| 3 | אין הנחיה לחוזק הסיסמה ולהחלפה, ואין הגבלת ניסיונות | medium | סיסמה משותפת אחת מגינה על האתר | patch: הנחיה ב-README וב-`.env.example` |
| 4 | שם משתמש עם `:` לא יתאים לעולם | low | ‏RFC 7617 אוסר `:` בשם | patch: הערה במסמכים |
| 5 | ‏`test:db` ב-README לא קיים | low | אומת ב-`package.json` | patch: "עוד לא קיים" |
| 6 | `--url` לא יעבוד מול production עם פרויקט Supabase נפרד | low | הטוקן נוצר בפרויקט של `.env.local` | patch: הערה בסקריפט |
| 7 | אם `VERCEL_ENV` לא זמין בזמן ריצה, production פתוח | maybe-false (medium) | Vercel חושף משתני מערכת כברירת מחדל. הבדיקה בטלפון של preview ו-production תאשר | defer |
| 8 | manifest ו-service worker ייחסמו בנעילה (הדפדפן לא שולח Basic Auth ל-manifest) | medium | אמיתי לסיפורי הפוש העתידיים. אין manifest היום | defer |
| 9 | אין אכיפה ש-`/api/jobs/` מאמת `CRON_SECRET` | low | אין עדיין נתיבים כאלה. הכלל ב-AD-22 ובקוד. E3 | reject |
| 10 | `SITE_LOCKED=1` או `yes` במחשב לא נועל | low | מתועד ש-`true` בלבד. ב-Vercel הכיוון בטוח | reject |
| 11 | סיסמה לא-ASCII בקידוד Latin-1 | low | דפדפנים שולחים UTF-8 עם `charset`. ההנחיה היא ASCII | reject |
| 12 | ‏Vault ‏`app_url` אחד לשתי סביבות | low | עתידי (E3), לפני פרויקט פרודקשן נפרד | reject |
| 13 | אין שמירה מפני נתונים אמיתיים ב-seed | low | ה-seed ריק. הכלל ב-AGENTS.md | reject |
| 14 | אין בדיקה ל-`--url` | low | כלי dev, כשל גלוי מיד בבדיקה הידנית | reject |
| 15 | הזיכרון עדיין אומר את סדר המיזוג הישן | false | עודכן בתכנון | reject |
| 16 | ‏`deferred-work.md` וה-spec חסרים ב-diff | false | הוחרגו בכוונה מקובץ הסקירה | reject |
| 17 | הפריסה והבדיקה בטלפון לא ב-diff; ‏`VERCEL_ENV` במקום `SITE_LOCKED` בלבד | false | הפריסה ממתינה לאישור. ברירת המחדל היא החלטת המשתמשת | reject |

## Design Notes

- ב-Next 16 ‏`proxy.ts` רץ ב-Node. השוואה בזמן קבוע: גיבוב SHA-256 לשני הצדדים ו-`timingSafeEqual`, כדי שאורך לא ידלוף.
- ‏401 מחזיר גוף טקסט קצר ו-`Cache-Control: no-store`.
- ‏Basic Auth נשלח אוטומטית בכל בקשה לאותו origin, כולל Server Actions. Supabase נקרא ישירות מהדפדפן ל-`supabase.co` ולא מושפע.

## Verification

**Commands:**
- `npm run lint`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run build` -- expected: עוברים.
- `next start` מקומי עם `SITE_LOCKED=true` ופרטים זמניים + `curl -I` -- expected: כמו ה-AC הראשון.

**Manual checks:**
- בטלפון, preview ו-production: סיסמה ← `dev:reset-link -- --url` ← סיסמה חדשה ← `/me` ← סגירה ופתיחה ← "כבר שימש".
