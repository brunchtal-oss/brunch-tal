---
title: '5.4 העלאת תמונות ופרסומן'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'aaf2e864475fca0e114e0e95768d8cec84ecefe0'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/demo-scope-2026-10-04.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין באתר אף תמונה. ההירו, אודות, הגלריה, ההמלצות והמפגשים מחכים להעלאה ולפרסום בטוחים (CAP-27, ‏CAP-12, ‏CAP-41; ארבעת הפריטים של 5.4 ב-`deferred-work.md`). בלי מנגנון כזה תמונה מזוהה או טיוטה עלולות להגיע לכתובת ציבורית.

**Approach:** מיגרציה עם שני buckets (‏`media-drafts` פרטי, ‏`media-public` ציבורי), הטבלה `media_assets`, עמודות תמונה ב-`events` וב-`concepts`, ו-RPC לפרסום דו-שלבי לפי AD-21: כוונה (`copying`) ← העתקה בשרת ← סגירה. הסתרה: קודם ה-RPC ואז מחיקת הקובץ הציבורי. ‏`image-upload-field` אחד משמש את עורך התוכן של 5.3 (סוג שדה `image` חדש) ואת טופס המפגש. האתר מציג רק תמונה שמצבה `published`.

**החלטות המשתמשת (2026-10-05):**
- **קונספט:** בהדגמה רק תמונת מפגש. ‏`concepts.default_image_id` נכנס למיגרציה, ו-`photoUrl` נופל אליו כשאין תמונת מפגש. הבורר לקונספט ייבנה עם מסך הקונספטים (פריט ב-deferred).
- **המלצה כצילום מסך:** טל מעלה צילום שכבר ערכה (השם והטלפון הוסתרו בטלפון שלה), בלי סימונים.
- **בלי צ׳קבוקס הסכמה, והטקסט החלופי הוא המלצה ולא תנאי:** טל אחראית להעלות רק מה שמותר לה. אין עמודת הסכמה ואין חסימה. שדה הטקסט החלופי מופיע בכל תמונה, גם בהירו, עם רמז שמומלץ למלא אותו. כשהוא ריק התמונה מתפרסמת ומרונדרת עם `alt=""`. ההחלטה גוברת על EXPERIENCE (צ׳קבוקס, חסימת פרסום, הירו בלי שדה), על AD-16 ("רק עם `alt_text` וסימון הסכמה") ועל בדיקת הקבלה בטיקט. מסמך המקור (§3) דורש "אישור מתאים", והאחריות של טל היא האישור. נרשם ב-memlog של ה-UX.
- **תמונות הפיתוח:** ‏`photos/` (תמונות מעובדות של טל ושל האוכל, כבר ב-repo; אושר על ידי המשתמשת). סקריפט פיתוח מעלה אותן למסד הפיתוח בלבד, דרך אותו מסלול פרסום: ‏`Hero.png` להירו, ‏`about.png` לאודות, והשאר בחלוקה אקראית לגלריה ולמפגשים העתידיים.
- **חיתוך לטלפון = נקודת מוקד:** טל נוגעת בנקודה החשובה בתמונה או מזיזה אותה בכפתורי חצים. נשמרים `focus_x` ו-`focus_y` (0–100), והתמונה מוצגת עם `object-position` בכל יחס. הקובץ לא נחתך.
- **‏`whatsapp-bar` מול כפתור ההירו:** הפריט נסגר כלא רלוונטי, כי מאז 2026-10-05 אין בהירו כפתור.

## Boundaries & Constraints

