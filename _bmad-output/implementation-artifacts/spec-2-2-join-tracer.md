---
title: '2.2 Join tracer — אישור, קישור, הצטרפות ואזור אישי'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'f3e0d081adb6e534ba8cce3b69529fe0eb0c4dd1'
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

**Problem:** אין דרך מתשלום ללקוחה מחוברת: אין מסך אישור, ‏`/join/[token]`, ‏RPC הצטרפות ושיוך, ויתרה ב-`/me`.

**Approach:** מיגרציה אחת (השלמת `profiles`, ‏`babies`, תוכן עם seed, ‏`token_view` עם מוצר, ‏`join_begin`, ‏`join_complete`, ‏`private.bind_purchase`), ‏`lib/server/privileged/join.ts` לפי AD-21, והמסכים `/admin/payments/new`, ‏`/join/[token]`, ‏`/me`. בדיקת מסד לכל שורה ב-verify.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-6 (`activation_tokens` ← `profiles` ← `entitlements` ← `payments` ← `notification_jobs`). ‏`cleanToken` בדף ובפעולה. סיסמה, טוקן, מייל וטלפון לא בלוג וביומן. עברית רק ב-`lib/copy/*`, ‏`lib/errors.ts` וב-seed. ₪ בלי אגורות (`formatAgorot`), תאריכים מה-SQL (`lib/time.ts` לעיצוב).

