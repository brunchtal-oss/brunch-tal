---
review: adversary
target: ../ARCHITECTURE-SPINE.md
spine_updated: '2026-09-29'
date: '2026-09-29'
method: 'זוגות של יחידות (epics או סיפורים שנבנים בסשנים נפרדים), שכל אחת מקיימת כל AD ככתבו, ובכל זאת נבנות באופן לא תואם. דגש על שינוי 2026-09-29: private.approve_payment_core, ‏admin_approve_payment, ‏payments.source/recorded_by, ‏payment_methods, והפריט הדחוי של סבב הסליקה.'
verdict: 'ה-spine מוכן לבנייה של E1, אבל לא ל-E2 ול-E3 בחלקי התשלום והשיוך: חור קריטי אחד וחורים גבוהים בליבת האישור מחייבים תיקון AD-10, ‏AD-6 ו-AD-23 לפני המיגרציה הראשונה של payments.'
---

# סקירה עוינת, סבב 2: Architecture Spine אחרי 2026-09-29

## פסק דין

התפר החדש (ליבת אישור אחת, `source`, ‏`payment_methods`) נכון בכיוון, אבל הוא מוגדר כ**שם של פונקציה** ולא כ**חוזה**. ה-spine קובע מי קורא לליבה, אבל לא מה היא מקבלת, מה היא לא בודקת בעצמה, מה קורה כשחלק ממנה נכשל, ואיך היא מחזירה תוצאה למי שאינו הדפדפן של טל. בנאי של E2 שיבנה את הליבה בדיוק לפי AD-10 יבנה ליבה שמתאימה לאישור ידני בלבד, וסבב הסליקה יצטרך לפרק אותה. בנוסף, השיוך של רכישה בלי לקוחה (AD-23) מעביר רק שלוש ישויות, בזמן שה-spine מאפשר ליצור עוד ישויות כספיות על אותה רכישה לפני השיוך.

| חומרה | מספר |
| --- | --- |
| קריטי | 1 |
| גבוה | 8 |
| בינוני | 7 |
| נמוך | 3 |

| # | חומרה | נושא | ADs |
| --- | --- | --- | --- |
| C1 | קריטי | זיכוי, בקשת החזר והתראות שנוצרים על רכישה שעוד לא שויכה, ולא עוברים בשיוך | AD-10, AD-20, AD-23, AD-12 |
| H1 | גבוה | הליבה אטומית "הכול או כלום", וסבב הסליקה דורש "אסור לאבד תשלום" | AD-1, AD-10, Deferred |
| H2 | גבוה | idempotency של תשלום מקוון: מפתח uuid, ניקוי אחרי 7 ימים, שני מנגנונים | AD-5, AD-11, Deferred |
| H3 | גבוה | הטוקן הגולמי נוצר בתוך הליבה ומוחזר פעם אחת, למי שקרא לה | AD-10, AD-5, Deferred |
| H4 | גבוה | זהות המבצעת והרשאה נגזרות בתוך הליבה, ומצב `admin` של הרשמה עוקף כללים | AD-5, AD-10, AD-18, AD-19 |
| H5 | גבוה | ספירת מקומות כתובה inline בכל מקום, ו"מקום שמור בזמן תשלום" יפספס אותה | AD-6, AD-14, AD-23, Deferred |
| H6 | גבוה | `payment_method_id` חובה, ותשלום מקוון בלי אמצעי מהרשימה | AD-10, Conventions |
| H7 | גבוה | הליבה נבנית ב-E2 בלי `p_event_id`, ומוצר מוצמד נוצר כבר ב-E2 | AD-10, AD-5, AD-18, build-sequence |
| H8 | גבוה | השיוך נתקל באינווריאנטים שהליבה לא יכלה לבדוק כשהלקוחה ריקה | AD-6, AD-10, AD-23 |
| M1 | בינוני | `hidden` מול `archived_at`, ו"עובר לארכיון כשהשתמשו בו" בשתי קריאות | AD-10, AD-16 (דפוס הקונספטים) |
| M2 | בינוני | "לפחות אמצעי גלוי אחד" בלי נעילה | AD-6, AD-10 |
| M3 | בינוני | שינוי שם של אמצעי ששימש משנה את ההיסטוריה | AD-15, AD-10 |
| M4 | בינוני | `payments.status = voided` בלי בעלים, ורכישה יתומה אחרי ביטול קישור | AD-10, AD-22, Conventions |
| M5 | בינוני | "מה ייווצר" ותוקף לפני האישור: אין `plan_approve_payment` | AD-7, AD-8, AD-9 |
| M6 | בינוני | סדר רכישת הנעילות בתוך הליבה (לקוחה קיימת + מוצמד) | AD-6 |
| M7 | בינוני | לקוחה קיימת (CAP-6): כותב שני ל-payments והתראה במקום אחר | AD-10, AD-12 |
| L1 | נמוך | סידור אמצעי תשלום "למעלה/למטה" לא אידמפוטנטי | AD-5 |
| L2 | נמוך | `recorded_by` בנוסח חד-כיווני, וברירת מחדל ל-`source` | AD-10 |
| L3 | נמוך | `paid_on` מקוון, תקרת החזר לתשלום, ורשימת הפטורים מ-`SITE_LOCKED` | AD-8, AD-20, AD-22 |

