---
title: 'פרופיל, תינוקות ואישור תמונות (2.10)'
type: 'feature'
created: '2026-10-06'
status: 'done'
route: 'full'
route_source: 'auto'
baseline_commit: '779f1c5f74dea178a367da6360dfef4557357d9a'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** ללקוחה אין מסך פרופיל: היא לא רואה ולא מתקנת את השם, התינוקות, האלרגיות וההעדפות, ולא יכולה לשנות את אישור השימוש בתמונות שנתנה בהצטרפות (CAP-8, ‏CAP-40). גם הבדיקות של תאריך הלידה ומספר התינוקות קיימות רק ב-`join_complete`, אף שהטבלה `babies` פתוחה לכתיבה ישירה (deferred-work, יעד 2.10).

**Approach:** מסך `/me/profile` עם שמירה נפרדת לכל חלק. שם ותזונה נכתבים ב-update ישיר לפי עמודות (AD-1). כל תינוק נשמר, נוסף או נמחק בכתיבה אחת, ו-trigger במסד אוכף עליו את הכללים. אישור התמונות עובר ב-RPC חדש, `set_photo_consent`, שרושם מועד, גרסת נוסח ויומן.

## Boundaries & Constraints

**Always:**
- **מה הלקוחה עורכת:** שם, תינוקות (שם ותאריך לידה), אלרגיות והעדפות (שדה טקסט אחד) ואישור תמונות. טלפון ומייל מוצגים לקריאה בלבד, בלי שורת "לשינוי… צרי קשר" (החלטת המשתמשת 2026-10-06 בבדיקה בטלפון). בלי "טל" בשום נוסח ללקוחה.
- **שדות ריקים:** שדה ריק לא מוצג. תזונה ריקה נשמרת כ-`null` ולא כמחרוזת ריקה.
- **החלטות המשתמשת (2026-10-06):**
  - **כניסה לפרופיל:** לשונית "פרופיל" אחרונה ב-`customerNav`.
  - **אישור התמונות:** אותה שאלה ושתי התשובות כמו בהצטרפות, עם התשובה הנוכחית מסומנת וכפתור שמירה.
  - **גיל:** מתחת לשנה כמו היום (פחות משבוע, שבועות, חודשים). משנה ומעלה בשנים וחודשים: "שנה", "שנה וחודש", "שנה וחודשיים", "שנה ו-3 חודשים", "שנתיים", "שנתיים ו-5 חודשים", "3 שנים", "3 שנים וחודש". חל גם על שורת הנרשמת באדמין. מחושב לתצוגה בלבד ב-`lib/time.ts` מהיום המקומי (Asia/Jerusalem), בלי כתיבה יומית.
- **אכיפה במסד:** trigger על `babies` בודק:
  - תאריך הלידה לא אחרי היום המקומי (`INVALID_INPUT`, ‏`field: birth_date`).
  - עד 10 תינוקות ללקוחה (`INVALID_INPUT`, ‏`field: babies`).
  - לקוחה לא מוחקת את התינוק האחרון שלה (`LAST_BABY`; החלטת המשתמשת 2026-10-06). הכלל חל רק כשהמוחקת היא הלקוחה עצמה (`private.current_customer_id() = old.customer_id`). מחיקה במדורג (cascade) או מחיקה של אדמין לא נחסמות.
  - הספירה רצה אחרי נעילת שורת הפרופיל (`for update`), כדי ששתי כתיבות במקביל לא יעקפו את הגבולות.
- **`customer_id` לא מגיע מהקלט:** ברירת המחדל של העמודה היא `private.current_customer_id()`, וה-grant ל-insert מצטמצם ל-`(name, birth_date)`. ‏`join_complete` ממשיך לתת את `customer_id` במפורש.
- **`set_photo_consent(p_consent boolean)`:**
  - הגדרות: ‏definer, ‏`search_path = ''`, ‏grant יחיד ל-`authenticated`, פטור מ-idempotency (AD-5).
  - הרשאה: בלי לקוחה פעילה, `NOT_AUTHORIZED`.
  - נעילה: נועלת את הפרופיל.
  - אותו ערך כמו הקיים: לא כותבת כלום ומחזירה את המצב.
  - ערך שונה: שומרת את `photo_consent`, ‏`photo_consent_at = now()` ו-`photo_consent_text_version` = ‏`published_version` של `content_pages` ‏`join-form` (בדיוק כמו ב-`join_complete`), ורושמת ב-`private.audit` עם actor ‏customer.
  - מחזירה `{photo_consent, photo_consent_at, photo_consent_text_version}`.
