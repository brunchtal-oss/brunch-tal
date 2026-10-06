---
title: 'מדיניות פרטיות, הצהרת נגישות ותנאי שימוש (5.5)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '502da928fb86dc8bf72068e87789c62ba9ded219'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין באתר `/privacy`, ‏`/accessibility` ו-`/terms`, וטל לא יכולה לערוך אותם. ההצטרפות שומרת גרסה 0 של המדיניות כי אין מה לפרסם, ואין תזכורת שהצהרת הנגישות (עמוד חובה חוקי) עוד לא פורסמה (CAP-29, ‏CAP-33, ‏CAP-40, מקור §"מדיניות פרטיות").

**Approach:** שלושה עמודי תוכן חדשים בעורך הקיים (טיוטה, תצוגה מקדימה, פרסום), עם שני סוגי בלוק חדשים, ועמודים ציבוריים שמרנדרים רק תוכן שפורסם. מיגרציה שזורעת את העמודים והבלוקים ומרחיבה את `admin_get_attention_items` בפריט `accessibility_unpublished`. ‏`join_complete` ו-`set_photo_consent` כבר קוראים את `published_version` מהמסד בזמן השמירה, ולכן לא משתנים.

## Boundaries & Constraints

**Always:**
- **מיגרציה:** ‏`content_pages` חדשים `accessibility` ו-`terms` (גרסה 0, לא פורסמו), ו-`content_sections` עם טיוטה ריקה: ‏`privacy/body` ו-`terms/body` מסוג `legal_sections`, ו-`accessibility/statement` מסוג `accessibility_statement`. ‏`create or replace` על `admin_get_attention_items` מגוף הגרסה שב-`20261005225116_admin_home.sql`, כל ששת הפריטים בלי שינוי (כולל `media_stuck`), ועוד ענף: ‏`kind = 'accessibility_unpublished'`, ‏`id = 'accessibility'`, ‏`customer_label` ריק, ‏`since` = ‏`created_at` של העמוד, כל עוד `published_at` של `accessibility` ריק. ההרשאות וה-grant כמו בגרסה הקיימת.
- **סכמות** (`lib/content/schema.ts`, בלי `hidden`, כך שאי אפשר להסתיר):
  - `legal_sections`: ‏`items` של `{heading` (חובה, 120), ‏`body` (חובה, 5000)`}`, 1 עד 40.
  - `accessibility_statement`. חובה: ‏`conformance_level` (1000), ‏`accessible` (5000), ‏`limitations` (5000), ‏`contact_name` (120), ‏`contact_phone` (ה-`phone` הקיים), ‏`contact_email` (מייל תקין). רשות: ‏`intro_sections` ו-`more_sections` (כמו `items` של `legal_sections`, 0 עד 20), ‏`contact_address` (300), ‏`contact_note` (3000).
  - סדר העמוד: ‏`intro_sections`, ‏"נגישות האתר" (`conformance_level`), ‏"התאמות הנגישות באתר" (`accessible`), ‏"מגבלות נגישות וקבלת סיוע" (`limitations`), ‏`more_sections`, ‏"פנייה בנושא נגישות" (שם, טלפון כ-`tel:`, מייל כ-`mailto:`, כתובת, ‏`contact_note`). הכותרות הקבועות הן מיקרו-קופי.
