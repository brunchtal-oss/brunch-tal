---
type: architecture-review
lens: technology-currency
target: ../ARCHITECTURE-SPINE.md
spine_version: 'updated 2026-09-29'
date: '2026-09-29'
previous: review-currency.md (2026-09-24)
verdict: 'עובר עם תיקונים: 1 קריטי, 2 גבוהים, 3 בינוניים, 7 נמוכים'
---

# סקירת עדכניות טכנולוגית (סבב 2): ARCHITECTURE-SPINE

הבדיקה נעשתה מול שלושה מקורות: הקוד והתלויות שב-repo (`package.json`, ‏`node_modules`, ‏`proxy.ts`, ‏`lib/supabase/*`, ‏`next.config.mjs`, ‏`eslint.config.mjs`, ‏`supabase/config.toml`), פרויקט ה-Supabase של הפיתוח (MCP, שאילתות קריאה בלבד), ומקורות ברשת נכון ל-2026-09-29 (npm registry, ‏GitHub Advisories, ‏nextjs.org, ‏supabase.com, ‏vercel.com).

## מה תוקן מאז הסבב הקודם (2026-09-24)

כל שמונת הממצאים של `review-currency.md` טופלו ב-spine או בקוד:

- F1: ‏`cacheComponents: true` קיים ב-`next.config.mjs`, ו-AD-2 דורש בדיקת תפקיד בתוך `<Suspense>`.
- F2: ‏AD-10 משתמש ב-`email_confirm: true` וב-`getUserById` לפני `createUser`. ‏`supabase/config.toml` שורה 225: ‏`enable_confirmations = false`.
- F3: ‏AD-5 נותן ל-`authenticated` ‏`usage` על `private` ו-`execute` רק לעזרים שנקראים מ-policy.
- F4: ‏`public/sw.js` נכתב ידנית (AD-16).
- F5, ‏F8: השהיית Supabase ו-Hobby נמצאים ב-Deferred. ‏AD-11 דורש `timeout_milliseconds` מפורש.
- F6: ‏`proxy.ts` מייצא `config`.
- F7: ‏web-push נשאר, והשימוש מרוכז ב-`push-worker.ts`.

## מה אומת ותקין

