<!-- bmad:context -->
<!-- Verified 2026-10-04 against 70c203e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## בראנץ׳ אצל טל

אתר שיווקי, אזור אישי ופאנל ניהול לעסק שמארח בראנצ׳ים לנשים בחופשת לידה, על מסד נתונים אחד. Next.js + TypeScript, Supabase (Postgres, Auth, Storage), Vercel, Web Push. האתר בעברית, RTL, מותאם קודם לטלפון. מקור האמת: `brunch_at_tal_charecter.md`. SPEC: `_bmad-output/specs/spec-brunch-at-tal/`. UX: `_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/` (DESIGN.md, EXPERIENCE.md, mockups/).

## מדיניות

- **לענות תמיד בעברית פשוטה וברורה, לכל אורך השיחה, כולל בזמן הרצת סקילים של BMAD:** גם שורות סטטוס קצרות בין קריאות לכלים, נקודות עצירה של סקיל שכתוב באנגלית, והודעות אחרי דוח של סוכן משנה באנגלית. במצבים האלה זה נשבר כמה פעמים, והמשתמשת ביקשה לא לחזור על זה.
- מסמכי תכנון (SPEC, UX, סיפורים בעץ) נכתבים בעברית. קוד, שמות משתנים, טבלאות ו-commits נכתבים באנגלית.
- ה-spec של סיפור (`spec-X-Y-*.md`, כולל ה-Review Triage Log) נכתב באנגלית, כדי לחסוך טוקנים (החלטת המשתמשת 2026-10-10). מיקרו-קופי שמוצג במסך מצוטט בו בעברית מילה במילה, והמונחים לפי השמות בקוד (credit, entitlement, card, pinned). השיחה עם המשתמשת נשארת בעברית, כולל סיכום בעברית של ה-spec בנקודת האישור ודיווח הביקורת.
- בניית מסך או רכיב UI (חדש או שינוי) מתחילה בהפעלת הסקיל `frontend-design`, בתוך מגבלות DESIGN.md ו-EXPERIENCE.md (החלטת המשתמשת 2026-10-02). גם סוכן משנה שבונה מסכים מפעיל אותו (כלי Skill). ב-spec של סיפור עם מסכים כותבים זאת במשימות.
- **`brunch_at_tal_charecter.md` גובר על ה-SPEC ועל כל מסמך נגזר בכל סתירה.** החריגים היחידים הם החלטות שהתקבלו במפורש עם המשתמשת ונרשמו ב-`.memlog.md` של ה-SPEC או של ה-UX.
- ה-SPEC נגזר ממסמך המקור ונמצאו בו סטיות. לפני כל עבודה לבדוק את הסעיף הרלוונטי במסמך המקור עצמו.
- לא לערוך את `brunch_at_tal_charecter.md`. טעות או חוסר שנמצאו בו מציגים למשתמשת.
- לא לעשות git push בלי בקשה מפורשת, כי push ל-main מפעיל פריסה לפרודקשן ב-Vercel.
- לפני כל פעולה של ניהול קוד (commit, push, יצירת branch, PR, merge, rebase, revert): להסביר למשתמשת בעברית פשוטה מה הפעולה עושה ולמה זו ההמלצה, ולחכות לאישור שלה. זה חל גם כשסקיל (למשל bmad-build) מבצע commit אוטומטי. במקרה כזה עוצרים לפני הביצוע ומסבירים.
- הנעילה (Basic Auth, ‏`proxy.ts`, ‏`lib/site-lock.ts`, ‏AD-22) הוסרה בפרודקשן ב-2026-10-10 (`SITE_LOCKED=false`, עם `noindex`; החלטת המשתמשת). הכתובת: https://brunch-at-tals.vercel.app. ‏preview עדיין נעול. נתיב חדש שצריך להיות פטור (מכונה-למכונה) נכנס רק לרשימה `SITE_LOCK_EXEMPT_PREFIXES` ומאמת סוד או חתימה משלו.
- **אחרי כל מיזוג ל-main** (החלטת המשתמשת 2026-10-10), כשהפריסה ב-Vercel מסתיימת, הסשן שמיזג בודק את הפרודקשן ומדווח למשתמשת: (1) בלי התחברות: הבית, `/sessions` ועמוד מפגש מחזירים 200 עם `X-Robots-Tag: noindex`, ו-`/me` ו-`/admin` מפנים להתחברות; (2) כלקוחה בדויה: הבית של האזור האישי ו"ההרשמות שלי"; (3) כאדמין: בית האדמין, רשימת המפגשים ועמוד מפגש; (4) המסכים שהסיפור שינה. פרטי הכניסה (חשבונות בדויים בלבד, אותם פרטים שבמסמך ההגשה) מקבלים מהמשתמשת. כשאין כלי דפדפן לשלבים 2–4, מבקשים מהמשתמשת לבדוק בטלפון. משהו שבור: מיד Instant Rollback ב-Vercel (המשתמשת), ותיקון ב-PR קצר.
- פרויקט ה-Supabase המחובר (`.env.local` ו-MCP) הוא סביבת פיתוח: רק נתונים בדויים, אף פעם לא נתוני לקוחות אמיתיים. פרודקשן יהיה פרויקט נפרד.
- סדר העבודה מאז ההדגמה (סבבים, מסלולים, התנגשויות והחלטות היקף) נמצא ב-`_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md`. החלטה שמשנה היקף או סדר (סיפור נכנס, יוצא, מפוצל או מצומצם) נרשמת בו באותו סשן, עם תאריך ו"החלטת המשתמשת". אם היא משנה סיפור או תלות, מעדכנים גם את `tickets.toml` של האפיק. ‏`demo-scope-2026-10-04.md` נשאר כהיסטוריה של ההדגמה.
- ה-repo ציבורי עד ההשקה (מגבלה של התוכנית החינמית ב-Vercel). לכן אסור להכניס אליו נתוני לקוחות אמיתיים, תמונות אמיתיות של נשים או תינוקות, או סודות. תוכן כזה נשמר רק ב-Supabase.
- `SUPABASE_SECRET_KEY` וכל סוד אחר נשארים בשרת בלבד. אסור לשים אותם בקוד שרץ בדפדפן או במשתנה `NEXT_PUBLIC_*`.
- לא ליצור משאבים בתשלום ולא לפרסם אתר חי עם נתוני דוגמה בלי החלטה מפורשת של המשתמשת.
- סוכן משנה לא מבצע git push, יצירת PR, merge, מחיקת קבצים (`git rm`, ‏`rm`) או כתיבה ל-`.env*`. הוא מסיים את שאר העבודה ומדווח מה נשאר. הסשן הראשי מבצע אחרי הסבר ואישור של המשתמשת. ב-spec מסמנים משימה כזו "סשן ראשי". מערכת ההגנה חוסמת את הפעולות האלה אצל סוכן גם אחרי שהמשתמשת אישרה בשיחה.
- ב-Review Triage Log של spec כותבים שורה מלאה רק לממצא שמנותב ל-patch או ל-defer. כל ה-reject מסוכמים בשורה אחת אחרי הטבלה: מספרים וסיבה במילים ספורות. כך ה-spec נשאר קרוב ליעד של bmad-build.
- spec ארוך מהיעד של bmad-build: לפני שמדווחים למשתמשת על האורך, מהדקים לפי כל הכללים: מקצרים משפטים, מוחקים כפילויות בין סעיפים וניסוח עודף, מסכמים את ה-reject בשורה אחת, ולא רושמים ממצא שכבר ב-`review-accepted.md`. אסור להסיר או לצמצם החלטה, כלל, מקרה במטריצה, דוגמה, קובץ ב-Code Map או משימה. אם אחרי ההידוק הוא עדיין ארוך, מדווחים על האורך ולא מקצצים תוכן.
- לפני ביקורת קוד מעבירים למבקרים את `_bmad-output/implementation-artifacts/review-accepted.md`, רשימת ממצאים שכבר הוחלטו ולא מסמנים שוב. ממצא שנדחה בפעם השנייה מאותה סיבה נוסף אליה.

