---
title: 'בית האזור האישי ומסכי זכויות (4.12)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'aaf2e864475fca0e114e0e95768d8cec84ecefe0'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['edge-case-hunter', 'blind-hunter', 'verification-gap']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-customer-home.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** הבית ב-`/me` הוא שארית של סיפורי ההצטרפות: לכל רכישה שורת קבלה, כרטיס יתרה והודעה, באותו עיצוב. לא ברור מה מוצג, אין הבדל בין סוגי מוצר, אין "המפגש הקרוב", ואין מסך שמראה את כל הזכויות ואת ההיסטוריה שלהן (CAP-9, ‏CAP-13).

**Approach:** בונים מחדש את `/me` לפי המוקאפ והמקור (§5): המפגש הקרוב, ההודעות אחרי רכישה, ואז היתרות הפתוחות. בונים גם את `/me/profile/entitlements` (כל הזכויות) ואת `/me/profile/entitlements/[id]` (פירוט ויומן תנועות). מצב "עומדת לפוג" ו"עוד n ימים" מחושבים ב-SQL ב-RPC קריאה חדשה, `get_my_entitlements`.

## Boundaries & Constraints

**Always:**
- סדר הבית: "היי {שם}" ← המפגש הקרוב ← ההודעות אחרי רכישה ← "הכניסות שלי" ← מקום שמור (בלי UI) להתראות שלא נקראו (5.7).
- `get_my_entitlements()`: ‏`stable security definer`, ‏`search_path = ''`, בשורה הראשונה `auth.uid()` ריק ← `NOT_AUTHORIZED`. ‏`customer_id` רק מ-`private.current_customer_id()` (ריק ← `[]`). ‏`revoke` מכולם ו-`grant execute` ל-`authenticated` בלבד. בלי idempotency (קריאה). לא נוגעים בפונקציות ההרשמה (3.4 משנה אותן במקביל).
- `available`/`reserved`/`used`/`is_expired`/`expired_before_bound` רק מ-`entitlement_balances`. ‏`days_left`, ‏`is_expiring` ו-`is_used_up` מחושבים רק ב-RPC, לפי `Asia/Jerusalem`: ‏`is_expiring` = לא פגה, ‏`available > 0`, ו-`days_left <= customer_expiring_days`.
- יתרה "פתוחה" בבית: `status = 'active'`, לא פגה (או `expired_before_bound`, כמו היום), ולא `is_used_up`. מוצר מוצמד עם הרשמה עתידית מאושרת לא מוצג כיתרה (3.11 נשמר: "המקום שלך שמור", ההודעה והכפתור).
- סכומים ב-`formatAgorot`, תאריכים ב-`lib/time.ts`, מיקרו-קופי ב-`lib/copy/customer.ts`. בלי "טל" בנוסח ללקוחה. ‏`balance-card` הוא יעד יחיד (כל הכרטיס קישור ל-`[id]`).
- כל מסך מתחיל בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- **אישור הרכישה (החלטת המשתמשת 2026-10-05):** בבית הוא מופיע רק בתוך כרטיס ההודעה של המוצר: שורה קטנה מעל ההודעה, "אישור רכישה: {מוצר} · {₪} · נרכשה {DD.MM}" (כמו בעמודה 1 של המוקאפ). הוא נעלם יחד עם ההודעה. אין שורת קבלה נפרדת לכל רכישה. הקבלה המלאה תמיד ב-`[id]`. כך מתקיים גם §4 של המקור.
- **סמן סוג (החלטת המשתמשת 2026-10-05):** רק במסכי הזכויות. לכל שורה וכותרת יש סמן במסגרת דקה (`chip-type` של המוקאפ): "כרטיסייה", "כניסה בודדת", "היכרות", "זוגי". בבית ההבדל נראה בצורה: כרטיסייה מוצגת כ-`balance-card` עם שם המוצר, ומוצמד מוצג כמפגש ("המקום שלך שמור"). בכרטיס מפגש אין תווית סוג.
- האורך (כ-4,000 טוקנים) אושר בלי פיצול (החלטת המשתמשת 2026-10-05).
- **שינוי אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-06, ב-memlog של ה-UX). השינוי גובר על סדר הבית ועל אישור הרכישה שלמעלה:**
  - **בבית אין אישור רכישה.** סדר הבית: המפגש הקרוב, ואז "הבראנצ׳ים הקרובים שלי": שורה לכל מפגש מאוחר יותר, רק יום ותאריך, וכל שורה מקשרת לעמוד המפגש. אחריהם ההודעה והכפתור של המוצר, ובסוף רק כרטיסייה פעילה ("הכרטיסייה שלי"): "ניצלת X/N · נרשמת Y/N" ו"בתוקף עד DD.MM".
  - **מה לא מוצג בבית:** כשאין כרטיסייה פעילה אין שום כרטיס. כרטיסייה שהסתיימה (נוצלה או פגה, גם לפני השיוך) יורדת מהבית. מוצמד מוצג רק כמפגש.
  - **מסך הזכויות נקרא "היסטוריית רכישות"** (`/me/purchases` ו-`/me/purchases/[id]`). יש לו לשונית משלו בסרגל התחתון. כל רכישה מוצגת עם הקבלה שלה (שם, סמן סוג, ₪, תאריך רכישה, תוקף או סטטוס), מהחדשה לישנה.

