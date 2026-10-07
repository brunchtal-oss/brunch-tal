---
title: 'שתי הסכמות לצילום וטופס הצטרפות בשני שלבים (2.13)'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '4a4771e377c19f8fc339888bd51a7a8766636512'
route: 'full'
route_source: 'auto'
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

**Problem:** יש היום שאלת צילום אחת. המשתמשת החליטה (2026-10-07, ב-memlog של ה-SPEC ושל ה-UX) על שתי הסכמות נפרדות: פרסום תמונות אווירה, וצילום תמונות אישיות ושיתוף בקבוצת הוואטסאפ. בגלל השאלה הנוספת, טופס ההצטרפות עובר לשני שלבים.

**Approach:** `profiles.photo_consent` נשארת הסכמת האווירה, ונוספות עמודות באותו דפוס להסכמה האישית. `join_complete` דורשת את שתיהן, ו-RPC חדשה משנה את האישית מהפרופיל. בלוק התוכן עובר לשתי שאלות והערה. הטופס מתפצל לשני שלבים בצד הלקוח בלבד, והשרת ממשיך לבדוק הכול.

## Boundaries & Constraints

**Always:**
- **עמודות חדשות ב-`profiles`:** `personal_photo_consent boolean not null default false`, ‏`personal_photo_consent_at timestamptz`, ‏`personal_photo_consent_text_version integer check (>= 0)`. לקוחה קיימת: אווירה = מה שענתה, אישית = לא אישרה. ל-`authenticated` אין update על העמודות האלה. מקור הגרסה אחד לשתי ההסכמות: `published_version` של `content_pages` ‏`join-form`.
- **`join_complete`:** אותה חתימה, ‏`create or replace`. ב-`p_profile` נוסף המפתח `personal_photo_consent`. אם הוא לא boolean: ‏`INVALID_INPUT` עם `{"field": "personal_photo_consent"}`, בדיוק כמו `photo_consent`. שתי ההסכמות נשמרות עם `now()` ועם אותה גרסה.
- **`claim_join`** לא כותבת הסכמה היום ולא משתנה. בודקים שהיא לא משנה את ההסכמות.
- **`set_personal_photo_consent(p_consent boolean) returns jsonb`:** העתק מבני של `set_photo_consent` (הגרסה ב-`set_photo_consent_not_found_guard`): ‏definer, ‏`search_path = ''`, ‏revoke מכולם ו-grant אחד ל-`authenticated`, פטורה מ-idempotency. בלי לקוחה פעילה: `NOT_AUTHORIZED`. ‏null: ‏`INVALID_INPUT` ‏`personal_photo_consent`. נועלת את הפרופיל. ערך זהה: בלי כתיבה ובלי יומן. ערך שונה: שומרת ערך, מועד וגרסה, ורושמת ב-`private.audit` (before/after). מחזירה את שלוש העמודות.
- **תצוגה לאדמין:** `admin_get_customer` מחזירה גם `personal_photo_consent` ו-`personal_photo_consent_at`. ‏`admin_get_event_details` מחזירה גם `personal_photo_consent`, באותו תנאי של לקוחה פעילה. שתיהן ב-`create or replace` מהגרסה האחרונה, בלי שינוי אחר.
- **תוכן `join-form/photo_consent`:** שדות שטוחים `atmosphere_title`, ‏`atmosphere_question`, ‏`atmosphere_yes`, ‏`atmosphere_no`, ‏`personal_title`, ‏`personal_question`, ‏`personal_yes`, ‏`personal_no` ו-`note`. המיגרציה כותבת את הנוסח מה-memlog של ה-UX (2026-10-07) מילה במילה, ל-`draft_content` ול-`published_content`, ומעלה את `published_version` של העמוד ב-1 (כמו `content_publish`). שבירת שורה (" / " ב-memlog) נשמרת כ-`\n`, ו-"##" הוא הכותרת. התשובות: "כן, אני מסכימה." ו"לא, איני מסכימה.".
- **טופס בשני שלבים:**
  - שלב 1: כל השדות עד הסיסמה, אישור הסיסמה וצ׳קבוקס הפרטיות, ואחריהם "הבא". שלב 2: שתי השאלות, ההערה, "חזרה" ו"יצירת החשבון".
  - טופס אחד: השלב הלא פעיל מוסתר (`hidden`) ולא מוסר מה-DOM, כך שהערכים נשמרים ונשלחים יחד.
  - "הבא" מריץ את `validateJoin` על ה-FormData ומציג רק את שגיאות שלב 1, באותו סיכום ובאותן שגיאות שדה.
  - תשובה מהשרת: שגיאה על שדה משלב 1, ‏`email_exists` או `identity_retry` מחזירים לשלב 1. שגיאה על אחת ההסכמות או שגיאה כללית משאירות בשלב 2.
  - פוקוס: מעבר בכפתור מעביר לכותרת השלב (`h2`, ‏`tabIndex={-1}`). מעבר בגלל שגיאה שומר על כלל הפוקוס הקיים (שדה או סיכום).
  - אף תשובה לא מסומנת מראש, ואין "(חובה)" ליד השאלות.
