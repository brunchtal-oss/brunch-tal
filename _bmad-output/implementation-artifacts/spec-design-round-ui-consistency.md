---
title: 'סבב העיצוב: כללי האחידות במסכי האתר, הלקוחה והאדמין'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '2319bcd3ec02295d9297cb13a2e903a8e48fc337'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** המסכים נבנו סיפור אחרי סיפור, ולכן הריווח, הגדלים, הגופנים והמבנה לא אחידים, ושעת הבראנץ׳ חוזרת בכל רשימה. ב-2026-10-07 אושרו כללי אחידות (DESIGN.md: Brand & Style, Typography, Layout & Spacing, Components; EXPERIENCE.md: בלוק "סבב העיצוב" בראש Information Architecture; memlog של ה-UX).

**Approach:** חמישה חלקים, כל אחד נבדק בטלפון לפני הבא: (1) `session-row` ב-/sessions וב-/me/sessions; (2) בית הלקוחה עם `home-card`; (3) בית האדמין עם `admin-home-actions` ו-`session-tile`; (4) מונה בזעפרן והסרת השעה; (5) מעבר על שאר המסכים לפי טבלאות הריווח, הטיפוגרפיה, הפרופורציות ו"בלי כפילויות". DESIGN.md ו-EXPERIENCE.md קובעים; `versions/combined.html` (מקומי) להשראה בלבד.

## Boundaries & Constraints

**Always:**
- כל חלק מתחיל בסקיל `frontend-design` (כלי Skill), גם אצל סוכן משנה.
- רק ערכי הסולם 4/8/12/16/24/32/48 לפי טבלת "ריווח לפי תפקיד". Heebo 300 רק לשם העסק, לכותרות ולשם הקונספט; Assistant לכל השאר, 400/600, ו-300 רק ל-`numeral-xl` (40). כפתורים בגובה 48 ופינה 4.
- **שעת הבראנץ׳ רק במקום שהיא משרתת את הלקוחה** (החלטת המשתמשת 2026-10-08, מחדדת את 2026-10-07). נשארת: ראש עמוד המפגש (אורחת ולקוחה); גיליון ההרשמה; בבחירה מרובה, הסיכום שלפני האישור ותוצאת ההרשמה; גיליון ביטול ההרשמה; "המפגש הקרוב שלי" בבית; ההרשמות העתידיות ב-/me/bookings. אצל טל רק ראש עמוד המפגש שלה, טופס העריכה ו"ישן ← חדש" בהזזת מועד. יוצאת מכל השאר, גם מהשם הנגיש (sr-only, ‏aria-label): /sessions, ‏/me/sessions, כרטיסי המפגשים ב-`/`, שורות הבחירה המרובה, "הבראנצ׳ים הקרובים שלי", הרשמות שעברו, ואצל טל דף העבודה (גם בהדפסה), חלון ביטול נרשמת, קוביות הבית, רשימת המפגשים, רשימת "עבודה" וההרשמות בכרטיס הלקוחה. שעות שאינן שעת הבראנץ׳ (תוקף קישור, סגירת הרשמה) לא משתנות.
- תמונת "המפגש הקרוב שלי": התמונה הקיימת (של המפגש, ואם אין, של הקונספט), בקריאה קיימת לפי מזהה, בלי שינוי RPC (אושר 2026-10-08).
- בבית האדמין, בקובייה של המפגש הבא, רק "לפרטי המפגש"; "לדף העבודה" יוצא (אושר 2026-10-08).
- מסמכי העיצוב מתעדכנים לכלל השעה החדש (DESIGN › Typography, ‏`session-card`; EXPERIENCE › בלוק "סבב העיצוב"; memlog).
- זעפרן `#E9B949` (טוקן חדש `saffron` ב-`app/globals.css`) רק למונה הפעמון בשני הסרגלים ולמונה "לטיפול", מספר ב-ink.
- קופי ב-`lib/copy/*`, תאריכים מ-`lib/time.ts`, כיוונים לוגיים בלבד.

