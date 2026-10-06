---
title: 'בית האדמין ו"לטיפול" (4.1)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '779f1c5f74dea178a367da6360dfef4557357d9a'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-admin-home.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** ‏`/admin` מציג היום רק כותרת. טל לא רואה מהטלפון מה המפגש הבא ומה התפוסה, מה מחכה לטיפול שלה (קישור שנעצר, רכישה שלא שויכה, תמונה שלא פורסמה), מה שולם לאחרונה ואילו כרטיסיות עומדות לפוג (CAP-24, מקור §7).

**Approach:** שתי RPC קריאה חדשות: ‏`admin_get_attention_items()`, המקור היחיד של "לטיפול" (AD-22), ו-`admin_get_home()` למפגשים הקרובים עם תפוסה, לכרטיסיות שעומדות לפוג ולסכום החודש. הבית בנוי לפי המוקאפ `key-admin-home.html`, ומשתמש שוב ב-`admin_get_event_details` (סיכום המפגש הבא) וב-`admin_list_payments` (תשלומים אחרונים).

## Boundaries & Constraints

**Always:**
- שתי ה-RPC: ‏`stable security definer`, ‏`set search_path = ''`, בשורה הראשונה `if not private.is_admin() then raise exception 'NOT_AUTHORIZED'`. ‏`revoke` מ-`public, anon, authenticated, service_role` ו-`grant execute` ל-`authenticated` בלבד. בלי idempotency (קריאה). מחזירות `jsonb` בשדות `snake_case`.
- תפוסה רק דרך `private.occupied_places`. תאריכים וגבולות זמן מחושבים ב-SQL לפי `Asia/Jerusalem`. יתרות ותפוגה רק מ-`entitlement_balances`. הסף "עומדת לפוג" נקרא מ-`business_settings.admin_expiring_days` בזמן הקריאה (העמודה קיימת, ברירת מחדל 21). מצב קישור רק דרך `private.join_link_status`.
- **פריטי "לטיפול"** (`kind`), כל אחד נגזר ממצב שמור ונעלם כשהמצב משתנה:
  - `link_conflict`: טוקן `join` עם `state = 'conflict'`, עם `conflict_reason` (גם `bind_conflict`). מוביל ל-`/admin/links`.
  - `link_stuck`: ‏`join_link_status = 'stuck'` (‏`claiming` מעל 15 דקות). מוביל ל-`/admin/links`.
  - `purchase_without_link`: תשלום `approved` עם `customer_id` ריק, שאין לו טוקן `join` חי (`pending`, ‏`awaiting_login`, ‏`claiming`) ואין לו טוקן ב-`conflict`. כל הטוקנים שלו בוטלו או פגו, או שאין טוקן בכלל. מוביל ל-`/admin/links`.
  - `paid_without_place`: ‏`park` של 3.11. זכות `active` עם `pinned_event_id`, שאין שום `bookings` עם ה-`payment_id` שלה. מוביל ל-`/admin/sessions/[pinned_event_id]`.
  - `pinned_seat_held`: הרשמה `confirmed` עם `customer_id` ריק במפגש שעוד לא הסתיים (`ends_at > now()`), שלתשלום שלה יש טוקן ב-`conflict` עם `bind_conflict` ואין טוקן חי. מוביל לעמוד המפגש. השחרור עצמו (`admin_cancel_booking`) נבנה ב-3.6.
  - `media_stuck`: ‏`media_assets.publish_state = 'copying'` ו-`publish_started_at <= now() - interval '15 minutes'`. מוביל ל-`/admin/content`, ופרסום חוזר של העמוד ממשיך מהמצב השמור (5.4).
