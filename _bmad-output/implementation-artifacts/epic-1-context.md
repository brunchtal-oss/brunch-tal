# Epic 1 Context: E1 תשתית: הפעלה והתחברות בטלפון

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

להקים את הבסיס שכל אפיק אחר נשען עליו: הרשאות מסד מפורשות, schema `private`, חוזה RPC אחד, עזרי זמן, כסף וטלפון, שלוש מעטפות, CI ואתר נעול. קודם כול, ניסוי (tracer) שמוכיח בטלפון אמיתי שלקוחה בדויה מפעילה חשבון בקישור חד-פעמי, בוחרת סיסמה, מתחברת ונשארת מחוברת, בלי שירות מייל או הודעות. אין כאן טבלאות או מסכים עסקיים.

## Stories

- Story 1.1: Phone activation and login tracer
- Story 1.2: Tooling, lint rules and CI
- Story 1.3: Time, money and phone helpers
- Story 1.4: RPC contract: idempotency, audit, errors, types
- Story 1.5: Design tokens, fonts and the three shells
- Story 1.6: Site lock, environments and preview deploy
- Story 1.7: Refactor sweep

## Requirements & Constraints

- התחברות במייל וסיסמה דרך Supabase Auth בלבד. אין ניתוק אוטומטי: לקוחה וטל נשארות מחוברות.
- אין ספק מייל: איפוס סיסמה הוא ידני, דרך קישור אישי וחד-פעמי שטל מפיקה. הזנת מייל לא מאמתת אותו.
- הרשמה ציבורית כבויה; חשבון נוצר רק דרך קישור תקף. Confirm email כבוי. "Automatically expose new tables" כבוי.
- קישור: טוקן אקראי חזק, במסד נשמר רק גיבוב, תקף 48 שעות, נצרך פעם אחת, פתיחה או תצוגה מקדימה לא צורכות אותו, והפקת חדש מבטלת את הקודם.
- סיסמאות, טוקנים וקישורים לא נשמרים ביומן, בלוג או במסד העסקי. לוג שרת מכיל רק מזהים וקודי שגיאה.
- נתונים בדויים בלבד. ה-repo ציבורי. אין push ל-main לפני שנעילת האתר קיימת (1.6).
- Done when של האפיק: הניסוי בטלפון; lint, typecheck ו-test ב-CI; בדיקות עזרי זמן, טלפון וכסף; security advisor נקי (WARN ‏0029 על RPC מסוג definer מאושר, AD-5); preview נעול.

## Technical Decisions

