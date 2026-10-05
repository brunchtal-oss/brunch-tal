---
title: '5.3 עורך התוכן המלא והמלצות'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '118c7996ac4ee7e1386d7308c6134063e8d050c1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/demo-scope-2026-10-04.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** בעורך התוכן יש רק ההירו ופרטי העסק. את הפתיח, האודות, "איך זה עובד", השאלות, ההמלצות ונוסח בקשת אישור התמונות אפשר להזין היום רק כשורות במסד (CAP-27; חמשת הפריטים של 5.3 ב-`deferred-work.md`).

**Approach:** עורך אחד שמבוסס על תיאור שדות לכל kind: רשימת עמודים ← רשימת סקשנים של העמוד (`content-section-row`) ← עורך סקשן (שדות טקסט, או רשימת פריטים עם הוספה, סידור, הסתרה ומחיקה) ← תצוגה מקדימה של העמוד הציבורי עם הטיוטה ← פרסום דרך `admin_publish_content` הקיים. בלי מיגרציה. ההמלצות הן טקסט (שם לתצוגה וטקסט), ו-5.4 מוסיף שדה תמונה כסוג שדה חדש בתיאור, בלי לשכתב את העורך.

**החלטות המשתמשת (2026-10-05):**
- **הוראות התשלום:** השדה יוצא מעורך פרטי העסק. הערך נשאר בסכמה ובמסד. איפה להציג אותן נרשם ב-deferred-work.
- **‏site/footer (עודכן באותו יום):** הפוטר נכנס לעורך כעמוד "פוטר" עם רשימת קישורים (שם לתצוגה וכתובת `https://`), למשל לרשתות. אפשר להוסיף, לסדר, להסתיר ולמחוק, עם טיוטה, תצוגה מקדימה ופרסום. הקישורים מוצגים בפוטר מעל שורת הקישורים הקבועה. ‏`footerSchema` הופך ל-`{ text?, items? }`: הטקסט הישן עדיין עובר ולא מוצג, והעורך שומר רק `items`. הטלפון והכתובת בפוטר נשארים מפרטי העסק, ובעמוד "פוטר" בעורך שורה שמפנה לפרטי העסק. השורה `site/footer` נשארת, ולכן אין מחיקה ב-5.19.
- **הסתרת סקשן:** דגל `hidden` בתוך הטיוטה של text_block, ‏steps, ‏faq ו-testimonials. הוא מתפרסם כמו כל שינוי, והאתר והתצוגה המקדימה לא מציגים סקשן מוסתר. לא חל על hero, ‏business_details ו-photo_consent. העמודה `content_sections.hidden` לא בשימוש. סידור הסקשנים לא נכנס, כי סדר הבית נקבע ב-2026-10-05.
- **אין עמוד אודות:** ‏about/main מוצג רק בבית, ולכן בעורך הוא שורה בעמוד "בית" ולא עמוד נפרד. במסד הוא נשאר ב-slug ‏`about`.
- **בלי פיצול:** נוסח בקשת אישור התמונות נשאר בסיפור הזה.
- **אחרי הבדיקה בטלפון (2026-10-05):** (1) מחיקת פריט ברשימה עוברת אישור בתוך השורה: "למחוק את {שם}?" עם "מחיקה" ו"ביטול". (2) בכל סקשן בעורך יש ביטול בשתי רמות. "ביטול השינויים" מופיע כשיש שינוי שלא נשמר, ומחזיר את הטופס לטיוטה השמורה, בלי פנייה לשרת. "חזרה למה שמוצג באתר" מופיע כשיש טיוטה שמורה שלא פורסמה, ואחרי אישור בתוך העמוד שם בטיוטה את התוכן שפורסם (או `{}` כשלא פורסם), דרך `admin_set_content_draft` הקיים, בלי בדיקת סכמה לפי סקשן. בלי מיגרציה.

## Boundaries & Constraints

