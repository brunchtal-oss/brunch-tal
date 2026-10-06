---
title: 'ביטול עצמי עד 48 שעות וביטול דרך האדמין (3.6)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '779f1c5f74dea178a367da6360dfef4557357d9a'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/cancellation-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** לקוחה לא יכולה לבטל הרשמה, וטל לא יכולה לבטל הרשמה של לקוחה, גם לא לשחרר מקום מוצמד שנתקע אחרי `BIND_CONFLICT`. הכניסה נשארת משוריינת והמקום תפוס.

**Approach:** מיגרציה עם `private.cancel_core` אחת, ‏`cancel_booking` (ביטול עצמי, נבדק ב-`private.can_self_cancel` הקיימת) ו-`admin_cancel_booking` כפעולה רגישה (גם בתוך החלון). בכרטיסייה: תנועת `release` לאותה כרטיסייה, בלי הארכה. במוצמדת: הכניסה חוזרת כזכות לאחד מ-N המפגשים הבאים (החלטת המשתמשת 2026-10-06). מסכים: ביטול או "צרי קשר" בעמוד המפגש, בדף חדש `/me/bookings` ובכרטיס "המפגש הקרוב" בבית; ביטול ברשימת הנרשמות באדמין.

**החלטות המשתמשת (2026-10-06):**
- **מוצמדת (בודדת, היכרות, זוגית), בביטול עצמי או באדמין:** ‏`release` לאותה זכות, והזכות הופכת לרגילה שאפשר לממש באחד מ-N המפגשים המתאימים הבאים (N = `business_settings.credit_options_count`, היום 2). ‏`pinned_event_id = null`, ‏`eligibility_snapshot.validity_mode = 'days'` (בגלל ה-check), ‏`valid_from` = היום שאחרי המפגש שבוטל, ‏`expires_on` = התאריך המקומי של המפגש ה-N מבין המפגשים `published` מאותו סוג (`eligible_event_kind`, ‏`allowed_weekdays`), שמתחילים אחרי יום המפגש שבוטל ושיש בהם מקום ברגע הביטול. פחות מ-N (גם אף אחד): הזכות **ממתינה** (`eligibility_snapshot.awaiting_sessions = true`, ‏`returned_from_event_id`, ‏`options_count`), מממנת כל מפגש מתאים שקיים אחרי יום המפגש שבוטל, ו-`expires_on` זמני רחוק. trigger על פרסום מפגש (`events.status` ← `published`) קורא ל-`private.refresh_returned_entitlements`, שמחשבת שוב, וכשיש N קובעת את `expires_on` ומורידה את הדגל (החלטת המשתמשת 2026-10-06: "הזכות תישמר לשני המפגשים המתאימים הבאים"). ‏`get_my_entitlements` מחזיר `awaiting_sessions`, ו-`/me/purchases` והבית מציגים "ממתינה למפגשים הבאים" במקום תאריך. שינוי הזכות נרשם ב-`audit`. ביטול חוזר של הרשמה שמומנה בזכות שחזרה הוא כמו כרטיסייה (`release` בלבד, בלי תוקף חדש). ‏3.7 יחליף את זה בזיכוי.
- **התראה:** תבנית לכל מקרה. ‏`booking_cancelled` לכרטיסייה ו-`booking_cancelled_pinned` חדשה למוצמדת, עם נוסח קבוע ומשתנים `{date}`, ‏`{expires_on}`. אותו נוסח לביטול עצמי ולביטול באדמין.
- **בלי לשונית בסרגל:** ‏`/me/bookings` נפתח מהקישור "לכל ההרשמות שלי" בבית. ‏`lib/nav.ts` לא משתנה.
- **אורך:** ה-spec נשאר מלא.

## Boundaries & Constraints

