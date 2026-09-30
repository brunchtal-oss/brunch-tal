<!-- bmad:context -->
<!-- Verified 2026-09-29 against 548869d. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## בראנץ׳ אצל טל

אתר שיווקי, אזור אישי ופאנל ניהול לעסק שמארח בראנצ׳ים לנשים בחופשת לידה, על מסד נתונים אחד. Next.js + TypeScript, Supabase (Postgres, Auth, Storage), Vercel, Web Push. האתר בעברית, RTL, מותאם קודם לטלפון. מקור האמת: `brunch_at_tal_charecter.md`. SPEC: `_bmad-output/specs/spec-brunch-at-tal/`. UX: `_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/` (DESIGN.md, EXPERIENCE.md, mockups/).

## מדיניות

- לענות תמיד בעברית פשוטה וברורה, לכל אורך השיחה, כולל בזמן הרצת סקילים של BMAD.
- מסמכי תכנון (SPEC, UX, סיפורים) נכתבים בעברית. קוד, שמות משתנים, טבלאות ו-commits נכתבים באנגלית.
- **`brunch_at_tal_charecter.md` גובר על ה-SPEC ועל כל מסמך נגזר בכל סתירה.** החריגים היחידים הם החלטות שהתקבלו במפורש עם המשתמשת ונרשמו ב-`.memlog.md` של ה-SPEC או של ה-UX.
- ה-SPEC נגזר ממסמך המקור ונמצאו בו סטיות. לפני כל עבודה לבדוק את הסעיף הרלוונטי במסמך המקור עצמו.
- לא לערוך את `brunch_at_tal_charecter.md`. טעות או חוסר שנמצאו בו מציגים למשתמשת.
- לא לעשות git push בלי בקשה מפורשת, כי push ל-main מפעיל פריסה לפרודקשן ב-Vercel.
- לפני כל פעולה של ניהול קוד (commit, push, יצירת branch, PR, merge, rebase, revert): להסביר למשתמשת בעברית פשוטה מה הפעולה עושה ולמה זו ההמלצה, ולחכות לאישור שלה. זה חל גם כשסקיל (למשל bmad-build) מבצע commit אוטומטי. במקרה כזה עוצרים לפני הביצוע ומסבירים.
- האתר נעול ב-Basic Auth עד ההשקה (`proxy.ts`, ‏`lib/site-lock.ts`, ‏AD-22). ב-Vercel הוא נעול אלא אם `SITE_LOCKED=false`. נתיב חדש שצריך להיות פטור (מכונה-למכונה) נכנס רק לרשימה `SITE_LOCK_EXEMPT_PREFIXES` ומאמת סוד או חתימה משלו.
- פרויקט ה-Supabase המחובר (`.env.local` ו-MCP) הוא סביבת פיתוח: רק נתונים בדויים, אף פעם לא נתוני לקוחות אמיתיים. פרודקשן יהיה פרויקט נפרד.
- ה-repo ציבורי עד ההשקה (מגבלה של התוכנית החינמית ב-Vercel). לכן אסור להכניס אליו נתוני לקוחות אמיתיים, תמונות אמיתיות של נשים או תינוקות, או סודות. תוכן כזה נשמר רק ב-Supabase.
- `SUPABASE_SECRET_KEY` וכל סוד אחר נשארים בשרת בלבד. אסור לשים אותם בקוד שרץ בדפדפן או במשתנה `NEXT_PUBLIC_*`.
- לא ליצור משאבים בתשלום ולא לפרסם אתר חי עם נתוני דוגמה בלי החלטה מפורשת של המשתמשת.

## איפה דברים נמצאים

- החלטות הארכיטקטורה המחייבות (נתיבים, חוזה RPC והרשאות, סדר נעילה, תזמון ופוש, יצירת חשבון, זמן וכסף): `_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md`. לקרוא לפני כל עבודת בנייה. בשאלה טכנית הוא גובר על `data-model.md` ועל כל קובץ נלווה אחר של ה-SPEC.
- לפני כתיבת מיגרציה, policy או RPC לקרוא את `security-and-rpc-rules.md`, את `data-model.md` שב-SPEC ואת החלטות AD-3, AD-5, AD-6 ו-AD-14 בארכיטקטורה.
- ערכים עסקיים שנערכים באדמין (ולכן לא נכתבים בקוד): `admin-configurable-parameters.md`. תוצאות ביטול: `cancellation-rules.md`.
- לקוחות Supabase: `lib/supabase/client.ts` לדפדפן, `lib/supabase/server.ts` לשרת (מכבד RLS), `lib/supabase/public.ts` לתוכן ציבורי במטמון (בלי cookies), ו-`lib/supabase/proxy.ts` לרענון session (נקרא מ-`proxy.ts` שבשורש). לקוח ה-service role רק ב-`lib/server/privileged/service-client.ts` (AD-4).
- סליקה עתידית: ההכנה וההחלטות ב-`_bmad-output/specs/spec-brunch-at-tal/online-payments.md`. בגרסה הראשונה אין סליקה, וכל תשלום נוצר רק דרך ליבת האישור (AD-10).

## הרצה ובדיקה

