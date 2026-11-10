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
| `npm run build` | בנייה לפרודקשן. כדאי להריץ לפני כל push. דורש `.env.local`: בלי הגדרות Supabase הבנייה נכשלת ב-prerender של העמודים הציבוריים. החלטת המשתמשת (2026-10-10): הגדרה חסרה נכשלת בקול ולא מציגה אתר ריק |
| `npm run start` | הרצת הבנייה מקומית |
| `npm run lint` | ESLint, כולל חסימת כיוונים לא לוגיים (`ml-`, ‏`left-` וכו׳) וכללי הארכיטקטורה (ראו למטה) |
| `npm run typecheck` | בדיקת טיפוסים |
| `npm run format` | Prettier (חוץ מ-`components/ui/`) |
| `npm run format:check` | בדיקת Prettier בלי לכתוב. רץ ב-CI |
| `npm test` | בדיקות Vitest טהורות, בלי מסד ובלי `.env` (הכול חוץ מ-`supabase/tests/`) |
| `npm run test:db` | בדיקות המסד שב-`supabase/tests/`, מול פרויקט הפיתוח, קובץ אחרי קובץ. רק מקומית, ודורש `DEV_DATABASE_URL` (ראו למטה) |
| `npm run prod:grants` | ההרשאות (`describe("grants")` של `grants.test.ts`) מול פרויקט הפרודקשן, בחיבור לקריאה בלבד. דורש `.env.prod.local` (ראו "פרודקשן") |
| `npm run dev:reset-link` | לקוחה בדויה וקישור איפוס. עם דגלים מריצים ישירות: `node scripts/dev-reset-link.mjs --admin` לאדמין, ‏`--url https://<כתובת>` מדפיס גם קישור לפריסה. (ב-PowerShell ‏`npm run ... -- --flag` לא עובד, כי PowerShell מוחק את `--`.) |

שינוי בסכמה מתחיל תמיד ב-`npx supabase migration new <name>`. הפירוט ב-`AGENTS.md`.

### בדיקות המסד

‏`npm run test:db` מתחבר ישירות (`pg`) לפרויקט הפיתוח, דרך `DEV_DATABASE_URL` שב-`.env.local`: מחרוזת ה-Session pooler (פורט 5432) מ-Dashboard → Connect. לפני כל חיבור נבדק שהמחרוזת מכילה את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`, כדי שהבדיקות לא ירוצו אף פעם מול מסד אחר. בלי המשתנה, או עם ref אחר, הבדיקות נכשלות בהודעה ברורה ולא מתחברות.

העזרים ב-`supabase/tests/support/db.ts`: ‏`inRollback` (עסקה שתמיד מתגלגלת אחורה), ‏`asAuthenticated` (תפקיד `authenticated` ו-`auth.uid()` של משתמשת נתונה, בתוך העסקה), ‏`testName` (קידומת `test_<run-id>` לכל נתון בדוי) ו-`onCleanup` (מחיקה בסוף הקובץ).

### נתונים לסרטוני ההסבר

עולם בדוי במסד הפיתוח לצילום סרטוני ההסבר (סיפור 5.22): כ-30 לקוחות במיילים `@video.example.com` וטלפונים `03-00002NN`, 16 מפגשים (שמונה קרובים בימי שני וחמישי, שני שישי זוגיים, והיסטוריה), רכישות, הרשמות, ביטולים, זיכויים, החזרים, רשימת המתנה, קישורים בכל המצבים, הערות, לוח רשימות ודף עבודה. התאריכים מחושבים מיום ההרצה (שעון ישראל). הכול נוצר דרך אותן פונקציות שהמסכים משתמשים בהן, כאדמין צילום נפרדת (`admin@video.example.com`) וכלקוחות עצמן. רק מול פרויקט הפיתוח, ורק נתונים בדויים. מדריך הצילום: `_bmad-output/implementation-artifacts/video-filming-guide-5-22.md`.

**לפני כל יום צילום: קודם `npm run video:clear`, ואז `npm run video:seed`.** העולם תקף ליום שבו נבנה. ביום אחר ה-seed עוצר ומבקש לנקות קודם.

- **הכנה:** `VIDEO_LOGIN_PASSWORD` (לפחות 8 תווים) היא הסיסמה של כניסות הצילום. מעבירים אותה כמשתנה סביבה בפקודה עצמה (ב-PowerShell: `$env:VIDEO_LOGIN_PASSWORD='...'; npm run video:seed`), ולא כותבים אותה לקובץ. אם אין אדמין פיתוח: `node scripts/dev-reset-link.mjs --admin`. אם אין תמונות בגלריה: `npm run dev:seed-media`.
- **`npm run video:seed`:** בודק את הפרויקט, את אדמין הפיתוח, את הסיסמה ואת כללי הקאסט לפני כל כתיבה. הרצה שנייה באותו יום לא מוסיפה כלום ("כבר קיים"), וממשיכה מאותה נקודה אחרי קריסה. אין קובץ מקומי: העולם מזוהה במסד לפי דומיין המייל ולפי השורות של אדמין הצילום.
- **בזמן ההרצה** מפגשי ההיסטוריה עומדים כמה דקות על תאריכים קרובים, ונראים ב-`/sessions`, עד שהם מוזזים לאחור בסוף. אם ה-seed נעצר באמצע, הם נשארים שם עד `video:clear`.
- **`npm run video:clear`:** סופר כמה שורות יימחקו בכל טבלה, עוצר אם המחיקה נוגעת בחשבונות הפיתוח, בשורות `test_` או בלקוחה שאינה מהעולם, ומבקש `y`. הוא מוחק גם את מה שנעשה בזמן הצילום (רכישות, הרשמות, פתקים, הערות, שינויי פרטים). `node scripts/video-clear.mjs --dry-run` רק סופר. שינויים בהגדרות, בתוכן, במוצרים ובקונספטים לא נמחקים, ולכן מצלמים אותם בלי לשמור, או שומרים ומחזירים ידנית.
- **כניסות הצילום** (הסיסמה מ-`VIDEO_LOGIN_PASSWORD`): טל (אדמין) `admin@video.example.com`; מיכל אהרוני `michal.aharoni@video.example.com`; נטע ברגר `neta.berger@video.example.com`; סיוון אשכנזי `sivan.ashkenazi@video.example.com`. לדמות אחרת: `node scripts/dev-reset-link.mjs --email <מייל>@video.example.com --url https://<כתובת ה-Vercel>`.

