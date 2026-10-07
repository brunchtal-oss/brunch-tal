---
title: 'רשימת לקוחות וכרטיס לקוחה (4.2)'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'd47148fadc41876388020ec78da3361a473ac071'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין לטל מסך לקוחות. כדי לדעת מה היתרה של לקוחה, מתי הייתה לאחרונה, אם אישרה תמונות או מה כתבה על התזונה, היא צריכה לשאול אותה או לחפש בכמה מסכים. אין לה מקום להערות משלה (מקור §7, "לקוחות"; CAP-25, ‏CAP-9, ‏CAP-40).

**Approach:** שתי RPC קריאה (`admin_list_customers`, ‏`admin_get_customer`), טבלה `customer_notes` עם RPC להוספה ולמחיקה, ושני מסכים: ‏`/admin/customers` ו-`/admin/customers/[id]`. שמות לקוחות בבית האדמין ובתשלומים מקשרים לכרטיס.

## Boundaries & Constraints

**Always:**
- **RPC:** ‏`security definer`, ‏`set search_path = ''`, בשורה הראשונה `if not private.is_admin() then raise exception 'NOT_AUTHORIZED'`. ‏`revoke` מ-`public, anon, authenticated, service_role` ו-`grant execute` ל-`authenticated` בלבד. מחזירות `jsonb` ב-`snake_case`. קריאה: ‏`stable`, בלי idempotency.
- **מי לקוחה:** שורת `profiles` עם `anonymized_at is null` שאינה ב-`admin_roles`. לקוחה שלא הופעלה (`activated_at` ריק) מופיעה, עם chip "לא הופעלה".
- **פעילות אחרונה:** ‏`private.customer_last_activity_on(p_customer_id) returns date`, המאוחר מבין: יום המפגש של הרשמה `completed` (השתתפות), ‏`paid_on` של תשלום `approved` שלה (רכישה), ויום `created_at` של הרשמה בכל סטטוס (הרשמה). ימים לפי `Asia/Jerusalem`. בלי פעילות: ריק. 5.13 ישתמש בה לפעילה ולא פעילה.
- **`admin_list_customers(p_query text, p_active_from date, p_active_to date)`:** כל פרמטר ריק = בלי סינון. חיפוש מ-2 תווים אחרי trim (פחות = בלי חיפוש, יותר מ-100 = ‏`INVALID_INPUT`) עם אותו כלל של `admin_search_customers`: חלק מהשם בלי תלות ברישיות, טלפון מלא בכל פורמט דרך `private.normalize_phone`, או רצף ספרות מהטלפון (גם בצורה המקומית `05…`). הכלל עובר ל-`private.customer_matches(p_full_name, p_phone_e164, p_query)`, ו-`admin_search_customers` קוראת לו (`create or replace`, אותה תוצאה). הסינון לפי תאריך כולל את שני הקצוות, ולקוחה בלי פעילות לא עוברת סינון תאריך. ‏`from > to` ‏← ‏`INVALID_INPUT`. מחזירה `{customers: [{id, full_name, phone_e164, activated, last_activity_on}], has_more}`, ממוין לפי `last_activity_on desc nulls last`, ‏`full_name`, ‏`id`, עד 200. בלי מייל.
- **`admin_get_customer(p_customer_id uuid)`:** לא לקוחה (לא קיימת, אדמין או אנונימית) ← ‏`NOT_FOUND`. מחזירה:
  - `profile`: ‏`id, full_name, phone_e164, email` (מ-`auth.users`, רק כאן, AD-3), `activated_at, created_at, dietary_notes, photo_consent, photo_consent_at, last_activity_on`.
  - `babies`: ‏`name, birth_date`, לפי `birth_date`.
  - `entitlements`: מ-`entitlement_balances` בלבד (AD-14) עם `payments.product_snapshot->>'name'`: אותם שדות כמו `get_my_entitlements` (`entitlement_id, kind, status, product_name, original_units, available, reserved, used, expires_on, is_expired, days_left, is_used_up, pinned_event_id`), ו-`is_expiring` לפי `business_settings.admin_expiring_days`. ממוין לפי `expires_on`.
  - `bookings`: כל ההרשמות שלה: ‏`booking_id, event_id, concept_name, starts_at, status, party_size, created_at`, מהמפגש המאוחר לקודם.
  - `payments`: ‏`payment_id, product_name, amount_agorot, paid_on, payment_method_name` (מה-snapshot), ‏`status`, מהחדש לישן.
  - `notifications`: 30 האחרונות שלה (`recipient_kind = 'customer'`): ‏`title, body, created_at, read_at`.
  - `notes`: ‏`id, body, created_at`, מהחדשה לישנה.