- **האלרגיות, רק בטופס ההצטרפות:** התווית "אלרגיות והעדפות תזונתיות (לא חובה)", ומתחתיה הסבר קטן שמקושר ב-`aria-describedby`: "המידע שתמסרי יישמר וישמש להתאמת האירוח". הנוסח ב-`lib/copy/join.ts`.
- **פרופיל:** כותרת אחת לאישור התמונות, ותחתיה שני טפסים, כל אחד עם שאלה, תשובה נוכחית מסומנת וכפתור שמירה משלו. ההערה מוצגת מתחת לשניהם.
- **תצוגה לטל:**
  - כרטיס הלקוחה: שורה אחת "אישור תמונות" עם שתי שורות טקסט, "אישרה / לא אישרה תמונות אווירה" ו"אישרה / לא אישרה תמונות אישיות". בלי תאריך (החלטת המשתמשת 2026-10-07).
  - שורת הנרשמת בפרטי המפגש: שני הנוסחים. כשאין לקוחה פעילה לא מוצג כלום.
  - לשונית העבודה, עמודת "אישור תמונות": טקסט קצר בלי בועיות, כי אין להן מקום בטבלה (החלטת המשתמשת 2026-10-07, מחליפה את ה-status-chip). למשל "אווירה ✗ · אישיות ✓". סימן ✗ מקבל את הסגנון הקיים של "לא אישרה" (`font-semibold text-warning`), בלי צבע חדש. ל-✓ ול-✗ יש `aria-label` בנוסח המלא ("אישרה תמונות אווירה"), והטקסט נשאר בהדפסה. כשאין לקוחה פעילה, התא ריק כמו היום.
- **מסכים:** מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. בלי "טל" במיקרו-קופי. נוסח ההסכמות הוא תוכן ומאושר כמו שהוא. רק כיווני Tailwind לוגיים.