**Decisions (החלטות המשתמשת 2026-10-01 מסומנות *):**
- **גבולות:** 2.3 ‏`find_identity`, חשבון קיים, ‏`claim_join`. ‏2.4 קישור חלופי, ‏`/admin/links`, וואטסאפ במסך פג, כרטיסייה שפגה עד ההצטרפות, תקוע. ‏2.5 לקוחה קיימת ושינוי סכום. ‏2.10 ‏`/me/profile`, ‏`set_photo_consent`. ‏E3 מוצמד ומפגשים. ‏E5 עורך תוכן ו-`/privacy`.
- **`profiles` +:** ‏`phone_e164` (ייחודי, ‏`^\+[1-9][0-9]{7,14}$`), ‏`dietary_notes` (‏null = לא מוצג, ‏≤ 2000), ‏`privacy_consent_at`, ‏`privacy_policy_version`, ‏`photo_consent bool not null default false`, ‏`photo_consent_at`, ‏`photo_consent_text_version`. ‏`authenticated`: ‏`update (full_name, dietary_notes)`, policy ‏`profiles_authenticated_update`. ‏`audit_diff` מסתיר גם `phone_e164` ו-`dietary_notes`.
- **`babies`:** ‏`id`, ‏`customer_id` (FK, cascade, אינדקס), ‏`name` 1–100, ‏`birth_date not null`, ‏`created_at`. לקוחה: select/insert/update/delete של שלה, insert/update לפי עמודות; אדמין: select.
- **תוכן:** ‏`content_pages` ו-`content_sections` לפי data-model; ‏`anon`/`authenticated` קוראים רק עמודות מפורסמות כשיש `published_content`. seed, גרסה 0 (6.9 בודק גרסה אמיתית): ‏`privacy` לא פורסם; ‏`join-form` עם `photo_consent {question, yes_label, no_label}` בנוסח המאושר; ‏`contact` + סקשן `business_details` ‏`{whatsapp_phone: "0544256456"}`.
- **`token_view`:** ב-join ממלא `product_name`/`amount_agorot` מ-`product_snapshot`; ‏`claiming` = active.
- **`join_begin(p_token, p_email, p_phone, p_idempotency_key)`** (service role, scope ‏`token:<id>`): נועל טוקן. לא join / בוטל / ‏`pending` שפג ← `LINK_EXPIRED`; ‏consumed ← `LINK_USED`; ‏conflict ← ‏`{outcome: conflict}`; מייל (`lower(trim())`) או טלפון (`normalize_phone`) לא תקינים ← `INVALID_INPUT` + ‏`detail.field`. ‏pending: מייל ב-`auth.users` או טלפון ב-`profiles` ← ‏`conflict`, ‏`conflict_reason = identity_match` (*4א; 2.3 מפצל); אחרת ‏`claiming`, ‏`pending_user_id` חדש, ‏`input_hash = sha256(email|phone)`. ‏claiming: אותו hash ← אותו `pending_user_id` (גם אחרי התפוגה), אחר ← `LINK_IN_USE`.
- **`submitJoin`:** ‏`getUserById` ← קיימת: `updateUserById(password)`; לא: `createUser({ id, email, password, email_confirm: true })`, ושגיאת id קיים (שליחה מקבילה) ← update. ‏`email_exists` ← מסך ההתנגשות, הטוקן נשאר claiming (2.4). ‏`join_complete`, ‏`signInWithPassword` בשרת, ‏`redirect('/me')`; כשל התחברות ← "כניסה לאזור האישי".
- **`join_complete(p_token, p_profile jsonb, p_idempotency_key)`** (service role): טוקן claiming (אחרת כמו begin); ‏`sha256(email|phone)` = ‏`input_hash` (אחרת `LINK_IN_USE`); משתמשת ה-Auth קיימת; שם 1–200; מדיניות (`CONSENT_REQUIRED`); ‏`photo_consent` בוליאני (*6ג, אחרת `INVALID_INPUT`); לפחות תינוק אחד (*1), תאריך לא אחרי היום המקומי. יוצר פרופיל עם `activated_at` ושתי הגרסאות, תינוקות, ‏`bind_purchase`, ‏consumed עם `customer_id`, יומן (`customer`). ‏23505 בטלפון או `BIND_CONFLICT` ← בתת-בלוק: טוקן conflict, ‏`{outcome: conflict}`. מחזיר `{outcome: joined, customer_id, payment_id}`.
- **`private.bind_purchase(p_payment_id, p_customer_id)`:** נועלת `profiles`, ‏`entitlements`, ‏`payments`; תשלום משויך ← `BIND_CONFLICT` (בדיקות E3 יתווספו). ממלאת `customer_id` ב-`payments` וב-`entitlements` עם יומן; בכרטיסייה `enqueue_notification(customer, 'purchase_new_card', payment_id, '{}', '/me')`.
- **`/admin/payments/new`:** הסבר "לקוחה חדשה" (בחירה ב-2.5); מוצרים פעילים במצב `days`; סכום לקריאה מהמוצר; תאריך (היום); אמצעים גלויים כ-`radio-card`, הראשון מסומן; אסמכתה (≤ 100) והערה (≤ 500) בקיפול; "מה ייווצר" מ-`preview_admin_approve_payment`; מפתח לכל טעינה. הצלחה: ‏`origin` מכותרות הבקשה + `/join/<token>`, ‏`wa.me/?text=<קישור>`, העתקה. ניווט "תשלומים".
- **`/join/[token]`:** ‏`no-referrer`/`no-store`, ‏noindex. מצבים: טופס, מומש, פג/לא נמצא, התנגשות. שדות, סדר ו"+ תינוק נוסף" כב-EXPERIENCE. מדיניות: צ׳קבוקס חובה בלי קישור (*5א). תמונות: ‏`radio-group` משני התוויות, בלי בחירה מראש, חובה (*6ג).
- **`/me`:** "היי {שם}"; לכל זכות פעילה: אישור רכישה, `balance-card` (זמינות, משוריינות, "בתוקף עד", ימי מימוש) מ-`entitlement_balances`, וההודעה והכפתור מהמוצר הנוכחי כשעוד לא שוריין ממנה כלום (*2א). הכפתור ← `/me/sessions`: עמוד זמני ופריט ניווט "מפגשים" (*3א).
- **עזר:** ‏`insertAuthUser(db, label)` ב-`support/db.ts` (שורה ב-`auth.users` בתוך `inRollback`, ‏`test_<runId>_…@example.test`) סוגר את ה-deferred.