כל כלל מתוקן כתוב באנגלית, מוכן להדבקה כתוספת ל-AD.

---

## קריטי

### C1. ישויות כספיות שנוצרות לפני השיוך לא עוברות ללקוחה

**הזוג:** E2-join (בונה `join_complete`/`claim_join` שמשייכים "את התשלום, הזכות **וההרשמה**", מילה במילה לפי AD-10 ו-AD-23) מול E3-cancel (בונה `admin_cancel_booking`, ‏`admin_cancel_event` ו-`private.cancel_core` לפי AD-20 ו-AD-23, ש"ביטול שלה עובר את אותו `admin_cancel_booking`").

**מה קורה:** טל מאשרת כניסה בודדת מוצמדת ללקוחה חדשה. יום אחר כך היא מבטלת את המפגש (או את ההרשמה בתוך החלון). ‏`cancel_core` מקיים את AD-20: ביטול מצד העסק יוצר `cancellation_credits` עם `choice_pending = true`, ו-`customer_id` נלקח מההרשמה, כלומר `null`. ‏`enqueue_notification` מדלג על `null` (AD-23), אז אין `event_cancelled`. הלקוחה מצטרפת אחרי יומיים. ‏`join_complete` משייך תשלום, זכות והרשמה (שבוטלה), ולא נוגע בזיכוי. התוצאה: הלקוחה שילמה, המפגש בוטל, ואין לה זיכוי, בחירה או הודעה. בזיכוי יש `customer_id = null`, והוא לא מופיע באזור האישי שלה. אותו דבר קורה עם `refund_requests` (אם ה-UI של טל מאפשר בחירה בשמה), עם `credit_options` שנגזרות מהזיכוי, ועם `admin_card_expiring`/`entitlement_changed` על זכות לא משויכת.

שתי היחידות צודקות לפי ה-spine. החור הוא ש-AD-10 מונה את הישויות שעוברות בשיוך, ו-AD-20 יוצר ישויות נוספות עם אותו `customer_id` ריק.

**Tightened rule (AD-23 + AD-10):**
> Binding a purchase to a customer happens only in `private.bind_purchase(p_payment_id, p_customer_id)`, called by `join_complete`, `claim_join` and `claim_complete`. It sets `customer_id` on every row whose ownership derives from that payment: `payments`, `entitlements` (by `payment_id`), `bookings` (by `payment_id`), `cancellation_credits` (by `source_entitlement_id` or `origin_booking_id`), `refund_requests` (by `payment_id`). After binding it replays the customer notifications that were skipped for `null` (`event_cancelled`, `event_changed`, `booking_cancelled`) from the bound rows, with their normal discriminators, so nothing is sent twice. `supabase/tests/bind-purchase.test.ts` lists every table with a `customer_id` column from `information_schema` and fails when a table is neither handled by `bind_purchase` nor in an explicit "never created before binding" allowlist. Any RPC that would create a customer-owned row for an unbound purchase and cannot derive it from the payment raises `PURCHASE_NOT_BOUND`.

---

## גבוה

