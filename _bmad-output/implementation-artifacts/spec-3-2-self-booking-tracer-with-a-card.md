---
title: '3.2 Self-booking tracer with a card — הרשמה עצמית בכרטיסייה'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: 'adb374cebe7563239e8ab0316b75c47279470e74'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** לקוחה עם כרטיסייה לא יכולה להירשם למפגש. אין `bookings`, אין ספירת מקומות ואין מסך מפגשים באזור האישי (מקור §5 › הרשמה למפגש, §2 › כרטיסייה, CAP-13, CAP-9).

**Approach:** מיגרציה עם `bookings`, ‏`booking_allocations`, ספירת מקומות אחת, בחירת מימון אחת והרשמה אטומית בנעילות של AD-6. מסכי `/me/sessions`, ‏`/me/sessions/[id]` וגיליון הרשמה לתאריך אחד, עם `session-card` ו-`concept-header` משותפים.

## Boundaries & Constraints

**Always:** AD-5, AD-6, AD-14, AD-16, AD-18, AD-19, AD-20 (`policy_snapshot`), AD-23 (`customer_id` ריק נספר במכסה). עברית רק ב-`lib/copy/customer.ts`, ‏`lib/copy/admin.ts` ו-`lib/errors.ts`, מה-Design Notes. בקבצים משותפים רק מוסיפים.