- **עיצוב טקסט** (כל `body` ושדה טקסט ארוך): רכיב אחד שמפרק ל-React, בלי `dangerouslySetInnerHTML`: שורה ריקה = פסקה, שורות שמתחילות ב-`- ` = רשימה, ‏`**מודגש**`, ו-`[טקסט](url)` רק ל-`https:`, ‏`tel:`, ‏`mailto:` (אחרת טקסט רגיל), ושבירת שורה בתוך פסקה נשמרת. קישור חיצוני (`https:`) נפתח בטאב חדש עם `rel="noopener noreferrer"`.
- **הנוסחים של המשתמשת** (`privacy-policy.md`, ‏`accessibility-statement.md` בשורש התיקייה הראשית, לא ב-git): נטענים כטיוטה רק למסד הפיתוח, לא למיגרציה ולא ל-repo. המדיניות: כל `##` הופך לפריט. ההצהרה: "נגישות השירות" ל-`intro_sections`, ‏"נגישות מקום המפגשים" ל-`more_sections`, השאר לשדות. הכותרת הראשית ו"תאריך עדכון" לא נטענים (מוצגים אוטומטית). המשתמשת מפרסמת מהעורך.
- **עורך:** שלושת העמודים ב-`EDITABLE_PAGES` ובתצוגה המקדימה. שני הסוגים `hideable: false`. שדה חובה חסר לא נשמר (ההתנהגות של 5.3). בעמוד `accessibility`, כל עוד לבלוק אין טיוטה תקינה ואין תוכן שפורסם, "פרסום" ב-`aria-disabled` ומעליו `inline-notice` עם רשימת שדות החובה שמקשרת לעורך הבלוק.
- **עמודים ציבוריים** (בלי התחברות, במטמון לפי `content:<slug>`): כל פריט של `legal_sections` כ-`h2` וגוף בעיצוב הטקסט. מתחת לכותרת "עודכן לאחרונה {DD.MM.YYYY}" מ-`content_pages.published_at` (עולה רק בפרסום שמשנה), דרך `lib/time.ts`. כותרות השדות של ההצהרה הן מיקרו-קופי.
- **`/accessibility` לפני פרסום ראשון:** "הצהרת הנגישות המלאה תעלה בקרוב. לכל שאלה או בקשה בנושא נגישות:" ואחריו רק פרטי קשר שכבר פורסמו (`getBusinessDetails`: טלפון, וקישור וואטסאפ). אין פרטים: רק המשפט הראשון. ‏`/privacy` ו-`/terms` לפני פרסום: ‏`EmptyPublicPage`.
- **קישורים:** עזר אחד ב-`lib/nav.ts` מחזיר את `publicLegalNav` הגלויים: ‏`accessibility` תמיד, ‏`privacy` ו-`terms` רק אם פורסמו. פוטר: שלושתם. ‏`menu-sheet`: הצהרת נגישות. התחברות (מתחת לטופס): פרטיות ונגישות. פרופיל: פרטיות ונגישות. ‏`/admin/more`: הצהרת נגישות אחרי הרשימה. טופס ההצטרפות: "מדיניות הפרטיות" בתווית ההסכמה הופכת לקישור (טאב חדש) כשהיא פורסמה.
- כל מסך מתחיל בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. מיקרו-קופי ב-`lib/copy/*`, בלי "טל".
- **שינוי אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-06). השינוי גובר על הסכמות, על עיצוב הטקסט ועל הנוסחים שלמעלה:**
  - `privacy/body` ו-`terms/body` מסוג `legal_text`: ‏`{body}` (חובה, 50000). שדה אחד שמדביקים אליו את כל הנוסח. ‏`legal_sections` יוצא. מיגרציה `20261006155737_legal_text_single_field.sql` (כבר הוחלה) ממירה את השורות הקיימות.
  - ב-`accessibility_statement` ‏`intro_sections` ו-`more_sections` מוחלפים ב-`intro` וב-`more`, שדה טקסט רשות אחד כל אחד (10000). שדות החובה לא משתנים.
  - עיצוב הטקסט מוסיף: שורה שמתחילה ב-`## ` היא כותרת (`h2`). הרמז בעורך אומר להדביק בלי הכותרת הראשית ובלי "תאריך עדכון".
  - קישור הוואטסאפ בשלושת העמודים המשפטיים, כולל נוסח הביניים, נפתח בלי הודעה ממולאת.
  - הקישור להצהרה ב-`menu-sheet` נשאר בתחתית.