**Never:** לא בונים `/me/profile` עצמו (2.10), לא מוסיפים לשונית פרופיל או התראות ל-`customerNav`, לא מקשרים ל-`/me/bookings` (3.6), לא מציגים ימי מימוש (בוטלו), לא מוסיפים כפתורי ביטול או הזזה למפגש הקרוב (3.6), ואין `parseFloat`, חישוב תאריכים או השוואה ל-`now()` ב-TS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| רגע אחרי הצטרפות | כרטיסייה 4, בלי שריון | בלי "המפגש הקרוב"; ההודעה והכפתור של המוצר, בלי אישור רכישה; כרטיס "ניצלת 0/4 · נרשמת 0/4 · בתוקף עד DD.MM" | — |
| שריון | 2 משוריינות, הקרוב בעוד 3 ימים | `session-card` של הקרוב + "הבראנצ׳ים הקרובים שלי" עם שורת "{יום} DD.MM" לחיצה לכל אחד מהשאר; כרטיס "ניצלת 0/4 · נרשמת 2/4"; ההודעה נעלמת | — |
| עומדת לפוג | `days_left` ≤ הסף, ‏`available > 0` | "בתוקף עד DD.MM · עוד n ימים" + `status-chip` warning "עומדת לפוג" | אותו מצב עם 0 זמינות: בלי chip |
| מוצמד | בודדת מוצמדת עם הרשמה עתידית | מופיעה כמפגש הקרוב; בלי כרטיס יתרה | — |
| נוצלה כולה / פגה | ‏0·0, או אחרי התפוגה (גם לפני השיוך) | לא בבית; בהיסטוריית הרכישות עם chip "נוצלה" / "פגה" (פגה לפני השיוך: ההערה של 2.4) | — |
| אין כלום | בלי כרטיסייה פעילה, בלי הודעה ובלי הרשמה עתידית | `empty-state` "השולחן מחכה לפעם הבאה" + "צרי קשר" (וואטסאפ) | — |
| פירוט | `[id]` של זכות שלה | סוג, שם, סכום ב-₪, תאריך רכישה, זמינות/משוריינות/נוצלו, תוקף, ויומן תנועות לפי זמן | `[id]` לא שלה או לא קיים ← `notFound()` |
| RPC בלי חיבור | `auth.uid()` ריק | `NOT_AUTHORIZED` | — |

</frozen-after-approval>

## Code Map

