---
title: '5.16 עמודי המפגשים הציבוריים'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '70c311919a3ce2f2785457f90c0c0c34cd548ab4'
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

**Problem:** אורחת לא יכולה לראות אילו בראנצ׳ים מתוכננים: אין `/sessions`, אין עמוד מפגש ציבורי, ובבית אין מפגשים קרובים. לכן גם כפתור ההירו מוסתר (CAP-1, ‏CAP-41, ‏CAP-12; פוצל מ-5.2).

**Approach:** ‏`/sessions` (כל המפגשים העתידיים שפורסמו, לפי הסדר) ו-`/sessions/[id]` עם `session-card` ו-`concept-header` הקיימים, הפריט "בראנצ׳ים" ב-`publicNav` אחרי "בית" (כפתור ההירו מופיע מעצמו), ואזור "הבראנצ׳ים הקרובים" בבית עם עד 3 מפגשים. הכול נקרא בלקוח ה-anon, בלי שינוי סכמה.

**החלטות המשתמשת (2026-10-05):**
- **מחיר:** רק `display_price_agorot`. בלי מחיר תצוגה לא מוצג מחיר. ברירת המחדל ממחיר המוצר נדחית ל-`event_products` (deferred-work).
- **לקוחה מחוברת:** בעמוד המפגש היא רואה "להרשמה" (קישור ל-`/me/sessions/[id]`) במקום הפעולה של האורחת. הסתרת פס הוואטסאפ, "האזור שלי" וה-chips ברשימה נשארים ב-5.7.
- **סדר הבית:** פתיח ← הבראנצ׳ים הקרובים ← אודות ← המלצות ← קשר.
- **בלי "מגיעות/מגיעים עם התינוקות"** בעמוד המפגש הציבורי.
- **תיאור:** תיאור המפגש אם הוזן, ואחרת תיאור הקונספט (`concepts.description`). הטקסטים לחמשת הקונספטים נכתבים במסד הפיתוח (Design Notes), לא בקוד.
- **נוסחים:** כפי שבטבלה ב-Design Notes, כולל "בראנצ׳ים" (בלי ה׳ הידיעה) בתפריט, בכותרת וב-`<title>`, והמשפט לאורחת "להרשמה לבראנץ׳ צרי קשר או התחברי".

## Boundaries & Constraints

**Always:**
- רק `status = 'published'` ו-`starts_at > now`. טיוטה, מבוטל, הסתיים או עבר לא מוצגים, וב-`[id]` מחזירים `notFound()`.
- הקריאה הציבורית בוחרת עמודות מפורשות בלבד (`PUBLIC_SESSION_COLUMNS`: ‏id, ‏starts_at, ‏description, ‏display_price_agorot, ‏concepts(name, description)). אין `capacity_adults`, אין `bookings` ואין `get_event_availability`. אין תווית רגיל/זוגי, אין תפריט, והכותרת היא "בראנץ׳ {קונספט}".
- AD-2: העמודים והאזור בבית דינמיים, בלי `'use cache'`. הקריאה רצה בתוך `Suspense` אחרי `await connection()`, כך שמעטפת הבית נשארת במטמון.
- מחיר: `display_price_agorot` כשהוזן, תצוגה בלבד, דרך `formatAgorot`.
- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. בטלפון 360px, ‏RTL, כיווני Tailwind לוגיים.
- בקבצים משותפים (`lib/nav.ts`, ‏`lib/copy/*`, ‏`deferred-work.md`) רק מוסיפים. החריג: עדכון `lib/nav.test.ts` ו-`home-hero.test.tsx` שדורשים היום שאין `/sessions`.

