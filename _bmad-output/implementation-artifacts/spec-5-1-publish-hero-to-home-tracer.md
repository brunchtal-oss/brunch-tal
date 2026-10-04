---
title: '5.1 Publish hero to home tracer — פרסום ההירו לבית'
type: 'feature'
created: '2026-10-04'
status: 'in-progress'
baseline_commit: '66fec7d4a57b46db3affd0e1c0a6eb47233abd54'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין עריכה ופרסום של תוכן. הבית מציג רק את שם העסק, ופרטי העסק הם מספר וואטסאפ אחד (seed של 2.2).

**Approach:** עורכי הירו ופרטי עסק באדמין (טיוטה ← תצוגה מקדימה ← פרסום), RPC פרסום עם גרסה, והבית קורא את ההירו שפורסם מהמטמון ומתעדכן ב-`updateTag`.

## Boundaries & Constraints

**Always:** AD-5, ‏AD-15, ‏AD-16. ‏`frontend-design` לפני כל מסך. עברית רק ב-`lib/copy/*` ו-`lib/errors.ts`. תוכן בדוי רק במסד הפיתוח (`execute_sql`, נתונים), לא במיגרציה.

**Decisions:**
- **מיגרציה:** ‏`content_pages` ‏`home` (לא פורסם) ו-`content_sections` ‏`home/hero/hero` (‏`sort_order` 1, בלי טיוטה). בלי עמודות חדשות.
- **`admin_get_content_page(p_slug)`** (קריאה): ‏`published_version`, ‏`published_at` והסקשנים לפי `sort_order`, עם טיוטה ופורסם. דף לא קיים ← `NOT_FOUND`.
- **`admin_set_content_draft(p_slug, p_key, p_content)`** (‏`set_*`, בלי idempotency): רק סקשן קיים (אחרת `NOT_FOUND`), ‏object בלבד (אחרת `INVALID_INPUT`), ‏`updated_by`, ‏audit.
- **`admin_publish_content(p_slug, p_idempotency_key)`**: נועל את הדף; כל סקשן שהטיוטה שלו לא ריקה ושונה ← פורסם, עם audit; הדף מסומן כמפורסם (‏`{}` אם ריק) ו-`published_version + 1`. מחזיר `{published_version, changed}`; בלי שינוי ← `changed: 0` והגרסה לא עולה.
- **zod ב-action:** בודק את הטיוטה לפי ה-`kind` לפני שמירה, ואת כל הטיוטות לפני פרסום (לא תקין ← `INVALID_INPUT`, כלום לא מתפרסם). אחרי פרסום: `updateTag('content:<slug>')`, וב-`contact` גם `content:global`.
- **סכמות:** ‏`hero`: ‏`title` (חובה, ≤80), ‏`description` (≤300), ‏`cta_label` (חובה, ≤40). ‏`business_details`: ‏`whatsapp_phone` (חובה), והשאר רשות: `business_name`, ‏`phone`, ‏`whatsapp_message`, ‏`address`, ‏`arrival_instructions`, ‏`navigation_url` (‏https), ‏`payment_instructions`. התג שלהם `content:global` (במקום `content:contact`).
- **מסכים:** "עוד" ← `/admin/content`: שורות "בית" ו"פרטי העסק" עם chip (טיוטה / פורסם / שינויים שלא פורסמו). ‏`/admin/content/home` ו-`/contact`: טופס, "שמירת טיוטה", "פרסום" (רק כשיש שינוי). בבית גם "תצוגה מקדימה" ← `/admin/content/home/preview`: רכיב ההירו של הבית עם הטיוטה, ופס קבוע "תצוגה מקדימה — עוד לא פורסם" עם "חזרה לעריכה" ו"פרסום". תצוגה מקדימה לפרטי העסק ב-5.2 (עם `/contact`).
- **הבית:** ‏`'use cache'`, ‏`cacheTag('content:home')`, ‏`cacheLife('minutes')`, ‏`createPublicClient`. הירו טיפוגרפי (DESIGN › `hero`, צילום ב-5.4): שם העסק, ‏`title`, ‏`description`, ‏`button-primary` עם `cta_label`, שמוצג רק כש-`/sessions` ב-`publicNav` (מ-3.2; הבדיקה של `lib/nav` מוודאת `page.tsx`). אין הירו תקין שפורסם ← שם העסק בלבד, כמו היום.
- **קישור מ-`/admin/settings`** לפרטי העסק: ב-4.7 (deferred-work).

