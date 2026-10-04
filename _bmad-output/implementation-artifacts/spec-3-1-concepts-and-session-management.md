---
title: '3.1 Concepts and session management — קונספטים וניהול מפגשים'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: 'ac84b847ef2be297b6704fe8ea4835a0ac2df0f1'
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

**Problem:** אין מפגשים במערכת. טל לא יכולה ליצור בראנץ׳, לשכפל, לערוך או לפרסם, ו-3.2 צריך טבלת מפגשים להרשמה (מקור §7, CAP-12, CAP-41, CAP-34).

**Approach:** מיגרציה עם `concepts` (חמשת הקונספטים), `events`, ‏triggers לסגירת הרשמה ול-revision, וארבעה RPC אדמין. מסכי `/admin/sessions` עם יצירה, שכפול, עריכה שדה-שדה ב-`value-change-row` ופרסום.

## Boundaries & Constraints

**Always:** AD-5, AD-8, AD-15, AD-16 › קונספטים, AD-19 (`action` = שם ה-RPC, `event_id` מולא). עברית רק ב-`lib/copy/admin.ts` ו-`lib/errors.ts`, מה-Design Notes. בקבצים משותפים (`lib/nav.ts`, ‏`lib/copy/*`, ‏`lib/errors.ts`, ‏`database.types.ts`) רק מוסיפים.

**Decisions:**
- **`concepts`:** ‏`name, description, default_kind ('regular'|'couple'), theme_key, generic_paper_key, sort_order, archived_at`. seed (תיאור ריק): אמהות בחל״ד / regular / mothers · זוגות / couple / couples · עם סבתוש / couple / grandma · עם סבוש / couple / grandpa · יווני / regular / greek. אין עמודות תמונה (5.4) ואין RPC קונספטים (4.8). ‏select ל-anon ול-authenticated.
- **`events`:** ‏`concept_id` (FK, ‏`on delete restrict`), ‏`kind, description, starts_at, ends_at, capacity_adults, registration_closes_at, registration_close_overridden, status ('draft'|'published'|'cancelled'|'completed'), revision, waitlist_cycle, display_price_agorot` (null = מחיר המוצר). אין `title`, ‏`menu` או תמונה. select: ‏anon רק `status <> 'draft'`; ‏authenticated אותו דבר או `is_admin()`. אין כתיבה מהדפדפן.
- **triggers:** ‏`registration_closes_at` מחושב ב-insert ובשינוי `starts_at` מ-`private.registration_closes_at` ומההגדרות הנוכחיות, אלא אם `registration_close_overridden`. ‏`revision` עולה רק בשינוי `starts_at`, ‏`ends_at`, ‏`kind` או מעבר ל-`cancelled`.
- **זמן:** הדפדפן שולח זמן מקומי (`date`, ‏`start_time`, ‏`end_time`, ‏`registration_closes_local`), וה-SQL ממיר ב-`Asia/Jerusalem`. ‏`ends_at > starts_at`, ‏`registration_closes_at <= starts_at`, מכסה > 0, מחיר ≥ 0; אחרת `INVALID_INPUT` עם `detail.field`.
- **`admin_create_event(p_event jsonb, p_idempotency_key)`:** ‏`concept_id` (לא בארכיון), מועד; ‏`kind` ו-`description` ברירת מחדל מהקונספט; ‏`capacity_adults` ברירת מחדל `default_capacity_{regular|couple}` לפי הסוג; ‏`display_price_agorot` אופציונלי. נוצר `draft`. ‏→ `{event_id}`.
- **`admin_duplicate_event(p_event_id, p_date, p_start_time, p_end_time, p_idempotency_key)`:** טיוטה חדשה עם הקונספט, הסוג, התיאור, המכסה והמחיר; סגירה מחושבת מחדש (לא מועתקת). ‏→ `{event_id}`.
- **`admin_update_event(p_event_id, p_changes jsonb, p_idempotency_key)`:** תת-קבוצה של `date, start_time, end_time, kind, description, capacity_adults, registration_closes_local, display_price_agorot`. מפתח אחר (גם `concept_id`) ← `INVALID_INPUT`. ‏`registration_closes_local` קובע `overridden = true`. נועל את השורה; יומן לפני ואחרי. שינוי מועד כשיש נרשמות מקבל תצוגת השפעה ב-3.8.
- **`admin_publish_event(p_event_id, p_idempotency_key)`:** ‏`draft` ← `published`; מפגש שכבר פורסם מחזיר הצלחה בלי שינוי.
- **מוצרים תקפים (המשתמשת, 2026-10-04):** ‏`event_products` והשדה נדחים לאחרי ההדגמה (deferred-work). ההתאמה לפי תכונות המוצר (AD-18).
- **נוסחים:** טבלת ה-Design Notes אושרה (המשתמשת, 2026-10-04).
- **מסכים:** "מפגשים" ב-`adminNav` אחרי "בית". ‏`/admin/sessions`: טיוטות ומפגשים עתידיים לפי מועד, `status-chip` טיוטה/פורסם. ‏`/new`: קונספט ראשון, ממנו מתמלאים סוג ותיאור, ומהסוג המכסה (מההגדרות). ‏`/[id]/edit`: שורת `value-change-row` לכל שדה (המועד כשורה אחת), "פרסום" בטיוטה ו"שכפול" עם בחירת מועד.

