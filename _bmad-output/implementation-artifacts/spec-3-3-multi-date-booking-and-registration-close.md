---
title: '3.3 Multi-date booking and registration close — בחירה מרובה וסגירת הרשמה'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '356b4f90db9047d7381629fee781560e591febd6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** לקוחה עם כרטיסייה נרשמת לכל תאריך לחוד, אף שהמלצת הכרטיסייה היא להירשם מראש לכל הכניסות (מקור §2, CAP-13). ‏הסגירה לפי `registration_closes_at` קיימת ב-`book_session`, אבל לא נבדקה מול זמן השרת ובשבוע מעבר שעון קיץ (מקור §5, §11, CAP-14).

**Approach:** RPC ‏`book_sessions` שנועלת את הכול מראש, בודקת כל תאריך בנפרד ומחזירה תוצאה לכל תאריך. במסך המפגשים יש מצב בחירה מרובה עם גיליון סיכום אחד, ואחריו רשימת תוצאות. בדיקות מסד לסגירה לפי שעון השרת.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-6, ‏AD-8, ‏AD-14, ‏AD-18, ‏AD-23. משתמשים ב-`private.book_core` וב-`private.plan_funding` כמו שהן (`plan_funding` בגרסה של 3.11) ולא משכפלים אותן. עברית רק ב-`lib/copy/customer.ts` (ו-`lib/errors.ts` אם יידרש קוד חדש), מה-Design Notes. בקבצים המשותפים עם 5.3 רק מוסיפים.

**Decisions:**
- **`book_sessions(p_items uuid[], p_idempotency_key)`** (מזהי מפגשים): ‏`current_customer_id()` ריק ← `NOT_AUTHORIZED`. ריק, ‏null בתוכו, כפילות או יותר מ-20 ← `INVALID_INPUT`. ‏`idempotent_begin` עם המזהים ממוינים. נעילות (AD-6): ‏`profiles` שלה ← כל המפגשים לפי `id` ← כל הזכויות `active` שלה עם `pinned_event_id is null` לפי `id`. אחרי זה אין צורך בבדיקה חוזרת של `plan_funding`.
- **לכל תאריך,** לפי `starts_at` ואז `id` (מזהה שלא נמצא בסוף): אותן בדיקות ובאותו סדר כמו `book_session`: ‏`EVENT_NOT_BOOKABLE` ← `REGISTRATION_CLOSED` ← `ALREADY_BOOKED` ← `EVENT_FULL` ← `plan_funding('self')`. הצלחה ← `book_core(..., 'book_sessions')`. כישלון נרשם בתוצאה בלבד: לא נשמר מקום ולא נגרעת כניסה. ‏`plan_funding` היא `stable`, ולכן רואה את השריונים של התאריכים הקודמים באותה קריאה.
- **תוצאה:** ‏`{results: [{event_id, ok, code?, booking_id?}]}` בסדר העיבוד. גם תוצאה שכל התאריכים בה נכשלו נשמרת ב-idempotency. חריגה (קלט, הרשאה) לא נשמרת.
- **`preview_book_sessions(p_items uuid[])`:** קריאה ל-`authenticated` בלבד, עד 200. ‏`{available, results: [{event_id, ok, code?, product_name?, cancel_deadline}]}`. כל תאריך נבדק לבדו בקריאה ל-`public.preview_book_session`, בלי לשכפל את הבדיקות. ‏`available` הוא סכום ה-`available` של הזכויות `active` שלה עם `pinned_event_id is null` ו-`expires_on` מהיום המקומי והלאה.
- **מסך (`/me/sessions?select=1`):** הכפתור "לבחור כמה תאריכים" מופיע ברשימה כש-`available ≥ 2`. במצב בחירה: שורת `session-row` בווריאנט בחירה (DESIGN.md:683, ‏EXPERIENCE.md:210). תאריך שלא `ok` מוצג לא זמין, עם סיבה קצרה. אי אפשר לבחור יותר מ-`available`. המונה ו"להמשך" צמודים מעל הסרגל התחתון. ‏`bottom-sheet` מציג סיכום אחד: לכל תאריך מועד ביטול, ומתחת "מה ינוצל" ו"יישארו" (`available − n`, לתצוגה בלבד), ואישור אחד. אחרי התשובה רשימת התוצאות מחליפה את מצב הבחירה, והפוקוס עובר לכותרת שלה (EXPERIENCE.md:409). המפתח נוצר כשהגיליון נפתח, ומפתח חדש אחרי כל תשובה.
- **כפתור ההצטרפות של כרטיסייה** (`app/me/page.tsx`, בגרסה של 3.11): מוביל ל-`/me/sessions?select=1` (EXPERIENCE.md:111). בשאר המוצרים הוא לא משתנה.
- **סגירה לפי זמן השרת:** ה-RPC לא מקבלת זמן מהדפדפן. גם preview שהראה "פתוח" לא מתיר הרשמה אחרי הסגירה. ‏`registration_closes_at` בשבוע מעבר שעון קיץ נבדק דרך ה-RPC.
- **רגע הבדיקה (המשתמשת, 2026-10-05):** הסגירה נבדקת מול `clock_timestamp()` אחרי כל הנעילות, ולא מול `now()` (זמן תחילת העסקה), כדי שבקשה שחיכתה לנעילה מעבר לסגירה תידחה (מקור §11 "עובדה אחריה"). חל על `book_sessions` ועל `book_session` (`create or replace` במיגרציה, אותה חתימה ושאר הגוף כמו שהוא). ה-preview נשאר עם `now()`.
- **התראות (המשתמשת, 2026-10-05):** ‏`booking_confirmed` לכל תאריך שנשמר, דרך `book_core` כמו היום. כל התראה מובילה למפגש שלה.
- **אורך:** נשאר כמו שהוא (המשתמשת, 2026-10-05).