- כל פריט מחזיר `kind`, ‏`id`, ‏`customer_label` (‏`profiles.full_name`, אחרת `payments.payer_label`, אחרת ריק ← "לקוחה חדשה"), ‏`since` (מתי המצב התחיל) והפרטים שהשורה צריכה (מוצר, סכום, `conflict_reason`, ‏`event_id`, ‏`starts_at`). מיון לפי `since` מהחדש לישן. ‏TS רק ממפה `kind` לכותרת, לפירוט, ל-`status-chip` ול-`href`.
- **הסכום:** ‏`sum(amount_agorot)` ומספר התשלומים ב-`payments` עם `status = 'approved'`, בלי join לאמצעי התשלום, שה-`paid_on` שלהם בחודש המקומי הנוכחי עד היום (מהראשון בחודש עד היום, לפי `Asia/Jerusalem`). הספירה לפי `paid_on` ולא לפי `created_at` (החלטת המשתמשת 2026-10-06). הוא מחושב רק ב-SQL. ‏RPC מחזירה `period_start`, ‏`period_end`, ‏`approved_count`, ‏`approved_agorot`, ‏`net_agorot`. כל עוד אין טבלת החזרים `net_agorot = approved_agorot`, ואין שורת החזרים בתצוגה. 3.7 מוסיף אותה.
- **כרטיסיות שעומדות לפוג:** ‏`kind = 'card'`, ‏`status = 'active'`, לא פגה, ‏`available > 0`, ו-`days_left` (‏`expires_on` פחות היום המקומי) קטן או שווה לסף. ממוין לפי `expires_on`. השורה בלי קישור עד 4.3.
- כותרת הסכום: "תשלומים שאושרו פחות החזרים", עם התקופה ("{חודש} {שנה} · עד היום"). המילים "רווח" ו"הכנסה" לא מופיעות בשום מקום. סכומים ב-`formatAgorot`, תאריכים ב-`lib/time.ts`, מיקרו-קופי ב-`lib/copy/admin.ts` תחת `home`.
- **מפגשים קרובים (החלטת המשתמשת 2026-10-06):** המפגש הבא עם `SummaryCard`, ומתחתיו עד 3 שורות של המפגשים שאחריו: "בראנץ׳ {קונספט} · {יום DD.MM} · {תפוסים}/{מכסה}", כל אחת מקשרת לעמוד המפגש, וקישור "לכל המפגשים".
- סדר הבית: המפגש הבא (`SummaryCard` של 3.4 + "למבט בוקר המפגש") והמפגשים הבאים אחריו ← "לטיפול" (מונה "{n} דברים מחכים לך", ‏`task-row` כיעד יחיד) ← תשלומים אחרונים ("לכל התשלומים") ← כרטיסיות שעומדות לפוג ← הסכום. כל חלק הוא רכיב נפרד, כך ש-4.7 יוסיף קישורים להגדרות בלי לשנות אותם.
- כל מסך מתחיל בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- **שינוי אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-06). השינוי גובר על סדר הבית, על היעדים של הפריטים ועל הנוסחים שלמעלה:**
  - **"לטיפול" בבית:** רק 3 הפריטים החדשים ביותר. כשיש יותר מ-3, מתחתם "לכל הדברים לטיפול ({n})" ל-`/admin/attention`, עמוד חדש עם כל הרשימה (אותו `task-row`, אותו מקור). ב-3 ומטה אין קישור. המונה בבית סופר את כל הפריטים.
  - **כל פריט פותח רק אותו:** ‏`link_conflict`, ‏`link_stuck` ו-`purchase_without_link` מובילים ל-`/admin/links?payment=<payment_id>`. ‏`/admin/links` מסנן לפי `payment` (מתוך `admin_list_links` הקיימת, בלי RPC חדשה) ומציג רק את הקישורים של הרכישה הזו, עם הפעולות שלהם, ומעליהם "לכל קישורי ההצטרפות". מזהה לא תקין או רכישה בלי קישורים: הרשימה המלאה. ‏`paid_without_place` ו-`pinned_seat_held` לעמוד המפגש, ‏`media_stuck` ל-`/admin/content`, בלי שינוי.
  - **"תשלומים אחרונים" יוצא מהבית.** הסדר: המפגש הבא ומפגשים קרובים ← "לטיפול" ← כרטיסיות שעומדות לפוג ← הסכום. ‏`admin_list_payments` לא נקראת מהבית.
  - **המפגש הבא:** הכפתור "לפרטי המפגש" מוביל ל-`/admin/sessions/[id]` (במקום "למבט בוקר המפגש" ו-`/day`, שיוחלף בדף העבודה ב-4.9). כותרת המפגש היא טקסט רגיל, לא קישור.
  - **נוסחים:** הכותרת אומרת מה קרה, והפירוט אומר מה עושים, לפי הטבלה ב-Design Notes (אושרה). השם: ‏`full_name`, אחרת השם לזיהוי שטל נתנה (`payer_label`), ורק בלי שניהם "לקוחה חדשה".

