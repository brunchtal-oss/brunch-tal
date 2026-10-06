---
title: '5.7 In-app notification centers — מרכזי התראות וסרגל עליון'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '502da928fb86dc8bf72068e87789c62ba9ded219'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** התראות נכנסות לטבלה מאז 2.12, אבל אין איפה לראות אותן ואין סימון נקרא. במעטפות של האזור האישי והאדמין יש רק שורת שם, וכפתורי התנתקות מפוזרים. באתר הציבורי לקוחה מחוברת עדיין רואה "כניסה לאזור האישי" ואת פס הוואטסאפ.

**Approach:** מיגרציה קטנה (`mark_notifications_read`, ‏`mark_notifications_unread` ואינדקס לא-נקראו), ‏`/me/notifications` ו-`/admin/notifications`, סרגל עליון חדש בשני המשטחים עם פעמון (ומונה) והתנתקות, והמעטפת הציבורית מכירה לקוחה מחוברת (מ-deferred-work).

**החלטות המשתמשת 2026-10-06 (אישור ה-spec):** (1) בבית האזור האישי אין סקשן התראות; הלא-נקראו מוצגות רק כמונה על הפעמון (גובר על מקור §5 "נפתח... בהתראות שלא נקראו" ועל EXPERIENCE › בית). (2) שם העסק בסרגל של `/me` ו-`/admin` צמוד ל-inline-start (ימין), כמו בציבורי, ולא במרכז. (3) אפשר לסמן התראה כלא-נקראה (מרחיב את AD-12 › נקרא). (4) בסרגל של האדמין בלבד, ב-inline-end לפני הפעמון: כפתור אייקון 44×44 ‏`aria-label` "מעבר לאתר" ל-`/` באותה לשונית; ב-`/me` אין.

## Boundaries & Constraints

**Always:**
- **`mark_notifications_read(p_ids uuid[] default null)` ← ‏`{marked}`:** ‏definer, ‏`search_path = ''`, grant ל-`authenticated` בלבד, בלי idempotency ובלי יומן (AD-5, 2.12). שורה ראשונה: ‏`auth.uid()` ריק, או `current_customer_id()` ריק ולא `is_admin()` ← ‏`NOT_AUTHORIZED`. יותר מ-200 מזהים ← ‏`INVALID_INPUT`. מעדכנת `read_at = now()` רק ב-`recipient_id = auth.uid()` עם `read_at is null` (ו-`id = any(p_ids)` כשיש). מזהה של מישהי אחרת או שכבר נקרא מדולג בשקט. ‏`null` = כל שלה.
- **`mark_notifications_unread(p_ids uuid[])` ← ‏`{marked}`:** אותם כללים, אבל `p_ids` חובה (‏null או ריק ← ‏`INVALID_INPUT`), ומאפסת `read_at = null` רק בשורות שלה שנקראו. שתי הפונקציות הן היחידות שכותבות `read_at`.
- אינדקס חלקי `(recipient_id) where read_at is null`. טבלאות `notifications` ו-`notification_jobs` לא משתנות (5.8 בונה עליהן).
- קריאה (רשימה ומונה) ישירות מ-`notifications` דרך RLS, מסוננת גם לפי `recipient_kind` של המשטח. 100 האחרונות, מהחדשה. מונה מעל 99 מוצג "99+".
- **`top-bar` של `/me` ו-`/admin(shell)`:** ‏`<header data-top-bar>` ‏sticky, ‏`bg-primary` עם `text-primary-foreground` (כמו הציבורי, 8.46:1). שם העסק (`WORDMARK`) צמוד ל-inline-start ומקשר לבית המשטח. ב-inline-end: ‏`bell-button` ו"התנתקות", שניהם 44×44 עם אייקון ו-`aria-label`. באדמין הסרגל ברוחב מלא מעל ה-`side-nav`, וה-`side-nav` צמוד מתחתיו.
- **פעמון:** ‏`aria-label` "התראות" או "התראות, {n} שלא נקראו", מונה כ-pill ‏`on-primary`/`primary` בפינה, שינוי מוכרז ב-`aria-live="polite"`. ערך התחלתי מהשרת בתוך `Suspense`, ורענון ב-Server Action במעבר נתיב וב-`visibilitychange` (כך שינוי ממכשיר אחר מופיע בחזרה לאפליקציה).
- **`notification-item`:** ‏DESIGN/EXPERIENCE: השורה כולה קישור אחד ל-`target_path`, ‏`body-strong` לכותרת שלא נקראה עם נקודה accent ‏`aria-hidden` ו-sr-only "לא נקראה", גוף ב-`body-sm`, זמן ב-`label`: "היום, HH:MM" / "אתמול, HH:MM" / ‏DD.MM לפי `Asia/Jerusalem`. לחיצה: סימון (עד ~1.5 שניות) ואז מעבר, גם אם הסימון נכשל. מעבר רק ל-`target_path` שמתחיל בתחילית המשטח.
- **סימון כלא-נקראה / כנקראה:** כפתור אייקון 44×44 ליד כל שורה, מחוץ לקישור (אין רכיב אינטראקטיבי בתוך קישור), עם `aria-label` "סימון כלא נקראה" או "סימון כנקראה" לפי המצב, ועדכון מיידי של השורה ושל המונה.
- המרכז: ‏`h1` "התראות", "סימון הכול כנקרא" רק כשיש לא-נקראו, ריק: משפט אחד בלי פעולה. מעל הרשימה מקום ריק לכרטיס הפוש של 5.8.
- **בית `/me`:** בלי סקשן התראות. התגובה "Story 5.7" שם נמחקת.
- **התנתקות:** רק בסרגל העליון. יוצאת מ-`app/me/page.tsx`, ‏`admin/(shell)/more/page.tsx` וה-`side-nav`. ‏`/login` ו-`/join` לא משתנים. בפרופיל וב-`customerNav` כבר אין התנתקות ולשונית התראות; נבדק בטסט.
- **ציבורי:** התפקיד נקרא ב-`getViewerRole()` ברכיב דינמי בתוך `Suspense`, אף פעם לא ב-`'use cache'`. לקוחה: "האזור שלי" ← `/me` בסרגל ובתפריט, ובלי `whatsapp-bar` ו-`WhatsappFlowLink`. אדמין: "לפאנל הניהול" ← `/admin`, והפס נשאר. ה-fallback של הקישור הוא של האורחת. ה-fallback של הפס ריק, והפס מופיע כשהתפקיד אינו `customer`. ריווח הפוטר עוקב אחרי הפס.
- יעדים: הנתיבים שה-RPC הקיימים שומרים נשארים (רכישה ← ‏`/me`, אישור הרשמה ← ‏`/me/sessions/<event>`, ביטול ← ‏`/me/bookings`).
- מסכים: מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. מיקרו-קופי ב-`lib/copy/shell.ts`, בלי "טל".