**Always:**
- **טקסט חלופי:** בכל תמונה יש שדה "טקסט חלופי (מומלץ)". ריק ← `alt=""`. בהמלצה כתמונה הרמז מציע תמלול קצר של ההמלצה.
- **העלאה:** הדפדפן מקטין לצלע ארוכה של 2000px ושומר JPEG באיכות 0.85. כך גם מוסר ה-EXIF (מיקום GPS). ‏`accept="image/jpeg,image/png,image/webp"`, ו-iPhone ממיר HEIC מעצמו. המסלול: ‏`admin_create_media` מחזיר מזהה ← העלאה ל-`media-drafts/<id>` מהדפדפן ← השדה שומר `{media_id, alt?, focus_x, focus_y}` בטיוטה. ‏bucket: ‏5MB ו-jpeg/png/webp בלבד.
- **פרסום (AD-21):** ‏`admin_begin_media_publish` דורש קובץ קיים ב-`media-drafts`, שומר את ה-alt ואת המוקד ועובר ל-`copying`. ‏`copyMediaToPublic` (privileged) מעתיק ל-`media-public/<id>.jpg`, ויעד שכבר קיים נחשב הצלחה. ‏`admin_finish_media_publish` בודק ב-`storage.objects` שהקובץ קיים (אחרת `MEDIA_NOT_COPIED`) ועובר ל-`published`. כל שלב אידמפוטנטי, ו-retry ממשיך מהמצב השמור.
- **פרסום עמוד תוכן:** ה-Action מפרסם קודם כל תמונה נראית בטיוטות הממתינות, ואחר כך קורא ל-`admin_publish_content`. ה-RPC זורק `MEDIA_NOT_COPIED` אם תמונה שמופיעה בטיוטה עדיין ב-`copying`. אחרי הפרסום הוא מסמן `hidden` כל תמונה `published` שכבר לא מופיעה באף תוכן שפורסם ונראה (`private.visible_media_ids`), באף `events.image_id` ובאף `concepts.default_image_id`. התוצאה כוללת `hidden_paths`: כל תמונה `hidden` שהקובץ שלה עוד קיים ב-`media-public`. ה-Action מוחק אותם. כך מחיקה שנכשלה מתבצעת שוב בפרסום הבא.
- **תמונת מפגש:** שדה בטופס (`session-fields.tsx`; יצירה ועריכה). שמירה = פרסום התמונה + `admin_set_event_image(p_event_id, p_media_id)`, שדורש תמונה `published` או `null`. גם היא מחזירה `hidden_paths` כשתמונה קודמת התפנתה. ב-`/new` הטופס שומר את התמונה אחרי יצירת המפגש. ‏`admin_create_event` לא משתנה. ‏`admin_duplicate_event` מעתיק גם את `image_id`.
- **תצוגה:** האתר קורא תמונה רק דרך join ל-`media_assets`, ש-RLS שלה פתוח לקריאה ציבורית רק במצב `published`. ‏`photoUrl` = תמונת המפגש, ואם אין, תמונת הקונספט. ‏next/image עם `remotePatterns` למארח ה-Supabase ול-`media-public`, וטעינה עצלה (חוץ מההירו). תצוגה מקדימה באדמין: ‏signed URL מ-`media-drafts` עם `unoptimized`.
- **מקומות התמונה:** הירו (`image` אופציונלי), ‏about/main (`image` אופציונלי ב-text_block, רק בסקשן הזה), גלריה (סקשן חדש `gallery/photos`, ‏kind ‏`gallery`: כותרת ופריטים `{image, caption?, hidden?}`, מוצג ב-`/gallery` לפני ההמלצות), המלצה (פריט עם `kind: "text" | "image"`; פריט ישן בלי `kind` הוא טקסט).
- **כרטיסי "הבראנצ׳ים הקרובים" בבית:** כרטיס אופקי, והתמונה בצד inline-end. ב-`/sessions` ובראש עמוד המפגש אין שינוי.
- **הסתרה ומטמון:** פרסום עמוד מעדכן את התגים שלו (`publishTags`). הסתרה של תמונה שהתפנתה מתבצעת באותו פרסום. דפי המפגשים דינמיים.
- **הרשאות:** ל-`media_assets` אין הרשאת כתיבה לאף role. כל שינוי עובר RPC של אדמין (definer, ‏`search_path = ''`, ‏`private.is_admin()` בשורה הראשונה, grant ל-`authenticated` בלבד) עם `private.audit`. במדיניות האחסון: אדמין מעלה ל-`media-drafts` רק לשם של שורה במצב `draft`, ואין update או delete. ‏`media-public` בלי policy ל-API (קריאה דרך הכתובת הציבורית, בלי listing). העתקה ומחיקה רק ב-`lib/server/privileged/media.ts`.
- מיקרו-קופי ב-`lib/copy/admin.ts`, וקודי שגיאה חדשים ב-`lib/errors.ts`. בבדיקות האוטומטיות רק PNG סינתטי שנוצר בקוד. במסד הפיתוח רק התמונות של `photos/`. המסכים מתחילים בסקיל `frontend-design`.
- **סקריפט הפיתוח** (`scripts/dev-seed-media.mjs`): רץ רק כשה-ref של `NEXT_PUBLIC_SUPABASE_URL` הוא של פרויקט הפיתוח. הוא מתחבר כאדמין הפיתוח ועובר באותם RPC ובאותה העתקה. הרצה חוזרת לא מכפילה: תמונה שכבר משובצת לא מועלית שוב. לכל תמונה alt בעברית.

