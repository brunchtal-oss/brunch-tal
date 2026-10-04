---
title: '2.7 Payment methods admin — ניהול אמצעי תשלום'
type: 'feature'
created: '2026-10-04'
status: 'draft'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אמצעי התשלום קיימים רק כ-seed. טל לא מוסיפה, משנה שם, מסתירה, מסדרת או מוחקת אמצעי (מקור §2 "אישור תשלום", CAP-34, AD-10).

**Approach:** מיגרציה עם RPC אדמין לפי AD-10 ומסך `/admin/settings/payment-methods` מ"עוד". כל שינוי עובר ב-`value-change-row` הקיים (ישן ← חדש, בלי צ׳קבוקס) ונרשם ביומן. תשלומי עבר מציגים את השם מה-snapshot.

## Boundaries & Constraints

**Always:** AD-5, AD-6, AD-10, AD-19 (פעולה ביומן = שם ה-RPC, before/after). כל כתיבה רק ב-RPC. מסך ורכיבים מתחילים בסקיל `frontend-design`. עברית רק ב-`lib/copy/admin.ts` וב-`lib/errors.ts`, מה-Design Notes.

**Decisions:**
- **RPC (כולם עם `p_idempotency_key`):** `admin_add_payment_method(p_name)` ← סוף הרשימה, גלוי. `admin_rename_payment_method(p_id, p_name)`. `admin_hide_payment_method(p_id)` / `admin_show_payment_method(p_id)`. `admin_delete_payment_method(p_id)`. `admin_set_payment_method_order(p_ids uuid[])`: חייב להיות בדיוק כל המזהים (כולל מוסתרים), אחרת `CONCURRENT_CHANGE`. מצב שכבר קיים (שם זהה, מוסתר שוב) ← בלי כתיבה ובלי יומן.
- **שם:** `btrim`, 1–100 תווים (`INVALID_INPUT`, `field: name`). ייחודי בלי תלות באותיות גדולות, גם מול מוסתרים: אינדקס ייחודי על `lower(btrim(name))`, ו-`PAYMENT_METHOD_NAME_TAKEN` (גם 23505 ממופה אליו).
- **הקטנת הגלויים** (הסתרה, מחיקת גלוי): קודם `pg_advisory_xact_lock(hashtext('payment_methods'))`, ואז `for update` על השורה, ו-`LAST_PAYMENT_METHOD` אם לא יישאר גלוי. מחיקה: תשלום מפנה ← `PAYMENT_METHOD_IN_USE` (גם 23503 ממופה). מוסתר שלא שימש נמחק.
- **קריאה:** `admin_list_payment_methods()` (בלי idempotency) ← `id, name, sort_order, hidden, in_use` לפי הסדר.
- **ניווט:** "אמצעי תשלום" ב-`adminMoreNav` ישירות לנתיב. דף `/admin/settings` נבנה ב-4.7.
- **מסך:** `ol`, שורה לכל אמצעי: שם, "מוסתר", למעלה/למטה, ופעולות (שינוי שם, הסתרה/הצגה, מחיקה רק כש-`!in_use`, אחרת ההערה). הזזות נצברות במקום ונשמרות כשינוי סדר אחד ב-`value-change-row`. "+ הוספה" שם בלבד. מצבים ונגישות לפי EXPERIENCE › "אמצעי תשלום — מצבים".
- **טופס התשלום:** `payment-form-host.tsx` מתחיל מחדש גם כשהאמצעים או סדרם משתנים, כדי שהראשון יסומן.

**Never:** עמודה חדשה, שינוי בליבת האישור או ב-`payment_method_selectable`, כתיבה מהדפדפן, דף `/admin/settings`, שורה לתשלום מקוון.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| שינוי שם אחרי תשלום | "ביט" שימש; ← "ביט עסקי" | ב-`admin_list_payments` התשלום הישן עם "ביט"; יומן before/after |
| מחיקה | אמצעי ששימש / שלא שימש | `PAYMENT_METHOD_IN_USE`, נשאר / נמחק, יומן |
| אחרון גלוי | אמצעי גלוי יחיד; הסתרה או מחיקה | `LAST_PAYMENT_METHOD`, לא זז |
| מוסתר באישור | הוסתר אחרי פתיחת הטופס | `PAYMENT_METHOD_NOT_SELECTABLE` (קיים) |
| סדר | רשימה חסרה או עם מזהה זר | `CONCURRENT_CHANGE`; תקין ← הראשון מסומן בטופס התשלום |
| שם | ריק / "ביט " / "BIT" מול "bit" | `INVALID_INPUT` / `PAYMENT_METHOD_NAME_TAKEN` |
| חוזר | אותו מפתח | אותה תוצאה, יומן אחד |
| לא אדמין | לקוחה / anon | `NOT_AUTHORIZED` / 42501 |