**Always:**
- עמודים בעורך הם קיבוץ לפי המקום באתר. כל שורה היא סקשן (slug, ‏key): בית (home/hero, ‏home/intro, ‏about/main, ‏home/contact), איך זה עובד (steps, ‏faq), גלריה והמלצות (gallery/testimonials, שמוצג גם בבית), יצירת קשר (contact/intro, ‏contact/business_details), טופס ההצטרפות (join-form/photo_consent), פוטר (site/footer). שמירה ופרסום פועלים על ה-slug של הסקשן. ה-chip של עמוד בעורך מאחד את כל ה-slugs שלו, ותצוגת הבית מציגה את הטיוטות של home ושל about.
- סדר הסקשנים באתר נשאר כמו בקוד (סדר הבית מהחלטת המשתמשת 2026-10-05), והשורות בעורך מוצגות לפי `sort_order`.
- פריט ברשימה (שלב, שאלה, המלצה) נוסף, נערך, זז למעלה ולמטה, מוסתר ומוצג ונמחק. כל השינויים נשמרים בטיוטה עד פרסום. הסידור מוכרז ב-`aria-live="polite"`, וכפתורי הסידור 44×44 עם שם נגיש "להזיז את {שם} למעלה/למטה".
- פריט מוסתר (`hidden: true`) לא מגיע לאף נתיב ציבורי. רשימה בלי פריט גלוי לא מוצגת כסקשן. הסינון נעשה בפונקציה טהורה אחת שמשמשת גם את האתר וגם את התצוגה המקדימה.
- חובת טקסט לפי סקשן: `body` חובה ב-home/intro, ‏about/main ו-contact/intro. ‏home/contact נשאר כותרת בלבד. העורך וה-Action בודקים בסכמה לפי סקשן. האתר ממשיך לפרסר לפי kind, כדי לא לפסול תוכן שכבר פורסם.
- ‏`cta_label` של ההירו יוצא מהעורך והופך לאופציונלי בסכמה. תוכן שפורסם עם `cta_label` עדיין עובר.
- כל הטקסט מוצג כטקסט: React מסנן, ושבירות שורה נשמרות ב-`whitespace-pre-line`. אין HTML, אין markdown ואין `dangerouslySetInnerHTML`. זה סינון ה-XSS.
- כל תווית ומיקרו-קופי של העורך ב-`lib/copy/admin.ts`. בלי טקסט שיווקי בקוד ובלי "טל" בנוסח שהלקוחה רואה. העבודה על המסכים מתחילה בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- פרסום מעדכן את תגי המטמון לפי `publishTags` (‏contact מעדכן גם `content:global`).

**Never:** מיגרציה, RPC חדש או שינוי ב-`admin_publish_content`. העלאת תמונות (5.4). מדיניות פרטיות והצהרת נגישות (5.5). שינוי סדר הסקשנים באתר. עריכה של `components/ui/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| המלצה חדשה | גלריה ← המלצות ← "+ הוספה", שם וטקסט, פרסום | ההמלצה מופיעה ב-`/gallery` ובבית | — |
| הסתרת פריט | שאלה מסומנת "הסתרה", פרסום | השאלה לא ב-`/how-it-works`. בעורך chip "מוסתר" | — |
| הסתרת סקשן | אודות מסומן "הסתרה", פרסום | אודות לא בבית. בעורך chip "מוסתר", ו"הצגה" + פרסום מחזירים אותו | — |
| כל הפריטים מוסתרים או נמחקו | ‏`items: []` או כולם `hidden` | הטיוטה נשמרת ומתפרסמת, והסקשן לא מוצג באתר | — |
| שדה חובה של פריט ריק | המלצה בלי טקסט | לא נשמר. השגיאה ליד השדה של אותו פריט, והפוקוס עליו | הטיוטה הקודמת נשארת |
| פתיח בלי טקסט | home/intro עם כותרת ו-body ריק | "צריך למלא את השדה הזה" ליד הטקסט | לא נשמר |
| home/contact בלי טקסט | כותרת בלבד | נשמר ומתפרסם | — |
| הירו ישן | ‏published עם `cta_label` | עובר את הסכמה ומוצג. שמירה מהעורך מורידה את השדה | — |
| תצוגה מקדימה | טיוטה בגלריה | העמוד הציבורי עם הטיוטה, פריטים מוסתרים לא מוצגים, הפס "תצוגה מקדימה — עוד לא פורסם" | — |
| קישור בפוטר | "אינסטגרם" + ‏`https://instagram.com/x`, פרסום | הקישור בפוטר בכל עמוד ציבורי, נפתח בלשונית חדשה | ‏`http://` או טקסט שאינו קישור: "קישור לא תקין", לא נשמר |
| פוטר ישן | ‏published ‏`{text}` | עובר את הסכמה, לא מוצג כלום מהפוטר הנערך | — |
| slug או key לא מוכרים | ‏`/admin/content/xyz` או key שלא קיים | ‏`notFound()`. ה-Action מחזיר `INVALID_INPUT` | — |
| טיוטה שלא עוברת סכמה | טיוטה שנערכה במסד | ה-`inline-notice` הקיים, והפרסום נחסם | — |