- **Server Actions:** ב-`app/me/profile/actions.ts`, אחת לכל פעולה. כל אחת בודקת רק צורה, מבצעת כתיבה אחת (ישירה או `callRpc`) ומחזירה `ActionResult` (שגיאת מסד דרך `codeFromPostgrestError`). אחרי הצלחה מוצג toast "הפרטים נשמרו". כשנשאר תינוק אחד, כפתור המחיקה לא מוצג.
- **רשימת הקישורים בתחתית הפרופיל:** "התקנת האפליקציה" (`/install`; החלטת המשתמשת 2026-10-06 בבדיקה בטלפון), ואחריה מדיניות פרטיות והצהרת נגישות, רק אם פורסמו (`publicLegalNav` + ‏`getPublishedPageSlugs`, כמו בפוטר).
- **מסכים:** מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. רק כיווני Tailwind לוגיים. מיקרו-קופי ב-`lib/copy/customer.ts`, והודעה של קוד שגיאה חדש רק ב-`lib/errors.ts`.

**Never:**
- לא משנים שמות של עמודות ב-`profiles` או ב-`babies` (3.4 קורא אותן).
- לא נוגעים בפונקציות ההרשמה (3.6), בפונקציות האדמין (4.1), ב-`/me/bookings` או בתוכן הבית של `/me`.
- לא משנים טלפון ומייל (2.8) ולא מוסיפים הגדרות התראות (5.8).
- לא מוסיפים יומן לעדכון עצמי של שם, תזונה ותינוקות (זה הנתיב של AD-1).
- אין `Date.now()` להחלטה ואין השוואת תאריכים ב-TS לשם אכיפה.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| שני תינוקות | תאומים, נולדו 2026-07-05, היום 2026-10-05 | שתי שורות "שם · 3 חודשים" | — |
| גיל 0 | נולד היום | "פחות משבוע" | — |
| סוף חודש | נולד 2026-01-31, היום 2026-02-28 | "4 שבועות" (עוד לא חודש) | — |
| מעל שנה | נולד 2025-09-05 / ‏2024-08-05, היום 2026-10-05 | "שנה וחודש" / "שנתיים וחודשיים" | — |
| שנה בדיוק, סוף חודש | נולד 2024-02-29, היום 2025-02-28 / ‏2025-03-01 | "11 חודשים" / "שנה" | — |
| תאריך לידה בעתיד | insert/update עם מחר המקומי | נדחה במסד | `INVALID_INPUT` ‏`birth_date`, הודעה ליד השדה |
| תינוק 11 | יש 10, מוסיפה | נדחה | `INVALID_INPUT` ‏`babies` |
| מחיקת האחרון | תינוק יחיד, delete ישיר | נשאר | `LAST_BABY` |
| שתי מחיקות במקביל | שני תינוקות, שתי מחיקות בו-זמנית | אחת עוברת, השנייה נדחית | `LAST_BABY` |
| `customer_id` זר | insert עם `customer_id` של אחרת | נדחה (אין grant לעמודה) | שגיאת הרשאה |
| עמודה אסורה | update של `phone_e164` / ‏`photo_consent` ישירות | נדחה | שגיאת הרשאה |
| שינוי אישור | false→true, ‏join-form בגרסה 3 | `true`, ‏`now()`, ‏3, שורת יומן | — |
| אותו ערך | true→true | בלי כתיבה ובלי יומן | — |
| לא לקוחה | אדמין או חשבון לא מופעל | — | `NOT_AUTHORIZED` |
| תזונה ריקה | "   " | נשמר `null`. בתצוגה אין שורת תזונה, ושדה העריכה ריק | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001195103_create_join_flow.sql:20-83` -- העמודות של `profiles`, ה-policies וה-grants של `babies` (insert כולל היום `customer_id`). עמ׳ 165: הנוסח ההתחלתי של `photo_consent`.
- `supabase/migrations/20261002194018_identity_retry_and_conflict_reasons.sql` -- הגרסה האחרונה של `join_complete`: ‏`v_today` (289), בדיקות התינוקות, `v_photo_version` מ-`join-form` (431), והכנסת התינוקות אחרי הפרופיל באותה עסקה. ה-trigger החדש צריך לעבור איתה.
- `supabase/migrations/20260930191525_create_rpc_contract.sql:211` -- `private.audit(actor, kind, action, entity_type, entity_id, customer_id, event_id, old, new, reason)`. ‏`audit_diff` כבר מסתיר את `babies` ואת השדות המזהים.
- `supabase/tests/grants.test.ts:16-20,71-72,119-120` -- רשימת ההרשאות המצופה: להסיר `babies.customer_id INSERT`, להוסיף את `set_photo_consent`. דפוס הבדיקות: `join.test.ts`, ‏`support/db.ts`.
- `components/admin/baby-age.ts` (+test), ‏`lib/copy/admin.ts:495` (`babyAge`) -- חישוב הגיל של 3.4. החישוב עובר ל-`lib/time.ts`, ו-`attendee-row` ממשיך לעבוד בלי שינוי בתוצאה.
- `lib/time.ts` -- תצוגה בלבד. ‏`formatLocalDate`.
- `lib/phone.ts:11` -- `formatLocalPhone`. ‏`lib/errors.ts` -- ‏`codeFromPostgrestError`, ‏`detailFromPostgrestError`. ‏`lib/rpc.ts` -- `callRpc`.
- `components/shared/photo-consent-fieldset.tsx` -- השאלה ושתי התשובות (join ותצוגת 5.3). מוסיפים prop אופציונלי לערך הנבחר, בלי לשנות את ההתנהגות הקיימת. ‏`lib/content/join-form.ts` -- `getPhotoConsentContent`.
- `lib/nav.ts` (`customerNav`, `NavIcon`, ‏`publicLegalNav`), ‏`components/shared/{bottom-tab-bar,nav-icon}.tsx`, ‏`lib/nav.test.ts` -- הניווט אחרי 4.12. ‏3.6 עשוי להוסיף לשונית במקביל, אז ממזגים ולא דורסים.
- `app/(public)/layout.tsx:31-51` -- דפוס הקישורים המשפטיים שמוצגים רק אחרי פרסום.
- `app/me/purchases/page.tsx` -- דפוס דף באזור האישי (`PageHeading`, ‏Suspense, ‏`shellCopy.loading`). ‏`app/me/layout.tsx` -- שער הלקוחה.
- `app/(auth)/join/[token]/{join-input.ts,actions.ts}` -- דפוס בדיקת צורה ושדות שגיאה לתינוקות.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_profile_babies_and_photo_consent.sql` -- נוצר ב-`npx supabase migration new`. תוכן:
  - ‏`babies.customer_id default private.current_customer_id()`.
  - ‏revoke ל-insert ואז `grant insert (name, birth_date)`.
  - ‏`private.babies_guard()`: ‏definer, ‏`search_path = ''`, ‏revoke מכולם, ו-triggers ‏before insert/update/delete לפי הכללים.
  - ‏`public.set_photo_consent`.
  - מחילים ב-`apply_migration`, ואחר כך `get_advisors`.
