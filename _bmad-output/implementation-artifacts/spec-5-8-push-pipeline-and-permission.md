---
title: '5.8 Push pipeline and permission flow — פוש והרשאה'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '48122ff66d424fa98c6af56cfdf95281b11fe4ec'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/.claude/skills/pwa-push-notifications/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** משימות פוש נכנסות ל-`notification_jobs` מאז 2.12 ונשארות `queued` (16 במסד הפיתוח), כי אין מנויים, עובד או הרשאה. ההדגמה דורשת פוש לטלפון גם כשהאפליקציה סגורה, ללקוחה ולאדמין (מקור §8, ‏CAP-21/22/35).

**Approach:** מיגרציה אחת (מנויים, מסירות, RPC, ‏cron דרך pg_net ו-Vault, ענף "לטיפול"), נתיב עובד עם `web-push`, כרטיס הרשאה בשני מרכזי ההתראות, סנכרון מנוי וביטולו בהתנתקות. ‏`public/sw.js` כבר מטפל ב-`push` וב-`notificationclick` (5.9).

**החלטות המשתמשת 2026-10-06 (אישור ה-spec):** (1) **כלל גיל:** משימה שנוצרה לפני יותר מ-24 שעות נסגרת `skipped` בלי שליחה, עכשיו (16 שבתור) ובכל תקלה עתידית; ההתראה נשארת באזור האישי. (2) ההרשאה מוצעת רק בכרטיס במרכזי ההתראות של `/me` ו-`/admin`, שמשמש גם כהגדרות; שורה בפרופיל והצעה אחרי הרשמה ראשונה נדחות לסבב העיצוב (deferred-work). (3) לפני המיזוג בודקים במחשב ובבדיקות מסד; ב-Android ובאייפון בודקים אחרי המיזוג, ותיקון ב-PR קצר נוסף. (4) ה-spec נשאר שלם.

## Boundaries & Constraints

