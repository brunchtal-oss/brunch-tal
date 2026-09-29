---
title: '1.1 Phone activation and login tracer — ניסוי הפעלה והתחברות בטלפון'
type: 'feature'
created: '2026-09-29'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] `supabase/migrations/*_revoke_default_privileges.sql` -- ביטול default privileges ב-`public` וב-`private` מכל התפקידים (כולל `service_role`), יצירת `private`, usage ל-`authenticated` בלבד.
- [ ] `supabase/migrations/*_create_identity_and_reset_tokens.sql` -- `profiles`, `admin_roles` ו-`activation_tokens` עם RLS; `private.{is_admin,current_customer_id,issue_token,find_token}`; `get_my_session_role` (authenticated); `issue_reset_token`, `reset_begin`, `reset_complete`, `token_view` (service_role); select ו-insert ל-service_role על `profiles` ו-`admin_roles`.
- [ ] `lib/supabase/database.types.ts` -- יצירה ב-MCP ושימוש בכל הלקוחות.
- [ ] `lib/server/privileged/service-client.ts` -- `server-only` (להתקין), לקוח בלי session.
- [ ] `lib/server/privileged/reset.ts` -- `getResetTokenView`, `completeReset`: begin ← `updateUserById` ← complete.
- [ ] `lib/errors.ts`, `lib/copy/auth.ts` -- קודי שגיאה ומיקרו-קופי.
- [ ] `app/(auth)/reset/[token]/`, `app/(auth)/login/`, `app/me/` -- דפים, טפסים ו-actions. `/me`: בדיקת תפקיד ב-`<Suspense>`, ברכה, התנתקות.
- [ ] `next.config.mjs` -- כותרות ל-`/reset` ול-`/me`; `allowedDevOrigins` מכתובות ה-IP הפרטיות של המחשב.
- [ ] `scripts/dev-reset-link.mjs` + `npm run dev:reset-link` -- יוצר או מוצא אדמין ולקוחה `@example.com` עם סיסמה אקראית שלא מודפסת, ומדפיס קישור ל-localhost ולרשת; `--admin` לאדמין.
- [ ] `lib/auth/safe-next.ts` + בדיקה -- `next` פנימי בלבד.

**Acceptance Criteria:**
- Given migrations הוחלו, when מריצים security advisor, then אין WARN/ERROR.
- Given שאילתות SQL שמתגלגלות אחורה, then `anon`/`authenticated` נדחים מ-RPC של service role ומ-`private`, והמצבים שבמטריצה מתקיימים.
- Given קישור מהסקריפט, when הלקוחה בוחרת סיסמה בטלפון, then היא ב-`/me`, נשארת מחוברת אחרי סגירה, והקישור מציג "כבר שימש".
- Given `curl -I /reset/<token>`, then `Referrer-Policy: no-referrer` ו-`no-store`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

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
