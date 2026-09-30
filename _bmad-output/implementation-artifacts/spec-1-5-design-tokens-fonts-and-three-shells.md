---
title: '1.5 Design tokens, fonts and the three shells — טוקנים, גופנים ומעטפות'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: 'a09502701295a837e69705f2146de82266fe98d6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** האתר בצבעי neutral של shadcn, דף הבית תבנית באנגלית, אין `/admin`, ‏`/admin/login` וניווט. אדמין אחרי איפוס ומחוברת שאינה לקוחה פעילה נתקעות בלולאה `/me` ← `/login` בלי הודעה (deferred-work, 1.1).

**Approach:** טוקני "קרם וזית" ב-`globals.css`; שלוש מעטפות לפי AD-2 עם רכיבי ניווט משותפים שמציגים רק מסכים קיימים; `/admin/login` עם אותו טופס; יעד לפי תפקיד בשמירת המעטפת, בדף ההתחברות ובפעולת ההתחברות.

## Boundaries & Constraints

**Always:** כיווני Tailwind לוגיים בלבד. מיקרו-קופי ב-`lib/copy/*.ts`, בלי ערך עסקי או טקסט שיווקי בקוד. בדיקת התפקיד בתוך `<Suspense>` ורק דרך `callRpc(supabase, "get_my_session_role")`; ההגנה ב-layout היא נוחות, ההרשאה ב-RLS וב-RPC. בכל עמוד: `h1` אחד, `<main id="main">` אחד (במעטפת, לא בעמוד), "דילוג לתוכן הראשי" ראשון בסדר הטאב, `<title>` "{שם העמוד} · בראנץ׳ אצל טל", ואחרי ניווט פוקוס ל-`h1` (‏`tabIndex={-1}`). אין צללים. יעד מגע 44px. `components/ui/` לא נערך.

**Decisions:**
- `destinationFor(role, next)` (טהורה): admin ← ‏`next` רק אם הוא `/admin` או `/admin/…` (לא `/admin/login`), אחרת `/admin`. customer ← ‏`next` שעבר `safeNext` ולא מתחיל ב-`/admin`, אחרת `/me`. none ← אין יעד.
- `requireRole`: אורחת או שגיאת RPC ← דף ההתחברות של המעטפת עם `next`. אדמין ב-`/me` ← `/admin`. לקוחה ב-`/admin` ← `/admin/login?next=…`. none ← דף ההתחברות של המעטפת.
- דף התחברות עם session: תפקיד שמתאים לדף (`/login`: customer או admin; ‏`/admin/login`: admin) ← הפניה ל-`destinationFor`. אחרת (none בשניהם, לקוחה ב-`/admin/login`) ← `inline-notice` warning מעל הטופס עם "התנתקות", וללקוחה גם "לאזור האישי". כך אין לולאה.
- `loginAction` אחרי הצלחה ← `destinationFor`. none ← התנתקות מיד וקוד חדש `ACCOUNT_NOT_ACTIVE` ("החשבון הזה עוד לא פעיל. אפשר לפנות לטל").
- התנתקות משותפת: אדמין ← `/admin/login`, אחרות ← `/login`.
- ניווט: רשימה לכל מעטפת, רק מסכים קיימים. לקוחה: "בית" (`/me`). אדמין: "בית" (`/admin`), "עוד" (`/admin/more`). סרגל מוצג גם עם פריט אחד (החלטת משתמשת). אין פעמון, תפריט ציבורי ופס וואטסאפ, כי המסכים והנתונים שלהם עוד לא קיימים.
- wordmark: קבוע אחד ב-`lib/copy/shell.ts`, אותו שם של תבנית ה-`<title>`. ב-5.2 ה-wordmark הציבורי עובר לפרטי העסק (החלטת משתמשת).
- פינות: כפתור ושדה 4px, כרטיס 8px, גיליון 12px, דרך סולם ה-radius ב-`@theme inline`.

