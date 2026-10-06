---
title: 'סיום מפגש וניצול (3.12)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '502da928fb86dc8bf72068e87789c62ba9ded219'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** מפגש שהסתיים נשאר `published`, ההרשמות `confirmed` והכניסות "משוריינות" לנצח: כרטיסייה שנוצלה כולה לא עוברת ל"נוצלה", והיתרה בבית ובפירוט לא מראה ניצול. אין במערכת מתזמן.

**Approach:** מיגרציה שמפעילה את pg_cron ומתזמנת `private.job_complete_events()` כל 5 דקות (AD-11): מפגש `published` ש-`ends_at <= now()` עובר ל-`completed`, הרשמות `confirmed` שלו ל-`completed`, ולכל הקצאה מזכות נוספת תנועת `use` (‏units 0, ‏AD-14). אי-הגעה בלי ביטול נחשבת השתתפות וניצול (מקור §כרטיסייה, §היכרות). הרצה כפולה לא משנה דבר.

**החלטות המשתמשת (2026-10-06):**
- **מוצמדת עם `customer_id` ריק:** כמו כל הרשמה: `completed` ו-`use` על הזכות. כשהיא מצטרפת, `bind_purchase` הקיים משייך גם אותה (בלי "נרשמת", והיכרות לא נחסמת בגלל אותה רכישה).
- **עמוד מפגש שהסתיים (פריט 3.8 מ-3.2, רק למפגש `completed`):** `preview_book_session` מחפש את ההרשמה שלה (`confirmed` או `completed`) לפני בדיקת הסטטוס; במפגש `completed` עם הרשמה שלה מחזיר `booked: true`, ‏`can_self_cancel` false וקוד חדש `EVENT_COMPLETED`. בפאנל מצב חדש: "המפגש הסתיים" ו"השתתפת במפגש", בלי ביטול ובלי "צרי קשר". מתחיל בסקיל `frontend-design`. מפגש שבוטל נשאר ל-3.8.
- **אורך:** ה-spec נשאר מלא.

## Boundaries & Constraints

**Always:**
- הפעלה: `create extension if not exists pg_cron with schema pg_catalog;` פעם אחת, ואחריה `cron.schedule('complete_events', '*/5 * * * *', 'select private.job_complete_events()')`. ‏5.8 ו-5.17 מוסיפים `cron.schedule` משלהם בלי לגעת בהפעלה.
- `private.job_complete_events()`: ‏`security definer`, ‏`search_path = ''`, ‏`revoke` מכל התפקידים ובלי `grant` (רק pg_cron, כ-`postgres`, קורא לה). בלי מפתח idempotency (משימה, AD-5). לא נשענת על שעת ה-cron.
- לכל מפגש: נעילת המפגש `for update skip locked` (מפגש נעול מטופל בהרצה הבאה) ← נעילת ההרשמות `confirmed` לפי `id` ← נעילת הזכויות שב-`booking_allocations` לפי `id` ← עדכונים ותנועות, באותה עסקה. סדר הנעילה של AD-6.
- `use` נוסף רק כשאין כבר `use` לאותה הרשמה ולאותה זכות; גיבוי באינדקס ייחודי חלקי על `entitlement_movements (booking_id, entitlement_id) where action = 'use'`. הקצאה מזיכוי (`credit_id`) מדולגת (אין זיכויים עד 3.7).
- `actor_id` ריק ו-`private.audit(null, 'system', 'complete_event', 'events', ...)` לכל מפגש, עם before/after. בלי התראה ובלי פוש.
- `private.occupied_places` סוכמת `party_size` של הרשמות אמיתיות (`private.is_real_booking`: ‏`confirmed` או `completed`), כדי שבפרטי מפגש שהסתיים באדמין התפוסה לא תרד ל-0. במפגש פתוח אין `completed`, ולכן בדיקות המכסה לא משתנות.
- `has_participated`, ‏`intro_blocked` ו-`bind_purchase` כבר נכונים לפני הסיום ואחריו; לא משנים אותם.
- הפעלת `get_advisors`, ‏`database.types.ts` מחדש, והרצה חוזרת של בדיקות ההרשמה, הביטול, המוצמד, השיוך ו-`my-entitlements`.