**Never:** בורר תמונה לקונספט או מסך קונספטים. כלי טשטוש. חיתוך שמשנה את הקובץ. Supabase Image Transformations (בתשלום). שינוי בעמוד הפרטים `/admin/sessions/[id]` (של 3.4) או בחתימה של `admin_create_event` ו-`admin_update_event`. שכתוב העורך של 5.3. ניקוי טיוטות יתומות ב-`media-drafts` (5.10). פריט "לטיפול" (4.1). עריכה של `components/ui/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| גלריה, שלוש תמונות | שלוש, אחת בלי alt, פרסום | שלוש ב-`/gallery`. זו שבלי alt עם `alt=""` | — |
| העלאה שלא הסתיימה | פריט עם `media_id` שהקובץ שלו לא הועלה | הפריט לא מוצג, השאר מתפרסם | ליד התמונה בעורך: "ההעלאה לא הסתיימה" |
| קובץ לא הועלה | אין אובייקט ב-`media-drafts` | — | ‏`MEDIA_NOT_UPLOADED` |
| העתקה נכשלה | ‏`copying`, אין קובץ ציבורי | ‏finish ← `MEDIA_NOT_COPIED`, הפרסום נעצר | פרסום חוזר מעתיק ומשלים. אין קובץ יתום |
| העתקה הצליחה, finish נפל | יש קובץ, מצב `copying` | ‏retry: ההעתקה רואה שהיעד קיים, ו-finish סוגר | — |
| הסרת תמונה מהגלריה | פריט נמחק או מוסתר, פרסום | ‏`hidden`, הקובץ הציבורי נמחק, הכתובת מחזירה 4xx | מחיקה נכשלה ← נמחקת בפרסום הבא |
| גישה לטיוטה | ‏anon או לקוחה: URL ציבורי או API ל-`media-drafts/<id>` | 400/404, אין קובץ | — |
| העלאה של לקוחה | ‏authenticated לא אדמין מעלה ל-`media-drafts` | — | נחסם ב-policy |
| העלאה לשם זר | אדמין מעלה לשם שאין לו שורה `draft` | — | נחסם ב-policy |
| קובץ לא נתמך | ‏GIF או מעל 5MB | — | בדפדפן "סוג קובץ לא נתמך" או "הקובץ גדול מדי". ה-bucket דוחה גם |
| מפגש עם תמונה | עריכה ← תמונה + alt ← שמירה | הכרטיס ב-`/sessions`, בבית וב-`/me/sessions` ועמוד המפגש מציגים אותה | — |
| מפגש בלי תמונה, לקונספט יש | ‏`image_id` ריק, `default_image_id` מלא | מוצגת תמונת הקונספט | — |
| החלפת תמונת מפגש | תמונה חדשה נשמרת | הישנה `hidden`, הקובץ שלה נמחק (אלא אם מפגש אחר משתמש בה) | — |
| המלצה כתמונה | ‏`kind: "image"` עם alt | מוצגת בגלריה ובבית, וה-alt הוא תמלול ההמלצה | — |
| סקריפט הפיתוח פעמיים | ‏`node scripts/dev-seed-media.mjs` שוב | אין תמונות כפולות | ‏ref אחר מהפיתוח ← יציאה בלי לגעת בכלום |
| נקודת מוקד | ‏`focus_x = 20` | ‏`object-position: 20% …` בכל יחס | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004143612_concepts_and_events.sql` -- ‏`events` (61–79), ‏`concepts` (22–39), ‏RLS 163–179. ‏`admin_duplicate_event` (510, ההעתקה ב-563–567) נכתב מחדש ב-`create or replace` עם `image_id`. אין בה drop.
- `supabase/migrations/20261005111717_pinned_display_and_duplicates.sql` -- הגרסה האחרונה של `admin_create_event` ו-`admin_update_event`. לא נוגעים בהן.
- `supabase/migrations/20261004122702_content_publish.sql` -- ‏`admin_publish_content(p_slug, p_idempotency_key)`. נכתב מחדש ב-`create or replace`, באותה חתימה, עם בדיקת `copying`, הסתרת התמונות שהתפנו ו-`hidden_paths`.
- `supabase/migrations/20261004131740_public_pages.sql` -- דוגמה להכנסת שורת `content_sections`. כאן נוספת `('gallery','photos','gallery',0)`.
- `supabase/tests/support/db.ts` -- ‏`inRollback`, ‏`asAuthenticated`, ‏`asServiceRole`, ‏`insertAuthUser`, ‏`testName`, ‏`onCleanup`, ‏`queryError`. ‏`supabase/tests/grants.test.ts` › ‏`EXPECTED_GRANTS`: שורה לכל grant חדש. לא בודק storage, ולכן ל-policies יש בדיקה נפרדת.
- `lib/server/privileged/service-client.ts` -- ‏`createServiceClient()`. קובץ חדש `media.ts` לידו (`import "server-only"`): ‏`copyMediaToPublic(id)`, ‏`deletePublicMedia(paths)`.
- `lib/content/schema.ts` -- ‏`imageSchema` (`media_id` uuid, ‏`alt` עד 300, ‏`focus_x`/`focus_y` 0–100). שדה `image` אופציונלי ב-hero וב-text_block. ‏`gallerySchema`. פריט המלצה כאיחוד text/image עם תאימות לאחור.
- `lib/content/visible.ts` -- הסינון הטהור של 5.3. כאן נוספים השמטת פריט שהתמונה שלו לא נפתרה ו-`visibleMediaIds(content)`, שמקבילה ל-`private.visible_media_ids`.
- `lib/content/pages.ts` -- ‏`getPublishedSections`. מוסיפים פתרון תמונות (`resolvePublishedImages`, קריאה ל-`media_assets` עם הלקוח הציבורי, באותו cache וב-tag של העמוד) ← `ResolvedImage {src, alt, focusX, focusY}`.
- `app/admin/(shell)/content/section-fields.ts` -- ‏`TextField | ListField`. מוסיפים `ImageField` (‏`type: "image"`) ו-`showWhen` לשדה בפריט (המלצה: ‏`kind`). ‏hero ו-about/main מקבלים `image`. ‏`gallery` חדש. ‏testimonials: ‏`kind` + שדות לפי הסוג.
- `app/admin/(shell)/content/content-editor.tsx` -- מרנדר שדה `image` דרך `ImageUploadField`. השמירה ומפתחות ה-idempotency נשארים.
- `app/admin/(shell)/content/actions.ts` -- ‏`publishContentAction`: פרסום התמונות ואז `admin_publish_content`, מחיקת `hidden_paths` ו-`updateTag`. ‏`createMediaAction`. ‏`content-items.ts` › ‏`EDITABLE_PAGES`: ‏gallery/photos בעמוד "גלריה והמלצות".
- `app/admin/(shell)/content/[slug]/preview/page.tsx`, ‏`components/public/page-views.tsx`, ‏`sections.tsx`, ‏`home-hero.tsx` -- ה-views מקבלים מפת תמונות. התצוגה המקדימה בונה אותה מ-signed URLs של הטיוטה.
- `components/admin/image-upload-field.tsx` (חדש, `"use client"`) -- בחירה, הקטנה ב-canvas, העלאה, תצוגה עם מסגרת מוקד (נגיעה + ארבעה חצים 44×44), שדה alt (מומלץ), ו-`inline-notice` כשההעלאה נכשלה. לפי DESIGN › `image-upload-field`.
- `app/admin/(shell)/sessions/` -- ‏`session-fields.tsx` (שדה תמונה), ‏`session-draft.ts` (`EditorField` + `"image"`), ‏`new/session-create-form.tsx` (תמונה אחרי היצירה), ‏`[id]/edit/session-editor.tsx` (שמירת שדה), ‏`actions.ts` (`setSessionImageAction`), ‏`load-session.ts` (`SESSION_COLUMNS` + התמונה). לא נוגעים ב-`[id]/page.tsx`.
- `lib/sessions/public.ts` (`PUBLIC_SESSION_COLUMNS`, ‏`toPublicSession`), ‏`app/me/sessions/load-sessions.ts`, ‏`app/me/page.tsx:113` -- join לתמונת המפגש ולתמונת הקונספט ← `photoUrl` ו-`photoAlt` (פונקציה משותפת `lib/media/photo.ts`).
- `components/public/upcoming-sessions.tsx`, ‏`components/shared/session-card.tsx` -- וריאנט אופקי לבית (תמונה ב-inline-end, ריבוע). ‏`session-photo.tsx` מקבל `focusX`/`focusY`.
- `next.config.mjs` -- ‏`images.remotePatterns` מתוך `NEXT_PUBLIC_SUPABASE_URL`, נתיב `/storage/v1/object/public/media-public/**`.
- `eslint.config.mjs:56-63` -- ‏`storage.from(...)` לא נחסם. לא משנים.

