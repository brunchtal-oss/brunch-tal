---
type: architecture-review
lens: technology-currency
target: ../ARCHITECTURE-SPINE.md
date: '2026-09-24'
verdict: 'עובר עם תיקונים: 2 חוסמים, 3 בינוניים, 3 קלים'
---

# סקירת עדכניות טכנולוגית: ARCHITECTURE-SPINE

בדקתי כל החלטה טכנית שה-spine מתחייב אליה מול שלושה מקורות: הקוד המותקן (`package.json`, ‏`node_modules`, התיעוד של Next שנמצא ב-`node_modules/next/dist/docs`), פרויקט ה-Supabase של הפיתוח (דרך MCP), ומקורות ברשת. הגרסאות בטבלת ה-Stack תואמות למה שמותקן. הבעיות נמצאות בדרך השימוש בחלק מהטכנולוגיות, לא בגרסאות.

## סיכום

| # | חומרה | נושא | החלטה |
| --- | --- | --- | --- |
| F1 | **חוסם** | `'use cache'`, ‏`cacheTag` ו-`updateTag` דורשים `cacheComponents: true`, ו-`next.config.mjs` ריק | AD-16, Stack |
| F2 | **חוסם** | `createUser({ email_confirm: false })` כנראה ימנע את ההתחברות בשרת בצעד 4. ‏id כפול לא מחזיר קוד שגיאה יציב | AD-10 |
| F3 | בינוני | ‏"ל-`private` אין grant ל-`authenticated`" סותר את `(select private.is_admin())` ב-RLS וב-layout | AD-3, AD-5, AD-2 |
| F4 | בינוני | `app/sw.ts ← public/sw.js` הוא לא מוסכמה של Next. חסר שלב build | AD-16 |
| F5 | בינוני | ‏pg_cron לבד כנראה לא מונע השהיה של פרויקט חינמי. ‏Hobby אוסר שימוש מסחרי | Deferred, Stack |
| F6 | קל | `proxy.ts` הקיים מייצא `proxyConfig` ולא `config`, ולכן ה-matcher לא נקרא | Structural Seed |
| F7 | קל | ‏web-push 3.6.7 לא עודכן מאז 01.2024. הבחירה עדיין סבירה | Stack, AD-12 |
| F8 | קל | ‏pg_net מול preview מוגן של Vercel, ו-timeout של pg_net | AD-11 |

## מה אומת ותקין

