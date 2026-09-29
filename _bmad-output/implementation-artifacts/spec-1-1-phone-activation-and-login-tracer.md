---
title: '1.1 Phone activation and login tracer — ניסוי הפעלה והתחברות בטלפון'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '4ddf5e6d74b41a1550e33fb7cf5b1ea615dbaff1'
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

**Problem:** אין הוכחה שלקוחה יכולה לקבל קישור חד-פעמי בלי מייל, לבחור סיסמה ולהישאר מחוברת בטלפון. כל האפיקים נשענים על זה.

**Approach:** migrations ראשונות, מתזמר איפוס, מסכי `/reset/[token]`, `/login` ו-`/me` מינימליים, וסקריפט dev שמדפיס קישור איפוס ללקוחה בדויה.

## Boundaries & Constraints

**Always:** AD-3, AD-4, AD-5 (grants מפורשים, `search_path = ''`, בדיקת קוראת ראשונה, grant אחד), AD-10 (טוקן נוצר ונמצא רק ב-SQL, רק גיבוב נשמר, 48 שעות), AD-16 (נתיב טוקן: `no-referrer`, `no-store`, בלי צד שלישי). פתיחת קישור לא צורכת אותו; קישור חלופי מבטל את הקודם. אין טוקן, סיסמה, מייל או שם בלוגים. נתונים בדויים בלבד.

**Never:** idempotency, יומן ו-`callRpc` (1.4); הגבלת קצב (E2); `admin_issue_link` (2.8); join/claim (E2); עיצוב ומעטפות (1.5); ESLint ו-CI (1.2); תשתית `pg` (1.3); push ל-main; `createServiceClient` מ-`lib/supabase/server.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| קישור תקף | `pending`, לא פג | טופס "בחירת סיסמה חדשה" |
| שמירה | סיסמה תקינה ותואמת | Auth מתעדכן, טוקן `consumed`, הלקוחה מחוברת, "הסיסמה החדשה נשמרה" + כפתור לאזור האישי (אם ההתחברות נכשלה: קישור ל-`/login`) |
| כבר מומש | `consumed` | "הקישור הזה כבר שימש לאיפוס סיסמה" + התחברות |
| פג / בוטל / לא קיים | — | "תוקף הקישור עבר. טל תשמח לשלוח קישור חדש" (בלי הבחנה) |
| קלט שגוי | קצרה מ-8 / לא תואמות | שגיאת שדה, בלי קריאה ל-Auth |
| כשל באמצע | Auth עודכן, `reset_complete` נכשל | ניסיון חוזר משלים |
| התחברות | נכונה / שגויה | `next` פנימי או `/me` / "המייל או הסיסמה לא תואמים" (`role="alert"`) |
| `/me` בלי לקוחה פעילה | אורחת או אדמין | הפניה ל-`/login?next=/me` |
| הרשאות | `anon`/`authenticated` ל-RPC של service role | נדחה |

</frozen-after-approval>

## Code Map

- `lib/supabase/server.ts` -- להוציא ממנו את `createServiceClient`; `createClient` נשאר ומשמש להתחברות בשרת.
- `lib/supabase/{client,proxy}.ts`, `proxy.ts` -- רענון session קיים. רק להוסיף `Database`.
- `next.config.mjs` -- כבר עם `cacheComponents: true`.
- `components/ui/{button,input,label,field,alert}.tsx` -- לשימוש, לא לעריכה.
- מסד dev ריק. `pgcrypto` ב-schema `extensions`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*_revoke_default_privileges.sql` -- ביטול default privileges ב-`public` וב-`private` מכל התפקידים (כולל `service_role`), יצירת `private`, usage ל-`authenticated` בלבד.
- [x] `supabase/migrations/*_create_identity_and_reset_tokens.sql` -- `profiles`, `admin_roles` ו-`activation_tokens` עם RLS; `private.{is_admin,current_customer_id,issue_token,find_token}`; `get_my_session_role` (authenticated); `issue_reset_token`, `reset_begin`, `reset_complete`, `token_view` (service_role); select ו-insert ל-service_role על `profiles` ו-`admin_roles`.
- [x] `lib/supabase/database.types.ts` -- יצירה ב-MCP ושימוש בכל הלקוחות.
- [x] `lib/server/privileged/service-client.ts` -- `server-only` (להתקין), לקוח בלי session.
- [x] `lib/server/privileged/reset.ts` -- `getResetTokenView`, `completeReset`: begin ← `updateUserById` ← complete.
- [x] `lib/errors.ts`, `lib/copy/auth.ts` -- קודי שגיאה ומיקרו-קופי.
- [x] `app/(auth)/reset/[token]/`, `app/(auth)/login/`, `app/me/` -- דפים, טפסים ו-actions. `/me`: בדיקת תפקיד ב-`<Suspense>`, ברכה, התנתקות.
- [x] `next.config.mjs` -- כותרות ל-`/reset` ול-`/me`; `allowedDevOrigins` מכתובות ה-IP הפרטיות של המחשב.
- [x] `scripts/dev-reset-link.mjs` + `npm run dev:reset-link` -- יוצר או מוצא אדמין ולקוחה `@example.com` עם סיסמה אקראית שלא מודפסת, ומדפיס קישור ל-localhost ולרשת; `--admin` לאדמין.
- [x] `lib/auth/safe-next.ts` + בדיקה -- `next` פנימי בלבד.