</frozen-after-approval>

## Open Questions

הסיפור נדחה לאחרי ההדגמה (החלטת המשתמשת 2026-10-04, `demo-scope-2026-10-04.md`). פתוח עד החידוש:

1. **מחיקה:** מקור §7 ("חלון אישור") מונה "מחיקה" כפעולה רגישה עם צ׳קבוקס; EXPERIENCE ו-AD-10 מעבירים את מחיקת האמצעי ב-`value-change-row` בלי צ׳קבוקס, ואין החלטה ב-memlog. א: בלי צ׳קבוקס (המלצה: רק אמצעי שלא שימש, ההיסטוריה לא נפגעת; לרשום ב-memlog). ב: `sensitive-confirm-dialog`.
2. **נוסחים:** אישור הטבלה ב-Design Notes.
3. **אורך:** כ-2,000 טוקנים (כמו 2.6). להשאיר או לקצר ניסוח בלי לוותר על החלטה.

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql` -- `payment_methods` (79), policy (386), grants (417), `payment_method_selectable` (440); הליבה נועלת את האמצעי `for share` (670). לא לשנות.
- `supabase/migrations/20261004102035_product_catalog_admin.sql` -- דפוס: `is_admin`, `idempotent_begin/finish`, `private.audit(actor, 'admin', rpc, table, id, …, before, after)`, revoke+grant בסוף.
- `supabase/migrations/20261004072550_payer_label.sql` -- `admin_list_payments`: דפוס RPC קריאה.
- `app/admin/(shell)/products/{page,actions,products-list}.tsx|ts` -- דפוס דף, actions (UUID, `callRpc`), שורה עם "מוסתר".
- `components/admin/value-change-row.tsx` -- `label/oldValue/newValue/scope/onSave/onCancel`; לא לשנות את ה-API.
- `app/admin/(shell)/payments/new/{form-data.ts,payment-form-host.tsx,payment-form.tsx:132}` -- סינון גלויים לפי `sort_order`, ראשון מסומן, מפתח האתחול.
- `lib/{nav,errors,rpc}.ts`, `lib/copy/admin.ts`, `supabase/tests/{grants.test.ts,support/*}`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_payment_methods_admin.sql` -- **סשן ראשי:** `migration new`, `apply_migration`, `get_advisors`, `generate_typescript_types`.
- [ ] `app/admin/(shell)/settings/payment-methods/**` + בדיקות, `lib/nav.ts`, `lib/copy/admin.ts`, `lib/errors.ts` -- מתחילים בסקיל `frontend-design`.
- [ ] `app/admin/(shell)/payments/new/payment-form-host.tsx` -- אמצעים בתוך מפתח האתחול.
- [ ] `supabase/tests/payment-methods.test.ts`, `grants.test.ts` -- כל שורה במטריצה.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ואין שורות `test_%`.
- Given checkout בלי `.env*`, then lint, format:check, typecheck, `npm test` ו-build עוברים.
- Given טלפון, when טל מסדרת ושומרת, then בטופס התשלום הראשון החדש מסומן; when נשאר גלוי אחד, then הסתרה ומחיקה `aria-disabled` עם הסיבה.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

**נוסחים (לאישור המשתמשת).** מ-EXPERIENCE (כבר מאושרים): "חל רק על תשלומים חדשים" · "שימש בתשלומים, אפשר רק להסתיר" · "חייב להישאר לפחות אמצעי תשלום אחד" · "צריך שם" · "כבר יש אמצעי בשם הזה" · "להזיז את {שם} למעלה / למטה" · "{שם} הועבר למקום {N} מתוך {M}" · "מוסתר".

| מקום | נוסח חדש |
|---|---|
| כותרת, ניווט | אמצעי תשלום |
| הוספה | הוספת אמצעי תשלום · שם · `value-change-row`: "אמצעי חדש: — ← {שם}" |
| פעולות | שינוי שם · הסתרה · הצגה · מחיקה |
| `value-change-row` | שם: {ישן} ← {חדש} · מצב: מוצע ← מוסתר (והפוך) · {שם}: קיים ← נמחק · סדר: {לפני, בפסיקים} ← {אחרי} |
| `CONCURRENT_CHANGE` | הרשימה השתנתה בינתיים. כדאי לרענן את הדף ולנסות שוב |
| `PAYMENT_METHOD_IN_USE` | האמצעי הזה שימש בתשלומים, אפשר רק להסתיר |
| `LAST_PAYMENT_METHOD` | חייב להישאר לפחות אמצעי תשלום אחד |
| `PAYMENT_METHOD_NAME_TAKEN` | כבר יש אמצעי בשם הזה |

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