- `app/me/page.tsx` -- הבית. ‏`Purchases` עובר לקרוא יתרות מ-`get_my_entitlements` ומפוצל לחלקי הסדר החדש. שומרים את הענף המוצמד של 3.11 ואת `ExpiredCardNote` של 2.4. ‏`SignOutButton` נשאר עד 5.7.
- `app/me/purchase-items.ts` (+test) -- בונה פריטים טהורים. מתאים את `BalanceRow` לשורת ה-RPC, ומוסיף `kind`, ‏`isExpiring`, ‏`daysLeft`, ‏`isUsedUp`. ‏`joinButtonHref` לא משתנה.
- `components/customer/balance-card.tsx` (+test) -- מוסיף: שם המוצר וסמן סוג, "עוד n ימים" ו-chip, ו-`href` (קישור יחיד עם `::after`, chevron ‏`aria-hidden`).
- `components/shared/session-card.tsx` -- לשימוש כמו שהוא למפגש הקרוב (`status` = chip ‏success "נרשמת"). לא משנים (3.3 נגע בו).
- `components/shared/status-chip.tsx`, ‏`contact-text.tsx`, ‏`page-heading.tsx` -- לשימוש חוזר.
- `lib/content/business-details.ts` › `getWhatsappHref` -- ל-`empty-state`.
- `app/me/sessions/load-sessions.ts` › `SESSION_COLUMNS`/`toCustomerSession` -- תבנית לקריאת מפגש וקונספט ב-RLS.
- `lib/copy/customer.ts` -- מיקרו-קופי חדש (כותרות, תוויות סוג ופעולות יומן, ריק).
- RLS קיים (בלי שינוי): ‏`entitlement_movements` (עמודות `id, entitlement_id, booking_id, action, units, reverses_id, created_at`), ‏`bookings`, ‏`events` (לא draft), ‏`concepts`, ‏`payments` (בלי עמודות פנימיות), ‏`entitlements`. ‏`business_settings` לאדמין בלבד, ולכן הסף רק דרך ה-RPC.
- `supabase/migrations/20261004183409_bookings_and_self_booking.sql` › `get_event_availability` -- תבנית ל-RPC קריאה definer.
- `supabase/tests/grants.test.ts` -- רשימת ה-grants הצפויה. מוסיפים שורה.
- `supabase/tests/support/money.ts`, ‏`db.ts` -- fixtures לבדיקת ה-RPC.
- `lib/nav.ts` -- לא משתנה. ב-`/me/profile/...` הלשונית "בית" מסומנת כנוכחית (נכנסים מהבית).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_get_my_entitlements.sql` -- RPC לפי Always. מחזירה jsonb ממוין לפי `expires_on, entitlement_id` עם `entitlement_id, kind, status, product_name` (מ-`product_snapshot`), ‏`amount_agorot, paid_on, original_units, available, reserved, used, expires_on, is_expired, expired_before_bound, days_left, is_expiring, is_used_up, validity_days, pinned_event_id, payment_id`. יוצרים את הקובץ ב-`npx supabase migration new` רגע לפני ההחלה, אחר כך `apply_migration`, ‏`get_advisors` ו-`database.types.ts` -- מקור אחד למצב הנגזר (AD-14, ‏AD-8).
- [ ] `supabase/tests/my-entitlements.test.ts` + `grants.test.ts` -- בודקים: רק שורות שלה (לקוחה B לא רואה את של A), ‏`NOT_AUTHORIZED` בלי חיבור, ‏`is_expiring` בגבול הסף ובלי זמינות, ‏`is_used_up`, ‏`days_left` לפי תאריך מקומי. בודקים גם ששריון והרשמה מוצמדת משנים את `available`/`reserved` כמו סכום התנועות -- בדיקת "זהה ליומן התנועות".
- [ ] `app/me/purchase-items.ts` + test -- התאמה לשורת ה-RPC, וסינון "פתוחה" לבית. בודקים כל שורה במטריצה שאין בה מסד.
- [ ] `components/customer/balance-card.tsx` + test -- סוג, שם, `href`, "עוד n ימים" ו-chip רק כש-`isExpiring`.
- [ ] `app/me/page.tsx` -- הסדר החדש: המפגש הקרוב (ההרשמה המאושרת הקרובה, ‏`starts_at` אחרי עכשיו לפי סדר מהשרת), ‏"ועוד…", ההודעות, הכניסות, וקישור "לכל הכניסות והכרטיסיות". כולל `empty-state` ותגובה (comment) על המקום של 5.7 -- פעם ראשונה עם frontend-design.
- [ ] `app/me/profile/entitlements/page.tsx` -- `h1` "כניסות וכרטיסיות". קבוצת "פעילות" (כרטיסים פתוחים ומוצמדים עתידיים) וקבוצת "קודמות" (פגה, נוצלה, ‏`status` ≠ active ← chip ‏expired). כל שורה `balance-card` מקשר -- frontend-design.
- [ ] `app/me/profile/entitlements/[id]/page.tsx` + `history.ts` (+test) -- הפירוט ויומן התנועות: תנועות ב-RLS, ולכל `booking_id` המפגש ("בראנץ׳ {קונספט} · {יום DD.MM}"). תוויות: ‏grant "רכישה", ‏opening_balance "יתרת פתיחה", ‏reserve "שריון", ‏release "שחרור", ‏use "ניצול", ‏adjust "תיקון", עם `units` בסימן. ‏`history.ts` טהור -- frontend-design.
- [ ] `lib/copy/customer.ts` -- הקופי החדש.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- שתי רשומות: השוואה למסך הכרטיסיות הפתוחות ובדיקה אחרי ביטול (target 3.6, כולל הקישור ל-`/me/bookings` ופעולות במפגש הקרוב), ובדיקה אחרי סיום מפגש (target 3.12).
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/tickets.toml` -- מסמנים את 4.12 כ-done (ב-PR).