**Never:** לא משנים פונקציות הרשמה או ביטול (`book_*`, ‏`cancel_booking`, ‏`admin_cancel_booking`; 3.6 במקביל). לא בונים פעולות מתוך הבית (שחרור מקום, הפקת קישור). לא מוסיפים פריטים שהמקור שלהם עוד לא קיים: ‏`email_change_pending` ‏(2.8), ‏`choice_pending` ‏(3.8), בקשות החזר (3.7), הרשמות שנפגעו מתיקון (3.13), ‏`notification_jobs` ב-`failed` (5.8), הצהרת נגישות (5.5). אין `reminder-strip` (5.11), אין "לדף העבודה" (4.9) ואין חלק "בקשות החזר פתוחות". אין חישוב תאריכים, השוואה ל-`now()` או סכימת כסף ב-TS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| לקוחה קוראת | ‏`authenticated` שאינה אדמין | ‏`NOT_AUTHORIZED` בשתי ה-RPC | ‏anon: ‏42501 |
| התנגשות | טוקן `conflict` (‏`two_accounts`) | פריט `link_conflict` | אחרי "הפקת קישור חלופי" הקודם `revoked` והפריט נעלם |
| שיוך שנכשל עם מקום | מוצמד, טוקן `conflict`/‏`bind_conflict`, הרשמה בלי לקוחה | שני פריטים: `link_conflict` ו-`pinned_seat_held` | אחרי סוף המפגש `pinned_seat_held` נעלם |
| קישור פג | תשלום לא משויך, הטוקן היחיד פג | ‏`purchase_without_link` | טוקן חלופי חי ← נעלם |
| תקוע | ‏`claiming` לפני 16 דקות / לפני 14 דקות | ‏`link_stuck` / אין פריט | — |
| park | זכות מוצמדת `active` בלי הרשמה | ‏`paid_without_place` | זכות `revoked` ← נעלם |
| תמונה | ‏`copying` לפני 16 דקות / ‏`published` | ‏`media_stuck` / אין פריט | — |
| בית עם 5 פריטים | 5 פריטים | 3 החדשים, מונה 5, "לכל הדברים לטיפול (5)"; ‏`/admin/attention` מציג את כל ה-5 | 3 פריטים: בלי הקישור |
| פריט קישור | לחיצה על `link_conflict` של רכישה A | ‏`/admin/links?payment=A` מציג רק את הקישורים של A ואת "לכל קישורי ההצטרפות" | ‏`payment` לא תקין ← הרשימה המלאה |
| סכום | 3 מאושרים החודש, אחד ב-30.09 בשעה 23:30 (שעון ישראל), ‏`voided` אחד | רק השלושה; 30.09 מחוץ לחודש | — |
| עומדת לפוג | סף 21: ‏`days_left` = 21 עם 2 פנויות / ‏22 / ‏0 פנויות / פגה | רק הראשונה | — |
| אין מפגש | אין מפגש `published` שלא הסתיים | חלק המפגשים: "אין מפגשים קרובים" + "למפגשים" | — |
| ריק | אין פריטים | "אין כרגע דברים לטיפול", בלי מונה | — |

</frozen-after-approval>

## Code Map