**Always:**
- **AD-11/12/16/22 גוברים על הסקיל** `pwa-push-notifications`; ממנו רק המלכודות (Step 8 ‏`Uint8Array<ArrayBuffer>`, ‏Step 9 סגירת הכרטיס לפני subscribe, ‏Step 10 סנכרון עצמי, ‏Step 11 הרשאה רק מלחיצה).
- **`push_subscriptions`:** ‏`id`, ‏`user_id uuid not null references auth.users on delete cascade` (מחיקת משתמשת מוחקת מנויים; זו ההרחבה של הסרת הפרטים עד 4.6), ‏`endpoint text unique` (רק `https://`, עד 1000 תווים), ‏`p256dh`, ‏`auth`, ‏`platform in ('ios','android','desktop','other')`, ‏`created_at`, ‏`last_seen_at`. ‏RLS בלי policy ובלי grant לאף תפקיד (מקור: "אין גישה ציבורית"); הכול דרך RPC. אינדקס על `user_id`.
- **`notification_deliveries(job_id → notification_jobs on delete cascade, subscription_id → push_subscriptions on delete cascade, delivered_at)`**, מפתח ראשי `(job_id, subscription_id)`. ‏RLS בלי policy.
- **`register_push_subscription(p_endpoint, p_keys jsonb, p_platform)` ← ‏`{registered: true}`** ו-**`unregister_push_subscription(p_endpoint)` ← ‏`{removed: n}`**: ‏definer, ‏`search_path=''`, ‏grant ל-`authenticated` בלבד, בלי idempotency (AD-5). שורה ראשונה: ‏`auth.uid()` ריק, או לא (`current_customer_id()` לא ריק או `is_admin()`) ← ‏`NOT_AUTHORIZED`. קלט לא תקין ← ‏`INVALID_INPUT`. ‏register מוחק את ה-endpoint מכל משתמשת אחרת ומכניס/מעדכן לשלה (`last_seen_at = now()`). ‏unregister מוחק רק אם ה-endpoint שלה.
- **`claim_push_jobs(p_limit int)` ← ‏jsonb array** ו-**`finish_push_job(p_job_id, p_delivered uuid[], p_gone uuid[], p_error text)` ← ‏`{status}`**: ‏grant ל-`service_role` בלבד, שורה ראשונה `(select auth.role()) = 'service_role'` אחרת `NOT_AUTHORIZED`, פטורים מ-idempotency (AD-5). ‏claim: ‏`for update skip locked`, לוקח `queued` עם `next_attempt_at <= now()` ו-`sending` שה-lease שלהן עבר; מסמן `sending`, ‏`lease_until = now() + 2 min`, ‏`attempt_count + 1`. לכל משימה מחזיר `job_id`, ‏`title`, ‏`body`, ‏`target_path` מ-`notifications`, ואת המנויים של `recipient_id` שאין להם שורה ב-`notification_deliveries` של המשימה. משימה בלי מנויים כאלה, או שנוצרה לפני יותר מ-24 שעות (`notifications.created_at`), נסגרת `skipped` ב-claim ולא מוחזרת. ‏finish: רושם deliveries (`on conflict do nothing`), מוחק את `p_gone` (רק מנויים של אותה נמענת), ואז: בלי שגיאה ← ‏`sent`; עם שגיאה ו-`attempt_count < 5` ← ‏`queued` עם backoff ‏1/5/15/60 דקות; אחרת ← ‏`failed`. ‏`last_error` רק קוד/סטטוס, עד 200 תווים, בלי endpoint.
- **סטטוס חדש `skipped`** ל-`notification_jobs` (בלי מנויים, או התיישנה). ה-check ו-`finished_check` מוחלפים (`drop constraint`, ראו משימה 1). אינדקס `(status, next_attempt_at)`.
- **`private.invoke_push_worker()`**: ‏definer, ‏`search_path=''`, ‏revoke מכולם. קורא `app_url` ו-`cron_secret` מ-`vault.decrypted_secrets`; חסר אחד ← לא עושה כלום. ‏`net.http_post(app_url || '/api/jobs/push', headers Bearer, timeout_milliseconds := 10000)`. **`private.job_invoke_push_worker()`** קורא לו רק כשיש משימה מוכנה (queued בזמן או lease שעבר), כדי לא להעיר את Vercel כל דקה. ‏`cron.schedule('invoke_push_worker', '* * * * *', …)`. ההפעלה של pg_cron (3.12) לא משתנה. `create extension if not exists pg_net`.
- **ערכי Vault, ‏VAPID ו-`CRON_SECRET` לא נכנסים לשום קובץ ב-repo.** המיגרציה יוצרת מבנה בלבד. ‏`NEXT_PUBLIC_VAPID_PUBLIC_KEY` הוא היחיד שמותר בדפדפן; ‏`VAPID_PRIVATE_KEY`, ‏`VAPID_SUBJECT`, ‏`CRON_SECRET` רק בשרת.
- **`app/api/jobs/push/route.ts`**: ‏`POST` בלבד, ‏`runtime = 'nodejs'`, ‏`maxDuration = 60`, ‏`Cache-Control: no-store`. בלי `CRON_SECRET` ב-env ← ‏503; ‏Bearer חסר או שגוי ← ‏401 (השוואה ב-sha256 ‏+ ‏`timingSafeEqual`, עזר משותף עם `lib/site-lock.ts`). חסר VAPID ← ‏503. מחזיר `{claimed, sent, failed, skipped}` בלי מזהים אישיים. לוג: רק מזהי משימה וקודי סטטוס (AD-22).
- **העובד** (`lib/server/privileged/push-worker.ts`, ‏`import "server-only"`, ‏`createServiceClient` + ‏`callRpc`): לולאה של claim (‏25) עד ~45 שניות. לכל משימה שולח לכל מנוי במקביל עם `TTL` של 24 שעות; הצלחה ← ‏delivered; ‏404/410 ← ‏gone; ‏401/403 ושאר כשלים ← שגיאה בלי מחיקה. ואז finish. ‏**payload** ‏`{title, body, target_path}` (החוזה של `sw.js`); ‏`body` מקוצר לפוש בלבד ל-300 תווים לכל היותר, בגבול מילה, עם "…". ‏`notifications.payload` לא משתנה. כשל פוש לא נוגע בהרשמות.
- **"לטיפול":** ‏`create or replace` על `admin_get_attention_items` מהגרסה ב-`20261006110524_legal_pages.sql` (או המאוחרת שבה ב-main בזמן הכתיבה), כל הענפים הקיימים נשמרים. ענף אחד `push_failed` שמסכם `failed` מ-7 הימים האחרונים: ‏`id` קבוע, ‏`since` = הכשל האחרון, ‏`count`, ‏`customer_label` null. נעלם כשאין כשלים בשבוע. קישור ל-`/admin/notifications`.
- **ממשק** (מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md): ‏`push-card` במקום השמור בשני מרכזי ההתראות, עם מצבים: לא נשאלה ← משפט אחד, ‏`button-primary` "כן, להפעיל התראות" ו-`button-link` "לא עכשיו"; פועל במכשיר ← שורה "התראות פועלות במכשיר הזה" ו"לכבות"; "לא עכשיו" ← שורה מכווצת "התראות כבויות" עם "להפעיל" (לא נפתח שוב לבד); נחסם בדפדפן ← "התראות כבויות" והסבר להפעלה מהגדרות המכשיר, בלי כפתור; לא נתמך ← הסבר שההתראות נשארות כאן; אייפון לא מותקן ← הסבר וקישור ל-`/install`. "לא עכשיו" נשמר ב-`localStorage` לכל מכשיר (בתוך try/catch). ‏`Notification.requestPermission()` רק מלחיצה. קופי ב-`lib/copy/shell.ts`, בלי "טל" בנוסח ללקוחה.
- **סנכרון:** רכיב לקוח קטן ב-layout של `/me` וב-`/admin/(shell)`: כשההרשאה `granted` ויש SW, מביא/יוצר מנוי ומריץ register (Server Action ← ‏`callRpc`). כך מכשיר שעבר בין חשבונות משויך לחשבון הנוכחי.
- **התנתקות:** הטופס ב-`app-top-bar` שולח גם את ה-endpoint הנוכחי (שדה מוסתר שממולא בצד הלקוח); ‏`signOutAction` קורא ל-`unregister_push_subscription` לפני `signOut`, וכשל בו לא חוסם התנתקות. המנוי בדפדפן נשאר.
- ‏`test/sw.test.ts` ו-`lib/site-lock.test.ts` עוברים בלי שינוי; רשימת הפטור נשארת `["/api/jobs/"]`.