- [x] `lib/supabase/database.types.ts` -- ליצור מחדש (`generate_typescript_types`).
- [x] `supabase/tests/profile.test.ts` -- כל השורות של המסד במטריצה, כולל מחיקה מקבילה ו-`join_complete` שעדיין עובר. ‏`grants.test.ts` מעודכן.
- [x] `lib/time.ts` (+test) -- ‏`babyAge(birthDate, onDay)` מחזירה `{newborn} | {weeks} | {years, months}` (או `null`), וגם היום המקומי כ-`YYYY-MM-DD`. הנוסח עובר מ-`adminCopy.sessions.babyAge` לפונקציה משותפת אחת, שמשמשת את הפרופיל ואת `attendee-row`. ‏`components/admin/baby-age.ts` הופך לעטיפה, והבדיקה שלו מתעדכנת ל"שנה וחודש". לבדוק את כל שורות הגיל במטריצה.
- [x] `lib/errors.ts` -- `LAST_BABY: "צריך להשאיר לפחות תינוק אחד בפרופיל"`.
- [x] `app/me/profile/actions.ts` (+test) -- ‏`updateDetails(fullName, dietaryNotes)`, ‏`addBaby`, ‏`updateBaby`, ‏`deleteBaby`, ‏`setPhotoConsent`. בודקים צורה (שם 1–200, תזונה עד 2000 ו-trim ל-null, שם תינוק 1–100, תאריך בפורמט תקין) ועושים `revalidatePath`.
- [x] `app/me/profile/page.tsx` + רכיבי לקוח באותה תיקייה -- frontend-design. ‏`h1` "הפרופיל שלי". ארבעה חלקים: פרטים (שם, תזונה, טלפון ומייל לקריאה), תינוקות, אישור תמונות, וקישורים. המייל מגיע מה-claims של Auth.
- [x] `components/shared/photo-consent-fieldset.tsx` -- prop לערך ההתחלתי.
- [x] `lib/nav.ts` (+`nav.test.ts`), ‏`nav-icon.tsx`, ‏`lib/copy/{customer,shell}.ts` -- לשונית "פרופיל" אחרונה עם אייקון `profile`, והמיקרו-קופי.