**Always:**
- חתימות: `cancel_booking(p_booking_id uuid, p_idempotency_key uuid, p_choice text default null)`; ‏`admin_cancel_booking(p_booking_id uuid, p_confirmed boolean, p_idempotency_key uuid, p_reason text default null)`; ‏`preview_admin_cancel_booking(p_booking_id uuid)`; שתי האחרונות דרך `private.plan_admin_cancel_booking` אחת (AD-5, פעולה רגישה). ‏`p_choice` חייב להיות `null` עד 3.7 (אחרת `INVALID_INPUT`).
- סדר: `idempotent_begin` ← נעילת `profiles` של הלקוחה (אם יש) ← קריאת ההרשמה בלי נעילה ← נעילת המפגש ← נעילת ההרשמה ובדיקה חוזרת (שונתה ← `CONCURRENT_CHANGE`) ← נעילת הזכויות שב-`booking_allocations` לפי `id` ← `cancel_core`. בדיקה, עדכון, `release`, ‏`audit` והתראה בעסקה אחת.
- `cancel_core`: ‏`status='cancelled'`, ‏`cancelled_at=now()`; לכל הקצאה `release` של `+units` (ובמוצמדת גם התוקף החדש); ‏`private.audit` עם before/after ו-`p_reason`; ‏`enqueue_notification(<התבנית לפי המקרה>, discriminator = מזהה ה-audit, target '/me/bookings')` (מדלג על `customer_id` ריק). מחזירה `{booking_id, outcome: 'card'|'pinned', entitlement_id, expires_on}`.
- הוספת `booking_cancelled_pinned` ל-check של `notification_templates.type` היא `drop constraint`, ולכן במיגרציה נפרדת שהמשתמשת מריצה ב-SQL Editor (הסשן הראשי רושם אותה ב-`schema_migrations`). כל השאר במיגרציה שמוחלת ב-MCP.
- הלקוחה מבטלת רק הרשמה `confirmed` שלה (לפי `current_customer_id()`); הרשמה אחרת או שלא קיימת ← `BOOKING_NOT_CANCELLABLE`, בלי לחשוף אם קיימת. אחרי החלון ← `SELF_CANCEL_CLOSED`. הגבול רק `can_self_cancel` (`now() <= deadline`, החלון מ-`policy_snapshot`).
- אדמין: כל הרשמה `confirmed`, גם עם `customer_id` ריק, עד `ends_at` של המפגש (אחרי ← `EVENT_ENDED`). בלי `p_confirmed` ← `CONFIRM_REQUIRED`. לקוחה שקוראת ← `NOT_AUTHORIZED`.
- הרשמה עם כמה הקצאות מסוגים שונים (קיזוז זוגי) ← `MANUAL_HANDLING_REQUIRED`.
- `get_my_bookings()` חדש (`authenticated`): הרשמות שלה, עתידיות `confirmed` ועבר (`cancelled`/`completed`, ‏50 אחרונות), עם `can_self_cancel`, סוג המימון, שם המוצר וקונספט. המסכים לא מחשבים מועדים.
- קודים חדשים רק ב-`lib/errors.ts`; קופי ב-`lib/copy/customer.ts` וב-`lib/copy/admin.ts`; `booking_cancel` ב-`lib/admin/sensitive-actions.ts`.
- ללקוחה אין "טל" בנוסח ואין מועד הביטול האחרון באף מקום (החלטת המשתמשת 2026-10-05). כפתור הפנייה "צרי קשר" (`getWhatsappHref`).
- מסכים: מתחילים בסקיל `frontend-design` בתוך DESIGN.md ו-EXPERIENCE.md. תוצאה ב-`inline-notice`, בלי אישור אופטימי; כפתור busy; מפתח idempotency חדש לכל פתיחת גיליון ואחרי כשל.