- כל שינוי בסכמה מתחיל בקובץ חדש: `npx supabase migration new <name>` (ה-CLI לא מותקן גלובלית, לכן `npx`). אחרי שכותבים את ה-SQL בקובץ, מחילים אותו על המסד עם `apply_migration` של ה-MCP, עם אותו תוכן. לא משנים סכמה ב-`execute_sql`.
- אחרי כל מיגרציה להריץ את ה-security advisor של Supabase (`get_advisors` ב-MCP). הוא מזהה טבלה בלי RLS ופונקציה בלי search_path. ‏WARN ‏`0029` על RPC מסוג definer עם grant ל-`authenticated` מאושר (AD-5). כל WARN או ERROR אחר חוסם.
- `npm test` מריץ את הבדיקות הטהורות (פרויקט `unit` ב-Vitest: כל `*.test.ts(x)` חוץ מ-`supabase/tests/`), בלי מסד ובלי `.env`. בדיקות של RPC ו-RLS נכתבות ב-`supabase/tests/**/*.test.ts` ורצות ב-`npm run test:db` (פרויקט `db`, קובץ אחרי קובץ) מול פרויקט ה-Supabase של הפיתוח, לא מול mock. הן מתחברות ב-`pg` דרך `DEV_DATABASE_URL` שב-`.env.local` (Session pooler, פורט 5432, חייב להכיל את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`). משתמשים בעזרים של `supabase/tests/support/db.ts`: ‏`inRollback` לכל שינוי, ‏`asAuthenticated` בתוכו, ‏`testName` לכל נתון בדוי ו-`onCleanup` למחיקה.
- עזרי הזמן והטלפון (AD-8, ‏AD-9) ב-`private`: ‏`local_day_end`, ‏`registration_closes_at`, ‏`cancel_deadline`, ‏`local_week_start`, ‏`prep_day`, ‏`normalize_phone`. טהורים (בלי `now()`), והקורא משווה מול `now()`. אין להם grant, הם נקראים מפונקציות definer. תצוגה בלבד ב-`lib/time.ts` ו-`lib/money.ts`.
- ‏CI (`.github/workflows/ci.yml`) רץ על כל push ו-PR: ‏`npm ci`, ‏lint, ‏typecheck, ‏`npm test` ו-`npm audit --omit=dev --audit-level=high`, בלי סודות ובלי מסד. לכן `npm test` לא ניגש לרשת או למסד.
- ‏`npm run lint` אוכף את כיוון התלות (`eslint.config.mjs`, נבדק ב-`test/eslint-rules.test.ts`): קובץ `"use client"` לא מייבא `lib/server/**`; ‏`lib/server/privileged` מיובא רק מתוכו, מ-`app/**/actions.ts`, מ-`app/api/**` ומ-`page.tsx` של נתיבי הטוקן; ‏`.from(...).insert/update/delete/upsert` מותר רק ל-`profiles` ול-`babies` (קובצי בדיקה פטורים); אין `parseFloat` ב-`lib/money.ts`. כלל `no-restricted-syntax` חדש מוסיפים לקבוצות שבקובץ, כי ב-flat config רשומה מאוחרת מחליפה את כל הרשימה.

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

## מלכודות ידועות

- עברית שמועברת כארגומנט דרך PowerShell או Bash משתבשת (כך קרה ב-memlog של ה-SPEC). קבצים עם עברית כותבים בכלי Write או Edit, לא ב-echo ולא בארגומנט shell.

<!-- /bmad:context -->

## מצב הקוד ופקודות

- הבנייה התחילה בסיפור 1.1: המיגרציות הראשונות ב-`supabase/migrations/`, איפוס סיסמה בקישור חד-פעמי, והמסכים `/reset/[token]`, `/login` ו-`/me`. מעקב הסיפורים ב-`_bmad-output/implementation-artifacts/`. ה-README.md מתאר הרצה, פקודות, הנעילה ו-checklist ההגדרות לכל סביבה.
- לקוח ה-service role נמצא ב-`lib/server/privileged/service-client.ts` (עם `server-only`). ב-`lib/supabase/server.ts` נשאר רק `createClient`. ‏`lib/supabase/public.ts` (‏`createPublicClient`, AD-16) הוא לקוח anon בלי cookies ובלי session, לתוכן שפורסם בלבד.
- טיפוסי המסד ב-`lib/supabase/database.types.ts`. אחרי כל מיגרציה יוצרים אותם מחדש עם `generate_typescript_types` של ה-MCP.
- `npm run dev`: שרת פיתוח. `npm run build`: בנייה לפרודקשן. כדאי להריץ אותה לפני סיום עבודה, כי push ל-main מפעיל פריסה.
- `npm run dev:reset-link`: יוצר או מוצא לקוחה בדויה במסד הפיתוח ומדפיס קישור איפוס סיסמה למחשב ולטלפון ברשת הביתית. עם דגלים מריצים `node scripts/dev-reset-link.mjs --admin` (אדמין) או `--url <כתובת פריסה>`, כי PowerShell מוחק את `--` של `npm run`.
- `npm run typecheck`: בדיקת טיפוסים (`tsc --noEmit`). `npm run format`: Prettier עם הפלאגין של Tailwind.
- הרצה של בדיקה אחת: `npx vitest run path/to/file.test.ts`, או `npx vitest run -t "<שם הבדיקה>"`. ‏`--project unit` או `--project db` מגבילים לפרויקט אחד.
