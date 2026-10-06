---
title: 'הגדרות ותבניות התראה (4.7)'
type: 'feature'
baseline_commit: '48122ff66d424fa98c6af56cfdf95281b11fe4ec'
created: '2026-10-06'
status: 'done'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/admin-configurable-parameters.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** ל-`business_settings` ול-`notification_templates` אין מסך ואין RPC כתיבה. תבנית שגויה (שדה `{…}` שהסוג לא מעביר, או סוגריים לא מאוזנים) תפיל כל enqueue של הסוג ותבטל את התשלום או ההרשמה שקראו לו.

**Approach:** ‏`/admin/settings` עם כל ברירות המחדל, ו-`/admin/settings/templates` לכותרת ולגוף לכל סוג. שני RPC של אדמין עם idempotency, בדיקת גרסה ו-audit. לכל סוג רשימת שדות מותרים במסד, ו-RPC התבנית דוחה תבנית שלא מתרנדרת איתם.

**החלטת המשתמשת 2026-10-06:** כל שינוי הגדרה ותבנית נשמר ב-`value-change-row` (ישן ← חדש, בלי צ׳קבוקס), לפי המקור §7 ו-EXPERIENCE. לא `sensitive-confirm-dialog`, ולא רישום ב-`sensitive-actions.ts`.

## Boundaries & Constraints

**Always:**
- ההגדרות שנערכות: `default_validity_days`; סגירת הרשמה (`registration_close_days_before` + `registration_close_local_time`, שורה אחת); `default_capacity_regular`, ‏`default_capacity_couple`; ‏`cancel_window_hours`; ‏`credit_options_count`; ‏`reminder_lead_hours`; ‏`admin_expiring_days`, ‏`customer_expiring_days`; ‏`last_places_threshold`; ‏`default_prep_days`; ‏`inactivity_months`; ‏`duplicate_payment_window_days`; שעות מפגש חדש (`default_session_start_time` + `default_session_end_time`, שורה אחת).
- ‏`admin_update_business_settings(p_changes jsonb, p_expected_version int, p_idempotency_key uuid)`: ‏`is_admin` ראשון, idempotency, רשימה סגורה של מפתחות, בדיקת טיפוס וטווח לכל ערך (`INVALID_INPUT` עם `detail.field`), נעילת השורה, ‏`version` שונה מהצפוי ← `STALE_VERSION`. שומר רק אם משהו השתנה: ‏`version + 1`, ‏`updated_at = now()`, ‏`private.audit(..., 'business_settings', null, ...)`. מחזיר את השורה החדשה.
- טווחי שפיות (מגבלה טכנית, לא ערך עסקי): תוקף 1–730 ימים; סגירה 0–7 ימים לפני, בשעה 03:00–23:59; מכסה 1–100; חלון ביטול 0–336 שעות; חלופות זיכוי 1–10; תזכורת 1–168 שעות; ספי "עומדת לפוג" 0–90; "מקומות אחרונים" 0–50; ימי הכנה 1–7 ערכים שונים בין -6 ל-0, נשמרים ממוינים; חוסר פעילות 1–24 חודשים; תשלום כפול 0–60 ימים; שעות `HH:MM`, סיום אחרי התחלה.
- עמודה חדשה `notification_templates.allowed_vars text[] not null default '{}'`, עם seed לפי מה שהקוראים מעבירים (Design Notes).
- ‏`admin_update_notification_template(p_type text, p_title text, p_body text, p_expected_version int, p_idempotency_key uuid)` משנה רק `title` ו-`body`, מעלה `version`, קובע `updated_at` ו-`updated_by = auth.uid()`. ‏`push`, ‏`body_mode`, ‏`recipient_kind` ו-`allowed_vars` לא נוגעים בהם. ב-`body_mode = 'override'` הגוף חייב להיות null; בשאר חובה. כותרת 1–200, גוף 1–1000 (אחרי btrim).
- בדיקת התבנית: `private.render_notification_text` על הכותרת ועל הגוף עם אובייקט שבו כל שדה מותר מקבל ערך בדוי. אם היא זורקת ← `TEMPLATE_INVALID` עם `detail.field` ‏(`title`/`body`). בלי לשנות את `render_notification_text`.
- ‏audit של תבנית: ‏`p_old = to_jsonb(old) - 'type'`, ‏`p_new = to_jsonb(new)`, כדי שהסוג יישמר ב-after (‏`audit_diff` שומר רק עמודות שהשתנו).
- האדמין קורא תבניות דרך policy ‏select עם `(select private.is_admin())` ו-`grant select` מפורש, כמו `business_settings`.
- ‏`lib/admin/template-check.ts` בודק אותו דבר ב-TS, רק לחיווי מיידי. השרת קובע.
- הערות היקף: חלון ביטול וזמן תזכורת "חל רק על הרשמות חדשות"; חלופות זיכוי "חל רק על זיכויים חדשים"; השאר "חל רק על מה שייווצר מעכשיו". ליד חלון הביטול גם "שינוי מדיניות שמוצג ללקוחות" ותזכורת לעדכן את נוסח התנאים, עם קישור ל-`/admin/content/terms`.
- שורה "פרטי העסק" שמובילה ל-`/admin/content/contact` (אותה רשומה, לא עותק). "הגדרות" נוסף בסוף `adminMoreNav`.
- בניית המסכים מתחילה בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.

