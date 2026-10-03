---
title: '2.4 Link lifecycle and mid-join recovery — חיי הקישור והתאוששות מתקלה'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: '367257e4d3bd4ea444b323fb48fafdbe32981c77'
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

**Problem:** טל לא יכולה לבטל קישור הצטרפות או להפיק חלופי, ואין מסך סטטוסים. ‏`claiming` ו-`awaiting_login` נעולים לקלט הראשון (שתי רשומות deferred), אין זמן תחילה ל-`claiming`, וכרטיסייה שפגה עד השיוך נעלמת מ-`/me`.

**Approach:** מיגרציה אחת: ‏`admin_issue_link`, ‏`admin_revoke_link`, ‏`admin_list_links`, ‏`claiming_at`, ‏`entitlements.bound_at`, תיקון קלט ב-`join_begin`. מסך `/admin/links`, וואטסאפ במסך "פג", "חזרה לטופס", והודעת תוקף ב-`/me`.

## Boundaries & Constraints

**Always:** AD-3, ‏AD-5, ‏AD-6, ‏AD-10, ‏AD-19, ‏AD-21. הטוקן הגולמי רק בתשובה שהנפיקה אותו (`idempotent_finish` ויומן בלעדיו, `reissue_required`). פתיחה, `token_view` ו-`admin_list_links` לא משנים מצב. הודעה ללקוחה לא חושפת חשבון, שדה או `bound_user_id`. עברית רק ב-`lib/copy/*` וב-`lib/errors.ts`, מ-Design Notes בלבד.

**Decisions (המשתמשת, 2026-10-02/03):**
- **`admin_issue_link(p_purpose, p_target_id, p_idempotency_key)`** (authenticated, אדמין): רק `join` (‏`p_target_id` = תשלום); אחר ← `INVALID_INPUT` עד 2.8. נועל את טוקני ה-join של התשלום לפי `id`. תשלום משויך או טוקן consumed ← `LINK_USED`; ‏`claiming` שה-`claiming_at` שלו לפני פחות מ-15 דקות ← `LINK_IN_PROGRESS` (קוד חדש). אחרת החי (pending גם פג, awaiting_login, conflict, claiming תקוע) ← `revoked`, ואז `issue_token`. מחזיר `{token_id, token, link_expires_at, revoked_pending_user_id}`.
- **`admin_revoke_link(p_token_id, p_idempotency_key)`**: אותם כללים, בלי הנפקה. הפעולה בשרת מוחקת משתמשת Auth של `claiming` שבוטל אם אין לה פרופיל (`deleteOrphanUser`).
- **`admin_list_links()`** (קריאה, פטור מ-idempotency): קישורי join מהחדש לישן: סטטוס מתוך ארבעה (pending/awaiting_login/claiming/conflict ← ממתין; consumed ← מומש; פג נגזר; revoked ← בוטל), פירוט (חשבון קיים עם שם, claiming תקוע, conflict עם סיבה), מוצר מה-snapshot, סכום, `paid_on`, זמנים, שם הלקוחה אחרי מימוש, ‏`can_revoke`/`can_replace`. הסטטוס בעזר `private` אחד, ש"לטיפול" (E4) ישתמש בו.
- **`claiming_at`** נקבע בכניסה ל-`claiming` (check: ‏claiming ⇐ מלא; שורות קיימות ← `created_at`).
- **תיקון קלט (deferred 1, 2):** ‏hash אחר במצב `claiming` או `awaiting_login`: פג ← `LINK_EXPIRED`; ‏`identity_attempts >= 2` ← ‏conflict ‏`too_many_attempts` (ערך חדש ב-check); ‏claiming עם משתמשת Auth ל-`pending_user_id` ← `{outcome: discard_pending_user, pending_user_id}` בלי שינוי מצב, ‏`join.ts` מוחק אותה וקורא שוב במפתח חדש; אחרת הקישור מתאפס ל-pending (מנקה `pending_user_id`, ‏`input_hash`, ‏`claiming_at`, ‏`bound_user_id`), ‏`identity_attempts + 1`, והמשך ענף pending. כך `email_exists` ניתן לתיקון. אותו hash: כמו היום (claiming ממשיך גם אחרי תפוגה).
- **"חזרה לטופס"** במסך "יש להתחבר לחשבון" (לפני התחברות) פותח את הטופס ריק.
- **`entitlements.bound_at`**: ‏`bind_purchase` קובע `now()`. ‏`entitlement_balances` מוסיף `expired_before_bound` = ‏`local_day_end(expires_on) < coalesce(bound_at, created_at)` (grant לפי עמודה אם צריך). ‏`/me` מציג גם זכות כזו, עם "תוקף הכרטיסייה פג" ו-toggletip (ראו Design Notes). מספר השבועות מחושב מימי התוקף ב-`eligibility_snapshot`, לא בקוד.
- **מסך פג/בוטל:** "צרי קשר עם טל" הוא קישור לוואטסאפ (`ContactText` עובר ל-`components/shared/`).
- **ביטול באדמין** עם אישור קצר (לא `sensitive-confirm-dialog`).
- **גבולות:** ‏2.8: ‏reset ב-`admin_issue_link`, ‏`/admin/customers/[id]`. ‏E4: "לטיפול". סיפור היבוא: ‏claim.