## איפה דברים נמצאים

- החלטות הארכיטקטורה המחייבות (נתיבים, חוזה RPC והרשאות, סדר נעילה, תזמון ופוש, יצירת חשבון, זמן וכסף): `_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md`. לקרוא לפני כל עבודת בנייה. בשאלה טכנית הוא גובר על `data-model.md` ועל כל קובץ נלווה אחר של ה-SPEC.
- לפני כתיבת מיגרציה, policy או RPC לקרוא את `security-and-rpc-rules.md`, את `data-model.md` שב-SPEC ואת החלטות AD-3, AD-5, AD-6 ו-AD-14 בארכיטקטורה.
- ערכים עסקיים שנערכים באדמין (ולכן לא נכתבים בקוד): `admin-configurable-parameters.md`. תוצאות ביטול: `cancellation-rules.md`.
- לקוחות Supabase: `lib/supabase/client.ts` לדפדפן, `lib/supabase/server.ts` לשרת (מכבד RLS), `lib/supabase/public.ts` לתוכן ציבורי במטמון (בלי cookies), ו-`lib/supabase/proxy.ts` לרענון session (נקרא מ-`proxy.ts` שבשורש). לקוח ה-service role רק ב-`lib/server/privileged/service-client.ts` (AD-4).
- סליקה עתידית: ההכנה וההחלטות ב-`_bmad-output/specs/spec-brunch-at-tal/online-payments.md`. בגרסה הראשונה אין סליקה, וכל תשלום נוצר רק דרך ליבת האישור (AD-10).
- מה כבר נבנה ומה הבא בתור: `_bmad-output/implementation-artifacts/` (מעקב הסיפורים ו-spec לכל סיפור). README.md: הרצה מקומית, הנעילה ו-checklist ההגדרות לכל סביבה.