**Never:**
- אין `drop` ואין שינוי שם של עמודה. אם בכל זאת צריך `drop`: עוצרים ומדווחים.
- לא נוגעים ב-events, ‏bookings, ‏work_sheets ו-shopping_items (חוץ מקריאה בפונקציות שמוגדרות מחדש), ולא בכסף או בזכויות.
- בלי שינוי בעיצוב הכללי של המסכים, בלי הסבר האלרגיות בפרופיל ובלי שינוי במדיניות הפרטיות.
- `photo_consent` לא נכתבת בשיוך ולא בעדכון ישיר.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| הצטרפות עם שתי תשובות | אווירה כן, אישית לא, ‏join-form בגרסה N | שתי העמודות עם `now()` ו-N | — |
| חסרה תשובה אישית | המפתח חסר או null | לא נוצר חשבון | `INVALID_INPUT` ‏`personal_photo_consent`, השגיאה מוצגת בשלב 2 |
| "הבא" עם שם ריק | שלב 1 | נשארים בשלב 1, סיכום ושגיאת שדה | — |
| "הבא" תקין ואז "חזרה" | שדות מלאים | שלב 1 עם כל הערכים | — |
| שליחה בלי בחירה | שלב 2 בלי סימון | לא נשלח לשרת | `photoConsent` / ‏`personalPhotoConsent`: "צריך לבחור אחת מהתשובות" |
| שגיאת שרת בשלב 1 | שליחה מחזירה שגיאת טלפון | חזרה לשלב 1, סיכום ופוקוס לפי הכלל הקיים | — |
| שיוך לחשבון קיים | לקוחה עם אווירה כן, אישית לא | ההסכמות לא משתנות | — |
| שינוי אישית בפרופיל | false→true | ערך, `now()`, גרסה ושורת יומן | — |
| אישית, אותו ערך | true→true | בלי כתיבה ובלי יומן | — |
| לא לקוחה פעילה | אדמין או חשבון לא מופעל | — | `NOT_AUTHORIZED` |
| לשונית העבודה | אווירה true, אישית false | "אווירה ✓ · אישיות ✗", ‏✗ בסגנון warning, ו-aria מלא | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261002194018_identity_retry_and_conflict_reasons.sql:263-525` -- הגרסה האחרונה של `join_complete`. הבדיקה של `photo_consent` בשורות 373-375, הגרסה ב-431-433, וה-insert ב-443-452. מעתיקים אותה ומשנים רק את מה שצריך.
- `supabase/migrations/20261006000155_set_photo_consent_not_found_guard.sql` -- התבנית של ה-RPC החדשה, כולל ה-grants.
- `supabase/migrations/20261007121030_customers_phone_check.sql:86-273` -- הגרסה האחרונה של `admin_get_customer` (ההסכמה בשורות 262-263). ‏`supabase/migrations/20261006215720_work_sheet_shopping.sql:247-324` -- הגרסה האחרונה של `admin_get_event_details` (295, וה-join ב-313-318).
- `supabase/migrations/20261001195103_create_join_flow.sql:165-173` -- ה-seed הישן של הבלוק. ‏`20261004122702_content_publish.sql:225` -- איך מעלים את `published_version`.
- `supabase/tests/{join,existing-account,link-lifecycle,profile,bind-purchase}.test.ts` -- כל אחד בונה payload ל-`join_complete` עם `photo_consent`. מוסיפים `personal_photo_consent`. ‏`profile.test.ts:293` -- דפוס הבדיקות של `set_photo_consent`. ‏`grants.test.ts:148` -- מוסיפים שורה ממוינת. ‏`customers.test.ts`, ‏`shopping-items.test.ts:424-483` -- המפתחות של האדמין. ‏`content.test.ts` -- ה-seed.
- `app/(auth)/join/[token]/join-form.tsx` -- טופס לא נשלט (`noValidate`, ‏`useActionState`, ‏`onSubmit` ידני), סיכום שגיאות (221-244), פוקוס (119-127), ו-`fieldId` (49). ‏`join-input.ts` -- ‏`validateJoin` טהורה ומיובאת בלקוח. ‏`JoinField` (16), הבדיקה של photo (106). ‏`actions.ts:37-65` -- ‏`rpcFieldError`. ‏`claim-join.tsx` -- לא משתנה.
- `lib/server/privileged/join.ts:120,389-401` -- ‏`JoinInput` וה-payload.
- `components/shared/photo-consent-fieldset.tsx` -- ה-id וה-name קבועים. צריך prop של `name` (ה-id נגזר ממנו), כותרת ושאלה נפרדות. הקוראים: join-form, ‏preview, ‏`app/me/profile/photo-consent-form.tsx`.
- `lib/content/schema.ts:29-35,281`, ‏`lib/content/join-form.ts`, ‏`app/admin/(shell)/content/section-fields.ts:330-342`, ‏`[slug]/preview/page.tsx:229-240`, ‏`lib/copy/admin.ts:280-285`, וגם הבדיקות שלהם.
- `app/me/profile/{page.tsx:60,93-97, photo-consent-form.tsx, actions.ts:161-170}` -- הפרופיל.
- `app/admin/(shell)/customers/[id]/card-items.ts:113-138` (+test) ו-`page.tsx:90` (רינדור השורה). ‏`sessions/[id]/load-details.ts:38,83` (+test) ו-`components/admin/attendee-row.tsx` (השורה לא מציגה היום הסכמה). ‏`work/attendee-sections.tsx:96,124-131`, ‏`work/shopping-message.ts:59-66` (`consentText`), ‏`work/work-sheet-data.ts:198`. הקופי ב-`lib/copy/admin.ts` (‏`customers.card` בשורות 1087-1091, ‏`work` בשורות 858-860).
- הבדיקות של המסכים רצות ב-`renderToStaticMarkup` בסביבת node, בלי jsdom. לכן הלוגיקה של השלבים יוצאת לפונקציות טהורות.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_two_photo_consents.sql` -- נוצר ב-`npx supabase migration new two_photo_consents`. מכיל: העמודות, ‏`join_complete`, ‏`set_personal_photo_consent` עם ה-grants, ‏`admin_get_customer`, ‏`admin_get_event_details`, ועדכון התוכן והגרסה. מחילים ב-`apply_migration`, ואחר כך `get_advisors`.
- [x] `lib/supabase/database.types.ts` -- ‏`generate_typescript_types`.
- [x] `supabase/tests/*` -- הצטרפות עם שתי תשובות, אחת חסרה, שיוך בלי שינוי, הפונקציה החדשה (יומן, ‏`NOT_AUTHORIZED`, ערך זהה, null), המפתחות החדשים באדמין, ה-seed החדש ו-`grants.test.ts`. מעדכנים את ה-payloads הקיימים.
- [x] `lib/content/schema.ts`, ‏`join-form.ts`, ‏`section-fields.ts`, ‏preview, ‏`lib/copy/admin.ts` (+tests) -- הסכמה החדשה, העורך (‏title ו-yes/no עד 200, ‏question ו-note עד 1000, ‏multiline), והתצוגה המקדימה עם שתי השאלות וההערה.
- [x] `components/shared/photo-consent-fieldset.tsx` (+test) -- props: ‏`name`, ‏`title`, ‏`question`, ‏`yesLabel`, ‏`noLabel`, ‏`error`, ‏`defaultValue`. ההערה ברכיב נפרד קטן, ‏`PhotoConsentNote`.
- [x] `app/(auth)/join/[token]/join-steps.ts` (+test) -- פונקציות טהורות: ‏`STEP_TWO_FIELDS`, ‏`stepOneErrors(errors)` ו-`stepForState(state)`.
- [x] `join-input.ts`, ‏`actions.ts`, ‏`join-form.tsx`, ‏`page.tsx`, ‏`lib/server/privileged/join.ts`, ‏`lib/copy/join.ts` (+tests) -- השדה `personalPhotoConsent`, המיפוי `personal_photo_consent`, שני השלבים, הכותרות והכפתורים ("הבא", "חזרה"), והאלרגיות.
- [x] `app/me/profile/*` (+tests) -- ‏`setPersonalPhotoConsent`. ‏`PhotoConsentForm` מקבל את סוג ההסכמה. ה-select כולל את העמודה החדשה.
- [x] `card-items.ts`, ‏`page.tsx` של הכרטיס, ‏`load-details.ts`, ‏`attendee-row.tsx`, ‏`work-sheet-data.ts`, ‏`shopping-message.ts`, ‏`attendee-sections.tsx`, ‏`lib/copy/admin.ts` (+tests) -- הנוסחים. ‏`consentMarks(attendee)` מחזירה `{text, label, declined}[]` (או רשימה ריקה), והתא נבנה ממנה. ‏`consentText` הישנה יוצאת אם אין לה עוד קוראים.
- [x] `_bmad-output/specs/spec-brunch-at-tal/data-model.md` -- העמודות החדשות ב-profiles.