**Never:** מיגרציה או שינוי הרשאות (אם מתברר שצריך, עוצרים ושואלים). לקוח service role. נתון תפוסה כלשהו לאורחת. "כתבי לטל" או "דברי עם טל" בנוסח. שינוי של `components/shared/*` שמשנה את מסכי `/me`. הסתרת `whatsapp-bar` כשכפתור ההירו גלוי (נשאר ב-5.4, שעוד לא נבנה).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| רשימה | 5 מפגשים עתידיים שפורסמו + טיוטה + אחד שעבר | 5 כרטיסים לפי `starts_at` ואז `id`; הטיוטה והעבר לא מופיעים | — |
| רשימה ריקה | אין מפגש עתידי שפורסם | `empty-state`: "המפגשים הבאים עוד נרקחים" + קישור וואטסאפ (כשיש מספר) | — |
| בית | 5 מפגשים עתידיים | אזור עם 3 הראשונים ו"לכל הבראנצ׳ים" | — |
| בית ריק או שגיאה | 0 מפגשים, או כשל קריאה | האזור לא קיים, שאר הבית מוצג | כשל נרשם ב-`console.error`, לא זורק |
| עמוד מפגש | id של מפגש עתידי שפורסם | `concept-header`, מחיר אם הוזן, הפעולה, תיאור | — |
| id לא תקין | לא UUID, טיוטה, מבוטל, עבר, לא קיים | `notFound()` | — |
| תיאור | למפגש יש תיאור / אין, ולקונספט יש / אין | תיאור המפגש / תיאור הקונספט / שום תיאור | — |
| מחיר | `display_price_agorot = 13800` / `null` | "138 ₪" / אין שורת מחיר | — |
| פעולה | אורחת / לקוחה מחוברת / אדמין או חשבון בלי פרופיל פעיל | המשפט לאורחת / "להרשמה" / המשפט לאורחת | כשל בבדיקת התפקיד מציג את המשפט לאורחת |
| כשל ברשימה או בעמוד | שגיאת מסד | זורק, לגבול השגיאה | כמו `/me/sessions` |

</frozen-after-approval>

## Code Map

- `app/me/sessions/load-sessions.ts` -- ‏`toCustomerSession`, צורת השורה. לא לשנות. העמודים הציבוריים מקבלים loader משלהם.
- `app/me/sessions/[id]/page.tsx`, ‏`page.tsx` -- הדפוס: `Suspense`, ‏UUID, ‏`notFound`, ‏`ConceptHeader`, מחיר.
- `components/shared/{session-card,concept-header,session-photo}.tsx` -- משתמשים בהם כמו שהם. ‏`ConceptHeader` מניח gutter של 24px (`-mx-6`), ולכן העמוד הציבורי עוטף אותו ב-`px-6` וב-`max-w-[720px]`.
- `lib/supabase/public.ts` -- ‏`createPublicClient` (anon). ‏RLS ‏`events_anon_select`: ‏`status <> 'draft'` (ולכן צריך גם סינון `published`). ‏concepts קריאים ל-anon.
- `lib/auth/require-role.ts`, ‏`lib/auth/destination.ts` (`toSessionRole`), ‏`lib/supabase/server.ts` -- זיהוי לקוחה: `getClaims` ואז `get_my_session_role`.
- `app/(public)/page.tsx` -- סדר הסקשנים בבית. ‏`components/public/sections.tsx` (`PublicSection`, ‏`SectionHeading`), ‏`public-page.tsx` (`PublicPageHeading`, ‏`EmptyPublicPage`).
- `lib/nav.ts` (`publicNav`, ‏`hasPublicSessions`, ‏`currentPublicHref`), ‏`lib/nav.test.ts`, ‏`components/public/home-hero.{tsx,test.tsx}`.
- `lib/copy/shell.ts`, ‏`lib/copy/customer.ts` (`brunch`, ‏`sessionTitle`, ‏`sessionsEmpty`, ‏`book`) -- שימוש חוזר בנוסחים קיימים.
- `lib/time.ts`, ‏`lib/money.ts` -- תצוגה בלבד.
- `supabase/tests/events-admin.test.ts:236` -- דפוס `set local role anon`.

## Tasks & Acceptance

**Execution:**
- [x] `lib/sessions/public.ts` (+test) -- ‏`PUBLIC_SESSION_COLUMNS`, ‏`listUpcomingPublicSessions(limit?)` ו-`getPublicSession(id)` עם הלקוח הציבורי -- מקור אחד, בלי עמודות תפוסה.
- [x] `lib/nav.ts`, ‏`lib/copy/shell.ts` -- פריט "בראנצ׳ים" אחרי "בית" ונוסחים חדשים (הוספה בלבד).
- [x] `lib/nav.test.ts`, ‏`components/public/home-hero.test.tsx` -- מצפים ל-`/sessions` ולכפתור ההירו.
- [x] `app/(public)/sessions/page.tsx`, ‏`app/(public)/sessions/[id]/page.tsx`, ‏`components/public/upcoming-sessions.tsx`, ‏`app/(public)/page.tsx` -- מתחילים בסקיל `frontend-design`. העמודים, האזור בבית והפעולה (אורחת או לקוחה).
- [x] `components/public/*.test.tsx` -- רינדור: אין שדה תפוסה ואין תווית סוג, מחיר מוצג או לא, תיאור מפגש מול קונספט, ריק, אורחת מול לקוחה.
- [x] `supabase/tests/public-sessions.test.ts` -- כ-anon, הבחירה של `PUBLIC_SESSION_COLUMNS` לא מחזירה טיוטה, ומחזירה רק את המפתחות האלה.
- [x] מסד הפיתוח (**סשן ראשי**, נתונים בלבד דרך RPC של האדמין או `execute_sql` על שורות) -- תיאורי חמשת הקונספטים (Design Notes) ומחיר תצוגה לאחד המפגשים, לבדיקה בטלפון.
- [x] `deferred-work.md` -- מחיר ברירת מחדל ממחיר המוצר (יעד: עם `event_products`), הרשאת anon לעמודת `capacity_adults` (יעד: 5.15), ועריכת תיאור הקונספט באדמין (אין היום מסך קונספטים; יעד: אחרי ההדגמה).
- [x] `.memlog.md` של ה-UX -- שורת החלטה: "בראנצ׳ים" בתפריט, המשפט לאורחת, וסדר הבית.