- **`customer_notes`:** ‏`id, customer_id → profiles on delete cascade, body text (1–1000 תווים אחרי trim), created_by, created_at`, אינדקס על `customer_id`. ‏RLS פעיל: policy ‏select לאדמין בלבד (`(select private.is_admin())`), בלי policy ללקוחה. ל-`authenticated` רק `select`, בלי כתיבה. הערה לא מוחזרת מאף RPC חוץ מ-`admin_get_customer`.
- **`admin_add_customer_note(p_customer_id, p_body, p_idempotency_key)`** ו-**`admin_delete_customer_note(p_note_id, p_idempotency_key)`:** לפי `admin_add_work_dish`: ‏idempotency, נעילת שורת ה-profile, ‏`private.audit` עם `customer_id`. ‏`private.audit_diff` מסווה את `customer_notes.body` (`create or replace`, AD-19). התוצאה השמורה בלי `body`. לקוחה לא קיימת ← ‏`NOT_FOUND`; הערה שכבר נמחקה ← ‏`NOT_FOUND`.
- **`admin_get_home` (`create or replace` של הגרסה ב-`20261005225116_admin_home.sql`):** כל שורה ב-`expiring_cards` מקבלת גם `customer_id` (`coalesce(b.customer_id, p.customer_id)`), בלי לשנות שדות קיימים.
- **מסכים** (מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md, טלפון קודם):
  - `/admin/customers`: טופס GET (`q`, ‏`from`, ‏`to` ב-URL, בלי JS) עם שדה חיפוש ושני תאריכים ("פעילות אחרונה מ-" / "עד"), ורשימה: שם, טלפון (`formatLocalPhone`), "פעילות אחרונה DD.MM.YY" או "אין עדיין פעילות", וכל שורה מקשרת לכרטיס. ריק: "לא נמצאו לקוחות". ‏`has_more`: "מוצגות 200 הראשונות. אפשר לחפש".
  - `/admin/customers/[id]`: לפי EXPERIENCE.md:579: פרטים (טלפון, מייל, מועד הצטרפות, תזונה ואלרגיות, אישור תמונות כטקסט "מאשרת"/"לא מאשרת" + תאריך, לקריאה בלבד) ← תינוקות (שם וגיל, `babyAge`) ← יתרות ותוקף (מראה `open-card-row` בלי שורות כניסה: מוצר, `EntryMeter`, "בתוקף עד DD.MM", ‏chip "עומדת לפוג"/"פגה"/"נוצלה") ← הרשמות ← רכישות ← התראות ← הערות פנימיות, מסומנות "רק לך, הלקוחה לא רואה" (טופס הוספה, ומחיקה עם אישור). ‏id לא תקין או `NOT_FOUND` ← ‏`notFound()`.
  - **קישורים לכרטיס:** בבית, השם בשורת "כרטיסיות שעומדות לפוג" הוא קישור (השורה עצמה לא קישור). ב-`/admin/payments` שם הלקוחה ברכישה משויכת הוא קישור. "לטיפול" לא משתנה (החלטת המשתמשת 2026-10-07: רק "שילמה ואין לה מקום" שייך ללקוחה עם חשבון, והוא מוביל לעמוד המפגש; ‏`admin_get_attention_items` לא נוגעים).
  - **ניווט (החלטת המשתמשת 2026-10-07):** "לקוחות" נכנס ל-`adminMoreNav` כפריט הראשון, והסרגל נשאר 5 פריטים (DESIGN.md:689). ב-side-nav בדסקטופ הוא מופיע עם שאר פריטי "עוד". ‏`/admin/customers/[id]` מסמן את "עוד" כנוכחי, דרך `covers`.
