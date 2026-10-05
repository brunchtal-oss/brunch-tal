---
title: '3.4 Session details and manual booking — פרטי מפגש ורישום ידני'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'aaf2e864475fca0e114e0e95768d8cec84ecefe0'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-multi-date-booking-and-registration-close.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** לטל אין עמוד למפגש: היא לא רואה מי מגיעה, כמה מקומות פנויים, תינוקות ואלרגיות (מקור §256), ואין לה דרך לרשום לקוחה בעצמה, גם לא אחרי סגירת ההרשמה (מקור §211, §213, CAP-14). הרשמה מוצמדת של לקוחה שעוד לא הצטרפה (3.11) נספרת במכסה אבל לא מוצגת בשום מקום.

**Approach:** קריאת אדמין אחת (definer) לפרטי המפגש והנרשמות, ‏RPC ‏`admin_book_customer` עם preview, עמוד `/admin/sessions/[id]`, דף בוקר המפגש `/day`, ומסלול רישום ידני שנכנסים אליו מהמפגש, מהלקוחה (נתיב בלבד) ומאישור תשלום של כרטיסייה.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-6, ‏AD-7, ‏AD-16, ‏AD-18, ‏AD-19, ‏AD-23. משתמשים ב-`private.book_core`, ‏`private.plan_funding(..., 'admin')`, ‏`private.occupied_places` ו-`private.is_real_booking` כמו שהן. עברית רק ב-`lib/copy/admin.ts` וב-`lib/errors.ts`. בקבצים המשותפים עם 4.12 ו-5.4 (`lib/copy/*`, ‏`lib/errors.ts`, ‏`lib/admin/sensitive-actions.ts`) רק מוסיפים בסוף הבלוק. ‏`session-fields.tsx`, ‏`new/*` ו-`[id]/edit/session-editor.tsx` לא משתנים.