### H1. הליבה אטומית, וסבב הסליקה צריך "תשלום לא הולך לאיבוד"

**הזוג:** E2/E3 (בונה `approve_payment_core` לפי AD-1: "בדיקה, נעילה, שינוי, יומן והתראה באותה עסקה". במוצר מוצמד היא קוראת ל-`book_core`, ואם המפגש מלא היא זורקת `EVENT_FULL`, והכול מתגלגל אחורה. לאישור ידני זה נכון: טל רואה שגיאה ובוחרת מפגש אחר) מול סבב הסליקה (online-payments.md: "תשלום בלי מקום... התשלום לא הולך לאיבוד ומופיע ב'לטיפול'").

**מה קורה:** הודעת ספק מאומתת מגיעה אחרי שהשמירה פגה והמקום נתפס. הליבה זורקת, העסקה מתגלגלת, שורת `payments` לא קיימת. לפי AD-5 "כשל לא נשמר", ולכן הספק ישלח שוב ויקבל שוב שגיאה, עד שיוותר. הכסף נגבה ואין עליו שום רשומה. כדי לתקן, סבב הסליקה חייב לפרק את הליבה, בדיוק מה שהתפר נועד למנוע.

**Tightened rule (AD-10):**
> `private.approve_payment_core` is composed of three private steps, each its own function: `private.record_payment(...) returns payment_id`, `private.grant_from_payment(payment_id)`, `private.place_pinned_booking(payment_id, event_id, mode)`. It takes `p_on_seat_failure text check in ('raise','park')`. `manual` always passes `raise` (whole transaction rolls back, current behaviour). `park` (reserved for `online`) commits the payment and the entitlement, skips the booking, and returns `{payment_id, seat: 'parked', code}`. A parked pinned payment is a stored state (`payments` row with a pinned product and no booking and no credit), and `admin_get_attention_items` derives "paid without seat" from it. v1 implements `park` with a test, even though only `raise` is called.

### H2. idempotency של תשלום מקוון

**הזוג:** E1/E2 (בונה `private.idempotency_results(actor_scope, rpc, key uuid, …)` ו-`job_cleanup` שמוחק אחרי 7 ימים, לפי AD-5 ו-AD-11) מול סבב הסליקה (לפי ה-Deferred: "מזהה העסקה כמפתח idempotency", ו-`provider_transaction_id` "ייחודי כשהוא קיים").

**מה קורה:**
1. מזהה עסקה של ספק הוא מחרוזת, לא uuid. העמודה `key uuid` והפרמטר `p_idempotency_key uuid` לא מקבלים אותו.
2. ספקים שולחים הודעות חוזרות, ומריצים התאמות (reconciliation) גם אחרי שבוע. אחרי 7 ימים השורה ב-`idempotency_results` נמחקה, והקריאה מריצה שוב את הליבה. היא נתקלת ב-unique של `provider_transaction_id` ומחזירה 23505 גולמי, לא את התוצאה הקודמת.
3. יש שני מקורות אמת לכפילות: `idempotency_results` ו-unique על העמודה. AD-5 אומר "אין עמודת idempotency_key באף טבלה אחרת", ובפועל `provider_transaction_id` היא עמודה כזאת.
4. ייחודיות על `provider_transaction_id` לבד מתנגשת אם מחליפים ספק ומזהים חוזרים.

**Tightened rule (AD-5 + AD-10):**
> For `source = 'online'` the only duplicate guard is the unique index `payments (provider, provider_transaction_id) where provider_transaction_id is not null`. The online wrapper takes `pg_advisory_xact_lock(hashtext(provider || ':' || txn))`, looks the payment up, and if found returns the stored outcome rebuilt from rows (not from `idempotency_results`). It does not call `private.idempotent_begin`. Therefore v1's `record_payment` must take `p_provider`, `p_provider_transaction_id` (both null for manual) and a check `(source = 'online') = (provider is not null and provider_transaction_id is not null)`. `idempotency_results.key` stays `uuid` and is only for UI-originated calls.

### H3. הטוקן הגולמי נוצר בתוך הליבה

