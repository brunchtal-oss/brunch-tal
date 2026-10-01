---
title: '2.1 Money schema and payment approval core — סכמת כסף וליבת אישור תשלום'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '93e4ef0fb01a5b816cae658c4502d2a62b7984c4'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין במסד מוצרים, אמצעי תשלום, תשלומים, זכויות, יומן תנועות והגדרות עסקיות, ואין דרך אחת ובטוחה לאשר תשלום. כל E2 ו-E3 נשענים עליהם.

**Approach:** מיגרציה אחת: הטבלאות עם RLS, ‏seed ו-checks, ‏`private.approve_payment_core` בחתימה הסופית (AD-10), ו-`admin_approve_payment` / ‏`preview_admin_approve_payment` ללקוחה חדשה עם טוקן `join`. בלי מסכים. בדיקת מסד לכל שורה ב-verify.

## Boundaries & Constraints

**Always:** כללי AD-5 לכל פונקציה וטבלה. כסף רק integer `*_agorot`. תאריכים ותפוגה רק ב-SQL (`Asia/Jerusalem`, ‏`private.local_day_end`). ערכים עסקיים רק מ-`products` ו-`business_settings`, ונשמרים ב-snapshot. ‏`private.audit` בכל כתיבה, actor כפרמטר. שינוי חתימה: `drop` ואז `create` באותה מיגרציה. ה-seed בעברית הוא נתונים, לא טקסט קוד.

