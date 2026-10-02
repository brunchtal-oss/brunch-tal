---
title: '2.3 Existing account and identity conflicts — חשבון קיים והתנגשויות'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: '34c9a38030630b626eacb17b5eabd7b7de25d9d4'
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

**Problem:** ‏`join_begin` שולח כל התאמה במייל או בטלפון ל-`conflict` (`identity_match`). לקוחה עם חשבון לא יכולה לקבל את הרכישה, ואין `find_identity` או `claim_join`.

**Approach:** מיגרציה אחת: ‏`private.find_identity`, פיצול ב-`join_begin` (חשבון אחד ← `awaiting_login`; שניים או לא מופעל ← `conflict`), ‏`claim_join` ו-`token_view` עם `awaiting_login`. ב-`/join/[token]`: הפניה ל-`/login?next=/join/<token>`, ואחרי ההתחברות מסך אישור שקורא ל-`claim_join`.

## Boundaries & Constraints

**Always:** AD-3, ‏AD-5, ‏AD-6 (טוקן ← `profiles` ← …), ‏AD-10, ‏AD-19. הודעה לא אומרת אם חשבון, מייל או טלפון קיימים, ולא באיזה שדה הייתה התאמה; גם תוצאת ה-RPC לא. אף 23505 גולמי לא יוצא מ-`join_complete` או מ-`claim_join`. לוג רק עם מזהים וקודים. עברית רק ב-`lib/copy/*` וב-`lib/errors.ts`.

