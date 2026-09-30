---
title: '1.2 Tooling, lint rules and CI — כלים, כללי lint ו-CI'
type: 'chore'
created: '2026-09-30'
status: 'done'
baseline_commit: 'cda9a2b4216c943fc966a0e6206da03b8db049a7'
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

**Problem:** ‏lint לא אוכף את כיוון התלות (AD-4) ואת "אין כתיבה ישירה לטבלאות", אין CI, ‏`npm test` לא מופרד מבדיקות מסד, ויש פערי E1 (ARCHITECTURE-SPINE › Deferred).

**Approach:** תלויות לפי Stack, ‏`lib/supabase/public.ts`, כללי ESLint של Consistency Conventions › אכיפה, שני פרויקטים ב-Vitest, ו-GitHub Actions. באותו branch: שאריות 1.6 במסמכים.

## Boundaries & Constraints

**Always:** ה-CI רץ מ-checkout נקי, בלי `.env*`, סודות או מסד, עם `permissions: contents: read` ו-Node 24. כללי `no-restricted-syntax` חדשים ממוזגים לרשימה אחת עם כללי ה-RTL (ב-flat config רשומה מאוחרת מחליפה את כל הרשימה). הקוד הקיים עובר בלי `eslint-disable`. ‏`public.ts` משתמש בתפקיד `anon`, ולכן חשוף רק למה ש-grant ו-RLS מתירים ל-anon. הוא לתוכן שפורסם בלבד.

**Decisions:**
- ייבוא `lib/server/privileged` מותר גם מ-`page.tsx` של `reset/[token]` ו-`join/[token]`, כי לפי AD-10 הם קוראים ל-`getTokenView`.
- כלל הכתיבה תופס רק `.from(...).insert/update/delete/upsert`, ומתיר את `profiles` ואת `babies`. קובצי בדיקה פטורים ממנו.
- `test:db` מריץ קבצים בטור (`fileParallelism: false`), כי כולם עובדים מול אותו מסד פיתוח ואותה מכסת חיבורים.

**Never:** חיבור `pg` או בדיקות מסד בפועל (1.3); ‏migrations; שדרוג minor או major מחוץ ל-Stack; שינוי ב-`components/ui/`; ‏push או PR בלי אישור.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected |
|----------|-------|----------|
| client מייבא שרת | קובץ `"use client"` שמייבא `@/lib/server/...` או `../lib/server/...` | שגיאת lint |
| privileged מותר | `lib/server/privileged/*`, ‏`app/**/actions.ts`, ‏`app/api/**`, ‏`page.tsx` של נתיב טוקן | עובר |
| privileged אסור | כל קובץ אחר | שגיאת lint |
| כתיבה לטבלה | `.from("bookings").insert/update/delete/upsert(...)` | שגיאת lint |
| לא כתיבה לטבלה | `.from("profiles").update`, ‏`createHash().update`, ‏`map.delete` | עובר |
| RTL | `ml-2`, ‏`text-left` | שגיאת lint |
| כסף | `parseFloat` ב-`lib/money.ts` | שגיאת lint |
| בדיקות | `npm test` / ‏`npm run test:db` | הראשון בלי `supabase/tests`. השני רק היא, ועובר כשהיא ריקה |

</frozen-after-approval>

## Code Map