- **שינוי שני אחרי הבדיקה בטלפון (החלטת המשתמשת 2026-10-06; גובר על `accessibility_statement` שלמעלה ועל EXPERIENCE › שדות החובה של ההצהרה):** ‏`accessibility_statement` = ‏`body` (חובה, 50000, אותו עיצוב טקסט עם `## `), ‏`contact_name`, ‏`contact_phone`, ‏`contact_email` (חובה). כל שאר השדות יוצאים. בעמוד: ‏`body`, ואחריו "פרטי קשר לנגישות" (שם, טלפון כ-`tel:`, מייל כ-`mailto:`). חסימת הפרסום מונה את ארבעת השדות. מיגרציה `20261006163625_accessibility_statement_single_text.sql` (הוחלה) ממירה את השורות.

**Never:** לא משנים את `join_complete`, ‏`set_photo_consent`, ‏`admin_publish_content` או טבלאות קיימות. אין RPC להסתרה או לביטול פרסום. אין טקסט משפטי בקוד ואין תוכן מומצא. לא נוגעים בכפתורי ההתנתקות, בסרגל העליון ובסדר הלשוניות (5.7 במקביל): רק מוסיפים קישורים. אין הסכמה מחודשת ללקוחות קיימות אחרי גרסה חדשה, ואין הסכמה לתנאי השימוש.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| הצטרפות אחרי פרסום | ‏`privacy` פורסמה (גרסה N) | ‏`privacy_policy_version = N` בפרופיל | — |
| פרסום שני | מדיניות שונתה ופורסמה | גרסה N+1, הצטרפות אחריו נשמרת עם N+1 | פרסום בלי שינוי: הגרסה לא עולה |
| הצהרה לא פורסמה | ‏`published_at` ריק | פריט `accessibility_unpublished` ← `/admin/content/accessibility`; ‏`/accessibility` בנוסח הביניים | לקוחה: ‏`NOT_AUTHORIZED` |
| הצהרה פורסמה | פרסום ראשון | הפריט נעלם; העמוד מציג את ההצהרה ו"עודכן לאחרונה" | — |
| שדה חסר | שמירה בלי מייל | לא נשמר, שגיאה ליד השדה | — |
| ניסיון הסתרה | טיוטה עם `hidden: true` | השדה נזרק בפענוח, הבלוק מוצג | — |
| פוטר | אף עמוד לא פורסם | רק "הצהרת נגישות" | — |
| קישור בטקסט | `[x](javascript:alert(1))`, ‏`<b>` | טקסט רגיל, בלי קישור ובלי HTML | — |
| טלפון בטקסט | `[054-4256456](tel:+972544256456)` | קישור לחיץ | — |
| כותרת בטקסט | `## מי אנחנו` בשורה משלה | ‏`h2` | `##` באמצע שורה: טקסט רגיל |
| וואטסאפ בעמוד משפטי | כל אחד משלושת העמודים | ‏`wa.me/<מספר>` בלי `?text=` | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261005225116_admin_home.sql:34-238` -- הגוף של `admin_get_attention_items` להעתקה. ה-CTE `items(since, id, item)`: אם `id` של הענפים uuid, להמיר ל-text בכל הענפים.
- `supabase/migrations/20261001195103_create_join_flow.sql:92-176` -- `content_pages`/`content_sections` והזריעה של `privacy`.
- `supabase/migrations/20261002194018_identity_retry_and_conflict_reasons.sql:427-452` -- ‏`join_complete` קורא `published_version` של `privacy` ו-`join-form`. לא לשנות.
- `lib/content/schema.ts:238` (`contentSchemas`), ‏`:20` (`phone`), ‏`:137` (`faqSchema`, תבנית לרשימה).
- `lib/content/pages.ts:35-160` -- `getPublishedPage`/`getPublishedSections`/`getPublishedPageSlugs`.
- `lib/content/business-details.ts:13` -- ‏`getBusinessDetails`.
- `lib/nav.ts:41` (`publicLegalNav`), ‏`lib/nav.test.ts:40` (בדיקת ה-hrefs).
- `app/(public)/layout.tsx:323-343`, ‏`components/public/site-footer.tsx`, ‏`components/public/menu-sheet.tsx:268`.
- `app/(public)/how-it-works/page.tsx` + `components/public/page-views.tsx` -- תבנית עמוד ותצוגה משותפת לתצוגה המקדימה; ‏`components/public/public-page.tsx` (`EmptyPublicPage`, ‏`PublicPageHeading`).
- `app/admin/(shell)/content/`: ‏`content-items.ts:18-113`, ‏`section-fields.ts:132`, ‏`[slug]/page.tsx`, ‏`[slug]/preview/page.tsx:148-212`, ‏`actions.ts:128`, ‏`content-editor.tsx:453`.
- `app/admin/(shell)/home-items.ts:104-182` + `lib/copy/admin.ts:642` (`home.items`), ‏`:134` (`content.pages`).
- `app/me/profile/page.tsx:28-122`, ‏`app/admin/(shell)/more/page.tsx`, ‏`app/(auth)/login/login-screen.tsx`, ‏`app/(auth)/join/[token]/join-form.tsx:447` + `lib/copy/join.ts:27`.
- `supabase/tests/admin-home.test.ts:156` (פריטי "לטיפול"), בדיקות `join_complete` הקיימות ב-`supabase/tests/`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_legal_pages.sql` -- זריעה + הרחבת "לטיפול" (`npx supabase migration new legal_pages`, ‏`apply_migration`, ‏`get_advisors`, ‏`database.types.ts` מחדש) -- סשן ראשי
- [ ] `lib/content/schema.ts` + בדיקה -- שני הסוגים -- כללי חובה ואי-הסתרה
- [ ] `app/admin/(shell)/content/*` + `lib/copy/admin.ts` -- עמודים, שדות, תצוגה מקדימה, חסימת פרסום ההצהרה (`frontend-design`) -- עריכה
- [ ] `components/public/legal-text.tsx` + בדיקה -- עיצוב הטקסט הבטוח -- קישורים ומודגש בלי HTML
- [ ] `app/(public)/{privacy,terms,accessibility}/page.tsx` + תצוגות ב-`components/public/` -- עמודים ציבוריים ומצב הביניים (`frontend-design`)
- [ ] `lib/nav.ts`, הפוטר, ‏`menu-sheet`, התחברות, פרופיל, ‏`/admin/more`, טופס ההצטרפות -- קישורים בלבד
- [ ] `app/admin/(shell)/home-items.ts` + `lib/copy/admin.ts` -- מיפוי `accessibility_unpublished`
- [ ] בדיקות: ‏`supabase/tests/admin-home.test.ts` (הפריט קיים ונעלם אחרי פרסום, הפריטים הקודמים עדיין עוברים), בדיקת `join_complete` אחרי פרסום שני, ויחידה ל-nav, לפוטר, לתצוגות ול-home-items
- [ ] טעינת שני הנוסחים כטיוטה למסד הפיתוח (סקריפט ב-scratchpad, לא ב-repo; ‏`draft_content` עובר את הסכמה) -- סשן ראשי