**Never:** שינוי ב-`book_core` או ב-`plan_funding`, שינוי ב-`book_session` מעבר לרגע הבדיקה, הרשמה זוגית או בחירה מרובה למפגש זוגי (כרטיסייה לא מממנת זוגי ב-self), רשימת המתנה (5.6) ונוסח שמפנה אליה, זיכויים (3.7), מספר מקומות ללקוחה, תווית רגיל/זוגי, ‏`Date.now()` להחלטה, כתיבה מהדפדפן ל-`bookings`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| שלושה, אחד מלא | כרטיסייה 4, שלושה תאריכים, השני מלא | שניים `ok` עם `booking_id`, השני `EVENT_FULL`. ‏`reserve` רק פעמיים, 2 זמינות ו-2 משוריינות |
| יותר מהיתרה | כרטיסייה 2, שלושה תאריכים | שני המוקדמים `ok`, השלישי `NO_MATCHING_ENTITLEMENT`, זמינות 0 |
| מעורב | סגור, כבר רשומה, מחוץ לתוקף, טיוטה, מזהה לא קיים | הקוד של כל אחד, ואין שינוי במסד |
| שתי זכויות | שתי כרטיסיות, תוקף שונה | כל תאריך ממומן לפי `expires_on` ואז `id` |
| חוזר | אותו מפתח | אותה תוצאה, בלי הרשמה או תנועה נוספת |
| קלט | `[]`, ‏null בתוכו, כפילות, 21 | `INVALID_INPUT` |
| נשלח לפני, עובד אחרי | preview עם `registration_open`, ואז `registration_closes_at = now()` | `REGISTRATION_CLOSED` גם ב-`book_session` וגם ב-`book_sessions` |
| המתנה לנעילה | חיבור א׳ מחזיק את המפגש; ב׳ מתחיל לפני `registration_closes_at` וממתין עד אחריו | ב׳ מקבלת `REGISTRATION_CLOSED` ב-`book_session` וב-`book_sessions` |
| שעון קיץ | מפגשים 26.10.2026 ו-28.03.2027 ב-10:00 | נסגרים ב-18:00Z ‏25.10 וב-17:00Z ‏27.03, ופתוחים עד אז |
| מקביליות | שתי לקוחות, מקום אחרון, אחת עם `book_sessions` | רק אחת `ok`, לשנייה `EVENT_FULL`, בלי גריעה |
| הרשאות | anon / אדמין / לקוחה לא פעילה | ‏42501 / ‏`NOT_AUTHORIZED` |
| preview | תאריכים זכאים ולא זכאים | `ok` וקוד לכל אחד, `available` נכון, בלי כתיבה |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004183409_bookings_and_self_booking.sql` -- ‏`book_session` (576; נעילות ובדיקות לפי הסדר, דפוס לחיקוי), ‏`preview_book_session` (683; נקראת מ-`preview_book_sessions`), ‏`get_event_availability` (798), ‏`occupied_places` (158). לא משנים.
- `20261004191220_bookings_review_fixes.sql:10` -- ‏`book_core` העדכנית (בודקת `EVENT_FULL` ו-`available` שוב, יומן, התראה). לא משנים.
- 3.11 (`origin/story-3-11-pinned-approval`, ‏`20261004212706_pinned_product_approval.sql`) -- ‏`plan_funding` העדכנית (482 בדיף). לבנות עליה אחרי המיזוג.
- `20260930191525_create_rpc_contract.sql` -- ‏`idempotent_begin/finish`.
- `supabase/tests/self-booking.test.ts` -- ‏`seed`, ‏`insertEvent` (`closed`, ‏`status`), ‏`localDay`, ‏`as`/`errorAs`, ‏`movementsOf`. סגירה: 395. ‏`booking-concurrency.test.ts` -- שני חיבורים. ‏`events-admin.test.ts:439` -- שעון קיץ בטריגר. ‏`time-and-phone-helpers.test.ts:43` -- העזר. ‏`grants.test.ts` (`EXPECTED_GRANTS`).
- `app/me/sessions/{page,actions,load-sessions,session-status}.ts(x)` -- הרשימה, ‏`bookSessionAction` (דפוס לצורה ול-UUID), ‏`availabilityOf`.
- `app/me/sessions/[id]/booking-panel.tsx` -- דפוס הגיליון: ‏Drawer, פוקוס, busy עם try/finally, ‏`router.refresh()`, ‏`newIdempotencyKey`. ‏`booking-preview.ts` -- ‏`parsePreview`, ‏`blockedAction`.
- `components/shared/{session-card,status-chip,inline-notice,page-heading}.tsx`, ‏`components/ui/drawer.tsx` (לא עורכים). ‏`lib/time.ts` (`formatSessionDateTime`), ‏`lib/errors.ts` (`errorMessage`), ‏`lib/copy/customer.ts` (מפתחות 3.2: 30–60).
- `app/me/page.tsx:180–190` -- כפתור ההצטרפות (בגרסה של 3.11).
- מוקאפ: `ux-brunch-at-tals-2026-09-23/mockups/key-booking-sheet.html` (תווית הסוג ומספרי המקומות שבו לא נכונים; ה-spines גוברים).

## Tasks & Acceptance

**Execution:**
- [ ] **סשן ראשי, לפני המיגרציה:** לוודא ש-3.11 מוזג ל-main, למזג את `origin/main` ל-`story-3-3-multi-date-booking`, ולוודא ב-`list_migrations` שהמיגרציות של 3.11 מוחלות. רק אז `npx supabase migration new multi_date_booking`.
- [ ] `supabase/migrations/<ts>_multi_date_booking.sql` -- ‏`book_sessions`, ‏`preview_book_sessions` ו-`book_session` (רגע הבדיקה), עם grants לפי AD-5. **סשן ראשי:** ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types`, ‏`npm run test:db`.
- [ ] `supabase/tests/multi-booking.test.ts` (חדש), ‏`booking-concurrency.test.ts`, ‏`grants.test.ts` -- כל שורה במטריצה.
- [ ] `app/me/sessions/actions.ts` + בדיקה -- ‏`bookSessionsAction({eventIds, idempotencyKey})`: בדיקת צורה (1–20 UUID שונים) ← `callRpc`.
- [ ] `lib/copy/customer.ts` -- הנוסחים מה-Design Notes.
- [ ] `app/me/sessions/page.tsx`, ‏`app/me/sessions/select/*` (רכיב הבחירה, הגיליון, התוצאות, ‏parser עם בדיקה), ‏`app/me/page.tsx` -- מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor מחזיר רק את 0029 ואת `auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when מריצים `npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, then ‏lint, ‏format:check, ‏typecheck, ‏`npm test` ו-build עוברים.
- Given טלפון ולקוחה בדויה עם כרטיסייה של 4, when היא בוחרת שלושה תאריכים ומאשרת, then היא רואה את רשימת התוצאות, וב-`/me` מוצגות 1 זמינה ו-3 משוריינות, בלי מספר מקומות.
- Given מקלדת וקורא מסך, then השורה כולה היא `label`, שורה לא זמינה מסומנת `aria-disabled` עם הסיבה, המונה ב-`aria-live`, והגיליון לפי EXPERIENCE.md:224.