**Never:** עריכת תנועת `reserve`; שינוי במפגש `draft` או `cancelled`; קביעת סטטוס `completed` ללקוחה שביטלה; Vercel Cron; pg_net או Vault (5.8); `job_reminders` (5.17); `admin_list_open_cards` (לא קיים, E4); "לא הגיעה" כסטטוס נפרד.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ניצול | כרטיסייה 4, הרשמה אחת, המפגש הסתיים | מפגש והרשמה `completed`, `use` אחד; ‏`available` 3, ‏`reserved` 0, ‏`used` 1 | — |
| נוצלה כולה | כרטיסייה 1, הרשמה, המפגש הסתיים | `is_used_up` true; הכרטיסייה יוצאת מהבית ומופיעה ב-`/me/purchases` כ"נוצלה" | — |
| הרצה כפולה | המשימה רצה פעמיים | אותו מצב, `use` אחד, ‏`audit` אחד | — |
| עוד לא הסתיים | `ends_at = now() + 1 minute` | לא משתנה דבר | — |
| ביטלה | הרשמה `cancelled` במפגש שהסתיים | נשארת `cancelled`, בלי `use` | — |
| היכרות, אי-הגעה | הרשמת היכרות `confirmed`, לא הגיעה ולא ביטלה | `completed`; ‏`has_participated` true; רכישת היכרות חדשה נחסמת (`intro_blocked`) | — |
| זוגי | הרשמה `party_size` 2 מזכות זוגית | `use` אחד (יחידה אחת) | — |
| מפגש נעול | הרשמה ידנית מחזיקה את המפגש | מדולג בהרצה הזו, מטופל בבאה | — |
| טיוטה / בוטל | מפגש `draft` או `cancelled` שעבר | לא משתנה דבר | — |
| אדמין | פרטי מפגש שהסתיים | `occupied` = סכום המקומות של ההרשמות שהתקיימו | — |
| מוצמדת בלי לקוחה | הרשמה `customer_id` ריק, המפגש הסתיים; אחר כך `bind_purchase` | `completed`, ‏`use` אחד; אחרי השיוך ההרשמה שלה, בלי התראה | — |
| עמוד שהסתיים, רשומה | מפגש `completed`, הרשמה `completed` שלה | `booked: true`, ‏`can_self_cancel` false; "המפגש הסתיים" + "השתתפת במפגש" | `EVENT_COMPLETED` |
| עמוד שהסתיים, לא רשומה | מפגש `completed`, אין לה הרשמה | `booked: false`; כמו היום ("אי אפשר להירשם") | `EVENT_NOT_BOOKABLE` |
| עמוד שבוטל | מפגש `cancelled` | כמו היום | `EVENT_NOT_BOOKABLE` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql:187-236` -- `entitlement_movements`: ‏check ‏`use` = 0 ודורש `booking_id`; triggers append-only; אין אינדקס ייחודי.
- `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql:68-110` -- view ‏`entitlement_balances`: ‏`used`/`reserved` לפי קיום `use` להרשמה. לא משנים.
- `supabase/migrations/20261004183409_bookings_and_self_booking.sql:32-96,145-168` -- `bookings` (‏status, ‏`customer_id` ריק מותר), ‏`booking_allocations` (‏`entitlement_id` או `credit_id`), ‏`is_real_booking`, ‏`occupied_places` (להחלפה ב-`create or replace`).
- `supabase/migrations/20261004143612_concepts_and_events.sql:61-157` -- `events`; ‏trigger ‏`events_revision` לא עולה ב-`completed`; ‏`events_refresh_returned` רק ב-`published`.
- `supabase/migrations/20260930193304_fix_reset_begin_and_audit.sql:69-110` -- `private.audit` (actor `null, 'system'`).
- `supabase/migrations/20261004212706_pinned_product_approval.sql:37` (‏`has_participated`), ‏`20261005075629_*.sql:13` (‏`intro_blocked`), ‏`20261004221450_pinned_approval_review_fixes.sql:228-345` (‏`bind_purchase` משייך את כל הרשמות התשלום) -- לא משנים.
- `supabase/migrations/20261005232647_cancel_booking.sql:870-981` -- `preview_book_session` (בדיקת הסטטוס בשורות 900-902 לפני חיפוש ההרשמה ב-904-908). ‏`:987-1083` ‏`get_my_entitlements` (‏`is_used_up`), לא משנים.
- `supabase/migrations/20261005225116_admin_home.sql:294` -- "מפגשים קרובים" מסננים `published and ends_at > now()`: מפגש שהסתיים לא מופיע. ‏`app/admin/(shell)/sessions/load-session.ts:58-73` -- הרשימה מסתירה אותו ו-`isReadOnlySession` מטפל ב-`completed`.
- `app/me/purchase-items.ts:104-185`, ‏`app/me/bookings/cancel-result.ts:118` -- הבית, הפירוט ו-`/me/bookings` כבר נגזרים מהמספרים ומ-`completed`; בלי שינוי.
- `app/me/sessions/[id]/booking-preview.ts:77-85`, ‏`booking-panel.tsx:84-129`, ‏`booking-panel.test.tsx` -- המצבים בפאנל; ‏`blocked` מציג היום "אי אפשר להירשם". בדיקות רכיב ב-`renderToStaticMarkup`.
- `supabase/tests/cancel-booking.test.ts:78-140` -- `seed` (מעביר מפגשים `published` אחרים ל-`draft`, כי הבדיקות משותפות למסד הפיתוח), ‏`insertEvent`, ‏`grant`, ‏`book`, ‏`balance`; ‏`admin-home.test.ts:236-241` -- הזזת מפגש לעבר אחרי ההרשמה. ‏`support/db.ts`, ‏`support/money.ts`. ‏`grants.test.ts` -- פונקציה בלי grant לא מוסיפה שורה.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_session_completion_job.sql` (`npx supabase migration new session_completion_job`) -- pg_cron, האינדקס הייחודי, ‏`private.job_complete_events`, ‏`occupied_places` מעודכנת, ‏`cron.schedule`; החלה ב-`apply_migration`, ‏`get_advisors`, ‏`database.types.ts` מחדש.
- [x] `supabase/tests/session-completion.test.ts` -- כל שורות המטריצה (המשימה נקראת ישירות בתוך `inRollback`, מפגשים שמוזזים לעבר אחרי ההרשמה), ובדיקה ש-`cron.job` מכיל את `complete_events` עם `*/5 * * * *`.
- [x] אותה מיגרציה -- `preview_book_session` לפי ההחלטה (שאר הענפים בלי שינוי); בדיקות בקובץ `session-completion.test.ts`.
- [x] `lib/errors.ts`, ‏`lib/copy/customer.ts` -- `EVENT_COMPLETED`; "המפגש הסתיים", "השתתפת במפגש".
- [x] `app/me/sessions/[id]/booking-preview.ts`, ‏`booking-panel.tsx` (+`booking-panel.test.tsx`, ‏`booking-preview` test אם קיים) -- מצב `completed` חדש ב-`inline-notice`, בלי כפתורים; מתחיל בסקיל `frontend-design` בתוך DESIGN.md ו-EXPERIENCE.md.
- [x] `supabase/tests/my-entitlements.test.ts` -- פריט ה-deferred מ-4.12: אחרי המשימה `reserved` ← `used`, ו-`is_used_up` לכרטיסייה שנוצלה כולה, דרך `get_my_entitlements`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- סגירת פריט 4.12 ועדכון פריט 3.8 (נסגר למפגש שהסתיים, נשאר למפגש שבוטל); ‏`tickets.toml` של האפיק -- 3.12 done ו-`unknown` מקבל את תשובת ההשהיה; ‏`demo-scope-2026-10-04.md` -- שורת 3.12.