**Acceptance Criteria:**
- Given migrations הוחלו, when מריצים security advisor, then אין WARN/ERROR.
- Given שאילתות SQL שמתגלגלות אחורה, then `anon`/`authenticated` נדחים מ-RPC של service role ומ-`private`, והמצבים שבמטריצה מתקיימים.
- Given קישור מהסקריפט, when הלקוחה בוחרת סיסמה בטלפון, then היא ב-`/me`, נשארת מחוברת אחרי סגירה, והקישור מציג "כבר שימש".
- Given `curl -I /reset/<token>`, then `Referrer-Policy: no-referrer` ו-`no-store`.

## Implementation Notes

- **`get_my_session_role` הוא `security invoker`** (migration `make_session_role_invoker`). כ-definer ה-security advisor מחזיר WARN (lint 0029, פונקציית definer ב-`public` שזמינה ל-`authenticated`), וה-AC דורש advisor נקי. הפונקציה קוראת רק ל-`private.is_admin()` ול-`private.current_customer_id()`, שהן definer, ולכן זה בטוח. **שאלה פתוחה לארכיטקטורה:** AD-5 קובע שכל RPC ב-`public` הוא definer. כל RPC עתידי של `authenticated` יקבל את אותו WARN, וצריך להחליט אם לקבל אותו או לשנות את הכלל.
- ביטול ה-EXECUTE ל-`PUBLIC` על פונקציות נעשה גם גלובלית (`alter default privileges for role postgres revoke execute on functions from public`), כי ב-Postgres ביטול לפי schema לא מסיר את ברירת המחדל הגלובלית.
- הטוקן עובר לפעולת השרת בשדה נסתר ולא ב-`.bind`: עם ארגומנט מקושר, שליחה בלי JS נתקעה (לא הוחזרה תשובה).
- `next dev` (16.3) מוסיף בלוק `nextjs-agent-rules` ל-`AGENTS.md` בכל הרצה. השינוי בוטל ולא נכלל. אפשר לכבות עם `agentRules: false` ב-`next.config.mjs`, לפי החלטת המשתמשת.
- שורות המטריצה ברמת המסד (הרשאות, מעברי מצב של הטוקן, קישור חלופי שמבטל את הקודם) נבדקו בשאילתות SQL שמתגלגלות אחורה, ויקבלו כיסוי אוטומטי כש-1.3 תבנה את תשתית בדיקות ה-`pg`. שורות המתאם מכוסות ב-Vitest עם mocks.
- לוג ה-Server Functions של `next dev` כבוי (`logging.serverFunctions: false`), כי הוא מדפיס את הארגומנטים (טוקן, נתוני טופס).

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment).

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | `safeNext` מחזיר `//evil.example` לקלט `/..//evil.example` | high | אומת ב-node: אחרי נרמול ה-pathname מתחיל ב-`//`, ו-`redirect` מוביל לדומיין זר | patch |
| 2 | `loginAction` מציג "מייל או סיסמה לא תואמים" גם בתקלת רשת (status 0) וב-429 | medium | הקוד ממפה כל status מתחת ל-500 ל-INVALID_CREDENTIALS | patch |
| 3 | `requireCustomer` לא מקודד את `next` | low | `` `/login?next=${next}` `` בלי `encodeURIComponent`. תיקון ישיר | patch |
| 4 | ההערה "lock + check" ב-`reset.ts` מטעה: הנעילה משתחררת לפני `updateUserById` | low | ה-`for update` מסתיים עם העסקה של `reset_begin`. תיקון הערה בלבד | patch |
| 5 | אין בדיקה לסדר המסכים ב-`ResetForm` (הצלחה מול "כבר שימש" אחרי רענון) | medium | אומת: אין בדיקות רכיב, וסדר הענפים הוא מה שמבטיח את מסך ההצלחה | patch |
| 6 | אין בדיקה לכותרות ולהחרגות הלוג ב-`next.config.mjs` | medium | אומת: אף בדיקה לא מייבאת את הקונפיג | patch |
| 7 | אין בדיקה ש-`signOutAction` מתנתק | low | אומת: אין הפניה ל-`signOutAction` באף קובץ בדיקה | patch |
| 8 | אדמין אחרי איפוס, ומשתמשת מחוברת שאינה לקוחה, נכנסות ללולאה `/me` ← `/login` בלי הודעה | medium | ההפניה עצמה נדרשת במטריצה. היעד של אדמין תלוי באזור האדמין, שעוד לא קיים | defer |
| 9 | איפוס סיסמה לא מנתק sessions קיימים | medium | `updateUserById` לא מבטל refresh tokens. זו החלטת מוצר ואבטחה שלא נקבעה | defer |
| 10 | ניסיון חוזר עובר דרך `reset_begin`, ולכן קישור שפג בין הניסיונות, או תשובה של `reset_complete` שאבדה, מציגים "פג" או "כבר שימש" אחרי שהסיסמה כבר נשמרה. הענפים של `reset_complete` לא נגישים | medium | אומת בקוד. שורת המטריצה עצמה (complete נכשל, הקישור עדיין pending) עובדת. תיקון דורש מצב ביניים, בניגוד ל-Design Notes | defer |
| 11 | אין בדיקות מסד אוטומטיות להרשאות, למעברי מצב ולביטול בקישור חלופי | medium | נבדק ידנית ב-SQL שמתגלגל אחורה. התשתית נבנית ב-1.3 | defer |
| 12 | `alter default privileges ... revoke execute on functions from public` גלובלי עלול לחסום פונקציות של הרחבות עתידיות | maybe-false (medium) | צריך לבדוק באיזה תפקיד Supabase יוצר הרחבות מהדשבורד | defer |
| 13 | `AGENTS.md` (שורה 57) עדיין אומר ש-`createServiceClient` ב-`lib/supabase/server.ts` | low | אומת. קובץ הקשר של סוכנים | defer |
| 14 | ביומני הבקשות של Vercel יופיע `/reset/<token>` | maybe-false (medium) | `logging.incomingRequests` משפיע רק על `next dev`. צריך לבדוק ב-1.6 מול Vercel | defer |
| 15 | `Cache-Control` מ-`next.config` נדרס בפרודקשן | false | המממש הריץ `curl -I` מול `next start` וקיבל `private, no-store` | reject |
| 16 | `token_view` מוגדרת `stable` וקוראת ל-`find_token` שהיא `volatile` | low | בענף בלי נעילה אין כתיבה. אין נזק מעשי | reject |
| 17 | שגיאת `token_view` מציגה את מסך השגיאה הכללי של Next | low | נדיר. תיקון מוסיף error boundary (מעטפות ב-1.5) | reject |
| 18 | שתי שליחות במקביל עם סיסמאות שונות: האחרונה גוברת | low | נדיר (שתי לשוניות). הלשונית שהפסידה מקבלת קישור להתחברות. תיקון דורש מצב ביניים | reject |
| 19 | `signOut` שנכשל ברשת משאיר cookie | low | נדיר. תיקון מוסיף ענף | reject |
| 20 | סיסמה מעל 72 בתים מוצגת כ-SERVER_ERROR | low | נדיר מאוד. תיקון מוסיף קוד שגיאה | reject |
| 21 | קישור שבוטל בין `updateUserById` ל-`reset_complete` | low | דורש הנפקה חוזרת באותה שנייה | reject |
| 22 | משתמשת Auth שנמחקה עם פרופיל שנשאר | low | אנונימיזציה לא קיימת עדיין | reject |
| 23 | `signInWithPassword` זורק חריגה | false | supabase-js מחזיר `error` ולא זורק | reject |
| 24 | ברכה עם שם ריק | false | השער מבטיח לקוחה פעילה, ולכן יש פרופיל ו-`full_name` הוא `not null` | reject |
| 25 | טופס ה-fallback ב-`/login` שולח בלי `next` | low | חלון זמן זעיר | reject |
| 26 | session של משתמשת אחרת מוחלף אחרי איפוס | false | זו ההתנהגות הרצויה: מי שאיפסה מחוברת | reject |
| 27 | הסקריפט: בלי הגנה מפרויקט לא נכון, `ignoreDuplicates` לא מתקן פרופיל, `lanAddresses` כפול | low | כלי dev בלבד, מול `.env.local` של dev | reject |
| 28 | `/me/*` מקונן חוזר ל-`/me` אחרי התחברות | low | אין עדיין נתיבים מקוננים | reject |
| 29 | `email_confirm: true` בסקריפט מול מקור שורה 359 | low | משתמשות בדויות ב-dev בלבד | reject |
| 30 | `LINK_USED` מנוסח לאיפוס, `FIELD_REQUIRED` לא בשימוש, ל-`/login` אין `no-store` | low | ניסוח ל-join יבוא ב-E2. אין נזק | reject |
| 31 | אחרי שמירה אין הפניה אוטומטית ל-`/me` | false | המטריצה מגדירה במפורש "נשמרה" + כפתור | reject |
| 32 | הקבצים `database.types.ts` ו-`package-lock.json` חסרים ב-diff | false | הוחרגו בכוונה מקובץ הסקירה כי הם נוצרים אוטומטית. הם קיימים בעץ העבודה | reject |
| 33 | IP שמשתנה בזמן ש-dev רץ | low | צריך רק להפעיל מחדש | reject |

## Design Notes

- **בלי מצב ביניים באיפוס** (דיאגרמת המצבים: pending ← consumed). `reset_begin` נועל, בודק ומחזיר את `bound_user_id`. `reset_complete` מסיים גם אם הקישור פג בינתיים, ומחזיר הצלחה על קישור שכבר מומש.
- **יעד האיפוס:** `bound_user_id` (לקוחה מופעלת או אדמין).
- **התחברות אחרי איפוס:** המייל מגיע מתשובת `updateUserById`, בלי קריאה נוספת ל-Admin API (AD-4).
- **`token_view`:** `state_public` אחד מ-active, used, expired, conflict, not_found. שדות המוצר ריקים עד E2.
- **cookie:** ‏400 יום, בלי `Secure`, ולכן אמור לעבוד ב-http ברשת הביתית.

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` -- expected: עוברים.
- `npm run dev:reset-link` פעמיים -- expected: קישור, בלי משתמשות כפולות.

**Manual checks:**
- בטלפון: קישור ← סיסמה ← `/me` ← סגירה ופתיחה ← מחוברת ← הקישור "כבר שימש".