## Tasks & Acceptance

**Execution:**
- [x] הסקיל `frontend-design` לפני המסכים (DESIGN › `image-upload-field`, ‏`session-card`; EXPERIENCE › Flow 7).
- [x] `supabase/migrations/<ts>_media_upload_and_publish.sql` -- buckets (`insert into storage.buckets` עם `public`, ‏`file_size_limit`, ‏`allowed_mime_types`), policies על `storage.objects`, ‏`media_assets` (id, ‏storage_path, ‏public_path, ‏alt_text, ‏focus_x, ‏focus_y, ‏publish_state עם check, ‏publish_started_at, ‏published_at, ‏created_by, ‏created_at, ‏updated_at), ‏RLS ו-grants מפורשים, ‏`events.image_id` ו-`concepts.default_image_id` (FK, ‏`on delete set null`, אינדקס), ‏`private.visible_media_ids(jsonb)`, ‏`admin_create_media`, ‏`admin_begin_media_publish`, ‏`admin_finish_media_publish`, ‏`admin_set_event_image`, ‏`admin_publish_content` ו-`admin_duplicate_event` מחדש, ושורת `gallery/photos`. הקובץ נוצר רק רגע לפני ההחלה (3.4 רץ במקביל). אחר כך `get_advisors`, ‏`database.types.ts` מחדש ו-`grants.test.ts`.
- [x] `supabase/tests/media.test.ts` -- כל שורת RPC במטריצה, ‏policies של storage (anon, לקוחה, שם זר), ‏`visible_media_ids` (פריט מוסתר, סקשן מוסתר), ‏`hidden_paths` ו-retry. קבצים סינתטיים בלבד, עם `onCleanup` שמוחק אותם.
- [x] `lib/server/privileged/media.ts` + בדיקה -- העתקה אידמפוטנטית ומחיקה.
- [x] `lib/content/schema.ts`, ‏`visible.ts`, ‏`pages.ts`, ‏`lib/media/photo.ts` + בדיקות -- סכמות, תאימות להמלצה ישנה, השמטה ופתרון.
- [x] `components/admin/image-upload-field.tsx` ו-`section-fields.ts`, ‏`content-editor.tsx`, ‏`actions.ts`, ‏`content-items.ts`, התצוגה המקדימה + בדיקות (`section-fields.test.ts`, ‏`actions.test.ts`, ‏`content-screens.test.tsx`).
- [x] views ציבוריים: ‏hero, ‏about, ‏`/gallery` (גלריה + המלצות תמונה), כרטיס אופקי בבית, ‏`photoUrl` בכל קוראי המפגשים.
- [x] טופס המפגש: שדה תמונה ביצירה ובעריכה, ‏`setSessionImageAction` + בדיקה.
- [x] `next.config.mjs`, ‏`lib/copy/admin.ts`, ‏`lib/errors.ts`.
- [x] `scripts/dev-seed-media.mjs` + `package.json` (`dev:seed-media`) -- התמונות של `photos/` למסד הפיתוח, לפי ההחלטה. ‏alt בעברית לכל תמונה.
- [x] memlog של ה-UX -- ההחלטה על הצ׳קבוקס ועל הטקסט החלופי (2026-10-05). ‏`tickets.toml` › ‏5.4 ‏`verify`: בלי סימון הסכמה ובלי חובת alt.
- [ ] `deferred-work.md` -- סגירת ארבעת הפריטים של 5.4 (whatsapp-bar: "לא רלוונטי, החלטת המשתמשת 2026-10-05"). חדשים: ‏`copying` תקוע ב"לטיפול" (יעד 4.1), בורר תמונה לקונספט (יעד מסך הקונספטים), ניקוי טיוטות יתומות (יעד 5.10). ‏`tickets.toml`: ‏5.4 done.