**Acceptance Criteria:**
- Given לקוחה עם שריון בכרטיסייה ועם הרשמה מוצמדת, when היא פותחת את `[id]` של כל אחת, then הזמינות, המשוריינות והתנועות זהות ל-`entitlement_movements` במסד.
- Given מסך 360px ב-RTL, when פותחים את שלושת המסכים, then אין גלילה אופקית, יעדי מגע ≥ 44px, ו-`h1` אחד בכל מסך.
- Given קישור `[id]` של לקוחה אחרת, when נפתח, then 404 בלי שום פרט.

## Implementation Notes

- מיגרציה `20261005194705_get_my_entitlements.sql` הוחלה (במסד בגרסה `20261005194737`). ה-advisor נקי. ‏`database.types.ts` קיבל ידנית את השורה של ה-RPC, כי במסד כבר יש מיגרציה של 5.4. יוצרים אותו מחדש אחרי המיזוג.
- `grants.test.ts` נכשל מול מסד הפיתוח רק בגלל ה-grants של 5.4. השורה של 4.12 תקינה.
- תיקון בסשן הראשי: מוצמד שהמפגש שלו התחיל ועוד לא סומן כמנוצל (לפני 3.12) הוצג בבית ככרטיס "0 זמינות · 1 משוריינות". עכשיו `isHomeBalance` מציג מוצמד כיתרה רק כש-`available > 0`. החוק של המצב הריק עבר ל-`isEmptyHome`, ונוספו לו בדיקות.
- הסינון "מפגש עתידי" בבית שולח `new Date()` כפילטר ל-PostgREST, כמו `/me/sessions`. ההשוואה עצמה נעשית במסד.
- החלטות קטנות: כרטיסייה שפגה לפני השיוך מופיעה בבית עם ההערה של 2.4, וב-entitlements ב"קודמות". ‏`status` שאינו active מוצג כ"בוטלה". ‏`use` מוצג בלי מספר.

## Spec Change Log

- **2026-10-06, אחרי הבדיקה בטלפון (המשתמשת):** הבית נראה מבולגן. מה השתנה בבנייה:
  - **הבית:** אישורי הרכישה ירדו. במקום "ועוד מקום שמור לך" יש רשימת "הבראנצ׳ים הקרובים שלי". מוצגת רק כרטיסייה פעילה, עם "ניצלת X/N · נרשמת Y/N". ‏`isHomeBalance` = ‏`card`, לא מוצמד ולא פגה לפני השיוך. הקישור "לכל הכניסות והכרטיסיות" הוסר, כי יש לשונית.
  - **מסך הזכויות:** עבר ל-`/me/purchases`, בשם "היסטוריית רכישות" ועם לשונית ב-`customerNav`. כל רכישה מוצגת ב-`PurchaseRow` חדש, ממוינת לפי `byPaidOnDesc`. ‏`BalanceCard` משמש עכשיו רק לבית.
  - **בלי שינוי:** ה-RPC והמיגרציות.
  - **KEEP:** הסינון של מוצמד, `isEmptyHome`, ‏`get_my_entitlements` והבדיקות שלו.