**Acceptance Criteria:**
- Given לקוחה מחוברת, when היא פותחת את `/me/profile`, then היא רואה רק את הפרטים שלה, וטלפון ומייל מוצגים בלי שדה עריכה.
- Given שינוי באישור התמונות, when טל פותחת את 3.4 או את דף העבודה, then הערך החדש הוא שמוצג (אותה עמודה).

## Implementation Notes

- **מיגרציה:** `20261005232157_profile_babies_and_photo_consent.sql`, הוחלה ב-`apply_migration`. ‏`get_advisors` (security): רק WARN ‏0029 (כולל `set_photo_consent`) ו-`auth_leaked_password_protection`, שניהם מאושרים.
- **`database.types.ts`:** נערך ידנית לפי הפלט של `generate_typescript_types` (‏`babies.Insert.customer_id` אופציונלי, ‏`set_photo_consent`). לא הועתק כולו, כי מסד הפיתוח כבר מכיל את `admin_get_home` ו-`admin_get_attention_items` מ-worktree מקביל (4.1), שלא קיימים בענף הזה. אחרי המיזוג יוצרים אותו מחדש.
- **trigger:** בעדכון נבדקים תאריך הלידה בכל פעם, והספירה רק כש-`customer_id` משתנה (לקוחה לא יכולה לשנות אותו). `set_photo_consent` דוחה גם `p_consent` ריק (`INVALID_INPUT`, ‏`photo_consent`).
- **Actions:** שם ריק או תאריך ריק מחזירים `FIELD_REQUIRED` עם השדה, ופורמט שגוי `INVALID_INPUT`. ‏update או delete שלא נגעו באף שורה (RLS): ‏`NOT_FOUND` לתינוק ו-`NOT_AUTHORIZED` לפרופיל. שגיאת מסד שאינה P0001 נרשמת ביומן ומוחזרת כ-`SERVER_ERROR`.
- **מסך:** כל חלק במצב תצוגה עם "עריכה" שפותחת את השדות במקום (בלי עדכון אופטימי). מחיקת תינוק מבקשת אישור קצר בתוך השורה ("למחוק את {שם} מהפרופיל?"). הנוסח של הגיל עבר ל-`lib/copy/baby-age.ts` (`babyAgeText`), והחישוב ל-`lib/time.ts` (`babyAge`, ‏`localToday`, ‏`formatFullDate`). ‏Toast של Sonner ב-`profile-toaster.tsx`, ‏6 שניות, מעל הסרגל התחתון.
- **מעבר על המטריצה:**
  - שני תינוקות, גיל 0, סוף חודש, מעל שנה, שנה בדיוק בסוף חודש: `lib/time.test.ts`. התאומים גם ב-`profile-sections.test.tsx`.
  - תאריך עתידי, תינוק 11, מחיקת האחרון, שתי מחיקות במקביל, `customer_id` זר, עמודה אסורה, שינוי אישור (גרסה 3, ‏`now()`, יומן), אותו ערך, לא לקוחה: `supabase/tests/profile.test.ts`.
  - תזונה ריקה: ‏`actions.test.ts` (trim ל-`null`), ‏`profile.test.ts` (מחרוזת ריקה נדחית ב-check), ‏`profile-sections.test.tsx` (אין שורת תזונה).
