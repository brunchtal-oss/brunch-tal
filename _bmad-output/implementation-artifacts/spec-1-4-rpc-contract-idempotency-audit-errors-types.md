---
title: '1.4 RPC contract: idempotency, audit, errors, types — חוזה RPC'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: '18ff29bd5c2f41afa7a9dd1077a73dfd073a180d'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין חוזה RPC משותף: אין idempotency (AD-5), יומן (AD-19), ‏`callRpc` (AD-17) ובדיקת grants. ‏`reset_begin`/`reset_complete` מ-1.1 בלי מפתח ובלי יומן.

**Approach:** מיגרציה אחת ל-idempotency, ליומן ולהחלפת שני ה-RPC של האיפוס, ובצד TS ‏`lib/rpc.ts`, קוד שגיאה, טיפוסים ובדיקות מסד.

## Boundaries & Constraints

**Always:** כללי AD-5 לכל פונקציה. ‏`private.*` החדשות בלי grant. ביומן אין סיסמה, טוקן, גיבוב טוקן, קישור או מייל. כשל לא נשמר. שינוי חתימה: `drop` ואז `create` באותה מיגרציה. בדיקות מסד רק עם העזרים של `support/db.ts`.

**Decisions:**
- `idempotent_begin(p_scope, p_rpc, p_key, p_request jsonb)` מחזיר `null` (להמשיך) או את התוצאה השמורה. ‏`request_hash` = ‏sha256 hex של `p_request::text`. מפתח או scope ריקים ← `INVALID_INPUT`. hash אחר ← `IDEMPOTENCY_KEY_REUSED`. ‏`idempotent_finish` שומר ומחזיר את התוצאה.
- `audit_diff(p_old jsonb, p_new jsonb, p_table text)` מחזיר `{before, after}` רק לעמודות שהשתנו. מוסתרות ל-`"<changed>"`: ‏`profiles.full_name`, ‏`phone_e164`, ‏`dietary_notes`, ‏`pending_email`, כל `babies`, ‏`bookings.guest_details`, וכל עמודה `email`, ‏`*_email`, ‏`token_hash`, ‏`input_hash`.
- `public.audit_log`: קריאה לאדמין בלבד, אין כתיבה לאף תפקיד. כותבים רק ב-`private.audit`, שמקבלת actor כפרמטר.
- `reset_complete(p_token, p_idempotency_key)`: ‏scope ‏`token:<id>`, ‏request ‏`{}` (הטוקן לא ב-hash). צריכה אמיתית נרשמת ביומן. actor = ‏`bound_user_id`, ‏`admin` אם הוא ב-`admin_roles`, אחרת `customer`.
- `reset_begin(p_token, p_idempotency_key)` רק בודק ולא שומר תוצאה. טוקן `consumed` שנצרך באותו מפתח (יש שורת `reset_complete` לאותו scope ומפתח) מחזיר `already_completed: true` במקום `LINK_USED`. כך ניסיון חוזר אחרי תשובה שאבדה מצליח, וקישור שבוטל או פג נשאר סגור.
- מפתח האיפוס נוצר בשרת בכל טעינה של `/reset/[token]` (‏`randomUUID`) ונשלח כשדה נסתר בכל ניסיון.
- `callRpc(client, name, args)` מקבל את הלקוח כפרמטר, כי יש שלושה לקוחות.

