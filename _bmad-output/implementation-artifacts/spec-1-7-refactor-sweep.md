---
title: '1.7 Refactor sweep — ניקוי סוף אפיק'
type: 'refactor'
created: '2026-10-01'
status: 'done'
baseline_commit: '371c8f1c3ebb19145401a2d55c9c9c7bc4004ee8'
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

**Problem:** בסוף E1 נשארו פריטים פתוחים ב-`deferred-work.md` וב-specs של 1.1–1.6: פערי בדיקות, אין כלל lint ל-`callRpc`, גובה שדות שסוטה מ-DESIGN, מסמכים שהתיישנו ושאריות טמפלייט.

**Approach:** לסגור את מה שנבחר בטבלת המיון (2026-10-01), להעביר פריטים עתידיים לסיפור היעד ולנקות את `deferred-work.md`. בלי יכולת חדשה ובלי migration.

## Boundaries & Constraints

**Always:** הקוד עובר בלי `eslint-disable`. כלל `no-restricted-syntax` חדש נכנס לקבוצות של `eslint.config.mjs` (רשומה מאוחרת מחליפה את כל הרשימה). בדיקות מסד רק עם עזרי `support/db.ts`; נתון שנכתב ב-commit נמחק ב-`onCleanup`. עברית רק בכלי Write/Edit, ואחרי כל כתיבה סריקת תווים בלתי נראים.

**Decisions (המשתמשת, 2026-10-01):**
- 48px ופוקוס, בלי לגעת ב-`components/ui/`: `h-12` בקוד האפליקציה לשדות ולכפתור הראשי (משני נשאר ≥44px). כלל CSS אחד ב-`globals.css` משאיר בפוקוס את מסגרת `[data-slot="input"]` ב-`--input`, חוץ משדה עם `aria-invalid`.
- SPINE מתעדכן כאן: שורת האכיפה (דפי הטוקן, כלל ה-RPC), מחיקת "פערי E1 מול הקוד", והחתימה `callRpc(client, name, args)`. נרשם ב-`.memlog.md` של הארכיטקטורה.
- נמחקים: `scripts/{install-mac.sh,install-windows.ps1,publish-to-r2.sh,setup.mjs}`, הסקריפט `setup` ב-`package.json`, `SETUP.md`, ו-`.gitkeep` ב-`lib/`, `components/`, `hooks/`. נשארים `scripts/check-config.mjs` (של `start-from-template`), `photos/` ו-`refrence-desing.md` (מקושרים מה-UX).
- `deferred-work.md`: מוסרים איפוס חוזר (נפתר ב-1.4), revoke גלובלי והרחבות (נבדק: ל-`supabase_admin` grants משלו; pgcrypto ו-uuid-ossp פתוחות ל-`authenticated`), יומני Vercel מ-1.1 (כפילות), `VERCEL_ENV` (אומת ב-1.6) וכל מה שנסגר כאן. עוברים עם יעד: טוקנים ביומני Vercel ← 5.15; manifest ו-service worker ← 5.8/5.9; check constraints ← הסיפור שיוצר את `business_settings` (4.7 או קודם); משתמשות Auth בדויות ← 2.2.

