---
title: '3.11 Pinned product approval and placement — אישור מוצר מוצמד ושריון המקום'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '70c311919a3ce2f2785457f90c0c0c34cd548ab4'
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

**Problem:** בודדת, היכרות וזוגית (רוב המוצרים) מוצמדים למפגש, אבל אישור התשלום שלהם נחסם ב-`PINNED_NOT_AVAILABLE` (CAP-37, ‏memlog של ה-SPEC 2026-09-26, גובר על מקור §2 "אין בחירת תאריך").

**Approach:** שדה חובה "מפגש" במסך אישור התשלום, ו-`private.place_pinned_booking` בתוך ליבת האישור שרושמת דרך `book_core` באותה עסקה. ללקוחה חדשה ההרשמה נשמרת עם `customer_id` ריק ועוברת אליה ב-`bind_purchase`, ו-`/me` מציג לה את המפגש עם ההודעה והכפתור של המוצר.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-6 (‏`profiles` ← `events` ← `bookings` ← `entitlements`), ‏AD-7, ‏AD-10, ‏AD-18, ‏AD-19, ‏AD-23. עברית רק ב-`lib/errors.ts` וב-`lib/copy/*`, מה-Design Notes. בקבצים משותפים רק מוסיפים.

**Decisions:**
- **מקומות וכניסות (deferred מ-3.2):** הרשמה גורעת כניסה אחת מהזכות, ו-`party_size` קובע רק מקומות. ‏`plan_funding` דורש `available ≥ 1` ומחזיר `units: 1` (מקור §2: זוגי = "הרשמה אחת עבור שני מבוגרים"). הגיליון כבר מציג את `units` מה-preview.
- **`private.has_participated(customer)`:** ‏(2.9 נדחה) הרשמה שלה `completed`, או `confirmed` למפגש ש-`ends_at ≤ now()` (אי-הגעה = השתתפות, מקור §2). ביטול לא נחשב.
- **היכרות:** אינדקס ייחודי חלקי על `entitlements (customer_id) where kind = 'intro' and status = 'active' and customer_id is not null`. הבדיקה המפורשת קודמת לו, ולכן אף 23505 לא יוצא.
- **היכרות רק ללקוחה בלי הרשמות (המשתמשת, 2026-10-05, memlog):** מוצר היכרות (`intro` או `intro_only`) נחסם גם כשיש ללקוחה הרשמה `confirmed` או `completed` כלשהי, גם עתידית (חוץ מההרשמה של אותה רכישה). ביטול לפני המפגש לא נחשב. רק למפגש רגיל.
- **`private.plan_pinned_placement(customer, product, event)`** (AD-7, אחת ל-preview ולביצוע) → `{ok, code?}` לפי הסדר: מפגש `published` ו-`starts_at > now()` ← `EVENT_NOT_BOOKABLE`; סוג = `eligible_event_kind` והיום המקומי ב-`allowed_weekdays` ← `EVENT_NOT_FIT`; ‏`occupied_places + party_size ≤ capacity` ← `EVENT_FULL`. רק כשיש לקוחה: כבר רשומה ← `CUSTOMER_ALREADY_BOOKED`; ‏`intro_only` ו-(`has_participated` או היכרות פעילה) ← `INTRO_NOT_ELIGIBLE`. סגירת ההרשמה לא חלה על טל.
- **`plan_approve_payment`** (אותה חתימה): מוצר מוצמד בלי מפגש ← `PINNED_EVENT_REQUIRED`; ‏`expires_on` = התאריך המקומי של המפגש. ‏`PINNED_NOT_AVAILABLE` יוצא מה-SQL.
- **`place_pinned_booking`:** נועלת את המפגש, מריצה את התכנון; ב-`raise` זורקת את הקוד, ב-`park` לא רושמת ומשאירה תשלום וזכות. אחרת `book_core(customer, payment, event, party_size, [{entitlement, id, 1}], actor, actor_kind, 'approve_payment')`. המקור הוא הזכות של התשלום עצמו, בלי `plan_funding` (לקוחה חדשה עוד ריקה).
- **`admin_approve_payment` / `preview_admin_approve_payment`** (אותן חתימות): נעילת המפגש אחרי הפרופיל, ‏preview זורק את קוד התכנון. ‏`purchase_repeat` נשאר גם למוצמד (החלטת 2.5), ו-`booking_confirmed` נוסף מ-`book_core`.
- **`bind_purchase`:** גם `has_participated` או היכרות פעילה אחרת לזכות `intro` ← `BIND_CONFLICT` (טל רואה ברשימת הקישורים, `bind_conflict`).
- **`admin_list_bookable_events()`:** קריאה לאדמין. מפגשים `published` עם `starts_at > now()`: ‏`id`, ‏`starts_at`, ‏`kind`, יום מקומי, שם הקונספט, ‏`occupied` (מ-`occupied_places`), ‏`capacity`.
- **טופס אישור:** כל המוצרים הפעילים. למוצמד: בחירת "מפגש" (חובה, רשימת radio בשתי שורות, בלי שעה), מפגשים בסוג וביום של המוצר, "{תפוסים}/{מכסה}" כטקסט, מלא מוצג ולא ניתן לבחירה. ה-preview מציג את המפגש במקום התוקף.
- **`/me`:** זכות מוצמדת שההרשמה שלה `confirmed` והמפגש לא התחיל מוצגת כמפגש, עם ההודעה והכפתור של המוצר (← `/me/sessions/{event_id}`), בלי כרטיס היתרה.
- **אחרי בדיקת הטלפון (המשתמשת, 2026-10-05, memlog):** סוג המפגש תמיד לפי `default_kind` של הקונספט, בלי שדה סוג ביצירה ובעריכה. עמוד המפגש מציג את תיאור המפגש (אחרת של הקונספט) במקום "מגיעות עם התינוקות". ברכישה מוצמדת הלקוחה רואה "בראנץ׳ {קונספט}" במקום שם המוצר: ב-`/me` ובדף ההצטרפות (עם {יום DD.MM}). ללקוחה חדשה השם חובה. אזהרת כפילות רק כשהשם זהה (מול שם בתשלום או שם הלקוחה המשויכת) או לאותה לקוחה קיימת, ובמוצמד רק לאותו מפגש. תשלום בלי שם לא מעורר אזהרה (עדכון מאוחר יותר באותו יום).
- **`park`:** נבדק ב-db test בקריאה ישירה לליבה (`online`). הפריט "שולם בלי מקום" ב"לטיפול" נדחה ל-4.1 (אין `admin_get_attention_items`).