- **סינון התאריך הוא טווח** "פעילות אחרונה מ-… עד …" (החלטת המשתמשת 2026-10-07). **הערה: הוספה ומחיקה בלבד** (החלטת המשתמשת 2026-10-07).
- תאריכים ב-`lib/time.ts`, סכומים ב-`formatAgorot`, מיקרו-קופי ב-`lib/copy/admin.ts` תחת `customers`. בלי חישוב תאריכים או השוואה ל-`now()` ב-TS.
- **שינוי אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-07). גובר על כל מה שמעליו ועל המטריצה; שתי סטיות ממסמך המקור נרשמו ב-memlog של ה-UX:**
  - **אין סינון לפי תאריך, בכלל** (סטייה מ"סינון לפי תאריך אחרון" ב-§7). מיגרציה חדשה (עם `drop`, מורצת ב-SQL Editor) מחליפה את `admin_list_customers(text, date, date)` ב-`admin_list_customers(p_query text)`: אותו חיפוש, אותו מיון ואותה תשובה; שאילתה ריקה או קצרה מ-2 תווים ← רשימה ריקה. ‏`private.customer_last_activity_on` נשאר (השורה מציגה "פעילות אחרונה").
  - **חיפוש חי:** במסך אין רשימה עד שמקלידים. מ-2 תווים התוצאות מתעדכנות תוך כדי הקלדה (debounce, כמו `payments/new/existing/customer-search.tsx`), בלי כפתור "חיפוש", דרך Server Action שקורא ל-`admin_list_customers`. ‏`q` נשמר ב-URL (`router.replace`), כך שחזרה מהכרטיס מחזירה את החיפוש. בלי תוצאות: "לא נמצאו לקוחות".
  - **יתרות ותוקף:** כרטיסיות (`kind = 'card'`) קודם, אחריהן שאר הזכויות, ובכל קבוצה לפי `expires_on`. כרטיסייה נפתחת בלחיצה (disclosure באותו מקום) ומציגה שורה לכל כניסה, לפי סדר התאריכים: "נוצלה · {יום DD.MM}" (הרשמה `completed`), "שוריינה · {יום DD.MM}" (`confirmed`), ואחריהן "פנויה, יש לשריין" לכל כניסה פנויה, או "לא נוצלה" כשהכרטיסייה פגה. ‏`admin_get_customer` מחזיר לכל זכות `entries: [{status, starts_at, concept_name, event_id}]` מ-`booking_allocations` (הרשמה שבוטלה לא נספרת). זה מקדים חלק מ-4.3 בכרטיס בלבד; ‏`/admin/customers/open-cards` נשאר ב-4.3.
  - **התראות יוצאות מהכרטיס** (סטייה מ"התראות" ב-§7): ‏`admin_get_customer` לא מחזיר אותן.
  - **הרשמות ורכישות בקישור בלבד:** בכרטיס שתי שורות קישור, "היסטוריית הרשמות ({n})" ו"היסטוריית רכישות ({n})", ל-`/admin/customers/[id]/bookings` ול-`/admin/customers/[id]/purchases`. כל אחד מהם הוא עמוד עם הרשימה (אותו `admin_get_customer`), כותרת עם שם הלקוחה וקישור חזרה לכרטיס.
  - **בדיקה שנייה בטלפון (החלטת המשתמשת 2026-10-07), גוברת על סדר הכרטיס שבשורה הבאה:** הסדר: כותרת ← פרטים ותינוקות ← יתרות ותוקף ← היסטוריה ← הערות. ביתרות, כרטיסיות לפני כניסות בודדות, והכרטיסייה נשארת כמו שהיא. כניסה בודדת (כל זכות שאינה כרטיסייה: רגיל, זוגי, היכרות) מוצגת רק כל עוד לא נוצלה (`used = 0`, ‏`status = 'active'`, לא פגה). היא מוצגת בלי מד ובלי "נוצלו/שוריינו/פנויות" ובלי פירוט כניסות: שם המוצר, ומתחתיו "בראנץ׳ {קונספט} · {יום DD.MM}" של ההרשמה המשוריינת. כשאין הרשמה משוריינת (למשל ביטלה ולא קבעה מחדש): "יש לשריין · בתוקף עד DD.MM".
  - **ניקיון:** המסך והכרטיס עוברים עיצוב מחדש עם הסקילים `ui-ux-pro-max` ו-`frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md: פחות קווים וטקסט, היררכיה ברורה, טלפון קודם. בכרטיס הסדר: כותרת (שם, טלפון, chip "לא הופעלה") ← יתרות ותוקף ← פרטים (מייל, הצטרפה, פעילות אחרונה, תזונה, אישור תמונות) ← תינוקות ← קישורי ההיסטוריה ← הערות פנימיות.

**Never:** ייצוא CSV (4.4), סינון פעילה ולא פעילה (5.13), כרטיסיות פתוחות ושורות כניסה (4.3), שינוי טלפון ומייל וקישור איפוס (2.8), סימון "השתתפה בעבר" (2.9), הסרת פרטים (4.6), עריכת הערה. אין כפתורים מתים לאלה. לא נוגעים ב-`job_reminders`, ‏cron, ‏`enqueue_notification`, טבלאות ההתראות (5.17), ‏`work_sheets`, ‏`admin_get_work_sheet`, ‏`shopping_items`, ‏`admin_get_session_details` (4.10), ‏`admin_list_links`. בלי מייל ברשימה. בלי ליטוש מעבר למה שבולט בבדיקה בטלפון (סבב העיצוב).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| חיפוש חלקי | "רונ" / "רוני" | רוני כהן ‏(גם "רונית") | ‏"ר" (תו אחד): כל הלקוחות |
| טלפון בכל פורמט | ‏`054-123-4567`, ‏`0541234567`, ‏`+972541234567`, ‏`1234567` | אותה לקוחה | ‏`555` שאין לאף אחת: ריק |
| סינון תאריך | פעילה 01.10 ו-05.10, ‏`from=02.10` | רק 05.10; ‏`to=01.10` רק 01.10; בלי פעילות לא מופיעה | ‏`from > to` ← ‏`INVALID_INPUT` |
| פעילות אחרונה | רכישה 01.10, הרשמה שנוצרה 03.10, השתתפות 20.09 | ‏03.10 | הרשמה ב-23:30 ב-02.10 בשעון ישראל ← ‏02.10 |
| מי ברשימה | אדמין, אנונימית, לא הופעלה | רק "לא הופעלה" | ‏`admin_get_customer` לאדמין או לאנונימית ← ‏`NOT_FOUND` |
| יתרות | כרטיסייה, שתיים נוצלו ואחת משוריינת | שדות זהים לשורה ב-`entitlement_balances` | פגה: ‏`is_expired` |
| הערה | אדמין מוסיפה, אותו מפתח פעמיים | שורה אחת, יומן אחד בלי גוף ההערה | ריקה או מעל 1000 ← ‏`INVALID_INPUT` |
| לקוחה קוראת | ‏`authenticated` שאינה אדמין | ‏`NOT_AUTHORIZED` בכל ה-RPC החדשות; ‏`select` מ-`customer_notes` מחזיר 0 שורות | ‏anon: ‏42501 |
| בית | כרטיסייה עומדת לפוג | שורה עם `customer_id`, השם מקשר לכרטיס | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261005225116_admin_home.sql:248-357` -- ‏`admin_get_home` (גרסה יחידה). ‏`expiring_cards` ב-300-331: ‏`entitlement_balances b join payments p ... left join profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)`.
- `supabase/migrations/20261003220222_repeat_purchase_and_amount_override.sql:381-445` -- ‏`admin_search_customers`: כלל החיפוש שעובר ל-`private.customer_matches`. בדיקות: ‏`supabase/tests/repeat-purchase.test.ts`.
- `supabase/migrations/20261006184223_work_sheet.sql:341-397` -- ‏`admin_add_work_dish`: הדפוס להוספה (‏`idempotent_begin/finish`, ‏`private.audit`). מחיקה: ‏`20261006191118_work_sheet_review_fixes.sql:99-158`.
- `supabase/migrations/20261004072550_payer_label.sql:25-71` -- ‏`private.audit_diff` (הגרסה האחרונה; מוסיפים `customer_notes.body` לרשימת המוסווים).
- `supabase/migrations/20261005200619_get_my_entitlements_active_flags.sql` -- השדות והחישוב (`days_left`, ‏`is_expiring`, ‏`is_used_up`) להעתקה ל-`entitlements` בכרטיס.
- סכמות: ‏`profiles` (`20260929154816_*`, ‏`20261001195103_create_join_flow.sql:24-35`), ‏`babies` (שם, 51-57), ‏`bookings` (`20261004183409_*:32-55`), ‏`payments.product_snapshot` (`name`, ‏`payment_method_name`), ‏`notifications` (`20261001184225_*:100-130`, ‏`payload.title/body`), ‏`admin_roles`.
- `supabase/tests/admin-home.test.ts` -- ‏`NOT_AUTHORIZED`/42501 (694-720), ‏`insertEvent` (70), ‏`SNAPSHOT` להרשמות (33). ‏`my-entitlements.test.ts:58` ‏`grant()`. ‏`notification-centers.test.ts:26` ‏`enqueue()`. ‏`support/db.ts` (`insertAuthUser` יוצר מייל), ‏`support/money.ts` (`seedMoney`, ‏`approve`). ‏`grants.test.ts` ‏`EXPECTED_GRANTS` (רשימה ממוינת).
- `app/admin/(shell)/links/page.tsx` -- דפוס דף עם `searchParams` ו-`<Suspense>`. ‏`sessions/[id]/page.tsx:31-53` -- בדיקת UUID ו-`notFound()`. ‏`sessions/[id]/work/actions.ts` + ‏`work-parts.tsx:406,434` -- Server Action עם `ActionResult` ומפתח שמתחדש אחרי הצלחה.
- `app/admin/(shell)/home/expiring-cards.tsx`, ‏`home-items.ts:48-55` (`ExpiringCardRow`) -- מוסיפים `customer_id` וקישור על השם.
- `app/admin/(shell)/payments/page.tsx:73-80`, ‏`payment-items.ts` -- ‏`PaymentRow.customer_id` קיים, ‏`PaymentItem` מוסיף אותו.
- לשימוש חוזר: ‏`components/customer/balance-card.tsx` › ‏`EntryMeter` (ניטרלי), ‏`components/admin/baby-age.ts`, ‏`components/shared/{status-chip,page-heading,inline-notice,result-notice}.tsx`, ‏`components/admin/sensitive-confirm-dialog`. לא מתאימים (קופי של לקוחה או טופס): ‏`balance-card`, ‏`app/me/profile/*`, ‏`notification-item`, ‏`photo-consent-fieldset`.
- `lib/nav.ts:25-30,139-166`, ‏`lib/nav.test.ts` (כל href צריך `page.tsx`; פירוק לפי מיקום ב-~101, ~118), ‏`components/shared/nav-icon.tsx`, ‏`lib/copy/shell.ts` ‏`nav` -- "לקוחות" ראשון ב-`adminMoreNav`, עם אייקון חדש.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_customers_list_and_card.sql` -- הכול לפי Always: ‏`customer_notes` + RLS + grants, ‏`customer_last_activity_on`, ‏`customer_matches` + ‏`create or replace admin_search_customers`, ‏`audit_diff`, ארבע ה-RPC, ‏`admin_get_home`. נוצר ב-`npx supabase migration new customers_list_and_card` רק לפני ההחלה, מוחל ב-`apply_migration`, ואז `get_advisors` ו-`generate_typescript_types`.
- [ ] `supabase/tests/customers.test.ts` + `grants.test.ts` -- כל שורה במטריצה; ‏`admin_get_customer` מחזיר מייל, ו-`entitlements` זהים לשורות `entitlement_balances` של הלקוחה; הערה לא מופיעה ב-`get_my_entitlements`, בהתראות או ב-RPC אחרת של לקוחה, ולקוחה לא רואה אותה גם ב-`select` ישיר.
- [ ] `app/admin/(shell)/customers/{page.tsx,customer-items.ts(+test)}` -- הרשימה; פירוק ומיפוי טהורים ב-`customer-items.ts`.
- [ ] `app/admin/(shell)/customers/[id]/{page.tsx,*.tsx,actions.ts,card-items.ts(+test)}` -- הכרטיס, החלקים, וה-Actions להוספה ולמחיקה של הערה.
- [ ] `app/admin/(shell)/home/expiring-cards.tsx`, ‏`home-items.ts(+test)`, ‏`payments/page.tsx`, ‏`payments/payment-items.ts(+test)` -- הקישורים לכרטיס.
- [ ] `lib/copy/admin.ts` (`customers`), ‏`lib/nav.ts` + `nav.test.ts` + ‏`nav-icon.tsx` + ‏`lib/copy/shell.ts` -- הנוסחים ופריט הניווט ("לקוחות" ראשון ב-"עוד").
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- סוגרים את רשומת target 4.2 (מ-4.1).
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/story-customers-list-and-card.md` -- קובץ הסיפור עם `status: done` (ב-PR).