## הרצה ובדיקה

- כל שינוי בסכמה מתחיל בקובץ חדש: `npx supabase migration new <name>` (ה-CLI לא מותקן גלובלית, לכן `npx`). אחרי שכותבים את ה-SQL בקובץ, מחילים אותו על המסד עם `apply_migration` של ה-MCP, עם אותו תוכן. לא משנים סכמה ב-`execute_sql`.
- מיגרציה עם `drop` לא מוחלת דרך ה-MCP: ‏`apply_migration` נדחה אוטומטית, כי בקשת האישור של Supabase לא מוצגת ב-VS Code. המשתמשת מריצה אותה ב-SQL Editor (שאילתה חדשה וריקה), והסשן הראשי רושם אותה ב-`supabase_migrations.schema_migrations` (גרסה ושם).
- אחרי כל מיגרציה להריץ את ה-security advisor של Supabase (`get_advisors` ב-MCP). הוא מזהה טבלה בלי RLS ופונקציה בלי search_path. ‏WARN ‏`0029` על RPC מסוג definer עם grant ל-`authenticated` מאושר (AD-5). גם WARN ‏`auth_leaked_password_protection` מאושר בפרויקט הפיתוח (החלטת המשתמשת 2026-10-01; ההחלטה ל-production ב-`deferred-work.md`, יעד 6.9). כל WARN או ERROR אחר חוסם.
- אחרי כל מיגרציה יוצרים מחדש את `lib/supabase/database.types.ts` עם `generate_typescript_types` של ה-MCP. `callRpc` מוקלד ממנו, ולכן פרמטר ששמו השתנה שובר את הבנייה.
- `npm test` מריץ את הבדיקות הטהורות (פרויקט `unit` ב-Vitest: כל `*.test.ts(x)` חוץ מ-`supabase/tests/`), בלי מסד ובלי `.env`. בדיקות של RPC ו-RLS נכתבות ב-`supabase/tests/**/*.test.ts` ורצות ב-`npm run test:db` (פרויקט `db`, קובץ אחרי קובץ) מול פרויקט ה-Supabase של הפיתוח, לא מול mock. הן מתחברות ב-`pg` דרך `DEV_DATABASE_URL` שב-`.env.local` (Session pooler, פורט 5432, חייב להכיל את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`). משתמשים בעזרים של `supabase/tests/support/db.ts`: ‏`inRollback` לכל שינוי, ‏`asAuthenticated` בתוכו, ‏`testName` לכל נתון בדוי ו-`onCleanup` למחיקה.
- עזרי הזמן והטלפון (AD-8, ‏AD-9) ב-`private`: ‏`local_day_end`, ‏`registration_closes_at`, ‏`cancel_deadline`, ‏`local_week_start`, ‏`prep_day`, ‏`normalize_phone`. טהורים (בלי `now()`), והקורא משווה מול `now()`. אין להם grant, הם נקראים מפונקציות definer. תצוגה בלבד ב-`lib/time.ts` ו-`lib/money.ts`.
- ‏CI (`.github/workflows/ci.yml`) רץ על כל push ו-PR: ‏`npm ci`, `npx next typegen` (`next-env.d.ts` לא ב-git), ‏lint, ‏`npm run format:check`, ‏typecheck, ‏`npm test` ו-`npm audit --omit=dev --audit-level=high`, בלי סודות ובלי מסד. לכן `npm test` לא ניגש לרשת או למסד.
- להריץ `npm run build` לפני סיום עבודה: ה-CI לא מריץ build, ו-push ל-main פורס לפרודקשן.
- הרצה של בדיקה אחת: `npx vitest run --project unit path/to/file.test.ts`, או `npx vitest run --project unit -t "<שם הבדיקה>"`. בלי `--project` Vitest מריץ את שני הפרויקטים, ו-`-t` מריץ גם את בדיקות המסד (שדורשות `.env.local` ורשת). לבדיקת מסד אחת: `--project db`.
- `npm run dev:reset-link` מדפיס קישור איפוס ללקוחה בדויה, למחשב ולטלפון ברשת הביתית. עם דגלים מריצים `node scripts/dev-reset-link.mjs --admin` או `--url <כתובת פריסה>`, כי PowerShell מוחק את `--` של `npm run`.
- ‏`npm run lint` אוכף את כיוון התלות (`eslint.config.mjs`, נבדק ב-`test/eslint-rules.test.ts`): קובץ `"use client"` לא מייבא `lib/server/**`; ‏`lib/server/privileged` מיובא רק מתוכו, מ-`app/**/actions.ts`, מ-`app/api/**` ומ-`page.tsx` של נתיבי הטוקן; ‏`.from(...).insert/update/delete/upsert` מותר רק ל-`profiles` ול-`babies` (קובצי בדיקה פטורים); אין `parseFloat` ב-`lib/money.ts`; אין גישה ל-`.rpc` (קריאה, `bind`, `["rpc"]` או פירוק) מחוץ ל-`lib/rpc.ts`, וכל RPC עובר ב-`callRpc` (קובצי בדיקה ו-`scripts/*.mjs` פטורים). כלל `no-restricted-syntax` חדש מוסיפים לקבוצות שבקובץ, כי ב-flat config רשומה מאוחרת מחליפה את כל הרשימה.

## מוסכמות שונות מברירת המחדל

- כסף נשמר כ-integer באגורות (`*_agorot`), ILS, ומוצג ב-₪. אסור לחשב סכומים בנקודה צפה.
- זמנים נשמרים כ-`timestamptz`, ושעון השרת קובע, לא שעון הדפדפן. חישובי לוח שנה (סגירת הרשמה, תוקף עד סוף היום, גבול 48 השעות) נעשים לפי `Asia/Jerusalem`, כולל שעון קיץ.
- RLS פעיל בכל טבלה ב-`public`. ב-policy של לקוחה כותבים `customer_id = (select private.current_customer_id())`, בהתראות `recipient_id = (select auth.uid())`, ובאדמין `(select private.is_admin())`. אף פעם לא `auth.uid()` בלי `select`. שמים אינדקס על העמודה.
- שינוי בכסף, בזכויות או בהרשמות (הרשימה המלאה ב-`security-and-rpc-rules.md`) עובר רק דרך RPC או פונקציית שרת. הדפדפן לא כותב ל-`bookings`, `payments` או `entitlement_movements`. את `customer_id` גוזרים רק מ-`private.current_customer_id()` (ריק ללקוחה שלא הופעלה או שפרטיה הוסרו), אף פעם לא מהקלט.
- פונקציית `security definer`: `set search_path = ''`, בדיקת הקוראת והרשאת האדמין בשורה הראשונה, ו-`revoke execute ... from public, anon, authenticated, service_role` ואחריו `grant execute` אחד בדיוק (ל-`authenticated` או ל-`service_role`). הרשאות לטבלאות תמיד מפורשות, גם ל-`service_role`, ולא נשענות על ברירות המחדל של Supabase (AD-5).
- בדיקה, שריון, גריעה, ספירת מקומות, רישום ב-`audit_log` (before/after) והתראה מתבצעים בעסקה אחת. נועלים תמיד באותו סדר: קודם המפגש ואז הזכות. בהזזה נועלים את שני המפגשים לפי סדר המזהים.
- כל RPC שמשנה נתונים מקבל מפתח idempotency (הפטורים ב-AD-5). קריאה חוזרת עם אותו מפתח מחזירה את התוצאה הקודמת.
- יצירת חשבון ב-Auth Admin API ושיוך הרכישה במסד הם לא עסקה אחת. צריך מצבי ביניים וניסיון חוזר, בלי לאבד תשלום ובלי לצרוך קישור שלא שויך.
- פוש לא נשלח מתוך עסקת הרשמה. הוא נכנס לתור (`notification_jobs`), וכשל פוש לא מבטל את ההרשמה.
- ערכים עסקיים וטקסט שיווקי לא נכתבים בקוד. הם מגיעים מטבלאות ההגדרות והתוכן. רק מיקרו-קופי של המערכת (כפתורים, שגיאות) נשאר בקוד.
- RTL: `<html lang="he" dir="rtl">`. משתמשים רק בכיווני Tailwind לוגיים (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`). `npm run lint` חוסם את `ml-`/`mr-`/`left-`/`right-`/`text-left` בכל מקום חוץ מ-`components/ui/`.
- כתיבה מהמסך: Server Action ב-`actions.ts` שליד הדף בודק רק צורה ← `callRpc` ← RPC שבודק הרשאה וערכים מחדש. ה-Action מחזיר `ActionResult` (`{ ok: true, data }` או `{ ok: false, code }`). מפתח ה-idempotency נוצר במסך (`lib/idempotency.ts`), אחד לכל טעינת טופס או שינוי. דף באזור האישי או באדמין מוגן ב-`lib/auth/require-role.ts`.
- שגיאה עסקית: ה-RPC זורק `raise exception '<CODE>' using errcode = 'P0001'`, וההודעה בעברית לקוד חדש נכתבת רק ב-`lib/errors.ts`. שאר המיקרו-קופי ב-`lib/copy/*` לפי אזור. פעולה רגישה באדמין (חלון אישור) נרשמת ב-`lib/admin/sensitive-actions.ts`.
- סוג בלוק תוכן חדש מקבל סכמת zod ב-`lib/content/schema.ts`. העורך בודק מולה לפני שמירה ופרסום, והאתר מדלג על בלוק שלא תואם.
- לא עורכים את `components/ui/` (קוד shadcn). רכיב שצריך שינוי עוטפים מחוץ לתיקייה. היא מוחרגת מ-Prettier ומכלל ה-RTL.

## מלכודות ידועות

- עברית שמועברת כארגומנט דרך PowerShell או Bash משתבשת (כך קרה ב-memlog של ה-SPEC). קבצים עם עברית כותבים בכלי Write או Edit, לא ב-echo ולא בארגומנט shell.
- תווים בלתי נראים (U+200B–U+200F, ‏U+202A–U+202E, ‏U+2060–U+2069, ‏U+FEFF) נכנסו לקבצים שלוש פעמים ב-E1: כלי הכתיבה הופך `\uXXXX` לתו עצמו, וטקסט שמועתק מעברית מביא תווי כיווניות. `test/invisible-chars.test.ts` (בתוך `npm test` וה-CI) נכשל עליהם. בקוד אסור אף אחד מהם; ב-md מותר רק U+200F. ב-regex או במחרוזת כותבים escape (`\u200E`), ואחרי כתיבה בודקים שהקובץ עדיין עובר.

<!-- /bmad:context -->