**Acceptance Criteria:**
- Given לקוחה ששינתה בפרופיל רק את ההסכמה האישית, when טל פותחת את הכרטיס ואת לשונית העבודה, then האווירה לא השתנתה והאישית מוצגת בערך החדש.
- Given טל ערכה ופרסמה את הנוסח בעורך, when נפתח קישור הצטרפות, then שלב 2 מציג את הנוסח החדש, ו-`published_version` עלה.

## Implementation Notes

- **מיגרציה:** `20261007183144_two_photo_consents.sql`. שם הקובץ תוקן לגרסה שנרשמה במסד. ‏advisor: רק WARN ‏0029 ו-leaked password המאושרים.
- **כפתור "אחורה" בטלפון (החלטת המשתמשת 2026-10-07, בבדיקה בטלפון):** שלב 2 הוא רשומה משלו בהיסטוריה (`stepTwoHistoryState`, ‏`isStepTwoEntry`, ‏`stepOfEntry` ב-`join-steps.ts`). "אחורה" בשלב 2 מחזיר לשלב 1 בלי למחוק דבר. בכל חזרה לשלב 1 (הכפתור, "חזרה" או שגיאה) הרשומה יוצאת, כך ש"אחורה" הבא עוזב את הדף כרגיל. בזמן שליחה נשארים בשלב 2.
- **בדיקות:** ‏unit 1787, ‏db 774, ‏lint, ‏format, ‏typecheck ו-build ירוקים (לפני שינוי כפתור "אחורה"; אחריו רצו בדיקות הטופס, typecheck ו-lint).