**Acceptance Criteria:**
- Given קובץ ב-`media-drafts`, when פונים אליו בכתובת ציבורית או כ-anon, then אין גישה.
- Given תמונה שפורסמה והוסרה, when מפרסמים, then השורה `hidden` לפני שהקובץ נמחק, והקובץ לא נגיש.
- Given טלפון ברוחב 360px, when טל מעלה, מזיזה מוקד, ממלאת alt, מסמנת ומפרסמת בגלריה ובמפגש, then הכול נכנס בלי גלילה אופקית, יעדי המגע 44px לפחות, והתמונה מופיעה באתר בגודל מותאם ובטעינה עצלה.
- Given ה-security advisor אחרי המיגרציה, then אין WARN או ERROR חדשים מלבד המאושרים ב-AGENTS.md.

## Implementation Notes

- התיקונים של סבב הביקורת ב-SQL נכנסו למיגרציה נפרדת (`create or replace`), כי `20261005193920` כבר הוחלה על מסד הפיתוח.
- ‏`grants.test.ts` נכשל במסד הפיתוח המשותף רק על ההרשאות של 3.4 ו-4.12, שהוחלו במקביל. את הרשימות ממזגים במיזוג של origin/main.

- **אחרי הבדיקה בטלפון (2026-10-06, החלטת המשתמשת, memlog של ה-UX):** חצי המוקד הוסרו, ונקודת המוקד נקבעת רק בנגיעה. ב-gallery ובהמלצה כתמונה אין "הסרת התמונה" בתוך הפריט (`removable={false}`), כי מחיקת הפריט כבר מסירה אותה. בהירו, באודות ובמפגש הכפתור נשאר. ברשימות הגלריה וההמלצות כפתור ההוספה מופיע גם מעל הרשימה (`addAtTop`), והפריט החדש נוסף אחרון.