**Never:** שורת "ממתינה להצטרפות" ברשימת הנרשמות (3.4), הרשמת היכרות פעילה אחת והרשמה זוגית עצמית (3.5), ביטול (3.6), זיכויים (3.7), סליקה, ‏2.9, תווית רגיל/זוגי ללקוחה, מספר מקומות ללקוחה, מחיקת קוד קיים בקבצים משותפים.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| חדשה | בודדת, מפגש עם מקום | תשלום, זכות (`expires_on` = יום המפגש), הרשמה `customer_id` ריק, ‏`reserve` ‏-1, קישור; המקום נספר |
| קיימת | זוגי, מפגש זוגי 12/14 | הרשמה `party_size` 2, ‏`reserve` ‏-1, ‏14/14; ‏`purchase_repeat` ו-`booking_confirmed` |
| חסר / ימים | מוצמד בלי מפגש / כרטיסייה עם מפגש | `PINNED_EVENT_REQUIRED` / ‏`EVENT_NOT_ALLOWED`, כלום לא נוצר |
| לא מתאים | זוגי למפגש רגיל; טיוטה; התחיל | `EVENT_NOT_FIT`; ‏`EVENT_NOT_BOOKABLE`, כלום לא נוצר |
| מלא | זוגי עם מקום אחד | `EVENT_FULL`, כלום לא נוצר |
| retry | אותו מפתח | אותה תוצאה, הרשמה אחת |
| כבר רשומה | קיימת במפגש | `CUSTOMER_ALREADY_BOOKED` |
| היכרות | קיימת שהשתתפה / עם היכרות פעילה / עם הרשמה עתידית | `INTRO_NOT_ELIGIBLE` |
| הצטרפות | חדשה מצטרפת | ההרשמה, הזכות והתשלום שלה, ‏`booking_confirmed` אחד |
| conflict | הצטרפות של קיימת שרשומה למפגש / שהשתתפה (היכרות) | `BIND_CONFLICT`, כלום לא משויך, הקישור `conflict` |
| park | ליבה `online`, מפגש מלא | תשלום וזכות, בלי הרשמה |
| כרטיסייה | הרשמה עצמית | כניסה אחת, כמו קודם |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql` -- ‏`entitlements` (144), ‏`plan_approve_payment` (458, ‏`PINNED_NOT_AVAILABLE` 483), ‏`record_payment`, ‏`grant_from_payment` (569, ‏`pinned_event_id` נכתב `null` ב-595: לכתוב את המפגש), ‏`approve_payment_core` (626).
- `20261004075337_payer_label_review_fixes.sql:8` -- ‏`admin_approve_payment` העדכני (נעילות 77–101, הליבה 116). ‏`20261004072550_payer_label.sql:347` -- ‏preview העדכני.
- `20261004183409_bookings_and_self_booking.sql` -- ‏`occupied_places` (158), ‏`plan_funding` (204; ‏251, ‏261), ‏`notify_booking_confirmed` (297, מדלג על ריק), ‏`bind_purchase` (436). ‏`book_core` העדכני: ‏`20261004191220_bookings_review_fixes.sql:10`.
- `events` (`20261004143612_concepts_and_events.sql:61`): ‏`kind`, ‏`starts_at`, ‏`ends_at`, ‏`capacity_adults`, ‏`status`.
- `supabase/tests/` -- ‏`approve-payment.test.ts` (בדיקת `PINNED_NOT_AVAILABLE` משתנה), ‏`bind-purchase.test.ts`, ‏`self-booking.test.ts`, ‏`grants.test.ts` (`EXPECTED_GRANTS`), ‏`support/{db,money}.ts`, ‏`events-admin.test.ts` (seed מפגשים).
- `app/admin/(shell)/payments/new/{form-data.ts,actions.ts,payment-form.tsx,payment-form-host.tsx}` -- ‏`validity_mode = 'days'` ב-form-data, ‏`p_event_id: NONE` ב-actions; בדיקות ליד.
- `app/me/{page.tsx,purchase-items.ts}` + בדיקה -- ‏`untouched` מסתיר הודעה וכפתור; ‏`lib/time.ts` (`formatSessionDateTime`).
- `lib/errors.ts`, ‏`lib/copy/{admin,customer}.ts`, ‏`lib/rpc.ts`, ‏`lib/supabase/database.types.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_pinned_product_approval.sql` -- **סשן ראשי:** ‏`migration new`, ‏`apply_migration` (בלי drop), ‏`get_advisors`, ‏`generate_typescript_types`.
- [ ] `supabase/tests/pinned-approval.test.ts` (חדש), ‏`approve-payment`, ‏`bind-purchase`, ‏`self-booking`, ‏`grants` -- כל שורה במטריצה.
- [ ] `lib/errors.ts`, ‏`lib/copy/{admin,customer}.ts` -- מה-Design Notes.
- [ ] `app/admin/(shell)/payments/new/**`, ‏`app/me/{page.tsx,purchase-items.ts}` + בדיקות -- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- [ ] `deferred-work.md` -- "שולם בלי מקום" ל-4.1; "ממתינה להצטרפות" ל-3.4.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ואין שורות `test_%`.
- Given checkout בלי `.env*`, then lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון, when טל מאשרת בודדת ללקוחה חדשה למפגש והלקוחה מצטרפת, then ב-`/me` היא רואה את המפגש, את ההודעה ואת הכפתור, והכפתור מוביל לעמוד המפגש עם "את רשומה למפגש הזה".

## Implementation Notes

- העבודה ב-worktree ‏`.claude/worktrees/story-3-11` (branch ‏`story-3-11-pinned-approval` מ-main, ‏`node_modules` ו-`.env.local` כבר שם). קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261004212706_pinned_product_approval.sql` (ריק). כותבים אליו בלבד, בלי `drop` (פונקציה קיימת: ‏`create or replace` באותה חתימה). ‏`apply_migration` לא עובד אצל סוכן משנה: הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`. עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. בסוף מדווחים מה נשאר לסשן הראשי.

- הוחלו מה-MCP (בלי drop): `20261004212706_pinned_product_approval` ו-`20261004221450_pinned_approval_review_fixes` (כלל היכרות אחד, `private.intro_blocked`). הגופים במסד זהים לקבצים. ה-advisor: רק 0029 ו-`auth_leaked_password_protection`. הטיפוסים שנוצרו זהים לעדכון הידני (`admin_list_bookable_events`).
- `npm run test:db`: ‏455/455 אחרי תיקון `events-admin.test.ts`. הבדיקה הניחה שלקונספט "עם סבתוש" אין תיאור, אבל התיאור שנכתב במסד נשאר (החלטת המשתמשת, 2026-10-05), ולכן היא משווה עכשיו לתיאור הקונספט. ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (1028) ו-build עוברים. לא נשארו שורות בדיקה.
- החלטות המממש: ‏`plan_pinned_placement` מקבל `p_payment_id`, כדי שהזכות של אותה רכישה לא תיחשב "היכרות אחרת". הליבה מתכננת לפני כתיבת התשלום וגם אחרי הנעילה. ‏`INTRO_NOT_ELIGIBLE` נזרק גם ב-`park`. ‏`expires_on` = ‏`greatest(יום המפגש, תאריך הרכישה)`. ‏`event_id` ו-`booking_id` נוספים לתוצאת האישור רק למוצמד. מסך ההצלחה שומר את המפגש שנבחר, כי אחרי הרענון הוא יכול להיעלם מהבורר.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 4, low 4, false 2, maybe-false 0. patch 6, defer 3, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | כלל ההיכרות שונה בשלושה מקומות: השתתפות נבדקת רק ל-`intro_only`, ובענף מוצר הימים לא נבדקת בכלל | medium | ‏`plan_pinned_placement`, ‏`bind_purchase` וענפי הימים ב-core וב-preview (blind, edge) | patch: כלל אחד (`intro` או `intro_only`), שתי הבדיקות, מיגרציה חדשה |
| 2 | מסך ההצלחה ללקוחה קיימת מציג "1 כניסות · בתוקף עד" ולא את המפגש | medium | ‏`payment-form.tsx` ‏`successPurchase` (blind, edge, verification) | patch: אחרי אישור הנוסח |
| 3 | זכות מוצמדת בלי הרשמה חיה מוצגת ב-`/me` עם הודעה וכפתור להרשמה עצמית שלא אפשרית | low | ‏`untouched` אמת כש-reserved 0 (blind) | patch |
| 4 | בלי מפגש מתאים: התווית מצביעה על `<p>`, הפוקוס על ref ריק | low | ‏`payment-form.tsx` (blind) | patch |
| 5 | התפוסה בבורר לא מתרעננת אחרי `EVENT_FULL` ואחרי אישור | low | ‏`router.refresh` רק לשני קודים (edge) | patch |
| 6 | לא נבדקים: יום בשבוע ב-`EVENT_NOT_FIT` וב-`weekday` של הרשימה, ענף `completed`, היכרות במוצר ימים | medium | verification (pre-verified), blind | patch: בדיקות |
| 7 | ‏`has_participated` לא קורא השתתפות מיבוא או מתיקון של טל | maybe-false (medium) | העמודה עוד לא קיימת (2.9 נדחה) (blind) | defer: ‏2.9 |
| 8 | אחרי `BIND_CONFLICT` ההרשמה בלי לקוחה ממשיכה לתפוס מקום, וטל רואה רק קישור ב-conflict | medium | אין שחרור עד ביטול באדמין (blind, edge) | defer: ‏3.6 / ‏4.1 |
| 9 | ‏`INTRO_NOT_ELIGIBLE` במצב `park` לא נבדק | low | אין עדיין מסלול מקוון (verification) | defer: סבב הסליקה |

Reject (8): נעילת המפגש ב-`bind_purchase` (false: שני המסלולים נועלים קודם את הפרופיל, שהוא ה-mutex); ‏`booking_confirmed` אחרי שהמפגש התחיל (low, נדיר); שורת conflict בלי `join_complete` (המעבר ל-conflict נבדק ב-2.3); בדיקות רכיב למסכים (review-accepted, זרימה בדפדפן); ‏`toBookableEvents` לא בודק מספרים (low, פלט ה-RPC שלנו); המרת `eligible_event_kind` (false: check במסד); ‏`local_date` שלא נקרא וספירה לכל מפגש (low); ממצאי intent תיאוריים.

## Design Notes

**נוסחים חדשים לאישור.** מועד ב-`formatSessionDateTime`, כותרת "בראנץ׳ {קונספט}".

| מקום | נוסח |
|---|---|
| טופס, שדה (בלי שעה, המשתמשת 2026-10-05) | מפגש · בחרי מפגש · אופציה בשתי שורות: בראנץ׳ {קונספט} / {יום DD.MM} · {תפוסים}/{מכסה} (מלא: "· מלא", לא ניתן לבחירה) · ריק: אין מפגש פתוח שמתאים למוצר הזה |
| preview | מפגש: בראנץ׳ {קונספט} · {יום DD.MM} |
| `EVENT_NOT_FIT` | המפגש הזה לא מתאים למוצר. בחרי מפגש אחר |
| `CUSTOMER_ALREADY_BOOKED` | הלקוחה כבר רשומה למפגש הזה. בחרי מפגש אחר |
| `INTRO_NOT_ELIGIBLE` | בראנץ׳ היכרות מיועד רק ללקוחה חדשה (אושר 2026-10-05) |
| `EVENT_FULL`, ‏`EVENT_NOT_BOOKABLE` | הנוסחים הקיימים |
| הצלחה (קיימת, ומתחת לקישור לחדשה; ביקורת, אושר 2026-10-05) | {מוצר} · המקום נשמר: (שורה חדשה) בראנץ׳ {קונספט} · {יום DD.MM} (בלי שעה, 2026-10-05) |
| שם ללקוחה חדשה (חובה, אושר 2026-10-05) | שם לזיהוי * · רמז: רק את רואה אותו · ריק: צריך למלא את השדה הזה |
| `/me` | המקום שלך שמור · בראנץ׳ {קונספט} · {יום DD.MM HH:MM}, ואחריהם ההודעה והכפתור של המוצר |

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