**Acceptance Criteria:**
- Given כרטיסייה עם הרשמה למפגש שהסתיים, when המשימה רצה והלקוחה פותחת את הבית ואת `/me/purchases/[id]`, then הכניסה מוצגת כמנוצלת והיתרה זהה ליומן התנועות.
- Given מפגש שהסתיים, when טל פותחת את בית האדמין, then הוא לא ב"מפגשים קרובים".
- Given המיגרציה הוחלה, when מריצים `get_advisors`, then אין WARN או ERROR חדשים מלבד המאושרים.

## Implementation Notes

- מיגרציות: `20261006111121_session_completion_job` ו-`20261006142736_session_completion_review_fixes` (תת-בלוק לכל מפגש). ‏`database.types.ts` לא השתנה (רק פונקציות `private` ו-body של `preview_book_session`).
- **נתוני הבדיקה בלי הגבלת ימים (החלטת המשתמשת 2026-10-06: אין הגבלת ימים במוצר אלא אם טל בוחרת):** ‏`seedMoney` (`supabase/tests/support/money.ts`) יוצרת כרטיסייה עם `allowed_weekdays` ריק, ‏`approve-payment.test.ts` מצפה ל-`null`, ובדיקת יום ראשון ב-`self-booking.test.ts` מגבילה את הזכות במפורש. סוגר את פריט `admin-booking` מ-3.6 (נכשל ב-`NO_MATCHING_ENTITLEMENT` ברוב ימי השבוע). במסד הפיתוח אין מוצר או זכות עם הגבלה.
- בדיקת "מפגש נעול" חוזרת על הניסיון אם ה-cron האמיתי סיים את המפגש לפני הנעילה (מסד הפיתוח משותף).
- בדיקה ידנית במסד הפיתוח: מפגש בדוי `429d78d7` ללקוחה הבדויה, כרטיסייה `0c17e7f5`: לפני 2 זמינות / 2 משוריינות; אחרי המשימה 1 / 2 / נוצלה 1 ב-`get_my_entitlements`, ו-`preview_book_session` מחזיר `EVENT_COMPLETED`.
- בדיקת הטלפון (המשתמשת, 2026-10-06): הכול תקין. ‏"ההרשמות שלי" נשאר עם חלק העבר. הכפתור "למבט בוקר המפגש" בעמוד המפגש באדמין נקרא עכשיו "ללשונית העבודה" (`lib/copy/admin.ts`, ‏EXPERIENCE וה-memlog של ה-UX); היעד עובר לדף העבודה ב-4.9 (deferred-work).
- `grants.test.ts` נכשל עד המיזוג של 5.7 (`mark_notifications_read`/`unread` כבר במסד).