**Never:** ‏`find_identity`, ‏`claim_join`, קישור חלופי, שינוי סכום, לקוחה קיימת, עורך תוכן, הגבלת קצב (2.8), grant לעזרי `private`, ‏RPC של `authenticated` שמקבל טוקן, ‏`parseFloat`, נוסח שיווקי בקוד.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| הצטרפות | pending, פרטים תקינים, "פרטיות" | פרופיל מופעל, ‏`photo_consent = false` עם גרסה ומועד, תינוק, תשלום וזכות משויכים, consumed, התראה אחת; ‏`/me`: ‏4 זמינות, ‏`paid_on + 49` |
| שליחה כפולה | אותו מפתח / מפתח אחר אחרי consumed | אותה תוצאה / `LINK_USED`; הכול פעם אחת |
| תקלה באמצע | begin + משתמשת Auth, בלי complete; ניסיון חוזר | claiming, בלי פרופיל, לא משויך; החוזר מקבל אותו `pending_user_id` ומשלים פעם אחת |
| קלט אחר באמצע | claiming, טלפון אחר | `LINK_IN_USE` |
| חסר | מדיניות / תשובת תמונות / תינוק | `CONSENT_REQUIRED` / `INVALID_INPUT` / `INVALID_INPUT`, אין פרופיל |
| תווי כיווניות | ‏`%E2%80%8F<token>` | תקף ונשמר |
| פג / בוטל / מומש | | `LINK_EXPIRED` / `LINK_EXPIRED` / `LINK_USED` |
| מייל או טלפון קיימים | | conflict, כלום לא נוצר |
| תשלום משויך | `bind_purchase` | `BIND_CONFLICT` ← טוקן conflict, שום שורה לא השתנתה |
| הרשאות | לקוחה: update ‏`phone_e164`/`photo_consent`, תינוק ללקוחה אחרת; ‏`authenticated` ← `join_*` | ‏42501 / ‏42501 / `NOT_AUTHORIZED` |
| תוכן | anon: ‏`privacy` / ‏`contact` | 0 שורות / שורה |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- ‏`profiles`, ‏`activation_tokens`, ‏`find_token`, ‏`token_view` (שורה 362, ‏`create or replace`). לא עורכים מיגרציה שהוחלה.
- `supabase/migrations/20260930191525_create_rpc_contract.sql`, ‏`20260930193304_fix_reset_begin_and_audit.sql` -- ‏`idempotent_begin/finish`, ‏`private.audit`, ‏`audit_diff`; ‏`reset_complete` = דפוס הנעילה וה-scope.
- `supabase/migrations/20261001170905_restrict_customer_money_columns.sql` -- ‏`admin_approve_payment` הסופית; עמודות `payments` שלקוחה קוראת.
- `supabase/migrations/20261001184225_create_notification_core.sql` -- ‏`enqueue_notification`; ‏`purchase_new_card` בלי vars.
- `lib/server/privileged/reset.ts`, ‏`app/(auth)/reset/[token]/*`, ‏`lib/auth/clean-token.ts`, ‏`app/(auth)/layout.tsx` -- הדפוס ל-`join.ts`, לדף ולפעולה.
- `lib/rpc.ts`, ‏`lib/errors.ts` (‏`LINK_USED` של איפוס; נוסח join ב-copy), ‏`lib/copy/{auth,shell}.ts`, ‏`lib/nav.ts` + ‏`nav.test.ts`, ‏`lib/time.ts`, ‏`lib/money.ts`.
- `components/shared/inline-notice.tsx`, ‏`components/auth/password-input.tsx`, ‏`components/ui/*`. ‏`radio-card` ו-`balance-card` חדשים.
- `next.config.mjs` (כותרות רק ל-`/reset`), ‏`eslint.config.mjs` (‏`/join/[token]/page.tsx` כבר מורשה).
- `supabase/tests/support/{db,money}.ts`, ‏`grants.test.ts`, ‏`session-role-and-token-view.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_create_join_flow.sql` (`npx supabase migration new create_join_flow`) -- המסד וה-seed. הסשן הראשי מחיל, ‏`get_advisors`, ‏`generate_typescript_types`.
- [ ] `lib/supabase/database.types.ts` -- נוצר מחדש.
- [ ] `lib/errors.ts` -- `CONSENT_REQUIRED`, ‏`LINK_IN_USE`, ‏`BIND_CONFLICT`.
- [ ] `lib/copy/{admin,join,customer}.ts` -- הנוסחים המאושרים.
- [ ] `lib/server/privileged/join.ts` + ‏`join.test.ts` (client מדומה: קיימת, חדשה, create כפול, כשל ב-complete).
- [ ] `app/(auth)/join/[token]/{page,actions,join-form}.tsx` + בדיקות ולידציה ומצבים.
- [ ] `app/admin/(shell)/payments/new/{page,actions,payment-form}.tsx`, ‏`components/admin/radio-card.tsx`.
- [ ] `app/me/page.tsx`, ‏`app/me/sessions/page.tsx`, ‏`components/customer/balance-card.tsx`.
- [ ] `lib/nav.ts`, ‏`next.config.mjs` -- "תשלומים", "מפגשים", כותרות `/join`.
- [ ] `supabase/tests/support/db.ts` -- `insertAuthUser`.
- [ ] `supabase/tests/join.test.ts` -- המטריצה, ו-`pg_proc`: רק `bind_purchase` מעדכנת `customer_id` ב-`payments`.
- [ ] `supabase/tests/bind-purchase.test.ts` -- כל טבלה ב-`public` עם `customer_id` מטופלת או ברשימת "לא נוצר לפני שיוך" (`babies`, ‏`activation_tokens`, ‏`audit_log`); טבלה חדשה בלי סיווג נכשלת.
- [ ] `supabase/tests/content.test.ts`, ‏`grants.test.ts`.