#### ניקוי נתוני הבדיקה

1. **ניקוי נתוני הבדיקה:** `node scripts/dev-clean-test-data.mjs`. בלי דגל זו הרצה יבשה: הסקריפט רק מדפיס כמה שורות של נתוני `test_` יימחקו בכל טבלה, ועוצר אם רשומה מוגנת (לקוחה בדויה, אדמין) בתוכנית. רק אחרי שבודקים את התוכנית מריצים `node scripts/dev-clean-test-data.mjs --apply` (מסמך התיקונים, תיקון 8).
2. אם אין אדמין פיתוח: `node scripts/dev-reset-link.mjs --admin`. אם אין תמונות בגלריה: `npm run dev:seed-media`.

## CI וכללי lint

‏GitHub Actions (`.github/workflows/ci.yml`) רץ על כל push ועל כל PR, מ-checkout נקי, בלי `.env`, בלי סודות ובלי מסד: ‏`npm ci`, ‏`npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test` ו-`npm audit --omit=dev --audit-level=high`. בדיקות המסד (`npm run test:db`) רצות רק מקומית.

כללי ה-lint שמעבר ל-Next (ב-`eslint.config.mjs`, ונבדקים ב-`test/eslint-rules.test.ts`):

- קובץ `"use client"` לא מייבא שום דבר מ-`lib/server/`.
- ‏`lib/server/privileged/` (לקוח ה-service role) מיובא רק מתוכו, מ-`app/**/actions.ts`, מ-`app/api/**` ומדף ה-`page.tsx` של `/reset/[token]` ושל `/join/[token]`.
- כתיבה ישירה לטבלה (`.from(...).insert/update/delete/upsert`) מותרת רק ל-`profiles` ול-`babies`. כל השאר עובר דרך RPC. קובצי בדיקה פטורים.
- אין `parseFloat` ב-`lib/money.ts`, כי כסף נשמר באגורות שלמות.
- כיוונים לוגיים בלבד בכל מקום חוץ מ-`components/ui/`.

## נעילת האתר