**Decisions (החלטות המשתמשת 2026-10-02 מסומנות *):**
- **`private.find_identity(p_email, p_phone) returns jsonb`** (בלי grant, כל פרמטר יכול להיות null): ‏`lower(btrim())` ו-`normalize_phone`, ואיחוד מזהים מ-`auth.users.email`, ‏`profiles.pending_email` ו-`profiles.phone_e164`. ‏0 ← `{match: none}`; יותר מ-1 ← `{match: conflict, reason: two_accounts}`; אחד עם פרופיל מופעל ולא מוסר ← `{match: account, customer_id}`; אחרת (מיובא, משתמשת Auth בלי פרופיל, אדמין) ← `{match: conflict, reason: not_activated}`.
- **`profiles.pending_email`** (*3א; null, ‏`= lower(btrim())`, ייחודי, רק כש-`activated_at is null`). היבוא ממלא אותו.
- **`activation_tokens`:** ‏check ל-`conflict_reason` ‏(`two_accounts`, ‏`not_activated`, ‏`phone_taken`, ‏`bind_conflict`), ‏`(state = 'conflict') = (conflict_reason is not null)`, ו-`awaiting_login` ⇐ `bound_user_id`. לפני ה-check: שורת `identity_match` בלי `pending_user_id` חוזרת ל-`pending` (במסד הפיתוח יש 0 כאלה, 2026-10-02).
- **`join_begin`:** ‏`pending` ← `find_identity`: ‏none ← claiming (כמו היום); ‏account ← `awaiting_login`, ‏`bound_user_id`, ‏`input_hash`, ‏`{outcome: existing_account, token_id}`; ‏conflict ← עם ה-reason. ‏`awaiting_login` עם אותו hash ← אותה תוצאה (גם במפתח אחר), אחר ← `LINK_IN_USE`; פג ← `LINK_EXPIRED`.
- **`token_view`:** ‏`awaiting_login` שלא פג ← `state_public = awaiting_login`, עם המוצר והסכום.
- **`claim_join(p_token, p_idempotency_key)`** (authenticated, scope ‏`auth.uid()`, ה-hash בלי הטוקן הגולמי): בלי `current_customer_id()`, טוקן לא נמצא, לא join, לא `awaiting_login`, ‏`bound_user_id` אחר או פג ← `NOT_AUTHORIZED` בלי detail. נועל טוקן ← `bind_purchase` בתת-בלוק; ‏`BIND_CONFLICT` או 23505 ← טוקן `conflict` ‏(`bind_conflict`), ‏`{outcome: conflict}`. אחרת `consumed` עם `customer_id` ויומן (`customer`), ‏`{outcome: claimed, payment_id}`.
- **`join_complete`:** כל 23505 בתת-הבלוק ← conflict (`phone_taken` לטלפון, אחרת `bind_conflict`).
- **משתמשת Auth יתומה** (deferred מ-2.2, *1א): כש-`join_complete` מחזיר conflict, ‏`join.ts` מוחק את `pending_user_id` ב-`auth.admin.deleteUser` (כשל ← לוג עם `tokenId` וקוד בלבד, התוצאה ללקוחה לא משתנה). ‏`find_identity` מסווגת יתומה שנשארה `not_activated`.
- **`/join/[token]`:** ‏`awaiting_login` בלי לקוחה מחוברת ← מסך "יש חשבון" עם כפתור ל-`/login?next=/join/<token>`; עם לקוחה מחוברת ← מסך אישור: מוצר, סכום וכפתור ← `claimJoinAction` ← `/me` (*2א: פתיחה ונחיתה אחרי התחברות לא משייכות). ‏`NOT_AUTHORIZED` ← קריאה חוזרת של המצב: מומש/פג כרגיל, אחרת "חשבון אחר" עם התנתקות שחוזרת ל-`/login?next=/join/<token>`. שליחת הטופס שמחזירה `existing_account` ← `redirect` לאותו נתיב. במסכי החשבון הקיים (יש חשבון, אישור, חשבון אחר) אין כותרת עמוד (*).
- **`/login`:** ‏`Referrer-Policy: no-referrer` ובלי לוג בקשה כש-`next` הוא `/join/…`. ‏`safeNext` כבר מתיר `/join/<token>` ודוחה יעד חיצוני.
- **התנגשות (*):** כל מסך התנגשות ו-`BIND_CONFLICT` מציגים "צרי קשר לפרטים נוספים" (מחליף את נוסח 2.2), וגם `LINK_IN_USE`.
- **סתירה במקור (*):** §4 מפנה להתחברות בהתאמה, ו-§10/§11 אוסרים לחשוף טלפון קיים. אושר: בלי שם השדה, בדיקה אחת לקישור (`LINK_IN_USE`), הקישור נשלח רק ללקוחה ששילמה.
- **סבב 2, אחרי הבדיקה בטלפון (המשתמשת, 2026-10-02):**
  - **`two_accounts` עם ניסיון חוזר:** עמודה `activation_tokens.identity_attempts int not null default 0` (check ‏0–3). ב-`pending`, ‏`two_accounts` מעלה אותה באחד; עד 2 הקישור נשאר `pending` ו-`join_begin` מחזיר `{outcome: identity_retry, token_id}`; בניסיון השלישי ← `conflict` ‏(`two_accounts`). קלט אחר בניסיון חוזר נבדק מחדש (`find_identity`). הפעולה מחזירה מפתח idempotency חדש אחרי `identity_retry`, והטופס שולח אותו בניסיון הבא (המפתח הקודם שמור עם ה-hash הקודם).
  - **סיבה ללקוחה:** תוצאת conflict של `join_begin` ו-`join_complete` כוללת `reason`, ו-`token_view` מחזיר `conflict_reason` לקישור join במצב conflict, כך שגם פתיחה מאוחרת מציגה את הנוסח של הסיבה. ‏`email_exists` ב-Auth (שלב 2) מוצג כמו `phone_taken`.
  - **וואטסאפ:** בכל נוסח שמסתיים ב"צרי קשר לפרטים נוספים" (מסכי `/join` ו-claim) הביטוי הוא קישור ל-`https://wa.me/972…` מ-`contact › business_details.whatsapp_phone` (תוכן מפורסם, עזר קריאה חדש ב-`lib/content/`, מספר מנורמל לפורמט בינלאומי). בלי תוכן מפורסם: טקסט רגיל.