- **גרסאות:** ‏next 16.2.10, ‏react 19.2.7, ‏@supabase/supabase-js 2.116.0 (כולל auth-js 2.116.0), ‏@supabase/ssr 0.12.7, ‏tailwindcss 4.3.2, ‏vitest 5.0.1 ו-typescript 5.9.3 תואמים ל-`package.json` ול-`node_modules`. ‏`web-push` **עוד לא מותקן**. זו התקנה עתידית, והגרסה 3.6.7 היא האחרונה ב-npm.
- **Supabase dev:** ‏PostgreSQL 17.6. ‏`pg_cron` 1.6.4 ו-`pg_net` 0.20.4 זמינים (לא מותקנים עדיין), ו-`supabase_vault` 0.3.1 מותקן. תזמון בשניות דורש pg_cron ≥ 1.5 ו-Postgres ≥ 15.1.1.61, ולכן הוא נתמך. Cron זמין בכל התוכניות, מוגבל רק במשאבים ([דיון #37405](https://github.com/orgs/supabase/discussions/37405)). כל משימה צריכה להסתיים תוך 10 דקות ([Supabase Cron](https://supabase.com/docs/guides/cron)).
- **Vault מתוך pg_cron:** הדפוס `(select decrypted_secret from vault.decrypted_secrets where name = '…')` בתוך `net.http_post` הוא הדפוס הרשמי ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)). המשימות רצות כ-`postgres`, שיש לו גישה ל-view. זה מתאים ל-`private.job_invoke_push_worker`.
- **schema `private` לא חשוף:** ב-Supabase רק ה-schemas שברשימת Exposed schemas (ברירת מחדל: `public` ו-`graphql_public`) נגישים ב-Data API. ‏`private` לא יהיה חשוף כל עוד לא מוסיפים אותו לרשימה. ראו F3 לגבי grants.
- **`auth.admin.createUser({ id })`:** קיים. ‏`AdminUserAttributes.id?: string` מופיע ב-`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:525-529` ("Allows you to overwrite the default `id` set for the user"). השרת דורש UUID תקין שאינו nil ([admin.go](https://github.com/supabase/auth/blob/master/internal/api/admin.go)).
- **`proxy.ts`:** זו המוסכמה של Next 16. היא רצה ב-Node כברירת מחדל, ואסור לייצא בה `runtime` (`next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). ראו F6.
- **`app/manifest.ts`:** מוסכמת metadata קיימת (`…/01-metadata/manifest.md`).
- **Route Handler ב-Node:** ‏`runtime` ברירת המחדל הוא `'nodejs'`. אין צורך לייצא אותו, ו-`edge` לא נתמך עם Cache Components (`…/route-segment-config/runtime.md`). מומלץ להוסיף `export const maxDuration = 60` לעובד הפוש, כדי לתחום את הזמן במפורש.
- **Vercel Hobby:** ‏max duration של 300 שניות (ברירת מחדל ומקסימום, Fluid compute). מיליון הפעלות בחודש ו-4 שעות Active CPU ([Functions Limits](https://vercel.com/docs/functions/limitations), ‏[Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)). עובד שנקרא כל דקה מגיע לכ-43,200 הפעלות בחודש, הרבה מתחת לתקרה. ‏Cron רק פעם ביום: אומת קודם, וה-spine כבר נמנע ממנו.
- **התחברות בשרת עם `@supabase/ssr`:** ‏`signInWithPassword` ב-Server Action דרך `createClient()` מ-`lib/supabase/server.ts` כותב cookies. ה-`setAll` שם עובד ב-Server Action ונבלע רק ב-Server Component. זה מתאים לצעד 4, בתנאי ש-F2 יתוקן. חשוב: להשתמש בלקוח עם ה-cookies, לא ב-`createServiceClient`.

## ממצאים

### F1 (חוסם): `'use cache'` דורש `cacheComponents: true`, וזה משנה את כל מודל הרינדור

**מה:** לפי `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`: "`use cache` is a Cache Components feature. To enable it, add the `cacheComponents` option". אותה דרישה מופיעה גם ב-`cacheTag.md`. ‏`next.config.mjs` ריק כרגע. ‏`updateTag` עובד רק מתוך Server Action (`updateTag.md`), וזה מתאים ל-AD-16. ‏`unstable_cache` הוחלף ב-`use cache` ב-Next 16 (`unstable_cache.md`).

**השלכות שה-spine לא מזכיר:** כש-`cacheComponents` פעיל (`migrating-to-cache-components.md`):
- ה-route segment configs ‏`dynamic`, ‏`revalidate` ו-`fetchCache` מוסרים. אי אפשר לכתוב `export const dynamic = 'force-dynamic'` כדי לקיים את "`/me`, ‏`/admin` ו-`/api` תמיד דינמיים". במקום זה, כל דבר שאין עליו `use cache` הוא דינמי כברירת מחדל.
- גישה ל-`cookies()`, ‏`headers()`, ‏`params` או `searchParams` מחוץ ל-`<Suspense>` מעלה שגיאת **blocking-route** בפיתוח וב-build. זה נוגע ישירות ל-`app/me/layout.tsx` ול-`app/admin/layout.tsx` (AD-2), שקוראים session מתוך cookies.
- `generateStaticParams` שמחזיר `[]` נכשל.
- `use cache` לא יכול לקרוא ל-`cookies()`. לכן `lib/supabase/public.ts` (anon, בלי cookies) הוא הבחירה הנכונה.

**תיקון מוצע:** להוסיף ל-Stack או ל-AD-16 שורה מפורשת: "`next.config.mjs`: ‏`cacheComponents: true`, מהקומיט הראשון". להוסיף ל-AD-2 כלל: בדיקת ההרשאה ב-layouts של `/me` ו-`/admin` נעשית בתוך רכיב עטוף ב-`<Suspense>` (או דרך `connection()` בתוך Suspense), ולא משתמשים ב-`export const dynamic`. החלופה היא לוותר על `use cache` ולפרסם תוכן עם `revalidatePath` / ‏`revalidateTag(tag, 'max')` במודל הישן. אבל זה מודל "previous" לפי התיעוד, ולכן עדיף להחליט עכשיו על Cache Components מהיום הראשון, כשאין עדיין קוד שצריך להעביר.

### F2 (חוסם): `email_confirm: false`, ו-retry עם אותו id

**מה (א):** ב-AD-10 צעד 2 נכתב `email_confirm: false`, ובצעד 4 "התחברות בשרת". בפרויקט Supabase מתארח, "Confirm email" פעיל כברירת מחדל. משתמשת שנוצרה עם `email_confirm: false` לא מאושרת, ו-`signInWithPassword` מחזיר `email_not_confirmed`. ‏`admin.createUser` לא שולח מייל אישור, ולפי SPEC › Non-goals אין ספק מייל בשלב 1. המשמעות: הלקוחה נתקעת מיד אחרי ההצטרפות. (לא בדקתי את הגדרת ה-Auth בפרויקט הפיתוח, כי MCP לא חושף אותה. צריך לבדוק ב-Dashboard › Authentication › Providers › Email.)

**תיקון:** `email_confirm: true`. בעלות המייל לא מאומתת בשלב 1 בכל מקרה, והקישור החד-פעמי שהגיע בוואטסאפ הוא ההוכחה. לרשום את זה כהחלטה ב-AD-10.

**מה (ב):** "אם המשתמשת כבר קיימת עם אותו `id`, ממשיכים ומעדכנים סיסמה". בקוד השרת ([admin.go](https://github.com/supabase/auth/blob/master/internal/api/admin.go)) **אין בדיקה של id כפול**. יש רק בדיקה של מייל כפול, שמחזירה 422 `email_exists`, והיא רצה לפני ה-insert. לכן ב-retry עם אותו id ואותו מייל מתקבל `email_exists`. עם id קיים ומייל אחר (למשל מייל שתוקן בטופס) ה-insert נכשל על מפתח ראשי, והתוצאה היא כנראה 500 "Database error creating new user", בלי קוד יציב. ‏`user_already_exists` קיים ב-`error-codes.d.ts`, אבל לא נזרק בנתיב הזה. אי אפשר לסמוך על קוד שגיאה כדי לזהות "כבר קיימת עם אותו id".

**תיקון:** במתזמר (`lib/server/privileged/join.ts`) לקרוא קודם ל-`auth.admin.getUserById(pending_user_id)`. אם המשתמשת קיימת: ‏`updateUserById(id, { password, email, email_confirm: true })`. אם לא: ‏`createUser`. אם `createUser` מחזיר `email_exists`: לבדוק שוב עם `getUserById`. אם גם אז היא לא קיימת, המייל שייך למשתמשת אחרת, וזה `conflict` (משימה ב"לטיפול"). לתעד את הזרימה הזו בתרשים של AD-10.

### F3 (בינוני): ‏grants על `private` מול RLS ו-layout

**מה:** AD-5 קובע "ל-`private` אין `grant` ל-`anon`/`authenticated`". אבל ב-RLS (Consistency Conventions) כתוב `(select private.is_admin())`. ‏policy רצה בהרשאות של המשתמשת הקוראת, ולכן `authenticated` צריך `usage on schema private` ו-`execute on function private.is_admin()`. בלי אלה, כל שאילתה על טבלה עם ה-policy נכשלת ב-`permission denied for schema private`, גם אצל לקוחות רגילות. הבעיה השנייה: `app/admin/layout.tsx` "דורש `private.is_admin()`", אבל TS לא יכול לקרוא ל-`private` דרך PostgREST כי ה-schema לא חשוף.

**תיקון:** לנסח מחדש: "`private` לא חשוף ב-Data API. ‏`authenticated` מקבל `usage` על ה-schema ו-`execute` רק על פונקציות שנקראות מתוך policies (`is_admin`). אין grant על טבלאות ב-`private`". זה עדיין בטוח, כי schema שלא חשוף לא נגיש מבחוץ. ל-layout: RPC ציבורי דק, למשל `public.get_my_role()` או `am_i_admin()` (‏security definer, ‏`grant` ל-`authenticated`), שעוטף את `private.is_admin()`. כדאי להריץ `get_advisors` אחרי ה-migration הראשונה.

### F4 (בינוני): ‏service worker מ-`app/sw.ts`

**מה:** אין ב-Next 16 מוסכמה שבונה `app/sw.ts` לקובץ `public/sw.js`. קובץ `sw.ts` תחת `app/` לא יוצר נתיב ולא יוצר קובץ. המדריך הרשמי (`next/dist/docs/01-app/02-guides/progressive-web-apps.md`) משתמש ב-**`public/sw.js` שנכתב ביד** וב-`web-push`. הוא מציע headers ל-`/sw.js` ב-`next.config` (`Cache-Control: no-cache, no-store, must-revalidate` ו-CSP). ל-offline הוא מפנה ל-Serwist, ו-`@serwist/turbopack` 9.5.12 (07.2026) תומך היום גם ב-Turbopack ([Serwist Turbopack](https://serwist.pages.dev/docs/next/turbo)).

**תיקון (הכי פשוט ונכון):** ‏`public/sw.js` בכתיבה ידנית, JS רגיל עם `// @ts-check` ו-JSDoc, כ-80 שורות. הוא מטפל ב-`install` (precache ל-`/offline` ולאייקונים), ב-`fetch` (ניווט network-only עם נפילה ל-`/offline`, ‏cache-first רק ל-`/_next/static/`), ב-`push` וב-`notificationclick`. בנוסף headers ב-`next.config.mjs` ו-`register('/sw.js', { scope: '/', updateViaCache: 'none' })`. ה-SW מצומצם מספיק ש-Serwist או Workbox לא מצדיקים תלות נוספת. לעדכן את Structural Seed: `public/sw.js` במקום `app/sw.ts`. כדאי גם להחריג `sw.js` ו-`manifest.webmanifest` מה-matcher של ה-proxy.

### F5 (בינוני): השהיית Supabase ושימוש מסחרי ב-Vercel Hobby

**Supabase:** לפי התיעוד, פרויקט חינמי נחשב לא פעיל אם "does not receive sufficient **user database activity** over the past week", ו"a few user requests to the database each day" מספיקות ([Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). אין מקור רשמי שאומר ש-pg_cron נחשב פעילות. הניסוח "user" והמדריכים הקהילתיים ([supabase-pause-prevention](https://github.com/travisvn/supabase-pause-prevention)) מרמזים שלא. **הערה חיובית:** בארכיטקטורה הזו, pg_cron קורא כל דקה ל-`/api/jobs/push` ב-Vercel, והעובד קורא ל-`claim_push_jobs` דרך PostgREST. זו בקשת API חיצונית אמיתית, והיא כנראה כן נספרת. אבל זה תלוי בכך ש-Vault מוגדר ושהעובד קורא ל-RPC גם כשהתור ריק. זה לא מאומת.

**תיקון:** לעדכן את הסעיף ב-Deferred: "pg_cron לבדו לא מספיק. העובד חייב לקרוא ל-`claim_push_jobs` בכל הפעלה (גם כשהתור ריק), וזה משמש keep-alive. לפני השקה עוברים ל-Pro בכל מקרה (גיבוי)".

**Vercel:** לפי ה-Fair Use, ‏"Hobby teams are restricted to non-commercial personal use only". הדוגמאות כוללות "Advertising the sale of a product or service" ו-"Receiving payment to create, update, or host the site" ([Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)). אתר שיווקי שמוכר בראנצ'ים הוא שימוש מסחרי ברגע שהוא חי מול לקוחות. ה-spine כבר קובע "שדרוג Vercel לפני נתונים אמיתיים". מומלץ לחדד: **לפני כל פרסום ציבורי של האתר**, לא רק לפני נתונים אמיתיים.

### F6 (קל, בקוד הקיים): `proxy.ts` מייצא `proxyConfig`

**מה:** ב-`proxy.ts` שבשורש כתוב `export const proxyConfig = { matcher: [...] }`. לפי `proxy.md`, שם הייצוא הוא **`config`**. לכן ה-matcher נקרא כלא קיים, וה-proxy רץ על כל בקשה, כולל `_next/static` ותמונות. כל בקשה כזו מפעילה `getClaims`/`getUser`. זה מאט את האתר, ובעתיד יפעיל גם על `sw.js`.

**תיקון:** לשנות ל-`export const config`. מחוץ ל-spine, אבל ה-Structural Seed מסתמך על הקובץ הזה.

### F7 (קל): ‏web-push 3.6.7

**מה:** ‏3.6.7 היא הגרסה האחרונה, ו-npm מראה שינוי אחרון ב-2024-01-16. יש לה 5 תלויות (`asn1.js`, ‏`http_ece`, ‏`jws`, ‏`https-proxy-agent`, ‏`minimist`) ו-`engines: node >= 16`. הספרייה בשלה ויציבה, והמדריך הרשמי של Next 16 עדיין משתמש בה. היא רצה בלי בעיה ב-Node runtime של Vercel. הפרוטוקול (RFC 8030/8291/8292) לא השתנה, ולכן חוסר עדכון הוא לא סיכון ממשי. החלופה המתוחזקת הבולטת: `@pushforge/builder` 2.0.5 (04.2026). היא מבוססת Web Crypto ובלי תלויות, אבל פחות מוכחת.

**תיקון:** להשאיר web-push. להוסיף `@types/web-push` ל-devDependencies. ‏`lib/server/privileged/push-worker.ts` יהיה המקום היחיד שמייבא אותה, כך שהחלפה בעתיד נוגעת בקובץ אחד.

### F8 (קל): ‏pg_net מול Vercel

- **preview מוגן:** ב-Vercel, ‏Deployment Protection (Vercel Authentication) פעיל כברירת מחדל על preview deployments. ‏`net.http_post` מ-pg_cron לכתובת preview יקבל 401. ה-spine אומר "כתובת העובד ב-Vault מצביעה על ה-deployment שבודקים". צריך להוסיף ל-Vault גם secret של Protection Bypass for Automation ולשלוח אותו ב-header ‏`x-vercel-protection-bypass`, או לבדוק רק מול production.
- **timeout:** ‏`net.http_post` מקבל `timeout_milliseconds`, וברירת המחדל קצרה (כ-5 שניות). הקריאה אסינכרונית, והתשובה נרשמת ב-`net._http_response`. מומלץ להגדיר timeout מפורש, להחזיק batch קטן בעובד, ולא להסתמך על תשובת ה-HTTP. ההתקדמות נמדדת ב-`notification_jobs`, וזה כבר הכיוון ב-AD-12.
- **ניקוי:** ‏`cron.job_run_details` ו-`net._http_response` גדלים בכל הרצה, ומשימה שרצה כל דקה מייצרת בערך 1,440 שורות ביום. כדאי ש-`private.job_cleanup` ינקה גם אותן (Free: ‏500MB).

## מקורות

- תיעוד Next.js 16.2.10 המקומי: `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`, ‏`04-functions/{cacheTag,updateTag,revalidateTag,unstable_cache}.md`, ‏`03-file-conventions/proxy.md`, ‏`03-file-conventions/02-route-segment-config/{index,runtime}.md`, ‏`02-guides/migrating-to-cache-components.md`, ‏`02-guides/progressive-web-apps.md`
- `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` (‏`AdminUserAttributes.id`), ‏`error-codes.d.ts`
- Supabase Auth, ‏adminUserCreate: https://github.com/supabase/auth/blob/master/internal/api/admin.go
- Supabase Project Pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase Cron: https://supabase.com/docs/guides/cron ; ‏pg_cron בתוכנית החינמית: https://github.com/orgs/supabase/discussions/37405
- Vault + pg_net ב-cron: https://supabase.com/docs/guides/functions/schedule-functions
- Vercel Functions Limits: https://vercel.com/docs/functions/limitations
- Vercel Fair Use (Commercial usage): https://vercel.com/docs/limits/fair-use-guidelines
- web-push: https://github.com/web-push-libs/web-push ; ‏npm registry (`npm view web-push`, ‏`@pushforge/builder`, ‏`@serwist/turbopack`)
- Serwist Turbopack: https://serwist.pages.dev/docs/next/turbo
- keep-alive בקהילה: https://github.com/travisvn/supabase-pause-prevention
- פרויקט Supabase dev (MCP): ‏`select version()` ו-`pg_available_extensions`