כל האתר נעול בסיסמה (HTTP Basic Auth), כולל קבצים סטטיים, ב-production וב-preview, עד הפתיחה (6.9). עד אז האתר גם מחוץ למנועי החיפוש (noindex). הנעילה ב-`proxy.ts`, וההחלטה ב-`lib/site-lock.ts`.

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
- [ ] כניסה אנונימית כבויה (Authentication → Sign In / Providers → Allow anonymous sign-ins). גם ב-`supabase/config.toml`.
- [ ] ‏Confirm email כבוי.
- [ ] ‏Site URL ו-Redirect URLs לכתובת של הסביבה (localhost, ‏preview, ‏production).
- [ ] "Automatically expose new tables" כבוי (גם בפיתוח).
- [ ] ‏pg_graphql לא מופעל.
- [ ] ‏Data API (Project Settings → Data API → Exposed schemas): רק `public`. בלי `graphql_public`, ‏`private` או `net`.
- [ ] אורך סיסמה מינימלי (Authentication → Sign In / Providers → Email → Minimum password length) זהה בכל הפרויקטים.
- [ ] מפתח `sb_secret_` עובד (למשל `npm run dev:reset-link` מצליח).
- [ ] שם התצוגה של המנהלת מוגדר פעם אחת כ-`full_name` במטא-דאטה של משתמש ה-Auth שלה (`raw_user_meta_data`). הברכה בבית האדמין משתמשת בו.

### Supabase Vault

- [ ] ‏`app_url`: בפרודקשן `https://brunch-at-tals.vercel.app` (בלי `/` בסוף; אחרי חיבור הדומיין, הדומיין). ‏pg_cron קורא כל דקה ל-`<app_url>/api/jobs/push` כשיש התראת פוש שמחכה (סיפור 5.8).
- [ ] ‏`cron_secret`: בפרודקשן אותו ערך כמו `CRON_SECRET` של Vercel Production.
- [ ] יוצרים אותם ב-SQL Editor (לא ב-migration ולא בקובץ ב-repo): `select vault.create_secret('<value>', 'app_url');` ו-`select vault.create_secret('<value>', 'cron_secret');`. בלי שניהם ה-cron רץ ולא שולח שום בקשה.
- [ ] **בפרויקט הפיתוח שניהם ריקים** מאז המעבר לפרודקשן (6.1), כדי שה-cron של הפיתוח לא יקרא לאתר החי (ולא יקבל 401): `select vault.update_secret(id, '') from vault.secrets where name in ('app_url', 'cron_secret');` ב-SQL Editor של הפיתוח (אם Vault לא מקבל ערך ריק: `delete from vault.secrets where name in ('app_url', 'cron_secret');`, והתוצאה זהה). "לטיפול" בפיתוח מציג אז "ערכי Vault חסרים", וזה צפוי.

### משימות מתוזמנות (pg_cron)

- [ ] ב-`cron.job` יש את כל המשימות שב-`private.job_intervals()`: ‏`reminders`, ‏`invoke_push_worker`, ‏`complete_events`, ‏`refresh_credit_options`, ‏`marketing_reminders`, ‏`expiry_alerts`, ‏`auto_extend`, ‏`cleanup`, שמונה משימות (סיפורים 5.10 ו-5.11). משימה שחסרה, שנכשלה או שלא הצליחה בזמן של פי 3 מהתדירות שלה מופיעה ב"לטיפול", וגם ערכי Vault חסרים ופוש שממתין יותר מ-15 דקות.
- [ ] **השהיית פרויקט Free:** פרויקט חינמי מושהה אחרי כ-7 ימים בלי פעילות API, וכנראה ש-pg_cron שרץ בתוך המסד לא נחשב. האתר הנעול כמעט בלי תנועה, ולכן זה צפוי בפרודקשן עד השדרוג במסירה (id 10). בהשהיה כל המשימות נעצרות (תזכורות, תפוגה, הארכה אוטומטית, פוש). הסימנים: האתר החי מציג שגיאות, סקריפטי `prod-*` עוצרים ב"הפרויקט מושהה או לא זמין", וב-Dashboard כתוב Paused. התיקון: Dashboard ← Restore (כמה דקות, הנתונים נשמרים). בודקים לפני 6.4 ולפני 6.8.