**Acceptance Criteria:**
- Given טל מחוברת בטלפון, when היא מחפשת "רונ" או את הטלפון עם מקפים ובלי, then הלקוחה נמצאת ולחיצה פותחת את הכרטיס, שבו היתרה והתוקף זהים ל-`/me` של אותה לקוחה.
- Given הערה פנימית שנוספה, when אותה לקוחה נכנסת לאזור האישי, then ההערה לא מופיעה בשום מקום.
- Given המיגרציה, when ה-advisor רץ, then אין WARN או ERROR חוץ מהמאושרים; ‏`lint`, ‏`typecheck`, ‏`npm test`, ‏`npm run test:db` (כולל `admin-home`, ‏`profile`, ‏`repeat-purchase`) ו-`build` עוברים.

## Implementation Notes

## Spec Change Log

- **2026-10-07, הבדיקה בטלפון (החלטת המשתמשת):** בלי סינון תאריכים; חיפוש חי בלי רשימה עד שמקלידים; כרטיסיות קודם, ונפתחות לשורת סטטוס לכל כניסה; בלי התראות בכרטיס; הרשמות ורכישות בעמודים נפרדים; עיצוב נקי יותר עם `ui-ux-pro-max`. מה שנמנע: מסך עמוס וכרטיס ארוך שקשה למצוא בו את היתרה. **KEEP:** ‏`customer_notes` וה-RPC שלה, ‏`customer_matches`, ‏`customer_last_activity_on`, ‏`admin_get_home` והקישורים מהבית ומהתשלומים, הניווט ב"עוד", והבדיקות של הסבב הראשון (מתעדכנות רק במה שהשתנה).

