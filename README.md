<div dir="rtl">

# בראנץ׳ אצל טל

אתר שיווקי, אזור אישי ללקוחות ופאנל ניהול לעסק שמארח בראנצ׳ים לנשים בחופשת לידה, על מסד נתונים אחד. האתר בעברית, מימין לשמאל, ומותאם קודם לטלפון.

**טכנולוגיות:** Next.js ו-TypeScript, ‏Supabase (Postgres, ‏Auth, ‏Storage), ‏Vercel, ‏Web Push.

**מסמכים:** מקור האמת הוא `brunch_at_tal_charecter.md`. ה-SPEC ב-`_bmad-output/specs/spec-brunch-at-tal/`, הארכיטקטורה ב-`_bmad-output/planning-artifacts/architecture/`, ומעקב הסיפורים ב-`_bmad-output/implementation-artifacts/`. הכללים לעבודה על הקוד ב-`AGENTS.md`.

> ה-repo ציבורי עד ההשקה. אין בו נתוני לקוחות אמיתיים, תמונות אמיתיות או סודות, וגם לא יהיו.

## הרצה מקומית

1. ‏Node 24 ו-`npm install`.
2. מעתיקים את `.env.example` ל-`.env.local` וממלאים את מפתחות פרויקט ה-Supabase של הפיתוח.
3. `npm run dev`, ונכנסים ל-`http://localhost:3000`.
4. כדי להיכנס כלקוחה בדויה: `npm run dev:reset-link`. הסקריפט מדפיס קישור לבחירת סיסמה, למחשב ולטלפון שבאותה רשת.

## פקודות

| פקודה | מה היא עושה |
| --- | --- |
| `npm run dev` | שרת פיתוח |
| `npm run build` | בנייה לפרודקשן. כדאי להריץ לפני כל push |
| `npm run start` | הרצת הבנייה מקומית |
| `npm run lint` | ESLint, כולל חסימת כיוונים לא לוגיים (`ml-`, ‏`left-` וכו׳) וכללי הארכיטקטורה (ראו למטה) |
| `npm run typecheck` | בדיקת טיפוסים |
| `npm run format` | Prettier (חוץ מ-`components/ui/`) |
| `npm run format:check` | בדיקת Prettier בלי לכתוב. רץ ב-CI |
| `npm test` | בדיקות Vitest טהורות, בלי מסד ובלי `.env` (הכול חוץ מ-`supabase/tests/`) |
| `npm run test:db` | בדיקות המסד שב-`supabase/tests/`, מול פרויקט הפיתוח, קובץ אחרי קובץ. רק מקומית, ודורש `DEV_DATABASE_URL` (ראו למטה) |
| `npm run dev:reset-link` | לקוחה בדויה וקישור איפוס. עם דגלים מריצים ישירות: `node scripts/dev-reset-link.mjs --admin` לאדמין, ‏`--url https://<כתובת>` מדפיס גם קישור לפריסה. (ב-PowerShell ‏`npm run ... -- --flag` לא עובד, כי PowerShell מוחק את `--`.) |

שינוי בסכמה מתחיל תמיד ב-`npx supabase migration new <name>`. הפירוט ב-`AGENTS.md`.

### בדיקות המסד

‏`npm run test:db` מתחבר ישירות (`pg`) לפרויקט הפיתוח, דרך `DEV_DATABASE_URL` שב-`.env.local`: מחרוזת ה-Session pooler (פורט 5432) מ-Dashboard → Connect. לפני כל חיבור נבדק שהמחרוזת מכילה את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`, כדי שהבדיקות לא ירוצו אף פעם מול מסד אחר. בלי המשתנה, או עם ref אחר, הבדיקות נכשלות בהודעה ברורה ולא מתחברות.

העזרים ב-`supabase/tests/support/db.ts`: ‏`inRollback` (עסקה שתמיד מתגלגלת אחורה), ‏`asAuthenticated` (תפקיד `authenticated` ו-`auth.uid()` של משתמשת נתונה, בתוך העסקה), ‏`testName` (קידומת `test_<run-id>` לכל נתון בדוי) ו-`onCleanup` (מחיקה בסוף הקובץ).

### נתוני הדגמה

עסק בדוי במסד הפיתוח (סיפור 5.18): 15 לקוחות, מהן 14 במיילים `@demo.example.com` (אחת שילמה ועוד לא הצטרפה), שמונה מפגשים, רכישות, הרשמות, הערות ודף עבודה. הכול נוצר דרך אותן פונקציות שהמסכים משתמשים בהן. רק מול פרויקט הפיתוח, ורק נתונים בדויים. התסריט להצגה: `_bmad-output/implementation-artifacts/demo-walkthrough-5-18.md`.

סדר ההרצה:

1. **פעם אחת, ניקוי נתוני הבדיקה:** `node scripts/demo-clear.mjs --dev-test-data`. הסקריפט לא מוחק כלום. הוא רק כותב את `.dev-test-clear.local.sql` ומדפיס כמה שורות יימחקו בכל טבלה. בודקים את הקובץ ומריצים אותו ב-SQL Editor של פרויקט הפיתוח (שאילתה חדשה וריקה).
2. אם אין אדמין פיתוח: `node scripts/dev-reset-link.mjs --admin`. אם אין תמונות בגלריה: `npm run dev:seed-media`.
3. `npm run demo:seed`, בין 06:10 ל-23:30 ולא בשבת, כי מפגש ההדגמה של היום מסתיים כמה דקות אחרי ההרצה. הסקריפט שומר את המזהים ב-`.demo-data.local.json` (לא ב-git). הרצה חוזרת לא מוסיפה כלום. בלי הקובץ הסקריפט לא ממשיך, אז לא מוחקים אותו.
4. **סיסמה למבקרים:** `node scripts/dev-reset-link.mjs --email maya.barak@demo.example.com --url https://<כתובת ה-Vercel>`. פותחים את הקישור, בוחרים סיסמה, ומוסרים למבקרים את המייל, את הסיסמה ואת פרטי נעילת האתר. לכניסת אדמין עושים אותו דבר עם `--admin`.