### Vercel (Settings → Environment Variables, לכל סביבה)

- [ ] ‏`NEXT_PUBLIC_SUPABASE_URL`, ‏`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ‏`SUPABASE_SECRET_KEY`.
- [ ] ‏`SITE_LOCK_USER` ו-`SITE_LOCK_PASSWORD` (ו-`SITE_LOCKED` רק כשפותחים את האתר).
- [ ] ‏`CRON_SECRET`: ערך אקראי ארוך (למשל `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), זהה ל-`cron_secret` ב-Vault. בלעדיו `/api/jobs/push` מחזיר 503.
- [ ] זוג VAPID (`npx web-push generate-vapid-keys`), אחד לכל פרויקט Supabase: ‏`NEXT_PUBLIC_VAPID_PUBLIC_KEY` (היחיד שמגיע לדפדפן), ‏`VAPID_PRIVATE_KEY` ו-`VAPID_SUBJECT` (‏`mailto:` של העסק; ערך שגוי ← Apple מחזירה 403). ב-production זוג של פרויקט הפרודקשן ו-`VAPID_SUBJECT` = ‏`mailto:` המייל של בעלת העסק, שמוקלד רק ב-Vercel; ב-preview ובמחשב (`.env.local`) הזוג של הפיתוח. אחרי שינוי של המפתח הציבורי פורסים מחדש (הוא נכנס לקוד בזמן ה-build).
- [ ] ‏`SITE_INDEXABLE` (משתנה שרת): ריק או `false` עד 6.9. ‏`true` פותח את האתר למנועי חיפוש רק ב-production (ב-preview אף פעם): ‏robots.txt מתיר, מפת האתר מופיעה, וה-`noindex` נשאר רק על האזור האישי, האדמין, ההתחברות, נתיבי הטוקן, ‏`/offline`, ‏`/install` ו-`/api`. נקרא בזמן ה-build, ולכן אחרי שינוי פורסים מחדש. לא קשור לנעילה (`SITE_LOCKED`). לפני שמפעילים אותו, ממלאים את `NEXT_PUBLIC_SITE_URL` בדומיין הסופי, אחרת ה-canonical ומפת האתר מצביעים על כתובת ה-vercel.app.
- [ ] ‏`NEXT_PUBLIC_SITE_URL`: הדומיין הסופי, בלי `/` בסוף, בהעברה. ריק: הכתובת של production ב-Vercel. אחרי שינוי פורסים מחדש.
- [ ] אף סוד לא במשתנה `NEXT_PUBLIC_*`.
- [ ] לא לכבות את "Automatically expose System Environment Variables", כי הנעילה מזהה שהיא רצה ב-Vercel לפי `VERCEL_ENV`.

## סביבות

שני פרויקטי Supabase, מאז 6.1:

| פרויקט | ארגון | מה יש בו | מי מחובר אליו |
| --- | --- | --- | --- |
| פיתוח | הארגון החינמי הקיים | נתונים בדויים בלבד (לקוחות, מפגשים, נתוני הסרטונים), והתוכן האמיתי של האתר שנערך בו עד 6.1 | ‏`.env.local`, ‏MCP של Supabase, ‏`npm run test:db`, ‏Vercel **Preview** |
| פרודקשן | ארגון חינמי חדש של העסק | התוכן האמיתי, המוצרים וההגדרות שהועתקו מהפיתוח, וחשבונות האדמין האמיתיים. אף פעם לא נתונים בדויים | ‏`.env.prod.local` (רק סקריפטי `prod-*`), ‏Vercel **Production** |

- פריסה: push ל-`main` פורס ל-production (מסד הפרודקשן), ו-push לכל branch אחר יוצר preview (מסד הפיתוח).
- ‏MCP של Supabase ו-`.env.local` נשארים על הפיתוח בלבד. לפרודקשן אין `execute_sql`, ‏`apply_migration` או קריאת MCP. שינוי בפרודקשן עובר רק דרך הסקריפטים שלמטה, ה-Dashboard או ה-SQL Editor שלו, ורק באישור המשתמשת.
- מסד הפיתוח נשאר תמיד. אחרי המסירה הוא מושהה, לא נמחק.

### פרודקשן: `.env.prod.local` וסקריפטי `prod-*`