**Acceptance Criteria:**
- Given אורחת לא מחוברת בטלפון 360px, when פותחת את הבית, לוחצת על כפתור ההירו ואז על כרטיס, then מגיעה ל-`/sessions` ול-`/sessions/[id]` בלי התחברות, בלי שום מידע על תפוסה ובלי תווית סוג.
- Given לקוחה מחוברת, when פותחת `/sessions/[id]`, then רואה "להרשמה" שמוביל ל-`/me/sessions/[id]`.
- Given checkout בלי `.env*`, then lint, ‏format:check, ‏typecheck, ‏`npm test` ו-`npm run build` עוברים.

## Implementation Notes

- מסד הפיתוח (סשן ראשי, `execute_sql` על שורות בלבד): תיאורי חמשת הקונספטים, ‏`display_price_agorot = 13800` במפגש "יווני" ב-11.10, ושני מפגשים בדויים שפורסמו ("עם סבוש" ב-14.10, "זוגות" ב-16.10), כדי שכל התיאורים ייראו בטלפון.
- `lib/auth/viewer-role.ts` חדש: ‏`getViewerRole()` לא זורק, וכל כשל נחשב לאורחת. בדיקות: `viewer-role.test.ts`. ‏`upcoming-sessions.test.tsx` בודק שהאזור בבית נעלם בכשל קריאה.
- `SessionCard` קיבל `headingLevel?: 2 | 3` אופציונלי (ברירת מחדל 2, בלי שינוי ב-`/me`). בבית הכרטיסים הם `h3` מתחת לכותרת האזור.
- id שאינו קיים מציג את עמוד ה-not-found עם HTTP 200 ו-noindex, כי העמוד כבר התחיל לזרום בתוך `Suspense`. כך גם `/me/sessions/[id]`.
- הבית עבר מ-○ ל-◐: המעטפת במטמון, ורק אזור המפגשים זורם (AD-2).
- בדיקות: lint, ‏format:check, ‏typecheck, ‏`npm test` (1043), בדיקת המסד `public-sessions.test.ts`, ו-`npm run build` עם `.env.local`. ‏build בלי `.env*` נכשל ב-`/contact` (קריאת התוכן מ-5.2 בזמן prerender), ולא בעמודים של הסיפור הזה. נדחה ל-deferred-work.

## Spec Change Log

- 2026-10-05, החלטת המשתמשת אחרי בדיקה בטלפון (גוברת על Design Notes ועל ה-Never של `/me`):
  - בעמוד המפגש הציבורי התיאור מופיע מעל הפעולה.
  - המשפט לאורחת הוא "להרשמה התחברי או צרי קשר" (ההתחברות קודם, בלי "לבראנץ׳").
  - בעמוד המפגש של הלקוחה (`/me/sessions/[id]`) אין "מגיעות/מגיעים עם התינוקות". התיאור הוא של המפגש, ואחרת של הקונספט, ומופיע מעל הפעולה (`toCustomerSession`, ‏`SESSION_COLUMNS` עם `concepts(name, description)`).
  - בבית, לכרטיסי "הבראנצ׳ים הקרובים" יש צילום ביחס 5:2 (`photoAspect` אופציונלי ב-`SessionCard`, ברירת מחדל 2:1). ב-`/sessions` נשאר 2:1, ובראש עמוד המפגש נשאר 4:3.
  - KEEP: הקריאה הציבורית בעמודות מפורשות, בלי תפוסה ובלי סוג; הלקוחה רואה "להרשמה".
