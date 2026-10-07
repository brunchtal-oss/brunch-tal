---
title: 'קרוסלת המלצות בבית וב-/gallery'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '4a4771e377c19f8fc339888bd51a7a8766636512'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** ההמלצות בבית וב-/gallery מוצגות היום כרשימה אנכית ארוכה. לפי החלטת המשתמשת מ-2026-10-07 (memlog של ה-UX, ‏DESIGN › `testimonial-carousel`) הן צריכות להיות קרוסלה שהלקוחה מזיזה ביד בלבד.

**Approach:** `TestimonialsSection` נשאר רכיב שרת שמסנן ומכין את הפריטים, ומעביר אותם לרכיב לקוח חדש `TestimonialCarousel`: שורה אופקית עם CSS scroll-snap, כפתורי הקודם והבא, ונקודות מיקום. בלי תלות חדשה ב-npm.

## Boundaries & Constraints

**Always:**
- הקרוסלה לא זזה לבד אף פעם: אין טיימר, אין autoplay, אין אנימציית פתיחה.
- RTL: ההמלצה הראשונה בצד ההתחלה (ימין). "הבאה" מתקדמת שמאלה. מיקום החץ נקבע לפי `start`/`end` לוגיים, והאייקון משתקף ב-RTL.
- בטלפון כל המלצה ברוחב כמעט מלא, וההבאה מציצה בקצה כרמז.
- כפתורים: יעד מגע 44px, ‏`aria-label` מ-`lib/copy/shell.ts`, וכפתור בקצה מושבת (`disabled`). נקודות: כפתור לכל המלצה, עם `aria-label` ("המלצה n מתוך m") ו-`aria-current="true"` רק על הנוכחית. מקלדת: Tab מגיע לכפתורים ולנקודות, והפוקוס מסומן ב-focus-ring.
- `prefers-reduced-motion`: מעבר מיידי (`behavior: "auto"`), גם בכפתורים ובנקודות.
- המלצת טקסט והמלצת תמונה באותו גובה שורה (הפריטים נמתחים לגובה הגבוה בשורה). התמונה מוצגת שלמה (`object-contain`), עם גובה מרבי, ולא חותכים אותה.
- צבעים, גופנים ופינות רק מהטוקנים הקיימים. כיווני Tailwind לוגיים בלבד.
- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.

**Never:**
- לא נוגעים בעורך התוכן, בסכמה (`lib/content/schema.ts`), במסכים של 2.13 או במיגרציות.
- לא עורכים ולא מייבאים את `components/ui/carousel.tsx` (embla). לא מוסיפים תלות.
- לא משנים שום סקשן אחר בבית או בגלריה.

## I/O & Edge-Case Matrix

| מצב | קלט | התוצאה |
|-----|-----|--------|
| כמה המלצות | 3 גלויות | שורה של 3, כפתורים ו-3 נקודות, הראשונה `aria-current` |
| המלצה מוסתרת | 2 גלויות ואחת `hidden` | רק 2 פריטים ו-2 נקודות. הטקסט המוסתר לא ב-HTML |
| המלצת תמונה בלי קובץ מפורסם | תמונה שאין לה רשומה ב-`images` | הפריט לא מוצג ולא נספר בנקודות |
| המלצה אחת | 1 גלויה (גם אחרי סינון) | הפריט בלבד, בלי כפתורים ובלי נקודות |
| אין המלצות | הכל מוסתר או ריק | הסקשן לא קיים, כמו היום (בגלריה: הדף הריק) |
| תמונה גבוהה | צילום מסך 1:3 | גובה מרבי, התמונה שלמה, השורה לא נשברת |
| הפחתת תנועה | `prefers-reduced-motion: reduce` | לחיצה על כפתור או נקודה קופצת מיד |

</frozen-after-approval>

## Code Map