- **מעבר על הכללים:**
  - טלפון ומייל לקריאה בלבד, "צרי קשר" לוואטסאפ, בלי "טל": ‏`profile-sections.test.tsx`.
  - כפתור המחיקה חסר כשנשאר תינוק אחד: ‏`profile-sections.test.tsx`.
  - הלשונית האחרונה: ‏`nav.test.ts`.
  - `join_complete` עדיין עובר עם ה-trigger: ‏`profile.test.ts` (תאומים) ו-`join.test.ts`. הבדיקה הישנה שהכניסה `customer_id` כלקוחה עודכנה ל-insert בלי העמודה.
  - "Never": לא שונו שמות עמודות, פונקציות ההרשמה, פונקציות האדמין, ‏`/me/bookings`, בית `/me`, טלפון ומייל או הגדרות התראות. אין יומן לעדכון עצמי. אין `Date.now()` לאכיפה: היום המקומי ב-TS משמש רק לתצוגה ול-`max` של שדה התאריך.
- **קריטריון קבלה 2:** הערך נשמר באותה עמודה (`profiles.photo_consent`). אבל מסך 3.4 (`admin_get_event_details`) לא מציג היום אישור תמונות, ודף העבודה עוד לא נבנה. לכן אין כרגע מסך אדמין שמציג את הערך.
- **`grants.test.ts`:** השורות של 2.10 תואמות. הבדיקה נכשלת רק על שש פונקציות של 4.1 ו-3.6 שכבר נמצאות במסד המשותף (`admin_get_home`, ‏`admin_get_attention_items`, ‏`cancel_booking`, ‏`preview_admin_cancel_booking`, ‏`admin_cancel_booking`, ‏`get_my_bookings`). ההבדל ייסגר אחרי המיזוג.
- **סבב תיקוני ביקורת:**
  - ה-guard של `set_photo_consent` הוחל במסד כמיגרציה נפרדת, `set_photo_consent_not_found_guard`. לכן נוצר לה קובץ משלה, `20261006000155_set_photo_consent_not_found_guard.sql`, והקובץ המקורי חזר לגרסה שהוחלה, כדי שכל רשומה במסד תתאים לקובץ.
  - נוסף `isPlainDate` ב-`lib/time.ts`. הבדיקה הקודמת ב-action קיבלה גם חודש 13.
  - אחרי התיקונים, הבדיקות שהורצו:
    - `npm test`: ‏1331 בדיקות עברו.
    - lint, ‏format:check, ‏typecheck ו-build: נקיים.
    - בדיקות המסד profile, join, audit ו-rls: ‏68 עברו.
    - advisor: רק WARN מאושרים.

## Spec Change Log

## Review Triage Log

**סבב 1 (blind ×2, edge-case, verification-gap, intent-alignment).** מבקר blind אחד עבר על הדיף של הליבה (מסד, actions, זמן, ניווט), ומבקר blind שני עבר רק על דיף המסכים (ביקורת מקוצרת לפי בקשת המשתמשת).