| נושא | מצב | ראיה |
| --- | --- | --- |
| גרסאות Stack מול `node_modules` | next 16.2.10, ‏react 19.2.7, ‏typescript 5.9.3, ‏supabase-js 2.116.0, ‏@supabase/ssr 0.12.7, ‏tailwindcss 4.3.2, ‏shadcn 4.13.0, ‏vitest 5.0.1. כולן תואמות למה שמותקן | `node -p require(...).version` |
| Postgres והרחבות ב-dev | ‏PostgreSQL 17.6, ‏`TimeZone = UTC`. ‏pg_cron 1.6.4 ו-pg_net 0.20.4 זמינים ולא מותקנים. ‏supabase_vault 0.3.1 ו-pgcrypto 1.3 מותקנים. ‏pg_graphql לא מותקן | MCP: ‏`version()`, ‏`pg_available_extensions`, ‏`pg_extension` |
| ‏pg_cron ב-UTC | שעון המסד הוא UTC. ‏AD-11 לא נשען על שעת ה-cron ומחשב לפי `Asia/Jerusalem`. זו הגישה הנכונה | MCP, ‏[Supabase Cron](https://supabase.com/docs/guides/cron) |
| ‏Vercel Hobby Cron | עדיין פעם ביום לכל היותר, בדיוק של שעה. מינואר 2026: עד 100 משימות לפרויקט. ההחלטה "אין Vercel Cron" נכונה | [changelog](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan), ‏[Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| ‏`proxy.ts` במקום middleware | המוסכמה של Next 16. ‏`export const config` תקין | `proxy.ts`, ‏`node_modules/next/dist/docs/.../proxy.md` |
| ‏`cacheComponents`, ‏`'use cache'`, ‏`cacheTag`, ‏`updateTag` | קיימים ב-16.2 וב-16.3. ‏16.3 היא "minor release with no breaking changes" | [Next.js 16.3](https://nextjs.org/blog/next-16-3) |
| ‏Cache-Control של דפים דינמיים | Next קובע לבד `private, no-cache, no-store, max-age=0, must-revalidate` לכל דף דינמי, כך שהדרישה ב-AD-16 ל-`/me` ול-`/admin` מתקיימת בלי header ידני. ב-Route Handlers ‏(`/api`) צריך להגדיר את ה-header בקוד | `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md:24`, ‏`self-hosting.md:101` |
| מפתחות publishable ו-secret | ה-gateway ממיר מפתח `sb_secret_` ל-JWT קצר עם role ‏`service_role`, ולכן `auth.role() = 'service_role'` ב-RPC של service role עובד. מפתח secret נחסם בדפדפן (בדיקת User-Agent). מפתחות legacy (`anon`, ‏`service_role`) יוצאים משימוש בסוף 2026, והקוד כבר משתמש בחדשים | [API keys](https://supabase.com/docs/guides/api/api-keys), ‏`lib/supabase/*.ts` |
| ‏Vault בתוך pg_cron | הדפוס `vault.decrypted_secrets` בתוך `net.http_post` הוא הדפוס הרשמי | [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) |
| ‏Web Push ב-iOS | עדיין רק ל-web app שנוסף למסך הבית (iOS 16.4 ומעלה), ורק אחרי פעולת משתמשת. מ-iOS 26 כל אתר שנוסף למסך הבית נפתח כ-web app. אין silent push. ‏`/install` ו-manifest ב-spine מתאימים | [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), ‏[WWDC25 Declarative Web Push](https://developer.apple.com/videos/play/wwdc2025/235/) |
| ‏web-push | ‏3.6.7 עדיין הגרסה האחרונה (01.2024). ‏`@types/web-push` האחרונה היא 3.6.4 | `npm view` |

## ממצאים

### C1 (קריטי): ‏Next.js 16.2.10, שנעוץ ב-Stack, פגיע, כולל שתי פרצות RCE קריטיות

**מה:** ‏`npm audit --omit=dev` מדווח על 11 advisories ל-`next@16.2.10`:

- **קריטי:** ‏[GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4). ‏RCE בלי אימות ב-Image Optimization API כשמעבדים קובצי AVIF (libheif דרך sharp). פגיע עד 16.3.2, מתוקן ב-16.3.3. אין backport ל-16.2.x.
- **קריטי:** ‏[GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36). ‏RCE בשרת שרץ על מערכת קבצים של Windows, באפליקציות **בלי** Cache Components. פגיע עד 16.3.2. ‏Vercel לא רץ על Windows, אבל מכונת הפיתוח כן, ו-`next dev`/`next start` רצים עליה. ‏`cacheComponents: true` כנראה מצמצם את החשיפה, אבל לא הייתי סומך על זה.
- **גבוה (מתוקן ב-16.2.11):** DoS ב-Server Actions ‏([GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj)), ‏SSRF ב-rewrites ‏([GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)), ‏SSRF ב-Server Actions בשרת מותאם, ועוד בלבול מטמון, חשיפת endpoints של Server Functions ו-DoS בתמונות SVG (בינוניים).
- ‏[GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) (עקיפת proxy) דורש `i18n.locales` עם locale אחד, ולכן לא חל כאן. הוא רלוונטי כי `SITE_LOCKED` (AD-22) נשען רק על ה-proxy, וזו תזכורת שה-proxy לא יכול להיות שכבת ההגנה היחידה.

השורה ב-Stack (`Next.js … 16.2.10`) היא החלטה מחייבת, וכל סשן בנייה יתקין את הגרסה הפגיעה. הגרסה האחרונה היום היא 16.3.7 (שוחררה ב-2026-09-29). ה-repo ציבורי, והאתר פרוס ל-Vercel.

**תיקון מוצע:**
1. לעדכן ב-Stack: ‏`next` ו-`eslint-config-next` ל-`16.3.7` (לפחות 16.3.3). הערה ב-Stack: "גרסת patch אחרונה של 16.3.x. לא לרדת מתחת ל-16.3.3".
2. להריץ `npm audit fix` על שאר התלויות (ראו M3), ולהוסיף `npm audit --omit=dev --audit-level=high` ל-CI שב-AD-22.
3. עד שמעדכנים: לא להגדיר `images.formats` עם AVIF ולא להגיש AVIF דרך `next/image`.
4. ‏16.3 משנה התנהגות סביב `cacheComponents` (ראו M1), ולכן לעדכן לפני שנכתב קוד מסכים, לא אחרי.

### H1 (גבוה): שינוי ברירת המחדל של grants ב-Data API של Supabase לא מופיע ב-AD-5, ו-dev ו-prod יתנהגו אחרת

**מה:** ‏Supabase הודיעה ([changelog #45329](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)) שטבלאות ו-sequences חדשים ב-`public` לא מקבלים יותר grants אוטומטיים ל-`anon`, ל-`authenticated` **ול-`service_role`**:

- מ-2026-05-30: ברירת מחדל לכל פרויקט חדש.
- ב-**2026-10-30** (בעוד חודש): מוחל על כל הפרויקטים הקיימים, לטבלאות שייווצרו אחרי המועד.
- מ-2026-05-18: ‏pg_graphql כבוי כברירת מחדל בפרויקטים חדשים.

בפרויקט הפיתוח עדיין פעילה ההתנהגות הישנה. ‏`pg_default_acl` ל-`public` נותן `arwdDxtm` ל-`anon`, ל-`authenticated` ול-`service_role`, על טבלאות של `postgres` ושל `supabase_admin` (MCP, ‏`pg_default_acl`). פרויקט הפרודקשן, שייפתח לפני ההשקה (AD-22), ייווצר עם ההתנהגות החדשה.

**למה זה משנה:** ‏AD-5 מבטל את ברירות המחדל רק ל-`anon` ול-`authenticated`, ולא מזכיר את `service_role`. לכן:
- טבלה שנוצרה ב-dev לפני 30.10 תקבל grants מלאים ל-`service_role`, וטבלה שנוצרה אחרי 30.10 או בפרודקשן לא תקבל. אותם קובצי migration ייתנו `role_table_grants` שונים בכל סביבה, ו-`supabase/tests/grants.test.ts` יתנהג אחרת בכל סביבה.
- כרגע, לפי AD-4, ה-service client ניגש לטבלאות רק דרך RPC מסוג definer, ולכן זה לא שובר כלום היום. אבל כל קריאה ישירה עתידית של `service_role` לטבלה (למשל בבדיקות שמנקות נתוני `test_<run-id>`) תעבוד ב-dev ותיכשל בפרודקשן.

**תיקון מוצע:** להוסיף ל-AD-5:
- migration ‏`0001` מבטל ברירות מחדל גם ל-`service_role` (`alter default privileges … revoke all on tables/sequences from service_role`, לבעלים `postgres`), כך ששתי הסביבות מתחילות מאותו מצב. כל grant ל-`service_role` הוא מפורש, בדיוק כמו ל-`authenticated`.
- ‏`grants.test.ts` בודק גם את `service_role` ואת `pg_default_acl`.
- לכבות את "Automatically expose new tables" בפרויקט הפיתוח כבר עכשיו (Dashboard › Settings › Data API), כדי ש-dev יתנהג כמו פרודקשן לפני שנכתבת ה-migration הראשונה.
- לרשום ב-checklist של AD-22: ‏pg_graphql לא מופעל (הוא לא מותקן ב-dev היום, וזה טוב).

### H2 (גבוה): הקצב של ה-Stack לא מוגדר. גרסאות מדויקות בלי מדיניות עדכון הן מה שיצר את C1

**מה:** טבלת ה-Stack מתעדת גרסאות מדויקות (`16.2.10`), אבל לא אומרת מה עושים כשיוצא patch או advisory. מאז שה-spine נכתב (2026-09-24) יצאו 16.3.6 ו-16.3.7 של Next, ‏supabase-js 2.117.2, ‏vitest 5.0.2, ‏tailwindcss 4.3.3. חלקם תיקוני אבטחה. סשן בנייה שקורא "Next 16.2.10" יתייחס לזה כחוק.

**תיקון מוצע:** להחליף את עמודת "Version" בשתי עמודות: "קו" (למשל `next 16.3.x`, ‏`@supabase/supabase-js 2.x`, ‏`typescript 5.9.x`) ו"מינימום" (למשל `≥ 16.3.3`). להוסיף כלל: patch בתוך הקו מותר בכל סשן, ו-minor או major (כולל TypeScript 6/7, ‏ESLint 10, ‏React 19.3) רק בהחלטה שנרשמת ב-spine. ‏`npm audit` ב-CI אוכף את המינימום.

### M1 (בינוני): ‏Next 16.3 מוסיף התנהגויות ל-Cache Components שה-spine לא מכריע בהן

**מה:** לפי [Next.js 16.3](https://nextjs.org/blog/next-16-3) ו-[Instant Navigations](https://nextjs.org/blog/next-16-3-instant-navigations):
- ‏`'use cache'` שומר עכשיו גם **במטמון בצד הלקוח**. לתוכן ציבורי דרך `lib/supabase/public.ts` זה בסדר. אבל אחרי `updateTag` רק מי שפרסמה רואה את השינוי מיד, ומבקרות אחרות עלולות לראות גרסה ישנה עד שה-stale time של `cacheLife` עובר.
- **Instant Insights:** ניווט שחוסם (למשל `await` על cookies מחוץ ל-Suspense) מוצג כ**שגיאה** בפיתוח. אפשר לבטל את זה לכל נתיב עם `export const instant = false`.
- ‏`partialPrefetching: true`: דגל חדש, opt-in, שיהפוך לברירת המחדל ב-major הבא.
- ‏`redirect()` מתוך רכיב שעטוף ב-`<Suspense>` (כמו שדורש AD-2) מתבצע אחרי שה-shell כבר נשלח. לכן ההפניה ל-`/login` היא הפניה בזרם (status 200 והפניה בצד הלקוח), לא 307. זה לא בעיית אבטחה, כי הנתונים נמצאים רק בחלק הדינמי ו-RLS מגן, אבל זה משפיע על בדיקות ועל SEO.

**תיקון מוצע:** להוסיף ל-AD-16 שלוש שורות: (1) ‏`partialPrefetching` כבוי עד להחלטה. (2) ‏`export const instant = false` מותר רק ב-layout של `/me` ו-`/admin/(shell)`, אם בוחרים לחסום, ולא בדפים ציבוריים. (3) ‏`cacheLife` מפורש לתוכן ציבורי (למשל פרופיל `minutes`), כדי שעיכוב הפרסום אצל מבקרות יהיה ידוע. אופציונלי: הפניה אופטימית ב-`proxy.ts` לפי `getClaims()` (בלי תפקיד), כדי שאורחת תקבל 307 אמיתי. ההרשאה עדיין ב-layout וב-RLS.

### M2 (בינוני): שאר ממצאי `npm audit` בתלויות

**מה:** מלבד `next`, ‏`npm audit --omit=dev` מדווח על 16 פגיעויות נוספות (3 נמוכות, 4 בינוניות, 9 גבוהות): ‏`undici` 7.0–7.29 (דליפת מידע בין משתמשים דרך Cache-Control, ‏CRLF injection), ‏`sharp` ≤ 0.35.4-rc.0 (libvips ו-libheif), ‏`postcss` ≤ 8.5.22, ‏`hono`/`@hono/node-server`, ‏`js-yaml`, ‏`fast-uri`, ‏`qs` ו-`brace-expansion`. רובן תלויות עקיפות של `next` ושל `shadcn` (CLI עם MCP SDK). ‏`shadcn` נמצא ב-`dependencies` ולא ב-`devDependencies`, ולכן הוא נכלל בבדיקת production.

**תיקון מוצע:** ‏`npm audit fix` אחרי העדכון של C1. להעביר את `shadcn` (ה-CLI) ל-`devDependencies`. להשאיר רק את `@shadcn/react` אם באמת משתמשים בו בזמן ריצה.

### M3 (בינוני): עובדות pg_net שמשפיעות על AD-11

**מה:** לפי [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net):
- ‏`timeout_milliseconds` ברירת מחדל **2000** (הסבב הקודם העריך כ-5 שניות).
- תשובות ב-`net._http_response` נמחקות אוטומטית אחרי 6 שעות (`pg_net.ttl`). לכן הניקוי שלהן ב-`job_cleanup` מיותר.
- הבקשות והתשובות נשמרות בטבלאות unlogged, ואובדות בקריסה.
- ה-API עדיין מסומן "beta", והחתימה עשויה להשתנות.

העובד ב-Vercel עלול לרוץ יותר מ-2 שניות (שליחה לכמה מנויים). אם pg_net מנתק, התשובה נרשמת כ-timeout. התנהגות העובד אחרי ניתוק לקוח ב-Vercel לא אומתה כאן.

**תיקון מוצע:** ב-AD-11 לקבוע ערך: `timeout_milliseconds := 10000` יחד עם `export const maxDuration = 60` בעובד, ו-batch קטן (הקבוע ב-SQL, AD-15). לרשום שהתקדמות נמדדת רק ב-`notification_jobs` (ה-lease ב-AD-12 כבר מכסה ניתוק באמצע). להסיר את `net._http_response` מ-`job_cleanup`, או להשאיר ולציין שזה no-op. לעטוף את הקריאה ל-`net.http_post` בעזר אחד (`private.invoke_push_worker`), כך ששינוי חתימה נוגע בפונקציה אחת.

### L1 (נמוך): ‏TypeScript 5.9.3. יצאו 6.0 ו-7.0, ו-7 לא מתאים עדיין

**מה:** ‏TypeScript 6.0.2 יצא ב-03.2026, ו-7.0 (native, Go) ב-07.2026. האחרונה היום: 7.0.2. ‏Next 16.3 יודע להריץ type check עם TS 7 ([Next.js 16.3](https://nextjs.org/blog/next-16-3)). אבל ל-TS 7.0 אין API תכנותי יציב, ו-typescript-eslint עדיין לא תומך בו ([issue #12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518)). ‏`eslint-config-next/typescript` תלוי בו.

**תיקון מוצע:** להשאיר 5.9.x (או לעבור ל-6.0.x בהחלטה), ולרשום ב-Stack במפורש: "לא TS 7 עד ש-typescript-eslint תומך (צפוי עם 7.1)". אחרת סשן יריץ `npm i typescript@latest` ויקבל 7.

### L2 (נמוך): פערים בין ה-spine ל-repo שצריך לסגור ב-E1

אלה לא טעויות ב-spine, אבל הקוד עוד לא מיישם אותו:
- ‏`createServiceClient` עדיין ב-`lib/supabase/server.ts:32`. ‏AD-4 מעביר אותו ל-`lib/server/privileged/service-client.ts` עם `import "server-only"`.
- ‏`server-only` לא מותקן (`node_modules/server-only` חסר), אבל Consistency Conventions › בדיקות אומר שהוא מותקן. לתקן את הניסוח ל"יותקן ב-E1", או להתקין.
- ‏`lib/supabase/public.ts` לא קיים (AD-16).
- ‏`zod` לא ב-`package.json`. ‏4.3.6 מותקן רק כתלות עקיפה של `eslint-plugin-react-hooks` ושל `shadcn`. האחרונה: 4.6.5. לנעוץ `zod@^4` כתלות ישירה ב-E1 ולא לייבא מהתלות העקיפה.
- ‏`web-push` ו-`@types/web-push` לא מותקנים. בשורה ב-Stack כתוב `3.6.7` לשניהם, אבל `@types/web-push` האחרונה היא 3.6.4.
- ‏`eslint.config.mjs` אוכף RTL, אבל עדיין לא את `no-restricted-imports` של `lib/server/**` (Consistency Conventions › אכיפה).
- ‏`"dev": "next dev --turbopack"`: ב-Next 16 ‏Turbopack הוא ברירת המחדל, והדגל מיותר.
- ‏`@eslint/eslintrc` ב-`devDependencies` לא בשימוש (הקונפיג שטוח).

### L3 (נמוך): גרסת Node לא נעוצה

**מה:** מכונת הפיתוח רצה על Node 24.18. ‏`@types/node` הוא `^26.1.1`, כלומר טיפוסים של גרסה שלא רצה לא מקומית ולא (כנראה) ב-Vercel. ‏Next דורש `>=20.9.0`. אין `engines` ב-`package.json`.

**תיקון מוצע:** להוסיף `"engines": { "node": "24.x" }` (Vercel קורא את זה), ולהוריד את `@types/node` ל-`^24`. להוסיף שורת Node ל-Stack.

### L4 (נמוך): ‏ESLint 10 ו-React 19.3 זמינים

**מה:** ‏ESLint 10.11.0 היא האחרונה, ומותקן 9.39.4. ‏React 19.3.0 יצא ב-2026-09-09. ‏Next App Router משתמש ב-React שבתוך Next עצמו, ולכן השורה של React ב-Stack היא בעיקר לטיפוסים ולבדיקות. אין advisory ל-React 19.2.7 ב-`npm audit`.

**תיקון מוצע:** להשאיר את שניהם בקו הנוכחי (ראו H2), ולשדרג רק כשיש החלטה.

### L5 (נמוך): מפתח secret בפרויקט חדש, ו-`auth.role()`

**מה:** ‏`auth.role() = 'service_role'` עובד עם מפתח `sb_secret_`, כי ה-gateway מנפיק JWT של `service_role` ([API keys](https://supabase.com/docs/guides/api/api-keys)). ב-2026-09 נפתחה תקלה שבה מפתח secret בפרויקט חדש נדחה עם "Invalid API key" ([supabase#50801](https://github.com/supabase/supabase/issues/50801), סגורה). זה רלוונטי ליצירת פרויקט הפרודקשן.

**תיקון מוצע:** ב-`grants.test.ts` להוסיף בדיקה ש-RPC של service role מצליח עם ה-service client ונכשל עם `authenticated`. ב-checklist של פרויקט הפרודקשן (AD-22): לוודא שקריאה עם `sb_secret_` עובדת לפני שמגדירים את Vercel.

### L6 (נמוך): ‏Web Push ב-iOS, דגשים שלא כתובים

**מה:** ב-iOS אין silent push. כל `push` חייב להציג התראה, אחרת Safari עלול לבטל את המנוי. ‏Apple דוחה JWT של VAPID כש-`VAPID_SUBJECT` אינו `mailto:` או `https:` תקין (403). לפי AD-12, ‏403 לא מוחק מנוי, ולכן תקלה כזו תגרום לכשל שקט אצל כל מכשירי Apple עד שהמשימה עוברת ל-`failed`. ‏Declarative Web Push (iOS 18.4 ומעלה) קיים, אבל push רגיל דרך service worker עדיין נתמך. אין צורך לשנות כיוון.

**תיקון מוצע:** להוסיף ל-AD-16: ‏`sw.js` תמיד קורא ל-`showNotification` באירוע `push`. להוסיף ל-AD-12 או ל-env: ‏`VAPID_SUBJECT` הוא `mailto:` של העסק, לא `localhost`. אופציונלי: לרשום בלוג קוד שגיאה נפרד ל-403 מ-`web.push.apple.com`.

### L7 (נמוך): השהיית פרויקט Supabase חינמי, בלי שינוי

**מה:** התיעוד עדיין אומר 7 ימים של "user database activity", ולא מזכיר את pg_cron ([Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). הסעיף ב-Deferred נכון ועדיין פתוח.

**תיקון מוצע:** אין שינוי ב-spine. כדאי לרשום ב-Deferred שהעובד קורא ל-`claim_push_jobs` דרך PostgREST בכל דקה גם כשהתור ריק, ולכן כנראה משמש keep-alive.

## מקורות

- ‏`npm view` ו-`npm audit --omit=dev --json` (2026-09-29) על next, react, typescript, @supabase/supabase-js, @supabase/ssr, vitest, tailwindcss, shadcn, web-push, @types/web-push, zod, server-only, eslint, eslint-config-next
- GitHub Advisories: [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), ‏[GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36), ‏[GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24), ‏[GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj), ‏[GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)
- [Next.js 16.3](https://nextjs.org/blog/next-16-3), ‏[Next.js 16.3: Instant Navigations](https://nextjs.org/blog/next-16-3-instant-navigations)
- תיעוד Next המקומי: `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md`, ‏`self-hosting.md`, ‏`03-api-reference/05-config/01-next-config-js/headers.md`
- Supabase: [Breaking change: Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), ‏[API keys](https://supabase.com/docs/guides/api/api-keys), ‏[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), ‏[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing), ‏[supabase#50801](https://github.com/supabase/supabase/issues/50801)
- Supabase dev (MCP, קריאה בלבד): ‏`version()`, ‏`current_setting('TimeZone')`, ‏`pg_available_extensions`, ‏`pg_extension`, ‏`pg_default_acl`
- Vercel: [Cron: 100 per project](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan), ‏[Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- Web Push: [WebKit, Web Push for iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), ‏[WWDC25 Declarative Web Push](https://developer.apple.com/videos/play/wwdc2025/235/)
- TypeScript 7 ו-typescript-eslint: [typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518), ‏[Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