**Never:**
- לא משנים נוסחים, טקסט שיווקי או נתונים. החריגים היחידים: "כניסות זמינות" (חדש, ב-`lib/copy/customer.ts`) והסרת השעה.
- לא נוגעים בעיצוב של `/` (רק השעה יוצאת מכרטיסי המפגשים), בפוטר הציבורי, ב-`testimonial-carousel`, ובסימון ההסכמות בלשונית העבודה.
- אין מיגרציה, אין שינוי RPC, לא עורכים `components/ui/`. אם חסר נתון ממסד: עוצרים ושואלים.
- לא משנים מבנה מסך מעבר למה שהבלוק "סבב העיצוב" קובע.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| שורה בלי תמונה | למפגש ולקונספט אין תמונה | ריבוע 84 ב-muted, בלי מסגרת ריקה |
| לקוחה מחוברת ב-/me/sessions | מפגש מלא | `status-chip` "מלא" מתחת לתאריך; שם נגיש: "בראנץ׳ {קונספט}, יום שני 12.10, מלא" בלי שעה |
| בית לקוחה בלי מפגש קרוב | רק כרטיסייה | "היי {שם}", ואז "הכרטיסייה שלי"; בלי סקשן ריק |
| שתי כרטיסיות פעילות | שתיהן בתוקף | `home-card` לכל אחת, `numeral-xl` רק בראשונה (פעם אחת במסך); השנייה ב-`numeral-lg` |
| כרטיסייה עומדת לפוג | `isExpiring` | "בתוקף עד DD.MM" + "עוד {n} ימים" + `status-chip` expiring |
| כניסה שחזרה | `isHomeReturned` | נשארת ב-`BalanceCard` אחרי הכרטיסייה ולפני "הבראנצ׳ים הקרובים שלי" |
| בית אדמין, מפגש אחד בלבד | אין מפגש שני | `session-tile` אחת ואחריה "לכל המפגשים" |
| בית אדמין בלי מפגשים | אין עתידיים | מצב הריק הקיים, בתוך קובייה |
| מונה 0 | אין לא-נקראו / אין לטיפול | בלי מונה |

</frozen-after-approval>

## Code Map

- `app/globals.css` -- `@theme`: להוסיף `--color-saffron`. אין טוקנים לטיפוגרפיה; גדלים כתובים כ-`text-[22px] font-light` עם `font-heading` (Heebo) ו-`font-sans` (Assistant, ברירת מחדל).
- `lib/time.ts:70-96` -- `formatTime`, `formatSessionDateTime` (עם שעה), `formatAccessibleDateTime` (עם שעה). להוסיף עזר נגיש ליום ותאריך בלבד אם אין; `formatWeekday`/`formatDayMonth` קיימים.
- `components/shared/session-card.tsx` -- כרטיס קיים; שעה ב-:86 (sr-only) ו-:97. נשאר ל-/me (המפגש הקרוב, 5:2), ל-/me/bookings ול-`/` (`upcoming-sessions.tsx`).
- `components/shared/status-chip.tsx` -- לשימוש חוזר.
- `components/shared/session-photo.tsx`, `lib/media/photo.ts:41` (`sessionPhoto`) -- תמונה עם fallback.
- `components/public/public-sessions.tsx:24-64` -- `PublicSessionList` עובר ל-`SessionRow`; `PublicSessionCard` נשאר ל-`/`.
- `app/me/sessions/page.tsx:140-163`, `session-status.ts` -- ל-`SessionRow` עם הצ׳יפ. `select/session-selector.tsx` (וריאנט בחירה): רק הסרת שעה (:158, :200, :291, :391).
- `app/me/page.tsx` -- בית הלקוחה; `get_my_bookings` לא מחזיר תמונה, ולכן התמונה של המפגש הקרוב נקראת בקריאה קיימת לפי מזהה (`getPublicSession` ב-`lib/sessions/public.ts:104`, או select לפי `SESSION_COLUMNS`), בלי שינוי RPC. שם נגיש בשורות "הבראנצ׳ים הקרובים שלי" (:140) בלי שעה.
- `components/customer/balance-card.tsx` -- `used`, `reserved`, `total`; נשאר רק לכניסה שחזרה. `app/me/purchase-items.ts:15-40` (`MyEntitlement`: `available`, `reserved`, `used`).
- `lib/copy/customer.ts` -- `cardTitle`, `usedOf`, `bookedOf`, `validUntil`, `daysLeft`, `upcomingTitle`, `moreUpcomingTitle`, `allMyBookings`, `brunch`.
- `components/shared/bell-button.tsx:113-127` -- המונה היום `bg-primary-foreground text-primary ring-primary`.
- `app/admin/(shell)/page.tsx:24-42`, `home/next-sessions.tsx`, `home/home-section.tsx`, `home/attention-list.tsx:27-34` (המונה), `home/expiring-cards.tsx`, `home/month-totals.tsx`, `home-items.ts` (`HomeData.upcoming_sessions` עם occupied/capacity; `upcomingRowText`), `components/admin/summary-card.tsx`, `sessions/[id]/load-details.ts:101,121`.
- `lib/copy/admin.ts` -- `addPayment` (:560), `allSessions` (:689), `newSession` (:929); נתיבים `/admin/payments/new`, `/admin/sessions/new`.
- שעה מחוץ לעמוד המפגש באדמין: `sessions/session-draft.ts:310` (`listSummary`), `customers/[id]/card-items.ts:327`, `(shell)/work/page.tsx:79-83`, `home/next-sessions.tsx:46`. נשארים: `sessions/[id]/session-header.tsx`, `app/me/sessions/[id]/booking-panel.tsx`, `app/me/bookings/cancel-booking.tsx`, `components/shared/concept-header.tsx`.
- חלק 5, מסכים: `/me/bookings`, `/me/notifications`, `/me/profile`, `/me/purchases`, `/me/purchases/[id]`, `/me/sessions/[id]`; באדמין: attention, content (כל תת-הנתיבים), customers, `customers/[id]` (+bookings, purchases), links, more, notifications, payments (+new, existing, new-customer), products (+new, [id]), sessions (+new, book, [id], book, day, edit, work), settings (+templates), work.