הסרת ההדגמה: `npm run demo:clear`. גם הוא רק כותב קובץ (`.demo-clear.local.sql`), שמריצים ב-SQL Editor. אחרי זה `demo:seed` מתחיל מחדש עם תאריכים חדשים.

## CI וכללי lint

‏GitHub Actions (`.github/workflows/ci.yml`) רץ על כל push ועל כל PR, מ-checkout נקי, בלי `.env`, בלי סודות ובלי מסד: ‏`npm ci`, ‏`npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test` ו-`npm audit --omit=dev --audit-level=high`. בדיקות המסד (`npm run test:db`) רצות רק מקומית.

כללי ה-lint שמעבר ל-Next (ב-`eslint.config.mjs`, ונבדקים ב-`test/eslint-rules.test.ts`):

- קובץ `"use client"` לא מייבא שום דבר מ-`lib/server/`.
- ‏`lib/server/privileged/` (לקוח ה-service role) מיובא רק מתוכו, מ-`app/**/actions.ts`, מ-`app/api/**` ומדף ה-`page.tsx` של `/reset/[token]` ושל `/join/[token]`.
- כתיבה ישירה לטבלה (`.from(...).insert/update/delete/upsert`) מותרת רק ל-`profiles` ול-`babies`. כל השאר עובר דרך RPC. קובצי בדיקה פטורים.
- אין `parseFloat` ב-`lib/money.ts`, כי כסף נשמר באגורות שלמות.
- כיוונים לוגיים בלבד בכל מקום חוץ מ-`components/ui/`.

## נעילת האתר עד תחילת E5

עד תחילת E5 כל האתר נעול בסיסמה (HTTP Basic Auth), כולל קבצים סטטיים. הנעילה מוסרת בסיפור 5.15, אחרי שתהיה הגבלת קצב (2.8). עד ההשקה עצמה האתר נשאר מחוץ למנועי החיפוש (noindex). הנעילה ב-`proxy.ts`, וההחלטה ב-`lib/site-lock.ts`.

- **ב-Vercel** (production ו-preview) האתר נעול תמיד, אלא אם מגדירים `SITE_LOCKED=false`.
- **במחשב המקומי** הוא נעול רק כש-`SITE_LOCKED=true`.
- שם המשתמש והסיסמה ב-`SITE_LOCK_USER` וב-`SITE_LOCK_PASSWORD`, משתני שרת בלבד. אם הנעילה פעילה ואחד מהם חסר, אף אחד לא נכנס. שם המשתמש בלי נקודתיים (`:`), והסיסמה אקראית, 20 תווים לפחות, באנגלית, ספרות וסימנים. אין הגבלה על מספר הניסיונות, ולכן הסיסמה צריכה להיות חזקה. כדי להחליף אותה משנים את המשתנה ב-Vercel ופורסים מחדש.
- נתיבים תחת `/api/jobs/` פטורים מהנעילה, כי שירות התזמון קורא להם. כל נתיב כזה חייב לאמת `CRON_SECRET` בעצמו.
- פתיחת האתר בהשקה: `SITE_LOCKED=false` ב-production, ופריסה מחדש.
- **התקנה באתר נעול (סיפור 5.9):** ‏`/manifest.webmanifest` ו-`/icons/` פטורים (`SITE_LOCK_PUBLIC_FILES`), כי הדפדפן מבקש אותם בלי סיסמה. כניסה מוצלחת נשמרת בעוגיית `site_lock` ל-30 יום, והחלפת שם המשתמש או הסיסמה מבטלת אותה. דף הנעילה מכיל גם טופס (`POST /site-lock`, מטופל ב-`proxy.ts`), כי אפליקציה מותקנת באייפון לא מציגה את חלון הסיסמה.

## בדיקת ההתקנה בטלפון (PWA)