## Spec Change Log

## Review Triage Log

**סבב 1 (2026-10-05):** ארבע עדשות (blind, ‏edge-case, ‏verification-gap, ‏intent). 34 ממצאים. ‏medium 9, ‏low 8, ‏false 4, השאר כפילויות שאוחדו. ‏patch 8 קבוצות, ‏reject השאר.

| # | ממצא | verdict | route | ראיה / פעולה |
|---|------|---------|-------|--------------|
| 1 | ‏`admin_publish_content` חוסם רק `copying`, ותמונה שהוסתרה במרוץ מתפרסמת ולא מוצגת לעולם (blind 1, ‏edge 1, 7) | medium | patch | הבדיקה כוללת `hidden`. ה-retry מפרסם אותה מחדש |
| 2 | ‏`deletePublicMedia` מוחק נתיבים ישנים (גם מ-replay של idempotency) של תמונה שחזרה ל-`published` (blind 2, ‏edge 2) | medium | patch | סינון לפי המצב הנוכחי `hidden` לפני המחיקה |
| 3 | שורה `copying` שלא בשימוש, עם קובץ ציבורי, לא מוסתרת לעולם: קובץ יתום (blind 3) | medium | patch | ‏`hide_unused_media` מסתיר גם `copying` שלא בשימוש |
| 4 | ‏`/new`: כשל בתמונה אחרי היצירה משאיר טופס פתוח, ושמירה חוזרת נותנת `IDEMPOTENCY_KEY_REUSED` (blind 6, ‏edge 4) | medium | patch | מעבר לעמוד העריכה של המפגש עם הודעה |
| 5 | העלאה חוזרת אחרי תשובה שאבדה נכשלת על "already exists" (edge 3, ‏gap-other 1) | low | patch | "already exists" נחשב הצלחה |
| 6 | תמונה מוסתרת ממשיכה להיות מוגשת מ-`/_next/image` עד 4 שעות (blind 4, ‏edge 8) | medium | patch | ‏`minimumCacheTTL: 60`. החלון כ-10 דקות, נרשם ב-deferred |
| 7 | בלוגים של המדיה אין מזהה תמונה ואין הודעת שגיאה (blind 8) | low | patch | מזהה, נתיב והודעה בלוג |
| 8 | חסרות בדיקות: ‏`publishMedia`, ‏`getPublishedPage` עם תמונות, ענף הקונספט והעמודה `hidden` ב-`used_media_ids`, קריאה של לקוחה, ‏`toCustomerSession`, ‏`imageChanged`, ומעברי המצב המסוכנים (gap 1–6, ‏blind 11, ‏intent 4–5) | medium | patch | הבדיקות נוספו |