**הזוג:** E2 (בונה את הליבה כך שהיא יוצרת טוקן `join` ומחזירה אותו גולמי פעם אחת, ו-`idempotent_finish` שומר את התוצאה בלעדיו, AD-10) מול סבב הסליקה (הלקוחה החדשה "מועברת לטופס ההצטרפות" אחרי תשלום).

**מה קורה:** בתשלום מקוון מי שקורא לליבה הוא ה-webhook, שרת לשרת. הדפדפן של הלקוחה חוזר בבקשה אחרת. הטוקן הגולמי הוחזר ל-webhook ואבד, ואסור לשמור אותו (AD-10). דף החזרה לא יכול לקבל אותו. כדי לתקן, סבב הסליקה חייב להוציא את הנפקת הטוקן מהליבה, או לשמור טוקן גולמי. שני הפתרונות שוברים את AD-10.

**Tightened rule (AD-10):**
> `approve_payment_core` never issues a token. It returns `payment_id`. The wrapper decides: `admin_approve_payment` calls `private.issue_token('join', payment_id)` in the same transaction and returns the raw token once. The online path will issue the join token later, in a separate `service_role` RPC called from the browser-return route and bound to the checkout that browser started. `activation_tokens.payment_id` stays the link; at most one non-revoked `join` token per payment (partial unique index).

### H4. זהות, הרשאה ומצב ההרשמה בתוך הליבה

**הזוג:** E2 (בונה את הליבה, ומעתיק את הדפוס של AD-5 "השורה הראשונה בודקת הרשאה", כלומר `if not private.is_admin() then raise NOT_AUTHORIZED`. `recorded_by := auth.uid()`. ‏`private.audit` גוזרת `actor_id`/`actor_kind` מ-`auth.uid()` ומ-`is_admin()`) מול E3 (בונה `book_core` עם `p_mode = 'admin'`, שמאפשר לטל להירשם אחרי סגירת ההרשמה) מול סבב הסליקה.

**מה קורה:** קריאה מ-`service_role` נכשלת על `is_admin()`. אם הבדיקה לא בליבה, `actor_kind` נכתב `null` או `customer`, ו-`audit_log` נכשל על NOT NULL. אם מצליחים לעקוף, ההרשמה של תשלום מקוון רצה במצב `admin` ומקבלת את החריגות של טל, כמו הרשמה אחרי סגירה. AD-10 ו-AD-18 קובעים "`book_core` במצב `admin`" ולא אומרים שזה נכון רק ל-`manual`.

**Tightened rule (AD-5 + AD-10 + AD-19):**
> `private.approve_payment_core` and its steps perform no caller check and never read `auth.uid()`, `auth.role()` or `private.is_admin()`. They take `p_source`, `p_actor_id uuid null`, `p_actor_kind text` explicitly. `recorded_by := case when p_source = 'manual' then p_actor_id end`. `private.audit` takes actor id and kind as parameters and never derives them. The booking mode is derived from source, not passed: `manual → 'admin'`, `online → 'online'`. `'online'` is reserved now in `plan_funding`/`book_core` and applies self-mode rules (registration open, capacity, intro eligibility) with no admin overrides. A test greps `pg_proc.prosrc` of every function named `approve_payment_core` or `*_payment` step for `auth.` and `is_admin` and fails on a match.

### H5. ספירת מקומות inline, ומקום שמור בזמן תשלום

**הזוג:** כל יחידה ב-E3 עד E5 שסופרת מקומות: `book_core`, ‏`get_event_availability`, ‏`notify_waitlist` (לפני ואחרי), ‏`refresh_credit_options` ("מפגש מלא לא נספר"), רשימת המפגשים באדמין, בחירת המפגש בטופס התשלום. כל אחת כותבת `sum(party_size) where status = 'confirmed'`, מילה במילה לפי AD-6. מול סבב הסליקה (Deferred: "הרשמה במצב מקום שמור עם `hold_until`, שנספרת במכסה").

**מה קורה:** אם השמירה תהיה סטטוס חדש (`held`), שש שאילתות inline לא יספרו אותה, ויהיו יותר הרשמות ממקומות. אם היא תהיה `confirmed` עם `hold_until`, כל קוד שמתייחס ל-`confirmed` כהרשמה אמיתית יראה אותה: `job_reminders`, ‏`job_complete_events` (שיוסיף `use`!), דף העבודה, רשימת הנרשמות, האינדקס "הרשמה פעילה אחת". בשני המקרים סבב הסליקה צריך לעבור על כל השאילתות האלה.