**Decisions:**
- **`bookings`:** ‏`customer_id` (ריק מותר), ‏`payment_id` (ריק), ‏`event_id`, ‏`party_size` (1|2), ‏`status` (confirmed|cancelled|completed), ‏`booked_by`, ‏`confirmed_at`, ‏`cancelled_at`, ‏`guest_details`, ‏`policy_snapshot` (`cancel_window_hours`, ‏`reminder_lead_hours` מההגדרות ברגע ההרשמה). אינדקס ייחודי חלקי: הרשמה `confirmed` אחת ללקוחה במפגש, `where customer_id is not null`. ‏FK מ-`entitlement_movements.booking_id` ומ-`entitlements.pinned_event_id`. select: ללקוחה את שלה, לאדמין הכול.
- **`booking_allocations`:** ‏`booking_id`, ‏`entitlement_id`, ‏`credit_id` (בלי FK עד 3.7), ‏`units`, ‏`check (num_nonnulls(entitlement_id, credit_id) = 1)`.
- **`private.occupied_places(event_id)`:** המקום היחיד שסוכם `party_size`. ‏`private.is_real_booking(status)`.
- **`private.plan_funding(customer, event, party_size, mode)`:** בהדגמה רק ענף הזכות (אין זיכויים עד 3.7). זכות `active`, ‏`eligible_event_kind` = סוג המפגש, היום המקומי ב-`allowed_weekdays` (ריק = כל יום), ‏`valid_from ≤` תאריך המפגש `≤ expires_on`, ‏`available ≥ party_size` מ-`entitlement_balances`; לפי `expires_on` ואז `id`. ב-`self` לא נבחרת זכות מוצמדת (`validity_mode = session`). אין התאמה ויש זכות שמתאימה רק בלי התאריך ← `ENTITLEMENT_EXPIRED_ON_DATE`, אחרת `NO_MATCHING_ENTITLEMENT`. מחזירה `{ok, code?, sources}`.
- **`book_session(p_event_id, p_idempotency_key)`:** ‏`current_customer_id()` (ריק ← `NOT_AUTHORIZED`), ‏`idempotent_begin`, נעילת `profiles` ואז `events`, בדיקות לפי הסדר: פורסם ← `EVENT_NOT_BOOKABLE`; ‏`now() < registration_closes_at` ← `REGISTRATION_CLOSED`; אין הרשמה פעילה ← `ALREADY_BOOKED`; מקום ← `EVENT_FULL`; ‏`plan_funding('self')`, נעילת הזכות ובדיקה חוזרת. ‏`private.book_core`: הרשמה, הקצאה, ‏`reserve` שלילי, יומן `book_session`, ‏`booking_confirmed` (מפתח `booking_id`, ‏`target_path` ‏`/me/sessions/{event_id}`). ‏`party_size` = 2 למפגש זוגי, אחרת 1. ‏→ `{booking_id}`.
- **`get_event_availability(p_event_ids uuid[])`:** ל-`authenticated` בלבד. לכל מפגש `published`: ‏`label` (`available` | ‏`last_places` כשהפנויים `≤ last_places_threshold` | ‏`full` כשהפנויים פחות מגודל ההרשמה) ו-`registration_open`. אף פעם לא מספר.
- **`preview_book_session(p_event_id)`:** קריאה ל-`authenticated` בלבד, אותן בדיקות ו-`plan_funding('self')` בלי נעילות ובלי כתיבה. ‏→ `{ok, code?, product_name, units, available_after, expires_on, cancel_deadline, booked}`.
- **`bind_purchase`:** ממלא `bookings.customer_id` לפי `payment_id`; לקוחה שכבר רשומה לאותו מפגש ← `BIND_CONFLICT` בלי שיוך. ‏`bookings` נכנס ל-`BOUND` ב-`bind-purchase.test.ts`.
- **`admin_update_event` (deferred, 3.1 #7):** שינוי `date`, ‏`start_time`, ‏`end_time` או `kind` כשיש הרשמה `confirmed` ← `EVENT_HAS_BOOKINGS`. ‏3.8 מחליף בתצוגת השפעה.
- **עיצוב קונספט:** ‏`lib/concepts/themes.ts` (6 ערכות ו-6 ניירות מ-DESIGN.md), גופני הקונספט ב-`next/font/google` רק ב-`components/shared/{session-card,concept-header}.tsx`. בלי תמונה (5.4).
- **מסכים:** ‏`/me/sessions`: מפגשים שפורסמו ולא התחילו לפי מועד, ‏`session-card` עם `status-chip` (או "נרשמת"). ‏`/me/sessions/[id]`: ‏`concept-header`, תיאור, "מגיעות עם התינוקות" (זוגי: "מגיעים"), מחיר תצוגה רק אם נקבע, ופעולה: "להרשמה" ← `bottom-sheet`, או `inline-notice` לפי הקוד. "צרי קשר" (וואטסאפ מ-`lib/content/whatsapp.ts`) רק ב-`REGISTRATION_CLOSED` וב-`NO_MATCHING_ENTITLEMENT`; ב-`EVENT_FULL` וב-`ENTITLEMENT_EXPIRED_ON_DATE` קישור "לכל המפגשים". אחרי הצלחה: שיא, ופוקוס עליו.
- **העמודים הציבוריים (המשתמשת, 2026-10-04):** סיפור מסכים נפרד אחרי 3.2 (deferred-work), עם הרכיבים המשותפים של 3.2.
- **`{kind}` ב-`booking_confirmed` (המשתמשת, 2026-10-04):** ‏"בראנץ׳ {קונספט}", לפי ההחלטה המשותפת 2026-09-26 (בלי תווית רגיל/זוגי ללקוחה) מול מקור §8.
- **נוסחים:** טבלת ה-Design Notes אושרה (המשתמשת, 2026-10-04). **אורך:** נשאר כמו שהוא (המשתמשת).
- **מוצמד (המשתמשת, 2026-10-04):** ‏3.11 נכנס להדגמה כסיפור נפרד מיד אחרי 3.2. כאן רק ההכנה: ‏`bookings.payment_id`, הרשמה עם `customer_id` ריק נספרת, ‏`book_core` משותף, השיוך ב-`bind_purchase`, ו-`/me/sessions` מציג כל הרשמה `confirmed` שלה כ"נרשמת".
- **מקביליות (unknown):** שני לקוחות מ-`getPool().connect()` כמו ב-`idempotency-concurrency.test.ts`: א׳ נרשמת בעסקה פתוחה על המקום האחרון, ב׳ ממתינה לנעילה (נבדק ב-`pg_stat_activity`), א׳ עושה commit, ב׳ מקבלת `EVENT_FULL`. ‏commit אמיתי ומחיקה ב-`onCleanup`.

**Never:** בחירה מרובה וסגירה לפי זמן בבדיקת שעון קיץ (3.3), ביטול ו-`/me/bookings` (3.6), זיכויים (3.7), מוצמד (3.11), רשימת המתנה (E5), ‏`event_products`, תמונות (5.4), תווית רגיל/זוגי ללקוחה, מספר מקומות ללקוחה, מונה מקומות שמור, כתיבה מהדפדפן ל-`bookings`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| הצלחה | כרטיסייה 4, מפגש רגיל ביום שני בתוקף | הרשמה, ‏`reserve` ‏-1, יתרה 3 זמינות ו-1 משוריינת, יומן, התראה אחת |
| מקום אחרון במקביל | שתי לקוחות, מקום אחד | אחת `confirmed`, השנייה `EVENT_FULL`, כניסה שלה לא נגרעה |
| מחוץ לתוקף | מפגש אחרי `expires_on` | `ENTITLEMENT_EXPIRED_ON_DATE`, כלום לא נשמר |
| יום לא מתאים / זוגי | מפגש ביום ראשון / מפגש זוגי | `NO_MATCHING_ENTITLEMENT` |
| כפולה | הרשמה שנייה לאותו מפגש, מפתח אחר | `ALREADY_BOOKED` |
| חוזר | אותו מפתח | אותה תוצאה, הרשמה ותנועה אחת |
| סגור / טיוטה | אחרי `registration_closes_at` / ‏`draft` | `REGISTRATION_CLOSED` / ‏`EVENT_NOT_BOOKABLE` |
| תוויות | פנויים 5 / 4 / 0; זוגי עם 1 | `available` / ‏`last_places` / ‏`full`; ‏`full` |
| anon | `get_event_availability` | 42501 |
| ספירה אחת | `pg_proc.prosrc` ו-views | סכימת `party_size` רק ב-`occupied_places` |
| מפגש עם נרשמות | `admin_update_event` שעה / מכסה | `EVENT_HAS_BOOKINGS` / מצליח |
| שיוך | רכישה עם הרשמה ש-`customer_id` ריק | ההרשמה עוברת ללקוחה; כבר רשומה ← `BIND_CONFLICT` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004143612_concepts_and_events.sql` -- ‏`events` (61), triggers, RLS (167), ‏`apply_event_changes` (207; מועד 249–277), ‏`admin_update_event` (597; נעילה 633, מפתחות 646). דפוס RPC: ‏615–664.
- `20261001162630_create_money_schema.sql` -- ‏`entitlements` (144; ‏`pinned_event_id` בלי FK, 141), ‏`entitlement_movements` (187; סימן ו-`booking_id` חובה ל-reserve), ‏`business_settings` (245: ‏`cancel_window_hours`, ‏`reminder_lead_hours`, ‏`last_places_threshold`), ‏`grant_from_payment` (569).
- `20261003141504_*.sql` -- ‏`entitlement_balances` (68; ‏`available`, ‏`reserved`), ‏`bind_purchase` (109–182).
- `20261001184225_create_notification_core.sql` -- ‏`enqueue_notification` (223), תבנית `booking_confirmed` `'{date} · {time} · {kind}'` (58).
- `20260930191525_create_rpc_contract.sql` -- ‏`idempotent_begin/finish`; ‏`private.audit`: ‏`20260930193304_*.sql:69`; ‏`cancel_deadline`, ‏`local_day_end`: ‏`20260930171231_*.sql`.
- `supabase/tests/support/{db,money}.ts` -- ‏`inRollback`, ‏`asAuthenticated`, ‏`getPool` (max 2), ‏`seedMoney`, ‏`approve`. ‏`idempotency-concurrency.test.ts:30–60` -- דפוס שני חיבורים. ‏`events-admin.test.ts:33–131` -- seed מפגשים. ‏`bind-purchase.test.ts:16–100`, ‏`grants.test.ts` (`EXPECTED_GRANTS`).
- `lib/rpc.ts`, ‏`lib/errors.ts` (קוד חדש ל-`ERROR_MESSAGES`), ‏`lib/time.ts`, ‏`lib/money.ts`, ‏`lib/content/whatsapp.ts`.
- `app/me/{layout,page}.tsx`, ‏`app/me/sessions/page.tsx` (placeholder), ‏`components/customer/balance-card.tsx`, ‏`components/shared/{inline-notice,page-heading}.tsx`, ‏`components/ui/{drawer,sheet}.tsx` (לא עורכים), ‏`components/public/menu-sheet.tsx` (דפוס sheet ופוקוס), ‏`app/admin/(shell)/sessions/session-status-chip.tsx` (דפוס chip, לא משנים).
- `lib/copy/customer.ts`, ‏`lib/copy/admin.ts`, ‏`app/layout.tsx` (גופנים קיימים).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_bookings_and_self_booking.sql` -- **סשן ראשי:** ‏`git pull`, branch מ-main, ‏`migration new`, ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`.
- [ ] `supabase/tests/{self-booking,booking-concurrency}.test.ts`, ‏`bind-purchase.test.ts`, ‏`events-admin.test.ts`, ‏`grants.test.ts` -- כל שורה במטריצה.
- [ ] `lib/errors.ts`, ‏`lib/copy/{customer,admin}.ts` -- הקודים והנוסחים מה-Design Notes.
- [ ] `lib/concepts/themes.ts` + בדיקה, ‏`components/shared/{session-card,concept-header,status-chip}.tsx`, ‏`app/me/sessions/**` (רשימה, ‏`[id]`, גיליון, ‏`actions.ts`) -- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ואין שורות `test_%`.
- Given checkout בלי `.env*`, then lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון ולקוחה בדויה עם כרטיסייה, when נרשמת למפגש, then רואה את השיא, וב-`/me` ‏3 זמינות ו-1 משוריינת, בלי תווית רגיל/זוגי ובלי מספר מקומות.

## Implementation Notes

- העבודה ב-worktree ‏`.claude/worktrees/story-3-2` (branch ‏`story-3-2-self-booking` מ-origin/main). קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261004183409_bookings_and_self_booking.sql` (ריק). כותבים אליו בלבד, בלי `drop`. ‏`apply_migration` לא עובד אצל סוכן משנה: הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`. עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. בסוף מדווחים מה נשאר לסשן הראשי.

- הוחלו מה-MCP (בלי drop): `20261004183409_bookings_and_self_booking` ו-`20261004191220_bookings_review_fixes` (תיקוני הביקורת). ה-advisor: רק 0029 ו-`auth_leaked_password_protection`. הטיפוסים שנוצרו זהים לעדכון הידני.
- `npm run test:db`: ‏431 עוברות אחרי תיקון מיון בבדיקה (grant ו-reserve באותה עסקה). ‏`approve-payment.test.ts` עודכן: ל-`entitlement_movements.booking_id` יש FK, ולכן הבדיקה יוצרת הרשמות אמיתיות. lint, ‏format:check, ‏typecheck, ‏`npm test` (918) ו-build עוברים. לא נשארו שורות בדיקה.
- החלטות המממש: גוף התבנית `booking_confirmed` הוא `'{date} · {time} · בראנץ׳ {concept}'` (העברית נשארת בטבלת התבניות, AD-5), והתוצאה ללקוחה זהה להחלטה. ‏`bind_purchase` שולח `booking_confirmed` להרשמה שמשויכת. ‏`private.can_self_cancel` נוסף (AD-20). ‏`booked_by` שומר את סוג המבצעת. מפגש שההרשמה אליו נסגרה מוצג בלי chip זמינות.
- נוסחים חדשים שלא היו בטבלה, לאישור המשתמשת: `CONCURRENT_CHANGE` "משהו השתנה בינתיים. כדאי לרענן את הדף ולנסות שוב"; ‏`CAPACITY_BELOW_BOOKED` (אדמין) "המכסה נמוכה ממספר המקומות שכבר תפוסים. אפשר להוריד אותה רק עד מספר התפוסים".

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 4, low 9, false 1, maybe-false 1. patch 7, defer 4, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | ברשימה ובכותרת "יש מקום" למפגש שההרשמה העצמית אליו נסגרה | medium | ‏`sessionStatus` מתעלם מ-`registrationOpen` (blind, edge, intent) | patch: בלי chip כשסגור |
| 2 | אפשר להוריד מכסה מתחת לתפוסים, חריגה שקטה (מקור §5) | medium | ‏`admin_update_event` בודק רק `capacity > 0` (blind, edge) | patch: `CAPACITY_BELOW_BOOKED` |
| 3 | חריגה ב-action משאירה את הגיליון busy ולא ניתן לסגור | medium | אין try/finally ב-`confirm` (verification, edge) | patch |
| 4 | אחרי כשל הדף לא מתרענן, ו-`CONCURRENT_CHANGE` מבקש לרענן | low | רק `setError` (blind) | patch: ‏`router.refresh()` ומפתח חדש |
| 5 | ‏`book_core` עם מקור בלי `units` או `id` נופל ב-23502 ולא ב-`INVALID_INPUT` | low | ‏`jsonb_typeof(null) <> 'number'` הוא null (verification, edge) | patch |
| 6 | ל-`bookSessionAction` אין בדיקה | low | לכל action אחר יש (verification) | patch |
| 7 | כללי המימון לא נבדקים: כרטיסייה זוגית, מוצמד ב-self, סדר `expires_on`, מועד ביטול מה-snapshot | medium | מחיקת התנאים לא מפילה בדיקה (verification, blind) | patch: בדיקות |
| 8 | זוגי: ‏`plan_funding` דורש `available ≥ party_size` ושורייני `units = party_size`, אבל מוצר זוגי הוא כניסה אחת לשני מבוגרים; "כניסה אחת" קבוע בגיליון | medium | מקור §2; ‏seed זוגי `units 1, party_size 2`. לא מגיע ב-self (זוגי מוצמד) (intent, edge, blind) | defer: ‏3.11 |
| 9 | ‏preview מסתיר את ההרשמה שלה במפגש שבוטל או הסתיים | maybe-false (medium) | אין ביטול מפגש או סיום עד 3.8 ו-3.12 (blind, edge) | defer: ‏3.8 |
| 10 | אחרי מועד הביטול העצמי אין הכוונה בעמוד המפגש | low | מסך הביטול ב-3.6 (blind) | defer: ‏3.6 |
| 11 | אין בדיקת רכיב ל-`BookingPanel` (מפתח, busy) | low | verification ניתב ל-defer | defer: ‏3.6 |

Reject (8): ‏`ENTITLEMENT_EXPIRED_ON_DATE` לזכות שעוד לא התחילה (`valid_from` = תאריך הרכישה, מפגשים עתידיים בלבד); ‏`policy_snapshot` לא שלם (נכתב רק מ-`book_core` מערכים שלמים); ‏`sessionsSoon` (נשמר בכוונה, כלל הקבצים המשותפים); כותרת דף כללית (low, דורשת שאילתה); ‏cast לתוצאת ה-RPC (חוזה מוקלד); סכום `units` מול `party_size` ומזהה מקור פגום לקוראים עתידיים (3.11); שאילתות העמודים בלי בדיקה (review-accepted, זרימה בדפדפן); ממצאי intent תיאוריים.

## Design Notes

**נוסחים חדשים לאישור.** כותרת: "בראנץ׳ {קונספט}". מועד ב-`formatSessionDateTime`.

| מקום | נוסח |
|---|---|
| רשימה | מפגשים · יש מקום · מקומות אחרונים · מלא · נרשמת · ריק: המפגשים הבאים עוד נרקחים |
| עמוד מפגש | מגיעות עם התינוקות / מגיעים עם התינוקות · להרשמה · את רשומה למפגש הזה. אפשר לבטל בעצמך עד {יום DD.MM HH:MM} |
| גיליון | מה ינוצל: כניסה אחת מ{שם המוצר} · יישארו: {n} כניסות / כניסה אחת / אין כניסות · בתוקף עד {יום DD.MM} · אפשר לבטל בעצמך עד {יום DD.MM HH:MM} · לשמור לי את המקום |
| שיא | המקום שלך סביב השולחן שמור · ליתרה שלי |
| `ENTITLEMENT_EXPIRED_ON_DATE` | הכרטיסייה אינה בתוקף ביום המפגש. אפשר לבחור מפגש מוקדם יותר. |
| `NO_MATCHING_ENTITLEMENT` | אין לך כרגע כניסה שמתאימה למפגש הזה. ניתן לרכוש כניסה מתאימה |
| `REGISTRATION_CLOSED` | ההרשמה העצמית למפגש הזה נסגרה. צרי קשר לבדיקת מקום פנוי. |
| `EVENT_FULL` | הבראנץ׳ מלא. ניתן לבחור תאריך אחר |
| קישור חלופי | לכל המפגשים |
| `ALREADY_BOOKED` | את כבר רשומה למפגש הזה |
| `EVENT_NOT_BOOKABLE` | אי אפשר להירשם למפגש הזה |
| `EVENT_HAS_BOOKINGS` (אדמין) | יש נרשמות למפגש, ולכן אי אפשר עדיין לשנות מועד או סוג. אפשר לשנות מכסה, תיאור וסגירה |
| פעולה חלופית | צרי קשר (בלי "כתבי לטל" או "דברי עם טל" בשום נוסח ללקוחה) |
| התראה `booking_confirmed` | `{date}` = ‏DD.MM, ‏`{time}` = ‏HH:MM, ‏`{kind}` = ‏"בראנץ׳ {קונספט}" |

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