- **שכבות:** הליבה העסקית במסד (plpgsql, עסקה אחת לכל פעולה). Next.js מתאם דק: Server Components קוראים דרך RLS, Server Actions קוראים RPC ומחזירים `{ ok: true, data } | { ok: false, code }`.
- **זהות:** `profiles.id = auth.users.id`, בלי FK ל-`auth.users`. `private.current_customer_id()` מחזיר `auth.uid()` רק כשיש פרופיל עם `activated_at` ובלי `anonymized_at`, אחרת null. אדמין רק לפי `admin_roles` דרך `private.is_admin()`. מייל נשמר רק ב-`auth.users`.
- **הרשאות:** migration הראשונה מבטלת את ברירות המחדל של Supabase ב-`public` וב-`private` (כולל `service_role`), `revoke all on schema private from public`, ו-`grant usage on schema private to authenticated`. `private` לא חשוף ב-API. כל grant מפורש. RPC: `security definer`, `set search_path = ''`, בדיקת הרשאה בשורה הראשונה, revoke מכל התפקידים ואז grant אחד בדיוק (`authenticated` או `service_role`), אף פעם לא `anon`. RPC של service role בודק `(select auth.role()) = 'service_role'`. עזרים שנקראים מ-policy הם `security definer stable` בלי ארגומנטים.
- **שגיאות:** `raise exception '<CODE>' using errcode = 'P0001'`, קוד יציב באנגלית; מיפוי למיקרו-קופי רק ב-`lib/errors.ts`.
- **Idempotency ויומן:** חוזה מלא (`private.idempotency_results`, `audit_log`, `callRpc`) נבנה ב-1.4 ומוחל אז גם על RPC קודמים.
- **טוקנים:** נוצרים רק ב-SQL (`private.issue_token`: 32 בייט, base64url, sha256 hex במסד), נמצאים רק ב-`private.find_token`. מצבים: pending, awaiting_login, claiming, consumed, revoked, conflict; `expired` נגזר. איפוס: `reset_begin`/`reset_complete` (service role בלבד), מתוזמרים ב-`lib/server/privileged/reset.ts`. תצוגה דרך `token_view` שמחזיר רק שדות ציבוריים ולא משנה מצב. סדר נעילה: `activation_tokens` ואז `profiles`.
- **פעולה דו-שלבית:** RPC שכותב כוונה ← קריאה חיצונית ל-Auth Admin API (אידמפוטנטית) ← RPC סוגר. retry ממשיך מהמצב השמור.
- **service role:** רק ב-`lib/server/privileged/service-client.ts` עם `import "server-only"`; משמש רק ל-Auth Admin API לכתיבה, Storage בין buckets, RPC של service role ועובד הפוש. לא לקריאת נתוני לקוחות.
- **נתיבים:** `/login`, `/admin/login`, `/reset/[token]`, `/join/[token]` ב-`app/(auth)` בלי ניווט; `/me` דורש `get_my_session_role() = 'customer'`. `cacheComponents: true`: בדיקת תפקיד בתוך `<Suspense>`, `/me` ו-`/admin` דינמיים עם `private, no-store`. נתיבי טוקן: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, בלי משאבי צד שלישי, בלי רישום הנתיב בלוג.
- **Migrations:** `npx supabase migration new <verb>_<subject>`, מוחלת ב-MCP, סשן אחד בכל זמן, לא עורכים קובץ שהוחל. אחרי כל migration: security advisor ויצירת `lib/supabase/database.types.ts`.
- **Stack:** Next 16.3.x, React 19.2, TS 5.9, supabase-js 2.116, @supabase/ssr 0.12.7, Vitest 5, Node 24. פערים מול הקוד (server-only, zod, web-push, public.ts, כללי ESLint, engines) נסגרים לאורך האפיק.
- **בדיקות:** בדיקות מסד מקומיות מול dev דרך `pg` (1.3 בונה את התשתית), קידומת `test_<run-id>` ומחיקה; בדיקות טהורות ב-CI.

## UX & Interaction Patterns

- התחברות: מייל וסיסמה; "שכחתי סיסמה" מסביר שטל תשלח קישור, עם וואטסאפ לטל. כישלון: "המייל או הסיסמה לא תואמים", `role="alert"`, בלי לציין איזה שדה.
- קישור איפוס תקף: "בחירת סיסמה חדשה", סיסמה + אישור סיסמה (עם "הצגת סיסמה"), "לשמירת הסיסמה"; הצלחה: "הסיסמה החדשה נשמרה" + "כניסה לאזור האישי". כבר מומש: "הקישור הזה כבר שימש לאיפוס סיסמה" + התחברות. פג או בוטל: "תוקף הקישור פג. צרי קשר עם טל לקבלת קישור חדש".
- עברית, RTL, קודם לטלפון, כיווני Tailwind לוגיים בלבד.

## Cross-Story Dependencies

- 1.1 קודם לכול. אחריו 1.2, 1.5 ו-1.6 לא נוגעים במסד ויכולים לרוץ במקביל; 1.3 ואחריו 1.4 (migrations בטור).
- 1.4 מחיל idempotency ויומן גם על `reset_begin`/`reset_complete` של 1.1. 1.5 משתמש ב-`get_my_session_role` של 1.1. 1.6 מריץ את ניסוי 1.1 שוב דרך preview נעול.
- E2 מוסיף עמודות ל-`profiles` ובונה הצטרפות על תשתית הטוקנים; 2.8 מחליף את סקריפט ה-dev בכפתור `admin_issue_link`.