</frozen-after-approval>

## Code Map

- `lib/content/schema.ts` -- ‏heroSchema: ‏`cta_label` אופציונלי. ‏`hidden: z.boolean().optional()` לפריטי steps, ‏faq ו-testimonials ולסקשנים text_block, ‏steps, ‏faq ו-testimonials, ו-`items` עם `min(0)`. ‏footerSchema: ‏`text` אופציונלי ו-`items` של `{label, url (https), hidden?}`. ‏`schemaForSection(slug, key, kind)`: ‏text_block עם body חובה לשלושת הסקשנים, אחרת `schemaForKind`. ‏`schemaForKind` ו-`contentSchemas` נשארים כמו שהם בשביל האתר.
- `lib/content/pages.ts` -- ‏`getPublishedSections` ו-`sectionContent`. כאן מוסיפים את הסינון הטהור (פריטים מוסתרים, רשימה ריקה), או בקובץ חדש `lib/content/visible.ts` שגם התצוגה המקדימה משתמשת בו.
- `app/admin/(shell)/content/content-items.ts` -- ‏`EDITABLE_PAGES` הופך למפה של עמוד עורך (home, ‏how-it-works, ‏gallery, ‏contact, ‏join-form, ‏site) ← רשימת סקשנים (slug, ‏key, ‏kind). לצדה רשימת ה-slugs שמותר לשמור ולפרסם (home, ‏about, ‏how-it-works, ‏gallery, ‏contact, ‏join-form, ‏site). ‏`publishTags` נשאר (`site` ← `content:global`). ‏`hasPendingDraft`, ‏`pageStatus` (על כמה דפים) ו-`fieldErrors` עם נתיב פריט (`items.2.text`). סטטוס סקשן: מוסתר כשבתוכן שיוצג (טיוטה, אחרת פורסם) `hidden: true`.
- `app/admin/(shell)/content/actions.ts` -- ‏`saveContentDraftAction({slug, key, content})` בודק שהזוג נמצא ב-`EDITABLE_PAGES`, ומשתמש ב-`schemaForSection`. ‏`publishContentAction({slug})` בודק כל טיוטה ממתינה ב-`schemaForSection`.
- `app/admin/(shell)/content/content-editor.tsx` -- היום שדות טקסט שטוחים לסקשן אחד. מורחב לתיאור שדות לפי kind: שדות טקסט וסוג `list` עם תיאור שדות לפריט. ‏5.4 יוסיף סוג `image`. הלוגיקה של שמירה, תצוגה מקדימה, פרסום ומפתח ה-idempotency נשארת.
- `app/admin/(shell)/content/editor-page.tsx`, ‏`load-page.ts`, ‏`content-status-chip.tsx` -- לשימוש חוזר. ‏`editor-page` מקבל `key`.
- `app/admin/(shell)/content/home/`, ‏`contact/` -- מוחלפים בנתיבים דינמיים: `[slug]/page.tsx` (רשימת הסקשנים), `[slug]/[key]/page.tsx` (העורך), `[slug]/preview/page.tsx`. ‏`PreviewBar` עובר ל-`content/preview-bar.tsx`.
- `app/admin/(shell)/content/page.tsx` -- רשימת העמודים לפי `EDITABLE_PAGES`.
- `app/(public)/page.tsx`, ‏`how-it-works/page.tsx`, ‏`gallery/page.tsx`, ‏`contact/page.tsx` -- ה-JSX של כל עמוד יוצא לרכיב view שמקבל את הסקשנים, כדי שהתצוגה המקדימה תציג בדיוק את אותו עמוד. אודות מוצג בבית, ולכן התצוגה המקדימה שלו היא הבית.
- `components/public/sections.tsx` -- הרכיבים מקבלים תוכן מסונן. לא משנים עיצוב.
- `components/public/site-footer.tsx`, ‏`app/(public)/layout.tsx` -- הפוטר מקבל גם את הקישורים (`getPublishedSections("site")`, תג `content:global` כבר קיים) ומציג אותם בשורה משלהם, ‏`target="_blank"` עם "(נפתח בחלון חדש)" לקורא מסך.
- `components/public/home-hero.tsx` -- לא קורא `cta_label`. לבדוק שהטיפוס האופציונלי לא שובר אותו.
- טופס ההצטרפות: הרכיב שמציג את `photo_consent` (לחפש לפי `getPhotoConsentContent`) משמש לתצוגה המקדימה של join-form.
- `lib/copy/admin.ts` › `content` -- שמות העמודים, שמות הסקשנים, תוויות השדות ופעולות הפריט. ‏`hero.ctaLabel` ו-`ctaHint` נמחקים. קובץ משותף עם 3.3 שרץ במקביל.
- טסטים קיימים: `content-items.test.ts`, ‏`actions.test.ts`, ‏`content-screens.test.tsx`, ‏`lib/content/schema.test.ts`, ‏`pages.test.ts`, ‏`home-hero.test.tsx`.
- במסד הפיתוח: לכל הסקשנים יש תוכן בדוי שפורסם. ב-`site/footer` יש שורה שפורסמה ולא מוצגת.