**Acceptance Criteria:**
- Given אורחת לא מחוברת, when היא פותחת את שלושת העמודים מהפוטר, then הם נטענים בלי התחברות (גם מאחורי נעילת האתר אחרי Basic Auth).
- Given טל פרסמה את ההצהרה, when היא מנסה להסתיר אותה, then אין כפתור הסתרה בעורך ואין דרך לבטל פרסום.
- Given מסך 375px ב-RTL, when פותחים כל עמוד, then אין גלילה אופקית ויעדי המגע 44px.

## Implementation Notes

- המיגרציה נכתבה והוחלה בסשן הראשי. הגרסה במסד היא 20261006110524, ושם הקובץ שונה כך שיתאים לה. ב-CTE עמודת `id` נשארת uuid (`null::uuid`), וה-slug נמצא בתוך ה-jsonb.
- הנוסחים של המשתמשת נטענו כטיוטה למסד הפיתוח בלבד, בסקריפט ב-scratchpad שבודק מול הסכמה: 12 סעיפים במדיניות, וההצהרה עם `intro_sections` ו-`more_sections`. הם לא פורסמו.
- אחרי הבדיקה בטלפון (2026-10-06), בשני סבבים: המדיניות ותנאי השימוש הם שדה טקסט אחד (`legal_text`, ‏`## ` לכותרת), וההצהרה היא שדה טקסט אחד ועוד שם, טלפון ומייל. וואטסאפ בעמודים המשפטיים נפתח בלי הודעה ממולאת (הפס הקבוע לא השתנה, לפי החלטת המשתמשת). שתי מיגרציות שורות (`20261006155737`, ‏`20261006163625`) המירו את מה שכבר פורסם, בלי גרסה חדשה. התמיכה ברשימות בשם בעורך הוסרה, כי אף סוג כבר לא משתמש בה. ההחלטות נרשמו ב-memlog של ה-UX. ב-Code Map ובמשימות עדיין מופיע `legal_sections`, והשינוי הזה גובר עליהם.
- 13 כשלונות של `npm run test:db` המלא, כולם בקבצים שלא נגענו בהם, אחרי מיגרציות מקבילות על המסד המשותף (`session_completion_job`, ‏`notification_centers`). לבדוק שוב אחרי המיזוגים.