**Never:** שינוי ב-`notifications`, ‏`notification_jobs` או ב-RPC שמכניסים התראות; התראות בבית האזור האישי; פוש, הרשאה, ‏`unregister_push_subscription` או "הגדרות התראות" (5.8); ‏realtime; ‏chips של לקוחה ברשימה הציבורית (deferred); ליטוש מעבר ל-DESIGN.md (סבב 8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| קריאה | A עם 2 לא-נקראו, B, אדמין | כל אחת רואה ומונה רק את שלה |
| גישה ישירה | A: ‏select לפי id של התראת אדמין; ‏`mark_notifications_read([id אדמין])` | 0 שורות; ‏`{marked: 0}`, שורת האדמין לא השתנתה |
| סימון אחד | A, ‏`[id]` שלה | ‏`marked 1`, ‏`read_at` נקבע; שוב ← ‏`marked 0`, ‏`read_at` לא זז |
| סימון הכול | A, ‏`null` | רק הלא-נקראו של A; של B לא נגעו |
| לא-נקראה | A, ‏unread ‏`[id]` שנקרא; ‏`[id של B]`; ‏`null` / ‏`[]` | ‏`marked 1`, ‏`read_at` ריק; ‏`marked 0` ושל B לא זז; ‏`INVALID_INPUT` |
| לא מורשית | ‏anon; משתמשת בלי פרופיל פעיל | ‏42501; ‏`NOT_AUTHORIZED` |
| יותר מדי | 201 מזהים | ‏`INVALID_INPUT` |
| אדמין | ‏`null` | רק שלה |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001184225_create_notification_core.sql` -- הטבלה, ה-check של `target_path`, ‏policy ‏`notifications_authenticated_select`. דפוס revoke/grant.
- `supabase/tests/notifications.test.ts`, ‏`support/db.ts`, ‏`support/money.ts` (`seedMoney`) -- דפוס בדיקה וזריעה; ‏`private.enqueue_notification` ליצירת התראות בבדיקה.
- `supabase/tests/grants.test.ts` -- ‏`EXPECTED_GRANTS`.
- `app/me/layout.tsx`, ‏`app/admin/(shell)/layout.tsx` -- המעטפות; ‏`RoleGate` בתוך `Suspense`, ‏`instant = false`.
- `components/public/top-bar.tsx` -- הצבע, ‏`data-top-bar` (‏`app/globals.css` נותן לו scroll-padding ו-focus ring); ‏`components/shared/wordmark.tsx`.
- `components/shared/sign-out-button.tsx`, ‏`lib/auth/sign-out.ts` -- משתמשים מחדש ב-`signOutAction`.
- `components/admin/side-nav.tsx` -- מוציאים `footer`; ‏`sticky top-0 h-svh` מותאם לגובה הסרגל.
- `app/me/page.tsx` -- ‏`SignOutButton` והתגובה "Story 5.7" יוצאים.
- `app/admin/(shell)/more/page.tsx` -- ‏`SignOutButton` יוצא.
- `app/(public)/layout.tsx`, ‏`components/public/menu-sheet.tsx` (client), ‏`whatsapp-bar.tsx` -- המעטפת הציבורית.
- `lib/auth/viewer-role.ts` -- ‏`getViewerRole()`, כבר בשימוש ב-`app/(public)/sessions/[id]/page.tsx`.
- `lib/nav.ts`, ‏`lib/nav.test.ts` -- ‏`customerNav` בלי התראות; הטסט בודק שלכל href יש `page.tsx`.
- `lib/time.ts` -- עזרי תצוגה ב-`Asia/Jerusalem`; מוסיפים את פורמט הזמן.
- `lib/rpc.ts` (`callRpc`), ‏`lib/errors.ts` (‏`NOT_AUTHORIZED`, ‏`INVALID_INPUT` קיימים).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_notification_centers.sql` (`npx supabase migration new notification_centers`) -- שני ה-RPC והאינדקס. סשן ראשי: ‏`apply_migration`, ‏`get_advisors`, ‏`generate_typescript_types` ← ‏`lib/supabase/database.types.ts`.
- [ ] `supabase/tests/notification-centers.test.ts` -- כל שורות המטריצה; ‏`grants.test.ts` -- שורות שני ה-RPC.
- [ ] `lib/notifications/load.ts` (server-only) -- רשימה ומונה לפי kind; ‏`lib/time.ts` + טסט -- ‏`formatNotificationTime`.
- [ ] `lib/copy/shell.ts` -- מיקרו-קופי של הסרגל, הפעמון, המרכז, הבית והציבורי.
- [ ] `components/shared/app-top-bar.tsx`, ‏`bell-button.tsx`, ‏`notification-item.tsx`, ‏`notification-list.tsx` + טסטים (שם נגיש, ‏sr-only, תחילית, ‏99+) -- **מתחילים בסקיל `frontend-design`.**
- [ ] `app/me/notifications/{page,actions}.ts(x)`, ‏`app/admin/(shell)/notifications/{page,actions}.ts(x)` -- מרכז, ‏`markRead`, ‏`markUnread` ו-`getUnreadCount` (‏`ActionResult`).
- [ ] שתי המעטפות, ‏`app/me/page.tsx`, ‏`more/page.tsx`, ‏`side-nav.tsx` -- הסרגל והוצאת ההתנתקות.
- [ ] `app/(public)/layout.tsx`, ‏`top-bar.tsx`, ‏`menu-sheet.tsx`, ‏`whatsapp-bar.tsx` + `public-shell.test.tsx` -- קישור לפי תפקיד ופס בלי לקוחה.
- [ ] `lib/nav.test.ts` -- אין `/me/notifications` ב-`customerNav`, ואין `SignOutButton` מחוץ לסרגל, ל-`/login` ול-`/join`.
- [ ] `deferred-work.md` -- chips של לקוחה ב-`/sessions` (מ-5.16). ‏`tickets.toml` של האפיק: 5.7 ‏done (ב-PR).

**Acceptance Criteria:**
- Given המיגרציה הוחלה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`, ו-`npm run test:db` עובר בלי שאריות `test_%`.
- Given לקוחה עם התראה שלא נקראה בשני מכשירים, when היא לוחצת עליה באחד, then היא מגיעה ליעד, ובשני המונה יורד כשחוזרים לאפליקציה.
- Given טלפון בכל מסך ב-`/me` וב-`/admin`, when גוללים, then הסרגל הזיתי נשאר למעלה עם השם בימין, ופעמון והתנתקות בשמאל עובדים; אין התנתקות אחרת.
- Given לקוחה מחוברת בעמוד ציבורי, then "האזור שלי" בסרגל ובתפריט ואין פס וואטסאפ; לאורחת הכול כמו היום, והעמודים הציבוריים נשארים במטמון (‏build בלי שגיאת dynamic).

## Implementation Notes

- המיגרציה `20261006104423_notification_centers.sql` הוחלה ב-`apply_migration` מהסשן הראשי (גרסה `20261006111809` ב-`schema_migrations`). ה-advisor: רק 0029 ו-`auth_leaked_password_protection`. ‏`database.types.ts` שנוצר מהמסד זהה לקובץ.
- הקריאה של התפקיד בעמוד הציבורי: ‏`components/public/viewer-shell.tsx` בתוך `Suspense`; ‏`getViewerRole` עטוף ב-`cache()`. ריווח הפוטר עבר ל-`globals.css` (`body:has([data-whatsapp-bar])`).
- הפעמון מתעדכן מיד (delta) ואחרי כל סימון מבקש את המונה מהשרת; רק התשובה האחרונה נקלטת.
- ‏`npm run test:db`: בדיקות 5.7, ‏notifications ו-grants עוברות. ‏`admin-booking.test.ts` נכשל בעקביות (`NO_MATCHING_ENTITLEMENT` ב-preview), ו-`events-admin`/`self-booking` נכשלו ב-timeout רק בריצה מלאה ועוברים לבד. המסד המשותף כולל גם את מיגרציות 5.5 ו-3.12 (שמגדירה מחדש `occupied_places` ו-`preview_book_session`); מיגרציית 5.7 לא נוגעת במימון או בהרשמות.
- בדיקת הטלפון של המשתמשת (2026-10-06) הוסיפה שני תיקונים, שנרשמו ב-memlog של ה-UX: (1) ביטול ההרשמה רק בעמוד המפגש. בבית וב"ההרשמות שלי" אין כפתור ואין הודעה, וגם אחרי חלון הביטול מוצג אותו כפתור, ורק לחיצה עליו מציגה "לא ניתן לבטל עצמאית פחות מ-{n} שעות לפני המפגש." עם "צרי קשר" ({n} מ-`policy_snapshot` של ההרשמה). (2) תמונת האודות: ‏`sizes` לפי הרוחב שהתמונה הרוחבית תופסת במסגרת 4:5, כי במחשב היא הייתה מפוקסלת.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. low 18, false 1, gap 1; patch 6, defer 0, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | המונה אחרי "סימון הכול" ופתיחת שורה מחושב מהפרשים (`ids.length - marked` שלילי, סימון שנכשל או עבר 1.5 שניות, רענונים חופפים) | low | edge-case + blind | patch: אחרי שהסימון מסתיים הפעמון מבקש רענון מהשרת, ורק התשובה האחרונה נקלטת |
| 2 | פתיחת שורה מתעלמת מסימון שנכשל | low | edge-case + blind | patch: השורה חוזרת ל"לא נקראה" |
| 3 | "סימון הכול" בלי מצב busy, לחיצה כפולה שולחת פעמיים | low | blind | patch: הכפתור מושבת עד התשובה |
| 4 | כשל בספירה מחזיר 0 כהצלחה ומעלים את המונה | low | blind | patch: ‏`null` ← ‏`SERVER_ERROR`, והפעמון שומר את הערך האחרון |
| 5 | `getViewerRole` רץ פעמיים בכל עמוד ציבורי | low | blind | patch: ‏React `cache()` |
| 6 | העטיפות ב-`load.ts` (קריאה ל-RPC, ‏`INVALID_INPUT`, ‏`marked`, סינון `recipient_kind` ו-`read_at`) בלי בדיקה | gap | verification-gap (כולל ממצא 2 שלו, שסומן defer) | patch: ‏`lib/notifications/load.test.ts` |

Reject (14): "סימון הכול" של אדמינית שיש לה גם פרופיל לקוחה מסמן גם את התראות הלקוחה (`get_my_session_role` מחזיר admin קודם, והיא לא מגיעה ל-`/me`; התיקון מוסיף פרמטר), אין בדיקת מסד למשתמשת בשני התפקידים (אותה סיבה), ‏toggle פעיל בזמן פתיחה ו-rollback אחרי "סימון הכול" (נדיר, מוסיף ענפים), אין `error.tsx` (דפוס קיים בכל הדפים), ‏`../` ב-`target_path` (הנתיבים נבנים ב-SQL שלנו, נדחה גם ב-2.12), ‏`initialCount` ו-`initialItems` לא מסתנכרנים (הפעמון מתרענן בכל מעבר, ומעבר לאותו דף לא מביא נתונים חדשים), מגבלת 100 מול המונה (החלטת ה-spec; ‏5.10 מנקה), הפס מופיע מאוחר לאורחת (החלטת ה-spec, הפס fixed), ‏media query כפול וגובה 64px בשלושה קבצים (קוסמטי), האינדקס בלי `recipient_kind` (false: מעט שורות לנמענת), בדיקות אינטראקציה בדפדפן (ב-`review-accepted.md`). ‏intent-alignment: מתאר את מה שנבנה.

## Verification

**Commands:**
- `npm run lint`, ‏`npm run format:check`, ‏`npm run typecheck`, ‏`npm test`, ‏`npm run test:db`, ‏`npm run build` -- expected: הכול עובר.

**Manual checks:**
- בטלפון של המשתמשת: שני המשטחים, מסך ההתראות, הבית והעמודים הציבוריים כלקוחה מחוברת.