- `components/public/sections.tsx:196-250` -- `TestimonialsSection` (רכיב שרת): כותרת דרך `PublicSection` ו-`SectionHeading`, תמונה דרך `images[item.image.media_id]` (חסרה ← לא מוצגת). שומרים את המבנה של `figure`/`blockquote`/`figcaption` ואת הקו `border-s-2 border-brand-accent`.
- `components/public/page-views.tsx:77,151` -- הבית וה-/gallery כבר מציגים את `TestimonialsSection` רק כשיש תוכן. לא משנים.
- `lib/content/pages.ts` -- `sectionContent`/`toSections` כבר מסננים פריט וסקשן מוסתרים.
- `lib/copy/shell.ts:110-116` -- `shellCopy.public.sections`. מוסיפים כאן את מיקרו-הקופי של הקרוסלה.
- `components/public/menu-sheet.tsx:56` -- דוגמה לכפתור אייקון 44px (`size-11`, `rounded-[4px]`).
- `app/globals.css:323` -- כלל `prefers-reduced-motion` גלובלי (`scroll-behavior: auto`). לא מכסה `scrollBy({behavior:"smooth"})` מ-JS, לכן הרכיב בודק `matchMedia` בעצמו.
- `components/public/public-shell.test.tsx:213`, ‏`components/public/page-views.test.tsx:20-57` -- בדיקות קיימות של ההמלצות (סביבת node, ‏`renderToStaticMarkup`, בלי jsdom). חייבות להמשיך לעבור.

## Tasks & Acceptance

**Execution:**
- [x] הפעלת הסקיל `frontend-design` לפני כתיבת הרכיב, בתוך DESIGN.md ו-EXPERIENCE.md.
- [x] `components/public/testimonial-carousel.tsx` -- חדש, `"use client"`. מקבל `items: ReactNode[]` ו-`label`. ‏`ul` אופקי עם `snap-x snap-mandatory overflow-x-auto`, פריט ברוחב כ-85% (בטלפון) עם `snap-start`, בלי פס גלילה נראה. מעקב אחרי ההמלצה הנוכחית באירוע scroll. כפתורים ונקודות רק כשיש יותר מפריט אחד. -- הקרוסלה עצמה.
- [x] `lib/carousel.ts` -- פונקציות טהורות: `nearestIndex` (איזה פריט הכי קרוב לקצה ההתחלה, לפי מיקומים במסך, נכון ל-RTL ול-LTR) ו-`clampIndex`. -- כדי שהלוגיקה תיבדק בלי DOM.
- [x] `components/public/sections.tsx` -- `TestimonialsSection` בונה את רשימת הפריטים הגלויים (אחרי סינון תמונה חסרה) ומעביר ל-`TestimonialCarousel`. אם אחרי הסינון הרשימה ריקה, לא מחזיר סקשן. התמונה ב-`max-h` עם `object-contain`.
- [x] `lib/copy/shell.ts` -- `carousel: { previous, next, item(n, m) }` בעברית. -- מיקרו-קופי של המערכת.
- [x] `components/public/testimonial-carousel.test.tsx`, ‏`lib/carousel.test.ts` -- בדיקות: המלצה מוסתרת לא מוצגת, המלצה אחת בלי כפתורים ונקודות, מספר הנקודות, `aria-current` רק על הראשונה, ה-`aria-label` של הכפתורים והנקודות, תמונה חסרה לא נספרת, ו-`nearestIndex` ב-RTL וב-LTR.

**Acceptance Criteria:**
- Given שלוש המלצות בבית, when הלקוחה מחליקה באצבע שמאלה, then מופיעה ההמלצה השנייה והנקודה השנייה מסומנת.
- Given הדף פתוח ולא נוגעים בו, when עוברות כמה דקות, then הקרוסלה לא זזה.
- Given הפוקוס על "הבאה", when לוחצים Enter, then הקרוסלה מתקדמת להמלצה הבאה, ובסוף "הבאה" מושבת.
- Given הדף ב-/gallery עם המלצת תמונה, when הוא נטען, then התמונה שלמה ובאותה שורה עם המלצות הטקסט.

## Implementation Notes