**Never:** תמונות (5.4), ניהול קונספטים וערכות (4.8), `session-card` ו-`concept-header` (3.2), ‏`/admin/sessions/[id]` (3.4), ביטול מפגש ותצוגת השפעה (3.8), עמודים ציבוריים ו-`/sessions`, ‏`event_products` (נדחה, ראו למטה), שינוי קונספט במפגש קיים.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| קונספט זוגי | יצירה מ"עם סבתוש" בלי סוג ומכסה | `kind = couple`, מכסה 14, סגירה 20:00 ביום הקודם |
| קונספט רגיל | יצירה מ"יווני" | `regular`, מכסה 12 |
| טיוטה מוסתרת | טיוטה ומפגש שפורסם | לקוחה ו-anon רואות רק את שפורסם; אדמין רואה את שניהם |
| מכסה | 12 ← 13 | ביומן `admin_update_event`, before 12, after 13, ‏`event_id` |
| שינוי שעה | `start_time` 10:00 ← 11:00, סגירה לא נקבעה ידנית / נקבעה | הסגירה זזה / לא זזה; `revision` עולה |
| שעון קיץ | מפגש ב-27.10.2026 (אחרי המעבר) | סגירה 26.10 20:00 שעון ישראל |
| שכפול | מפגש שפורסם, מועד חדש | טיוטה חדשה, אותם קונספט, סוג ומכסה; המקור לא השתנה |
| לא תקין | סיום לפני התחלה, מכסה 0, `concept_id` בעדכון | `INVALID_INPUT`, כלום לא נשמר |
| חוזר | אותו מפתח | אותה תוצאה, יומן אחד |
| לא אדמין | לקוחה / anon | `NOT_AUTHORIZED` / 42501 |
| אין תפריט | `information_schema.columns` | אין `events.menu` ואין `events.title` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004102035_product_catalog_admin.sql` -- הדפוס: `admin_create_product` (246), ‏`admin_update_product` (320; יומן רק כשיש שינוי, 367), grants (484). ‏`apply/save_product` (23, 139) ממפים הפרת check ל-`INVALID_INPUT` עם `detail.field`.
- `20260930191525_create_rpc_contract.sql` -- ‏`idempotent_begin/finish` (34, 91); ‏`audit_log.event_id` בלי FK (128). ‏`private.audit` העדכני: `20260930193304_fix_reset_begin_and_audit.sql:69`. ‏`is_admin`: `20260929154816_*.sql:76`.
- `20261001162630_create_money_schema.sql:246` -- ‏`business_settings` (שורה אחת): ‏`registration_close_days_before`, ‏`registration_close_local_time`, ‏`default_capacity_regular/couple`. ‏`private.registration_closes_at(timestamptz, int, time)`: `20260930171231_*.sql:34`.
- `app/admin/(shell)/products/**` -- דפוס מלא לחיקוי: `page.tsx` (קריאה ב-`.from().select`), ‏`load-*.ts`, ‏`*-draft.ts` טהור עם בדיקות, ‏`actions.ts` (UUID, ‏`callRpc`, ‏`ActionResult`), ‏`new/*-create-form.tsx` (מפתח ב-`useState(newIdempotencyKey)`, חדש אחרי הצלחה), ‏`[id]/product-editor.tsx` (‏`ValueChangeRow` עם `saveField`/`revert`).
- `components/admin/value-change-row.tsx` -- לא משנים. ‏`components/shared/{page-heading,inline-notice}.tsx`.
- `lib/nav.ts` (`adminNav`; ‏`NavIcon` "sessions" ו-`shellCopy.nav.sessions` קיימים; ‏`nav.test.ts` דורש `page.tsx` לכל href), ‏`lib/errors.ts`, ‏`lib/copy/admin.ts` (מפתח חדש `sessions`), ‏`lib/time.ts` (`formatSessionDateTime`, ‏`formatLocalDate`, ‏`formatTime`).
- `supabase/tests/{product-catalog,grants}.test.ts`, ‏`support/db.ts` -- דפוס הבדיקות ו-`EXPECTED_GRANTS`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_concepts_and_events.sql` -- **סשן ראשי:** `migration new` מ-main מעודכן, `apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`.
- [ ] `supabase/tests/events-admin.test.ts`, ‏`grants.test.ts` -- כל שורה במטריצה.
- [ ] `app/admin/(shell)/sessions/**` + בדיקות, ‏`lib/nav.ts`, ‏`lib/copy/admin.ts`, ‏`lib/errors.ts` -- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ואין שורות `test_%`.
- Given checkout בלי `.env*`, then lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון, when טל יוצרת מפגש "עם סבתוש", then רואה זוגי ו-14; when משנה מכסה, then רואה ישן ← חדש ו"ביטול" מחזיר; when מפרסמת, then התווית "פורסם".

## Implementation Notes

- קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261004143612_concepts_and_events.sql` (ריק). כותבים אליו בלבד, בלי `drop`. ‏`apply_migration` ו-`migration new` לא עובדים אצל סוכן משנה. הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`. עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. בסוף מדווחים מה נשאר לסשן הראשי.
- החלטות המממש: סגירה שהכלל שם אחרי ההתחלה נקבעת לרגע ההתחלה (`least`); ‏`registration_closes_local: null` מחזיר לחישוב (בלי כפתור); מפגש מבוטל או שהסתיים לא נערך ולא מתפרסם; שכפול אפשרי מכל סטטוס; אין `updated_at`; הרשימה מסננת לפי שעת השרת לתצוגה בלבד; שגיאת שדה מוצגת בנוסח הכללי של `INVALID_INPUT`.
- המיגרציה הוחלה מה-MCP (בלי drop). הטיפוסים שנוצרו זהים לעדכון הידני (רק עיצוב). ה-advisor: רק 0029 ו-`auth_leaked_password_protection`.
- `npm run test:db`: ‏399/402. שלושת הכשלונות ב-`content-publish.test.ts` נובעים מהמיגרציה `public_pages` של סשן 5.2 המקביל, שהוסיפה בלוקים לבית במסד הפיתוח המשותף. הענף של 5.2 מעדכן את הבדיקות האלה. אחרי תיקוני הביקורת: ‏`events-admin` ו-`grants` ‏31/31, ‏lint, ‏format:check, ‏typecheck, בדיקות יחידה (בלי `.claude/worktrees`) ו-build עוברים. לא נשארו שורות `test_%`.
- בדיקה בטלפון (המשתמשת, 2026-10-04). מסך היצירה אוחד אחרי ה-merge:
  - שדה "סגירת הרשמה (לא חובה)" נוסף ליצירה. שדה ריק פועל לפי כלל ההגדרות, שמוצג במילים. התאריך עצמו מחושב רק במסד (AD-8).
  - נוספו שני כפתורים, "יצירת טיוטה" ו"פרסום". "פרסום" יוצר ומפרסם באותה עסקה (`admin_create_event` מקבל `publish` ו-`registration_closes_local`), ושורת היומן היא אחת.
  - אחרי שמירה חוזרים לרשימה.
  - "יצירת טיוטה" ראשון ב-DOM, כך ש-Enter לא מפרסם.
  - השעות 10:30–14:30 מגיעות מ-`business_settings.default_session_start_time/end_time`, במיגרציה `20261004160747_create_event_defaults_and_publish` (בלי drop). העריכה שלהן במסך ההגדרות נדחתה ל-4.7.
  - ההחלטות נרשמו ב-memlog של ה-SPEC וב-`admin-configurable-parameters.md`.
  - ביקורת מקוצרת (blind-hunter ו-edge-case-hunter) הוסיפה בדיקה בטופס שהסגירה לפני ההתחלה. השאר נדחו: מפגש בעבר (כמו בסבב 1), אובדן תשובה ברשת, הנוסח "ערב" כשהשעה בבוקר (נוסח מאושר, ובהגדרות 20:00), ואישור אחרי שמירה (החלטה: חוזרים לרשימה).

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 2, low 4, false 1. patch 6, defer 3, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | אחרי שמירת מועד, שורת הסגירה מציגה שינוי מדומה, ושמירה בה קובעת את הסגירה הישנה ידנית | medium | ‏`draft` נוצר פעם אחת ב-`useState`, ו-refresh לא מעדכן את `closesLocal` (blind, edge) | patch: סנכרון `closesLocal` כשהסגירה במסד משתנה |
| 2 | ה-clamp של הסגירה לרגע ההתחלה (`least`) לא נבדק | medium | כל הבדיקות עם יום אחד ו-20:00 (verification) | patch: בדיקה עם 0 ימים |
| 3 | בדיקת ה-idempotency של העדכון לא מבחינה בין שליפה חוזרת להרצה חוזרת | low | ‏13 ← 13 לא כותב יומן בשני המקרים (verification) | patch: שינוי ל-15 במפתח אחר בין הקריאות |
| 4 | הערת ההיקף מופיעה פעמיים בשורת הסגירה | low | גם ב-hint וגם ב-`scope` (blind) | patch |
| 5 | ביטול בשכפול משאיר שגיאות וערכים ישנים | low | ‏cancel רק סוגר (blind) | patch: איפוס |
| 6 | הערה ב-`new/page.tsx` סותרת את ההתנהגות | low | המכסה חובה בטופס (blind, verification) | patch: תיקון ההערה |
| 7 | בין 3.2 ל-3.8 אפשר להזיז מפגש עם נרשמות בשקט | medium (לא ודאי) | אין `bookings` עדיין (intent) | defer: ‏3.2 |
| 8 | סינון הרשימה לא נבדק; מפגש מבוטל או שהסתיים נפתח לעריכה | low | אין בדיקות שאילתות בעמודים; אין מפגשים כאלה לפני 3.8 ו-3.12 (verification, blind, edge) | defer: ‏3.4 |
| 9 | דחיית "מוצרים תקפים" נרשמה רק ב-spec ולא ב-memlog | low | ‏AGENTS.md: חריגה מהמקור רק ב-memlog (intent) | patch: נרשם ב-memlog של ה-SPEC |

Reject (15): מפגש בעבר ביצירה, בשכפול או בפרסום (טל בוחרת תאריך; אין נזק ללקוחה); שכפול מקונספט בארכיון ורשימת קונספטים ריקה (אין ארכיון עד 4.8); אין חזרה מסגירה ידנית לחישוב (לא ב-spec; "ביטול" מחזיר לפני שמירה); שגיאה כללית כשהזזה מתנגשת בסגירה ידנית, ו-`detail` שלא מוצג (נדיר, דורש קוד שגיאה חדש); ‏`IDEMPOTENCY_KEY_REUSED` אחרי כשל רשת (כמו 2.6, נדיר); פרסום עם שינוי שלא נשמר (כמו 2.6); מחיר מעל טווח integer (‏RPC דוחה); תאריך בלתי אפשרי בשכפול (שדה התאריך מונע); חור שעון קיץ ב-02:00 (אין בראנץ׳ בלילה); עריכת מפגש שעבר (3.12); אין שורת הגדרות (false: שורה יחידה עם check); תמונה וערכה לא מתמלאות (5.4 ו-3.2, ה-spec); בדיקות אינטראקציה בדפדפן (review-accepted); ממצאי intent תיאוריים.

## Design Notes

**נוסחים לאישור.** כותרת המפגש תמיד "בראנץ׳ {קונספט}". מועד ב-`formatSessionDateTime`, סכום ב-`formatAgorot`.

| מקום | נוסח |
|---|---|
| ניווט ורשימה | מפגשים · מפגש חדש · טיוטה · פורסם · {n} מקומות · ריק: אין מפגשים קרובים. "מפגש חדש" יוצר את הראשון |
| יצירה | מפגש חדש · קונספט · תאריך · שעת התחלה · שעת סיום · סוג: רגיל / זוגי · תיאור (לא חובה) · מכסת מבוגרים · מחיר תצוגה (לא חובה) · יצירת טיוטה |
| רמזים | מהקונספט · לפי ההגדרות · מחיר תצוגה ריק: מוצג מחיר המוצר |
| עריכה | מועד · סגירת הרשמה · הערה: נקבעה לפי ההגדרות. שינוי כאן חל רק על המפגש הזה |
| פרסום | פרסום המפגש · הטיוטה לא מוצגת ללקוחות עד הפרסום |
| שכפול | שכפול לטיוטה · מועד הטיוטה החדשה · יצירת הטיוטה |

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