**Decisions:**
- **`products`:** ‏`name`, ‏`type` (single, intro, card, couple), ‏`price_agorot ≥ 0`, ‏`units > 0`, ‏`validity_mode` (days, session), ‏`validity_days` (מלא ⇔ days, ‏> 0), ‏`allowed_weekdays smallint[]` (0 = ראשון, null = כל יום), ‏`eligible_event_kind` (regular, couple), ‏`party_size` (1, 2), ‏`intro_only`, ‏`post_join_message`, ‏`post_join_button_label`, ‏`active`. seed: רגיל 12800 session; היכרות 11800 session ‏intro_only; זוגי 25000 session ‏party_size 2 ‏couple; כרטיסייה 47200, ‏4 כניסות, ‏days 49, ‏{1,4}, הודעה וכפתור מ-§4. רגיל והיכרות: ״קבענו! תבואי רעבה ❤️״ + "לפרטי הבראנץ׳ שלי"; זוגי: ״קבענו! תבואו רעבים ❤️״ + "לפרטי הבראנץ׳ שלנו" (החלטת המשתמשת 2026-10-01, ‏memlog של ה-SPEC).
- **`payment_methods`:** ‏`name`, ‏`sort_order`, ‏`hidden`. seed: ביט, פייבוקס, העברה בנקאית, מזומן. ‏`private.payment_method_selectable(id)` = קיים ו-`hidden = false`.
- **`payments`:** עמודות ו-checks של AD-10, ‏`amount_agorot ≥ 0` (0 מותר, החלטת המשתמשת), FK ‏`on delete restrict` למוצר ולאמצעי, ‏`customer_id` ריק עד השיוך, ‏`product_snapshot` = שורת המוצר + `payment_method_name`.
- **`entitlements`:** ‏`customer_id`, ‏`payment_id` ייחודי, ‏`kind` (= `products.type`), ‏`original_units`, ‏`valid_from` = ‏`paid_on`, ‏`expires_on` = ‏`paid_on + validity_days`, ‏`pinned_event_id uuid` בלי FK (E3) עם check מוצמד ⇔ מלא, ‏`eligibility_snapshot` (כולל `validity_mode`), ‏`allowed_weekdays`, ‏`eligible_event_kind`, ‏`status` (active, revoked, refunded).
- **`entitlement_movements`:** ‏`entitlement_id`, ‏`booking_id uuid` בלי FK, ‏`action` וסימן `units` לפי AD-14, ‏`reason`, ‏`actor_id`, ‏`reverses_id`. trigger זורק על update, delete ו-truncate, גם לבעלים.
- **`entitlement_balances`** (`security_invoker`): ‏`available` = סכום `units`; ‏`reserved` / ‏`used` = ‏−(reserve + release) לכל `booking_id` בלי / עם `use`; ‏`expires_at` = ‏`local_day_end(expires_on)`; ‏`is_expired`.
- **`business_settings`:** שורה אחת (`id boolean primary key default true check (id)`), ‏`version`, עמודה לכל ערך: ‏default_validity_days 49, ‏registration_close_days_before 1, ‏registration_close_local_time 20:00, ‏default_capacity_regular 12, ‏default_capacity_couple 14, ‏cancel_window_hours 48, ‏credit_options_count 2, ‏reminder_lead_hours 24, ‏admin_expiring_days 21, ‏customer_expiring_days 10, ‏last_places_threshold 4, ‏default_prep_days ‏{-1,0}, ‏marketing_reminder_schedule (jsonb ‏[{weekday, time}]: א׳ ג׳ ד׳ 09:00, ב׳ ה׳ 20:00), ‏inactivity_months 3. checks: מספרים ≥ 0 (מכסה, תוקף ו-inactivity ‏> 0), ‏`registration_close_local_time >= '03:00'`.
- **RLS ו-grants:** ‏`authenticated` מקבל select בלבד. לקוחה: ‏`payments` ו-`entitlements` שלה, ‏`entitlement_movements` דרך הזכות שלה, ‏`products` כולם. אדמין: הכול, כולל `payment_methods` ו-`business_settings`. אין כתיבה לאף תפקיד API, ואין כלום ל-`anon`.
- **`activation_tokens`:** ‏`payment_id` (FK), check ‏`purpose = 'join'` ⇔ מלא, ייחודי חלקי `(payment_id) where purpose = 'join' and state <> 'revoked'`. ‏`private.issue_token(p_purpose, p_bound_user_id, p_payment_id default null)`.
- **`private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on)`**, בסדר הזה: מוצר חסר או לא `active` ← `PRODUCT_NOT_AVAILABLE`; ‏session ← `PINNED_NOT_AVAILABLE` (עד E3, לפני `PINNED_EVENT_REQUIRED`); ‏days עם מפגש ← `EVENT_NOT_ALLOWED`; ‏`paid_on` חסר או אחרי היום המקומי, או סכום חסר או שלילי ← `INVALID_INPUT` (החלטת המשתמשת). מחזיר מוצר, `kind`, ‏`units`, ‏`valid_from`, ‏`expires_on`, ‏`expires_at`, ‏`price_agorot`, ‏`amount_agorot`, ‏`price_changed`.
- **`private.approve_payment_core`** (15 הפרמטרים של AD-10) ← `payment_id`. לא בודקת קוראת. ערך מחוץ לאוצר ב-`p_source`, ‏`p_actor_kind` או `p_on_seat_failure` ← `INVALID_INPUT`. תוכנית, נעילת המוצר והאמצעי `for share`, ב-manual אמצעי לא ניתן לבחירה ← `PAYMENT_METHOD_NOT_SELECTABLE`, ואז `record_payment` ← `grant_from_payment` (זכות + `grant` אחד). יומן ל-`payments` ול-`entitlements`. ‏`place_pinned_booking` ו-`park` ב-E3 (3.11).
- **`admin_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id, p_reference, p_note, p_confirmed, p_idempotency_key)`** (`authenticated`), לקוחה חדשה בלבד (2.5 מוסיף `p_customer_id` ב-drop/create): ‏`is_admin` ← idempotency (scope ‏`auth.uid()`, כל הפרמטרים) ← תוכנית ← `price_changed` (כולל 0) בלי `p_confirmed` ← `CONFIRM_REQUIRED` ← ליבה (`manual`, ‏`raise`) ← `issue_token('join', null, payment_id)` ← יומן לטוקן. נשמר `{payment_id, entitlement_id, token_id, link_expires_at, expires_on, reissue_required: true}`; מוחזר פעם אחת עם `token` ו-`reissue_required: false`. הסיבה נשמרת רק כש-`price_changed`.
- **`preview_admin_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on)`:** אותה בדיקה ואותו grant, ‏`return plan`.
- **בדיקות:** ‏`inRollback` בלבד, פרופילים ואדמין בלי משתמשות Auth (החלטת המשתמשת: אין FK ל-`auth.users`, ו-`asAuthenticated` קובע `auth.uid()`; העזר ב-2.2).

