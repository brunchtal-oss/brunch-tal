---
title: '5.2 Public pages (static part) — עמודים ציבוריים, חלק סטטי'
type: 'feature'
created: '2026-10-04'
status: 'ready-for-dev'
baseline_commit: '52a282ecc2adb7f9dc767d47befc52c82f2dd1ea'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] `supabase/migrations/<new>_public_pages.sql` -- השורות; החלה, ‏`get_advisors`, טיפוסים (**סשן ראשי**).
- [ ] `lib/content/schema.ts`, ‏`pages.ts`, ‏`business-details.ts`, ‏`whatsapp.ts` (+tests) -- סכמות, קורא, פרטי עסק מלאים, הודעה בקישור.
- [ ] `components/public/*` (+tests) -- ‏top-bar, ‏menu-sheet, ‏whatsapp-bar, פוטר, רכיבי סקשן, פרטי קשר.
- [ ] `app/(public)/layout.tsx`, ‏`page.tsx`, ‏`about/`, ‏`how-it-works/`, ‏`gallery/`, ‏`contact/` -- העמודים.
- [ ] `app/admin/(shell)/content/contact/preview/`, ‏`actions.ts` -- תצוגה מקדימה ו-`site`.
- [ ] `lib/nav.ts`, ‏`lib/copy/shell.ts` (+tests) -- ‏`publicNav`, מיקרו-קופי.
- [ ] `supabase/tests/content.test.ts` -- ‏anon רואה סקשן חדש רק אחרי פרסום.
- [ ] מסד הפיתוח (**סשן ראשי**) -- תוכן בדוי לכל הסקשנים, מפורסם.
- [ ] `deferred-work.md` -- הפריטים מ-Decisions.

**Acceptance Criteria:**
- Given טלפון ברוחב 360px, when אורחת עוברת בכל עמוד דרך התפריט, then הסרגל צמוד למעלה, שום דבר לא נחתך, והפס לא מסתיר את הפוטר.
- Given טל מפרסמת מספר וואטסאפ אחר, when אורחת טוענת עמוד, then הפס, עמוד הקשר והבית מובילים למספר החדש.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm run format:check && npm test` -- expected: עובר
- `npm run test:db`, ‏`npm run build` -- expected: עובר

**Manual checks:**
- צילומי מסך ב-360px של כל עמוד ושל התפריט הפתוח (Chromium headless: `%LOCALAPPDATA%/ms-playwright/chromium_headless_shell-1234/*/chrome-headless-shell.exe --screenshot --window-size=360,1600`).
