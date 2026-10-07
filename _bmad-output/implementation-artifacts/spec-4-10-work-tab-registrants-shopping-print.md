---
title: 'סיפור 4.10: דף עבודה: נרשמות, תזונה, אישור תמונות, קניות והדפסה'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'd47148fadc41876388020ec78da3361a473ac071'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-admin-worksheet.html'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-9-work-tab-dishes-tasks-prep-days.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** בדף העבודה של 4.9 יש רק מנות ומשימות. טל עוד צריכה לפתוח את עמוד המפגש כדי לראות נרשמות ותזונה, אין לה רשימת קניות, ואין לה דף מודפס למטבח.

**Approach:** אחרי המנות מוסיפים שלושה חלקים לפי הסדר: "נרשמות ואישור תמונות", "תזונה ואלרגיות" ו"רשימת קניות". הנרשמות מגיעות מ-`admin_get_event_details` של 3.4, שמחזיר מעכשיו גם `photo_consent`. הקניות נשמרות בטבלת `shopping_items` עם RPC לאדמין. מוסיפים כפתור "הדפסה" (`@media print` על אותו דף) וכפתור "שליחת הרשימה בוואטסאפ" (`wa.me/?text=`, נבנה בדפדפן; AD-16). ההחלטה מ-2026-10-07: הסיפור נבנה במלואו, בלי צמצום בנקודת הבדיקה.

## Boundaries & Constraints