**Tightened rule (AD-6 + AD-14):**
> Occupied places are computed only by `private.occupied_places(p_event_id) returns int` (stable). No SQL outside it sums `party_size`; a test greps `pg_proc.prosrc` and view definitions for `sum(` over `party_size` outside that function. Every reader that means "a real booking" (reminders, completion, work sheet, attendee lists, customer bookings, availability labels via `occupied_places`) filters through `private.is_real_booking(bookings)` or the equivalent predicate `status in ('confirmed','completed')`, written once. The clearing round will add a status `held` to the vocabulary and to `occupied_places` only.

### H6. ‏`payment_method_id` חובה

**הזוג:** E2-payments (בונה `payments.payment_method_id uuid not null references payment_methods`, כי כל אישור ידני חייב אמצעי, CAP-2) מול סבב הסליקה (תשלום שמגיע מהספק, בלי בחירה של טל).

**מה קורה:** לסבב הסליקה יש שתי דרכים, ושתיהן רעות. אפשר להפוך את העמודה ל-nullable, ואז כל דוח, ייצוא CSV וכרטיס תשלום שהניחו `not null` נשברים בשקט (`join` פנימי מעלים את התשלומים המקוונים מסכום הבית, CAP-24). אפשר גם להוסיף seed "כרטיס אשראי", ואז הוא מופיע ב-`radio-card` של אישור ידני, וטל יכולה להסתיר או לארכב אותו. הוא גם נספר בכלל "לפחות אמצעי גלוי אחד".

**Tightened rule (AD-10):**
> `payments.payment_method_id` is nullable with `check ((source = 'manual') = (payment_method_id is not null))`. Online payments carry `provider` instead. Every admin read of payments uses `left join payment_methods` and shows the provider name when `source = 'online'`; the CAP-24 sum is over `payments.status = 'approved'` with no join to `payment_methods`. `payment_methods` never contains a row that represents online payment.

### H7. הליבה ב-E2 ומוצר מוצמד ב-E3