- `eslint.config.mjs` -- רשומת RTL אחת, בלי `components/ui/**`.
- `package.json` -- ‏`dev` עם `--turbopack`, ‏`shadcn` ב-dependencies, ‏`@types/node` ‏`^26`, אין `engines`. ‏`server-only` ו-`@shadcn/react` נשארים.
- `vitest.config.mts` -- aliases ל-`@` ול-`server-only`. כל הבדיקות היום טהורות.
- `lib/supabase/client.ts`, ‏`lib/server/privileged/service-client.ts` -- הדפוסים ללקוח חדש (`Database`, ‏auth בלי session).
- חייבים לעבור lint: `app/(auth)/reset/[token]/page.tsx` (מייבא privileged) ו-`lib/site-lock.ts:61` (`createHash().update`).
- `tsconfig.json` כולל את `next-env.d.ts`, שלא נמצא ב-git. ייתכן שה-CI יצטרך `next typegen` לפני `tsc`.
- `README.md:31` (‏`test:db` "עוד לא קיים"), ‏`AGENTS.md:17` (כלל המיזוג), ושורות ב-AGENTS על `public.ts` ועל `npm test`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json` -- `zod` 4.x, ‏`web-push` 3.6.7, ‏`@types/web-push` 3.6.4 (dev), ‏`shadcn` ל-dev, ‏`@types/node` ‏`^24`, ‏`engines.node` ‏`24.x`, בלי `--turbopack`, ו-`test`/`test:db` לפי פרויקט.
- [x] `vitest.config.mts` -- `projects`: ‏unit (הכול חוץ מ-`supabase/tests/**`) ו-db (`supabase/tests/**/*.test.ts`, בטור).
- [x] `lib/supabase/public.ts` -- לקוח anon של supabase-js, בלי cookies ובלי session.
- [x] `eslint.config.mjs` -- הכללים לפי המטריצה. ‏`components/ui/**` מקבל את כולם חוץ מ-RTL.
- [x] בדיקת Vitest לכללי ה-lint -- `ESLint.lintText` עם `filePath` מדומה לכל שורה במטריצה, בתוך `npm test`.
- [x] `.github/workflows/ci.yml` -- ב-push וב-pull_request: ‏`npm ci`, ‏lint, ‏typecheck, ‏test, ‏`npm audit --omit=dev --audit-level=high`.
- [x] `AGENTS.md`, ‏`README.md` -- מחיקת כלל המיזוג; ‏`public.ts` קיים; ‏`test` לעומת `test:db`; ‏CI וכללי ה-lint.
- [x] spec 1.6, ‏Implementation Notes -- "2026-09-30, production (‏`cda9a2b`): ‏curl החזיר 401 בכל נתיב ו-404 ל-`/api/jobs/x`, והבדיקה בטלפון עברה אצל המשתמשת. בקשת הסיסמה בדף ה-404 באה מקבצי `/_next/static` הנעולים, וזה תקין."

**Acceptance Criteria:**
- Given clone נקי ב-scratchpad (בלי `.env*` ובלי `.next`), when מריצים `npm ci` ואת צעדי ה-CI, then כולם עוברים.
- Given PR ל-main, when ה-workflow רץ, then הוא ירוק בלי גישה למסד.

## Implementation Notes

- ‏`zod` הותקן ב-4.6.5 (היה קודם תלות עקיפה ב-4.3.6). ‏`npm install -D shadcn` העלה אותו ל-4.21 (minor), ולכן הוא הותקן במפורש ב-4.13.0 לפי ה-Stack. חוץ מ-`@types/node` ‏(24.19.0), ‏`undici-types`, ‏`zod` ותלויות של `web-push`, אף גרסה ב-lock לא השתנתה.
- ה-regex של הייבוא מכסה גם נתיב יחסי מתוך `lib/` (‏`../server/...`), ולא תופס תת-נתיב של חבילה כמו `react-dom/server`. ב-privileged הוא תופס גם `./privileged` ו-`../privileged` (מתוך `lib/server/` ותת-תיקיות שלו), ו-`import()` דינמי חסום דרך `no-restricted-syntax`, כי `no-restricted-imports` לא רואה אותו. ‏`.storage.from(...)` אינו טבלה ולכן פטור מכלל הכתיבה, ו-`supabase/tests/**` פטור ממנו כמו קובצי בדיקה.
- ‏`no-restricted-imports` חל גם על `js`/`mjs` (למשל `scripts/`), ‏`no-restricted-syntax` רק על `ts`/`tsx` כמו כלל ה-RTL.
- ‏`typecheck` עובר גם בלי `next-env.d.ts`, אבל ה-CI מריץ `npx next typegen` לפניו, כדי שיבדוק את אותם טיפוסי נתיבים כמו מקומית.
- clone נקי ב-scratchpad (בלי `.env*` ובלי `.next`): ‏`npm ci` (npm 11), ‏`next typegen`, ‏lint, ‏typecheck, ‏`npm test` (174 בדיקות) ו-`npm audit --omit=dev --audit-level=high` (‏0 פרצות) עברו. ‏`test:db` עובר כשאין קבצים, ובדיקת ניסיון ב-`supabase/tests/` רצה רק בו ולא ב-`npm test`. ‏`npm run build` עבר.
- פתוח: הרצת ה-workflow בפועל ב-GitHub, אחרי push באישור.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. ‏medium 1, ‏low 13, ‏false 3, ‏maybe-false 2.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | `import()` של privileged מקובץ אסור עובר lint | medium | אומת: `no-restricted-imports` לא בודק `ImportExpression` | patch |
| 2 | `../privileged` מתת-תיקייה של `lib/server` לא נתפס | low | אומת ב-regex | patch + בדיקות ל-`./` ול-`../` |
| 3 | אין בדיקה לענף `./privileged` (verification-gap) | low | אומת: אין מקרה כזה בבדיקות | patch (עם 2) |
| 4 | `storage.from(bucket).update` נתפס ככתיבה לטבלה | low | אומת. ‏Storage מתוכנן (AD-16) | patch |
| 5 | glob של דפי הטוקן פוטר כל `reset/*/page.tsx` | low | אומת | patch: נתיב מדויק |
| 6 | `globalThis.parseFloat` ב-`lib/money.ts` לא נתפס | low | אומת בסלקטור | patch |
| 7 | קובצי עזר ב-`supabase/tests/` ייכשלו בכלל הכתיבה | low | אומת: רק `*.test.*` פטורים | patch |
| 8 | `supabase/tests/**/*.test.tsx` ירוץ ב-unit; ‏exclude מחליף את ברירות המחדל של Vitest | low | אומת בהגדרות | patch: ‏`configDefaults.exclude` |
| 9 | גרסת Node כפולה ב-CI וב-`engines` | low | תיקון ישיר | patch: ‏`node-version-file` |
| 10 | טעינה קרה של ESLint עלולה לעבור 5 שניות ב-CI | maybe-false | מקומית 2.4 שניות לכל הקובץ; תיקון ישיר | patch: חימום ב-`beforeAll` |
| 11 | `npx vitest run -t` בלי `--project` מריץ גם בדיקות מסד, ו-AGENTS מציע אותו | low | אומת. התיקון ב-AGENTS | defer |
| 12 | ה-SPINE (אכיפה, ‏Deferred "פערי E1"), ‏`epic-1-context.md` ו-`deferred-work.md` לא עודכנו אחרי 1.2 ו-1.6 | low | אומת. מסמכי תכנון, מחוץ ל-diff | defer |
| 13 | builder במשתנה או גישה מחושבת עוקפים את כלל הכתיבה | low | אמיתי, אבל תיקון דורש ניתוח scope. ה-grants וה-RLS הם השכבה המחייבת | reject |
| 14 | כללי ה-syntax לא חלים על js/jsx | low | אין רכיבי js בפרויקט | reject |
| 15 | בדיקה שמייבאת privileged באמת מ-`app/**/*.test.ts` תיכשל | low | הבדיקות הקיימות משתמשות ב-`vi.mock` | reject |
| 16 | ייבוא `../vitest.config.mjs` שביר | low | זו המוסכמה של TS ל-`.mts`. ‏typecheck ו-Vitest עוברים | reject |
| 17 | הבדיקה של projects בודקת מחרוזות ולא קבצים | low | ההתנהגות נבדקה ידנית; הצורה מספיקה | reject |
| 18 | CI רץ פעמיים (push ו-PR) | low | AD-22 קובע push ו-PR | reject |
| 19 | אין build ואין prettier ב-CI; סגנון נקודה-פסיק מעורב | low | ‏build לא ב-AD-22 ו-Vercel בונה כל push; הקובץ היה מעורב קודם | reject |
| 20 | ל-`public.ts` אין צרכן ואין בדיקה | low | אין בו לוגיקה; התוכן נקבע ב-grants של anon | reject |
| 21 | לפרויקט db אין טעינת env ואין שמירה מפני מסד שגוי | false | זה הכרטיס של 1.3 ("Never" כאן) | reject |
| 22 | `zod` ו-`web-push` מחוץ להיקף | false | ברשימת פערי E1 ובכרטיס | reject |
| 23 | caret מתיר minor | false | ‏`npm ci` נועל לפי ה-lock; מוסכמה קיימת | reject |
| 24 | רשומה עתידית של `no-restricted-imports` תדרוס | maybe-false | היפותטי, אין רשומה כזו | reject |

## Design Notes

- `"use client"`: ‏`Program:has(> ExpressionStatement[directive="use client"]) ImportDeclaration[source.value=/lib\/server\//]`, וגם `ImportExpression` ו-export-from.
- כתיבה: `CallExpression[callee.property.name=/^(insert|update|delete|upsert)$/][callee.object.callee.property.name="from"]:not([callee.object.arguments.0.value=/^(profiles|babies)$/])`.
- ב-`files` לא כותבים `[token]` או `(auth)` (minimatch), אלא `app/**/reset/*/page.tsx`.

## Verification

- `npm run lint`, ‏`typecheck`, ‏`test`, ‏`test:db`, ‏`build` -- עוברים.
- `npm audit --omit=dev --audit-level=high` -- exit 0.
- ידני: ה-workflow ירוק ב-PR (אחרי push באישור).