## Review Triage Log

**סבב 1 (2026-10-06):** blind-hunter, edge-case-hunter, verification-gap (אין פערים), intent-alignment. ‏high 0, medium 2, low 6, false 3, maybe-false 0. ‏intent_gap אחד (`bind_purchase`) הוצג למשתמשת והוחלט defer, בלי חזרה לאחור.

| # | מקור | ממצא | פסיקה | ניתוב | ראיה / פעולה |
|---|---|---|---|---|---|
| 1 | blind, edge | שגיאה במפגש אחד מגלגלת לאחור את כל ההרצה, ובשגיאה קבועה אף מפגש לא מסתיים | medium | patch | תת-בלוק `exception` לכל מפגש עם `raise warning`, במיגרציה חדשה, ובדיקה |
| 2 | edge, intent | `bind_purchase` לא חוסם כפילות כשההרשמות `completed` (הבדיקה והאינדקס רק על `confirmed`) | medium | defer | החלטת המשתמשת: נדיר (אישור בטעות כ"חדשה" למי שיש לה חשבון ונרשמה לאותו מפגש) |
| 3 | blind | הרשמה בזיכוי מדולגת בלי פריט מעקב ל-3.7 | low | defer | אין זיכויים היום; פריט ל-3.7 |
| 4 | blind | אין בדיקה שהרשמה `completed` אי אפשר לבטל | low | patch | בדיקה: `cancel_booking` ו-`admin_cancel_booking` ← `BOOKING_NOT_CANCELLABLE`, בלי `release` |
| 5 | blind | הגבול `ends_at = now()` לא נבדק | low | patch | בדיקה |
| 6 | intent | "היכרות לא נחסמת בגלל אותה רכישה" לא נבדק אחרי סיום | low | patch | בדיקה עם מוצמד היכרות בלי לקוחה ← משימה ← `bind_purchase` |
| 7 | blind | שורת הערה ארוכה ב-`booking-panel.tsx` | low | patch | עטיפה |