## Tasks & Acceptance

**Execution:**
- [x] הפעלת הסקיל `frontend-design` לפני עבודת המסכים, בתוך DESIGN.md (`content-section-row`, ‏`status-chip`) ו-EXPERIENCE.md (עורך התוכן).
- [x] `lib/content/schema.ts` -- ‏cta_label אופציונלי, ‏`hidden` לפריטים, ‏`items.min(0)`, ‏`schemaForSection` -- פריטים 2 ו-5.
- [x] `lib/content/visible.ts` (חדש) -- סינון פריטים מוסתרים והשמטת רשימה ריקה. חל ב-`getPublishedSections` ובתצוגה המקדימה.
- [x] `content-items.ts`, ‏`actions.ts` -- מבנה עמוד ← סקשנים, ‏key ב-Action, ושגיאות עם נתיב פריט.
- [x] `content-editor.tsx` + תיאורי השדות לפי kind (קובץ חדש `section-fields.ts`) -- שדות טקסט ורשימת פריטים.
- [ ] נתיבי `[slug]`, ‏`[slug]/[key]`, ‏`[slug]/preview`. מחיקת `home/` ו-`contact/` הישנים (סשן ראשי).
- [x] רכיבי view לעמודים הציבוריים, והעמודים הציבוריים משתמשים בהם.
- [x] `lib/copy/admin.ts` -- הנוסחים.
- [x] טסטים: ‏schema (‏`schemaForSection`, ‏cta_label ישן, ‏hidden, ‏min(0)), ‏visible, ‏`fieldErrors` עם נתיב פריט, ה-Action (key זר, body חסר ב-intro), ומסך העורך (הוספה, סידור, הסתרה ומחיקה של המלצה).
- [x] סימון 5.3 כ-done ב-`tickets.toml`, ועדכון חמשת הפריטים ב-`deferred-work.md`. רשומה חדשה: איפה מוצגות הוראות התשלום (בלי יעד). פריט הפוטר נסגר כ"נכנס לעורך".

