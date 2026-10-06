---
title: 'סיפור 4.9: דף עבודה: מנות, משימות וימי הכנה'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '48122ff66d424fa98c6af56cfdf95281b11fe4ec'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-admin-worksheet.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** טל מתכננת את המנות והמשימות של כל בראנץ׳ במחברת ובצילומי מסך. אין לה דף עבודה למפגש, ו-`/admin/sessions/[id]/day` (3.4) מציג רק נרשמות.

**Approach:** טבלאות `work_sheets`, ‏`work_dishes`, ‏`work_tasks` ו-RPC לאדמין בלבד. דף `/admin/sessions/[id]/work`: מנות × ימי הכנה (כרטיס למנה בטלפון, טבלה בדסקטופ), ולשונית "עבודה" בתפריט האדמין עם שלושת הבראנצ׳ים הקרובים (CAP-38; demo-scope, שורת 4.9, החלטת המשתמשת 2026-10-05).

## Boundaries & Constraints

**Always:**
- שורת `work_sheets` נוצרת רק ב-`private.ensure_work_sheet(p_event_id)` (‏`insert … on conflict (event_id) do nothing`), שמעתיקה את `business_settings.default_prep_days` ל-`prep_days`. כל RPC שמקבל `p_event_id` קורא לה ראשונה, אחרי בדיקת ההרשאה. שינוי ההגדרה לא משנה דף קיים.
- `prep_days` הם היסטים בימים מיום המפגש (‏`-1` = יום לפני). התאריך של כל עמודה מגיע מ-`private.prep_day(starts_at, offset)` ב-SQL; ב-TS רק עיצוב (`lib/time.ts`). העמודות ממוינות לפי ההיסט. "+ יום הכנה" והסרה חלים רק על המפגש הזה.
- החלטות המשתמשת 2026-10-06: (1) אפשר להסיר כל יום, גם של ברירת המחדל, כל עוד נשאר לפחות יום אחד (אחרת `INVALID_INPUT`, והכפתור לא מוצג). הסרה מוחקת את משימות היום באותה עסקה, עם אישור במסך כשיש בו משימות. (2) "+ יום הכנה" מציע רק היסטים `-6` עד `0` שעוד לא בדף; מחוץ לטווח `INVALID_INPUT`. (3) הלשונית "עבודה" מציגה את שלושת הבראנצ׳ים הקרובים שפורסמו ועוד לא הסתיימו.
- כל RPC: ‏`security definer`, ‏`set search_path = ''`, ‏`is_admin` בשורה הראשונה (`NOT_AUTHORIZED`), יומן ב-`private.audit` עם `p_event_id`, ו-revoke ואז grant אחד ל-`authenticated`. יצירה, עדכון, מחיקה והוספה או הסרה של יום מקבלים `p_idempotency_key`; ‏`admin_set_work_task_done` וסידור פטורים (AD-5). כל כתיבה נועלת קודם את שורת `work_sheets` (`for update`).
- סידור: ‏`admin_set_work_dish_order(p_ids)` ו-`admin_set_work_task_order(p_ids)` (משימות של אותה מנה ואותו יום). רשימה שלא זהה לקיימת: `CONCURRENT_CHANGE`.
- RLS בשלוש הטבלאות: policy ‏select ל-`(select private.is_admin())` ו-`grant select` ל-`authenticated`, בלי grant כתיבה. אינדקס על כל FK. ‏`event_id` עם `on delete cascade` (3.17 ימחק מפגש).
- לשונית "עבודה" (`/admin/work`) ב-`adminNav` אחרי "מפגשים", עם אייקון חדש ב-`nav-icon.tsx`: שלושת הראשונים של `upcoming_sessions` מ-`admin_get_home` (‏`loadHome()`), כל אחד קישור ל-`/admin/sessions/[id]/work`.
- הכפתור "ללשונית העבודה" בעמוד המפגש ו-"לדף העבודה" בכרטיס המפגש הבא בבית מובילים ל-`/work`. ‏`/day` עושה `redirect` ל-`/work`.
- הדף דינמי, בלי `'use cache'`. אין עדכון אופטימי: תיבה וכפתור ננעלים עד תשובה, אחר כך `router.refresh()`; כשל מוצג ב-`inline-notice`.