- **2026-10-06, בדיקה שנייה בטלפון (המשתמשת):**
  - **הבית:** ירדו גם בלוקי ההודעה אחרי רכישה (ההודעה, הכפתור ו"המקום שלך שמור"). נשארו רק המפגש הקרוב, "הבראנצ׳ים הקרובים שלי" והכרטיסייה הפעילה, ולכל אחד כותרת אמיתית.
  - **הכרטיסייה:** מעל "ניצלת X/N  נרשמת Y/N" יש עיגול לכל כניסה (`EntryMeter`).
  - **היסטוריית רכישות:** לכל רכישה שם, בלי סמן סוג, ושורה אחת: מחיר, נרכשה, ותוקף או סטטוס.
  - **הלשונית:** "מפגשים" של הלקוחה נקראת "לו״ז בראנצ׳ים".
  - **קוד שהוסר:** ‏`buildPurchaseItems`, ‏`joinButtonHref` ו-`TypeChip`. במקומם `isHomeCard`.
  - **שימי לב:** הכפתור של 3.3 ("בואי נבחר תאריכים") כבר לא בבית. בחירה מרובה זמינה מ"לו״ז בראנצ׳ים".

## Review Triage Log

**סבב 1** (ביקורת מקוצרת: edge-case על כל ה-diff; blind ו-verification-gap על ה-RPC). ‏high 0, ‏medium 2, ‏low 7, ‏false 1, ‏maybe-false 1.

| # | ממצא | פסק | ניתוב | ראיה / פעולה |
|---|------|-----|-------|--------------|
| B1 | `is_expiring`/`is_used_up` בלי `status = 'active'` | medium | patch | זכות שבוטלה עם כניסות מקבלת "עומדת לפוג". מיגרציה חדשה מוסיפה את התנאי לשני הדגלים |
| E1 | הרשמה למפגש שבוטל מוצגת כ"המפגש הקרוב" | medium | patch | ‏`events` RLS מציג מפגש שבוטל. נוסף `.eq("status","published")` |
| B2/V1 | `not is_expired` ב-`is_expiring` לא נבדק | low | patch | בדיקה: כרטיסייה שפגה עם כניסות |
| B3/V2 | המיון לא נבדק | low | patch | בדיקת סדר עם שתי זכויות |
| B5 | `status` שאינו active, ‏`expired_before_bound` ו-`validity_days` ריק לא נבדקים | low | patch | שלוש בדיקות |
| B7 | `used` לא מושווה ליומן | low | patch | תנועת `use` בבדיקה ו-`used` ב-`fromMovements` |
| B4/V3 | בדיקת `days_left` מקומי משתמשת באותו ביטוי כמו ה-RPC | low | defer | הקוד נכון. אין מנגנון להזרקת זמן |
| B8 | מצב תשלום (`voided`) לא מוחזר | maybe-false | defer | ביטול תשלום עוד לא קיים |

נדחו: E3 (‏`validity_days` שאינו שלם: נכתב מעמודה integer), ‏E4/B6 (אין שורת הגדרות: שורה יחידה מה-seed, כמו `get_event_availability`), ‏E5 (יתרה שלילית: אין זרימת תיקון שיוצרת אותה), ‏E2 (רשימת IN ארוכה: מעט הרשמות ללקוחה), ‏E6 (מוצמד שהמפגש שלו התחיל ב"פעילות": עד סיום המפגש ב-3.12), ‏E7 (סטטוס 200 ל-notFound בתוך Suspense: שום פרט לא מוצג).

## Design Notes

שורת ה-RPC (דוגמה): `{"entitlement_id":"…","kind":"card","product_name":"כרטיסייה אישית","amount_agorot":47200,"paid_on":"2026-09-23","available":2,"reserved":2,"used":0,"original_units":4,"expires_on":"2026-11-11","days_left":9,"is_expiring":true,"is_used_up":false,"is_expired":false,"expired_before_bound":false,"pinned_event_id":null}`.

`days_left = expires_on - (now() at time zone 'Asia/Jerusalem')::date`. התפוגה היא בסוף היום המקומי, ולכן ביום האחרון הערך 0 ("עוד 0 ימים" מוצג כ"היום האחרון"). ‏`is_used_up = available = 0 and reserved = 0 and not is_expired`.

## Verification

**Commands:**
- `npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm test`, ‏`npm run build` -- expected: עוברים.
- `npx vitest run --project db supabase/tests/my-entitlements.test.ts supabase/tests/grants.test.ts` -- expected: עוברים.
- `get_advisors` (security) -- expected: רק ה-WARN המאושרים.

**Manual checks:**
- בטלפון של המשתמשת: לקוחה בדויה, לפני שריון, אחרי שריון ואחרי הרשמה מוצמדת: הבית ו-`[id]` מול יומן התנועות במסד. סכומים ב-₪.
