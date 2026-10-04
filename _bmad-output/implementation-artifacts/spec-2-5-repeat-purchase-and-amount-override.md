---
title: '2.5 Repeat purchase and amount override — רכישה חוזרת ושינוי סכום'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '08b36100542009ccddd10a28cd8ed8fcd6d0cf4b'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment', 'spec-line-by-line']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** לאישור ול-preview אין `p_customer_id` (נדחה מ-2.1), ולכן אין רכישה ללקוחה קיימת. הסכום במסך קבוע, אין אזהרת כפילות ואין רשימת תשלומים.

**Approach:** מיגרציה אחת ומסכי תשלום, לפי ההחלטות.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-6, ‏AD-7, ‏AD-10, ‏AD-12, ‏AD-19. עברית רק ב-`lib/copy/*`, ‏`lib/errors.ts` ו-`lib/admin/sensitive-actions.ts`, מ-Design Notes בלבד. ‏`approval-history.ts` נשמר בטופס: חזרה וריענון אחרי אישור ← טופס ריק עם מפתח חדש.

**Decisions (המשתמשת, 2026-10-04):**
- **`admin_approve_payment`** (‏`drop` ואז `create`): ‏`p_customer_id` ראשון, ‏`p_duplicate_confirmed` לפני המפתח. ריק = לקוחה חדשה, כמו היום (טוקן). מלא: נעילת `profiles` שלה (AD-6), פרופיל חסר או `anonymized_at` מלא ← `CUSTOMER_NOT_AVAILABLE` (קוד חדש), הליבה עם `p_customer_id`, בלי טוקן, ‏`purchase_repeat` לתור (discriminator ‏`payment_id`, ‏`/me`). מחזיר `{payment_id, entitlement_id, customer_id, expires_on}`; אותו מפתח ← אותה תוצאה.
- **`purchase_repeat` תמיד ללקוחה קיימת, גם בכרטיסייה.** ‏`p_vars`: ‏`product`, ‏`expires_on` (‏`private.format_day_month`), ‏`card_tip`: בכרטיסייה `'. '` ואחריו ה-`body` של תבנית `purchase_new_card` מהטבלה, אחרת ריק. תבנית `purchase_repeat` מתעדכנת ל-`{product}, בתוקף עד {expires_on}{card_tip}`. נרשם ב-memlog של ה-SPEC.
- **כפילות:** ‏`private.similar_payments(p_customer_id, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on)`: ‏`approved`, אותו מוצר, סכום ואמצעי, ‏`abs(paid_on - p_paid_on) <=` ‏`business_settings.duplicate_payment_window_days` (עמודה חדשה, ברירת מחדל 7, ‏`>= 0`). לקוחה קיימת: שלה או `customer_id` ריק; חדשה: כל תשלום. מחזיר שם (או null), ‏`paid_on`, ‏`created_at`. ה-preview מחזיר אותו; ‏`admin_approve_payment` לוקח קודם `pg_advisory_xact_lock` על מוצר+סכום+אמצעי, ואחרי הנעילות מריץ שוב: יש תוצאה ו-`p_duplicate_confirmed` לא true ← `DUPLICATE_CONFIRM_REQUIRED` (קוד חדש). במסך: אזהרה וצ׳קבוקס חובה.
- **`preview_admin_approve_payment`** (‏`p_customer_id` ראשון, ‏`p_payment_method_id` אחרון) ‏= ‏`plan_approve_payment` ‏|| ‏`{customer_name, similar_payments}`, אותה בדיקת לקוחה.
- **שינוי סכום:** ‏`CONFIRM_REQUIRED` קיים (2.1); הסיבה נשמרת רק כשהסכום שונה, ונרשמת ב-`reason` של שורת היומן של `payments`.
- **תוקף שעבר באישור:** אזהרה ב"מה ייווצר" (גם ללקוחה חדשה); ההתראה נשלחת כרגיל.
- **`admin_search_customers(p_query)`** (קריאה, אדמין): לפחות 2 תווים, אחרת `INVALID_INPUT`; חלק מהשם (`ilike`) או טלפון בכל פורמט; בלי `anonymized_at`; עד 20, לפי שם; ‏`{id, full_name, phone_e164}`. ‏4.2 ישתמש בו.
- **`admin_list_payments()`** (קריאה, אדמין): 50 האחרונים לפי `created_at`: שם (או null), מוצר ומחיר מה-snapshot, סכום, שם אמצעי מה-snapshot, ‏`paid_on`, ‏`created_at`, ‏`amount_override_reason`, ‏`reference`, ‏`note`.
- **עזרי עיצוב (deferred 2.12):** ‏`private.format_day_month(date)` ← ‏`DD.MM`; ‏`private.format_agorot(int)` ← כמו `formatAgorot` (בדיקה משווה).
- **מסכים:** "תשלומים" בסרגל ← `/admin/payments`. ‏`/admin/payments/new` ← בחירה: לקוחה חדשה ← `/admin/payments/new/new-customer` (הטופס של היום); לקוחה קיימת ← `/admin/payments/new/existing` (חיפוש) ← `/admin/payments/new/existing/[customerId]` (אותו טופס; "החלפה" ← חיפוש; מזהה לא זמין ← הודעה). בטופס: סכום ניתן לעריכה (`parseShekelsToAgorot`), מתאפס בהחלפת מוצר; כששונה: שדה סיבה, ובאישור הדיאלוג. "להוספת תשלום נוסף" ← הבחירה.
- **רכיבים משותפים:** ‏`lib/admin/sensitive-actions.ts`: מפתח פעולה ← שאלת הכותרת; כאן רק `price_change`, כל סיפור מוסיף את שלו. ‏`sensitive-confirm-dialog.tsx` כללי: כותרת, הסבר, תיבת השפעה (תווית/ערך), ‏`inline-notice` וסיבה (לא חובה) אופציונליים, צ׳קבוקס חובה, אישור רגיל או destructive, ביטול; התנהגות לפי EXPERIENCE › Component Patterns.
- **שם לזיהוי (המשתמשת, 2026-10-04, אחרי הביקורת; memlog של ה-UX):** ‏`payments.payer_label` (רשות, ‏`btrim`, ריק ← null, עד 40 תווים, אחרת `INVALID_INPUT`), רק בלקוחה חדשה (עם `p_customer_id` ← `INVALID_INPUT`). ‏`p_payer_label` אחרי `p_customer_id` ב-`admin_approve_payment` וב-preview (‏`drop` ואז `create`; **סשן ראשי**: המשתמשת מריצה ב-SQL Editor). הליבה לא משתנה: המעטפת מעדכנת את השורה אחרי הליבה ורושמת ביומן; ‏`private.audit_diff` מסתיר את `payer_label` (AD-19); אין grant ללקוחה. ‏`similar_payments` מקבלת את השם: בשני התשלומים יש שם ו-`lower(btrim())` שונה ← לא דומה; מחזירה גם `payer_label`. ‏`admin_list_links` (‏`create or replace`) ו-`admin_list_payments` מחזירות `payer_label`. מוצג עד ההצטרפות, אחר כך השם המלא.
- **גבולות:** ‏E3: מוצר מוצמד ו"לרישום לתאריך". ‏E4: סינון, חיפוש וסכומים ברשימה, ו"תשלומים אחרונים" בבית. ‏4.7: עריכת הטווח (רשומה ב-deferred-work). שתי כרטיסיות שלא נגעו בהן מציגות כל אחת את הודעת המוצר (מקובל).