- **גבולות:** ‏2.4: קישור חלופי, ‏`/admin/links`, ‏claiming תקוע, תיקון קלט אחרי כשל ב-Auth (כולל `email_exists`), ומי שלא מצליחה להתחבר לחשבון הקיים. ‏"לטיפול" נגזר ממצבים (AD-22) ונבנה עם בית האדמין. בדיקות היכרות בשיוך ב-3.11, המתנה ב-5.6.

**Never:** מיזוג חשבונות, יצירת משתמשת Auth במסלול `awaiting_login`, שיוך לפי טלפון בלבד, צריכת הקישור בפתיחה או בהתחברות בלי לחיצה, ‏`bound_user_id` או שם השדה בתשובה ללקוחה, grant לעזרי `private`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| מייל קיים | מייל של לקוחה A (אותיות גדולות, רווחים) | `existing_account`, ‏`awaiting_login`, ‏`bound_user_id = A`; אין משתמשת Auth חדשה; תשלום וזכות לא משויכים |
| טלפון בלבד | טלפון של A ‏(`05…` מול `+972…`), מייל חדש | כמו מייל קיים; ‏`join_complete` ← `LINK_EXPIRED`, לא משויך |
| שני חשבונות | מייל של A, טלפון של B | ‏conflict ‏`two_accounts`, כלום לא נוצר |
| לא מופעל | ‏`pending_email` / טלפון של פרופיל לא מופעל / משתמשת Auth בלי פרופיל | ‏conflict ‏`not_activated` |
| שיוך | A מחוברת, ‏`claim_join` | ‏claimed, ‏`customer_id = A` בתשלום ובזכות, consumed, התראה אחת; אותו מפתח ← אותה תוצאה |
| לא מורשה | לקוחה B / אדמין / פג / pending / מפתח חדש אחרי consumed / reset | `NOT_AUTHORIZED`, כלום לא השתנה; ‏anon ← 42501 |
| התנגשות בשיוך | תשלום כבר משויך | ‏`{outcome: conflict}`, טוקן ‏`bind_conflict`, בלי 23505 |
| כניסה חוזרת | ‏awaiting_login, אותו קלט / קלט אחר | ‏`existing_account` / `LINK_IN_USE` |
| שני חשבונות, ניסיון חוזר | ‏`two_accounts` פעם 1, 2 / 3 / אחרי הנעילה | ‏`identity_retry`, ‏`pending`, ‏`identity_attempts` 1, 2 / ‏conflict ‏`two_accounts` / ‏conflict |
| תיקון אחרי ניסיון | ‏`identity_retry`, אחר כך קלט שלא מתנגש | ‏claiming (או `existing_account`) כרגיל |
| סיבה בתצוגה | קישור conflict | ‏`token_view.conflict_reason` = הסיבה השמורה |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001195103_create_join_flow.sql` -- ‏`join_begin` (366), ‏`join_complete` (518), ‏`bind_purchase` (277), ‏`join_identity`, ‏`token_view` (185). מחליפים ב-`create or replace` (אותן חתימות). לא עורכים קובץ שהוחל.
- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- ‏`activation_tokens` (בלי check ל-`conflict_reason`), ‏`profiles`, ‏`find_token`. ‏`private.audit_diff` כבר מסתיר `pending_email`.
- `lib/server/privileged/join.ts` -- ‏`getJoinTokenView`, ‏`submitJoin`, ‏`BeginResult`; ‏`join.test.ts` (client מדומה).
- `app/(auth)/join/[token]/{page,actions,join-form,join-view}.tsx` -- המצבים; ‏`lib/auth/join-link-state.ts`.
- `app/(auth)/login/*`, ‏`lib/auth/{safe-next,destination,sign-out}.ts`, ‏`components/shared/sign-out-button.tsx` -- ‏`next` כבר עובר בטופס; ‏`signOutAction` מקבל `next` אופציונלי (עובר `safeNext`).
- `next.config.mjs` (+ `next.config.test.ts`) -- כותרות ו-`logging.incomingRequests.ignore`.
- `lib/copy/join.ts`, ‏`lib/errors.ts` (‏`NOT_AUTHORIZED`, ‏`LINK_IN_USE`, ‏`BIND_CONFLICT` קיימים).
- `supabase/tests/{join,grants,session-role-and-token-view,bind-purchase}.test.ts`, ‏`support/{db,money}.ts` (‏`insertAuthUser`, ‏`seedMoney().customerA`, ‏`approve`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_existing_account_and_conflicts.sql` -- **סשן ראשי:** ‏`npx supabase migration new`, ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types` ← `lib/supabase/database.types.ts`.
- [x] `lib/server/privileged/join.ts` + `join.test.ts` -- ‏`existing_account`, ‏`awaiting_login` ב-view, ותשובה ל-Open Question 1.
- [x] `app/(auth)/join/[token]/*` + בדיקות -- מתחילים בסקיל `frontend-design` (AGENTS.md), בתוך DESIGN.md ו-EXPERIENCE.md. המסכים, ‏`claimJoinAction` (לקוח `createClient`, מפתח לכל טעינה), מיפוי התוצאות.
- [x] `lib/auth/sign-out.ts`, ‏`next.config.mjs` + בדיקות -- ‏`next` בהתנתקות; כותרות ולוג של `/login`.
- [x] `lib/copy/join.ts` -- הנוסחים המאושרים.
- [x] **סבב 2:** מיגרציה חדשה (`identity_attempts`, ‏`join_begin`, ‏`join_complete` עם `reason`, ‏`token_view` עם `conflict_reason`; סשן ראשי מחיל); ‏`join.ts`, ‏`actions.ts`, ‏`join-form.tsx`, ‏`claim-join.tsx` (מתחילים בסקיל `frontend-design`), עזר `business_details` ב-`lib/content/`, ‏`lib/copy/join.ts`, ‏`lib/errors.ts`; בדיקות יחידה ובדיקות מסד לשורות החדשות במטריצה.
- [x] `supabase/tests/existing-account.test.ts` -- המטריצה ו-`find_identity` (כבעלים); ‏`join.test.ts` (הבדיקה של `identity_match`), ‏`grants.test.ts`, ‏`session-role-and-token-view.test.ts`, ובדיקת ה-checks החדשים.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 (כולל `claim_join`) ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר, כולל `bind-purchase.test.ts`, ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון, when קישור חדש ממולא עם המייל של לקוחה קיימת, then מסך התחברות, ואחרי התחברות ולחיצה הרכישה ב-`/me` של אותו חשבון, ואין משתמשת Auth שנייה.

## Implementation Notes

- קובץ המיגרציה כבר נוצר בסשן הראשי: `supabase/migrations/20261002181416_existing_account_and_conflicts.sql` (ריק). כותבים אליו בלבד. הסשן הראשי מחיל אותו, מריץ advisor, יוצר את הטיפוסים ומריץ `npm run test:db`; עד אז אפשר לעדכן את `database.types.ts` ידנית לפי החתימות.
- המיגרציה `20261002181416_existing_account_and_conflicts.sql` הוחלה ב-`apply_migration` מהסשן הראשי. ה-advisor: רק 0029 (‏`admin_approve_payment`, ‏`preview_admin_approve_payment`, ‏`claim_join`) ו-`auth_leaked_password_protection`. ‏`database.types.ts` זהה לפלט של `generate_typescript_types`.
- ‏`find_identity` מסווגת גם אדמין ופרופיל שהוסר כ-`not_activated`. ‏`claim_join` שומר בגיבוב הבקשה את `token_id`.
- ‏`signOutAction` מקבל `next` אופציונלי (אדמין מתעלמת). ‏`/login` עם `next=/join/…`: ‏`no-referrer`, ‏`no-store` ובלי לוג.
- הסקיל `frontend-design` הופעל לפני המסכים; המסכים בנויים מהרכיבים הקיימים.
- תיקוני הביקורת: ‏`existingAccountScreen(role)` (בלי session ← התחברות, לקוחה ← אישור, אדמין או בלי פרופיל ← "חשבון אחר" עם התנתקות); ‏`claimJoinAction` אחרי `NOT_AUTHORIZED`: ‏active ← חזרה לטופס, ‏awaiting_login בלי session ← התחברות.
- תוצאות: ‏`npm test` ‏552/552, ‏`npm run test:db` ‏290/290, ‏lint, ‏format:check, ‏typecheck ו-build עוברים.
- סבב 2 (אחרי הבדיקה בטלפון, 2026-10-02): מיגרציה `20261002194018_identity_retry_and_conflict_reasons.sql` הוחלה מהסשן הראשי; ה-advisor ללא שינוי; הטיפוסים תואמים. ‏`identity_attempts` עם עד 3 ניסיונות ב-`two_accounts`, ‏`reason` בתוצאות ה-conflict ו-`conflict_reason` ב-`token_view`, נוסח לכל סיבה, ו"צרי קשר לפרטים נוספים" כקישור לוואטסאפ (`lib/content/whatsapp.ts`, ‏`business-details.ts`, ‏`contact-text.tsx`). ממצא 5 בטבלת הביקורת (כפתור וואטסאפ) נבנה כאן והרשומה שלו הוסרה מ-deferred-work. תוצאות: ‏`npm test` ‏595/595, ‏`npm run test:db` ‏297/297, ‏lint, ‏format:check, ‏typecheck ו-build עוברים.
- תיקון מהבדיקה בטלפון: לקוחה שמחוברת לחשבון אחר ראתה את מסך האישור ורק הלחיצה סירבה (ממצא D2 של intent-alignment ו-blind-hunter, שנדחה בסבב 1 בטעות). מיגרציה `20261002200634_token_view_bound_user.sql` (הוחלה, ה-advisor ללא שינוי): ‏`token_view` מחזיר `bound_user_id` לקישור `awaiting_login` (שרת בלבד), והדף מציג אישור רק כש-`claims.sub` שווה לו; אחרת "חשבון אחר" מיד. תוצאות סופיות: ‏`npm test` ‏600/600, ‏`npm run test:db` ‏299/299, ‏lint, ‏format:check, ‏typecheck ו-build עוברים.
- אזהרת התשלום הכפול (טווח שבוע שנערך בהגדרות) נרשמה בכרטיס 2.5, ב-`admin-configurable-parameters.md` וב-memlog של ה-SPEC.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 2, low 5, false 4. patch 4, defer 3, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | session של אדמין או בלי פרופיל על קישור `awaiting_login` נתקעת: "להתחברות" שולח אדמין ל-`/admin` | medium | ‏`customerSignedIn` ← false, ‏`loginPageOutcome` לאדמין | patch: ‏`existingAccountScreen(role)` ב-join-view (בלי session ← התחברות, לקוחה ← אישור, אחר ← "חשבון אחר" עם התנתקות) + בדיקות |
| 2 | ‏`NOT_AUTHORIZED` על קישור `active`, או אחרי שה-session פגה, מוצג "חשבון אחר" | medium | ‏`claimJoinAction` ממפה כל מצב אחר ל-`other_account` | patch: ‏active ← `redirect` לקישור; ‏awaiting_login בלי session ← התחברות + בדיקות |
| 3 | ‏`/login?next=/join/…` בלי `no-store`, והטוקן ב-input נסתר | low | הכלל החדש מוסיף רק Referrer-Policy | patch: ‏`noStore` באותו כלל + בדיקה |
| 4 | חריגת האדמין ב-`find_identity` לא נבדקת (לאדמין ב-fixture אין פרופיל) | low | verification-gap | patch: אדמין עם פרופיל מופעל ← `not_activated` ב-`find_identity` וב-`join_begin` |
| 5 | מסכי "צרי קשר" בלי כפתור וואטסאפ | low | אין ערוץ פנייה בדף | defer ל-2.4 |
| 6 | קישור `awaiting_login` לחשבון שגוי (הקלדה) נתקע עד התפוגה | low | החלטה ב-spec (בדיקה אחת לקישור) | defer ל-2.4 |
| 7 | לקוחה שהוסרה בזמן `awaiting_login`: קישור תקוע | low | אין עדיין RPC להסרה | defer לסיפור הסרת הפרטים |

Reject (11): מחיקת משתמשת Auth עם פרופיל (`pending_user_id` חדש לכל קישור; פרופיל בו יכול להיווצר רק ב-`join_complete` של אותו קישור, שצורך אותו ולא מחזיר conflict); מיגרציה שנופלת על `identity_match` עם `pending_user_id` (2.2 לא יצר כזה, ופרודקשן חדש); ‏`data` ריק מ-`claim_join` (תמיד jsonb); לקוחה B רואה מסך אישור (החלטת spec, הסירוב בלחיצה); "כבר מומש" אחרי שיוך בלשונית אחרת (נדיר, נוסח חדש דורש אישור); הפרטים שמולאו נזרקים בחשבון קיים (מהמקור, נוסח מאושר); ‏`lower(email)` בלי אינדקס (טבלה קטנה, דורש מיגרציה); אדמין ב-`not_activated` (החלטת spec); בדיקה לתיקון הנתונים במיגרציה (0 שורות, חד-פעמי); ה-spec לא מעודכן (מתעדכן בסוף השלב); שם המפתח `goToLogin` (קוסמטי).

## Design Notes

**נוסחים מאושרים (המשתמשת, 2026-10-02).** ‏`{x}` = ערך. אין כותרת עמוד במסכי החשבון הקיים.

| מסך | נוסח |
|---|---|
| חשבון קיים, לא מחוברת | יש להתחבר לחשבון · כפתור: להתחברות |
| אישור (לקוחה מחוברת) | {מוצר} · {סכום} ₪ · הרכישה תתווסף לחשבונך · כפתור: הוספת הרכישה לחשבון שלי · בזמן שליחה: מוסיפה… |
| חשבון אחר (`NOT_AUTHORIZED` אחרי הלחיצה) | אי אפשר להוסיף את הרכישה לחשבון שמחובר עכשיו. צריך להתנתק ולהתחבר לחשבון שלך · כפתור "התנתקות" הקיים (`shellCopy.signOut`) |
| ~~התנגשות, `BIND_CONFLICT`, `LINK_IN_USE`: צרי קשר לפרטים נוספים~~ | הוחלף בסבב 2 (למטה) |

**נוסחים מאושרים, סבב 2 (המשתמשת, 2026-10-02, אחרי הבדיקה בטלפון).** הביטוי "צרי קשר לפרטים נוספים" הוא קישור לוואטסאפ של טל.

| מצב | נוסח |
|---|---|
| חשבון קיים (`existing_account`, מייל או טלפון) | הפרטים קיימים במערכת. יש להתחבר לחשבון |
| `two_accounts`, ניסיון 1–2 (`identity_retry`) | לא הצלחנו להשלים את ההרשמה. בדקי שכתובת המייל ומספר הטלפון שהזנת נכונים ונסי שוב או צרי קשר לפרטים נוספים |
| `two_accounts` אחרי הנעילה (ניסיון 3 ואילך) | יותר מדי נסיונות. הלינק ננעל. צרי קשר לפרטים נוספים. |
| `not_activated` | החשבון לא פעיל. צרי קשר לפרטים נוספים. |
| `phone_taken`, ‏`email_exists` | הפרטים קיימים במערכת. צרי קשר לפרטים נוספים |
| `bind_conflict`, ‏`BIND_CONFLICT` | לא ניתן להוסיף את הרכישה לחשבון. צרי קשר לפרטים נוספים |
| `LINK_IN_USE` | הלינק מומש. צרי קשר לפרטים נוספים |

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