## Implementation Notes

- העבודה ב-worktree ‏`.claude/worktrees/story-3-3` (branch ‏`story-3-3-multi-date-booking` מ-origin/main ‏356b4f9, אחרי מיזוג 3.11; המיגרציות של 3.11 מוחלות על מסד הפיתוח). קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261005171826_multi_date_booking.sql` (ריק). כותבים אליו בלבד, בלי `drop`. ‏`apply_migration` לא עובד אצל סוכן משנה: הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`. עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. ‏`node_modules` ו-`.env.local` כבר קיימים ב-worktree. בסוף מדווחים מה נשאר לסשן הראשי.
- הוחלה מה-MCP (בלי drop): `20261005171826_multi_date_booking`. ה-advisor: רק 0029 ו-`auth_leaked_password_protection`. הטיפוסים שנוצרו זהים לעדכון הידני. ‏`npm run test:db`: ‏476 עוברות, ולא נשארו שורות `test_%`. lint, ‏format:check, ‏typecheck, ‏`npm test` (1076) ו-build עברו אצל המממש.
- החלטות המממש: הגיליון ב-`Sheet` כמו `booking-panel.tsx`, לא `Drawer`. ‏"ביטול הבחירה" הוא קישור חזרה ל-`/me/sessions`. ‏"לא מתאים לכרטיסייה" משמש גם ל-`NO_MATCHING_ENTITLEMENT`, ‏`EVENT_NOT_BOOKABLE` ולכל קוד אחר. נוסחים שלא היו בטבלה, לאישור המשתמשת: "כניסה אחת זמינה", "אין כניסות זמינות", "התאריך שבחרת", "לשמור לי את המקום", "כניסה אחת מ{מוצר}". הכותרת "בחירת תאריכים" והשורה "{n} כניסות זמינות" מתחתיה.
- אחרי תיקוני הביקורת (7 patch): ‏lint, ‏format:check, ‏typecheck, ‏`npm test` (1086), ‏build ו-`npm run test:db` (476) עוברים. לוגיקת המסך עברה לפונקציות טהורות ב-`selection.ts` (‏`toggleSelection`, ‏`pruneSelection`, ‏`resultsHeading`, ‏`selectableRows`, ‏`showsSelectEntry`), והקישור מ-`/me` ל-`joinButtonHref` ב-`purchase-items.ts`, כולן עם בדיקות.
- בדיקה בטלפון (2026-10-05): במסד הפיתוח כל המפגשים הפתוחים היו חסומים ללקוחה הבדויה, ולכן נוספו שלושה מפגשים רגילים בדויים (19.10, ‏22.10, ‏26.10). הכפתור "לבחור כמה תאריכים" מופיע לפי `available ≥ 2` גם כשאין תאריך שאפשר לבחור, ונשאר כך (המשתמשת, 2026-10-05).
- נוסחים אחרי הבדיקה בטלפון (המשתמשת, 2026-10-05; גובר על מקור §5 ועל EXPERIENCE.md, נרשם ב-memlog של ה-SPEC): כפתור האישור בשני הגיליונות הוא "להרשמה". "אפשר לבטל בעצמך עד…" הוסר מכל המסכים (גיליון ההרשמה, "את רשומה למפגש הזה", הגיליון והתוצאות של הבחירה המרובה). השרת עדיין מחזיר `cancel_deadline` ו-`can_self_cancel` לכפתור הביטול של 3.6.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 3, low 9, false 4, maybe-false 1. patch 7, defer 0, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | אחרי `router.refresh()` תאריך שנבחר ונעשה לא זמין נשאר ב-`selected`, אי אפשר לבטל את סימונו והוא נשלח שוב; `available` שירד משאיר בחירה מעל המכסה; גיליון פתוח עם בחירה ריקה שולח `[]` | medium | ‏`toggle` חוזר מיד כש-`!session.ok`, ואין סינון של `selected` כשה-props משתנים (blind, edge) | patch: ביטול סימון תמיד מותר, סינון ל-ok ועד `available`, ובחירה ריקה סוגרת את הגיליון |
| 2 | מבחן ההמתנה לנעילה עובר גם בלי השינוי כשההכנה איטית מ-3 שניות | medium | אין בדיקה שהעסקה של ב׳ התחילה לפני הסגירה (blind, verification) | patch: ‏`transaction_timestamp()` של ב׳ < ‏`registration_closes_at` |
| 3 | מבחן שעון הקיץ ייכשל אחרי 25.10.2026 18:00Z | medium | תאריכים קבועים, ומצופה `ok` (blind, edge) | patch: ההצלחה מצופה רק כשהסגירה עוד בעתיד |
| 4 | אין בדיקות ללוגיקת המסך: המכסה בבחירה, כותרת התוצאות, הכניסה למצב בחירה (2+), שורה שחסרה ב-preview, הקישור מ-`/me` | medium | חיפוש בבדיקות לא מוצא אותן (verification, blind) | patch: פונקציות טהורות ב-`selection.ts` וב-`purchase-items.ts` עם בדיקות |
| 5 | מפתח חדש גם אחרי חריגת רשת, אף שהשרת אולי שמר; ניסיון חוזר מציג "לא נשמר" לתאריכים שנשמרו | low | ‏`setKey` אחרי `catch` (blind) | patch: אחרי חריגה המפתח נשמר |
| 6 | ‏`ALREADY_BOOKED` בתוצאות מציג "הכניסה לא נוצלה ונשארה ביתרה שלך" | low | ‏`entryKept` לכל כישלון (blind) | patch: בלי השורה הזו ל-`ALREADY_BOOKED` |
| 7 | כרטיסייה בלי כניסות זמינות מובילה מ-`/me` למצב בחירה ריק | low | ‏`cardIds.has` בלי `available` (blind, edge) | patch: רק כש-`available > 0` |

