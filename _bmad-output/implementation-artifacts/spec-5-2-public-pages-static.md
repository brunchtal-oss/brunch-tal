---
title: '5.2 Public pages (static part) — עמודים ציבוריים, חלק סטטי'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '52a282ecc2adb7f9dc767d47befc52c82f2dd1ea'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-publish-hero-to-home-tracer.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** באתר הציבורי יש רק בית עם הירו: אין אודות, איך זה עובד, גלריה וקשר, אין תפריט, פס וואטסאפ ופוטר, וה-top-bar לא לפי ההחלטה של 2026-10-04.

**Approach:** מעטפת ציבורית מלאה ועמודים מתוכן שפורסם (5.1), עם סכמה לכל `kind` חדש. בלי מפגשים (3.1, ‏3.2).

## Boundaries & Constraints

**Always:** AD-2, ‏AD-15, ‏AD-16. ‏`frontend-design` לפני כל רכיב ועמוד; בדיקה בעין ב-360px. עברית רק ב-`lib/copy/*`. תוכן בדוי רק במסד הפיתוח (`execute_sql`).

**Decisions:**
- **מיגרציה, שורות בלבד** (לא פורסמו, בלי טיוטה): עמודים `about`, ‏`how-it-works`, ‏`gallery`, ‏`site`; סקשנים `home/intro` (‏`text_block`, 2), ‏`home/contact` (‏`text_block`, 5), ‏`about/main` (‏`text_block`), ‏`how-it-works/steps` (‏`steps`), ‏`how-it-works/faq` (‏`faq`), ‏`gallery/testimonials` (‏`testimonials`), ‏`contact/intro` (‏`text_block`), ‏`site/footer` (‏`footer`). קובץ המיגרציה נוצר (‏`migration new`) רק לפני ההחלה, אחרי בדיקה ש-main לא קיבל מיגרציה חדשה יותר שלא מוזגה ל-branch.
- **סכמות** (ב-`contentSchemas`): ‏`text_block` ‏{`eyebrow`?, ‏`title`, ‏`body`}; ‏`steps` ‏{`title`?, ‏`items` ≥1: {`title`, ‏`body`}}; ‏`faq` ‏{`title`?, ‏`items` ≥1: {`question`, ‏`answer`}}; ‏`testimonials` ‏{`title`?, ‏`items` ≥1: {`name`, ‏`text`}}; ‏`footer` ‏{`text`}.
- **קריאה:** ‏`getPublishedSections(slug)` ‏(`'use cache'`, ‏`cacheTag('content:<slug>')`, ‏`minutes`, ‏`createPublicClient`); כשל ← לוג ו-`{}`. סקשן שלא פורסם או לא עובר את הסכמה לא מוצג. ‏`getBusinessDetails()` (כל השדות) ו-footer: ‏`content:global`; פרסום `site` מעדכן גם אותו (המפה ב-action של 5.1).
- **עמודים:** ‏`/about`; ‏`/how-it-works` (שלבים ממוספרים ו-FAQ); ‏`/gallery` (המלצות טקסט, תמונות ב-5.4); ‏`/contact` (‏`intro` ופרטי העסק: ‏`tel:`, וואטסאפ, כתובת, הוראות הגעה, קישור ניווט, הוראות תשלום; שדה ריק לא מוצג). ‏`h1` = שם העמוד מהניווט. אין סקשן שפורסם ← שורת מצב וקישור וואטסאפ.
- **הבית:** הירו, ‏`home/intro`, המלצות (מ-`gallery/testimonials`), ‏`home/contact` עם פרטי העסק. בלי אזור מפגשים עד 3.2.
- **top-bar:** רקע מהפלטה שנבחר ב-frontend-design (ניגודיות ≥4.5:1), ‏`sticky top-0`; תפריט ב-inline-start, שם העסק (‏`business_name`, אחרת `WORDMARK`) במרכז כקישור לבית, "כניסה לאזור האישי" ב-inline-end. נכנס ב-360px.
- **menu-sheet:** ‏`Sheet` מ-inline-end לפי EXPERIENCE (‏dialog, ‏focus, ‏Esc, ‏`aria-current`). ‏`publicNav`: בית, אודות, איך זה עובד ושאלות נפוצות, גלריה והמלצות, יצירת קשר; בתחתית "כניסה לאזור האישי".
- **whatsapp-bar:** ‏`aside` צמוד לתחתית בכל עמוד ציבורי, ‏`wa.me` עם `whatsapp_message` (‏`whatsappHref(phone, message?)`); העמוד שומר מקום מתחתיו. גובה חלון <480px: מוסתר (‏CSS) והקישור בזרימה לפני הפוטר. בלי מספר תקין: לא מוצג.
- **פוטר:** שם העסק, ‏`site/footer`, "כניסת מנהלת". מדיניות ונגישות ב-5.5.
- **תצוגה מקדימה לפרטי העסק (מ-5.1):** ‏`/admin/content/contact/preview` עם רכיב פרטי הקשר והטיוטה; ‏`PreviewBar` מקבל `slug`.
- **deferred-work:** ‏`/sessions`, ‏`/sessions/[id]`, פריט "הבראנצ׳ים" ואזור המפגשים בבית (3.2); מחיר תצוגה; "האזור שלי" והסתרת הפס ללקוחה מחוברת; הסתרת הפס כשכפתור ההירו גלוי; עריכת הסקשנים החדשים (5.3); תמונות (5.4).