**Never:** מסכים ו-Server Actions (2.2), לקוחה קיימת ו-`purchase_repeat` (2.5), התראות (2.12), ‏`bind_purchase` ו-`token_view` עם מוצר (2.2), עריכת מוצרים, אמצעים והגדרות (2.6, 2.7, E4), מוצר מוצמד, ‏`park` ו-`events` (E3), grant ל-`anon`, עמודת `idempotency_key`, ‏`parseFloat`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| אישור כרטיסייה | אדמין, ‏47200, היום, ביט, K | תשלום, זכות (4, היום + 49), ‏grant, טוקן join, ‏3 שורות יומן, ‏`token` |
| אותו מפתח שוב | K, אותו קלט | אותו `payment_id`, ‏`reissue_required: true`, בלי `token` ובלי שורות חדשות |
| אותו מפתח, קלט אחר | K, סכום אחר | `IDEMPOTENCY_KEY_REUSED` |
| preview מול שמור | אותו מוצר ו-`paid_on`, גם ליד מעבר שעון | `expires_on`/`expires_at` זהים לזכות |
| שינוי סכום | 40000 או 0, בלי / עם `p_confirmed` | `CONFIRM_REQUIRED` / נשמר עם הסיבה |
| סכום שלילי / תאריך מחר | | `INVALID_INPUT` |
| מוצמד | רגיל, עם או בלי מפגש | `PINNED_NOT_AVAILABLE`, כלום לא נוצר |
| מפגש במוצר ימים | כרטיסייה + `p_event_id` | `EVENT_NOT_ALLOWED` |
| אמצעי / מוצר מוסתר | `hidden` / `active = false` | `PAYMENT_METHOD_NOT_SELECTABLE` / `PRODUCT_NOT_AVAILABLE` |
| לא אדמין | לקוחה, שתי ה-RPC | `NOT_AUTHORIZED` |
| יתרה | אחרי אישור | `available` 4, ‏`reserved` ו-`used` 0 |
| הגדרות | שלילי / 02:30 / 00:00 / 03:00 | ‏23514 / ‏23514 / ‏23514 / עובר |
| כתיבה ישירה | לקוחה: insert ל-payments, ‏entitlement_movements, ‏admin_roles | 42501 |
| append-only | update או delete של תנועה, גם בעלים | נזרק |
| לקוחה אחרת | A קוראת תשלום וזכות של B | 0 שורות |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- `activation_tokens`, ‏`issue_token` (נקראת מ-`issue_reset_token` בשני ארגומנטים; עובדת עם ה-default), ‏`is_admin`, ‏`current_customer_id`. לא לערוך קובץ שהוחל.
- `supabase/migrations/20260930191525_create_rpc_contract.sql`, ‏`20260930193304_fix_reset_begin_and_audit.sql` -- ‏`idempotent_begin/finish`, ‏`private.audit` (דוחה `entity_type` שאינו טבלה ב-`public`), ‏`audit_diff` (מסתיר `token_hash`). ‏`reset_complete` הוא הדפוס לשמירת תוצאה.
- `supabase/migrations/20260930171231_create_time_and_phone_helpers.sql` -- ‏`local_day_end(date)`, ‏`registration_closes_at(starts_at, days_before, local_time)`, שעמודות ההגדרות תואמות לו.
- `supabase/tests/support/db.ts` (`inRollback`, ‏`asAuthenticated`, ‏`queryError`, ‏`testName`), ‏`rls.test.ts` -- דפוס פרופילים בלי Auth.
- `supabase/tests/grants.test.ts` -- ‏`EXPECTED_GRANTS`; נכשל על שתי פונקציות באותו שם.
- `lib/errors.ts` -- קודים ומיקרו-קופי.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_create_money_schema.sql` (`npx supabase migration new create_money_schema`) -- כל ה-Decisions, אינדקסים ל-FK ול-`customer_id`, grants. מחילים ב-`apply_migration`, ואז `get_advisors` ו-`generate_typescript_types`.
- [ ] `lib/supabase/database.types.ts` -- נוצר מחדש.
- [ ] `lib/errors.ts` -- `PRODUCT_NOT_AVAILABLE`, ‏`PINNED_NOT_AVAILABLE`, ‏`PINNED_EVENT_REQUIRED`, ‏`EVENT_NOT_ALLOWED`, ‏`PAYMENT_METHOD_NOT_SELECTABLE`, ‏`CONFIRM_REQUIRED`.
- [ ] `supabase/tests/approve-payment.test.ts` -- האישור, idempotency, ‏preview, סכום ותאריך, מוצמד, אמצעי ומוצר, הרשאה, יתרה, ו-`pg_proc`.
- [ ] `supabase/tests/money-rls.test.ts` -- כתיבה ישירה, append-only, לקוחה אחרת, ‏anon.
- [ ] `supabase/tests/business-settings.test.ts` -- ה-seed וה-checks.
- [ ] `supabase/tests/grants.test.ts` -- השורות החדשות.

**Acceptance Criteria:**
- Given המיגרציה הוחלה, then ה-advisor בלי WARN או ERROR חוץ מ-0029 ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (כולל invisible-chars) ו-build עוברים.
- Given ‏`pg_proc`, then רק `private.record_payment` מכניסה ל-`payments`, ורק דרך `approve_payment_core`.

## Implementation Notes

- הליבה נועלת את המוצר והאמצעי `for share` לפני `plan_approve_payment` ולא אחריה, כדי שהתוכנית וה-snapshot יקראו את אותה גרסה של השורה. סדר השגיאות הנצפה זהה (מוצר, מוצמד, מפגש, קלט, ואז אמצעי).
- ‏`entitlement_balances` קראה בהתחלה ל-`private.local_day_end` עם grant ל-`authenticated`. זה סותר את הכלל שלעזרי הזמן אין grant, ונתפס ב-`time-and-phone-helpers.test.ts`. תוקן במיגרציה `20261001165149_fix_entitlement_expiry_without_grant.sql`: ה-grant בוטל, ‏`entitlements.expires_at` הוא עמודה מחושבת (`generated always as (private.local_day_end(expires_on)) stored`), וה-view קורא אותה.
- המיגרציה הראשונה הוחלה ידנית ב-SQL Editor (‏`apply_migration` נדחה), אחרי תיקון שם constraint כפול (`products_validity_mode_days_check`). השורה ב-`schema_migrations` נרשמה ידנית. התיקון הוחל ב-MCP.
- ‏`action` ביומן של שורות התשלום והזכות הוא `approve_payment` (הליבה לא יודעת מי קרא לה), ושל הטוקן `admin_approve_payment`.
- תנועות `reserve`, ‏`use` ו-`release` חייבות `booking_id` (check), כי היתרה נגזרת לפי הרשמה.
- עזרי הבדיקות של הכסף ב-`supabase/tests/support/money.ts`.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). intent_gap אחד (עמודות פנימיות), הוכרע במקום עם המשתמשת (א) ותוקן בלי revert, כי התיקון מקומי. medium 2, low 18, false 3. patch 3, defer 1, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | לקוחה קוראת `note`, ‏`amount_override_reason`, ‏`reference`, ‏`recorded_by` של טל, ו-`reason`/`actor_id` ביומן התנועות | medium | grant ל-select על כל הטבלה; ‏policy לפי שורה בלבד | intent_gap ← החלטת המשתמשת (א): grant לפי עמודות במיגרציה `20261001170905_restrict_customer_money_columns.sql` + בדיקות 42501 |
| 2 | `CONFIRM_REQUIRED` נבדק לפני נעילת המוצר; שינוי מחיר באמצע שומר סכום שונה בלי אישור | medium | שלושה מבקרים. העטיפה תכננה בלי נעילה, הליבה נעלה אחר כך | patch: `for share` על המוצר בעטיפה לפני התוכנית (אותה מיגרציה) |
| 3 | בדיקת היומן בודקת שהטוקן הגולמי לא בשורה, דבר שתמיד נכון | low | הטוקן לא נשמר אף פעם; ההסתרה של `token_hash` לא נבדקה | patch: בודק `token_hash = "<changed>"` |
| 4 | ארבע עמודות של `business_settings` בלי בדיקת ערך שלילי | low | ‏`credit_options_count`, ‏`reminder_lead_hours`, ‏`admin_expiring_days`, ‏`customer_expiring_days` | patch: נוספו ל-`it.each` |
| 5 | ‏`entitlements.payment_id` הוא `not null`, ו-data-model מתיר `import_batch_id` | low | יבוא יתרות לא ייכנס בלי שינוי סכמה | defer (סיפור היבוא) |

Reject (21): עקביות בין שדות מוצר, ‏`validity_days` בלי תקרה ו-jsonb של ההגדרות בלי אימות (נכתבים רק ב-RPC של 2.6/E4); מסלול `online` מחזיר 23514/23505 גולמי (אין קורא עד סבב הסליקה); פרופיל לא מופעל ב-`p_customer_id` (2.5 נועל ובודק); release בלי reserve (כותבי E3); זכות היכרות פעילה אחת (3.11 לפי האפיק); התאמת `customer_id` בין תשלום לזכות (`bind_purchase` ו-`bind-purchase.test.ts` ב-2.2); אורך אסמכתה והערה ו-`-infinity` (הטופס ב-2.2 מגביל); אזהרה על זכות שכבר פגה (2.4); כתיבה כאדמין ו-service_role (הרשאות לפי תפקיד, `grants.test.ts` בודק ACL מלא); ‏`expires_at` נשמר ושינוי tzdata (העזר `immutable` מ-1.3, תיאורטי); פערי intent-alignment שמתארים רק את מה שנבנה (seed בדוי, ענפי ליבה עתידיים, `pg_proc` כטקסט, שתי מיגרציות).

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