- הכפתורים בקצוות מסומנים `aria-disabled` ולא `disabled`, כדי שהפוקוס לא ייפול ל-body (ביקורת #1).
- יעד ממתין (`pending` ref) שומר על ההמלצה הנוכחית בזמן גלילה רכה. מגע, עכבר או גלגלת על השורה מנקים אותו.
- אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-07): ההמלצה הנוכחית ממורכזת בכל גודל מסך (`snap-center`, ריפוד צד שמאפשר גם לראשונה ולאחרונה להתמרכז; עד 400px מ-`sm`), והשכנות מציצות משני הצדדים. החיצים צמודים לנקודות בשורה אחת ממורכזת, ויעד הנקודה 24×44. המלצת תמונה ממורכזת בלי הקו הצדדי, בגובה קבוע `min(440px,55svh)`, כך שהחיצים נשארים מעל כפתור הוואטסאפ והשורה לא קופצת בטעינה. ‏`nearestIndex` מחשב לפי מרכז.
- בדיקה שנייה בטלפון (החלטת המשתמשת 2026-10-07): הנקודות לא נשברות לשתי שורות. עד `MAX_DOTS` (10) הן בשורה אחת, ויעד המגע של נקודה מצטמצם מ-24px ל-12px במסך צר. מעל 10 מוצג מונה ("3 מתוך 12", ‏`aria-live="polite"`) בין החיצים במקום הנקודות.
- נבדק: ‏`npm test` (1749), ‏lint, ‏typecheck, ‏format:check ו-build עוברים. בדיקת הטלפון נעשית אצל המשתמשת.

## Spec Change Log

## Review Triage Log

סבב 1 (quick, מבקר אחד): medium 2, ‏low 1, ‏false 0, ‏maybe-false 0, ‏defer 1, ‏reject 1.

| # | ממצא | פסק | ניתוב | ראיה ופעולה |
|---|------|-----|-------|-------------|
| 1 | כפתור קצה מקבל `disabled` בזמן שיש עליו פוקוס, והפוקוס נופל ל-body | medium | patch | ‏`disabled` נקבע אחרי הלחיצה האחרונה. הוחלף ב-`aria-disabled` ולחיצה שלא עושה כלום |
| 2 | לחיצה מהירה שנייה על "הבאה" הולכת לאיבוד | medium | patch | ‏`current` מתעדכן רק מה-scroll. נוסף יעד ממתין ב-ref |
| 3 | המלצת תמונה ב-`w-auto`: השורה קופצת כשהתמונה נטענת | low | patch | הוחזר `w-full max-w-[360px]`, עם `max-h` ו-`object-contain` |
| 4 | ב-/gallery, כשכל המלצות התמונה בלי קובץ מפורסם, הדף נשאר בלי תוכן ובלי הדף הריק | medium | defer | המצב היה קיים גם לפני השינוי. התיקון ב-`page-views.tsx`, שמחוץ להיקף |

נדחה: #5 (אין בדיקה ל"הבאה" מושבת בסוף; דורש DOM, ומכוסה בבדיקה בטלפון).

## Design Notes

**למה לא `components/ui/carousel.tsx`:** הוא עוטף את embla (כבר ב-`package.json`), מזיז ב-transform של JS, והחיצים שלו קבועים ל-LTR. DESIGN מגדיר את הרכיב כ-CSS scroll-snap. גלילה טבעית נותנת החלקה, אינרציה ו-RTL של הדפדפן בחינם.

**ניווט בכפתורים, בלי תלות בסימן של `scrollLeft` ב-RTL:**

```ts
const delta = target.getBoundingClientRect().right - track.getBoundingClientRect().right // RTL: start = right
track.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" })
```

ב-LTR משווים את `left`. הכיוון נקבע לפי `getComputedStyle(track).direction`.

**בלי מגבלת כמות (שאלת המשתמשת 2026-10-07):** הקרוסלה לא מגבילה את מספר ההמלצות. הגבול היחיד הוא 60 בסכמה (5.4), ולא משנים אותו כאן. שורת הנקודות `flex-wrap` וממורכזת, כך שגם עשרות נקודות לא גולשות מהמסך.

## Verification

**Commands:**
- `npm test` -- expected: הכל עובר, כולל הבדיקות החדשות והקיימות של ההמלצות.
- `npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm run build` -- expected: בלי שגיאות.

**Manual checks:**
- בטלפון, בבית וב-/gallery: החלקה לשני הכיוונים ו-RTL נכון; לא זזה לבד; כפתורים ונקודות עובדים; המלצת תמונה נראית נכון; עם "הפחתת תנועה" המעבר מיידי.