**Acceptance Criteria:**
- Given המיגרציה הוחלה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (כולל invisible-chars) ו-build עוברים.
- Given טלפון, when טל מאשרת כרטיסייה ומעתיקה, והלקוחה בוחרת "פרטיות" ושולחת, then היא ב-`/me` מחוברת עם 4 זמינות, "בתוקף עד" של היום ה-49, וההודעה והכפתור של הכרטיסייה.

## Implementation Notes

- המיגרציה `20261001195103_create_join_flow.sql` הוחלה ב-`apply_migration` מהסשן הראשי. ה-advisor: רק 0029 (שתי הפונקציות של 2.1) ו-`auth_leaked_password_protection`. ‏`database.types.ts` זהה לפלט של `generate_typescript_types`.
- ‏`private.join_identity` (בלי grant) מנרמלת מייל וטלפון ומחשבת את `input_hash` פעם אחת ל-`join_begin` ול-`join_complete`.
- ‏`callRpc` מעביר עכשיו `detail` (רק `field` ו-`index`), כדי שהטופס יסמן את השדה הנכון.
- שאלת התמונות, צ׳קבוקס המדיניות ו-`radio-card` הם רכיבי native, כדי שנתוני הטופס והפוקוס בשגיאה יעבדו באמינות.
- ‏`dietary_notes` דוחה מחרוזת ריקה (check): ‏2.10 שולח null לשדה ריק.
- לקוחה שקוראת ל-`join_*` מקבלת 42501 (אין grant); הבדיקה של `NOT_AUTHORIZED` רצה כבעלים עם claims של לקוחה.
- כשל התחברות אחרי הצטרפות מציג את מסך "מומש" עם "כניסה לאזור האישי".
- מיקרו-קופי שנלקח מ-EXPERIENCE: "יש {n} שדות לתיקון:"; רמז הסיסמה "8 תווים לפחות" הקיים.
- תוצאות: ‏`npm test` ‏484/484, ‏`npm run test:db` ‏260/260, ‏lint, ‏format:check, ‏typecheck ו-build עוברים.
- תיקוני הביקורת: מיגרציה שנייה `20261002041859_fix_content_sections_policy.sql` (‏`alter policy`, כי `drop policy` נדחה בחלון האישור), הוחלה מהסשן הראשי; ה-advisor ללא שינוי. אחרי התיקונים: ‏`npm test` ‏514/514, ‏`npm run test:db` ‏262/262, ‏lint, ‏format:check, ‏typecheck ו-build עוברים.
- תיקונים מהבדיקה בטלפון (המשתמשת, 2026-10-02): בלי "(חובה)" ליד שאלת התמונות; בלי ימי המימוש ב-`balance-card`; בלי ההסבר מתחת ל"לקוחה חדשה" באדמין; הודעת הכרטיסייה בלי המשפט הראשון (מיגרציה `20261002051951_update_card_post_join_message.sql`, הוחלה); ‏"העתקת הקישור" לא העתיקה ב-http של הרשת הביתית (אין `navigator.clipboard` בלי הקשר מאובטח), ולכן נוספה העתקה דרך textarea ו-`execCommand("copy")`.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 3, low 13, false 6. patch 10, defer 5, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | אחרי ניסיון חוזר עם אותו מפתח (`reissue_required`) טל רואה "הקישור מוכן לשליחה" בלי קישור | medium | `ApprovedLink` התעלם מ-`link: null` | patch: ‏`inline-notice` עם `linkNotShown` (נוסח אושר 2026-10-02) |
| 2 | ‏`updateUserById` רץ גם אחרי ששליחה מקבילה כבר צרכה את הקישור, ודורס סיסמה של חשבון מופעל | low | ‏`ensureAuthUser` לא בדק את המצב; ההערה טענה שזה לא קורה | patch: ‏`token_view` לפני העדכון, רק כש-active |
| 3 | הצטרפות שהצליחה עם התחברות שנכשלה מציגה "הקישור כבר שימש" | low | ‏`joinView` מיפה joined ל-used | patch: מצב `joined` ונוסח `joinCopy.joined` (אושר) |
| 4 | סקשן מפורסם גלוי גם כשהעמוד שלו לא פורסם; אין check ל-object | low | ה-policy בדקה רק את הסקשן | patch: מיגרציה `20261002041859_fix_content_sections_policy.sql` (‏`alter policy`) + בדיקות |
| 5 | "+ תינוק נוסף" בלי גבול (מול 10), שגיאות שזזות אחרי הסרת שורה, סיסמה ריקה ← "קצרה מדי" | low | blind-hunter, edge-case | patch: הכפתור מוסתר ב-10, ניקוי שגיאות, `FIELD_REQUIRED` |
| 6 | ל-`business_details` אין סכמת zod | low | AD-16 (סכמה לכל kind) | patch: `businessDetailsSchema` + בדיקה |
| 7 | כותרות `/join` לא נבדקות | low | verification-gap | patch: ‏`it.each` ב-`next.config.test.ts` |
| 8 | ‏`approvePaymentAction` ו-`requestOrigin` בלי בדיקה | low | verification-gap | patch: `actions.test.ts` חדש |
| 9 | בניית הפריטים ב-`/me` בלי בדיקה | low | verification-gap, intent-alignment | patch: ‏`buildPurchaseItems` + בדיקות |
| 10 | מיפוי שדות השגיאה מהשרת חלקי בבדיקות | low | verification-gap | patch: הרחבת `it.each` |
| 11 | משתמשת Auth בלי פרופיל אחרי `phone_taken`/`bind_conflict` | medium | אין ניקוי, ‏`pending_user_id` נשאר | defer ל-2.3 |
| 12 | ‏claiming נעול ל-hash הראשון: תיקון מייל או טלפון אחרי כשל ב-Auth ← `LINK_IN_USE` לתמיד; ‏`email_exists` נשאר claiming | medium | החלטה ב-spec; ‏2.4 = המשך ממצב claiming | defer ל-2.4 |
| 13 | שיוך ו-`token_view` לא בודקים סטטוס תשלום או זכות | low | אין היום RPC שקובע voided/revoked | defer ל-E3 |
| 14 | כתיבה ישירה ל-`babies` בלי בדיקת תאריך ומספר | low | רק `join_complete` בודק | defer ל-2.10 |
| 15 | ‏`weak_password` (גם pwned) ← "קצרה מדי" | low | ההגנה כבויה ב-dev | defer ל-6.9 |