## Tasks & Acceptance

**Execution:**
- [x] `app/globals.css` -- טוקן `saffron` -- כלל הצבע.
- [x] `lib/time.ts` (+`lib/time.test.ts`) -- עזר נגיש ליום ותאריך בלי שעה -- השם הנגיש של שורות וכרטיסים.
- [x] `components/shared/session-row.tsx` (+test) -- frontend-design; תמונה 84 פינה 4, ריווח 16, "בראנץ׳" `label` ink-muted, שם `display-sm`, תאריך `body-sm` ink, `status` אופציונלי מתחת לתאריך; קו דק בין שורות; השורה קישור אחד -- חלק 1.
- [x] `components/public/public-sessions.tsx`, `app/me/sessions/page.tsx` -- רשימות ב-`SessionRow` -- חלק 1.
- [x] `components/customer/home-card.tsx` (+test), `lib/copy/customer.ts` (`availableEntries`: "כניסות זמינות"), `app/me/page.tsx` -- frontend-design; הסדר והמראה לפי DESIGN › `home-card` ו-`session-card` ("המפגש הקרוב שלי": בלי מסגרת, תמונה 5:2, צ׳יפ "נרשמת" בשורת התאריך); כותרות סקשן `display-sm`, בין סקשנים 32 -- חלק 2.
- [x] `app/admin/(shell)/page.tsx`, `home/home-section.tsx` (קובייה: card, מסגרת 1, פינה 8, ריפוד 16, כותרת `body-strong`), `home/admin-home-actions.tsx`, `home/session-tile.tsx`, `home/next-sessions.tsx` -- frontend-design; הסדר לפי EXPERIENCE; בלי "נרשמות", בלי השורות הנוספות אחרי המפגש השני; "לפרטי המפגש" ב-`button-link` (בלי "לדף העבודה") -- חלק 3.
- [x] `components/shared/bell-button.tsx`, `home/attention-list.tsx` -- מונה זעפרן -- חלק 4.
- [x] `components/shared/session-card.tsx` (prop להצגת שעה: כן במפגש הקרוב ובהרשמות עתידיות ב-/me/bookings, לא ב-`/` ובהרשמות שעברו), `app/me/page.tsx` (:140), `select/session-selector.tsx` (:158, :200; ‏:291 ו-:391 נשארים), `session-draft.ts:310`, `card-items.ts:327`, `(shell)/work/page.tsx`, `home/next-sessions.tsx`, `sessions/[id]/work/work-head.tsx`, `work/work-sheet.tsx`, `sessions/[id]/attendee-cancel.tsx` -- השעה לפי הכלל (גלויה ונגישה) -- חלק 4.
- [x] שאר המסכים מה-Code Map -- frontend-design; ריווח, גדלים, משקלים, פרופורציות, כפילויות, יישור; בלי תוכן ובלי מבנה -- חלק 5.
- [x] בדיקות קיימות -- לעדכן להתנהגות החדשה, לא למחוק: `balance-card.test.tsx`, `public-sessions.test.tsx`, `upcoming-sessions.test.tsx`, `home/empty-states.test.tsx` (:112-140, ‏:57, ‏:160-190), `session-draft.test.ts:273`, `card-items.test.ts:333`, `home-items.test.ts`.

**Acceptance Criteria:**
- Given כל מקום שהכלל מוציא ממנו את השעה, when מוצג או נקרא בקורא מסך, then אין בו שעה; ובכל מקום שהכלל משאיר, השעה מוצגת בפורמט `יום שני 12.10 · 10:30`.
- Given /admin בטלפון, when נטען, then הסדר: "בית", שתי פעולות בשתי עמודות שוות (רווח 8), קובייה למפגש הבא (מקומות X/N, תינוקות, אלרגיות, פס תפוסה 4), קובייה למפגש שאחריו, "לכל המפגשים", "לטיפול" עם מונה זעפרן, כרטיסיות שעומדות לפוג, הסכום.
- Given /me, when נטען, then הסדר: "היי {שם}", המפגש הקרוב, "הכרטיסייה שלי" עם "{n} כניסות זמינות" ופס 4 חלקים (פנויה primary, משוריינת accent, נוצלה border), "הבראנצ׳ים הקרובים שלי", "לכל ההרשמות שלי".
- Given כל מסך באזור האישי ובאדמין, when נבדק, then אין `font-heading` מחוץ לשלושת התפקידים, אין משקל 500/700, ואין ריווח מחוץ לסולם.