**Always:**
- `shopping_items` (‏`id`, ‏`sheet_id` FK ל-`work_sheets` עם `on delete cascade`, ‏`body` 1–200, ‏`quantity` טקסט חופשי אופציונלי 1–50 או null, ‏`bought`, ‏`sort_order`, ‏timestamps). RLS ‏select ל-`(select private.is_admin())`, ‏`grant select` ל-`authenticated` בלי grant כתיבה, ואינדקס על `(sheet_id, sort_order)`.
- RPC באותו דפוס כמו 4.9: ‏`security definer`, ‏`search_path = ''`, ‏`is_admin` בשורה הראשונה, נעילת `work_sheets` לפני כל כתיבה, ‏`private.audit` עם `event_id`, ‏revoke ואחריו grant אחד ל-`authenticated`. ‏`admin_add/update/delete_shopping_item` מקבלים `p_idempotency_key`. ‏`admin_set_shopping_item_bought` ו-`admin_set_shopping_item_order` פטורים (AD-5). כמו ב-4.9, קריאה שלא משנה כלום לא כותבת ליומן. ‏`body` עובר `private.work_text`. ב-`quantity` רווחים בלבד הופכים ל-null.
- `admin_get_work_sheet` (‏create or replace, אותה חתימה) מחזיר גם `shopping: [{id, body, quantity, bought}]`, לפי `sort_order`. ‏`admin_get_event_details` (‏create or replace) מוסיף `photo_consent` רק ללקוחה פעילה, באותו תנאי כמו השם.
- נרשמות (החלטות המשתמשת 2026-10-07, בדיקה בטלפון): טבלה אחת "נרשמות, תמונות ותזונה", גם בטלפון וגם במחשב, ובמקום `AttendeeRow` ובמקום חלק תזונה נפרד. העמודות: שם (ומתחתיו, בקטן, התינוקות: שם וגיל ביום המפגש; לא עמודה נפרדת, בדיקה שנייה בטלפון) · אישור תמונות ("אישרה" / "לא אישרה"; ריק להרשמה ממתינה או לפרטים שהוסרו) · תזונה ואלרגיות (מה שכתבה, ו"מלווה: …" מ-`guest_details`; ריק למי שלא כתבה). בלי טלפון (הוא רק בפרטי המפגש) ובלי ×2. כותרת החלק כוללת את מספר ההרשמות. אותה טבלה בהדפסה.
- תזונה: מה שכתבה `dietary_notes`, ומלווה רק דרך `guest_details`, השדה היחיד שקיים לה במסד. מי שלא כתבה: תא ריק.
- קניות: ‏check-item (‏checkbox אמיתי, הסימון נשמר מיד ומוכרז, פריט שנקנה נשאר במקומו עם קו מחיקה). "+ פריט" פותח חלון עם תיבת טקסט אחת: כל שורה (Enter) היא פריט, שורות ריקות לא נספרות, ו"הוספה" מוסיפה את כולן בסוף הרשימה בפעולה אחת (`admin_add_shopping_items(p_event_id, p_bodies text[], p_idempotency_key)`, עד 100 שורות, כל אחת `private.work_text`; היא מחליפה את `admin_add_shopping_item`). אין שדה כמות, לא בהוספה ולא בעריכה; כמות קיימת נשמרת ומוצגת. עריכה, מחיקה ומעלה/מטה ב-sheet כמו המשימות. משתמשים ב-`useWorkAction` וב-`work-parts`, בלי עדכון אופטימי.
- ימי הכנה (משנה את 4.9, החלטות המשתמשת 2026-10-07): אין שורת צ׳יפים. "הדפסה" ו"+ יום הכנה" אחד ליד השני. "+ יום הכנה" מוסיף אוטומטית את היום שלפני היום המוקדם בדף, בלי בחירה; כשהמוקדם הוא `-6` הכפתור מושבת עם הסיבה. `work_sheets.base_days` שומר את ימי ברירת המחדל שהועתקו ביצירה (בדפים קיימים: החיתוך של `prep_days` עם ההגדרה הנוכחית, ואם ריק: `{0}`). רק יום שלא ב-`base_days` ("יום נוסף") מקבל X להסרה (`admin_remove_prep_day` דוחה יום בסיס ב-`INVALID_INPUT`) ונערך בלחיצה על היום והתאריך: בוחרים יום פנוי בטווח `-6..0`, והמשימות שלו עוברות איתו (`admin_move_prep_day(p_event_id, p_from, p_to, p_idempotency_key)`). כותרת יום נוסף: יום ותאריך בלבד (בלי "יומיים לפני"). במחשב ה-X והעריכה בכותרת העמודה בטבלה; בטלפון בשורת ימים פשוטה מעל המנות, כטקסט ולא כבועות. כל יום מודגש כך שקל להבחין בין הימים בעין (כותרת יום בולטת בכרטיס ובטבלה).
- בדיקה שנייה בטלפון (2026-10-07), גוברת על השורה הקודמת ועל הבאה במה שהן סותרות: ראש הדף בשני המשטחים: הקישור "לפרטי המפגש" בלי קו תחתון; "בראנץ׳ {קונספט}" ככותרת; מתחתיה התאריך והשעה; אחריה הכותרת "מנות". מעל המנות שורה אחת: "+ יום הכנה" בקצה הימני (inline-start) ו"הדפסה" בקצה השמאלי (inline-end). בטלפון אין שורת ימים בתצוגה הראשית: ה-X והעריכה של יום נוסף בכרטיס המנה, ליד כותרת היום (כמו בכותרת העמודה במחשב). בטלפון "+ מנה" ברוחב 20–25% (מה שנראה טוב יותר), מיושר לימין, מעל המנה הראשונה.
- "+ מנה" (משנה את 4.9): במחשב בתחתית הטבלה אחרי שנוספה המנה הראשונה; בטלפון מתחת לכותרת "מנות", ומעליה "הדפסה" ו"+ יום הכנה".
- וואטסאפ: פונקציה טהורה שבונה הודעה בפורמט "רשימת קניות · {קונספט} {DD.MM}" ואחריה שורה לכל פריט שלא נקנה ("{מה} · {כמות}" כשיש כמות קיימת). פריט שנקנה לא נכלל (החלטת המשתמשת 2026-10-07, כמו EXPERIENCE.md:159). את הקישור בונה `whatsappShareHref`. כשאין פריטים לשליחה (אין פריטים, או שהכול נקנה), הכפתור מקבל `aria-disabled` ומוצגת הסיבה.
- הדפסה: הכפתור קורא ל-`window.print()`. A4 לאורך, שוליים 12 מ״מ, שחור על לבן, בלי תפריט ובלי כפתורים. הכותרת היא שם הקונספט ושורת תאריך בעיצוב האחיד. בהדפסה מוצגת טבלת המנות גם ברוחב צר, רק עם ימים שיש בהם משימות. מתחתיה טבלת הנרשמות והקניות, ולא מודפס חלק ריק. פריט שנקנה ומשימה שבוצעה מודפסים עם קו מחיקה.
- הדף נשאר דינמי, בלי `'use cache'`. שתי הקריאות רצות במקביל.