‏`.env.prod.local` בשורש התיקייה שממנה מריצים (התיקייה הראשית או ה-worktree), עם ארבעה משתני חובה: ‏`PROD_SUPABASE_URL`, ‏`PROD_SUPABASE_PUBLISHABLE_KEY`, ‏`PROD_SUPABASE_SECRET_KEY` (‏`sb_secret_`) ו-`PROD_DATABASE_URL` (‏Connect → Session pooler, פורט 5432, עם סיסמת המסד; תו מיוחד בסיסמה מקודד, למשל `@` כ-`%40`). שורה חמישית, `PROD_CRON_SECRET`, נוספת אחרי צעד 6: אותו ערך כמו `CRON_SECRET` של Vercel Production וכמו `cron_secret` ב-Vault. רק `prod-check` קורא אותה, כדי לוודא את שרשרת הפוש, ובלעדיה שלוש השורות שלה ✗. הקובץ לא נכנס ל-git (‏`.env*` ב-`.gitignore`), ו-Next.js לא טוען קובץ בשם הזה. המשתמשת יוצרת וממלאת אותו; אף אחד לא מדפיס או מעתיק ממנו.

כל סקריפט `prod-*` (ב-`scripts/`, השומר המשותף ב-`prod-env.mjs`) בודק לפני כל חיבור: שהקובץ קיים ומלא, ש-`PROD_DATABASE_URL` מכיל את ה-ref של `PROD_SUPABASE_URL`, ושה-ref הזה שונה מה-ref של הפיתוח (`NEXT_PUBLIC_SUPABASE_URL` ב-`.env.local`). אחרת הוא עוצר בהודעה, בלי להתחבר. הם לא מדפיסים סוד, מחרוזת חיבור, מייל או טוקן (חוץ מהקישור החד-פעמי של `prod-admin`). סקריפט שכותב רץ יבש כברירת מחדל, וכותב רק עם `--apply`, ורק אחרי אישור מפורש של המשתמשת לאותו צעד. פרויקט מושהה: "הפרויקט מושהה או לא זמין: Dashboard ← Restore".

| פקודה | מה היא עושה |
| --- | --- |
| `node scripts/prod-migrate.mjs --rehearse` | חזרה: כל קובצי המיגרציה לפי הסדר בעסקה אחת, ואז ROLLBACK. רק על מסד ריק. מדפיס "OK" ומספר הקבצים, או את הקובץ הראשון שנכשל ו-SQLSTATE |
| `node scripts/prod-migrate.mjs` / `--apply` | ‏`supabase db push --dry-run` / הרצה אמיתית (קודם יבשה, אחר כך קובץ אחרי קובץ, כל קובץ בעסקה משלו), ואז השוואה של `schema_migrations` לקבצים |
| `node scripts/prod-copy-content.mjs` / `--apply` | העתקת התוכן וההגדרות מהפיתוח (פירוט למטה) |
| `node scripts/prod-admin.mjs --email <מייל> --name-file <קובץ>` / `--apply` | אדמין בפרודקשן וקישור חד-פעמי לבחירת סיסמה |
| `node scripts/prod-check.mjs` | הבדיקות של הפרודקשן, לקריאה בלבד: שורה לכל בדיקה, ✓ או ✗. כולל הגדרות Auth (`/auth/v1/settings`), ‏pg_graphql, ‏RLS בכל טבלה, ‏Vault מול `PROD_CRON_SECRET` (השוואת sha256, בלי להדפיס), ו-`POST /api/jobs/push` עם `PROD_CRON_SECRET` (מריץ את ה-worker פעם אחת, כמו ה-cron) |
| `npm run prod:grants` | בדיקת ההרשאות מול הפרודקשן, לקריאה בלבד |
| `node scripts/prod-auth-guard-check.mjs` / `--apply` | בדיקת ה-trigger על `auth.users` מול ה-Auth האמיתי: משתמשת זמנית, שינוי מייל וטלפון עצמי ושינוי מייל באדמין נחסמים, והמשתמשת נמחקת |