| # | ממצא | ורדיקט | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 1 | השם הנגיש של "עריכה"/"מחיקה" לא מכיל את הטקסט הגלוי (WCAG 2.5.3), ו"עריכה הפרטים שלי" נבנה בשרשור | medium | patch | המילה הגלויה ראשונה, והשאר sr-only מה-copy |
| 2 | פתיחת עריכה או אישור מחיקה מאבדת את הפוקוס | medium | patch | פוקוס לשדה הראשון ולכפתור האישור, וחזרה ל"עריכה" בסגירה |
| 3 | "ביטול" פעיל בזמן שמירה, ואז מופיע toast אחרי ביטול | low | patch | ביטול מושבת בזמן המתנה, ו"כן, למחוק" עם מצב המתנה |
| 4 | `updateDetails` בלי `dietaryNotes` מוחק את ההערות השמורות | low | patch | נדרשת מחרוזת, אחרת `INVALID_INPUT` |
| 5 | `set_photo_consent` בלי `if not found` אחרי הנעילה | low | patch | נוסף, במיגרציה נפרדת |
| 6 | בדיקת תאריך כתובה פעמיים (actions, ‏time) | low | patch | `isPlainDate` אחד. תוקן גם חודש 13 |
| 7 | ה-JSDoc של `babyAge` מעל הטיפוס | low | patch | הועבר |
| 8 | `localToday` נבדק רק בפורמט (VG) | medium | patch | שעון מזויף אחרי חצות, בקיץ ובחורף |
| 9 | חסרות בדיקות ל-`updateBaby` ‏NOT_FOUND ולשדות השגיאה ב-actions (VG, blind) | medium | patch | נוספו |
| 10 | חסרות בדיקות להכנסות מקבילות ב-9 תינוקות, למחיקה מרובה בפקודה אחת ול-`set_photo_consent(null)` (VG, blind) | medium | patch | נוספו ל-`profile.test.ts` |
| 11 | אין גבול תחתון לתאריך לידה (1026 עובר) | medium | defer | קיים גם ב-`join_complete`, והגבול הוא ערך עסקי. נרשם ב-deferred-work |
| 12 | סדר הנעילה ב-guard (תינוק ואז פרופיל) הפוך מ-AD-6 | maybe-false (medium) | defer | אין היום פונקציה שנועלת פרופיל ואז משנה תינוקות. נרשם ב-deferred-work |

נדחו (13):
- הודעת "עתידי" על תאריך לא תקין, הודעה כללית לתינוק 11, הכפתור מוסתר ב-10 בלי הסבר, אין מצב ריק לתינוקות, אישור תמונות נעלם בלי נוסח מפורסם, ותשובה שמסומנת אחרי כישלון: לא מגיעים אליהם בשימוש רגיל (שדה תאריך, 5.3 לא מסתיר את הנוסח, לקוחה לא מגיעה ל-0 תינוקות).
- toast "הפרטים נשמרו" אחרי מחיקה: לפי EXPERIENCE.
- `FormButtons` בקובץ של חלק אחר: אין נזק.
- אורך UTF-16 מול `char_length`, ‏`SERVER_ERROR` ל-addBaby של מי שאינה לקוחה, ו-`INVALID_INPUT` לפני RLS: לא מגיעים אליהם, כי השער של `/me` חוסם ועברית לא מושפעת.
- "היום" מחושב בתוך ה-trigger: כמו ב-`join_complete`, ואין עזר `private` לזה.
- גרסת הנוסח בזמן השמירה ולא בזמן ההצגה: אותו כלל כמו ב-`join_complete`.
- קריטריון קבלה 2 (טל רואה את השינוי): התיקון הוא עריכה של ה-spec. מוצג למשתמשת.
- בדיקות המסך רק על הרינדור הראשון: הבדיקה בטלפון של המשתמשת מכסה את הזרימה.

## Design Notes

**למה trigger ולא RPC לתינוקות:** AD-1 כבר פותח את `babies` לעדכון עצמי לפי עמודות. trigger אוכף את הכללים על כל כותב, כולל `join_complete` והיבוא העתידי, בלי עוד RPC. הנעילה על הפרופיל זהה לזו של `join_complete`, ולכן סדר הנעילה נשמר.

```sql
-- inside private.babies_guard(), before delete
if (select private.current_customer_id()) = old.customer_id then
  perform 1 from public.profiles where id = old.customer_id for update;
  if not exists (select 1 from public.babies b
                 where b.customer_id = old.customer_id and b.id <> old.id) then
    raise exception 'LAST_BABY' using errcode = 'P0001';
  end if;
end if;
```

## Verification

**Commands:**
- `npm run test:db` -- ירוק, כולל `profile.test.ts` ו-`grants.test.ts`.
- `npm run lint && npm run typecheck && npm test && npm run build` -- ירוק.
- `get_advisors` (security) -- רק WARN ‏0029 על `set_photo_consent` ואזהרת leaked password שאושרה.

- מעבר מסודר בסוף (בקשת המשתמשת): כל שורה במטריצה, כל כלל ב-Always/Never וכל משימה מכוסים בבדיקה או נבדקו, ונרשמים ב-Implementation Notes.

**Manual checks (if no CLI):**
- בטלפון של המשתמשת: עריכת שם ותזונה, הוספת תינוק, תאריך עתידי שנדחה, כפתור המחיקה חסר כשנשאר תינוק אחד, ושינוי אישור תמונות עם toast.