**Never:** טבלאות או migration. תוכן ופרטי עסק מהמסד, `whatsapp-bar`, ‏`menu-sheet`, טקסטי פוטר, "האזור שלי" בסרגל הציבורי (5.2). ‏`bell-button` ו-`/admin/notifications` (5.7). ‏`lib/concepts/themes.ts` וגופני קונספט. מצב כהה או ThemeProvider. ‏`SidebarProvider`. נתונים בבית האדמין (4.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| אורחת ב-`/me` | אין session | `/login?next=%2Fme` |
| אורחת ב-`/admin/more` | אין session | `/admin/login?next=%2Fadmin%2Fmore` |
| אדמין ב-`/me` | admin | `/admin` |
| לקוחה ב-`/admin` | customer | `/admin/login?next=%2Fadmin` עם הודעה מעל הטופס |
| none ב-`/me` | session בלי פרופיל פעיל | `/login` עם הודעה + התנתקות, בלי הפניה חוזרת |
| לקוחה ב-`/login` | customer | `/me` |
| התחברות אדמין, `next=/me` | admin | `/admin` |
| התחברות לקוחה, `next=/admin` | customer | `/me` |
| התחברות none | סיסמה נכונה, בלי פרופיל פעיל | התנתקות, `ACCOUNT_NOT_ACTIVE` |
| `next` חיצוני | `//evil.com` | ברירת המחדל של התפקיד |

</frozen-after-approval>

## Code Map

- `app/globals.css` -- neutral ו-`.dark` להחלפה. המיפוי ב-DESIGN › Colors.
- `app/layout.tsx` -- Heebo ו-Assistant כבר ב-`next/font` עם subset עברי. חסרים `metadata.title.template` ו-`display: "swap"`.
- `app/page.tsx` -- תבנית "Project ready!". עובר ל-`app/(public)/page.tsx`.
- `app/me/layout.tsx`, ‏`lib/auth/require-customer.ts` + test -- השמירה הקיימת, מוחלפת ב-`requireRole`.
- `app/me/page.tsx`, ‏`app/me/actions.ts` -- `<main>` משלו, "שלום,", התנתקות. ב-UX: "היי {שם}".
- `app/(auth)/login/{page,login-form,actions}.tsx?` + test -- הטופס מקבל `next`. `/admin/login` משתמש באותו טופס ובאותה פעולה.
- `lib/auth/safe-next.ts` -- שימוש חוזר ב-`destinationFor`.
- `lib/errors.ts` -- מקום הקוד החדש.
- `next.config.mjs` + test -- `no-store` רק ל-`/me`.
- `components/ui/{button,input,card,sheet}.tsx` -- כפתור ושדה `rounded-lg`, כרטיס `rounded-xl`, ‏`shadow-*` ב-sheet וב-sidebar.
- mockups `key-customer-home`, ‏`key-admin-home`, ‏`key-public-home` -- המחשה בלבד; ה-spines גוברים.

## Tasks & Acceptance

**Execution:**
- [x] `app/globals.css` -- מיפוי DESIGN ל-`:root`, ‏`--brand-accent`, צבעי מצב (טקסט, tint, dot) ב-`@theme inline`, צללים מאופסים, סולם radius, פוקוס דו-גוני ב-base; הסרת `.dark` ו-`@custom-variant dark`.
- [x] `app/globals.test.ts` -- ערכי מפתח, אין `.dark`, אין `outline: none`.
- [x] `app/layout.tsx` -- `title.template` ו-`display: "swap"`.
- [x] `lib/copy/shell.ts` -- מיקרו-קופי המעטפות וה-wordmark.
- [x] `lib/auth/destination.ts` + test -- `destinationFor`.
- [x] `lib/auth/require-role.ts` + test -- מחליף את `require-customer.ts` ואת ה-test שלו.
- [x] `lib/auth/sign-out.ts` -- Server Action משותף; `app/me/actions.ts` נמחק.
- [x] `lib/nav.ts` + test -- פריטי הניווט; לכל `href` יש `page.tsx`.
- [x] `components/shared/{skip-link,page-heading,route-focus,wordmark,bottom-tab-bar}.tsx` -- `bottom-tab-bar` כ-`nav` עם `aria-current`, ‏`min-height` 64px + safe-area.
- [x] `components/public/top-bar.tsx`, ‏`app/(public)/{layout,page}.tsx` -- wordmark, "כניסה לאזור האישי", פוטר עם "כניסת מנהלת" בלבד; בבית `h1` wordmark ב-40/200.
- [x] `app/me/{layout,page}.tsx` -- מעטפת לקוחה עם `padding-bottom` ו-`scroll-padding-bottom`.
- [x] `components/admin/side-nav.tsx`, ‏`app/admin/(shell)/{layout,page}.tsx`, ‏`app/admin/(shell)/more/page.tsx` -- סרגל תחתון עד `lg`, ‏`side-nav` 240px מ-`lg` עם התנתקות, "עוד" עם התנתקות.
- [x] `app/(auth)/login/*`, ‏`app/(auth)/admin/login/page.tsx` -- הפניה או הודעה לפי תפקיד, ופעולה לפי `destinationFor`.
- [x] `lib/errors.ts`, ‏`next.config.mjs` + tests -- `ACCOUNT_NOT_ACTIVE`; `no-store` ל-`/admin` ול-`/admin/:path*`.

**Acceptance Criteria:**
- Given כל מעטפת ב-320px ובזום 200%, then אין גלילה אופקית, וה-bottom-tab-bar לא מסתיר תוכן או רכיב ממוקד.
- Given ‏Tab ראשון בעמוד, then מופיע "דילוג לתוכן הראשי", ו-Enter מעביר ל-`main`.
- Given מעבר בין טאבים, then `<title>` מתעדכן והפוקוס על ה-`h1`.
- Given רכיב אינטראקטיבי במעטפות ובטפסים, when פוקוס מקלדת, then טבעת primary עם רווח, בלי צל אחר.
- Given checkout בלי `.env*`, then `npm test`, ‏lint, ‏typecheck ו-build עוברים.

## Implementation Notes

- `@custom-variant dark (&:is(.dark *))` נשאר, בניגוד לטקסט המשימה: בלעדיו Tailwind v4 מפעיל את `dark:` של shadcn לפי `prefers-color-scheme` (ממצא 1 בביקורת). אין `.dark` בשום מקום, ולכן האתר נשאר במצב בהיר בלבד.
- `next` של השמירה: layout לא יודע את הכתובת שלו, ולכן `proxy.ts` מעתיק את הנתיב לכותרת `x-request-path` (רק ל-`/me` ול-`/admin`, ותמיד מוחק ערך שהגיע מהדפדפן). `RoleGate` קורא אותה דרך `shellPath`. עזרים ב-`lib/auth/request-path.ts`.
- `loginPageOutcome` (ב-`destination.ts`) הוא ההחלטה הטהורה של דף ההתחברות: הפניה או הודעה.
- התנתקות לפי תפקיד שנקרא לפני ההתנתקות (`lib/auth/sign-out.ts`). אם הקריאה נכשלת ← `/login`.
- המקום מעל הסרגל התחתון ב-CSS גלובלי (`:has([data-tab-bar])`), עם ביטול מ-`lg` לאדמין.
- `RouteFocus` פעם אחת ב-`app/layout.tsx`, בתוך `<Suspense>` (`usePathname` חוסם prerender בלעדיו).
- רכיבים נוספים: `nav-icon`, ‏`role-gate`, ‏`sign-out-button`, ‏`inline-notice`, ו-`app/(auth)/layout.tsx` עם `main` ודילוג. ‏`/login` ו-`/admin/login` חולקים את `login-screen.tsx`.
- Prettier שינה את ערכי ה-hex ב-`globals.css` לאותיות קטנות; הבדיקה משווה בלי תלות ברישיות.
- לא נבדק: בדיקה ידנית בטלפון (המטריצה כמחוברת, 320px, זום, מראה הפוקוס). שדות shadcn עדיין בגובה 44px ומחליפים מסגרת ל-primary בפוקוס (`focus-visible:border-ring` ב-`components/ui/`).
- נבדק: `npm test` ‏382, ‏lint, ‏typecheck ו-build עוברים; אין תווי כיווניות.
- הפריט מ-1.1 ב-deferred-work (לולאת `/me` ← `/login`) נסגר כאן והוסר מהרשימה.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. ‏medium 1, ‏low 19, ‏false 1. ‏patch 8, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | הסרת `@custom-variant dark` מחזירה את `dark:` לפי `prefers-color-scheme` | medium | אומת: ל-`shadcn/tailwind.css` אין variant כזה, וב-`button.tsx` ו-`input.tsx` יש `dark:bg-input/30`. משימת ה-spec ("הסרת `@custom-variant dark`") הייתה שגויה, והתיקון הוא שורה אחת | patch: variant שלא מתאים אף פעם |
| 2 | `box-shadow: none` בפוקוס מעלים את טבעת השגיאה של `aria-invalid` | low | אומת: הכלל מחוץ ל-layer גובר | patch |
| 3 | `outline-offset-4` ב-`page-heading` לא חל | low | אומת: אותו כלל גובר | patch: מחיקה |
| 4 | `startsWith("/admin")` בענף הלקוחה לא עקבי עם בדיקת המקטעים | low | אומת | patch |
| 5 | ל-`main` אין `tabIndex={-1}`, ולכן הדילוג לא מעביר פוקוס בכל דפדפן | low | אומת (Safari/VoiceOver) | patch |
| 6 | `RouteFocus` נטען מחדש במעבר בין מעטפות ולא מעביר פוקוס | low | אומת: `previous === pathname` ברינדור הראשון | patch: פעם אחת ב-layout הראשי |
| 7 | אין בדיקה שהכותרת `x-request-path` עוברת ב-`updateSession` ושה-`RoleGate` ממפה אותה | low | verification-gap. הפלט מהשרת האמיתי תקין, אבל שבירה לא תתגלה | patch: שתי בדיקות |
| 8 | שורה ארוכה מ-Prettier ב-`next.config.test.ts` | low | אומת | patch |
| 9 | `--input` = ‏#6B6450 משנה גם `bg-input` של שדה מושבת ושל מפריד | low | לפי טבלת המיפוי של DESIGN. אין היום שדה מושבת | reject |
| 10 | התנתקות לפי תפקיד: לקוחה מהודעת `/admin/login` מגיעה ל-`/login`; אדמין עם RPC שנכשל ל-`/login` | low | תואם להחלטה ב-spec; נדיר | reject |
| 11 | לקוחה שמתחברת ב-`/admin/login` מגיעה ל-`/me` בלי הסבר | low | תואם למטריצה | reject |
| 12 | תוצאת `signOut()` לא נבדקת | low | ‏supabase מחזיר `error` ולא זורק; גם אם נשאר session, השמירה מציגה הודעה בלי לולאה | reject |
| 13 | ה-fallback של Suspense בדף ההתחברות הוא טופס פעיל בלי `next` | low | אותו דפוס מ-1.1; חלון קצר | reject |
| 14 | ‏`LoginScreen` לא נבדק ברינדור | low | הלוגיקה נבדקת ב-`loginPageOutcome`. דורש רתמת רינדור לרכיב שרת. בדיקה ידנית בטלפון | reject |
| 15 | ניווט האדמין והתנתקות מוצגים לרגע לאורחת לפני ההפניה | low | אין בהם מידע; ההגנה היא נוחות (AD-2) | reject |
| 16 | אותו `<title>` ("בית") לבית הלקוחה ולבית האדמין | low | קוסמטי; כמו במוקאפים | reject |
| 17 | `globals.test.ts` לא בודק את כללי הריווח לסרגל ואת reduced-motion | low | בדיקה ידנית ב-320px | reject |
| 18 | קוד עסקי מ-`get_my_session_role` הופך ל-`SERVER_ERROR` | false | ה-RPC לא זורק קודים עסקיים | reject |
| 19 | intent-alignment: מסך ההצלחה של האיפוס עדיין מקשר ל-`/me`, ואדמין מגיעה ל-`/admin` רק דרך השמירה | low | תיאורי. ההתנהגות נכונה (השמירה מפנה) | reject |
| 20 | intent-alignment: הבדיקות על פונקציות, לא על הזרימה המלאה בדפדפן | low | תיאורי. בדיקה ידנית בטלפון בשלב ההצגה | reject |
| 21 | intent-alignment: ערכי ה-RPC האמיתי לא נבדקים כאן | low | פריט קיים ב-deferred-work מ-1.1 | reject |

## Design Notes

- פוקוס: `on-primary` זהה ל-`background` (‏#FAF6EE), ולכן `outline: 2px solid var(--ring); outline-offset: 2px` נותן טבעת דו-גונית ברוב המשטחים. אם גם `ring-3` של shadcn נראה, לבדוק בדפדפן ולבחור אחד.
- צללים: כל `--shadow-*` ב-`@theme inline` מקבל `0 0 #0000`. הטבעת לא תלויה בהם.
- radius: ‏`--radius: 0.5rem`, ‏`--radius-lg` = 4px (כפתור, שדה), ‏`--radius-xl` = 8px (כרטיס). לוודא שאין רכיב אחר ב-`components/ui/` שנשבר.
- `route-focus`: רכיב לקוח ב-layout של כל מעטפת. בשינוי `usePathname` (לא ברינדור הראשון): `document.querySelector("#main h1")?.focus()`.
- לפני ה-UI: סקיל `frontend-design`.

## Verification

**Commands:**
- `npm test`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run build` -- עוברים.
- `grep -rP '[\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]' app components lib` -- פלט ריק.

**Manual checks:**
- בטלפון מול `npm run dev` (לקוחה ואדמין מ-`dev:reset-link`): כל שורות המטריצה, וצבעים וגופנים מול DESIGN.