**Never:** migration; עריכת `components/ui/` או `brunch_at_tal_charecter.md`; יכולת או מסך חדשים; נגיעה ב-`agent/`, `.agents/`, `.claude/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| RPC ישיר | `supabase.rpc("x")` ב-`app/**` או `lib/**` | שגיאת lint |
| RPC מותר | `lib/rpc.ts`, קובצי בדיקה, `scripts/*.mjs` | עובר |
| תפקיד session | פרופיל מופעל / `admin_roles` / בלי פרופיל / עם `anonymized_at` | `customer` / `admin` / `none` / `none` |
| מצב קישור | `token_view`: תקף / נצרך / פג / לא קיים | `active` / `used` / `expired` / `not_found` |
| מקביליות | שני חיבורים, אותו scope, rpc, מפתח ו-request; הראשון בלי commit | השני ממתין, ואחרי ה-commit מקבל את התוצאה השמורה. שורה אחת ב-`idempotency_results`, בלי שגיאה |
| פוקוס בשדה | Tab לשדה תקין / עם `aria-invalid` | מסגרת `--input` + טבעת / מסגרת וטבעת השגיאה |

</frozen-after-approval>

## Code Map

- `eslint.config.mjs` -- הקבוצות ו-`restrictSyntax`. כללי syntax חלים רק על ts/tsx, ולכן `scripts/dev-reset-link.mjs:137` פטור. `lib/rpc.ts` צריך רשומה משלו. בדיקות ב-`test/eslint-rules.test.ts` (`lintText` עם `filePath` מדומה).
- `supabase/tests/reset.test.ts:23-50` (`createTarget`, `issue`) ו-`rls.test.ts` (`asAuthenticated`) -- לשימוש חוזר.
- `supabase/tests/support/db.ts` -- `getPool` (`max: 2`), `testName`, `onCleanup`. `private.idempotent_begin`/`finish` נקראות כ-owner, כמו ב-`idempotency.test.ts`.
- `app/globals.css:150-164` -- כלל הפוקוס הלא-שכבתי; הכלל החדש לא-שכבתי גם הוא, כדי לגבור על `focus-visible:border-ring` של shadcn.

## Tasks & Acceptance

**Execution:**
- [ ] `eslint.config.mjs`, `test/eslint-rules.test.ts` -- קבוצה `RPC_DIRECT` (`CallExpression[callee.property.name="rpc"]`, הודעה עם AD-17) בכל רשומות ts/tsx חוץ מבדיקות ו-`lib/rpc.ts`; בדיקות לשורות ה-lint במטריצה.
- [ ] `supabase/tests/session-role-and-token-view.test.ts` -- שורות "תפקיד session" ו"מצב קישור".
- [ ] `supabase/tests/idempotency-concurrency.test.ts` -- שורת המקביליות: שני חיבורים מה-Pool, commit אמיתי, `onCleanup` מוחק.
- [ ] `login-form.tsx:40,66`, `components/auth/password-input.tsx:21`, `reset-form.tsx:53,63,140`, `link-state-notice.tsx:19` -- `h-11` ← `h-12`. כפתורי outline ב-`min-h-11` נשארים.
- [ ] `app/globals.css`, `app/globals.test.ts` -- כלל המסגרת ובדיקה.
- [ ] מחיקות לפי ה-Decisions.
- [ ] `AGENTS.md:68` -- בדיקה בודדת עם `--project unit` (קובץ או `-t`), ולמה.
- [ ] `README.md:82` (Vercel) -- לא לכבות "Automatically expose System Environment Variables", כי הנעילה מזהה Vercel לפי `VERCEL_ENV`.
- [ ] `ARCHITECTURE-SPINE.md:235,295,494`, `.memlog.md` -- התיקונים ורשומת `(decision) USER 2026-10-01` באנגלית.
- [ ] `epic-1-context.md:59-60` -- 1.1–1.6 הושלמו; הלולאה נסגרה ב-1.5.
- [ ] `deferred-work.md` -- לפי ה-Decisions; לפריט שעבר מוסיפים `target:`.

**Acceptance Criteria:**
- Given ה-branch, then lint, typecheck, `npm test` ו-build עוברים.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then עובר, ואין שורות `test_%` במסד (גם ב-`private.idempotency_results`).
- Given `get_advisors` (security), then אין ממצא מעבר ל-`0029` ול-`auth_leaked_password_protection`.
- Given חיפוש בעץ, then אין הפניה לקבצים שנמחקו.

## Implementation Notes

- המחיקות נחסמו אצל סוכן המימוש בגלל מערכת ההרשאות. הסשן הראשי ביצע אותן אחרי אישור נוסף של המשתמשת, כולל הסרת `setup` מ-`package.json`. ‏`git grep` מחוץ ל-`agent/`, ‏`.agents/`, ‏`.claude/` ו-`_bmad/` לא מצא הפניות לקבצים שנמחקו.
- ב-SPINE נוספה לשורת האכיפה גם `.upsert(`, שכבר נאכף בקוד מאז 1.2.
- נבדק: lint, ‏typecheck, ‏`npm test` (413), ‏`npm run test:db` (129, ‏9 קבצים), build. אין שורות `test_%` במסד. ‏`get_advisors`: רק `auth_leaked_password_protection` (WARN) ו-INFO קיימים של `rls_enabled_no_policy` על טבלאות פנימיות.
- אחרי תיקוני הסקירה: lint, typecheck, `npm test` (416), `npm run test:db` (132, 9 קבצים) ו-build עוברים. אין שורות `test_%` ב-`profiles`, ב-`idempotency_results` וב-`audit_log`. ה-advisor ללא שינוי. בקוד אין תווים בלתי נראים; במסמכים רק U+200F, וב-`epic-1-context.md` גם 10 תווי U+200E שהיו שם לפני הסיפור.
- בדיקת המקביליות קוראת ל-`pg_stat_clear_snapshot()` לפני כל קריאה של `pg_stat_activity`, כי בתוך עסקה Postgres שומר את התמונה הראשונה.
- ‏Prettier מתריע על `test/eslint-rules.test.ts`, ‏`app/globals.test.ts` ו-`app/globals.css`. ההתרעה קיימת כבר ב-HEAD (כנראה סופי שורות), ולכן לא נגעתי.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 1, low 13, false 3. patch 4 (קבוצות), defer 1, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | `get_my_session_role` לא נבדק לפרופיל עם `activated_at` ריק | medium | verification-gap: הסרת התנאי מ-`current_customer_id` לא הייתה נתפסת. זה מקרה הלולאה מ-1.5 | patch |
| 2 | אין בדיקה לקדימות אדמין שיש לה גם פרופיל מופעל | low | הפונקציה בודקת `is_admin` קודם; אין בדיקה שמצמידה את זה. תוספת בדיקה ישירה | patch (עם 1) |
| 3 | `token_view` לא נבדק לקישור שבוטל בקישור חלופי | low | `reset.test.ts` בודק ביטול רק דרך `reset_begin` | patch (עם 1) |
| 4 | שם הבדיקה "expired after 48 hours" מטעה | low | היא קובעת `expires_at` לעבר ולא בודקת 48 שעות | patch (עם 1) |
| 5 | `RPC_DIRECT` נעקף ב-`.rpc.bind`, ב-`["rpc"]` וב-destructuring, וכך `lib/rpc.ts` לא באמת נבדק | low | אומת בסלקטור: רק `callee.property.name="rpc"` | patch + בדיקות |
| 6 | בדיקת המקביליות לא מוכיחה המתנה על נעילה, ועלולה לעבור את 5 השניות | low | המתנה של שנייה אחת בלבד; אין `testTimeout` ב-`vitest.config.mts` | patch: `pg_stat_activity` מחיבור A, timeout 30 שניות |
| 7 | כלל המסגרת בפוקוס רק ל-`input`, לא ל-textarea ול-select | low | `focus-visible:border-ring` גם ב-`textarea.tsx`, `native-select.tsx`, `select.tsx` | patch |
| 8 | AGENTS.md לא מזכיר את כלל ה-`.rpc(` ברשימת כללי ה-lint | low | אומת: AGENTS.md מפרט את שאר הכללים | defer (קובץ הקשר לסוכנים); נוסף אחרי אישור המשתמשת |
| 9 | `.claude/commands` מזכירים `npm run setup` שנמחק | false | הם מתארים שהתלמיד "כבר הריץ", ושורה 141 אומרת לא להריץ שוב. אין הוראה להריץ | reject |
| 10 | בדיקת המקביליות: rollback של A ו-request שונה לא נבדקים | low | לא במטריצה. מקרה ה-request השונה כבר נבדק בחיבור אחד | reject |
| 11 | אין בדיקה שקריאה מקבילה ל-RPC אמיתי מוסיפה שורת יומן אחת | low | היומן נכתב רק אחרי ש-`idempotent_begin` מחזיר null; החיבור שממתין מקבל תוצאה שמורה ויוצא לפני היומן | reject |
| 12 | `token_view` ‏`conflict` וקלט פגום לא נבדקים | low | `conflict` שייך להצטרפות (E2) | reject |
| 13 | `VERCEL_ENV` חסר עדיין פותח את הנעילה בקוד | low | החלטת המשתמשת: לסגור עם שורה ב-README; אומת ב-1.6 | reject |
| 14 | בדיקת "לא-שכבתי" ב-`globals.test.ts` שבירה | low | מניחה סוגר בעמודה 0; תיקון מוסיף ניתוח CSS | reject |
| 15 | `release` בלי שגיאה מחזיר חיבור שבור ל-Pool | low | נדיר; תיקון מוסיף ענפים | reject |
| 16 | `RPC_DIRECT` לא חל על js/jsx ב-app או lib | false | אין קובצי js בפרויקט (כמו ממצא 14 ב-1.2) | reject |
| 17 | intent: פריט 1.1 #9 (איפוס לא מנתק sessions) לא מתועד | false | נסגר ב-Spec Change Log של 1.1: `signOut({ scope: "others" })` | reject |
| 18 | intent: פריטים עתידיים מסומנים ב-`target:` ולא עוברים לכרטיסים | low | תיאורי. זו החלטת המשתמשת ב-Decisions | reject |

## Design Notes

- מקביליות: A פותח עסקה וקורא ל-`idempotent_begin` (null). B שולח אותה קריאה בלי `await`. ההמתנה נבדקת כך: אחרי השהיה קצרה ה-promise של B לא הוכרע (שני חיבורי ה-Pool תפוסים, אין שאילתה שלישית). אז A קורא ל-`idempotent_finish` ועושה commit.

## Verification

- `npm run lint`, `typecheck`, `test`, `test:db`, `build` -- עוברים.
- סריקה ב-node של U+200B–U+200F, U+202A–U+202E, U+2060–U+2069, U+FEFF בכל קובץ שנערך -- אפס בקוד; במסמכים רק U+200F, כמו בשאר המסמכים.
- ידני, בטלפון מול `npm run dev`: שדות וכפתור ההתחברות בגובה 48px, והמסגרת לא משנה צבע בפוקוס.