Reject (11): ‏`available` כולל כל זכות לא מוצמדת (ההגדרה ב-spec, גבול עליון לתצוגה, השרת מחליט; "זוגי לוקח 2 כניסות" שגוי, 3.2); מעל 200 מפגשים (השאילתה מוגבלת ל-100, false); נוסח הסיבה ל-`EVENT_NOT_BOOKABLE` (מפגש לא מפורסם לא מוצג); ‏`cancelUntil("")` (הדפוס הקיים של 3.2); ‏preview עם `ok` ו-`booked` (‏`preview_book_session` מחזירה תמיד `ok: false` כש-`booked`, false); מבחן הסגירה ב-multi-booking לא מבדיל `now()` (המטרה שלו preview מול הרשמה; ההבחנה בממצא 2, false); בדיקת זוגי ומוצמד ב-`book_sessions` (כללי `plan_funding` נבדקים ב-3.2); 100 תצוגות מקדימות בטעינה (low, הדגמה); "מה ינוצל" בשתי כרטיסיות (תצוגה בלבד, נרשם); כשל פענוח אחרי שמירה (maybe-false, low); ממצאי intent תיאוריים (שינוי `book_session` הוא החלטת המשתמשת; כל זכות לא מוצמדת לפי ה-spec; גבול שעון קיץ ברגע עצמו לא ניתן לבדיקה בלי שעון מזויף).