**Never:** העתקה מאוחרת של קישור, הארכת זכות בהצטרפות, מחיקת משתמשת Auth עם פרופיל, מחיקה מ-`auth.users` ב-SQL, grant לעזרי `private`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| חלופי | pending / פג / awaiting_login / conflict / claiming תקוע | הקודם `revoked`, חדש pending ל-48 שעות על אותו תשלום; תשלום וזכות ללא שינוי; הישן ← "פג" |
| חלופי, חוזר | אותו מפתח | אותה תוצאה בלי `token`, ‏`reissue_required` |
| נחסם | ‏consumed / משויך / claiming טרי | `LINK_USED` / `LINK_USED` / `LINK_IN_PROGRESS`, כלום לא השתנה |
| ביטול | אותם מצבים | `revoked`; חלופי אפשרי אחר כך |
| לא אדמין | לקוחה / anon | `NOT_AUTHORIZED` / 42501 |
| קישור שפג | ‏pending אחרי 48 שעות | expired, ‏`LINK_EXPIRED`; תשלום וזכות נשארים לא משויכים |
| תקלה באמצע | ‏claiming, משתמשת Auth קיימת, אותו קלט | אותו `pending_user_id`, ‏`join_complete` מצליח, משתמשת Auth אחת |
| תיקון ב-claiming | בלי / עם משתמשת Auth | איפוס ובדיקה מחדש / ‏`discard_pending_user`, מחיקה, איפוס; ‏`identity_attempts + 1` |
| תיקון ב-awaiting_login | קלט חדש | בדיקה מחדש, ‏`bound_user_id` מתנקה אם התוצאה לא account |
| ניסיון רביעי | ‏`identity_attempts = 2`, קלט חדש | ‏conflict ‏`too_many_attempts` |
| כרטיסייה ישנה | ‏`paid_on` לפני 50 ימים, הצטרפות | משויכת, ‏`expires_on` ללא שינוי, ‏`expired_before_bound`, מוצגת ב-`/me` |
| תצוגה | ‏`token_view` פעמיים, ‏`admin_list_links` | מצב, ‏`identity_attempts`, ‏`claiming_at` ללא שינוי |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261002194018_identity_retry_and_conflict_reasons.sql` -- ‏`join_begin` (87; ‏`idempotent_begin` לפני הנעילה ב-160, ‏LINK_IN_USE ב-156 וב-196, ענף pending ב-201), ‏`join_complete` (263). בסיס ל-`create or replace`.
- `supabase/migrations/20261002200634_token_view_bound_user.sql` -- ‏`token_view` (claiming ← active גם אחרי תפוגה; revoked ← expired).
- `supabase/migrations/20261001162630_create_money_schema.sql` -- ‏`private.issue_token` (299), ‏`activation_tokens_live_join_uidx` (290: חי אחד לתשלום, לכן revoke קודם).
- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- ‏`activation_tokens` (38), ‏`issue_reset_token` (237: דוגמה ל-revoke ואז issue).
- `supabase/migrations/20261001170905_restrict_customer_money_columns.sql` -- ‏`admin_approve_payment` (23): דפוס `reissue_required`.
- `supabase/migrations/20260930191525_create_rpc_contract.sql` -- ‏`idempotent_begin` מכניס שורה לפני הריצה; כל תוצאה (גם `discard_pending_user`) עוברת `idempotent_finish`.
- `supabase/migrations/20261001165149_fix_entitlement_expiry_without_grant.sql` -- ‏`entitlement_balances`; ‏`private.bind_purchase` ב-`20261001195103_create_join_flow.sql:277`.
- `lib/server/privileged/join.ts` -- ‏`ensureAuthUser` (142), ‏`deleteOrphanUser` (218), ‏`submitJoin` (240).
- `app/(auth)/join/[token]/*`, ‏`lib/auth/join-link-state.ts` -- פג ב-`join-form.tsx:143` וב-`claim-join.tsx:122`; ‏`contact-text.tsx` עובר.
- `app/admin/(shell)/payments/new/{actions.ts,payment-form.tsx}` -- ‏`requestOrigin` (88) ו-`/join/<token>` (140) ← עזר משותף; ‏`ApprovedLink` (278), ‏`copyText` (253).
- `lib/nav.ts`, ‏`app/admin/(shell)/more/page.tsx` -- כניסה למסך (`lib/nav.test.ts`).
- `app/me/page.tsx`, ‏`app/me/purchase-items.ts` -- היום רק `is_expired = false`.
- `lib/copy/{admin,join,customer}.ts`, ‏`lib/errors.ts`, ‏`lib/time.ts`, ‏`lib/content/business-details.ts` (`getWhatsappHref`).
- `supabase/tests/support/{db,money}.ts` -- ‏`inRollback`, ‏`asAuthenticated`, ‏`insertAuthUser`, ‏`seedMoney`, ‏`approve`; זמן מדומה ב-`update` כבעלים. ‏`grants.test.ts` (`EXPECTED_GRANTS`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_link_lifecycle_and_recovery.sql` -- **סשן ראשי:** ‏`migration new`, ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`.
- [x] `lib/server/privileged/join.ts` + `join.test.ts` -- ‏`discard_pending_user` (מחיקה, קריאה חוזרת במפתח חדש, כשל ← `SERVER_ERROR`).
- [x] `app/admin/(shell)/links/*` + בדיקות -- מתחילים בסקיל `frontend-design`. רשימה, ביטול עם אישור, חלופי עם `ApprovedLink`, מחיקת יתומה.
- [x] `app/(auth)/join/[token]/*`, ‏`app/me/*`, ‏`components/shared/*` + בדיקות -- מתחילים בסקיל `frontend-design`. וואטסאפ בפג, "חזרה לטופס", הודעת תוקף עם toggletip.
- [x] `lib/copy/*`, ‏`lib/errors.ts` -- הנוסחים המאושרים.
- [x] `supabase/tests/link-lifecycle.test.ts` -- כל שורה במטריצה; ‏`grants.test.ts`; בדיקות ישנות שנועלות `LINK_IN_USE` ב-claiming או ב-awaiting_login.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given ‏`DEV_DATABASE_URL`, when ‏`npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון, when טל מפיקה חלופי, then הישן מציג "פג", החדש עובד, אין תשלום או כרטיסייה נוספים, ו-`/admin/links` מציג סטטוס נכון ושם אחרי מימוש; when לקוחה מתקנת פרטים אחרי כשל, then ההצטרפות מסתיימת.

## Implementation Notes

- קובץ המיגרציה כבר נוצר בסשן הראשי: `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql` (ריק). כותבים אליו בלבד; ‏`apply_migration` ו-`migration new` לא עובדים אצל סוכן משנה. הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`; עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. לסיים בדיווח מה נשאר לסשן הראשי.
- לפני כל מסך מפעילים את הסקיל `frontend-design` (כלי Skill), בתוך DESIGN.md ו-EXPERIENCE.md ובעזרת הרכיבים הקיימים.
- המיגרציה `20261003141504_link_lifecycle_and_recovery.sql` הוחלה מהסשן הראשי. ה-advisor: רק 0029 (נוספו `admin_issue_link`, ‏`admin_list_links`, ‏`admin_revoke_link`) ו-`auth_leaked_password_protection`. ‏`database.types.ts` תואם לפלט של `generate_typescript_types`.
- החלטה של הסוכן הבונה שלא כתובה ב-spec: ה-check של conflict התרכך, וקישור conflict שבוטל שומר את `conflict_reason` (אחרת הביטול נכשל על ה-check).
- תיקון ממצא 2 של הביקורת (discard לפני הנעילה) נכתב בטעות לתוך המיגרציה שכבר הוחלה. הקובץ שוחזר לגרסה שהוחלה, והתיקון עבר למיגרציה חדשה `20261003192326_join_begin_discard_before_lock.sql` (הוחלה, ה-advisor ללא שינוי).
- מפתחות idempotency של ההצטרפות נגזרים מ(מפתח הדף, הקלט המנורמל, שלב) ב-`joinStepKey`; אין ניסיון חוזר על `IDEMPOTENCY_KEY_REUSED`.
- `ContactText` עבר ל-`components/shared/`; הקובץ הישן נמחק בסשן הראשי באישור המשתמשת. כפתורי השליחה משותפים ב-`components/admin/link-share.tsx`; הקישור המלא נבנה ב-`lib/server/join-link.ts`.
- תוצאות סופיות: ‏`npm test` ‏658/658, ‏`npm run test:db` ‏335/335, ‏lint, ‏format:check, ‏typecheck ו-build עוברים. בריצת `test:db` אחת נכשלה בדיקה אחת שלא חזרה בשתי ריצות נוספות (כשל חד-פעמי, כנראה רשת).

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment, spec-line-by-line). אין intent_gap ואין bad_spec. medium 3, low 9, false 2. patch 7, defer 1, שתי שאלות נוסח למשתמשת, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | אחרי תיקון (`discard` או `IDEMPOTENCY_KEY_REUSED`) `join_complete` נשמר במפתח אקראי; תשובה שאבדה ושליחה חוזרת ← `LINK_USED` במקום "הצטרפת" | medium | ‏`join_begin` בענף consumed מחפש לפי מפתח הדף; ‏`submitJoin` מחליף ל-`randomUUID()` (blind, edge, verification, spec) | patch: מפתח נגזר דטרמיניסטית מ(מפתח הדף, הקלט המנורמל, שלב) לכל קריאה, בלי ניסיון חוזר על `KEY_REUSED` + בדיקה |
| 2 | ‏`too_many_attempts` ב-claiming עם משתמשת Auth משאיר משתמשת יתומה שלא נמחקת | medium | ענף `identity_attempts >= 2` לפני ענף discard; ‏`revoke_join_token` מחזיר רק ל-claiming | patch: discard קודם, הנעילה בקריאה שאחרי המחיקה + בדיקת מסד |
| 3 | שתי לשוניות: discard מוחק משתמשת Auth ש-`join_complete` של לשונית אחרת בדיוק השלים | low | חלון בין `join_begin` למחיקה | patch: ‏`deleteOrphanUser` לא מוחק כשיש פרופיל לאותו id |
| 4 | פעולה נוספת ב-`/admin/links` מוחקת מהמסך את הקישור החלופי שמוצג פעם אחת | medium | ‏`result` יחיד ב-`links-list.tsx` | patch: הקישור החלופי ב-state נפרד שפעולות אחרות לא דורסות |
| 5 | בחלופי אין "תקף עד" (ה-spec: ‏`ApprovedLink`) | low | ‏`linkExpiresAt` לא בשימוש | patch: שורת `linkValidUntil` הקיימת |
| 6 | במחשב, לחיצה על ה-i אחרי ריחוף סוגרת את החלונית | low | ‏`onClick` מחליף מצב אחרי `pointerenter` | patch: לחיצת עכבר אחרי פתיחה בריחוף משאירה פתוח |
| 7 | בדיקות חסרות: `can_replace` לתשלום שכל קישוריו בוטלו, ‏`LINK_IN_PROGRESS` ב-`lib/errors.ts`, קישור reset ב-`admin_revoke_link`, כל עזרי `private` בלי grant, זכות ששויכה בזמן | low | verification-gap, blind, spec | patch: הבדיקות |
| 8 | ‏`Math.round(days/7)` ובלי יחיד/זוגי ("עברו 1 שבועות") כשימי התוקף לא כפולה של 7 | low | היום רק 49 ימים; עריכת תוקף ב-2.6 | defer ל-2.6 |

שאלות למשתמשת (נוסח חדש): ‏`LINK_USED` ב-`/admin/links` מציג "הקישור הזה כבר שימש לאיפוס סיסמה"; כרטיסייה שפגה לפני השיוך עדיין מציגה "N זמינות".

Reject (12): ‏`replaceLinkAction` רושם בלוג את מזהה הטוקן החדש ומתעלם מכשל מחיקה (לוג בלבד, נדיר); ‏`admin_list_links` בלי הגבלה (גודל העסק); ‏email_exists ואז תיקון אחרי תפוגה ← "פג" (נדיר, הודעה עם פנייה לטל); אין "חזרה לטופס" במסך "חשבון אחר" (החלטת spec; התנתקות מובילה למסך עם הכפתור); שם ריק במומש (false: ‏`full_name not null`); מונה משותף ושינוי טלפון באותו חשבון נספר (החלטת spec: 3 בדיקות לקישור); הכרטיסייה נשארת ב-`/me` (החלטה 4א); קישור "צרי קשר לפרטים נוספים" ב-too_many_attempts (כמו two_accounts); ‏`/me` ו-page לא נבדקים כ-wiring (דפוס קיים); ‏backfill של `claiming_at` (מסד פיתוח); ההתראה של email_exists לא מרונדרת בבדיקה (דפוס קיים); ‏`contact-text.tsx` הישן (false כממצא קוד: מחיקה בסשן הראשי באישור).

## Design Notes

**נוסחים מאושרים (המשתמשת, 2026-10-03).** ‏`{x}` = ערך. **מודגש** = קישור לוואטסאפ של טל (`getWhatsappHref`, בלי תוכן מפורסם: טקסט רגיל).

| מסך / מצב | מתי | נוסח |
|---|---|---|
| כותרת | ‏`/admin/links` | קישורי הצטרפות |
| כניסה | שורה ב"עוד" · קישור בראש "הוספת תשלום" | קישורי הצטרפות · לכל קישורי ההצטרפות |
| כותרת שורה | ממתין / פג / בוטל / מומש | הקישור מחכה למימוש / הקישור פג בלי מימוש / הקישור בוטל / {שם הלקוחה} |
| פרטי הרכישה | כל שורה | {מוצר} · {סכום} ₪ · אושר {DD.MM} |
| סטטוס | | ממתין למימוש / מומש / פג תוקף / בוטל |
| שורת זמן | ממתין / פג / בוטל / מומש | תקף עד {יום} {DD.MM} · {HH:MM} / פג ב-{DD.MM} / בוטל ב-{DD.MM} / מומש ב-{DD.MM} |
| פירוט | ‏awaiting_login / ‏claiming מעל 15 דקות / ‏conflict | ממתין להתחברות של {שם} / ההצטרפות נעצרה באמצע / נעצר, צריך בירור: {סיבה} |
| סיבות | ‏two_accounts / ‏not_activated / ‏phone_taken / ‏bind_conflict / ‏too_many_attempts | מייל וטלפון של שתי לקוחות / חשבון שלא הופעל / הטלפון כבר רשום / התנגשות בשיוך הרכישה / יותר מדי ניסיונות |
| כפתורים | ‏`can_revoke` / ‏`can_replace` | ביטול הקישור · הפקת קישור חלופי |
| אישור ביטול | אחרי "ביטול הקישור" | לבטל את הקישור? הלקוחה לא תוכל להשתמש בו · כן, לבטל · חזרה |
| אחרי ביטול | ‏inline-notice | הקישור בוטל |
| אחרי חלופי | ‏inline-notice + "שליחה בוואטסאפ" ו"העתקת הקישור" הקיימים | הקישור החלופי מוכן לשליחה. הקישור הקודם בוטל |
| ‏`LINK_IN_PROGRESS` | ביטול או חלופי ל-claiming טרי | הלקוחה באמצע הצטרפות. אפשר לבטל או להחליף אחרי 15 דקות |
| ריק | אין קישורים | אין עדיין קישורי הצטרפות |
| פג / בוטל (לקוחה) | פתיחה | תוקף הקישור פג. **צרי קשר עם טל** לקבלת קישור חדש |
| חזרה לטופס | "יש להתחבר לחשבון", בלי session | לא החשבון שלך? · כפתור: חזרה לטופס |
| ‏`email_exists` | ‏Auth דחה את המייל, הקישור פתוח לתיקון | הפרטים קיימים במערכת. בדקי את כתובת המייל ונסי שוב או **צרי קשר** לפרטים נוספים |
| ‏`too_many_attempts` | ניסיון רביעי | יותר מדי נסיונות. הלינק ננעל. **צרי קשר** לפרטים נוספים. (כמו נעילת `two_accounts`) |
| תוקף פג | ‏`/me`, ‏`expired_before_bound` | תוקף הכרטיסיה פג ⓘ |
| toggletip | לחיצה על ה-i (במחשב גם ריחוף; `button` עם `aria-expanded`, נסגר ב-Escape ובלחיצה בחוץ) | עברו {N} שבועות מרכישת הכרטיסיה ולכן פג תוקפה. לבירורים **צרי קשר** |

כרטיס הקישור שאחרי אישור תשלום (`adminCopy` ‏`linkTitle`) לא משתנה.

**אחרי הביקורת (המשתמשת, 2026-10-03):** ‏`LINK_USED` בביטול או בחלופי ב-`/admin/links` (רשימה ישנה): "הקישור כבר מומש" + רענון הרשימה (ההודעה הגלובלית ב-`lib/errors.ts` לא משתנה). כרטיסייה עם `expired_before_bound` ב-`/me` לא מציגה זמינות ושריון, רק "תוקף הכרטיסיה פג" עם ה-i.

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.
- MCP ‏`get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