- 2026-10-05, החלטת המשתמשת (סבב שני בטלפון): אין כפתור בהירו (`HomeHero` לא מציג את `hero.cta_label`), כי "הבראנצ׳ים הקרובים" מגיע מיד אחרי הפתיח ונגמר ב"לכל הבראנצ׳ים". בכרטיסי הבית תיווסף בעתיד תמונה בצד שמאל של המלבן (5.4, ‏deferred-work).

## Review Triage Log

**סבב 1 (2026-10-05):** עדשה אחת (quick), 4 ממצאים. ‏medium 1, ‏low 2, ‏false 1 (חלקי). patch 3.

| # | ממצא | פסק | ניתוב | ראיה / פעולה |
|---|------|------|-------|--------------|
| 1 | בבית כותרות הכרטיסים הן `h2`, כמו כותרת האזור, ולכן קורא מסך מציג אותם כסקשנים אחים | medium | patch | ‏`headingLevel` אופציונלי ב-`SessionCard`, ‏3 בבית |
| 2 | הקישורים "צרי קשר" ו"התחברי" בתוך המשפט בלי שטח מגע של 44px | low | patch | ‏`py-2.5` במחלקת הקישור, נשארים בתוך השורה |
| 4 | בדיקת המסד לא כוללת מפגש שעבר (שורת "רשימה" במטריצה) | low | patch | מפגש שפורסם בעבר, ומסונן החוצה |

נדחה: 3 (תקרה של 100 מפגשים ב-`/sessions`; כמו `/me/sessions`, לא מציאותי לעסק); 4ב (הבדיקה לא מריצה את בקשת PostgREST עצמה: בדיקות המסד מתחברות ב-`pg`, והעמודות והסינון נבדקים מול המסד).

## Design Notes

**נוסחים חדשים, אושרו 2026-10-05** (הקיימים בשימוש חוזר: "בראנץ׳ {קונספט}", "להרשמה", "כניסה לאזור האישי", "המפגשים הבאים עוד נרקחים", "לשאלות אפשר לפנות בוואטסאפ"):

| מקום | נוסח |
|---|---|
| תפריט, ‏h1 ו-`<title>` של `/sessions` | בראנצ׳ים |
| כותרת האזור בבית | הבראנצ׳ים הקרובים |
| קישור מתחת לאזור | לכל הבראנצ׳ים |
| עמוד מפגש, אורחת | להרשמה לבראנץ׳ צרי קשר או התחברי. "צרי קשר" הוא קישור לוואטסאפ (טקסט רגיל כשאין מספר תקין), ו"התחברי" הוא קישור ל-`/login?next=/me/sessions/{id}` |
| עמוד מפגש, לקוחה | "להרשמה" (button-primary) |
| מחיר | הסכום בלבד ("138 ₪"), כמו בעמוד המפגש של הלקוחה |

**תיאורי הקונספטים (תוכן במסד הפיתוח, `concepts.description`):**

| קונספט | תיאור |
|---|---|
| אמהות בחל״ד | הפעם מכינים בשבילך. את מגיעה עם התינוק, מתיישבת לשולחן ונהנית מבראנץ׳ עם אמהות נוספות בחופשת לידה. בלי לבשל ובלי לפנות. |
| עם סבתוש | הפעם סבתא באה לבלות. מגיעות עם סבתא והתינוקות לבראנץ׳ של שלושה דורות. |
| עם סבוש | גם לסבא מגיע זמן איכות. מגיעות עם סבא והבייבי לאכול טוב. |
| זוגות | דייט בלי לחפש בייביסיטר. הבייבי בא איתכם |
| יווני | מגיעות עם הקטנטנים לפינוק באווירה ים תיכונית |

`<title>` של עמוד מפגש: "בראנצ׳ים" (כמו `/me/sessions/[id]`, בלי שאילתה ב-metadata).

## Verification

**Commands:**
- `npm run lint && npm run format:check && npm run typecheck && npm test` -- expected: הכול עובר.
- `npx vitest run --project db supabase/tests/public-sessions.test.ts` -- expected: עובר, בלי שורות `test_%`.
- `npm run build` -- expected: עובר, ‏`/sessions` ו-`/sessions/[id]` דינמיים (ƒ או ◐), בלי שגיאת prerender.

**Manual checks:**
- בטלפון: הבית, ‏`/sessions` ועמוד מפגש, כאורחת וכלקוחה מחוברת. 360px, שום דבר לא נחתך, והפס לא מסתיר תוכן.