**Never:**
- בלי לשונית רשימות (4.11), ערכות צבע לקונספט (4.8), מחיקת מפגש (3.17) ופרופיל לקוחה (4.2). השורה לא הופכת לקישור.
- לא נוגעים ב-`admin_get_home`, ב-`customer_notes`, ב-cron, ב-`job_reminders` ובטבלאות ההתראות. לא משנים את `/admin/work` ואת הניווט. לא משנים את עמוד פרטי המפגש (3.4): הטלפון ו-`AttendeeRow` נשארים שם.
- לא ממציאים שדות למלווה. לא בונים PDF בשרת או נתיב הדפסה נפרד. אין כתיבה ישירה לטבלה מהדפדפן.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| תזונה | דנה כתבה "ללא גלוטן", מיכל ריק עם מלווה "צמחונית", רות ריק | בטבלה: אצל דנה "ללא גלוטן", אצל מיכל "מלווה: צמחונית", אצל רות תא ריק | — |
| טבלת נרשמות | דנה עם תינוק עומר, מפגש זוגי | שורה: דנה · "עומר, 4 חודשים" · …; בלי טלפון ובלי ×2 | — |
| אישור תמונות | דנה `true`, מיכל `false`, הרשמה ממתינה | "אישרה", "לא אישרה", תא ריק | — |
| הוספת פריטים | "פטה כבשים⏎עגבניות⏎⏎לחם" | שלושה פריטים בסוף הרשימה, לפי הסדר | שורה מעל 200 או יותר מ-100: `INVALID_INPUT`, אף פריט לא נוסף |
| קריאה חוזרת | אותו מפתח ב-`admin_add_shopping_items` | שלושה פריטים, לא שישה; אותה תוצאה | קלט אחר: `IDEMPOTENCY_KEY_REUSED` |
| + יום הכנה | ימים `[-1,0]` | נוסף `-2`, בלי בחירה; עם X | מוקדם `-6`: הכפתור מושבת |
| הסרת יום | X על `-2` (נוסף) / קריאה ישירה על `-1` (בסיס) | `-2` ומשימותיו נמחקים | בסיס: `INVALID_INPUT` |
| עריכת יום | `-2` שיש בו משימה ← `-4` | העמודה והמשימה עוברות ל-`-4` | יעד תפוס או מחוץ ל-`-6..0`: `INVALID_INPUT` |
| סידור לא עדכני | `p_ids` בלי פריט שנוסף | בלי שינוי | `CONCURRENT_CHANGE` |
| וואטסאפ | 3 פריטים, אחד נקנה | הודעה עם הכותרת ושני הפריטים שלא נקנו | — |
| וואטסאפ ריק | אין פריטים, או שהכול נקנה | הכפתור `aria-disabled` עם הסיבה | — |
| לקוחה | select מ-`shopping_items`, קריאה לכל RPC חדש | 0 שורות | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261006184223_work_sheet.sql` -- הדפוס: טבלאות 29-56, RLS ו-grants 61-82, ‏`ensure_work_sheet` 92, ‏`lock_work_sheet` 136, ‏`lock_sheet_of_dish` 155 (תבנית ל-`lock_sheet_of_shopping_item`), ‏`admin_get_work_sheet` 240 (הגרסה האחרונה, הבסיס ל-create or replace), ‏`admin_add_work_dish` 341. ‏`20261006191118_work_sheet_review_fixes.sql`: ‏`work_text`, עדכון וסידור בלי שינוי, ו-before של מחיקה.
- `supabase/migrations/20261005193624_admin_session_details_and_manual_booking.sql:28-100` -- `admin_get_event_details`, הבסיס ל-create or replace. ‏`profiles.photo_consent boolean not null`.
- `supabase/tests/work-sheet.test.ts` -- seed ועזרים לבדיקות הקניות (timeout ‏30_000). ‏`supabase/tests/admin-booking.test.ts` -- הבדיקות של 3.4 ל-`admin_get_event_details`. ‏`supabase/tests/grants.test.ts` -- ‏`EXPECTED_GRANTS` ממוין.
- `app/admin/(shell)/sessions/[id]/work/` -- ‏`page.tsx` (מוסיפים `loadEventDetails` במקביל), ‏`work-sheet.tsx` (‏`WorkSheetView`, ‏`WorkTable` עם `hidden lg:block`, ולכן בהדפסה צריך `print:block`), ‏`work-parts.tsx` (‏`TextForm`, ‏`MoveButtons`, ‏`DeleteStep`, ‏`TaskItem`, ‏`OUTLINE`/`TEXT_BUTTON`), ‏`use-work-action.ts`, ‏`actions.ts` (בדיקות צורה), ‏`work-sheet-data.ts` (`parseWorkSheet`).
- `app/admin/(shell)/sessions/[id]/load-details.ts` -- `loadEventDetails`, ‏`parseEventDetails` (מוסיפים `photoConsent: boolean | null`). ‏`components/admin/attendee-row.tsx` -- `Attendee`, ‏`AttendeeRow` (בלי שינוי בתצוגה הקיימת).
- `components/admin/link-share.tsx:41` -- `whatsappShareHref(text)` (‏`wa.me/?text=` בלי מספר).
- `lib/copy/admin.ts:771` -- `adminCopy.work` (משותף עם 4.2: מוסיפים רק מפתחות תחת `work`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_work_sheet_shopping.sql` -- (‏`npx supabase migration new work_sheet_shopping` רגע לפני ההחלה) הטבלה, ‏`private.lock_sheet_of_shopping_item`, חמשת ה-RPC, ‏create or replace ל-`admin_get_work_sheet` ול-`admin_get_event_details` עם הערות מעודכנות. ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types` -- סשן ראשי.
- [x] `supabase/tests/shopping-items.test.ts` -- כל שורות המטריצה שבמסד: replay, ‏`CONCURRENT_CHANGE`, בלי שינוי אין יומן, ‏`quantity` ריק הופך ל-null, ‏cascade, לקוחה 0 שורות ו-`NOT_AUTHORIZED` בכל RPC. ב-`admin_get_event_details`: ‏`photo_consent` true/false, אין `dietary_notes` למי שלא כתבה, ואין `photo_consent` להרשמה ממתינה.
- [x] `supabase/tests/grants.test.ts` -- שורות הטבלה וה-RPC החדשים.
- [x] `app/admin/(shell)/sessions/[id]/work/{actions.ts,work-sheet-data.ts,page.tsx,work-sheet.tsx}` ו-`shopping-list.tsx`, ‏`attendee-sections.tsx`, ‏`shopping-message.ts` -- Actions לחמשת ה-RPC, פירוק `shopping`, הוספת שלושת החלקים, כפתור "הדפסה", הוואטסאפ וסגנונות ההדפסה. מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md ולפי המוקאפ, מותאם קודם לטלפון.
- [x] `app/admin/(shell)/sessions/[id]/load-details.ts` -- `photoConsent`.
- [x] `lib/copy/admin.ts` -- המיקרו-קופי תחת `adminCopy.work`.
- [x] בדיקות טהורות ליד הקבצים: בניית ההודעה (כותרת, כמות ריקה, תווים מיוחדים מקודדים, רשימה ריקה), סינון התזונה, פירוק `shopping` ו-`photo_consent`, ‏Actions דוחים קלט לא תקין, ובדיקת מסך לחלקים ולמצב של chip.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- הרשומה עם target 3.17 (cascade של `work_sheets`) כוללת גם את `shopping_items`.
- [x] `demo-scope-2026-10-04.md` (‏שורת 4.10: נבנה במלואו, החלטת המשתמשת 2026-10-07), ‏`tickets.toml` (‏4.10 done ב-PR; ב-description וב-verify: "הפריטים שלא נקנו" במקום "כל הפריטים", וכותרת בעיצוב האחיד במקום "בערכת הקונספט") וקובץ סיפור `story-work-tab-registrants-shopping-print.md` עם status: done.

**Execution, סבב 2 (אחרי הבדיקה בטלפון, 2026-10-07):**
- [x] `supabase/migrations/<ts>_work_sheet_phone_check.sql` -- (‏`npx supabase migration new work_sheet_phone_check`) ‏`work_sheets.base_days smallint[]` עם backfill ו-`not null` אחריו; create or replace ל-`private.ensure_work_sheet` (ממלאת `base_days`), ל-`admin_get_work_sheet` (לכל יום `added: boolean`) ול-`admin_remove_prep_day` (יום בסיס: `INVALID_INPUT`); ‏`admin_move_prep_day` חדש (נעילה, יעד פנוי בטווח, המשימות עוברות, יומן before/after, idempotency); ‏`admin_add_shopping_items` חדש; ‏`drop function public.admin_add_shopping_item`. יש `drop`, ולכן המשתמשת מריצה ב-SQL Editor -- סשן ראשי.
- [x] `supabase/tests/shopping-items.test.ts`, ‏`supabase/tests/work-sheet.test.ts`, ‏`supabase/tests/grants.test.ts` -- השורות החדשות במטריצה; בדיקות 4.9 שמסירות יום בסיס מתעדכנות להחלטה החדשה.
- [x] `app/admin/(shell)/sessions/[id]/work/*` -- טבלת הנרשמות (מחליפה את `AttendeesSection`, ‏`DietSection` ו-`WorkSheetPrintLists` לנרשמות), חלון הוספת פריטים בלי כמות, ימי ההכנה (בלי צ׳יפים, X ועריכה ליום נוסף, הדגשת הימים), מיקום "+ מנה", "הדפסה" ליד "+ יום הכנה"; ‏Actions ו-`work-sheet-data.ts` לחתימות החדשות. מתחילים בסקילים `frontend-design` ו-`ui-ux-pro-max`, בתוך DESIGN.md ו-EXPERIENCE.md: המסך נראה מבולגן ועמוס פרטים, והמטרה היא היררכיה ברורה שקל לעקוב אחריה.
- [x] בדיקות טהורות ובדיקות מסך לכל השינויים, ועדכון הבדיקות הקיימות.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/.memlog.md` -- ההחלטות של סבב 2 (רושם הסשן הראשי).

**Acceptance Criteria:**
- Given מפגש עם נרשמות בדויות, when טל פותחת את דף העבודה בטלפון, then הנרשמות, התזונה ואישור התמונות תואמים לפרופילים.
- Given שלושה פריטים ואחד מסומן כנקנה, when היא מרעננת, then הסדר והסימון נשמרים, והפריט שנקנה מוצג עם קו מחיקה במקומו.
- Given דף מלא, when היא מדפיסה או שומרת כ-PDF מהמחשב, then מוצגים כל החלקים בלי עמודת יום ריקה ובלי כפתורים, והפריט שנקנה עם קו מחיקה.

## Implementation Notes

- המיגרציה `20261006215720_work_sheet_shopping.sql` נכתבה ולא הוחלה (סשן ראשי: `apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`). ב-`database.types.ts` נוספו ידנית רק חמשת ה-RPC, כדי שהבנייה תעבור. בדיקות המסד רצו מול פרויקט הפיתוח עם המיגרציה בתוך כל עסקה שהתגלגלה אחורה (הוק זמני ב-`support/db.ts`, שהוחזר): ‏`shopping-items.test.ts` (10), ‏`admin-booking.test.ts`, ‏`work-sheet.test.ts`, ‏`session-completion.test.ts`, ו-`grants.test.ts` (גם הוא בתוך עסקה) עברו. ריצות חוזרות של `admin-booking` נפלו על deadlock וזמן קצוב, כנראה מול סשן מקביל על אותו מסד; לא מהשינוי.
- כלי הכתיבה הפך את ה-escapes ב-regex של `private.shopping_quantity` לתווים עצמם (המלכודת המוכרת); השורה הועתקה מ-`work_text` כ-ASCII, ו-`invisible-chars` עובר.
- ב-Action הכמות היא מחרוזת (`""` = בלי כמות), כי הטיפוסים שנוצרים מקלידים פרמטר `text` כ-`string`; ה-RPC הופך ריק או רווחים ל-null.
- ההדפסה: `app/globals.css` (‏`@page` A4 לאורך, 12 מ״מ) מסתיר בהדפסה את הסרגל, התפריטים והכפתורים (חוץ מהצ׳קבוקס) רק בדף שיש בו `[data-work-sheet]`, וצובע שחור על לבן. כותרת מודפסת "דף עבודה · {קונספט}" ושורת המועד עם מספר ההרשמות; `SessionHeader` מוסתר בהדפסה. מתחת לטבלה עד שלוש עמודות (`WorkSheetPrintLists`), רק לא ריקות.
- וואטסאפ חסום: `<a>` בלי `href`, ‏`aria-disabled` והסיבה ("אין פריטים לשליחה" או "כל הפריטים כבר נקנו").
- סבב 2: המיגרציה `20261007154028_work_sheet_phone_check.sql` נכתבה ולא הוחלה (יש בה `drop`; המשתמשת מריצה ב-SQL Editor, ואז הסשן הראשי: רישום ב-`schema_migrations`, ‏`get_advisors`, ‏`generate_typescript_types`). ב-`database.types.ts` עודכנו ידנית `base_days`, ‏`admin_move_prep_day` ו-`admin_add_shopping_items`. בדיקות המסד (`work-sheet`, ‏`shopping-items`, ‏`grants`) עודכנו ולא הורצו: הרצה עם המיגרציה בתוך עסקה נחסמה, ולכן רצות אחרי ההחלה. ‏`admin_move_prep_day` לאותו יום מחזיר בלי שינוי ובלי יומן; יום מקור שאינו נוסף או לא בדף, ויעד תפוס או מחוץ לטווח: `INVALID_INPUT` (‏`detail.field` ‏`from`/`to`). ‏"+ יום הכנה" שולח את ההיסט של היום שלפני המוקדם, והתאריך להכרזה נלקח מ-`addable_days` (בלי חישוב תאריך ב-TS). מפתח ה-idempotency של הוספה והסרה של יום נשמר לפי היום (`useKeyFor`), כך שניסיון חוזר לאותו יום משוחזר ויום אחר מקבל מפתח חדש. עריכת פריט שולחת את הכמות הקיימת כמו שהיא.

- סשן ראשי (2026-10-07): ‏`apply_migration` נדחה גם בסבב 1. המשתמשת הריצה את שתי המיגרציות (`20261006215720_work_sheet_shopping`, ‏`20261007154028_work_sheet_phone_check`) ב-SQL Editor. שתיהן נרשמו ב-`schema_migrations`, ה-advisor נקי, ו-`database.types.ts` נוצר מחדש אחרי כל אחת. ‏`shopping-items`, ‏`work-sheet` ו-`admin-booking` עוברים מול המסד. ‏`grants`, ‏`bind-purchase` ו-`admin-home` נכשלו רק על האובייקטים של 4.2, שהוחלו על המסד המשותף לפני שהקוד שלו היה ב-branch.
- אחרי הבדיקה הראשונה בטלפון היו שלושה סבבי מסך (טבלת נרשמות, ימי הכנה, סרגל הכלים), ונרשמו ב-Spec Change Log ובשורות "בדיקה שנייה בטלפון" ב-Always.

## Spec Change Log

- 2026-10-07, בדיקה בטלפון של המשתמשת (לא ממצא ביקורת): המשתמשת שינתה את הכוונה. נרשמות ותזונה בטבלה אחת בלי טלפון; הוספת כמה פריטים בחלון אחד בלי כמות; ימי הכנה בלי צ׳יפים, עם "+ יום הכנה" אוטומטי ו-X ועריכה רק ליום נוסף; מיקום "+ מנה" ו"הדפסה"; הדגשת הימים; מסך פחות עמוס. מה תוקן: ה-Always, המטריצה ומשימות סבב 2. מה זה מונע: מסך עמוס שקשה לעקוב אחריו, ופרטים כפולים. KEEP: ה-RPC של הקניות (נעילה, יומן, אין יומן בלי שינוי, `CONCURRENT_CHANGE`), ‏`photo_consent` רק ללקוחה פעילה, הוואטסאפ (רק מה שלא נקנה, ‏`aria-disabled` עם הסיבה וב-tab), ההדפסה (A4, בלי עמודה ריקה, קו מחיקה), ותיקוני הביקורת של סבב 1.

## Review Triage Log

סבב 1 (2026-10-07; ‏blind-hunter על כל ה-diff, ‏edge-case-hunter ו-verification-gap על המסד והלוגיקה, ‏intent-alignment). high 0, ‏medium 0, ‏low 13, ‏false 3. ‏verification-gap: אין פערים.

| # | ממצא | פסיקה | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 1 | התזונה והמלווה מופיעות פעמיים במסך: ב-`AttendeeRow` ובחלק התזונה | low | patch | `attendee-row.tsx` מציג `dietaryNotes`/`guestDetails`. בשורות של דף העבודה מעבירים אותם כ-null |
| 2 | `attendeeName` משכפל את חישוב הכותרת של `AttendeeRow` | low | patch | שני מקורות לאותו שם, בהדפסה ובמסך. פונקציה אחת מ-`attendee-row.tsx` |
| 3 | כפתור הוואטסאפ החסום לא בסדר הטאב, והסיבה לא נקראת | low | patch | `<a>` בלי `href` ובלי `tabIndex`. מוסיפים `tabIndex={0}` |
| 4 | תנאי החסימה של הוואטסאפ נבדק משני מקורות | low | patch | `message === null \|\| reason !== null`. מחליטים לפי `whatsappBlockedReason` בלבד |
| 5 | מפתח ה-idempotency לא מתחדש כשהטקסט משתנה | low | patch | אחרי תשובה שאבדה, שליחה מתוקנת מקבלת `IDEMPOTENCY_KEY_REUSED`. מחדשים ב-onChange |
| 6 | בורר `[data-work-sheet-print] *` מיותר ב-`globals.css` | low | patch | הרשימות בתוך `[data-work-sheet]`. נמחק |
| 7 | ההדפסה לא נבדקת: עמודת יום ריקה, `PrintHead`, בלוק ריק | low | patch | נוספות בדיקות markup ל-`work-screens.test.tsx` |
| 8 | בדיקות מסד חסרות: `NOT_FOUND` בעדכון, בסימון ובהוספה למפגש לא קיים, ותוכן before/after ביומן | low | patch | נוספות ל-`shopping-items.test.ts` |

נדחו: שורה חדשה בתוך פריט מפצלת אותו בוואטסאפ (low, השדה הוא input בשורה אחת ורק RPC ישיר מכניס שורה חדשה); אורך עם אימוג׳י (low, פעם שנייה, נוסף ל-`review-accepted.md`); ציון "נפתח בוואטסאפ" (false: ‏EXPERIENCE:418 לא דורש אותו); אורך קישור ברשימה ארוכה (low, לא סביר בבראנץ׳); גוון ה-chip "לא אישרה" (low, סבב העיצוב); אין בדיקת אינטראקציה לצ׳קבוקס (`review-accepted.md`: הזרימה בדפדפן); הרשמה ממתינה בלי chip ו-`photo_consent` בעמוד 3.4 (false: החלטה ב-spec, ושום מסך של 3.4 לא מציג אותו); הסתירה ב-`acceptance-criteria.md:76` תוקנה במסמך וב-memlog של ה-SPEC.

סבב 2 (2026-10-07, אחרי הבדיקות בטלפון; ‏edge-case-hunter, ‏verification-gap ו-blind-hunter על המסד, ‏blind-hunter על המסך). high 0, ‏medium 1, ‏low 17, ‏false 1.

| # | ממצא | פסיקה | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 9 | הטלפונים של הנרשמות נשלחים לדפדפן, אף שהטבלה לא מציגה אותם | medium | patch | `page.tsx` מעביר את `details.attendees` המלאים לרכיב לקוח. ממפים רק לשדות שהטבלה צריכה |
| 10 | אחרי העברת יום ל-`-6`, ‏"+ יום הכנה" מושבת אף שיש ימים פנויים | low | patch | `nextPrepDay` מחפש רק את `earliest-1`. נופלים ליום הפנוי האחרון, ומשביתים רק כשאין יום פנוי |
| 11 | חלון ההעברה נפתח ריק כשאין יום פנוי | low | patch | בלי ימים פנויים התאריך מוצג כטקסט |
| 12 | הפקדים של יום נוסף בתוך ה-`<h4>` של הכרטיס | low | patch | קינון לא תקין ושם כותרת מתוויות הכפתורים. הפקדים יוצאים מהכותרת |
| 13 | שגיאות "+ פריט" לא מוצגות כשגיאה, ולחיצה חסומה בלי משוב | low | patch | גוון שגיאה ו-live region |
| 14 | העיפרון לא ננעל בזמן שמירת הסימון | low | patch | `disabled` בזמן pending |
| 15 | חלון העריכה ושאלת המחיקה לא נוקבים בשם הפריט | low | patch | `item.body` בכותרת |
| 16 | "הועבר לג׳ 20.10" ופועל שונה בכפתור ובחלון | low | patch | "ליום", ופועל אחד |
| 17 | תזונה וכמות לא נחתכות לפני תצוגה | low | patch | מחזירים את הערך החתוך |
| 18 | המגבלות 100 ו-200 מוגדרות פעמיים | low | patch | קבועים מ-`work-sheet-data.ts` |
| 19 | הערה ישנה על `SessionHeader`, ובדיקת "+ פריט" שלא יכולה להיכשל | low | patch | תיקון ההערה והבדיקה |
| 20 | הזזת יום נבדקה עם משימה אחת, ואין בדיקה לברירת מחדל ריקה | low | patch | נוספות ל-`work-sheet.test.ts` |
| 21 | `data-model.md` לא מתאר את `base_days` ואת ההוספה המרובה | low | patch | עודכן בסשן הראשי |

נדחו: ה-backfill של `base_days` (יום בסיס מחוץ לדף, יום בסיס כיעד העברה, בלי בדיקה; low: בפרודקשן הטבלה ריקה כשהמיגרציה רצה, ובמסד הפיתוח 0 מתוך 2 דפים כאלה, נבדק ב-SQL); אורך קישור הוואטסאפ (פעם שנייה, נוסף ל-`review-accepted.md`); שורת יומן לכל פריט בלי מזהה משותף (low, לכל שורה פעולה ומזהה); מספר הסועדות בכותרת (low, ×2 הוסר בהחלטת המשתמשת); "בדיקות המסד לא רצו" (false: ‏`work-sheet` ו-`shopping-items` עברו אחרי ההחלה, ו-`grants` נכשל רק על השורות של 4.2 שהוחלו במסד המשותף).

## Design Notes

סדר הדף (EXPERIENCE.md:325): כותרת · "+ מנה" · ימי הכנה · "הדפסה" · מנות · נרשמות ואישור תמונות · תזונה ואלרגיות · רשימת קניות ("+ פריט", "שליחת הרשימה בוואטסאפ"). ההדפסה לפי המוקאפ (195-207): כותרת "דף עבודה · {קונספט}", שורת יום, תאריך, שעה ומספר נרשמות. מתחת לטבלה עד שלוש עמודות, ובהן "דנה כהן · אישרה" ו"מיכל לוי ×2 · לא אישרה".

```
רשימת קניות · יווני 22.10
פטה כבשים · 1 ק״ג
עגבניות שרי
```

## Verification

**Commands:**
- `npm run test:db` -- הכול עובר, כולל `work-sheet.test.ts`, ‏`admin-booking.test.ts` ו-`grants.test.ts`.
- `npm test`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm run build` -- עוברים.
- `get_advisors` (security) -- רק `0029` ו-`auth_leaked_password_protection`.
- בדיקת כיסוי בסוף (החלטת המשתמשת 2026-10-07, ה-spec נשאר ארוך): עוברים על כל כלל ב-Always/Never, כל שורה במטריצה, כל משימה וכל AC, ולכל אחד מצביעים על הקוד או הבדיקה שמכסים אותו. פריט בלי כיסוי חוסם.

**Manual checks:**
- בטלפון, כאדמין: שלושה פריטים, אחד מסומן כנקנה; הוואטסאפ נפתח עם שני הפריטים שלא נקנו. הדפסה מהמחשב.