**מה ההעתקה מעתיקה:** ‏`content_pages`, ‏`content_sections` (‏`draft_content` ו-`published_content_full`; ה-trigger גוזר את `published_content`), כל תמונה שתוכן או קונספט מזכירים (גם מוסתרים, וגם שרשרת `source_id`) עם הקבצים שלה, ‏`concepts`, ‏`products`, ‏`payment_methods`, ‏`marketing_reminder_texts`, ‏`notification_templates` (כותרת, גוף, פוש) ו-`business_settings` (העמודות שנערכות). ‏`updated_by` / ‏`created_by` מתאפסים. **לא מעתיקה:** מפגשים, לקוחות, הרשמות, תשלומים, זכויות, זיכויים, רשימת המתנה, התראות, יומן, טוקנים, פתקים, דפי עבודה, מנויי פוש ומזהי השיווק (`marketing_tags` נשאר ריק). היא מסרבת לרוץ אם בפרודקשן יש לקוחה, מפגש, תשלום, זכות או הרשמה, או אם שורה שמועתקת היא נתון `test_` או מזכירה `video.example.com`. הרצה חוזרת מגיעה לאותו מצב ולא מעלה קובץ שכבר קיים.

### הקמת הפרודקשן, צעד אחר צעד (6.1)

כל צעד שכותב לפרודקשן רק אחרי אישור המשתמשת.

1. **ארגון ופרויקט:** ב-Supabase ארגון חדש בתוכנית החינמית (Free), לעסק בלבד, ובו פרויקט באותו אזור כמו הפיתוח. סיסמת המסד נשמרת במנהל הסיסמאות. (בתוכנית החינמית שני פרויקטים פעילים לכל משתמשת; אין עוד פרויקט פעיל מלבד הפיתוח, נבדק 2026-11-10.)
2. **`.env.prod.local`** עם ארבעת משתני החובה (למעלה). את השורה החמישית, `PROD_CRON_SECRET`, מוסיפים בצעד 6.
3. **חזרה:** `node scripts/prod-migrate.mjs --rehearse`, צריך "OK" ו-132 קבצים (או המספר הנוכחי). אם החזרה נכשלת בגלל משהו שקיים רק בעסקה אחת גדולה (פקודה שאסורה בתוך עסקה, ערך enum שנוסף ונעשה בו שימוש באותה עסקה), לא רודפים אחריו: ה-push של צעד 4 הוא ההרצה האמיתית, קובץ אחרי קובץ. במקרה הגרוע מוחקים את הפרויקט הריק ויוצרים אותו מחדש.
4. **מיגרציות:** `node scripts/prod-migrate.mjs` (יבש), ואז `node scripts/prod-migrate.mjs --apply`. בסוף צריך "✓ schema_migrations תואם לקבצים".
5. **Dashboard של הפרודקשן:** כל הסעיפים של "Supabase Auth" ב-checklist למעלה: הרשמה ציבורית כבויה, כניסה אנונימית כבויה, Confirm email כבוי, ‏Site URL = `https://brunch-at-tals.vercel.app` ו-Redirect URLs = `https://brunch-at-tals.vercel.app/**`, אורך סיסמה מינימלי כמו בפיתוח; ‏Data API עם `public` בלבד; ‏pg_graphql כבוי (Database → Extensions); "Automatically expose new tables" כבוי.
6. **סודות חדשים, בטרמינל של המשתמשת** (נשמרים במנהל הסיסמאות, לא בקובץ): ‏`CRON_SECRET` חדש (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) וזוג VAPID חדש (`npx web-push generate-vapid-keys`). את `CRON_SECRET` מוסיפים גם כשורה חמישית ב-`.env.prod.local`: `PROD_CRON_SECRET=<אותו ערך>`. ב-SQL Editor של הפרודקשן: `select vault.create_secret('https://brunch-at-tals.vercel.app', 'app_url');` ו-`select vault.create_secret('<CRON_SECRET>', 'cron_secret');`.
7. **אדמינים:** ‏`prod-admin` לטל ולמשתמשת (ראו "הוספת אדמין").
8. **התוכן:** `node scripts/prod-copy-content.mjs` (יבש: כמה שורות יתווספו, יעודכנו וימחקו בכל טבלה, וכמה קבצים יועלו), ואז `--apply`.
9. **Vercel:** ב-Production בלבד מחליפים את `NEXT_PUBLIC_SUPABASE_URL`, ‏`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ‏`SUPABASE_SECRET_KEY`, ‏`CRON_SECRET`, ‏`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, ‏`VAPID_PRIVATE_KEY` ו-`VAPID_SUBJECT` (‏`mailto:` המייל של בעלת העסק, מוקלד רק ב-Vercel). משתני Preview נשארים על הפיתוח. ‏`SITE_LOCKED`, ‏`SITE_LOCK_USER` ו-`SITE_LOCK_PASSWORD` לא משתנים (האתר נשאר נעול, עם noindex). אחר כך Redeploy ל-production.
10. **Vault של הפיתוח:** מרוקנים את `app_url` ואת `cron_secret` (הפקודה ב-checklist של Vault למעלה).
11. **בדיקות:** `node scripts/prod-check.mjs` (כל השורות ✓); `npm run prod:grants`; `node scripts/prod-auth-guard-check.mjs --apply`; ב-Dashboard של הפרודקשן Security Advisor מציג רק את האזהרות המאושרות (`0029`, ‏leaked password protection); בדפדפן: כניסת אדמין, האתר החי (עם פרטי הנעילה) מציג את התוכן שהועתק, `/sessions` בלי מפגשים, הכותרת `X-Robots-Tag: noindex`; ‏9 סיסמאות שגויות לכתובת שלא קיימת (אף פעם לא המייל של טל או של המשתמשת) ב-`/login` וב-`/admin/login`, והתשיעית מציגה את הודעת `TOO_MANY_ATTEMPTS`; ב-MCP של הפיתוח `net._http_response` בלי 401 מאז המעבר.