**Never:** שינוי ב-`approve_payment_core` או ב-`plan_approve_payment`, טוקן ללקוחה קיימת, מיזוג או הארכה של זכות קודמת, קריאת עמודות פנימיות של `payments` מהדפדפן, grant לעזרי `private`, נוסח התראה בקוד.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| קיימת, כרטיסייה שנייה | יש לה כרטיסייה פעילה | תשלום וזכות חדשים עם `customer_id`, ‏`bound_at` ריק; הראשונה ללא שינוי; ‏`purchase_repeat` עם ההמלצה |
| קיימת, לא כרטיסייה | מוצר בודד | ‏`purchase_repeat` בלי ההמלצה |
| חוזר | אותו מפתח | אותה תוצאה; תשלום, זכות והתראה אחת |
| לקוחה לא זמינה | לא קיימת / הוסרו פרטים | ‏`CUSTOMER_NOT_AVAILABLE`, כלום לא נוצר |
| סכום שונה | בלי `p_confirmed` / עם, סיבה ריקה | ‏`CONFIRM_REQUIRED` / נשמר, ביומן `amount_agorot` חדש ו-`reason` ריק |
| דומה בטווח | אותו מוצר, סכום ואמצעי, 7 ימים לפני או אחרי | preview מחזיר אותו; בלי `p_duplicate_confirmed` ← `DUPLICATE_CONFIRM_REQUIRED`; עם ← נשמר |
| דומה, קצוות | 8 ימים / אמצעי אחר / לקוחה אחרת (קיימת) / תשלום לא משויך (קיימת) | בלי אזהרה / בלי / בלי / אזהרה |
| תאריך ישן | ‏`paid_on` לפני 60 יום | נשמר; ‏`expired_before_bound`; ‏`/me` מציג "תוקף הכרטיסיה פג"; אזהרה ב-preview |
| חיפוש | חלק מהשם, "054-1234567", "+97254…", תו אחד | נמצאת / נמצאת / נמצאת / `INVALID_INPUT` |
| לא אדמין | לקוחה / anon, כל RPC חדש | ‏`NOT_AUTHORIZED` / 42501 |
| שם לזיהוי | "מיכל" מול "דנה" / "מיכל" מול " מיכל " / אחד ריק | לא דומה / דומה / דומה |
| שם לזיהוי, קצוות | 41 תווים / שם עם לקוחה קיימת | ‏`INVALID_INPUT` |
| אחרי אישור | חזרה, ריענון, "תשלומים" ואז "הוספת תשלום" | טופס ריק או מסך בחירה, מפתח חדש, בלי תשלום שני |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001170905_restrict_customer_money_columns.sql:23` -- ‏`admin_approve_payment` העדכני (בסיס); ‏grants לפי עמודות ב-`payments`.
- `supabase/migrations/20261001162630_create_money_schema.sql` -- ‏`business_settings` (245), ‏`plan_approve_payment` (458), ‏`approve_payment_core` (626), ‏`preview_admin_approve_payment` (819), ‏grants בסוף.
- `supabase/migrations/20261001184225_create_notification_core.sql` -- תבניות (52), ‏`render_notification_text` (173), ‏`enqueue_notification` (223).
- `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql` -- ‏`admin_list_links`: דפוס RPC קריאה לאדמין.
- `app/admin/(shell)/payments/new/*` -- ‏`page.tsx` (מוצרים, אמצעים, מפתח), ‏`actions.ts` (`NONE`), ‏`payment-form.tsx` (`previewRequest`, ‏`ApprovedLink`), ‏`payment-form-host.tsx`, ‏`approval-history.ts`.
- `components/admin/{radio-card,link-share}.tsx`, ‏`components/ui/{alert-dialog,checkbox}.tsx`, ‏`components/shared/inline-notice.tsx`.
- `lib/nav.ts` (‏`adminNav`), ‏`lib/nav.test.ts`, ‏`lib/money.ts`, ‏`lib/time.ts` (`formatDayMonth`), ‏`lib/copy/admin.ts`, ‏`lib/errors.ts`.
- `supabase/tests/support/money.ts` -- ‏`APPROVE` מיקומי ו-`approveParams` מתעדכנים. ‏`supabase/tests/{approve-payment,grants,money-rls,notifications}.test.ts`; כל בדיקה שמאשרת פעמיים אותו מוצר, סכום ואמצעי צריכה `duplicateConfirmed`; בדיקת נוסח `purchase_repeat` ב-`notifications.test.ts` מתעדכנת.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_repeat_purchase_and_amount_override.sql` -- **סשן ראשי:** ‏`migration new`, ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`.
- [x] `lib/admin/sensitive-actions.ts`, ‏`components/admin/sensitive-confirm-dialog.tsx` + בדיקות -- מתחילים בסקיל `frontend-design`.
- [x] `app/admin/(shell)/payments/new/**` + בדיקות -- מתחילים בסקיל `frontend-design`. בחירה, חיפוש, טופס משותף, סכום, דיאלוג, אזהרות, מסך הצלחה.
- [x] `app/admin/(shell)/payments/{page.tsx,payment-items.ts}` + בדיקות, ‏`lib/nav.ts` -- מתחילים בסקיל `frontend-design`. הרשימה.
- [x] `lib/phone.ts` + בדיקה -- ‏`formatLocalPhone` (‏`+972541234567` ← ‏`054-123-4567`).
- [x] `lib/copy/admin.ts`, ‏`lib/errors.ts` -- הנוסחים המאושרים.
- [x] `supabase/tests/repeat-purchase.test.ts`, ‏`support/money.ts`, ‏`grants.test.ts` -- כל שורה במטריצה, ‏`purchase_repeat` פעם אחת ב-retry, עזרי העיצוב, בדיקות ישנות שנשברו.
- [x] `_bmad-output/specs/spec-brunch-at-tal/.memlog.md`, ‏`deferred-work.md` -- **סשן ראשי:** ההחלטה על `purchase_repeat` ורשומה ל-4.7.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון, when טל מאשרת כרטיסייה שנייה ללקוחה שמצאה בשם ובטלפון, then ב-`/me` שתי כרטיסיות נפרדות ותוקף הראשונה לא השתנה; when הסכום שונה, then בלי צ׳קבוקס אי אפשר לאשר; when יש תשלום דומה, then נשמר רק אחרי סימון; and `/admin/payments` מציג את התשלומים.

## Implementation Notes

- קובץ המיגרציה כבר נוצר בסשן הראשי: `supabase/migrations/20261003220222_repeat_purchase_and_amount_override.sql` (ריק). כותבים אליו בלבד; ‏`apply_migration` ו-`migration new` לא עובדים אצל סוכן משנה. הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`; עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. לסיים בדיווח מה נשאר לסשן הראשי.
- ‏memlog של ה-SPEC ו-deferred-work עודכנו בסשן הראשי.
- ‏`apply_migration` של ה-MCP נדחה אוטומטית על `drop` (בקשת האישור של Supabase לא מוצגת ב-VS Code). המיגרציה `20261003220222` הוחלה מה-SQL Editor בידי המשתמשת, ורשומת ההיסטוריה (`20261004065006`) קיבלה את שמה. ‏`20261004070751_repeat_purchase_review_fixes.sql` (בלי drop) הוחלה מה-MCP.
- שם לזיהוי: קובץ ריק `supabase/migrations/20261004072550_payer_label.sql` נוצר בסשן הראשי. יש בו `drop`, ולכן המשתמשת מריצה אותו ב-SQL Editor.
- בדיקת המקביליות: ‏`reset role` לפני הקריאה מ-`pg_stat_activity`, כי `authenticated` לא רואה backend אחר. ה-cleanup שלה מכבה ומדליק את ה-trigger של `entitlement_movements` בעסקה אחת (אטומי, במסד הפיתוח בלבד).
- שם לזיהוי: `20261004072550_payer_label.sql` הוחלה מה-SQL Editor ונרשמה ידנית בהיסטוריה; תיקוני הביקורת שלה ב-`20261004075337_payer_label_review_fixes.sql` (בלי drop, מה-MCP).
- תוצאות סופיות: ‏`npm test` ‏718/718, ‏`npm run test:db` ‏358/358, ‏lint, ‏format:check, ‏typecheck ו-build עוברים; ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`; לא נשארו שורות `test_%`, וה-trigger של `entitlement_movements` פעיל.

## Spec Change Log

- **2026-10-04, אחרי הביקורת (המשתמשת):** נוסף "שם לזיהוי" ללקוחה חדשה (Decisions, שתי שורות במטריצה, נוסחים). הסיבה: אזהרת הכפילות הייתה מופיעה כמעט בכל כרטיסייה בביט ללקוחה חדשה, ובמסך הקישורים אי אפשר לדעת מי עוד לא מימשה. KEEP: כל השאר בסיפור נשאר כפי שנבנה ונבדק.

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment, spec-line-by-line). אין intent_gap ואין bad_spec. medium 2, low 7, false 3. patch 7, defer 1, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | נעילת ה-advisory שמונעת שני אישורים מקבילים של אותה העברה לא נבדקת | medium | כל הבדיקות בעסקה אחת; מחיקת השורה לא מכשילה שום בדיקה (verification, blind) | patch: בדיקה עם שני חיבורים |
| 2 | הטווח נבדק רק לתשלום מוקדם ורק בערך 7 | medium | ‏`abs()` ו-`duplicate_payment_window_days` יכולים להשתנות בלי שבדיקה תיכשל (verification, blind, spec) | patch: תשלום 7 ימים אחרי, וטווח 0 |
| 3 | כרטיסייה שתוקפה עבר באישור מקבלת בהתראה "מומלץ להירשם מראש…" | low | ‏`card_tip` לפי `kind` בלבד (blind) | patch: ההמלצה רק כשהתוקף לא עבר; מיגרציה `20261004070751` |
| 4 | מסך ההצלחה ללקוחה קיימת מאבד "{N} כניסות · בתוקף עד" כשה-preview לא נטען לפני האישור | low | ‏`units` מ-`submittedPreview` (blind, spec) | patch: ‏`product_name` ו-`units` בתוצאת ה-RPC |
| 5 | שגיאת `DUPLICATE_CONFIRM_REQUIRED` מהשרת נשארת אחרי סימון הצ׳קבוקס | low | ‏`onCheckedChange` מנקה רק `localError` (blind, edge) | patch |
| 6 | תוצאות החיפוש הקודם מוצגות ולחיצות בזמן חיפוש חדש | low | ‏`answer.query` לא מושווה (blind, edge) | patch |
| 7 | הערות ושם בדיקה שאומרים ש"תשלומים" הוא אותה כתובת בלי הפרמטר | low | ‏`lib/nav.ts` מוביל ל-`/admin/payments` (verification, spec) | patch |
| 8 | לקוחה שפרטיה הוסרו: הרשימה מציגה את שמה, ואזהרת הכפילות מציגה אותה כ"לקוחה חדשה" | low | ‏`admin_list_payments` בלי בדיקת `anonymized_at`; אין עדיין RPC שמסיר פרטים (blind, edge, verification, spec) | defer להסרת פרטים |

Reject (14): ‏`status` ברשימה (אין פעולה שקובעת `voided`, AD-10); אין תקרה לתשלומים דומים (מוגבל בהיקף העסק); גרסת התבנית (לא נוצרה התראה מהנוסח הקודם); בדיקת no-grant ל-`similar_payments` (false: ‏`grants.test.ts` משווה את כל ההרשאות); סכום מעל int4 (לא סביר); כשל רשת ב-action (דפוס קיים); חיפוש 00972 חלקי (נדיר); מפתח React כפול (שני תשלומים באותה עסקה לא נוצרים מהמסך); ‏`strpos` במקום `ilike` (false: אותה תוצאה, בלי תווים כלליים); תקרת 100 תווים ושדות נוספים ב-preview (נדרשים לנוסח); קישורים במקום radio במסך הבחירה (החלטת spec); מסלול "תשלומים" ← "הוספת תשלום" וחיווט הטופס בלי בדיקת דפדפן (מקובל, review-accepted; נבדק בטלפון); בדיקת `/me` דרך ה-view (false: הדף קורא את אותו view).

סבב 2 (מבקר אחד, רק שם לזיהוי). medium 1, low 2. patch 3.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 9 | אחרי ההצטרפות, קישורים אחרים של אותו תשלום (בוטל, פג) עדיין מציגים את השם לזיהוי | medium | ‏`admin_list_links` החזיר `payer_label` בלי תלות בשיוך | patch: רק כשהתשלום לא משויך + בדיקת מסד |
| 10 | ה-hash של idempotency משתמש בשם לפני `btrim` | low | שליחה ישירה עם רווח ← `IDEMPOTENCY_KEY_REUSED` | patch: ‏`v_label` |
| 11 | כל הקשה בשדה מבטלת את סימון "תשלום נפרד", גם כשהשם לא השתנה | low | ‏`setDuplicateChecked(false)` בכל `onChange` | patch: רק כשהשם אחרי `trim` השתנה |

## Design Notes

**נוסחים מאושרים (המשתמשת, 2026-10-04).** ‏`{x}` = ערך. סכום ב-`formatAgorot`, תאריך ב-`formatDayMonth`, טלפון ב-`formatLocalPhone`.

| מסך / מצב | מתי | נוסח |
|---|---|---|
| רשימה | ‏`/admin/payments` | תשלומים · כפתור: הוספת תשלום · קישור: לכל קישורי ההצטרפות |
| כותרת שורה | משויך / לא משויך עם שם לזיהוי / בלי | {שם} / {שם לזיהוי} · עוד לא הצטרפה / לקוחה חדשה · עוד לא הצטרפה |
| פרטים · תאריכים | כל שורה | {מוצר} · {סכום} · {אמצעי} · רכישה {DD.MM} · אושר {DD.MM} |
| סכום שונה | סכום ≠ מחיר ה-snapshot | מחיר הקטלוג {סכום} · סיבה: {סיבה} (הסיבה רק אם הוזנה) |
| אסמכתה · הערה | כשקיימות | אסמכתה: {x} · הערה: {x} |
| מגבלה · ריק | 50 שורות / אין | מוצגים 50 התשלומים האחרונים / אין עדיין תשלומים |
| בחירה | ‏`/admin/payments/new` | הוספת תשלום · למי התשלום? · לקוחה חדשה · לקוחה קיימת |
| חיפוש | ‏`/admin/payments/new/existing` | הוספת תשלום · לקוחה קיימת · חיפוש לפי שם או טלפון · רמז: לפחות 2 תווים |
| תוצאה / אין תוצאות | | {שם} · {טלפון} / לא נמצאה לקוחה. אפשר לחפש לפי חלק מהשם או לפי מספר הטלפון |
| ראש הטופס | חדשה / קיימת | לקוחה חדשה / {שם} · {טלפון} · כפתור: החלפה |
| שם לזיהוי | שדה, לקוחה חדשה בלבד | שם לזיהוי (לא חובה) · מתחת: רק את רואה אותו. למשל: מיכל |
| כרטיס הקישור | אחרי אישור, יש שם / אין | {שם לזיהוי} · הקישור מחכה להצטרפות / ללא שינוי (`linkTitle`) |
| ‏`/admin/links` | ממתין / פג / בוטל, יש שם (אין: ללא שינוי) | {שם לזיהוי} · הקישור מחכה למימוש / {שם לזיהוי} · הקישור פג בלי מימוש / {שם לזיהוי} · הקישור בוטל |
| ‏`CUSTOMER_NOT_AVAILABLE` | הוסרה בינתיים, או מזהה לא זמין | הלקוחה הזו לא זמינה. בחרי לקוחה אחרת |
| סכום | שדה / שווה למחיר / שונה | סכום ששולם (חובה) / מהמוצר: {סכום} / מחיר הקטלוג: {סכום} · הסכום שונה |
| סיבה | כשהסכום שונה | סיבת שינוי המחיר (לא חובה) |
| סכום לא תקין | ‏`parseShekelsToAgorot` ← null | סכום לא תקין |
| מה ייווצר | קיימת | {מוצר} · {N} כניסות · בתוקף עד {DD.MM} · הרכישה תתווסף לחשבון של {שם} |
| תוקף עבר | ‏`expires_on` לפני היום, חדשה או קיימת | תאריך התפוגה כבר עבר. הרכישה תופיע אצל הלקוחה כפגה |
| כפילות | ‏`similar_payments` לא ריק | נמצא תשלום דומה · אותו מוצר, סכום ואמצעי תשלום, בטווח של {N} ימים מתאריך הרכישה: · שורה: {שם, או שם לזיהוי, או: לקוחה חדשה} · רכישה {DD.MM} · אושר {DD.MM} · צ׳קבוקס: בדקתי, וזה תשלום נפרד ולא כפילות |
| ‏`DUPLICATE_CONFIRM_REQUIRED` | אישור בלי הסימון, או דומה שנוצר בינתיים (ואז ה-preview מתרענן) | צריך לאשר שזה תשלום נפרד ולא כפילות |
| כפתור אישור | חדשה / קיימת | אישור תשלום ויצירת קישור / לאישור התשלום |
| הצלחה | קיימת | התשלום אושר. הרכישה נוספה לחשבון של {שם} · {מוצר} · {N} כניסות · בתוקף עד {DD.MM} · להוספת תשלום נוסף · לרשימת התשלומים |
| דיאלוג (`price_change`) | אישור כשהסכום שונה | האם לאשר שינוי מחיר? · הסכום שונה ממחיר הקטלוג. בדקי לפני האישור. |
| תיבת השפעה | | לקוחה: {שם} / לקוחה חדשה (תמלא פרטים בקישור) · מוצר: {מוצר} · {N} כניסות · מחיר: {מחיר} ← {סכום} · סיבה: {סיבה} (רק אם הוזנה) |
| צ׳קבוקס | | אני מאשרת שהלקוחה משלמת {סכום} במקום מחיר הקטלוג {מחיר}, ושהשינוי יירשם ביומן הפעולות |
| כפתורים · רמז | לחיצה בלי סימון | כנוסח כפתור האישור · ביטול · צריך לסמן את האישור כדי להמשיך |
| התראה (תבנית) | ‏`purchase_repeat` | הרכישה נוספה לחשבון שלך · {product}, בתוקף עד {expires_on}{card_tip} |
| ‏`card_tip` | כרטיסייה | ". " + גוף `purchase_new_card` ("מומלץ להירשם מראש לארבעת המפגשים כדי לבחור את התאריכים שנוחים לך") |

"יש לבחור לקוחה" אושר, אבל לא נכנס לקוד: בשלב הבחירה אין טופס בלי לקוחה.

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