‏Service worker והתקנה עובדים רק ב-HTTPS, ולכן לא מכתובת הרשת הביתית (192.168…). ה-SW נרשם רק ב-production build.

- **אנדרואיד:** ב-preview של ה-branch (Chrome). אחרי סיסמת הנעילה פותחים את `/install`, מתקינים ופותחים מהאייקון.
- **אייפון:** ב-production. ה-preview מוגן גם ב-Vercel Authentication, ואפליקציה מותקנת באייפון לא מקבלת את העוגייה שלו. ב-Safari פותחים את `/install`, ואז שיתוף ← "הוספה למסך הבית". בפתיחה הראשונה מהאייקון ממלאים את טופס הנעילה.
- **אופליין:** ‏מצב טיסה ← ניווט לדף אחר ← מוצג "אין חיבור".
- **אין מידע אישי במטמון:** ב-Chrome במחשב, ‏DevTools ← Application ← Cache Storage ← `brunch-v…` (‏`VERSION` שב-`public/sw.js`). יש בו רק `/offline`, ‏`/_next/static/…` ו-`/icons/…`, גם אחרי ניווט ב-`/me` וב-`/admin`.
- כשמשנים את `/offline`, את האייקונים או את התנהגות ה-SW, מעלים את `VERSION` ב-`public/sw.js`. האייקונים נשמרים במטמון בשמות קבועים, ובלי העלאת הגרסה יישארו הישנים.

## Checklist לכל סביבה (AD-22)

ההגדרות האלה לא נשמרות ב-migration, ולכן בודקים אותן ידנית בכל פרויקט Supabase ובכל סביבת Vercel.

### Supabase Auth

- [ ] הרשמה ציבורית כבויה (Authentication → Sign In / Providers → Allow new users to sign up). גם ב-`supabase/config.toml`.
- [ ] ‏Confirm email כבוי.
- [ ] ‏Site URL ו-Redirect URLs לכתובת של הסביבה (localhost, ‏preview, ‏production).
- [ ] "Automatically expose new tables" כבוי (גם בפיתוח).
- [ ] ‏pg_graphql לא מופעל.
- [ ] מפתח `sb_secret_` עובד (למשל `npm run dev:reset-link` מצליח).

### Supabase Vault

- [ ] ‏`app_url`: הכתובת הקבועה של האתר (בפרויקט הפיתוח: כתובת ה-production ב-Vercel, בלי `/` בסוף). ‏pg_cron קורא כל דקה ל-`<app_url>/api/jobs/push` כשיש התראת פוש שמחכה (סיפור 5.8).
- [ ] ‏`cron_secret`: אותו ערך כמו `CRON_SECRET` ב-Vercel.
- [ ] יוצרים אותם ב-SQL Editor (לא ב-migration ולא בקובץ ב-repo): `select vault.create_secret('<value>', 'app_url');` ו-`select vault.create_secret('<value>', 'cron_secret');`. בלי שניהם ה-cron רץ ולא שולח שום בקשה.

### Vercel (Settings → Environment Variables, לכל סביבה)

- [ ] ‏`NEXT_PUBLIC_SUPABASE_URL`, ‏`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ‏`SUPABASE_SECRET_KEY`.
- [ ] ‏`SITE_LOCK_USER` ו-`SITE_LOCK_PASSWORD` (ו-`SITE_LOCKED` רק כשפותחים את האתר).
- [ ] ‏`CRON_SECRET`: ערך אקראי ארוך (למשל `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), זהה ל-`cron_secret` ב-Vault. בלעדיו `/api/jobs/push` מחזיר 503.
- [ ] זוג VAPID (`npx web-push generate-vapid-keys`), אחד לכל פרויקט Supabase: ‏`NEXT_PUBLIC_VAPID_PUBLIC_KEY` (היחיד שמגיע לדפדפן), ‏`VAPID_PRIVATE_KEY` ו-`VAPID_SUBJECT` (‏`mailto:` של העסק; ערך שגוי ← Apple מחזירה 403). ב-production וב-preview, ובמחשב ב-`.env.local`. אחרי שינוי של המפתח הציבורי פורסים מחדש (הוא נכנס לקוד בזמן ה-build).
- [ ] אף סוד לא במשתנה `NEXT_PUBLIC_*`.
- [ ] לא לכבות את "Automatically expose System Environment Variables", כי הנעילה מזהה שהיא רצה ב-Vercel לפי `VERCEL_ENV`.

## סביבות

היום יש פרויקט Supabase אחד, לפיתוח, עם נתונים בדויים בלבד. ‏Vercel production ו-preview מחוברים אליו. לפני ההשקה יוקם פרויקט פרודקשן נפרד, שיקבל את אותם קובצי migration ‏(`supabase db push`), עם Vault, זוג VAPID ו-`CRON_SECRET` משלו.

פריסה: push ל-`main` פורס ל-production, ו-push לכל branch אחר יוצר preview.

</div>