**Never:** נתון תפוסה, טקסט שיווקי בקוד, `'use cache'` עם cookies, ‏`ml-`/`mr-`/`left-`/`right-`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| אורחת | כל עמוד, בלי התחברות | 200, התוכן שפורסם |
| לא פורסם | טיוטה בלבד | לא מוצג |
| לא תקין | ‏`steps` בלי `items` | לא מוצג, שאר העמוד כן |
| עמוד ריק | אף סקשן לא פורסם | ‏`h1`, שורת מצב, וואטסאפ |
| פרטים חלקיים | בלי `address` | בלי שורת כתובת |
| וואטסאפ | מספר והודעה | ‏`https://wa.me/972…?text=…` (מקודד) |
| מספר לא תקין | ‏`whatsapp_phone` שבור | בלי פס |
| כשל קריאה | שגיאה מהמסד | העמוד עולה בלי הסקשנים |

</frozen-after-approval>

## Code Map

- `lib/content/schema.ts`, ‏`home.ts`, ‏`business-details.ts`, ‏`whatsapp.ts` -- סכמות, דפוס הקריאה (5.1), ‏`whatsappHref`.
- `app/admin/(shell)/content/actions.ts` -- ‏`updateTag`; להוסיף `site` ל-`content:global`.
- `app/admin/(shell)/content/contact/page.tsx`, ‏`home/preview/*`, ‏`editor-page.tsx` -- ‏`previewHref`, ‏`PreviewBar`.
- `app/(public)/layout.tsx`, ‏`page.tsx`, ‏`components/public/top-bar.tsx`, ‏`home-hero.tsx` -- המעטפת והבית.
- `components/ui/sheet.tsx` -- בסיס ה-menu-sheet (לא עורכים את `components/ui/`).
- `lib/nav.ts` (+test) -- ‏`publicNav` (הבדיקה מוודאת `page.tsx`).
- `lib/idempotency.ts` -- מפתח בדפדפן (`crypto.randomUUID` חסום ב-lint בקבצי `"use client"`).
- `lib/copy/shell.ts` -- ‏`WORDMARK`, מיקרו-קופי ציבורי.
- `_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-public-home.html` -- המראה.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<new>_public_pages.sql` -- השורות; החלה, ‏`get_advisors`, טיפוסים (**סשן ראשי**).
- [x] `lib/content/schema.ts`, ‏`pages.ts`, ‏`business-details.ts`, ‏`whatsapp.ts` (+tests) -- סכמות, קורא, פרטי עסק מלאים, הודעה בקישור.
- [x] `components/public/*` (+tests) -- ‏top-bar, ‏menu-sheet, ‏whatsapp-bar, פוטר, רכיבי סקשן, פרטי קשר.
- [x] `app/(public)/layout.tsx`, ‏`page.tsx`, ‏`about/`, ‏`how-it-works/`, ‏`gallery/`, ‏`contact/` -- העמודים.
- [x] `app/admin/(shell)/content/contact/preview/`, ‏`actions.ts` -- תצוגה מקדימה ו-`site`.
- [x] `lib/nav.ts`, ‏`lib/copy/shell.ts` (+tests) -- ‏`publicNav`, מיקרו-קופי.
- [x] `supabase/tests/content.test.ts` -- ‏anon רואה סקשן חדש רק אחרי פרסום.
- [x] מסד הפיתוח (**סשן ראשי**) -- תוכן בדוי לכל הסקשנים, מפורסם.
- [x] `deferred-work.md` -- הפריטים מ-Decisions.

**Acceptance Criteria:**
- Given טלפון ברוחב 360px, when אורחת עוברת בכל עמוד דרך התפריט, then הסרגל צמוד למעלה, שום דבר לא נחתך, והפס לא מסתיר את הפוטר.
- Given טל מפרסמת מספר וואטסאפ אחר, when אורחת טוענת עמוד, then הפס, עמוד הקשר והבית מובילים למספר החדש.

## Implementation Notes

- **top-bar:** רקע `primary` (‏#4A4A2A) וטקסט `on-primary` (‏8.46:1). שלוש עמודות שוות כדי ששם העסק יישאר במרכז; ב-360px "כניסה לאזור האישי" נשבר לשתי שורות בתוך מטרת 44px. טבעת הפוקוס בסרגל בצבע `on-primary` (`globals.css`).
- **menu-sheet:** נפתח מ-inline-start (ימין), מצד כפתור התפריט (ראו Spec Change Log). ה-API של `Sheet` מקבל צד פיזי (`side="right"`), ולכן יש שם `eslint-disable` אחד עם הסבר. ה-scrim של 40% מוגדר ב-`globals.css` (`[data-menu-sheet]`), כי `components/ui/` לא נערך.
- **whatsapp-bar:** המקום מתחתיו נשמר ב-padding של המעטפת (לא של `body`), כך שעמוד קצר לא נגלל. וריאנט `short:` (גובה חלון מתחת ל-480px) מסתיר את הפס ומציג את הקישור בזרימה.
- **`getBusinessDetails`:** כשל קריאה נרשם ומחזיר `null` (לא זורק), כדי שכל עמוד ציבורי ימשיך לעלות. ‏`getWhatsappHref` (הצטרפות, ‏`/me`) עובר דרכו, ולכן גם שם כשל קריאה מציג טקסט רגיל במקום שגיאה.
- **בדיקות מסד:** ‏`content-publish.test.ts` מצפה עכשיו לשלושה סקשנים בבית (hero, ‏intro, ‏contact).

## Spec Change Log

- 2026-10-04, החלטת המשתמשת: ה-menu-sheet נפתח מ-inline-start (ימין), מצד כפתור התפריט כמו ב-DESIGN, ולא מ-inline-end כמו שכתוב ב-Decisions.
- 2026-10-04, החלטת המשתמשת: השינויים תחת `app/admin/(shell)/content` נשארים, למרות ההנחיה לא לגעת ב-`app/admin` בזמן ש-3.1 נבנה. הם לא נוגעים ב-sessions ולא בניווט האדמין.

- 2026-10-04, תיקונים אחרי בדיקה של המשתמשת באתר (branch ‏`story-5-2-public-fixes`, ההחלטה ב-memlog של ה-UX). אודות הוא סקשן בבית אחרי הפתיח: אין עמוד `/about` (מפנה לבית) ואין פריט בתפריט. בסרגל העליון שם העסק צמוד לכפתור התפריט. ‏`home/contact` הוא כותרת עם כפתור וואטסאפ, בלי פרטי העסק, ומוצג רק כשיש מספר תקין. ב-`/contact` אין שורת וואטסאפ ואין הוראות תשלום, וכשיש רק מספר וואטסאפ העמוד מציג את מצב העמוד הריק. הפוטר הוא פס בצבע הדיו, עם טלפון, כתובת שפותחת את קישור הניווט, וקישורי תנאי שימוש, מדיניות פרטיות והצהרת נגישות (כל קישור מוצג רק אחרי שהעמוד שלו מתפרסם, ב-5.5). ‏`body` ב-`text_block` אופציונלי. לכן ה-AC על המספר החדש חל על הפס ועל הבית, לא על עמוד הקשר.

## Review Triage Log

**סבב 1 (2026-10-04):** עדשה אחת (quick), 6 ממצאים. ‏medium 2, ‏low 4.

| # | ממצא | פסק | ניתוב | ראיה / פעולה |
|---|------|------|-------|--------------|
| 1 | בחלון נמוך `scroll-padding-top: 0` אבל הסרגל נשאר sticky, ופוקוס יכול להיגלל מתחתיו | medium | patch | מחיקת האיפוס העליון ב-`globals.css` |
| 2 | ה-menu-sheet לא נגלל, ובחלון מתחת ל-400px הקישורים האחרונים נחתכים | medium | patch | גלילה אנכית ל-`SheetContent` |
| 3 | בחירה בעמוד הנוכחי מהתפריט מאבדת את הפוקוס (‏RouteFocus לא רץ על אותו נתיב) | low | patch | `navigating` רק כשהיעד שונה מהעמוד הנוכחי |
| 5 | הבית מציג "פרטי קשר" גם כש-`home/contact` לא פורסם, בניגוד לכלל הקריאה | low | patch | מחיקת הענף החלופי ב-`app/(public)/page.tsx` |
| 6 | ההירו נקרא פעמיים (‏`getHomeHero` ו-`getPublishedSections("home")`), וכשל חלקי מפצל את העמוד | low | patch | ההירו מתוך סקשני הבית |

נדחה: 4 (שם העסק בתצוגה המקדימה של הבית הוא `WORDMARK`; השם שפורסם זהה לו, והתיקון מוסיף קריאה).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm run format:check && npm test` -- expected: עובר
- `npm run test:db`, ‏`npm run build` -- expected: עובר

**Manual checks:**
- צילומי מסך ב-360px של כל עמוד ושל התפריט הפתוח (Chromium headless: `%LOCALAPPDATA%/ms-playwright/chromium_headless_shell-1234/*/chrome-headless-shell.exe --screenshot --window-size=360,1600`).