**Acceptance Criteria:**
- Given העורך, when פותחות כל עמוד ברשימה, then כל סקשן שלו מופיע כ-`content-section-row` עם chip, ונפתח לעורך משלו.
- Given המלצה ששמרו ופרסמו, when עורכות, מזיזות, מסתירות ומוחקות ומפרסמות שוב, then `/gallery` והבית משקפים כל שינוי, ופריט מוסתר לא מופיע באף נתיב ציבורי.
- Given חיפוש בעמודים הציבוריים, then אין בהם טקסט שיווקי בקוד, ואין `dangerouslySetInnerHTML`.
- Given טלפון ברוחב 360px, when עורכות ומפרסמות כל עמוד, then הכול נכנס בלי גלילה אופקית, ויעדי המגע 44px לפחות.

## Implementation Notes

- **סדר השורות בעורך:** לפי הסדר ב-`EDITABLE_PAGES`, שהוא סדר האתר. בעמוד "בית" יש שני slugs ‏(home, ‏about), ו-`sort_order` של כל אחד מתחיל מ-1, ולכן מיון לפיו היה מערבב את אודות עם ההירו. בתוך slug אחד הסדר זהה ל-`sort_order`.
- **ה-chip של סקשן:** "מוסתר" מוצג כ-chip נוסף ליד טיוטה/פורסם/שינויים שלא פורסמו, כדי לא לאבד את המידע על שינוי שלא פורסם.
- **הוראות התשלום:** העורך לא מציג אותן, אבל מעביר את הערך השמור הלאה בכל שמירה (`keptFields`), כדי שהשמירה לא תמחק אותו מהמסד.
- **תצוגה מקדימה:** `[slug]/preview` לכל עמוד, כולל טופס ההצטרפות (רכיב `PhotoConsentFieldset` שהוצא מ-`join-form.tsx`) והפוטר (`SiteFooter` עם הקישורים מהטיוטה). בעמוד "בית" כפתור הפרסום בפס מפרסם כל slug שיש בו טיוטה (home ו-about), עם מפתח idempotency לכל אחד. ‏`?section=<key>` מחזיר את "חזרה לעריכה" לסקשן שממנו נפתחה.
- **מחיקת פריט** בלי חלון אישור: היא נשמרת רק בטיוטה, והאתר משתנה רק בפרסום.
- **בדיקת המסך:** אין DOM בפרויקט ה-unit, ולכן הוספה, סידור, הסתרה ומחיקה נבדקות כפעולות טהורות (`section-fields.test.ts`), והמסך נבדק ברינדור סטטי (`content-screens.test.tsx`).
- **סשן ראשי:** למחוק את `app/admin/(shell)/content/home/` ואת `app/admin/(shell)/content/contact/`. הם נתיבים סטטיים שגוברים על `[slug]`, והקוד שלהם כבר לא מתקמפל מול הממשק החדש.

## Spec Change Log

## Review Triage Log

**סבב 1 (2026-10-05):** עדשה אחת (quick), 4 ממצאים. ‏low 4. ‏patch 2, ‏reject 2.

| # | ממצא | verdict | route | ראיה / פעולה |
|---|------|---------|-------|--------------|
| 1 | ‏`preview-bar.tsx`: בית פורסם ואודות נכשל, והפס מציג רק שגיאה בלי רענון | low | patch | ‏`router.refresh()` ושורה "פורסם בחלקו" כשלפחות slug אחד פורסם. השאר נשארים לניסיון חוזר עם המפתחות שלהם |
| 4 | קישור פוטר עם כתובת ריקה מקבל "קישור לא תקין" ולא "צריך למלא" | low | patch | ‏`.min(1)` לפני ה-pipe של `url` |

נדחו: #2 (יותר מהמקסימום של פריטים מציג "עד N תווים": 30 עד 60 פריטים לא קורים בשימוש, והתיקון מוסיף פרמטר), #3 (שגיאה בלי שדה לפוקוס: קורה רק במקרה של #2, כי נתיב השגיאה תמיד מגיע עד שדה טקסט).

## Verification

**Commands:**
- `npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm test` -- expected: הכול עובר, כולל `test/invisible-chars.test.ts`.
- `npm run build` -- expected: הבנייה עוברת.

**Manual checks:**
- בטלפון של המשתמשת: עריכה, תצוגה מקדימה ופרסום של כל עמוד בעורך, ובדיקה שהשינוי מופיע באתר.