נדחו: ניקוי `cron.job_run_details` והתראה על משימה שנכשלה (כבר ב-5.10: ‏`job_cleanup` ופריט "לטיפול"); ‏audit לכל הרשמה (low: ההחלטה ב-spec היא שורה למפגש, וה-`use` ביומן התנועות מתעד כל הרשמה); עמוד שתלוי בהרצת המשימה (לפי ההחלטה, רק `completed`); ‏lock_timeout (low, עסקאות ה-RPC קצרות); הקצאה משתי זכויות (low, `plan_funding` מחזירה מקור אחד); ‏`occupied_places` איטית יותר (low, מעט שורות, ו-`is_real_booking` היא ההגדרה היחידה); ‏`EVENT_COMPLETED` ב-`lib/errors.ts` (false: קוד שחוזר מ-RPC, הנוסח בהחלטת המשתמשת); סטטוס done בעץ לפני הסיום (false: מסמנים done ב-PR, לפי הבקשה); חסר מוצר בתצוגת "השתתפת" (לפי ההחלטה); ‏`preview_book_sessions` מחזיר `ALREADY_BOOKED` למפגש שהסתיים (low, הבחירה המרובה מציגה רק מפגשים עתידיים); המסכים בלי בדיקת רינדור אחרי סיום (false: נגזרים מ-`get_my_entitlements`, ובדיקת הטלפון לפי review-accepted).

## Design Notes

**השהיית פרויקט חינמי:** לפי התיעוד של Supabase (Project Pausing), פרויקט Free מושהה כשאין "מספיק פעילות משתמשים במסד" במשך 7 ימים, והדרך היחידה שמובטחת למנוע את זה היא Pro. משימה פנימית של pg_cron היא לא בקשה של משתמש, ולכן **אי אפשר להסתמך עליה**. ההחלטה נשארת ל-5.10 ולפני ההשקה.

**בדיקות:** המשימה מעבדת כל מפגש שהסתיים במסד הפיתוח. בבדיקה היא רצה בתוך `inRollback`, ולכן שינוי במפגשים אחרים מתבטל. הבדיקות בודקות רק את המפגשים שהן יצרו. ה-cron עצמו ירוץ גם על מסד הפיתוח, וזה רצוי.

## Verification

**Commands:**
- `npm run test:db` -- ירוק, כולל `session-completion`, ‏`my-entitlements`, ‏`self-booking`, ‏`multi-booking`, ‏`admin-booking`, ‏`cancel-booking`, ‏`pinned-approval`, ‏`bind-purchase`, ‏`admin-home`, ‏`grants`.
- `npm run lint`, ‏`npx tsc --noEmit`, ‏`npm test`, ‏`npm run build` -- עוברים.

**Manual checks:**
- מפגש בדוי שהוזז לעבר עם לקוחה בדויה: אחרי הרצת המשימה, הבית והפירוט מראים את הכניסה כמנוצלת והיתרה נכונה, ועמוד המפגש מציג "המפגש הסתיים" ו"השתתפת במפגש".