## Review Triage Log

**סבב 1 (2026-10-07), ארבעה מבקרים.** ‏high 0 · ‏medium 0 · ‏low 18 · ‏false 4 · ‏maybe-false 0. שמונה low תוקנו כ-patch, ושאר הממצאים נדחו. אין intent_gap ואין bad_spec.

| ממצא | פסק | ניתוב | ראיה ופעולה |
|---|---|---|---|
| ‏`detail.field` של `INVALID_INPUT` ברשימה לא נבדק (verification) | low | patch | הבדיקות קוראות את ה-detail: ‏`query` ו-`active_to` |
| חיפוש לפי תחילת הטלפון בצורה המקומית (`05…`) לא נבדק (verification) | low | patch | נוסף `phone.local.slice(0, 6)` לבדיקת הטלפון |
| הכרטיס לא מציג את הפעילות האחרונה, שה-RPC מחזיר (blind) | low | patch | שורה "פעילות אחרונה" בפרטים |
| ההתראות מוגבלות ל-30 בלי סימן בכרטיס (blind) | low | patch | שורה מתחת לרשימה כשמגיעות 30 |
| ‏`METER_MAX` מוגדר פעמיים (blind) | low | patch | יובא מ-`balance-card` |
| ‏200 ו-100 קשיחים בקופי (blind) | low | patch | פונקציות שמקבלות את המספר מהקבועים |
| עריכת טקסט אחרי כישלון לא ודאי שולחת אותו מפתח עם גוף אחר (`IDEMPOTENCY_KEY_REUSED`) (blind, edge) | low | patch | מפתח חדש בכל שינוי של הטקסט |
| ‏trim של JS מול btrim של SQL: שורות ריקות בקצוות נשמרות ונספרות אחרת (edge ×2) | low | patch | ה-Action שולח את הגוף אחרי `trim()` |