**Never:** ענף הזיכוי/החזר ו-`cancellation_credits` (3.7); הזזה (3.10); שינוי ב-`admin_get_attention_items` ובבית האדמין (4.1); ‏`/me/profile` (2.10); טופס המפגש `/new`, ‏`/[id]/edit` (5.4); הארכת תוקף בביטול; הצגת מספר מקומות ללקוחה.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| גבול בדיוק | מפגש ב-`now()+48h`, ‏snapshot 48 | בוטלה, `release` +1, התראה אחת | — |
| רגע אחרי | `now()+48h-1s` | לא משתנה דבר | `SELF_CANCEL_CLOSED` |
| שינוי הגדרה | snapshot 48, ההגדרה שונתה ל-72, מפגש בעוד 50 שעות | בוטלה | — |
| כרטיסייה 4 | נרשמה ובוטלה | `available` 4, ‏`reserved` 0, ‏`expires_on` לא השתנה | — |
| חוזר | אותו מפתח פעמיים | אותה תוצאה, `release` אחד | — |
| כפול | מפתח חדש, ההרשמה כבר בוטלה | — | `BOOKING_NOT_CANCELLABLE` |
| של אחרת | הרשמה של לקוחה אחרת | — | `BOOKING_NOT_CANCELLABLE` |
| אדמין בתוך החלון | מפגש בעוד 24 שעות, `p_confirmed` | בוטלה, `release` לכרטיסייה, יומן עם סיבה | — |
| אדמין בלי אישור | `p_confirmed=false` | לא משתנה דבר | `CONFIRM_REQUIRED` |
| מקום תקוע | מוצמדת, `customer_id` ריק, אחרי `BIND_CONFLICT` | המקום משתחרר (`occupied_places` יורד), בלי התראה | — |
| היכרות | הרשמת היכרות בוטלה לפני המפגש | `has_participated` = false | — |
| מוצמדת | בודדת, 3 מפגשים רגילים אחריו, השני מלא | זכות רגילה, `available` 1, ‏`expires_on` = יום המפגש השלישי, אי אפשר להירשם שוב למפגש שבוטל | — |
| מוצמדת בלי עתיד | אין מפגשים מתאימים; אחר כך מתפרסמים שניים | ממתינה; אחרי הפרסום השני `expires_on` = יום השני והדגל יורד | — |
| מוצמדת, ביטול חוזר | נרשמה בזכות שחזרה וביטלה | `release` בלבד, `expires_on` לא משתנה | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004183409_bookings_and_self_booking.sql:32-123,145-180` -- `bookings` (‏`cancelled_at` + check), ‏`can_self_cancel` (לשימוש, לא לשכתב), ‏`occupied_places`, ‏RLS.
- `supabase/migrations/20261005171826_multi_date_booking.sql:20-130` -- `book_session`: שלד ה-RPC (בדיקת קוראת, idempotency, נעילות) להעתקה.
- `supabase/migrations/20261005193624_admin_session_details_and_manual_booking.sql:28,118` -- `admin_get_event_details` (‏`booking_id`, ‏`pending_join`; בלי שינוי), ‏`admin_book_customer` (שלד אדמין).
- `supabase/migrations/20261001184225_create_notification_core.sql:50,223` -- תבנית `booking_cancelled` (גוף `{outcome}`), ‏`enqueue_notification`. ‏`20260930193304_fix_reset_begin_and_audit.sql:69` -- `private.audit`. ‏`20260930191525_create_rpc_contract.sql:34,91` -- idempotency.
- `supabase/migrations/20261004212706_pinned_product_approval.sql:37,476` -- `has_participated`, ‏`plan_funding` (מוצמדת: `validity_mode='session'` ⇔ `pinned_event_id`, תוקף = יום המפגש; check במסד: `money_schema.sql:172`).
- `supabase/tests/support/db.ts`, ‏`support/money.ts` -- `inRollback`, ‏`asAuthenticated`, ‏`queryError`, ‏`seedMoney`, ‏`approve`. ‏`self-booking.test.ts:90,135` -- יצירת מפגש והרשמה עם snapshot. ‏`grants.test.ts` -- `EXPECTED_GRANTS` ממוין.
- `app/me/sessions/[id]/page.tsx`, ‏`booking-panel.tsx:80-82`, ‏`booking-preview.ts` -- מצב `booked` עם `canSelfCancel` כבר מגיע מ-`preview_book_session`; היום רק "את רשומה למפגש הזה.".
- `app/me/sessions/actions.ts:14-33` -- תבנית Action. ‏`lib/idempotency.ts`, ‏`lib/rpc.ts`, ‏`lib/errors.ts` (`ActionResult`).
- `app/me/page.tsx:72-176` -- בית (4.12): הרשמות דרך RLS (`status='confirmed'`), כרטיס `SessionCard` בלי מקום לפעולה; אין קישור ל-`/me/bookings`.
- `lib/nav.ts` + `lib/nav.test.ts` -- כל href חייב `page.tsx`.
- `app/admin/(shell)/sessions/[id]/attendee-list.tsx`, ‏`components/admin/attendee-row.tsx` (רכיב שרת, "no buttons inside"), ‏`components/admin/sensitive-confirm-dialog.tsx`, ‏`app/admin/(shell)/products/[id]/product-editor.tsx:113-145` (preview ← dialog ← confirm), ‏`lib/admin/sensitive-actions.ts`.
- בדיקות רכיב: `renderToStaticMarkup` (אין testing-library); דוגמה `components/admin/attendee-row.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_booking_cancelled_pinned_type.sql` -- **סשן ראשי, המשתמשת מריצה ב-SQL Editor:** החלפת ה-check של `notification_templates.type` כדי לכלול `booking_cancelled_pinned`.
- [x] `supabase/migrations/<ts>_cancel_booking.sql` -- `cancel_core`, ‏`private.return_pinned_entitlement`, ‏`cancel_booking`, ‏`plan_admin_cancel_booking`, ‏`preview_admin_cancel_booking`, ‏`admin_cancel_booking`, ‏`get_my_bookings`, גוף `booking_cancelled` ושורת `booking_cancelled_pinned`; החלה ב-MCP, ‏`get_advisors`, ‏`database.types.ts` מחדש.
- [x] אותה מיגרציה -- trigger הפרסום ו-`private.refresh_returned_entitlements`; ‏`get_my_entitlements` מחזיר `awaiting_sessions` (בלי לשבור את שאר השדות של 4.12); ‏`app/me/purchases/*` והבית מציגים "ממתינה למפגשים הבאים".
- [x] `supabase/tests/cancel-booking.test.ts` -- כל שורות המטריצה + נעילת המפגש מול הרשמה מקבילה למקום האחרון; `grants.test.ts` -- 4 שורות חדשות.
- [x] `lib/errors.ts`, ‏`lib/copy/customer.ts`, ‏`lib/copy/admin.ts`, ‏`lib/admin/sensitive-actions.ts` -- קודים, קופי, `booking_cancel: "האם לבטל את ההרשמה?"`.
- [x] `app/me/bookings/actions.ts` + test -- `cancelBookingAction` (צורה בלבד ← `callRpc`).
- [x] `app/me/bookings/cancel-booking.tsx` -- גיליון ביטול (מה חוזר ולאן, "כן, לבטל", busy, מפתח לכל פתיחה), או `inline-notice` "צרי קשר" כש-`canSelfCancel` false. משמש את שלושת המסכים.
- [x] `app/me/sessions/[id]/booking-panel.tsx` -- מצב `booked` עם ביטול / "צרי קשר"; בדיקת רכיב לשני המצבים ולגיליון ההרשמה.
- [x] `app/me/bookings/page.tsx` -- עתידיות (ביטול או פנייה) ועבר (בוטלה / התקיימה), ריק עם קישור ללו״ז.
- [x] `app/me/page.tsx` -- ביטול מתחת לכרטיס "המפגש הקרוב" וקישור "לכל ההרשמות שלי".
- [x] `components/admin/attendee-row.tsx` (+test) -- slot אופציונלי `action`; `app/admin/(shell)/sessions/[id]/attendee-cancel.tsx` + `actions.ts` -- preview ← `SensitiveConfirmDialog` עם השפעה וסיבה אופציונלית ← ביטול.
- [x] `_bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/tickets.toml`, ‏`deferred-work.md` -- 3.6 done; סגירת 4 הפריטים. ‏`demo-scope-2026-10-04.md` (שורת 3.6) ו-memlog של ה-SPEC -- ההחלטה על המוצמדת מ-2026-10-06.

**Acceptance Criteria:**
- Given הרשמה שבוטלה, when הלקוחה פותחת את הבית ואת `/me/purchases`, then המפגש לא מופיע כקרוב והיתרה זהה ל-`get_my_entitlements`.
- Given ביטול שהצליח, when חוזרים לעמוד המפגש, then אפשר להירשם שוב והמקום פנוי.
- Given מקום תקוע של מוצמדת, when טל מבטלת מרשימת הנרשמות, then השורה נעלמת והתפוסה יורדת.

## Design Notes

נעילת המפגש לפני ההרשמה תואמת את הסדר הגלובלי (`events` ← `bookings` ← `entitlements`) ומונעת deadlock מול `book_session`. ‏`can_self_cancel` משתמשת ב-`now()`, שקבוע לאורך העסקה, ולכן בבדיקות אפשר לבנות מפגש ב-`now() + interval '48 hours'` באותה עסקה ולבדוק את הגבול בדיוק.

## Verification

**Commands:**
- `npm run test:db` -- כולל `cancel-booking`, ‏`self-booking`, ‏`multi-booking`, ‏`admin-booking`, ‏`booking-concurrency`, ‏`pinned-approval`, ‏`bind-purchase`, ‏`my-entitlements`, ‏`grants` ירוקים.
- `npm run lint`, ‏`npx tsc --noEmit`, ‏`npm test`, ‏`npm run build` -- עוברים.

**Manual checks (if no CLI):**
- בטלפון: ביטול עצמי; הרשמה בתוך החלון מציגה "צרי קשר"; ביטול דרך האדמין עם חלון האישור.

## Review Triage Log

**סבב 1 (2026-10-06):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. ‏high 0, medium 4, low 6, false 3, maybe-false 1. אין intent_gap ואין bad_spec.

| # | מקור | ממצא | פסיקה | ניתוב | ראיה / פעולה |
|---|---|---|---|---|---|
| 1 | blind, edge | `returned_validity` סופרת מפגש שההרשמה אליו נסגרה או שכבר התקיים (בחישוב החוזר) | medium | patch | אין `registration_closes_at > now()`; חישוב חוזר אחרי שבועות נותן `expires_on` בעבר |
| 2 | blind | החישוב החוזר יכול לקבוע תוקף לפני מפגש שהזכות הממתינה כבר מממנת (המפגש התמלא בגללה) | medium | patch | מפגש שיש בו הרשמה `confirmed` שמומנה מהזכות הזו נספר גם בלי מקום (כמו "מילאה בעצמה את המקום האחרון") |
| 3 | blind | `get_my_bookings.upcoming` בלי `e.status = 'published'` (הבית סינן קודם) | low | patch | תיקון ישיר, מחזיר את ההתנהגות של 4.12 |
| 4 | blind, edge | בחלון האישור באדמין: "הלקוחה תקבל הודעה" גם כשאין לקוחה; אחרי סירוב הרשימה והתוכנית לא מתרעננות | low | patch | `cancel_core` לא שולח התראה ל-`customer_id` ריק; אין `router.refresh()` בסירוב |
| 5 | verification-gap, blind | מצב "ממתינה" במסכים (`BalanceCard`, ‏`PurchaseRow`, חלון האדמין) בלי בדיקת רינדור; תאריך רחוק עלול לדלוף | medium | patch | אין test עם `awaiting`; להעביר את בחירת הנוסח באדמין ל-`cancel-plan.ts` ולבדוק |
| 6 | verification-gap, intent | אין בדיקת מסד ל-`funding: 'returned'`/`'pinned'`, לזכות ממתינה שמממנת הרשמה, לביטול זוגי ולתיקון `preview_book_sessions` | medium | patch | חיפוש בבדיקות: רק `'card'` נבדק |
| 7 | verification-gap | ההערה של `isHomeReturned` סותרת את הקוד והבדיקה | low | patch | הקוד דורש `available > 0` |
| 8 | blind | `deferred-work.md` מסמן "בדיקת רכיב לגיליון הביטול" כבוצעה, אבל רק המצב הסגור נבדק | low | patch | לתקן את הנוסח לפי מה שנבדק בפועל |
| 9 | בדיקת מסד | `admin-booking.test.ts` תלוי ביום בשבוע (כרטיסייה של שני וחמישי, מפגש בעוד 3 ימים) | medium | defer | קיים מ-3.4, לא נגרם ב-3.6 |

נדחו: התבנית `booking_cancelled_pinned` בלי `{expires_on}` (הנוסח משותף למצב ממתין, והתאריך מוצג במסך); ניסוח "כניסה אחת" בזוגי בכרטיסייה (false: ‏`plan_funding` מחזירה תמיד יחידה אחת); `'returned'` לבודדת לא מוצמדת (false: "באותו תוקף" נכון לה); "התקיימה" למפגש שהתחיל (low, עד 3.12); זכות בלי לקוחה שמתחילה לספור (low, נדיר, תלוי בטיפול ב-`BIND_CONFLICT`); חישוב רק בפרסום (low, הזכות הממתינה ממילא מממנת כל מפגש); ביטול על זכות `revoked` (maybe-false low, אין זרימה שמבטלת זכות עם הרשמה); מפתח חדש אחרי תשובה שאבדה (low, אותו דפוס כמו בהרשמה); סטטוס done לפני בדיקת הטלפון (תהליך: הטלפון לפני ה-commit); הרשמה מחדש עם זכות מוצמדת למפגש שבוטל (false: לפי ההחלטה); ספירת מפגש שהיא כבר רשומה אליו (low).