## Spec Change Log

## Review Triage Log

**סבב 1 (blind, ‏edge-case, ‏verification-gap, ‏intent-alignment).**

| # | ממצא | ורדיקט | ניתוב | ראיה ופעולה |
|---|---|---|---|---|
| 1 | ההחלטות של הטופס (תוצאת שרת ← שלב, ‏onSubmit) בתוך הרכיב ולא נבדקות (VG) | medium | patch | עברו לפונקציות טהורות ב-`join-steps.ts`, עם בדיקות |
| 2 | איזו פעולה ואיזה שדה כל טופס הסכמה בפרופיל שולח לא נבדק (VG) | medium | patch | המיפוי מיוצא ונבדק |
| 3 | בדיקת ה-seed נשברת אחרי פרסום בעורך, וה-seed לא נבדק מול הסכמה (edge, ‏VG) | medium | patch | במסד: גרסה ≥ 1 ו-safeParse. הנוסח המדויק נבדק בבדיקת יחידה מול קובץ המיגרציה |
| 4 | סיכום השגיאות בשלב 2 מציג אותו משפט פעמיים (blind) | medium | patch | הודעה לכל שאלה |
| 5 | הסימונים בלשונית העבודה הם `role="img"` (blind) | medium | patch | טקסט גלוי `aria-hidden` ותווית `sr-only` |
| 6 | ARCHITECTURE-SPINE ו-security-and-rpc-rules מזכירים רק את `set_photo_consent`, כולל רשימת הפטורים מ-idempotency (blind) | medium | patch | עודכנו |
| 7 | "חזרה" פעיל בזמן שליחה (blind) | low | patch | `aria-disabled` ויציאה מוקדמת |
| 8 | הסרת תינוק אחרי "הבא" משאירה שגיאת תינוק מקומית על שורה שזזה (edge) | low | patch | מסננים גם את הבדיקה המקומית |
| 9 | אין בדיקת מסד למפתח `personal_photo_consent` שחסר לגמרי (blind) | low | patch | נוספה |
| 10 | הסרת פרטים עתידית צריכה לאפס גם את `personal_photo_consent*` (blind) | medium | defer | אין עדיין פונקציית הסרה. נרשם ב-deferred-work (4.6) |

נדחו (8): לקוחה ותיקה רואה "לא" מסומן באישית, וטל לא מבחינה בין "סירבה" ל"לא נשאלה": זו החלטת המשתמשת (קיימת = לא אישרה). המיגרציה במסד הפיתוח שוברת את ההצטרפות ב-main עד המיזוג: זמני, כמו בכל מיגרציה, ומוצג למשתמשת. אין סימון "שלב X מתוך 2": לא נדרש, עבודה לסבב העיצוב. epic-2-context קוצר: קובץ מטמון שנבנה מחדש ממסמכי התכנון, וההחלטות נשארו בהם. התאריכים שמוחזרים ב-`admin_get_customer` ולא מוצגים: לא מזיקים. המיגרציה לא בודקת שהבלוק קיים: ה-seed של `create_join_flow` תמיד יוצר אותו. ה-Code Map מזכיר את `bind-purchase.test.ts` בטעות: התיקון הוא עריכה של ה-spec. ברירת המחדל לשורות קיימות לא נבדקת: היא `default false` של Postgres.

## Design Notes

**למה שלבים בצד הלקוח בלבד:** הפעולה בשרת (`submitJoinAction`) נשארת אחת ובודקת את כל השדות. "הבא" לא קורא לשרת, ולכן לא נצרך ניסיון זהות ולא נוצר מצב ביניים. הכללים זהים, כי `validateJoin` היא אותה פונקציה בלקוח ובשרת.
## Verification

**Commands:**
- `npm run test:db` -- ירוק, כולל `grants.test.ts`.
- `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` -- ירוק.
- `get_advisors` (security) -- רק ה-WARN המאושרים (0029 ו-leaked password).

**Manual checks (if no CLI):**
- בטלפון: "הבא" עם שדה ריק, "חזרה" שומר את הערכים, שליחה בלי בחירה, יצירת חשבון, שתי השאלות בפרופיל, שני הנוסחים בכרטיס ובשורת הנרשמת, הסימונים בלשונית העבודה, עריכה ופרסום בעורך, ושדה האלרגיות.