## Design Notes

**נוסחים חדשים לאישור:**

| מקום | נוסח |
|---|---|
| כפתור ברשימה | לבחור כמה תאריכים |
| כותרת מצב בחירה | בחירת תאריכים · {n} כניסות זמינות |
| מונה | נבחרו {n} מתוך {m} · להמשך · ביטול הבחירה |
| סיבה בשורה לא זמינה | נרשמת · ההרשמה נסגרה · מלא · הכרטיסייה אינה בתוקף ביום הזה · לא מתאים לכרטיסייה |
| גיליון | {n} התאריכים שבחרת · אפשר לבטל בעצמך עד {יום DD.MM HH:MM} · מה ינוצל: {n} כניסות מ{שם המוצר} · יישארו: {n} כניסות / כניסה אחת / אין כניסות · לשמור לי את {n} המקומות |
| הכול נשמר | המקום שלך סביב השולחן שמור · לכל תאריך "נשמר" |
| חלק נשמר | שמרנו לך {n} מתוך {m} תאריכים · "לא נשמר" + `errorMessage(code)` + "הכניסה של {DD.MM} לא נוצלה ונשארה ביתרה שלך" |
| כלום לא נשמר | לא הצלחנו לשמור את התאריכים שבחרת · אותה שורה לכל תאריך |
| קישורים אחרי התוצאה | ליתרה שלי · לכל המפגשים |

**הסדר ב-SQL.** נועלים קודם את כל המפגשים ואת כל הזכויות האפשריות, ורק אחר כך מתכננים. כך אין צורך ב"תכנון ← נעילה ← תכנון חוזר" של `book_session`, ואין `CONCURRENT_CHANGE` בין התאריכים. ‏`book_core` עדיין בודקת `available` כהגנה.

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