**נדחו (14):** ‏false: הערות אחרי הסרת פרטים, ומחיקת הערה של לקוחה שהוסרה (4.6 מנקה את `customer_notes`, epic-4-context); אין פסק נפרד לממצאי ה-intent-alignment, כי הם תיאוריים ותואמים את ה-spec וההחלטות. ‏low, מחוץ להיקף או לפי ה-spec: קישורי הפעלה ואיפוס (2.8); "פעילות אחרונה" כוללת הרשמה שבוטלה (המטריצה, החלטת המשתמשת); חיפוש של תו אחד מציג הכול (לפי Always); בדיקת הענפים של המסכים (404, הודעת סינון) מחייבת להעביר את הקריאה ל-loader, ונבדקת בטלפון. ‏low ונדיר: סוג הזכות והמפגש המוצמד לא מוצגים (שם המוצר אומר); "בוטלה" גם להחזר (3.7 לא בהדגמה); עלות הרשימה לכל הפרופילים (עשרות לקוחות); קישור לכרטיס של אנונימית או אדמין (אין עדיין הסרה); פוקוס אחרי מחיקת הערה; כותרת לשונית כללית.

## Design Notes

**חיפוש חי (אחרי הבדיקה בטלפון):** תוצאות תוך כדי הקלדה, בלי רשימה עד שמקלידים. ‏`q` נכתב ל-URL ב-`window.history.replaceState` (ולא `router.replace`), כדי שכל הקשה לא תטען מחדש את הדף בשרת; חזרה מהכרטיס מחזירה את החיפוש.

**למה `customer_matches` משותף:** חיפוש הלקוחה באישור תשלום ובמסך הלקוחות חייב למצוא את אותן לקוחות. כלל אחד מונע שני כללים שמתפצלים.

## Verification

**Commands:**
- `npm run test:db` -- expected: הכול עובר, כולל `customers`, ‏`admin-home`, ‏`profile`, ‏`repeat-purchase`, ‏`grants`.
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: הכול עובר.

**Manual checks:**
- בטלפון כאדמין: חיפוש לפי חלק מהשם ולפי טלפון עם מקפים ובלי; הכרטיס מציג יתרה ותוקף כמו `/me`, אישור תמונות, התראות והיסטוריה; הערה שנוספה לא מופיעה לאותה לקוחה; שם ב"עומדות לפוג" פותח את הכרטיס.