**Decisions:**
- **`admin_get_event_details(p_event_id)`** (קריאה, ‏`is_admin` בשורה הראשונה, ‏grant ל-`authenticated`): המפגש (שם קונספט, ‏kind, ‏status, מועדים, ‏`registration_closes_at`, ‏`capacity_adults`, ‏`occupied` מ-`occupied_places`) ורשימת הרשמות `is_real_booking` לפי `confirmed_at`: ‏`booking_id`, ‏`party_size`, ‏`booked_by`, ‏`guest_details`, ‏`customer_id`, ושם, טלפון, ‏`dietary_notes` ותינוקות (שם, ‏`birth_date`) רק ללקוחה פעילה שפרטיה לא הוסרו. הרשמה בלי לקוחה מחזירה `pending_join: true` ו-`payer_label`. לא קיים ← `NOT_FOUND`.
- **`admin_book_customer(p_customer_id, p_event_id, p_idempotency_key)`:** ‏`is_admin` ← ‏`idempotent_begin` ← נעילת `profiles` שלה (לא קיימת, לא הופעלה או הוסרה ← `CUSTOMER_NOT_AVAILABLE`) ← המפגש ← בדיקות לפי הסדר: לא `published` ← `EVENT_NOT_BOOKABLE`; ‏`ends_at <= clock_timestamp()` ← `EVENT_ENDED` (חדש); רשומה ← `CUSTOMER_ALREADY_BOOKED`; ‏`EVENT_FULL`; ‏`plan_funding('admin')` ← נעילת הזכויות ותכנון חוזר (`CONCURRENT_CHANGE`) ← `book_core(..., 'admin', 'admin_book_customer')`, שמכניסה `booking_confirmed` לתור. ‏`party_size` 2 למפגש זוגי. סגירת ההרשמה לא נבדקת. מחזירה `{booking_id}`.
- **`preview_admin_book_customer(p_customer_id, p_event_id)`:** אותן בדיקות בלי נעילה וכתיבה. מחזירה `{ok, code?, product_name?, expires_on?, occupied, capacity}`. לקוחה שקוראת ← `NOT_AUTHORIZED`.
- **`/admin/sessions/[id]`:** כותרת (`bdi` + ‏`SessionStatusChip`), מועד, ‏`summary-card` (מקומות {occupied}/{capacity} · נרשמות · תינוקות · אלרגיות = נרשמות עם `dietary_notes` או `guest_details`), "מי מגיעה" ב-`attendee-row`, ‏"רישום ידני", "עריכה" ו"למבט בוקר המפגש". מפגש מלא: במקום הכפתור "המפגש מלא ({n}/{n})" וקישור "להעלות את המכסה" לעריכה. מפגש שבוטל, הסתיים או שעבר `ends_at`: תצוגה בלבד, בלי רישום ובלי עריכה. ‏`sessions-list.tsx` מקשר לפרטים.
- **`attendee-row`** (`components/admin/`, ‏DESIGN.md:441, ‏698): שם ב-body-strong ו-"×2" לזוגי, טלפון, תינוקות עם גיל מחושב, ‏`dietary_notes` כמו שנכתב על warning-tint, ‏"מלווה: …". שדה ריק לא מוצג. ממתינה: "לקוחה חדשה · ממתינה להצטרפות" ו-`payer_label` אם יש. פרטים הוסרו: "פרטי הלקוחה הוסרו". שורה אחת, בלי כפתורים בתוכה.
- **`/admin/sessions/[id]/day`:** ‏`summary-card` ורשימת `attendee-row` בלבד, מאותה קריאה. בלי `'use cache'` ובלי אחסון בדפדפן; ‏`private, no-store` מגיע מ-`next.config.mjs` ונבדק בבדיקה.
- **רישום ידני:** ‏`/admin/sessions/[id]/book` (חיפוש לקוחה ב-`admin_search_customers`) ו-`/admin/sessions/book?customer=<id>` (רשימת מפגשים מ-`admin_list_bookable_events` עם {תפוסים}/{מכסה}), שניהם מגיעים ל-`/admin/sessions/[id]/book?customer=<id>`: ‏preview, ‏"ינוצל: כניסה מ{מוצר}, בתוקף עד DD.MM", אישור אחד, תוצאה ב-`inline-notice` וקישור לפרטי המפגש. כשל preview: ההודעה מ-`errorMessage` ו"הוספת תשלום" (`/admin/payments/new/existing/<id>`) ל-`NO_MATCHING_ENTITLEMENT`/`ENTITLEMENT_EXPIRED_ON_DATE`, "להעלות את המכסה" ל-`EVENT_FULL`. המפתח נוצר בטעינה ומתחדש אחרי תשובה (חוץ מחריגת רשת).
- **אחרי אישור כרטיסייה** (`ApprovedPurchase`, לקוחה קיימת, ‏`placed` ריק): קישור "לרישום לתאריך" ל-`/admin/sessions/book?customer=<id>`.
- **מפגש עבר, מבוטל או שהסתיים (deferred):** ‏`[id]/edit/page.tsx` מפנה אליהם ל-`/admin/sessions/[id]`. הסינון של הרשימה עובר לפונקציה טהורה עם בדיקה, בלי שינוי בהתנהגות.
- **החלטות המשתמשת (2026-10-05):** רישום ידני עד `ends_at`; מפגש שבוטל, הסתיים או עבר: פרטים לקריאה בלבד ו-`[id]/edit` מפנה אליו (מיזוג ידני מול 5.4); ה-spec נשאר באורכו.
- **אלרגיות:** שדה אחד, ריק לא מוצג (memlog של ה-SPEC ‏:111, ‏:234 גובר על מקור §179).