הקישור של טל נשלח אליה יחד עם פרטי הנעילה (האתר נעול).

### הוספת אדמין

אדמין היא שורה ב-`admin_roles`. בפרודקשן:

1. כותבים את השם המלא בשורה הראשונה של קובץ טקסט (UTF-8, בעורך, למשל `name.txt` מחוץ ל-repo), כי שם בעברית שעובר בשורת הפקודה של PowerShell או Bash עלול להשתבש. אחר כך `node scripts/prod-admin.mjs --email <מייל> --name-file <נתיב הקובץ>` (יבש: מדפיס את אורך השם שיישמר ואומר אם המשתמשת קיימת). `--name "<שם>"` עובד לשם באנגלית.
2. אחרי אישור: אותה פקודה עם `--apply`. נוצרת משתמשת Auth בלי סיסמה ועם מייל מאושר (או נמצאת הקיימת), השם נשמר כ-`full_name` (הברכה בבית האדמין), נוספת השורה ב-`admin_roles`, ‏(משתמשת שיש לה פרופיל של לקוחה נדחית: לקוחה לא הופכת לאדמין), ומודפס קישור `https://brunch-at-tals.vercel.app/reset/<token>` לבחירת סיסמה, בתוקף 48 שעות. הרצה חוזרת משתמשת באותה משתמשת ומבטלת את הקישור הקודם.
3. בעלת החשבון בוחרת סיסמה בקישור ונכנסת ב-`/admin/login`. אף אחד אחר לא מבקש או מקבל את הסיסמה שלה.

המייל מגיע מהמשתמשת בשיחה ועובר רק בשורת הפקודה: לא בקובץ ב-repo, לא ב-spec, לא ב-commit ולא ב-PR. בפיתוח האדמין הבדויה נוצרת ב-`node scripts/dev-reset-link.mjs --admin`.

### שרת התרגול של טל (6.4)

התרגול על המחשב של המשתמשת, מול **מסד הפיתוח** ועם נתונים בדויים בלבד, אף פעם לא בפרודקשן:

1. `npm run dev` בתיקייה הראשית (`.env.local` של הפיתוח), ונכנסים ל-`http://localhost:3000/admin/login`.
2. אדמין בדויה: `dev-admin@example.com`, עם קישור מ-`node scripts/dev-reset-link.mjs --admin`. או כניסת הצילום של טל, `admin@video.example.com`, עם הסיסמה מ-`VIDEO_LOGIN_PASSWORD` (ראו "נתונים לסרטוני ההסבר"), כדי לתרגל על העולם של הסרטונים.
3. בטלפון ברשת הביתית (הכתובת שהשרת מדפיס) אין פוש ואין התקנה, כי זה http.
4. בזמן התרגול לא מריצים `npm run test:db`, ולא מאפסים את נתוני הסרטונים.

</div>