## Review Triage Log

סבב 1 (4 עדשות). מצב: high 0, medium 1, low 8, false 2, maybe-false 0.

| # | ממצא | פסק | ניתוב | ראיה / פעולה |
|---|------|-----|-------|---------------|
| 1 | `content.test.ts:118` נכשל אחרי פרסום המדיניות במסד הפיתוח | medium | patch | איפוס `privacy` בתוך ה-rollback |
| 2 | `tel:` בלי ספרות יוצר קישור ריק | low | patch | דרישת ספרה + בדיקה |
| 3 | הדגשה בתוך תווית קישור מוצגת ככוכביות | low | patch | `parseInline` על התווית |
| 4 | וואטסאפ בנוסח הביניים בלי ההודעה הממולאת; טלפון ההצהרה לא מעוצב | low | patch | `guestWhatsappHref`, ‏`formatLocalPhone` |
| 5 | קישור המדיניות בטופס ההצטרפות לא נבדק | low | patch | שתי בדיקות ב-`join-form.test.tsx` |
| 6 | `withListItems` ורשימות בשם לא נבדקים | low | patch | בדיקות טהורות ורינדור עם שגיאה |
| 7 | `getPublishedAt` בלי בדיקה | low | patch | בדיקות עם לקוח מדומה |
| 8 | אין בדיקה שפרסום בלי שינוי משאיר את הפריט | low | patch | בדיקה ב-`admin-home.test.ts` |
| 9 | הגרסה נשמרת בשליחה, לא זו שהוצגה | medium | defer | התנהגות קיימת מ-2.2; ‏deferred-work (6.9) |
| 10 | חסימת הפרסום בעמודי השרת לא נבדקת | low | defer | דורש RSC harness; ‏deferred-work (5.14) |

נדחו: פריט "לטיפול" ופוטר שבודקים רק `published_at` ולא שהתוכן תקין (low, לא סביר: הפרסום עובר בדיקת סכמה). הצטרפות כשהמדיניות לא פורסמה שומרת 0 (הוחלט, נבדק ב-6.9). ‏`since` הישן מוריד את הפריט מ-3 הראשונים בבית (נקבע ב-spec, מוצג ב-`/admin/attention`). אי-התאמה ל-Code Map בהמרת ה-id (תיקון ב-spec). שורות הזריעה בלי בדיקה (low). תאריך "עודכן לאחרונה" בתצוגה המקדימה (low). חסימה מהטופס החי מול טיוטה שמורה (false: פרסום שומר קודם, `content-editor.tsx:74`). דוח ההתאמה לכוונה תיאורי, בלי ממצא.

## Verification

**Commands:**
- `npm run test:db` -- כולל `admin-home.test.ts` ובדיקות ההצטרפות
- `npm test`, ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm run build` -- עוברים

**Manual checks:**
- בטלפון: פוטר, תפריט, התחברות, פרופיל ו"עוד" מקשרים להצהרה; עריכה ופרסום של ההצהרה מעלים "עודכן לאחרונה" ומסירים את הפריט מ"לטיפול".