**Never:** עמודות טיוטה ל-anon או ללקוחה, טיוטה בנתיב ציבורי, `'use cache'` בתצוגה המקדימה, ‏top-bar, תפריט ופוטר (5.2), תמונות (5.4), סידור והסתרה (5.3), שינוי במדיניות או בגרסת ההסכמה.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| פרסום | טיוטה תקינה ← פרסום | גרסה +1; anon רואה; הבית מתעדכן בלי פריסה |
| רק טיוטה | לא פורסמה | anon לא רואה (RLS ו-grants); הבית ללא שינוי |
| חוזר | אותו מפתח | אותה תוצאה, גרסה +1 פעם אחת |
| אין שינוי | בלי טיוטה חדשה | ‏`changed: 0`, אותה גרסה |
| פורסם לא תקין | בלי `title` | fallback |
| טיוטה לא תקינה | ‏`cta_label` ריק | ‏`INVALID_INPUT`, כלום לא נשמר |
| לא אדמין | לקוחה / anon | ‏`NOT_AUTHORIZED` / 42501 |
| לא קיים | ‏`p_key` או `p_slug` לא מוכר | ‏`NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001195103_create_join_flow.sql:85-180`, ‏`20261002041859_fix_content_sections_policy.sql` -- טבלאות, policy ו-grants (anon רק `published_*`). לא משנים.
- `supabase/migrations/20261003220222_repeat_purchase_and_amount_override.sql:140-300` -- דפוס RPC אדמין: ‏`private.is_admin()`, ‏`idempotent_begin`/`_finish`, ‏`private.audit` (‏`content_sections`, ‏`id` הסקשן).
- `lib/content/schema.ts`, ‏`business-details.ts`, ‏`join-form.ts` -- דפוס הקריאה במטמון.
- `lib/rpc.ts`, ‏`lib/errors.ts` (‏`NOT_FOUND` חדש), ‏`app/admin/(shell)/links/actions.ts` -- דפוס ה-action.
- `app/(public)/page.tsx`, ‏`lib/copy/shell.ts` (‏`wordmark`) -- הבית של היום = ה-fallback.
- `lib/nav.ts` (+test) -- ‏`adminMoreNav` ו-`publicNav` חדש (בינתיים `/`).
- `supabase/tests/content.test.ts`, ‏`grants.test.ts` (‏`EXPECTED_GRANTS`), ‏`support/db.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_content_publish.sql` -- שורות `home` ושלושת ה-RPC (revoke, ‏grant ל-`authenticated`). החלה רק אחרי ש-2.6 ב-main (**סשן ראשי**).
- [x] `lib/content/schema.ts` (+test) -- ‏`heroSchema`, ‏`businessDetailsSchema` מורחב, מפה `kind` ← סכמה.
- [x] `lib/content/home.ts` (+test), ‏`business-details.ts` -- ‏`getHomeHero()` במטמון; תג `content:global`.
- [x] `app/admin/(shell)/content/**` (+`actions.test.ts`) -- רשימה, שני עורכים, תצוגה מקדימה, actions.
- [x] `components/public/home-hero.tsx`, ‏`app/(public)/page.tsx` -- הירו משותף לבית ולתצוגה המקדימה.
- [x] `lib/copy/admin.ts`, ‏`lib/errors.ts`, ‏`lib/nav.ts` (+tests) -- מיקרו-קופי, ‏`NOT_FOUND`, ניווט.
- [x] `supabase/tests/content-publish.test.ts`, ‏`grants.test.ts` -- המטריצה ברמת המסד.
- [ ] מסד הפיתוח (**סשן ראשי**) -- הירו ופרטי עסק בדויים ומפורסמים; ‏`get_advisors`, ‏`database.types.ts`, ‏`npm run test:db`.
- [x] `deferred-work.md` -- הקישור מ-`/admin/settings` (4.7).

**Acceptance Criteria:**
- Given טל בטלפון, when היא משנה את כותרת ההירו, רואה תצוגה מקדימה ומפרסמת, then הבית מציג אותה בטעינה הבאה, בלי פריסה.
- Given טיוטה שלא פורסמה, when אורחת פותחת את `/`, then היא רואה רק את מה שפורסם.
- Given `/admin/content/*`, when התגובה נשלחת, then `Cache-Control: private, no-store`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

ה-RPC לא מכיר zod: ה-action הוא שער הצורה (AD-16), וה-RPC אוכף הרשאה, object וגרסה. האתר מפרש שוב, ולכן שורה ידנית לא תקינה לא מוצגת.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm run format:check && npm test` -- expected: עובר
- `npm run test:db` -- expected: עובר, כולל `content-publish` ו-`grants`
- `npm run build` -- expected: תקין

**Manual checks:**
- ברוחב 360px: עריכה ← תצוגה מקדימה ← פרסום ← הכותרת החדשה בבית.