נדחו: alt ומוקד משותפים למפגש ולשכפול שלו (edge 5, ‏gap-other 2; נדיר, והתיקון דורש alt לכל שימוש), alt ומוקד מטיוטה שעולים לאתר כשהפרסום נכשל באמצע (edge 6, ‏blind 5; נדיר ולא מזיק), תמונות של מפגשים שהסתיימו או בטיוטה (blind 7; החלטה ב-spec), ההגנה של סקריפט הפיתוח (blind 9; אותה הגנה כמו `test:db`, ול-production אין `DEV_DATABASE_URL`), פריט שההעלאה שלו לא הסתיימה מדולג בשקט (blind 10; תואם למטריצה), הסקריפט מעלה PNG בלי הקטנה (intent 3; תמונות AI בלי EXIF), ‏intent 7 (false: המסמכים הוצאו מה-diff של הביקורת), ‏intent 9 (false: בכרטיס `alt=""` לפי EXPERIENCE), ‏intent 2 (false: חשיפה בשמירה היא החלטה ב-spec).

## Design Notes

**מצבים:** ‏`draft → copying → published → hidden`, ו-`hidden → copying` כשתמונה חוזרת לתוכן. ‏begin מותר מכל מצב. finish מ-`copying`, או מ-`published` שמחזיר את התוצאה הקיימת.

**idempotency (AD-5):** רק `admin_create_media` מקבל מפתח. ‏begin, ‏finish ו-`admin_set_event_image` קובעים ערך מוחלט או מעבר מצב שחוזר על עצמו בלי נזק, ולכן הם פטורים כמו `set_*`.

**הפניות נראות (SQL וגם TS, אותה הגדרה):** סקשן עם `hidden: true` ← אין. אחרת `$.image.media_id` ו-`$.items[*] ? (@.hidden != true).image.media_id`.

**פרסום עמוד (Action):**
```
for img in visibleImages(pendingDrafts):
  begin(img) → copyMediaToPublic(id) → finish(id)   // נכשל ← עוצרים, ‏ActionResult עם הקוד
r = admin_publish_content(slug, key)              // ‏MEDIA_NOT_COPIED אם נשאר copying
deletePublicMedia(r.hidden_paths); updateTag(...)
```

## Verification

**Commands:**
- `npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm test` -- expected: הכול עובר, כולל `test/invisible-chars.test.ts`.
- `npm run test:db` -- expected: ‏`media.test.ts`, ‏`grants.test.ts` ובדיקות התוכן והמפגשים עוברים.
- `npm run build` -- expected: עובר.

**Manual checks:**
- בטלפון של המשתמשת: העלאה, נקודת מוקד, פרסום והסתרה בגלריה, בהמלצה כתמונה ובמפגש. אחרי ההסתרה הכתובת הציבורית של הקובץ לא נפתחת.