**Never:**
- לא בונים נרשמות, תזונה, אישור תמונות, קניות, הדפסה או וואטסאפ (4.10). הדף בנוי מחלקים לפי הסדר, ו-4.10 מוסיף את שלו אחרי המנות. אין מקום ריק גלוי בינתיים.
- לא משנים את `business_settings` (4.7 במקביל), את עורך המפגש (3.17) או את שאר עמוד המפגש. אין `segmented-switch` בסיפור הזה (סבב העיצוב): בדף העבודה קישור חזרה "לפרטי המפגש".
- אין העתקה ממפגש קודם, ואין כתיבה ישירה לטבלאות מהדפדפן.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ברירת מחדל, יום ה׳ | מפגש ב-22.10.2026 (ה׳), הגדרה `[-1,0]`, פתיחה ראשונה | עמודות ד׳ 21.10 "יום לפני", ה׳ 22.10 "יום המפגש" | — |
| ברירת מחדל, יום ב׳ | מפגש ב-19.10.2026 (ב׳) | א׳ 18.10, ב׳ 19.10 | — |
| הוספת יום | "+ יום הכנה" ← ג׳ (`-2`) | עמודה נוספת רק במפגש הזה; דף של מפגש אחר לא משתנה | היסט קיים: בלי שינוי |
| הסרת יום עם משימות | הסרת `-2` שיש בו משימה | אחרי אישור: העמודה והמשימות נמחקות | — |
| דף ריק | מפגש בלי מנות | `empty-state` "עוד אין מנות לבראנץ׳ הזה" + "+ מנה" | — |
| מנה בטלפון | מנה בלי משימות ביום ג׳ | הכרטיס לא מציג את ג׳; "+ משימה" בכרטיס בוחר יום | — |
| קריאה חוזרת | אותו מפתח ב-`admin_add_work_dish` | מנה אחת, אותה תוצאה | מפתח עם קלט אחר: `IDEMPOTENCY_KEY_REUSED` |
| סידור לא עדכני | `p_ids` חסר מנה שנוספה | בלי שינוי | `CONCURRENT_CHANGE` |
| לקוחה | `select` מ-`work_sheets` / קריאה ל-`admin_get_work_sheet` | 0 שורות | `NOT_AUTHORIZED` |
| מפגש לא קיים | `/admin/sessions/<uuid זר>/work` | `notFound()` | `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql:245-276` -- `business_settings` (שורה אחת, `default_prep_days smallint[]`), נקרא ב-`select s.* into v_settings from public.business_settings s`.
- `supabase/migrations/20260930171231_create_time_and_phone_helpers.sql:80` -- `private.prep_day(timestamptz, integer) returns date` (תאריך מקומי + היסט).
- `supabase/migrations/20260930191525_create_rpc_contract.sql` -- `private.idempotent_begin/finish`, ‏`private.audit` (הגרסה האחרונה ב-`20260930193304_fix_reset_begin_and_audit.sql:69`), דפוס טבלת אדמין (`audit_log` ‏147-160).
- `supabase/migrations/20261004143612_concepts_and_events.sql:426-504` -- `admin_create_event`: הדפוס ל-RPC (is_admin, idempotent_begin, audit, idempotent_finish); ‏`events.status`, ‏`concepts.name`.
- `supabase/migrations/20261005225116_admin_home.sql` ~240 -- `upcoming_sessions` של `admin_get_home` (פורסם, לא הסתיים, לפי `starts_at`, עד 4).
- `supabase/tests/support/db.ts`, ‏`supabase/tests/events-admin.test.ts` -- עזרים ודוגמת seed (‏`admin_roles`, ‏`profiles`, ‏concepts).
- `supabase/tests/grants.test.ts` -- `EXPECTED_GRANTS` ממוין, עם שמות הארגומנטים; כל טבלה ו-RPC חדשים נכנסים.
- `lib/nav.ts`, ‏`lib/nav.test.ts`, ‏`components/shared/nav-icon.tsx` -- `adminNav` (4 פריטים), ‏`NavIcon`, מפת `ICONS` (lucide). קבצים משותפים עם 4.7: מוסיפים רק את השורות של "עבודה".
- `app/admin/(shell)/sessions/[id]/page.tsx:117-126` -- הקישור `/day` עם `copy.morningView`. ‏`load-details.ts` (`loadEventDetails`) לכותרת הדף. ‏`day/page.tsx` הופך ל-redirect.
- `app/admin/(shell)/home/next-sessions.tsx:55-63` -- כפתור "לפרטי המפגש"; מוסיפים לידו "לדף העבודה". ‏`home/load-home.ts` (`loadHome`), ‏`home-items.ts` (`UpcomingSessionRow`, ‏`upcomingRowText`). ‏`home/empty-states.test.tsx:123` בודק שאין `/day`.
- `app/admin/(shell)/sessions/[id]/actions.ts` -- דפוס Server Action (בדיקת UUID ידנית, `callRpc`, ‏`ActionResult`). ‏`lib/idempotency.ts` (`newIdempotencyKey`), ‏`lib/errors.ts`.
- `app/admin/(shell)/content/content-editor.tsx:331-343`, ‏`section-fields.ts:598` (`moveItem`) -- דפוס מעלה/מטה עם הכרזה ופוקוס.
- `components/shared/inline-notice.tsx`, ‏`components/admin/sensitive-confirm-dialog.tsx`, ‏`components/ui/sheet.tsx`, ‏`checkbox.tsx` -- לשימוש חוזר (עוטפים, לא עורכים את `components/ui/`).
- `lib/copy/admin.ts` -- `sessions.morningView` (509), ‏`home.*`. מוסיפים `adminCopy.work`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_work_sheet.sql` -- (`npx supabase migration new work_sheet`) שלוש הטבלאות עם checks (שם ותוכן 1-200 תווים, `prep_days` בלי null ובלי כפילות, `day_offset` בטווח), RLS, grants ואינדקסים; ‏`private.ensure_work_sheet`; ‏RPC: ‏`admin_get_work_sheet(p_event_id)` (מחזיר מפגש, `prep_days` עם `date`, מנות ומשימות ממוינות), ‏`admin_add/update/delete_work_dish`, ‏`admin_add/update/delete_work_task` (העדכון משנה גם יום; היום חייב להיות ב-`prep_days`, אחרת `INVALID_INPUT`), ‏`admin_set_work_task_done`, ‏`admin_set_work_dish_order`, ‏`admin_set_work_task_order`, ‏`admin_add_prep_day`, ‏`admin_remove_prep_day`. מחילים ב-`apply_migration`, מריצים `get_advisors` ויוצרים מחדש את `lib/supabase/database.types.ts` -- סשן ראשי.
- [x] `supabase/tests/work-sheet.test.ts` -- כל שורות המטריצה, הטווח `-6..0` והיום האחרון, שינוי ההגדרה לא משנה דף קיים, הסרת יום מוחקת משימות, יומן נרשם, לקוחה: 0 שורות ו-`NOT_AUTHORIZED` -- ה-verify של הרשומה.
- [x] `supabase/tests/grants.test.ts` -- השורות החדשות ב-`EXPECTED_GRANTS`.
- [x] `app/admin/(shell)/sessions/[id]/work/{page.tsx,actions.ts,load-work-sheet.ts,*.tsx}` -- הדף, Actions לכל RPC, ופירוק התשובה. בטלפון `dish-card` (שם, "עריכה" שפותח sheet עם שינוי שם, מעלה/מטה ומחיקה; קבוצה לכל יום עם משימות; `check-item` עם "+ משימה" ליום ו"+ משימה" למנה עם בחירת יום). מ-`lg`: טבלת `<table>` עם `caption` ו-`scope`. "+ מנה", "+ יום הכנה" (בחירה מהימים הפנויים), הסרת יום, `empty-state`. מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md ולפי המוקאפ.
- [x] `app/admin/(shell)/work/page.tsx` -- הלשונית: עד שלושה בראנצ׳ים (שם הקונספט, יום, תאריך ושעה), כל אחד קישור לדף; בלי בראנצ׳ים: הודעה וקישור למפגשים.
- [x] `lib/nav.ts`, ‏`components/shared/nav-icon.tsx`, ‏`lib/copy/shell.ts`, ‏`lib/copy/admin.ts` -- פריט "עבודה", אייקון, `adminCopy.work`. מעדכנים את ההערה של `morningView`.
- [x] `app/admin/(shell)/sessions/[id]/page.tsx`, ‏`day/page.tsx`, ‏`home/next-sessions.tsx` -- היעד החדש, ה-redirect והקישור "לדף העבודה"; מעדכנים את הבדיקות הקיימות.
- [x] בדיקות טהורות ליד הקבצים: פירוק התשובה, תווית היום (`0` "יום המפגש", ‏`-1` "יום לפני", אחרת "{n} ימים לפני"), ימים שמוצגים בכרטיס, `isCurrent` של "עבודה", Actions דוחים קלט לא תקין.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- סוגרים את הרשומה מ-3.12 עם target 4.9. ‏`tickets.toml` של האפיק: 4.9 done (ב-PR).

**Acceptance Criteria:**
- Given אדמין בטלפון, when היא לוחצת "עבודה" בתפריט, then היא רואה עד שלושה בראנצ׳ים קרובים, ובלחיצה על אחד נפתח דף העבודה שלו.
- Given עמוד מפגש או כרטיס המפגש הבא בבית, when היא לוחצת "ללשונית העבודה" או "לדף העבודה", then נפתח `/admin/sessions/[id]/work`; כתובת `/day` מפנה לשם.
- Given דף עם מנות, when היא מוסיפה, עורכת, מסדרת, מוחקת ומסמנת בוצע, then אחרי רענון הסדר והמצב נשמרים, ומשימה שבוצעה מוצגת עם קו מחיקה.

## Implementation Notes

- המיגרציה `20261006184223_work_sheet.sql` נכתבה ולא הוחלה (סשן ראשי: `apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`). ב-`database.types.ts` נוספו ידנית רק 12 ה-RPC, כדי שהבנייה תעבור; יצירה מחדש תחליף אותם ותוסיף את הטבלאות. בדיקות המסד (`work-sheet.test.ts`, ‏15) רצו מול פרויקט הפיתוח עם המיגרציה בתוך כל עסקה שהתגלגלה אחורה, ועברו. ב-`grants.test.ts` השורות של 4.9 במקומן; ההפרש היחיד היה שלוש שורות של 4.7, שהוחלה במסד במקביל.
- `admin_get_work_sheet` מחזיר גם `addable_days` (ההיסטים מ-`-6..0` שעוד לא בדף, עם `date` מ-`private.prep_day`), כדי שבחירת "+ יום הכנה" לא תחשב תאריכים ב-TS (AD-8).
- `ensure_work_sheet` מעתיקה את ההגדרה ממוינת ובלי כפילות, רק בטווח `-6..0` (טווח 4.7); אם לא נשאר כלום, יום המפגש בלבד. `prep_days` נבדק ב-`private.valid_prep_days` (1–7, שונים, ממוינים, בטווח).
- הסרת יום שלא בדף והוספת יום שכבר בדף מחזירות את המצב בלי שינוי. סידור עם id ראשון שלא קיים: `CONCURRENT_CHANGE`. `admin_set_work_task_done` עם אותו ערך לא כותב יומן.
- ימי ההכנה מוצגים ברשימה אחת מעל המנות ("ימי הכנה", עם "הסרת היום"), ולא בכותרת כל כרטיס, כי היום שייך לדף כולו. עריכה, סידור ומחיקה של משימה בעיפרון ליד המשימה (sheet). בתפריט, בדף העבודה של מפגש מסומן "מפגשים" (`isCurrent`); "עבודה" מסומנת רק ב-`/admin/work`.
- סשן ראשי (2026-10-06): ‏`apply_migration` נדחה, והמשתמשת הריצה את שתי המיגרציות ב-SQL Editor (הריצה הראשונה נפלה על deadlock מול סשן מקביל ולא השאירה כלום). שתיהן נרשמו ב-`schema_migrations`, וה-advisor נקי. ‏`database.types.ts` נוצר מחדש אחרי הראשונה; השנייה לא שינתה חתימות.
- תיקוני הביקורת ב-`20261006191118_work_sheet_review_fixes.sql`. הסוכן כתב בו את מחלקת הרווחים כתווים עצמם במקום escapes (המלכודת המוכרת), והם הוחלפו ב-`\u00a0` וכו׳ ב-ASCII לפני ההחלה. ‏`work-sheet.test.ts` (23) קיבל `{ timeout: 30_000 }` לכל describe, כמו `cancel-booking.test.ts`, כי בדיקה של עשרות פניות למסד מרוחק עוברת את 5 השניות.
- `admin_get_work_sheet` גם יוצר שורה, ולכן זו לא קריאה טהורה (AD-16). זה מכוון.

## Spec Change Log

## Review Triage Log

סבב 1 (2026-10-06; ‏blind-hunter, ‏edge-case-hunter, ‏verification-gap, ‏intent-alignment). high 0, ‏medium 2, ‏low 9, ‏false 3, ‏maybe-false 1.

| # | ממצא | פסיקה | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 1 | `use-work-action`: Action שנזרקת (רשת) מגיעה ל-error boundary; אחרי כשל הדף לא מתרענן | medium | patch | אין try/catch סביב `call()`, ו-`refresh` רק ב-ok. מוסיפים catch ל-`SERVER_ERROR` ו-refresh גם בכשל |
| 2 | `AddTask` בלי יום קבוע: יום שהוסר נשאר בבחירה ונשלח | low | patch | ה-select מציג יום אחר מזה שנשלח. נופלים ליום האחרון |
| 3 | מחיקת מנה והסרת יום רושמות ביומן רק מספר משימות | medium | patch | before/after בלי תוכן המשימות שנמחקו. רושמים אותן ב-before (מיגרציית תיקון) |
| 4 | סידור ועדכון בלי שינוי כותבים יומן ו-`updated_at` | low | patch | אין השוואה לקיים. מחזירים בלי כתיבה, כמו `set_work_task_done` |
| 5 | `work_text`: ‏`btrim` מוריד רק רווחים | low | patch | טאב או NBSP עוברים ב-RPC ישיר. מקצצים כל רווח |
| 6 | בדיקות מסד חסרות: בידוד בין מפגשים בהסרת יום, סידור עם שתי מנות, עריכה שומרת מקום, לקוחה מול 12 RPC, replay של הסרת יום, תוכן היומן, נרמול ההגדרה | low | patch | verification-gap (מאומת). מוסיפים ל-`work-sheet.test.ts` |
| 7 | אין בדיקה ל-redirect של `/day`, לקישור בעמוד המפגש וללשונית "עבודה" | low | defer | מסכים דקים, הבדיקה בטלפון מכסה. נרשם ב-deferred-work |
| 8 | מחיקת מפגש (cascade) מוחקת את דף העבודה בלי יומן | low | defer | שייך ל-3.17, שמוחק מפגש. נרשם ב-deferred-work |

נדחו: ספירת משימות ישנה לפני הסרת יום (low, טל עובדת לבד ותיקון דורש פרמטר חדש); אורך מחרוזת עם אימוג׳י (low, נדיר); איחוד עדכוני ההכרזה (maybe-false, low); אין שמירה לפי סטטוס המפגש ויצירת דף בקריאה (false: ‏AD-16 קובע יצירה בכל קריאה); יצירת הדף לא ביומן (low, הימים ההתחלתיים ב-before של השינוי הראשון); הבדלים מול intent-alignment (false: מיקום הלשונית, החלפת `/day` ו"פורסמו" הן החלטות המשתמשת).

## Design Notes

תשובת `admin_get_work_sheet` (קריאה שגם יוצרת את השורה, ולכן `volatile`, ופטורה מ-idempotency כקריאה):

```json
{ "event": { "id": "…", "concept_name": "יווני", "starts_at": "…", "status": "published" },
  "prep_days": [ { "offset": -1, "date": "2026-10-21" }, { "offset": 0, "date": "2026-10-22" } ],
  "dishes": [ { "id": "…", "name": "שקשוקה ירוקה", "tasks": [
      { "id": "…", "day_offset": -1, "body": "לקצוץ עשבים", "done": false } ] } ] }
```

סידור: הפונקציה גוזרת את ההורה מה-id הראשון (מנה ← דף; משימה ← מנה ויום), נועלת את `work_sheets`, ומשווה את הקבוצה ל-`p_ids` (גודל, בלי כפילות). משימה חדשה או משימה שעברה יום נכנסת בסוף התא.

## Verification

**Commands:**
- `npm run test:db` -- `work-sheet.test.ts` ו-`grants.test.ts` עוברים.
- `npm test`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm run build` -- עוברים.
- `get_advisors` (security) -- רק `0029` ו-`auth_leaked_password_protection`.

**Manual checks:**
- בטלפון: בראנץ׳ ביום ה׳ מציג ד׳ וה׳, ובראנץ׳ ביום ב׳ מציג א׳ וב׳; יום שנוסף מופיע רק במפגש הזה.