**Never:** נגיעה ב-`notification_templates`, ‏`render_notification_text`, ‏`enqueue_notification` או בסוגי ההתראות (4.7); שינוי הסרגל העליון מעבר לשדה המוסתר בטופס ההתנתקות; ‏`/api/push/*` או כתיבה ישירה ל-`push_subscriptions`; שליחת פוש מתוך עסקה; Vercel Cron; בדיקה חוזרת של `waitlist_spot` (עברה ל-5.6); ‏`job_reminders` (5.17); ניקוי משימות (5.10); מטמון של `/api` ב-SW.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| שליחה | משימה queued, ללקוחה 2 מנויים | שני פוש, 2 deliveries, ‏`sent` |
| retry | מנוי 1 הצליח, מנוי 2 כשל 500 | ‏`queued` + backoff; בניסיון הבא נשלח רק ל-2 |
| מנוי מת | ‏410 / ‏404 | המנוי נמחק; המשימה `sent` אם אין שגיאה אחרת |
| ‏403 | ‏VAPID_SUBJECT שגוי | המנוי נשאר, שגיאה, ‏backoff |
| אחרי 5 ניסיונות | כשל קבוע | ‏`failed`, פריט `push_failed` ב"לטיפול" |
| בלי מנויים | נמענת בלי מנוי | ‏`skipped`, בלי קריאה לשירות |
| התיישנה | משימה queued שנוצרה לפני 25 שעות, יש מנוי | ‏`skipped`, בלי שליחה; ההתראה במרכז נשארת |
| lease פג | ‏`sending` עם `lease_until < now()` | נלקחת שוב, בלי כפילות למי שקיבל |
| מקביליות | שני עובדים במקביל | כל משימה נלקחת פעם אחת |
| נתיב | בלי `CRON_SECRET` / בלי Bearer / סוד שגוי / ‏GET | ‏503 / ‏401 / ‏401 / ‏405 |
| Vault ריק | אין `app_url` | ה-cron רץ, אין קריאת רשת |
| register | ‏endpoint שרשום אצל B | עובר ל-A, אצל B נמחק |
| unregister | ‏endpoint של B | ‏`removed 0`, של B נשאר |
| לא מורשית | ‏anon; משתמשת בלי פרופיל פעיל; ‏authenticated קוראת ל-claim | ‏42501; ‏`NOT_AUTHORIZED`; ‏42501 |
| גוף ארוך | ‏broadcast של 2000 תווים | פוש עם ≤300 תווים ו-"…"; ההתראה במרכז מלאה |
| אדמין | ‏`admin_card_expiring` | מגיע למנויים של האדמין, לחיצה פותחת `/admin…` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001184225_create_notification_core.sql:144` -- ‏`notification_jobs` (checks ‏`notification_jobs_lease_check`/`_finished_check`, אין אינדקסים), ‏`notifications` ‏(`payload.title/body`, ‏`target_path`).
- `supabase/migrations/20261006110524_legal_pages.sql:26` -- הגרסה האחרונה של `admin_get_attention_items`: ‏CTE ‏`items(since, id, item)` עם `union all`; תבנית הענף הקרובה: `media_stuck` (l.205). הרשאות בסוף (l.248).
- `supabase/migrations/20261006111121_session_completion_job.sql:14,290` + `20261006142736_session_completion_review_fixes.sql:17` -- תבנית `cron.schedule` ותבנית job ‏definer בלי grant.
- `supabase/tests/support/db.ts` -- ‏`inRollback`, ‏`asAuthenticated`, ‏`asServiceRole` (l.214, ‏`reset role` לחזרה), ‏`insertAuthUser`, ‏`testName`, ‏`onCleanup`. תבנית: `supabase/tests/join.test.ts`, ‏`session-completion.test.ts:680` (בדיקת שורת `cron.job`), ‏`admin-home.test.ts:156`.
- `supabase/tests/grants.test.ts:15` -- ‏`EXPECTED_GRANTS` ממוין; מוסיפים 4 RPC (ו-grant לטבלה אם יש).
- `lib/rpc.ts:38` -- ‏`callRpc` עובד גם עם service client. `lib/server/privileged/service-client.ts` -- ‏`createServiceClient()`.
- `lib/site-lock.ts:90` -- ‏`sameSecret` (sha256 + ‏timingSafeEqual) לא מיוצא; מוציאים לעזר משותף בלי לשנות התנהגות. l.14 רשימת הפטור.
- `eslint.config.mjs:91` -- ‏`app/api/**` רשאי לייבא `lib/server/privileged`.
- `public/sw.js:139,156,169` -- ‏`readPayload`, ‏`push`, ‏`notificationclick` (‏`safeTarget`) כבר קיימים. משנים רק אם צריך, ואז מעלים `VERSION` (l.23). ‏`test/sw.test.ts`.
- `components/shared/service-worker-register.tsx` -- רישום רק ב-production. רכיב הסנכרון מחכה ל-`navigator.serviceWorker.ready`.
- `app/me/notifications/page.tsx:22`, `app/admin/(shell)/notifications/page.tsx:22` -- המקום השמור לכרטיס.
- `app/me/layout.tsx:27`, `app/admin/(shell)/layout.tsx:32` -- מקום לרכיב הסנכרון.
- `lib/auth/sign-out.ts:16` -- ‏`signOutAction`; ‏`components/shared/app-top-bar.tsx:56` הטופס.
- `app/admin/(shell)/home-items.ts:20,111,190` + `lib/copy/admin.ts:672` -- ‏`AttentionRow`, ‏`switch(kind)`, וקופי של פריטים; ‏`home-items.test.ts`.
- `lib/copy/shell.ts:41` -- ‏`shellCopy.notifications`; קופי הפוש נכנס לידו. `lib/errors.ts` -- קודים קיימים בלבד (`NOT_AUTHORIZED`, ‏`INVALID_INPUT`).
- `app/(public)/install` -- יעד ההסבר באייפון. `package.json` -- ‏`web-push` ו-`@types/web-push` כבר מותקנים.
- `README.md:76-103` -- ‏checklist לכל סביבה (Vault, ‏VAPID, ‏`CRON_SECRET`).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_push_pipeline.sql` -- ‏`npx supabase migration new push_pipeline`; כל המבנה שלמעלה. בגלל ה-`drop constraint`: **סשן ראשי**, המשתמשת מריצה ב-SQL Editor ואז רישום ב-`schema_migrations`, ‏`get_advisors`, ‏`generate_typescript_types` ל-`lib/supabase/database.types.ts`.
- [x] `supabase/tests/push.test.ts`, `supabase/tests/grants.test.ts` -- כל שורות המטריצה ברמת המסד (claim/finish/register/unregister/skipped/backoff/lease/מקביליות/הרשאות/`push_failed`/שורת `cron.job`/Vault ריק בלי קריאה).
- [x] `lib/server/secret.ts` (או דומה), `lib/site-lock.ts` -- עזר `sameSecret` משותף.
- [x] `lib/server/privileged/push-worker.ts` (+`.test.ts` עם web-push מדומה) -- העובד, הקיצור, מיפוי סטטוסים.
- [x] `app/api/jobs/push/route.ts` (+`.test.ts`) -- הנתיב והסטטוסים.
- [x] `lib/push/client.ts` (+`.test.ts`) -- ‏`urlBase64ToUint8Array`, זיהוי פלטפורמה, זיהוי מצב (נתמך, מותקן, הרשאה).
- [x] `components/shared/push-card.tsx`, `components/shared/push-sync.tsx`, `app/me/notifications/actions.ts`, `app/admin/(shell)/notifications/actions.ts`, שני דפי המרכז ושני ה-layouts -- **מתחילים בסקיל `frontend-design`**. ‏actions של register/unregister.
- [x] `lib/auth/sign-out.ts`, `components/shared/app-top-bar.tsx` -- ‏unregister בהתנתקות.
- [x] `app/admin/(shell)/home-items.ts`, `lib/copy/admin.ts`, `lib/copy/shell.ts` (+בדיקות) -- ‏`push_failed` וקופי.
- [x] `README.md` -- ‏checklist; `_bmad-output/implementation-artifacts/deferred-work.md` -- ‏4.6 מוחק מנויים ב-`admin_anonymize_customer`; שורה בפרופיל והצעה אחרי הרשמה ראשונה (החלטה 2).
- [ ] **סשן ראשי / המשתמשת:** יצירת VAPID ו-`CRON_SECRET` ישירות ל-`.env.local` בלי הדפסה; הכנסה ל-Vercel (production ו-preview); ‏`vault.create_secret` ל-`app_url` (כתובת ה-production) ול-`cron_secret` ב-SQL Editor.

**Acceptance Criteria:**
- Given לקוחה או אדמין שהפעילו התראות והאפליקציה סגורה, when נכנסת להן התראה עם פוש, then הפוש מגיע תוך דקה (Android ואייפון מותקן), ולחיצה פותחת את `target_path`.
- Given לקוחה לחצה "לא עכשיו" או חסמה, when היא נכנסת שוב, then הכרטיס לא נפתח ובקשת הדפדפן לא מוצגת.
- Given מכשיר שלא תומך או אייפון לא מותקן, when נפתח מרכז ההתראות, then מוצג הסבר (ובאייפון קישור ל-`/install`), וההתראות במרכז עובדות.
- Given התנתקות, when מתבצעת, then המנוי של המכשיר נמחק מהמסד.
- Given ה-SW אחרי השינוי, when מתקינים מאחורי הנעילה, then ההתקנה והאופליין עובדים כמו ב-5.9.

## Implementation Notes

- המיגרציה נכתבה (`20261006184326_push_pipeline.sql`) ולא הוחלה (סשן ראשי, בגלל `drop constraint`). היא נבדקה בתוך עסקה שהתגלגלה אחורה: כל `push.test.ts` (חוץ משתי בדיקות שצריכות מיגרציה מוחלת: שני עובדים ושורת `cron.job`), ‏`admin-home.test.ts`, ורשימת ה-grants (תואמת, חוץ משלוש שורות של 4.7 שכבר במסד הפיתוח). ‏`database.types.ts` עודכן ידנית; ליצור מחדש אחרי ההחלה.
- ‏`export const runtime = "nodejs"` נדחה ב-build: עם `cacheComponents` ‏Next 16 לא מקבל `runtime`. ‏Node הוא ברירת המחדל, ולכן הוסר.
- ‏claim: משימה בלי מנוי שעוד לא קיבל, שכבר נמסרה למנוי אחר, נסגרת `sent` (לא `skipped`). ‏`sending` שה-lease שלה פג אחרי הניסיון החמישי נסגרת `failed` עם `LEASE_EXPIRED`, כדי שנפילות חוזרות לא יספרו ניסיונות בלי סוף. משימות שנסגרות ב-claim לא נספרות ב-`p_limit`.
- תשובת הנתיב: `failed` = משימות שהסתיימו בשגיאה בניסיון הזה (חזרו לתור או נכשלו סופית); `skipped` = משימות שהסגירה שלהן לא נרשמה (ה-lease יחזיר אותן).
- "לכבות" מבטל את המנוי בדפדפן ומוחק אותו מהמסד, ונשמר כמו "לא עכשיו" (`push-choice` ב-`localStorage`), כדי שהסנכרון לא ירשום אותו שוב.
- ‏`.env.example` לא עודכן (סוכן משנה לא כותב ל-`.env*`): להוסיף `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, ‏`VAPID_PRIVATE_KEY`, ‏`VAPID_SUBJECT`, ‏`CRON_SECRET` עם הסבר, בלי ערכים.
- **סשן ראשי, 2026-10-06:** המשתמשת החילה את המיגרציה ב-SQL Editor (‏cron job 162); נרשמה ב-`schema_migrations`; ‏`get_advisors` נקי (רק INFO של RLS בלי policy, ‏0029 ו-leaked password); ‏`database.types.ts` נוצר מחדש (כולל אובייקטים של 4.7 ו-4.9 שכבר במסד). ‏`push.test.ts` (כולל שני עובדים ושורת `cron.job`) עובר; ‏`grants.test.ts` שונה רק ב-18 שורות של 4.7/4.9; ‏`admin-home.test.ts` עובר (בדיקה אחת חרגה מ-5 שניות בריצה המשותפת ועברה לבד). ‏`npm test`, ‏lint, ‏typecheck, ‏format ו-build עוברים.

- **בדיקה בטלפון אחרי המיזוג (2026-10-06), מול production עם Vault מלא:** ‏Android כלקוחה וכאדמין: פוש מה-cron (‏`invoke_push_worker` ← ‏200) הגיע תוך פחות מדקה כשהאפליקציה סגורה, בשם האפליקציה המותקנת (אחרי התקנה מחדש מ-`brunch-at-tals.vercel.app`; התקנה ישנה מכתובת preview הציגה את ההתראה כשל Chrome), ולחיצה פתחה את מרכז ההתראות. התנתקות מחקה את מנוי הלקוחה והמכשיר נרשם לאדמין לבד; מנוי שבוטל בטלפון (410) נמחק; ‏16 המשימות הישנות נסגרו `skipped`. במצב המכווץ Android חותך כותרת ארוכה (נוסח התבנית, 4.7). ‏Chrome במחשב הפיתוח לא מציג אף הודעה מאז 2025-07 (תקלה מקומית). אייפון: לא נבדק (deferred-work).

## Spec Change Log

## Review Triage Log

**סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment):** ‏6 patch, ‏1 defer.

| # | ממצא | פסק | ניתוב | ראיה / פעולה |
|---|---|---|---|---|
| 1 | ‏`PushEndpointField` קורא את ה-endpoint רק ב-mount; הפעלה או כיבוי באותו ביקור ← התנתקות בלי מחיקת המנוי | medium | patch | הסרגל ב-layout ולא נטען מחדש; קריאה מחדש ב-`PUSH_CHANGE_EVENT` |
| 2 | ‏`SignOutButton` (‏`/login`, ‏`/join`) שולח ל-`signOutAction` בלי `push_endpoint` | medium | patch | הוספת השדה וטסט |
| 3 | ‏`lib/push/server.ts` בלי בדיקות | medium | patch | ‏`server.test.ts` |
| 4 | ‏`VAPID_SUBJECT` לא תקין מתקבל ← כל משימה `NETWORK` ו-5 ניסיונות | low | patch | ‏`vapidFromEnv` דורש `mailto:`/`https://` ← 503 |
| 5 | בדיקת "בלי טל" נכשלת על "לבטל" | low | patch | lookbehind |
| 6 | ‏`epic-5-context.md` סותר את ההחלטות (נוסח הכפתור, פרופיל, הצעה אחרי הרשמה, `id` uuid) | low | patch | תיקון השורות |
| 7 | צנרת שלא עובדת (Vault/סוד/כתובת שגויים) לא מופיעה ב"לטיפול": המשימות נסגרות `skipped` אחרי 24 שעות | medium | defer | ‏AD-22 מונה Vault חסר ו-job שנכשל; נרשם ל-5.10 |

נדחו (14): קליק התנתקות לפני שה-endpoint נטען, ‏unregister ללקוחה לא פעילה, כשל ב"לכבות", החלפת מפתח VAPID, ‏finish שנכשל אחרי שליחה, ‏endpoint שעבר חשבון בין claim ל-send, ‏payload גדול מכותרת, מצב "פועל" בלי מנוי אחרי רענון, ‏`secret.ts` בלי server-only, הערת Vercel כשאין מנויים (low ולא סביר או התיקון מוסיף מורכבות); ‏fencing ב-finish (‏Vercel עוצר ב-60 שניות, ה-lease 2 דקות); משימה פגומה מפילה מנה (ה-check על `payload` מבטיח title/body); ‏Verification לא תואם (תיקון ב-spec; עודכן ב-Implementation Notes); ‏16 המשימות ובדיקת המחשב (תלויים בהגדרות של הסשן הראשי, לא בקוד).

## Design Notes

**למה העובד מעיר רק כשיש עבודה:** ‏`job_invoke_push_worker` בודק ב-SQL אם יש משימה מוכנה לפני `net.http_post`. אחרת Vercel מקבל 1,440 קריאות ביום סתם.

**למה deliveries נרשמות ב-finish ולא לכל שליחה:** קריאה אחת למשימה. נפילה באמצע ← ה-lease פג תוך 2 דקות, וכפילות אפשרית רק במכשירים שקיבלו לפני הנפילה. מקובל: המקור אומר "אין הבטחה למסירת פוש".

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` -- עוברים.
- `npx vitest run --project db supabase/tests/push.test.ts supabase/tests/grants.test.ts supabase/tests/admin-home.test.ts` -- עוברים.
- `npm run build` -- עובר.
- ‏`get_advisors` (security) -- רק ‏0029 ו-leaked password.

**Manual checks:**
- ‏localhost (`npm run build && npm start`, ‏Chrome במחשב): הפעלה מהכרטיס, ‏`curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/jobs/push` אחרי התראה בדויה, ופוש מוצג; בלי Bearer ← 401.
- אחרי ההגדרות ב-Vercel וב-Vault: טלפון Android ואייפון מותקן, לקוחה ואדמין, אפליקציה סגורה ← פוש תוך דקה.