- `app/admin/(shell)/page.tsx` -- היום רק כותרת. נבנה מחדש. ‏`layout.tsx` כבר עוטף ב-`<Suspense><RoleGate role="admin">`.
- `app/admin/(shell)/links/page.tsx` -- דפוס: ‏`callRpc(await createClient(), "<rpc>")` ברכיב async תחת `<Suspense>`, שזורק אם `!ok`.
- `app/admin/(shell)/sessions/[id]/load-details.ts` -- ‏`loadDetails`/`detailsSummary` ← ‏`SessionSummary` למפגש הבא (לא מחשבים מחדש תינוקות ואלרגיות). ‏`components/admin/summary-card.tsx` לשימוש כמו שהוא. ‏`sessions/session-draft.ts` › ‏`sessionTitle`. ‏`sessions/[id]/day` הוא "מבט בוקר המפגש".
- `app/admin/(shell)/payments/payment-items.ts` -- שימש לתשלומים האחרונים, שהוסרו אחרי הבדיקה בטלפון.
- `components/shared/{status-chip,page-heading,inline-notice}.tsx` -- לשימוש חוזר. אין עדיין `task-row`: יוצרים `components/admin/task-row.tsx` לפי DESIGN.md:706 (מראה `notification-item`, ‏`::after` על הקישור, chevron ‏`aria-hidden`).
- `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql` -- ‏`private.join_link_status`, ‏`activation_tokens.claiming_at`. ‏`20261004075337_payer_label_review_fixes.sql` -- ‏`admin_list_links` (דפוס ל"טוקן חי" לפי תשלום). ‏`20261004212706_pinned_product_approval.sql` -- ‏park ב-`place_pinned_booking`, ‏`bind_purchase`. ‏`20261005193624_admin_session_details_and_manual_booking.sql` -- ‏`admin_get_event_details` (כותרת definer וה-grant להעתקה). ‏`20261005193920_media_upload_and_publish.sql` -- ‏`media_assets`.
- `supabase/tests/admin-booking.test.ts:~543` -- דפוס בדיקת `NOT_AUTHORIZED` (‏`errorAs`). ‏`support/{db,money}.ts` -- ‏`inRollback`, ‏`asAuthenticated`, ‏`seedMoney`, ‏`approve`, ‏`insertAuthUser`. ‏`pinned-approval.test.ts` (park), ‏`link-lifecycle.test.ts` (stuck, conflict). ‏`grants.test.ts` › ‏`EXPECTED_GRANTS`.
- `lib/copy/admin.ts` (מפתח חדש `home`), ‏`lib/copy/shell.ts` (`homeTitle`), ‏`lib/money.ts`, ‏`lib/time.ts`. ‏`lib/nav.ts` ו-`lib/errors.ts` לא משתנים (אין קוד שגיאה חדש).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_admin_home.sql` -- ‏`admin_get_attention_items()` ו-`admin_get_home()` לפי Always. ‏`admin_get_home` מחזירה `{upcoming_sessions: [{event_id, concept_name, kind, starts_at, ends_at, occupied, capacity}] (‏published, ‏ends_at > now(), ממוין, עד 4), expiring_cards: [{entitlement_id, customer_label, product_name, available, expires_on, days_left}], totals: {...}}`. יוצרים ב-`npx supabase migration new admin_home`, מחילים ב-`apply_migration`, ואז `get_advisors` (רק WARN 0029 מאושר) ו-`generate_typescript_types` ← `lib/supabase/database.types.ts`.
- [x] `supabase/tests/admin-home.test.ts` + `grants.test.ts` -- כל שורה במטריצה (הופעה והיעלמות של כל `kind`, גבולות 15 הדקות, גבול החודש בשעון ישראל ו-`voided`, גבול הסף ו-0 פנויות), ‏`NOT_AUTHORIZED` ללקוחה ו-42501 ל-anon. זמן מדומה ב-`update` של `claiming_at`/`publish_started_at`/`paid_on`.
- [x] `app/admin/(shell)/home-items.ts` (+test) -- פונקציות טהורות: שורת RPC ← פריט תצוגה (כותרת ופירוט לפי טבלת הנוסחים, chip, ‏`href` לפי `kind`), כרטיסייה עומדת לפוג ותקופת הסכום. בדיקה: כל `kind` ממופה, ו"רווח"/"הכנסה" לא מופיעים בשום ערך של `adminCopy.home`.
- [x] `app/admin/(shell)/page.tsx` + רכיבי חלקים ב-`app/admin/(shell)/home/*.tsx` -- הבית לפי הסדר ב-Always. כל חלק ב-`<Suspense>` משלו עם `shellCopy.loading`. מתחילים בסקיל `frontend-design`.
- [x] `components/admin/task-row.tsx` (+test) -- ‏`task-row`: כותרת, פירוט, מטא (זמן יחסי לא נדרש: "מאז DD.MM"), ‏`status-chip`, יעד יחיד.
- [x] `lib/copy/admin.ts` -- ‏`adminCopy.home`: כותרות החלקים, מונה, ריקים, כותרות ופירוטי הפריטים לכל `kind` ו-`conflict_reason` (הסיבות כמו ב-2.4), "{n} כניסות פנויות · בתוקף עד DD.MM", כותרת הסכום ותקופתו.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- סוגרים את שלוש הרשומות עם target 4.1 (park, ‏`copying`, וחלק התצוגה של ההרשמה המוצמדת) עם `status`. מוסיפים: קישור מ"עומדות לפוג" לכרטיסיות פתוחות (4.3), שורת החזרים בסכום וחלק בקשות החזר (3.7).
- [x] `_bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/tickets.toml` -- 4.1 מסומן done (ב-PR).

**Acceptance Criteria:**
- Given טל מחוברת עם נתונים בדויים מ-E2 ו-E3, when היא פותחת את `/admin` בטלפון, then כל רשימה תואמת את המסד, ולחיצה על שורת "לטיפול" מובילה למקום הטיפול.
- Given שתי ה-RPC, when ה-security advisor רץ, then אין WARN או ERROR חוץ מ-0029.
- Given `npm run lint`, ‏`typecheck`, ‏`npm test`, ‏`npm run test:db` ו-`npm run build`, then כולם עוברים.

## Implementation Notes

- מיגרציה `20261005225116_admin_home.sql`. ה-advisor: רק WARN ‏0029 ו-`auth_leaked_password_protection` המאושרים.
- ‏`since`: לטוקן ב-`conflict` אין חותמת זמן משלו, ולכן `coalesce(claiming_at, created_at)`. ‏`purchase_without_link`: מועד הביטול או התפוגה האחרון (בלי טוקנים: יצירת התשלום). ‏`paid_without_place`: יצירת הזכות.
- טוקן `claiming` (גם תקוע) נחשב חי ל-`purchase_without_link` ול-`pinned_seat_held`, כדי שאותו מצב לא יופיע פעמיים.
- ‏`StatusChip` קיבל גוון `error` (DESIGN › status-chip error) לצ׳יפ "התנגשות".
- נוסח חדש שלא בטבלה: "כניסה פנויה אחת" לכרטיסייה עם כניסה אחת (במקום "1 כניסות פנויות").
- אחרי הבדיקה בטלפון: ‏`HOME_ATTENTION_LIMIT = 3` ו-`AttentionRows` משותפים לבית ול-`/admin/attention`. ‏`/admin/links?payment=` מסונן ב-`filterByPayment` (`links/link-items.ts`), בלי RPC חדשה. ‏`purchase_without_link` מקשר לפי ה-`id` שלו (התשלום). הנוסחים לפי `conflict_reason` ב-`adminCopy.home.items`. "תשלומים אחרונים" הוסר מהבית ומהטעינה. הקובץ `home/recent-payments.tsx` לא בשימוש, והסשן הראשי מוחק אותו.
- ‏`admin_get_home` נקרא פעם אחת לבקשה (`cache()` ב-`home/load-home.ts`). סוג "לטיפול" שהמסך לא מכיר מדולג.
- 4.1 סומן done בקובץ `story-admin-home-tracer-with-attention-items.md` (כמו 4.12), כי ל-`tickets.toml` אין שדה סטטוס.

## Spec Change Log

- **2026-10-06, הבדיקה בטלפון (החלטת המשתמשת):** בבית מוצגים רק 3 פריטי "לטיפול" עם קישור לעמוד המלא `/admin/attention`. פריט קישור פותח רק את הרכישה שלו (`/admin/links?payment=`). "תשלומים אחרונים" יצא מהבית. "לפרטי המפגש" מחליף את "למבט בוקר המפגש", כי `/day` יוחלף בדף העבודה ב-4.9 (demo-scope). הנוסחים של "לטיפול" נכתבו מחדש, כדי שטל תבין מה קרה ומה לעשות. מה שנמנע: רשימה ארוכה בבית, כותרות טכניות ("התנגשות", "רכישה בלי קישור פעיל") ומסך קישורים מלא שלא מראה איזה קישור צריך טיפול. **KEEP:** שתי ה-RPC והבדיקות שלהן בלי שינוי; ‏`task-row`, ‏`home-items.ts` כמקום היחיד של המיפוי, החלקים ב-`<Suspense>` נפרדים, `SummaryCard` ו"מפגשים קרובים".

## Review Triage Log

**סבב 1 (2026-10-06), ארבעה מבקרים.** ‏high 0 · ‏medium 0 · ‏low 15 · ‏false 6 · ‏maybe-false 0. חמישה low תוקנו כ-patch, ועשרה נדחו. אין intent_gap ואין bad_spec.

| ממצא | פסק | ניתוב | ראיה ופעולה |
|---|---|---|---|
| ‏`attentionCount(1)` = "1 דברים מחכים לך" (blind) | low | patch | יחיד: "דבר אחד מחכה לך", עם בדיקה |
| החלקים עם נתונים לא נבדקים (verification, blind) | low | patch | ‏`empty-states.test.tsx`: חמישה מפגשים, מפגש אחד, שני פריטים |
| ‏`customer_label` מהפרופיל לא נבדק ב"לטיפול" (verification) | low | patch | park עם לקוחה, בדיקה של השם המלא |
| כרטיסייה מבוטלת ב"עומדות לפוג" לא נבדקת (verification) | low | patch | כרטיסייה `revoked` בתוך הסף לא מוחזרת |
| בדיקות חסרות: סדר `admin_list_payments`, ‏`since` של קישור פג או מבוטל, היעלמות `pinned_seat_held` כשיש קישור חי, והערה בבדיקת הסכום שמבטיחה שעה (verification, blind, edge) | low | patch | נוספו לבדיקות הקיימות, וההערה נוסחה מחדש |

**נדחו (16):** ‏false: ‏`voided` (אין פעולה שקובעת אותו, AD-10); סף ריק (`not null`); הרשמה מוצמדת מבוטלת כ"שולם בלי מקום" (3.6 מחזיר אותה כזכות); ‏`done` לפני בדיקת הטלפון (ה-commit בא אחריה); ‏`conflict_reason` ריק (אותה נפילה כמו ב-2.4); חלק בקשות החזר (מחוץ ל-intent). ‏low ונדיר או לפי ה-spec: מפגש הבא שנעלם בין שתי קריאות; park בלי סוף ויעד הקישור שלו (אין מסלול שקורא ל-park); מקום תפוס בסיבת התנגשות אחרת (מופיע כ-`link_conflict`); גבול 15 הדקות המדויק; ‏`<time>` סביב שורה שלמה; ‏50 תשלומים במקום 5; מוצר וימים בכרטיסייה; שגיאה אחת מפילה את הדף (כמו בשאר האדמין); "רווח" רק ב-`adminCopy.home`; חמש שורות טעינה. ממצאי ה-intent-alignment תיאוריים ותואמים את ה-spec.

## Design Notes

**למה שתי RPC ולא אחת:** "לטיפול" הוא מקור יחיד שכל סיפור עתידי מרחיב (2.8, ‏3.7, ‏3.8, ‏3.13, ‏5.5, ‏5.8). הפרדה מהבית שומרת אותו קטן וממוקד, ומאפשרת להציג מונה גם במקום אחר.

**שימוש חוזר:** סיכום המפגש הבא מגיע מ-`admin_get_event_details` ו-`detailsSummary`, כדי ש"תינוקות" ו"אלרגיות" יחושבו בבית בדיוק כמו בעמוד המפגש.

**נוסחים (אושרו, המשתמשת 2026-10-06, אחרי הבדיקה בטלפון).** ‏{שם} = ‏`full_name`, אחרת `payer_label`, אחרת "לקוחה חדשה". הצ׳יפים לא משתנים. בדיקה שנייה בטלפון: הפירוט בלי מוצר, סכום ותאריך אישור (הם בכרטיס שנפתח), קצר ככל האפשר, בלי הגבלת שורות (שתיים, ושלוש כשצריך).

| מקום | נוסח |
|---|---|
| כותרות חלקים | המפגש הבא · מפגשים קרובים · לטיפול · כרטיסיות שעומדות לפוג · תשלומים שאושרו פחות החזרים |
| מונה / ריק / קישור | {n} דברים מחכים לך (1: דבר אחד מחכה לך) · אין כרגע דברים לטיפול · לכל הדברים לטיפול ({n}) |
| המפגש הבא | כפתור: לפרטי המפגש |
| מסך הקישורים המסונן | לכל קישורי ההצטרפות |
| `two_accounts` | ההצטרפות של {שם} נעצרה · המייל והטלפון שייכים לשתי לקוחות שונות. צריך לברר איתה ולהפיק קישור חדש |
| `not_activated` | ההצטרפות של {שם} נעצרה · המייל שייך לחשבון שעוד לא הופעל. צריך לברר איתה ולהפיק קישור חדש |
| `phone_taken` | ההצטרפות של {שם} נעצרה · הטלפון כבר רשום אצל לקוחה אחרת. צריך לברר איתה ולהפיק קישור חדש |
| `too_many_attempts` | ההצטרפות של {שם} ננעלה · 3 ניסיונות עם פרטים שלא מתאימים. צריך לברר איתה ולהפיק קישור חדש |
| `bind_conflict` (וסיבה לא מוכרת) | הרכישה של {שם} לא נוספה לחשבון שלה · כבר רשומה לאותו מפגש או כבר השתתפה בהיכרות. צריך להחליט מה לעשות ברכישה |
| `link_stuck` | {שם} לא סיימה להצטרף · התחילה ולא סיימה. פתיחה חוזרת של אותו קישור תמשיך מאותה נקודה |
| `purchase_without_link` | ל{שם} אין קישור הצטרפות בתוקף · הקישור פג או בוטל לפני שהצטרפה. אפשר להפיק קישור חדש בלי תשלום נוסף |
| `paid_without_place` | {שם} שילמה ואין לה מקום · שילמה לבראנץ׳ {קונספט} {DD.MM} והמפגש היה מלא. צריך למצוא מקום או להחליט על החזר |
| `pinned_seat_held` | מקום שמור למי שלא הצטרפה ({שם}) · הרכישה לא נוספה לחשבון, והמקום בבראנץ׳ {קונספט} {DD.MM} תפוס. אפשר לשחרר בעמוד המפגש |
| `media_stuck` | תמונה לא פורסמה עד הסוף · הפרסום נעצר באמצע. כדי לסיים, פרסמי שוב את העמוד בתוכן האתר |
| כרטיסייה | {שם} · {n} כניסות שלא נרשמה אליהן (1: כניסה אחת שלא נרשמה אליה) · בתוקף עד {DD.MM} ("בתוקף עד" והתאריך תמיד באותה שורה) (המשתמשת 2026-10-06: המספר הוא הכניסות הפנויות), chip expiring "עומדת לפוג" |
| סכום | {חודש} {שנה} · עד היום · תשלומים שאושרו ({n}) |
| אין מפגש | אין מפגשים קרובים · למפגשים |

## Verification

**Commands:**
- `npm run test:db` -- expected: ‏`admin-home.test.ts` ו-`grants.test.ts` עוברים.
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: הכול עובר.

**Manual checks:**
- בטלפון של המשתמשת: הבית על נתונים בדויים, כל חלק תואם את המסד, אין "רווח" או "הכנסה".