**Never:** idempotency ל-`issue_reset_token` (מוחלף ב-2.8), ניקוי `idempotency_results`, מסך יומן (E4), FK ל-`events`, משתמשות Auth בדויות בבדיקות.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| קריאה כפולה | אותו scope, ‏rpc, מפתח ו-request | אותה תוצאה |
| מפתח עם קלט אחר | request שונה | `IDEMPOTENCY_KEY_REUSED` |
| כשל | exception אחרי `idempotent_begin` | אין שורה, ניסיון חוזר רץ מחדש |
| יומן עם שם | `full_name` השתנה | `"<changed>"`, השם לא בשורה |
| עמודה שלא השתנתה | ‏old = new | לא ב-diff |
| איפוס מלא | begin ← complete עם מפתח K | ‏`consumed`, שורת יומן אחת בלי טוקן וגיבוב |
| complete חוזר | K | אותה תוצאה, בלי שורת יומן נוספת |
| begin אחרי צריכה | K / מפתח אחר | ‏`already_completed: true` / ‏`LINK_USED` |
| קישור שבוטל | begin עם K ישן | `LINK_EXPIRED` |
| grant לא מכוון | `grant select on audit_log to anon` בעסקה | ההשוואה נכשלת |
| לקוחה אחרת | לקוחה A מחוברת | רק הפרופיל שלה, אף שורת יומן |
| אדמין | עם `admin_roles` | רואה את היומן |
| שגיאה ב-TS | ‏P0001 מוכר / לא מוכר / רשת | ‏`{ok:false, code}` / ‏`SERVER_ERROR` / ‏`SERVER_ERROR` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- ה-RPC הנוכחיים, ‏`find_token`, ‏`reset_target_valid`, סגנון ו-grants. לא לערוך.
- `supabase/migrations/20260929154813_revoke_default_privileges.sql` -- מה ש-`grants.test.ts` בודק ב-`pg_default_acl`.
- `lib/errors.ts` -- ‏`codeFromPostgrestError` לשימוש ב-`callRpc`.
- `lib/server/privileged/reset.ts`, ‏`app/(auth)/reset/[token]/{page,reset-form,actions}.tsx?` וה-tests שלהם -- הטוקן כבר עובר כשדה נסתר. המפתח באותה דרך.
- `supabase/tests/support/db.ts` -- חסר `asServiceRole` (claims עם `role: service_role`).
- לקוחות Supabase כבר עם `Database`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_create_rpc_contract.sql` -- ‏`private.idempotency_results` (PK ‏`(actor_scope, rpc, key)`, ‏RLS, בלי grant), ‏`idempotent_begin`/`finish`, ‏`public.audit_log` (עמודות AD-19, checks, אינדקסים ל-`created_at`, ‏`customer_id`, ‏`event_id`, ‏`(entity_type, entity_id)`, ‏policy ‏`audit_log_authenticated_select`), ‏`audit`, ‏`audit_diff`, ו-drop/create לשני ה-RPC. אחריה advisor וטיפוסים.
- [x] `lib/supabase/database.types.ts` -- מחדש.
- [x] `lib/errors.ts` -- `IDEMPOTENCY_KEY_REUSED`.
- [x] `lib/rpc.ts` + test -- ‏`server-only`, מוקלד לפי `Database["public"]["Functions"]`, לוג של קוד בלבד.
- [x] האיפוס (`reset.ts`, הדף, הטופס, ה-action וה-tests) -- מפתח מהשרת, uuid לא תקין ב-action ← `LINK_EXPIRED`, ‏`already_completed` ממשיך לעדכון הסיסמה.
- [x] `supabase/tests/support/db.ts` -- `asServiceRole(db)`.
- [x] `supabase/tests/{idempotency,audit,reset,rls,grants}.test.ts` -- המטריצה.

**Acceptance Criteria:**
- Given ‏`grants.test.ts`, then הוא משווה רשימה מפורשת של grants ל-`anon`, ‏`authenticated`, ‏`service_role` ו-PUBLIC על טבלאות, sequences, עמודות, פונקציות ו-schema ‏`private` (ACL ריק = `acldefault`), ונכשל גם על פונקציה עם grant ל-`anon` או לשני תפקידים, על שתי פונקציות באותו שם, ועל `pg_default_acl` שנותן לתפקידים האלה.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏`npm test`, ‏lint, ‏typecheck ו-build עוברים.
- Given המיגרציה הוחלה, then ‏get_advisors בלי WARN או ERROR חדשים חוץ מ-`0029`.

## Implementation Notes

- מיגרציות: `20260930191525_create_rpc_contract.sql`, ואחרי הביקורת `20260930193304_fix_reset_begin_and_audit.sql` (`create or replace` ל-`reset_begin` ול-`private.audit`), כי קובץ שהוחל לא נערך.
- `private.audit` מקבלת את השורה הישנה והחדשה (`p_old`, ‏`p_new`) ובונה את ה-diff בעצמה, כך שאי אפשר לכתוב ליומן בלי הסתרה. היא דוחה `entity_type` שאינו טבלה ב-`public` (`INVALID_INPUT`). ‏`before`/`after` הם `{}` ולא null.
- `phone_e164`, ‏`dietary_notes`, ‏`pending_email` מוסתרים בכל טבלה, לא רק ב-`profiles`.
- `reset_complete` עם מפתח אחר על קישור שנצרך ← `LINK_USED` (ב-1.1 הוחזרה הצלחה עם `already_consumed`). ‏`reset_begin` כבר דוחה את המקרה הזה, כך שהאפליקציה לא מגיעה אליו.
- `callRpc` כותב `console.error` רק ל-`SERVER_ERROR`. ‏`require-customer.ts` עבר ל-`callRpc`. ‏`scripts/dev-reset-link.mjs` עדיין קורא ל-`rpc` ישירות (סקריפט).
- `support/db.ts`: ‏`asServiceRole` ו-`queryError` (שגיאה בתוך savepoint).
- בדיקת `pg_default_acl` מוגבלת ל-`defaclrole = postgres`. ל-`supabase_admin` יש ברירות מחדל משלו ב-`public`, שלא חלות על המיגרציות שלנו.
- המיגרציה הוחלה על מסד הפיתוח. עד המיזוג, האתר הפרוס (שמחובר לאותו מסד) קורא לחתימה הישנה של האיפוס, ולכן קישור איפוס לא יעבוד בו.
- get_advisors: אין ממצא חדש (נשאר WARN של Auth ‏`auth_leaked_password_protection`, לא קשור). ‏`npm run test:db` ‏120, ‏`npm test` ‏262, ‏lint, ‏typecheck ו-build עוברים.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. ‏medium 2, ‏low 17, ‏false 3, ‏maybe-false 1. ‏patch 9, ‏defer 2, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | ענף `already_completed` ב-`reset_begin` בלי בדיקת תוקף ויעד: קישור שנצרך + מפתח הדף משנים סיסמה בלי הגבלת זמן | medium | אומת במיגרציה. סותר "קישור שבוטל או פג נשאר סגור" | patch: מיגרציה חדשה |
| 2 | `entity_type` חופשי: שם טבלה שגוי עוקף את ההסתרה | medium | אומת: `audit_diff` מסתיר לפי שם מדויק | patch: `private.audit` דוחה טבלה לא קיימת |
| 3 | אין בדיקה לפקיעת תוקף, ליעד לא תקין ול-complete אחרי פקיעה | low | אומת: אין `expires_at` בבדיקות (verification-gap) | patch |
| 4 | שם השדה הנסתר של המפתח לא נבדק מול ה-action | low | אומת (verification-gap) | patch |
| 5 | ענף `acldefault` ל-ACL ריק לא מופעל, ושם בדיקה לא תואם | low | אומת (verification-gap) | patch |
| 6 | הבדיקה "API roles cannot call private.audit" נכשלת על ה-schema | low | אומת: ל-`service_role` אין usage על `private` | patch |
| 7 | `callRpc` רושם שגיאה על כל קוד עסקי | low | אומת | patch: לוג רק ל-`SERVER_ERROR` |
| 8 | `asServiceRole` משאיר `claim.sub` קודם | low | אומת | patch |
| 9 | `require-customer.ts` קורא ל-`rpc` ישירות (AD-17) | low | אומת | patch |
| 10 | אין בדיקת מקביליות לשני חיבורים עם אותו מפתח | low | אמיתי. דורש בדיקה עם commit וניקוי | defer |
| 11 | אין כלל lint שמחייב `callRpc` | low | אמיתי | defer |
| 12 | רענון הדף יוצר מפתח חדש ← `LINK_USED` אחרי שהסיסמה כבר הוחלפה | low | החלטה מאושרת (מפתח לכל טעינה). ההודעה מציעה התחברות | reject |
| 13 | דף ישן בלי מפתח בזמן פריסה ← "תוקף הקישור פג" | low | חולף ונדיר | reject |
| 14 | הסתרה כרשימה שחורה | low | הכלל של AD-19 | reject |
| 15 | FK של `customer_id` חוסם מחיקת פרופיל | false | פרופיל לא נמחק, רק מסומן `anonymized_at` (AD-19) | reject |
| 16 | בדיקת ACL של schema רק ל-`private` | low | לפי ה-AC | reject |
| 17 | אין בדיקות טיפוס ל-`callRpc`, ‏`as BeginResult` בלי בדיקה | low | ‏typecheck אוכף בקריאה. ה-RPC תמיד מחזיר אובייקט | reject |
| 18 | `reset_begin` קורא ישירות מ-`idempotency_results` | low | מכוסה בבדיקת `already_completed` | reject |
| 19 | מפתח לא uuid ← `SERVER_ERROR` | low | המפתח נוצר בשרת ונבדק ב-action | reject |
| 20 | Spec לא מעודכן | false | מתעדכן בשלב ההצגה | reject |
| 21 | טוקן שנעלם בין החיפוש לנעילה | false | טוקנים לא נמחקים | reject |
| 22 | קלט שאינו אובייקט ל-`audit_diff` | low | הקוראים מעבירים `to_jsonb(row)` | reject |
| 23 | grant כפול משני grantors | maybe-false | לא נצפה במסד. אם קורה, הבדיקה נכשלת בקול | reject |
| 24 | `pg_default_acl` נבדק רק ל-`postgres` | low | המיגרציות רצות כ-`postgres` | reject |
| 25 | intent-alignment: הזרימה המלאה TS ← PostgREST ← RPC לא נבדקת אוטומטית, ו-`test:db` לא ב-CI | low | לפי התכנון (AGENTS.md). בדיקה ידנית בטלפון | reject |

## Design Notes

```sql
-- inside an RPC, right after the permission check
v_prev := private.idempotent_begin(v_scope, 'reset_complete', p_idempotency_key, '{}'::jsonb);
if v_prev is not null then return v_prev; end if;
-- ... lock, change, private.audit(...) ...
return private.idempotent_finish(v_scope, 'reset_complete', p_idempotency_key, v_result);
```

- `idempotent_begin`: ‏`insert … on conflict do nothing`, כך שקריאה מקבילה ממתינה לראשונה. אחר כך קוראים את השורה: hash שונה ← `IDEMPOTENCY_KEY_REUSED`, ‏`result` מלא ← מחזירים. שורה בלי תוצאה לא אמורה לקרות ← שגיאה פנימית (לא P0001).
- את הטוקן ל-scope מוצאים בלי נעילה (`find_token(p_token, false)`), ונועלים רק אחרי `idempotent_begin`.
- `grants.test.ts` בונה את הרשימה מ-`aclexplode(coalesce(relacl|proacl, acldefault(...)))` ב-`public` וב-`private`, בלי אובייקטים של הרחבות. בדיקת ה-grant הלא מכוון מוסיפה grant ב-`inRollback` ומריצה את אותה השוואה.
- כללי `supabase-postgres-best-practices`: ‏`security-privileges`, ‏`security-rls-performance`, ‏`schema-foreign-key-indexes`.

## Verification

**Commands:**
- `npm run test:db`, ‏`npm test`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run build` -- עוברים.
- `grep -P '[^\x00-\x7F]' supabase/migrations/<ts>_create_rpc_contract.sql supabase/tests/*.ts` -- פלט ריק.