## Spec Change Log

## Review Triage Log

**סבב 1 (quick, מבקר אחד):** medium 2, low 3, false 1.

| # | ממצא | Verdict | Route | Evidence / פעולה |
|---|------|---------|-------|------------------|
| 1 | `app/me/home.tsx`: "לכל ההרשמות שלי" בתוך סקשן המפגש הקרוב כשאין מפגשים מאוחרים, ולכן לפני הכרטיסייה | medium | patch | `later.length === 0 && allBookingsLink` בסקשן הראשון; הקישור עובר לסוף הבית + בדיקה |
| 2 | `customers/[id]/page.tsx` מייבא `HomeSection`, שהפך לקובייה, וכרטיס הלקוחה שינה מבנה | medium | patch | ייבוא ב-:14; הדף חוזר למראה הסקשן הקודם, קוביות רק בבית האדמין |
| 3 | `summary-card.tsx:40` ‏gap-2 בין מספר לתווית | low | patch | טבלת התפקידים: 4 |
| 4 | `session-selector.tsx:321` ‏mt-5, ‏:181 ‏mt-1.5 | low | patch | מחוץ לסולם; אותו כפתור ב-mt-6 בשאר הגיליונות |
| 5 | ריווח מחוץ לסולם בשורות ובכרטיסים (py-2.5, ‏px-3.5, ‏px-[22px]) | low | patch | ריפוד שורה 12 וקובייה 16; נשארים שוליים שליליים של יעדי מגע, הזזות יישור, ו-pb-3.5 של `session-card` (מופיע ב-`/`) |

נדחה: 6 (השם הנגיש בשורה "יום שני, 12 באוקטובר" ולא "12.10"): false, המטריצה דורשת שם בלי שעה, והנוסח הוא העזר הנגיש הקיים.

**סבב 2 (quick, מבקר אחד, על השינויים מהבדיקה בטלפון; ההחלטות ב-memlog של ה-UX מ-2026-10-08):** medium 2, low 6, false 4, deferred 1.

| # | ממצא | Verdict | Route | Evidence / פעולה |
|---|------|---------|-------|------------------|
| 1 | עמוד משפטי שפורסם עם גוף ריק עדיין מקושר בפוטר ובטופס ההצטרפות | medium | patch | `getPublishedPageSlugs` בודק רק קיום שורה; עמוד בלי גוף נחשב לא מפורסם |
| 2 | שגיאות שמירה לא נראות בתצוגת "סידור" | medium | patch | ה-ItemList לא מרונדר; חזרה ל"רשימה" כשיש שגיאה |
| 3 | `<bdi>` אחד לכל השורה של הנרשמת | low | patch | שם לועזי הופך את השורה; bdi לכל שם |
| 4 | "×2" אחרי התינוק | low | patch | עובר אחרי שם האם |
| 5 | שורות תיקון ויתרת פתיחה בלי יחידות | low | patch | היחידות חוזרות רק בשורות האלה |
| 6 | פס הבחירה בסידור מזיז את הרשת | low | patch | הפס מוצג תמיד, מושבת בלי בחירה |
| 7 | שדות שהפכו לרשות בלי "(לא חובה)" | low | patch | תוספת לתוויות |
| 8 | חיתוך כיתוב ב-4 עמודות | low | patch | ה-clamp הוסר |
| 9 | כרטיס האדמין בלי שורות "בוטלה" ובלי שורות לכניסה בודדת | low | defer | מבנה אחר (משבצות כניסה); `deferred-work.md` |

נדחו: 10–13 (false: הוראות ההגעה, שם הכפתור בבית והכפתור הכהה ברשימה הם החלטות המשתמשת, נרשמו ב-memlog; ה-memlog החסר הושלם), 14–15 (low: קישור פוטר חצי מלא, טלפון שנטען ולא מוצג).

## Design Notes

- המונה בזעפרן: `bg-saffron text-foreground` (ink), בלי ring ב-primary.
- `numeral-xl`: `text-[40px] font-light leading-none tabular-nums` (Assistant); התווית לידו `text-base`.
- בית אדמין: הקוביות ב-`gap-3` (12); בתוך קובייה שורות עם קו, והשורה הראשונה בלי קו עליון כשיש מעליה כותרת.

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` -- כולם עוברים.

**Manual checks:**
- כל חלק בטלפון (`npm run dev` ברשת הביתית, `npm run dev:reset-link`) לפני הבא: 320px ו-390px, בלי גלילה אופקית, יעדי מגע 44.