**Never:** ממתינות (5.6), לשונית "עבודה" (4.9), קיזוז זוגי (3.5), ביטול הרשמה (3.6), שינוי מועד או ביטול מפגש (3.8), הקישור מכרטיס הלקוחה (4.2), כרטיס "המפגש הבא" בבית (4.1), חריגה מהמכסה, שינוי ב-`book_core`/`plan_funding`/`book_session`, סכימת `party_size` מחוץ ל-`occupied_places` (גם לא ב-TS), קריאה ל-`bookings`/`babies` מהעמוד בלי ה-RPC.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| אחרי סגירה | כרטיסייה, ‏`registration_closes_at` עבר, המפגש עוד לא נגמר | `ok`, ‏`reserve` ‏-1, ‏`booked_by = 'admin'`, ‏`booking_confirmed` אחת בתור, יומן |
| מלא | מכסה 12, תפוסים 12 | `EVENT_FULL`, בלי כתיבה; אחרי העלאה ל-13 ‏`ok` |
| זוגי | זכות זוגית | `party_size` 2, נגרעת כניסה אחת. כרטיסייה בלבד ← `NO_MATCHING_ENTITLEMENT` |
| מוצמד | זכות מוצמדת למפגש הזה / לאחר | `ok` / ‏`NO_MATCHING_ENTITLEMENT` |
| כבר רשומה / לא פורסם / נגמר | | `CUSTOMER_ALREADY_BOOKED` / ‏`EVENT_NOT_BOOKABLE` / ‏`EVENT_ENDED` |
| לקוחה לא זמינה | לא הופעלה או הוסרה | `CUSTOMER_NOT_AVAILABLE` |
| חוזר | אותו מפתח | אותה תוצאה, בלי הרשמה נוספת |
| מקביליות | טל ולקוחה על המקום האחרון | אחת `ok`, השנייה `EVENT_FULL` |
| הרשאות | anon / לקוחה בכל אחת משלוש הפונקציות | 42501 / ‏`NOT_AUTHORIZED` |
| פרטים | זוגית, ממתינה, פרטים הוסרו, מבוטלת | ×2 עם `guest_details`; ‏`pending_join` עם `payer_label`; בלי שם, טלפון, תזונה ותינוקות; מבוטלת לא מוחזרת. ‏`occupied` כולל את הממתינה |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261005171826_multi_date_booking.sql:20` -- ‏`book_session`: דפוס הנעילה, הבדיקות, התכנון החוזר ו-idempotency. לא משנים.
- `20261004191220_bookings_review_fixes.sql:10` -- ‏`book_core` (חתימה: customer, payment, event, party, sources, actor_id, actor_kind, action). ‏`20261004212706_pinned_product_approval.sql:476` -- ‏`plan_funding` (מצב `admin` מממן מוצמדת למפגש שלה; כרטיסייה לעולם לא זוגי בגלל `eligible_event_kind`). ‏`:1027–1088` -- ‏`admin_list_bookable_events`, דפוס קריאת אדמין ו-grant.
- `20261004183409_bookings_and_self_booking.sql` -- ‏`occupied_places` :158, ‏`is_real_booking` :145, ‏`bookings` :32. ‏`20261001195103_create_join_flow.sql` -- ‏`profiles.dietary_notes`, ‏`babies` :51. ‏`20261004072550_payer_label.sql` -- ‏`payments.payer_label`. ‏`20260929154816:76,89` -- ‏`is_admin`, ‏`current_customer_id` (מגדיר "פעילה").
- `supabase/tests/self-booking.test.ts` -- עזרים מקומיים (`seed` :37, ‏`insertEvent` :90, ‏`fill` :129, ‏`as`/`errorAs`, ‏`movementsOf`, ‏`insertEntitlement` :444) להעתקה; בדיקות `prosrc` ‏:812, ‏:835 (רק `book_core` מכניסה ל-`bookings`). ‏`booking-concurrency.test.ts`, ‏`grants.test.ts:15`, ‏`support/db.ts`, ‏`support/money.ts`.
- `app/admin/(shell)/sessions/` -- ‏`page.tsx:47` (הסינון), ‏`sessions-list.tsx:24` (הקישור), ‏`load-session.ts`, ‏`session-draft.ts` (`sessionTitle`), ‏`session-status-chip.tsx`, ‏`actions.ts` (דפוס Action), ‏`[id]/edit/page.tsx` (בדיקת UUID, הערה :22).
- `app/admin/(shell)/payments/new/` -- ‏`actions.ts:258` ‏`searchCustomersAction`; ‏`existing/customer-search.tsx` (הקישור קבוע :97: מוסיפים prop ל-href); ‏`payment-form.tsx:845` ‏`ApprovedPurchase` (לא מקבל את מזהה הלקוחה; הוא ב-`customer`).
- `next.config.mjs:16,61` -- ‏no-store ל-`/admin/:path*`; ‏`next.config.test.ts`.
- `components/shared/{page-heading,inline-notice}.tsx`, ‏`lib/rpc.ts`, ‏`lib/idempotency.ts`, ‏`lib/errors.ts` (`CUSTOMER_ALREADY_BOOKED` :62, ‏`CUSTOMER_NOT_AVAILABLE` :29), ‏`lib/copy/admin.ts:363` (`sessions`), ‏`lib/time.ts`.
- UX: ‏DESIGN.md:441–466, ‏698, ‏707; ‏EXPERIENCE.md:78, ‏230–232, ‏322, ‏336–339, ‏445, ‏531–538; מוקאפ `key-admin-home.html:327` ("טרם נמסר" ו"אין אלרגיות ידועות" שבו לא נכונים).

## Tasks & Acceptance

**Execution:**
- [ ] **סשן ראשי:** למזג `origin/main`, לוודא ב-`list_migrations` ש-`20261005171826_multi_date_booking` מוחלת, ‏`npx supabase migration new admin_session_details_and_manual_booking`.
- [ ] `supabase/migrations/<ts>_admin_session_details_and_manual_booking.sql` -- שלוש הפונקציות, grants לפי AD-5, בלי drop. **סשן ראשי:** ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`, ‏`npm run test:db`.
- [x] `supabase/tests/admin-booking.test.ts` (חדש), ‏`booking-concurrency.test.ts`, ‏`grants.test.ts` -- כל שורה במטריצה.
- [x] `lib/errors.ts` -- ‏`EVENT_ENDED`. ‏`lib/copy/admin.ts` -- הנוסחים מה-Design Notes.
- [x] `components/admin/{attendee-row,summary-card}.tsx` + עזר גיל תינוק טהור עם בדיקה -- מתחילים בסקיל `frontend-design`.
- [x] `app/admin/(shell)/sessions/[id]/{page.tsx,load-details.ts}`, ‏`[id]/day/page.tsx`, ‏`[id]/book/*`, ‏`book/page.tsx`, ‏`actions.ts` (`adminBookCustomerAction`, ‏`previewAdminBookAction`, בדיקת צורה + בדיקה) -- ‏`frontend-design`.
- [x] `sessions-list.tsx`, ‏`load-session.ts` (פונקציית הסינון + בדיקה), ‏`[id]/edit/page.tsx` (הפניה), ‏`customer-search.tsx`, ‏`payment-form.tsx` -- כמו ב-Decisions.
- [x] `next.config.test.ts` -- ‏`/admin/sessions/<id>/day` מקבל `private, no-store`.
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/tickets.toml` -- 3.4 ‏done (ב-PR).

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor מחזיר רק 0029 ו-`auth_leaked_password_protection`; ‏`npm run test:db` עובר בלי שורות `test_%`; ‏lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון ואדמין, when טל פותחת מפגש עם זוגית וממתינה, then היא רואה ×2, את השורה "לקוחה חדשה · ממתינה להצטרפות" ומקומות שכוללים את שתיהן, ואין "טרם נמסר".
- Given אישור כרטיסייה ללקוחה קיימת, when טל לוחצת "לרישום לתאריך", then בתוך שני מסכים היא רושמת אותה לתאריך ורואה את ההרשמה בפרטי המפגש.

## Implementation Notes

- העבודה ב-worktree ‏`.claude/worktrees/story-3-4` (branch ‏`story-3-4-session-details` מ-origin/main ‏aaf2e86, אחרי מיזוג 3.3; ‏`multi_date_booking` מוחלת על מסד הפיתוח). קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261005193624_admin_session_details_and_manual_booking.sql` (ריק). כותבים אליו בלבד, בלי `drop`. ‏`apply_migration` לא עובד אצל סוכן משנה: הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`. עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. ‏`node_modules` ו-`.env.local` כבר קיימים ב-worktree. סוכן משנה לא מבצע git, ‏`rm` או כתיבה ל-`.env*`. בסוף מדווחים מה נשאר לסשן הראשי.

- הוחלה מה-MCP (בלי drop): `20261005193624_admin_session_details_and_manual_booking`. ה-advisor: רק 0029 ו-`auth_leaked_password_protection`. הטיפוסים שנוצרו זהים לעדכון הידני לשלוש הפונקציות; הקובץ שנוצר לא הועתק, כי מסד הפיתוח כבר כולל את המיגרציות של 5.4 ו-4.12 שעוד לא ב-main. ‏`npm run test:db`: ‏486 עוברות ו-3 נכשלות בגלל 5.4 ו-4.12 בלבד (`grants.test.ts`: עמודות `media_assets`, פונקציות המדיה ו-`get_my_entitlements`; ‏`content-publish.test.ts`: `hidden_paths`). כל ההרשאות של 3.4 קיימות, ולא נשארו שורות `test_%`. אחרי מיזוג 5.4 ו-4.12 ה-branch שמתמזג אחרון מעדכן את `grants.test.ts`.
- אחרי תיקוני הביקורת (8 patch): ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (1210) ו-build עוברים; ‏`admin-booking.test.ts` ‏12/12 מול המסד.
- **מיזוג ידני מול 5.4:** ‏`app/admin/(shell)/sessions/[id]/edit/page.tsx` (הפניה למפגש לקריאה בלבד) ו-`sessions-list.tsx` (הקישור לפרטים). ‏`session-fields.tsx`, ‏`new/*` ו-`session-editor.tsx` לא שונו.
- נוסחים שהמממש הוסיף, לאישור המשתמשת: "עריכה", "לפרטי המפגש", "בחירת מפגש", "אין מפגש פתוח לרישום", "רישום לקוחה נוספת", "×2", וגיל תינוק ("פחות משבוע", "שבוע", "שבועיים", "{n} שבועות", "חודש", "חודשיים", "{n} חודשים", ליום המפגש). "המפגש מלא" מציג {תפוסים}/{מכסה} האמיתיים.
- נוסח הדחייה ברישום הידני (המשתמשת, 2026-10-05): לטל ולא ללקוחה. ‏`adminCopy.sessions.bookRefusal` ו-`refusalMessage` ב-`[id]/book/preview.ts` (עם בדיקה): "ללקוחה אין זכות שמתאימה למפגש הזה", "הזכות של הלקוחה אינה בתוקף ביום המפגש", "המפגש מלא. כדי לרשום אותה צריך קודם להעלות את המכסה", "המפגש לא פורסם, ולכן אי אפשר לרשום אליו"; שאר הקודים מ-`errorMessage`. ‏`/admin/sessions/book` (אחרי אישור כרטיסייה) לא מציג מפגש שכבר התחיל; למי שהגיעה בבוקר נכנסים דרך עמוד המפגש.
- דף בוקר המפגש (המשתמשת, 2026-10-05): כמעט זהה לעמוד המפגש. 4.9 ו-4.10 נכנסו להדגמה (סבבים 7 ו-8, מסלול C), עם לשונית "עבודה" נפרדת לשלושת הבראנצ׳ים הקרובים; ‏`/day` נשאר כאן כמו שהוא, ו-4.9 מחליף אותו בהפניה לדף העבודה. נרשם ב-`demo-scope-2026-10-04.md` וב-`tickets.toml` של אפיק 4.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 4, low 9, false 1. patch 8, defer 0, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | מפגש שהתחיל ולא נגמר נעלם מ-`/admin/sessions`, ולכן בבוקר טל לא מגיעה לפרטים, ל-`/day` ולרישום של מי שהגיעה בלי הרשמה | medium | ‏`sessionsListFilter` מסנן `starts_at.gte.now` (blind, edge, intent) | patch: מפגש שפורסם לפי `ends_at.gt.now` |
| 2 | מפגש בטיוטה מציג "רישום ידני", ו-`/book` נכשל תמיד ב-`EVENT_NOT_BOOKABLE` | medium | ‏`isReadOnlySession` מחזיר false ל-draft (blind, edge, intent) | patch: רישום רק ל-`published`, ו-`/book` מפנה |
| 3 | ‏`ManualBooking` בלי בדיקת רינדור: הקישורים אחרי דחייה ומצב ה-ok | medium | רק `refusalAction` נבדק (verification) | patch: ‏`manual-booking.test.tsx` |
| 4 | ‏`customerId` אופציונלי ב-`ApprovedPurchase`; השמטה בקריאה מעלימה את "לרישום לתאריך" בלי כשל | medium | הבדיקות מעבירות אותו בעצמן (verification) | patch: ‏prop חובה |
| 5 | אין בדיקת מסד למפגש ש-`starts_at < now() < ends_at` | low | ‏`insertEvent` לא יוצר כזה (blind) | patch: מקרה ב-`admin-booking.test.ts` |
| 6 | חריגת רשת ברענון ה-preview דורסת את קוד הדחייה האמיתי ל-`SERVER_ERROR` | low | אותו `try` (blind, edge) | patch: ‏try נפרד |
| 7 | ‏`text()` מחזיר את הערך הלא מקוצץ | low | ‏`load-details.ts` (blind) | patch |
| 8 | מבוי סתום: ‏`/admin/sessions/book` עם לקוחה לא זמינה; ‏`/day` בלי חזרה; אחרי רישום אין "רישום לקוחה נוספת" | low | (blind) | patch: קישורים |

Reject (6): ‏`/admin/sessions/book` לא מציג מפגש שכבר התחיל (`admin_list_bookable_events`; תיקון דורש שינוי RPC של 3.11, ואחרי ממצא 1 יש מסלול דרך עמוד המפגש בשלושה מסכים); ‏`product_name` חסר (false: ‏`to_jsonb(product)` כולל תמיד שם); עמודי שרת בלי בדיקה (review-accepted: הבדיקה בטלפון היא ה-e2e); קישור חזרה אחרי "הוספת תשלום"/"להעלות את המכסה", ‏`occupied`/`capacity` שלא מוצגים ב-preview, ‏`registration_closes_at` שלא מוצג, ‏cast ב-`parseEventDetails` (low, תוספת מורכבות או תצוגה).

## Design Notes

**נוסחים חדשים לאישור:** כותרות "מי מגיעה", "רישום ידני", "למבט בוקר המפגש", "לרישום לתאריך"; תוויות summary "מקומות", "נרשמות", "תינוקות", "אלרגיות"; "המפגש מלא ({n}/{n})", "להעלות את המכסה", "הוספת תשלום", "ינוצל: כניסה מ{מוצר}, בתוקף עד {DD.MM}", "לרשום את {שם}", "{שם} נרשמה למפגש", "פרטי הלקוחה הוסרו", "מלווה: …", "עוד אין נרשמות". ‏`EVENT_ENDED`: "המפגש כבר הסתיים".

**למה עד `ends_at`:** טל רושמת גם מי שהגיעה בבוקר בלי הרשמה. אחרי סוף המפגש 3.12 מסמן אותו `completed`, והרשמה שם תיצור ניצול בדיעבד.

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