Reject (16): התנגשות שלא נשלחת כהתראה לטל ("לטיפול" נגזר ממצבים שמורים, AD-22); מצב ריק בטופס התשלום (לפחות אמצעי גלוי אחד מובטח, ומוצר כרטיסייה ב-seed); תאריך לידה בלי גבול תחתון (אין כלל עסקי); תוכן התמונות חסר במצב לא פעיל (seed, עריכה רק ב-E5); הודעת תאריך לידה לתאריך לא תקין (שדה `date`); בלי origin (פעולת שרת תמיד שולחת Origin); קודי GoTrue לא מאומתים מול Auth אמיתי (הקודים מתועדים; הבדיקה בטלפון); "תווים ונשמר" כמסלול אחד (נבדק בשתי השכבות); ‏42501 מול `NOT_AUTHORIZED` (מתועד ב-Implementation Notes); כרטיסייה שפגה עד ההצטרפות ו-EXPERIENCE עם קישור למדיניות (החלטות *5א ו-2.4); ופערי intent-alignment שמתארים את מה שנבנה.

## Design Notes

**נוסחים מאושרים (המשתמשת, 2026-10-01).** ‏`{x}` = ערך. כל השאר נשאר כמו שהוא.

| מסך | נוסח |
|---|---|
| ניווט | תשלומים · מפגשים |
| אדמין | הוספת תשלום · לקוחה חדשה · מוצר · סכום ששולם · מהמוצר: {סכום} ₪ · תאריך רכישה · אמצעי תשלום · פרטים נוספים (לא חובה) · אסמכתה (לא חובה) · הערה (לא חובה) · מה ייווצר · {מוצר} · {n} כניסות · בתוקף עד {DD.MM} · אחרי האישור ייווצר קישור הצטרפות חד-פעמי (48 שעות) · אישור תשלום ויצירת קישור |
| אדמין, הצלחה | התשלום אושר. הקישור מוכן לשליחה · לקוחה חדשה · הקישור מחכה להצטרפות · ממתין למימוש · תקף עד {יום DD.MM · HH:MM} · לשימוש פעם אחת. פתיחה לא צורכת אותו · שליחה בוואטסאפ · העתקת הקישור · הקישור הועתק · להוספת תשלום נוסף |
| הצטרפות | יצירת החשבון שלך · {מוצר} · {סכום} ₪ · שם מלא · מספר טלפון · כתובת מייל · המייל ישמש לכניסה לאזור האישי · שם התינוק/ת · תאריך לידת התינוק/ת · + תינוק נוסף · הסרה · אלרגיות והעדפות תזונתיות · placeholder: למשל: אלרגיה לאגוזים, צמחונית, טבעונית, ללא גלוטן, לא אוהבת כוסברה · סיסמה · אישור סיסמה · קראתי ואני מסכימה למדיניות הפרטיות · יצירת החשבון |
| הצטרפות, מצבים | הקישור הזה כבר שימש ליצירת חשבון · כניסה לאזור האישי · פג: `LINK_EXPIRED` הקיים · התנגשות: טל תבדוק את הפרטים ותחזור אלייך |
| הצטרפות, שגיאות | `CONSENT_REQUIRED`: צריך לאשר את מדיניות הפרטיות כדי להמשיך · טלפון: מספר הטלפון לא נראה תקין · מייל: כתובת המייל לא נראית תקינה · תאריך לידה: תאריך הלידה לא יכול להיות בעתיד · `LINK_IN_USE`: הקישור הזה כבר בשימוש עם פרטים אחרים. טל תבדוק ותחזור אלייך · תשובת תמונות חסרה: צריך לבחור אחת מהתשובות · שדה חסר: `FIELD_REQUIRED` הקיים |
| `/me` | אישור רכישה: {מוצר} · {סכום} ₪ · נרכשה ב-{DD.MM} · הכניסות שלי · {n} זמינות · {n} משוריינות · בתוקף עד {DD.MM} |
| `/me/sessions` | המפגשים יופיעו כאן בקרוב |

**seed של `join-form.photo_consent` (תוכן, מילה במילה):** ‏`question` = שלוש השורות:
"במפגשים אני מצלמת תמונות כדי שיהיה למשתתפות הבראנץ׳ מזכרת מתוקה עם הקטנטנים." / "לפעמים אשמח לשתף רגעים מהמפגשים גם באתר וברשתות החברתיות." / "האם את מסכימה שאפרסם תמונות שלכם?" (מופרדות ב-`\n`, ומוצגות כשורות). ‏`yes_label` = "כן, בשמחה". ‏`no_label` = "מעדיפה שהתמונות שלנו ישארו פרטיות".

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