**Never:**
- לא משנים את `notification_jobs`, את `private.enqueue_notification`, את התור או את `render_notification_text` (5.8 עובד עליהם).
- לא משנים שם עמודה ב-`business_settings` (4.9 קורא את `default_prep_days`).
- לא מציגים את תוקף הקישור (48 שעות), את `marketing_reminder_schedule` (5.11) ואת אמצעי התשלום (2.7).
- לא משנים הרשמות, זכויות, זיכויים או מפגשים קיימים. ‏`policy_snapshot` של הרשמה קיימת לא משתנה.
- לא מסך יומן (4.5). הרישום ב-`audit_log` בלבד.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| שינוי מכסה | רגיל 12 ← 14 | מפגש שנוצר אחרי: 14. מפגש קיים: 12. ‏audit ‏before `{default_capacity_regular:12}` after `{…:14}` | — |
| חלון ביטול | 48 ← 24, הרשמה קיימת | הרשמה קיימת שומרת 48 ב-`policy_snapshot`, הרשמה חדשה 24 | — |
| גרסה ישנה | `p_expected_version` 3, במסד 4 | לא נשמר | `STALE_VERSION` |
| ערך מחוץ לטווח / מפתח לא מוכר | `{"cancel_window_hours":-1}` / `{"version":9}` | לא נשמר | `INVALID_INPUT`, ‏`detail.field` |
| שעות הפוכות | סיום 10:00, התחלה 10:30 | לא נשמר | `INVALID_INPUT`, ‏field `default_session_end_time` |
| אותו מפתח | קריאה חוזרת | התוצאה הקודמת, בלי audit שני | — |
| תבנית תקינה | `booking_confirmed` "נתראה ב{date} ב-{time}" | ‏version+1, התראה חדשה בנוסח החדש, התראה קיימת לא משתנה | — |
| שדה לא מותר | `booking_cancelled` עם `{expires_on}` | לא נשמר | `TEMPLATE_INVALID`, field `body` |
| סוגריים | "נתראה {date" / "}" / "{}" / "{a{date}" | לא נשמר | `TEMPLATE_INVALID` |
| גוף ב-override | `broadcast` עם גוף | לא נשמר | `INVALID_INPUT`, field `body` |
| לא אדמין | לקוחה קוראת לאחד מה-RPC | — | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql:245-272,410,429` -- ‏`business_settings`, ה-checks, ‏policy ‏select לאדמין, ‏grant select.
- `supabase/migrations/20261001184225_create_notification_core.sql:25-46,356` -- ‏`notification_templates` (RLS בלי policy, ‏revoke all). ‏`20261005231322_booking_cancelled_pinned_type.sql` -- 14 הסוגים.
- `supabase/migrations/20260930191525_create_rpc_contract.sql:34,91,164` -- ‏`idempotent_begin/finish`, ‏`audit_diff`. ‏`20260930193304_fix_reset_begin_and_audit.sql:69` -- ‏`private.audit`.
- `supabase/migrations/20261004102035_product_catalog_admin.sql:320-381,488-498` -- ‏`admin_update_product`: הדפוס להעתקה (סדר הבדיקות, ‏revoke/grant).
- קוראי `enqueue_notification` (גוף חי במסד): ‏`private.notify_booking_confirmed`, ‏`public.admin_approve_payment` (‏purchase_repeat), ‏`private.bind_purchase` (‏purchase_new_card), ‏`private.cancel_core`.
- `components/admin/value-change-row.tsx:17,30` -- ‏`ValueChangeRow`, ‏`ValueSaveResult`. שימוש: `app/admin/(shell)/sessions/[id]/edit/session-editor.tsx:107`, ‏`app/admin/(shell)/products/[id]/product-editor.tsx`.
- `app/admin/(shell)/products/` -- מבנה מסך להעתקה (`page.tsx`, ‏`actions.ts` עם `callRpc` ו-`ActionResult`, עורך לקוח, ‏`newIdempotencyKey()`).
- `lib/nav.ts:21-25` (‏`adminMoreNav`), ‏`lib/nav.test.ts`, ‏`app/admin/(shell)/more/page.tsx`, ‏`lib/copy/admin.ts` (מפתח חדש `settings`, ‏`valueChange` ב-579). קבצים משותפים עם 4.9: מוסיפים שורה בסוף, לא מסדרים מחדש.
- `lib/errors.ts:6` -- ‏`ERROR_MESSAGES`; חדשים: `STALE_VERSION`, ‏`TEMPLATE_INVALID`.
- `components/admin/` -- רכיב פריט התראה של 5.7 (‏`notification-item`) לתצוגה המקדימה.
- `supabase/tests/business-settings.test.ts`, ‏`notifications.test.ts:256`, ‏`cancel-booking.test.ts`, ‏`product-catalog.test.ts` (סגנון).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_business_settings_and_templates.sql` -- עמודת `allowed_vars` + seed, policy ו-grant לקריאת תבניות, ‏`private.template_sample_vars(text[])`, שני ה-RPC עם revoke/grant ל-`authenticated`. החלה ב-MCP, ‏`get_advisors`, ‏`database.types.ts` מחדש.
- [ ] `supabase/tests/settings-and-templates.test.ts` -- כל שורות המטריצה, ועוד: כל תבנית ב-seed מתרנדרת עם `template_sample_vars(allowed_vars)`; לכל סוג שיש לו קורא (‏`booking_confirmed`, ‏`purchase_repeat`, ‏`purchase_new_card`, ‏`booking_cancelled`, ‏`booking_cancelled_pinned`) עורכים את התבנית כך שתשתמש בכל השדות המותרים ומריצים את הזרימה האמיתית, וההתראה נוצרת ומרונדרת.
- [ ] `lib/errors.ts` -- ‏`STALE_VERSION` ("ההגדרה השתנתה בינתיים. צריך לרענן את הדף"), ‏`TEMPLATE_INVALID`.
- [ ] `lib/admin/template-check.ts` + test -- ‏`checkTemplate(text, allowed)` ← `{ok}` או `{ok:false, reason: 'unknown_field'|'unbalanced', field?}`; אותם מקרים כמו במסד.
- [ ] `app/admin/(shell)/settings/{page.tsx,actions.ts,settings-editor.tsx}` + tests -- קבוצות: פרטי העסק (קישור), הרשמה וביטול, מפגש חדש, מוצר חדש, זיכוי ותזכורת, התראות וספים, דף עבודה, ‏"תבניות התראות" (קישור). כל שורה `ValueChangeRow` עם תצוגה קריאה ("יום לפני ב-20:00", "48 שעות", "יום לפני · יום המפגש"). שמירה ← `inline-notice` success; כשל ← הערך הקודם נשאר והודעת השגיאה.
- [ ] `app/admin/(shell)/settings/templates/{page.tsx,[type]/page.tsx,[type]/template-editor.tsx,actions.ts}` + tests -- רשימה לפי סוג עם שם בעברית ונמענת (לקוחה/טל); עורך כותרת וגוף, צ׳יפים שמוסיפים `{שדה}` מותר, תצוגה מקדימה כפריט התראה עם ערכים לדוגמה, חיווי מ-`checkTemplate`, שמירה ב-`ValueChangeRow` ("חל על התראות חדשות בלבד"). ב-override: רק כותרת והערה "גוף ההודעה נכתב בכל שליחה".
- [ ] `lib/copy/admin.ts` -- `settings`: כותרות, שמות שדות, הערות היקף, שמות סוגי התראה, ערכים לדוגמה לכל שדה.
- [ ] `lib/nav.ts` -- "הגדרות" (`/admin/settings`) בסוף `adminMoreNav`.
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/tickets.toml` -- 4.7 ‏done (ב-PR).

**Acceptance Criteria:**
- Given טל שינתה תזכורת 24 ← 12, when לקוחה נרשמת, then `policy_snapshot.reminder_lead_hours` = 12, והרשמה ישנה נשארת 24.
- Given טל ב-`/admin/settings` בטלפון, when היא משנה ערך, then רואה "{שדה}: {ישן} ← {חדש}" והערת היקף, ושום דבר לא נשמר לפני "לשמור את השינוי".
- Given תבנית עם שדה לא מותר בטופס, when טל מקלידה, then החיווי מופיע לפני השמירה, והשמירה (אם נשלחה) נדחית בשרת.

## Implementation Notes

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 2, low 6, false 3, maybe-false 1; השאר low שנדחו.

| # | עדשה | ממצא | verdict | route | ראיה / פעולה |
|---|---|---|---|---|---|
| 1 | verification-gap | אין בדיקה שאדמין קורא את התבניות (policy חדש) | medium | patch | ‏policy שגוי משאיר את כל הבדיקות ירוקות ואת המסך ריק. בדיקה: אדמין מקבל 14 שורות |
| 2 | verification-gap | הערת המדיניות והקישור ל-terms ליד חלון הביטול לא נבדקים במצב שינוי | medium | patch | ‏`scopeOf` לא נבדק; בדיקת רינדור של שורה עם שינוי |
| 3 | verification-gap, edge | שמות הסוגים ב-copy לא קשורים לסוגים במסד | low | patch | סוג חדש בלי copy ← קישור ל-404. בדיקת מסד שמשווה |
| 4 | edge, blind | ‏`btrim` מסיר רק רווחים; כותרת של `\n\t` נשמרת | low | patch | ‏`btrim` עם רווח, טאב, שורה ו-NBSP, במיגרציית תיקון |
| 5 | edge | ‏`STALE_VERSION` נבדק אחרי בדיקת השעות, ולכן גרסה ישנה מחזירה `INVALID_INPUT` | low | patch | בדיקת הגרסה מיד אחרי הנעילה, בשני ה-RPC |
| 6 | edge, blind, verification-gap | אורך ב-JS נספר ביחידות UTF-16, ובשרת בתווים | low | patch | ‏`[...text].length` |
| 7 | blind | ‏`STALE_VERSION` אומר "ההגדרה" גם במסך התבניות | low | patch | נוסח כללי |
| 8 | verification-gap | עריכת גוף `purchase_new_card` משנה גם את `{card_tip}` של רכישה חוזרת, בלי הערה | medium | patch | אומת (‏`'. ' \|\| t.body`). הערה בעורך של הסוג הזה |
| 9 | edge, blind, intent | ‏`allowed_vars` של 9 סוגים בלי קורא הוא הבטחה שלא נבדקה | medium (unverified) | defer | נבדק רק ל-5 הסוגים שיש להם קורא; כל סיפור שמוסיף קורא צריך בדיקת זרימה אמיתית |

נדחו: שדה שמגיע ריק (`{card_tip}` לבד, low, נדיר; ‏`expires_on` כבר לא מותר); כשל רינדור מבטל את הפעולה (קיים מ-2.12, ו-enqueue מחוץ להיקף); בדיקה עצמית במיגרציה (ה-seed סטטי ונבדק); סגירה ביום המפגש אחרי תחילתו (low, ה-trigger סוגר בתחילת המפגש); סף "עומדת לפוג" ארוך מהתוקף (low, בחירה עסקית); טווחים כפולים ב-TS וב-SQL (low, השרת קובע); גרסה אחת לכל השורה (low, החלטת spec, ההודעה אומרת לרענן); השדה שנכשל לא מועבר (false: החלק השני הוא הערך השמור); חיווי לאורך כותרת בפוש (low, לא בכוונה); צ׳יפ לפני פוקוס (maybe-false low); ימי הכנה מחוץ לטווח (false: אין כותב אחר); בדיקות idempotency עם payload אחר (false: ב-`idempotency.test.ts`); השפעה של שאר ההגדרות (low, הקריאה בזמן היצירה קיימת, AD-15); ‏`renderToStaticMarkup` (ב-review-accepted).

## Design Notes

**`allowed_vars` (seed):** ‏`booking_confirmed` {date,time,concept} · ‏`purchase_repeat` {product,expires_on,card_tip} · ‏`purchase_new_card` {} · ‏`booking_cancelled` {date} · ‏`booking_cancelled_pinned` {date} (‏`expires_on` ריק במצב ממתינה, ו-3.6 דחה אותו מאותה סיבה) · ‏`reminder` {date,time} · ‏`waitlist_spot` {date} · ‏`event_cancelled` {date} · ‏`event_changed` {date,new_date,new_time} · ‏`entitlement_changed` {expires_on,units} · ‏`card_expiring` {units,expires_on} · ‏`admin_card_expiring` {customer,units,expires_on} · ‏`broadcast`, ‏`marketing_reminder` {}.

**חוזה לקוראים עתידיים:** קורא של סוג מעביר את כל `allowed_vars` שלו. סיפור שמוסיף שדה (למשל 5.17 ב-`reminder`) מעדכן את `allowed_vars` באותה מיגרציה. כך תבנית שעברה את הבדיקה תמיד מתרנדרת.

**בדיקת התבנית ב-SQL:**
```sql
begin
  perform private.render_notification_text(p_title, private.template_sample_vars(v_t.allowed_vars));
exception when sqlstate 'P0001' then
  raise exception 'TEMPLATE_INVALID' using errcode = 'P0001', detail = '{"field":"title"}';
end;
```

**ימי הכנה בטופס:** שבעה צ׳יפים מ"6 ימים לפני" עד "יום המפגש" (-6..0), לפחות אחד.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- ירוק.
- `npm run test:db` -- ירוק, כולל `notifications.test.ts` ו-`cancel-booking.test.ts`.
- `npm run build` -- עובר.

**Manual checks:**
- בטלפון: עוד ← הגדרות, שינוי מכסה ושמירה; עריכת תבנית עם שדה לא מותר (חיווי) ועם תקין (תצוגה מקדימה).