**הזוג:** E2 (build-sequence: "ליבת אישור תשלום אחת" ב-E2, "CAP-37 נבנה בשלב E3". הבנאי כותב `approve_payment_core(p_source, p_customer_id, p_product_id, …)` בלי `p_event_id`. CAP-3 ב-E2 מאפשר ליצור מוצר עם `validity_mode = 'session'`) מול E3 (מוסיף `p_event_id` בסיגנצ'ר).

**מה קורה:**
1. בין E2 ל-E3, טל (או נתוני seed) מאשרת מוצר מוצמד בלי מפגש. נוצרת זכות `validity_mode = session` בלי `pinned_event_id`. ‏`plan_funding` לא יבחר אותה אף פעם (AD-18: במצב `self` לא, ובמצב `admin` רק ל-`pinned_event_id`). זה תשלום שאי אפשר לממש, והוא גם לא מופיע ב"לטיפול".
2. ב-E3, ‏`create or replace` עם ארגומנט נוסף יוצר **overload** ב-Postgres. הישנה נשארת עם ה-grant שלה, ו-PostgREST מחזיר שגיאת עמימות (או בוחר את הישנה).

**Tightened rule (AD-10 + AD-5):**
> The core and `admin_approve_payment` get their final signature in E2, including `p_event_id uuid default null`. From E2, the core raises `PINNED_EVENT_REQUIRED` when the product's `validity_mode = 'session'` and `p_event_id is null`, and `EVENT_NOT_ALLOWED` when `p_event_id` is set for a `days` product; until E3 ships, `PINNED_NOT_AVAILABLE` for any session product. `entitlements` gets `check ((eligibility_snapshot->>'validity_mode' = 'session') = (pinned_event_id is not null))`. A signature change is `drop function` + `create function` in one migration, never `create or replace` with new args; `grants.test.ts` fails when two routines in `public` or `private` share a name.

### H8. השיוך נתקל באינווריאנטים שלא נבדקו

**הזוג:** E3-CAP-37 (בודק במוצר מוצמד "את ההתאמה, המכסה וההיכרות של רישום ידני", אבל כשהלקוחה חדשה אין לו `customer_id` לבדוק מולו: לא `has_participated`, לא "הרשמה פעילה אחת במפגש", לא "זכות היכרות פעילה אחת") מול E2-join (בונה `claim_join`, שמשייך הרשמה לחשבון קיים).

**מה קורה:** לקוחה קיימת, שכבר רשומה למפגש של יום שלישי מכרטיסייה, מקבלת מטל קישור "לקוחה חדשה" למוצר היכרות מוצמד לאותו מפגש. היא נכנסת, ‏`find_identity` מחזיר חשבון קיים, והיא עוברת ל-`claim_join`. ה-`update bookings set customer_id` נופל על האינדקס הייחודי החלקי (הרשמה פעילה אחת במפגש, או הרשמת היכרות אחת). מוחזר 23505 גולמי. `lib/errors.ts` מציג שגיאת שרת כללית, והטוקן נשאר `awaiting_login` עד שיפוג. גם אם אין התנגשות באינדקס, לקוחה שכבר השתתפה מקבלת היכרות, וזה בדיוק מה ש-CAP-10 אוסר. סבב הסליקה יפגוש את אותה בעיה עם קונה אנונימית.

**Tightened rule (AD-10 + AD-23):**
> `private.bind_purchase` (C1) re-validates, after locking the customer's `profiles` row, every per-customer invariant the core could not check with `customer_id null`: one active booking per event, one active intro entitlement and booking, `intro_only → not has_participated`. On violation it binds nothing, sets the token `state = 'conflict'` with `conflict_reason`, returns `BIND_CONFLICT`, and `admin_get_attention_items` shows it. No unique-violation (23505) may escape a binding RPC; a test covers each invariant.

---

## בינוני

### M1. ‏`hidden` מול `archived_at`, ו"עובר לארכיון כשהשתמשו בו"

**הזוג:** E2-settings (קורא את data-model ואת EXPERIENCE: "אמצעי שכבר שימש לא נמחק, 'העברה לארכיון' במקום מחיקה". בונה `admin_delete_payment_method`, שמנסה `delete` ותופס 23503 כדי לארכב) מול E2-payments (קורא את AD-10 כלשונו, "אמצעי שכבר שימש **עובר** לארכיון", ומוסיף לליבה `update payment_methods set archived_at = now()` בשימוש הראשון) מול דפוס הקונספטים ב-AD-16 (`CONCEPT_IN_USE` ו-RPC ארכיון נפרד).

**מה קורה:** לפי הקריאה השנייה, ביט נעלם מהרשימה אחרי התשלום הראשון. גם בלי זה, יש שני שדות ואין הגדרה אחת ל"ניתן לבחירה": האם `archived_at` מסתיר? אפשר לשחזר? אמצעי מוסתר נמחק? ובנוסף, בשני מסכים באותו פאנל יש שני דפוסי "מחיקה שהופכת לארכיון".

**Tightened rule (AD-10):**
> Selectable = `hidden = false and archived_at is null`, defined once as `private.payment_method_selectable(id)`. Use never changes a method's state. `admin_delete_payment_method` follows the concept pattern: it deletes only when no `payments` row references the method, otherwise raises `PAYMENT_METHOD_IN_USE`, and the UI offers `admin_archive_payment_method`. Archive is reversible (`admin_restore_payment_method`). FK `payments.payment_method_id … on delete restrict`. For `manual`, the core raises `PAYMENT_METHOD_NOT_SELECTABLE` when the method is not selectable.

### M2. "לפחות אמצעי גלוי אחד" בלי נעילה

**הזוג:** שתי לשוניות של טל (או טל ועובדת, AD "תפקיד אחד, עובדות בעתיד"), כל אחת מסתירה אמצעי אחר מתוך שניים גלויים. כל RPC סופר 2, מסתיר, ועושה commit.

**מה קורה:** לא נשאר אף אמצעי גלוי. `payment_methods` לא נמצאת בסדר הנעילה של AD-6, ואין כלל איך מגנים על אינווריאנט שחוצה שורות.

**Tightened rule (AD-6):**
> Every RPC that can reduce the selectable set (hide, archive, delete) first takes `pg_advisory_xact_lock(hashtext('payment_methods'))`, then counts selectable methods excluding the target, and raises `LAST_PAYMENT_METHOD` when the count is 0. General form, added to AD-6: an invariant across rows of one table without a parent row is protected by a named transaction advisory lock `hashtext('<table>')`, taken before any row lock.

### M3. שינוי שם של אמצעי ששימש

**הזוג:** E2-settings (EXPERIENCE: "עריכת שם", "חל רק על תשלומים חדשים") מול E2-payments/CAP-24/ייצוא (מציגים את שם האמצעי דרך `join` ל-`payment_methods`).

**מה קורה:** "העברה" שהפכה ל"העברה בנקאית – לאומי" משנה את כל תשלומי העבר, בזמן שההגדרות מבטיחות "חל רק על תשלומים חדשים". היומן שומר רק את ה-diff של `payment_methods`, ולכן אי אפשר לשחזר מה נרשם בתשלום.

**Tightened rule (AD-15):**
> `payments.product_snapshot` also stores `payment_method_name` at approval. Every display and export of a past payment reads the name from the snapshot; the join is used only for filtering by id.

### M4. ‏`voided` בלי בעלים, ורכישה יתומה

**הזוג:** E2-payments (מוסיף "ביטול תשלום" שמעדכן `status = 'voided'`, כי הסטטוס קיים בוקבולרי) מול E3-refunds (CAP-19, מבטל זכויות דרך `entitlements.status = 'refunded'`) מול E2-links (ביטול קישור בלי חלופי).

**מה קורה:** אין RPC שהוא הבעלים של `voided`, ואין כלל מה קורה בתשלום מבוטל לזכות, לטוקן ולהרשמה המוצמדת. יחידה אחת תבטל רק את התשלום, והזכות תישאר פעילה וניתנת למימוש. בנוסף: טל מבטלת קישור ולא מפיקה חלופי ("תפוגה לא מבטלת את התשלום"). נשארים תשלום וזכות עם `customer_id = null`, ובמוצר מוצמד גם מקום תפוס, עד המפגש. ‏AD-22 מונה את מקורות "לטיפול" ברשימה סגורה, והמקרה הזה לא ברשימה.

**Tightened rule (AD-10 + AD-22):**
> `payments.status` changes only in `admin_void_payment` (sensitive, AD-7, with `plan_void_payment`). It is allowed only when the payment's entitlement has no `reserve` or `use` movement other than the pinned booking; it revokes all non-consumed tokens of the payment, sets the entitlement `revoked`, and cancels the pinned booking via `cancel_core` with no credit, in one transaction. CAP-24's sum counts only `approved`. `admin_get_attention_items` adds "unbound purchase without a live token": a payment with `customer_id is null` whose tokens are all `revoked` or expired.

### M5. "מה ייווצר" לפני האישור

**הזוג:** E2-payments UI (EXPERIENCE שורה 458: לפני האישור מוצגים המוצר, מספר הכניסות ותאריך התפוגה. בלי preview RPC, הבנאי מחשב `paid_on + validity_days` ב-TS) מול הליבה (מחשבת `expires_on` ב-SQL). שינוי סכום הוא "שינוי מחיר" ורגיש (AD-7), אבל AD-7 לא מונה את האישור בין הפעולות שיש להן `plan_`.

**מה קורה:** התצוגה ב-TS ובמסד חלוקות בדיוק בגבולות שעון קיץ וסוף יום (AD-8). אחד הבנאים ידרוש `p_confirmed` תמיד, ואחר רק כשהסכום שונה.

**Tightened rule (AD-7):**
> `private.plan_approve_payment(...)` computes the entitlement, `expires_on`, units, pinned event check and `price_changed boolean`. `preview_admin_approve_payment` returns it and the core calls it. `admin_approve_payment` requires `p_confirmed = true` only when `price_changed`, and otherwise ignores it. The online path calls the same plan.

### M6. סדר רכישת הנעילות בתוך הליבה

**הזוג:** E3-CAP-37 (הליבה קוראת ל-`plan_*`, שנועל את המפגש כדי לבדוק מקום, ואז ל-`book_core`) מול E3-booking (`book_core` נועל את `profiles` של הלקוחה, ה-mutex של AD-6, ואז את המפגש).

**מה קורה:** אצל לקוחה קיימת עם מוצר מוצמד נוצר הסדר events ← profiles, בניגוד לסדר הגלובלי. במקביל `cancel_booking` של אותה לקוחה נועל profiles ← events, והתוצאה deadlock.

**Tightened rule (AD-6):**
> A composite RPC acquires every lock it will need at its start, in global order, before calling any `plan_*` or `*_core`. `*_core` functions assume their locks are held and only re-check (`CONCURRENT_CHANGE`); they never lock a table earlier in the global order than one their caller already locked. `approve_payment_core`: `profiles` (existing customer) → `events` (pinned) → then inserts.

### M7. לקוחה קיימת (CAP-6)

**הזוג:** E2-CAP-2 (בונה ליבה שמתארת רק "לקוחה חדשה", כמו בפסקת "אישור תשלום" ב-AD-10: `customer_id = null` וטוקן) מול E2-CAP-6 (בונה `admin_record_repeat_purchase`, שמכניס `payments` ו-`entitlements` ישירות, כי "הזכות נוספת מיד, בלי קישור").

**מה קורה:** יש שני כותבים ל-`payments`, בניגוד ל"הקוד היחיד שיוצר תשלום". בנוסף, AD-10 אומר "התראת הרכישה נוצרת ב-`join_complete`", אז אצל לקוחה קיימת לא ברור מי שולח `purchase_repeat`.

**Tightened rule (AD-10):**
> The core takes `p_customer_id uuid null`. `null` = new customer (no notification; wrapper issues a join token, H3). Non-null = existing customer: locks her profile (M6), creates bound rows, and enqueues `purchase_repeat` with discriminator `payment_id` in the same transaction. `admin_approve_payment` serves both CAP-2 and CAP-6; there is no other RPC that inserts into `payments`.

---

## נמוך

### L1. סידור "למעלה/למטה"

EXPERIENCE מגדיר סידור בכפתורי "למעלה/למטה". RPC יחסי (`move_up(id)`) לא אידמפוטנטי: ניסיון חוזר מזיז פעמיים. AD-5 פוטר רק `set_*` מוחלט.

> Reordering any admin list is `admin_set_<noun>_order(p_ids uuid[])` with the full ordered list; the RPC rejects a list that is not exactly the current set (`CONCURRENT_CHANGE`).

### L2. ‏`recorded_by` ו-`source`

"חובה ב-manual" (AD-10) ו"ריק רק ב-online" (data-model) הם תנאים חד-כיווניים, ויחד הם מאפשרים online עם `recorded_by`. ברירת מחדל `default 'manual'` ל-`source` תסתיר באג בסבב הסליקה.

> `check ((source = 'manual') = (recorded_by is not null))`; `payments.source` has no default.

### L3. שונות לסבב הסליקה

- `paid_on` הוא `date` שטל מזינה. בתשלום מקוון: `(p_paid_at at time zone 'Asia/Jerusalem')::date` בעטיפה, לא בליבה (AD-8).
- תקרת החזר ("לא עולה על הסכום המקורי") מחושבת רק ב-`private.refundable_agorot(payment_id)`, כדי שהחזר דרך ספק ישתמש באותה תקרה (AD-9, AD-20).
- `proxy.ts` מחזיק רשימת פטורים מ-`SITE_LOCKED` כמערך אחד של prefixes (`/api/jobs/`, ובעתיד `/api/payments/`), לא השוואה קשיחה ל-`/api/jobs/push` (AD-22).

---

## הערה לגבי מסמך המקור

§1 ו-§2 במקור מתארים "אמצעי תשלום" כשדה חופשי ו-`method` בטבלת payments (§9). ה-SPEC מחליף אותו ב-`payment_method_id`, וזו החלטה משותפת שנרשמה ב-memlog (2026-09-29). אין כאן סתירה שדורשת פנייה למשתמשת. השאלה הפתוחה היחידה מה-memlog (לקוחה חדשה ששילמה מקוון וסגרה את הדפדפן) קשורה ישירות ל-H3, וכדאי להכריע בה יחד איתו.
