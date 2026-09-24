<!-- bmad:context -->
<!-- Verified 2026-09-24 against ee41cf1. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## בראנץ׳ אצל טל

אתר שיווקי, אזור אישי ופאנל ניהול לעסק שמארח בראנצ׳ים לנשים בחופשת לידה, על מסד נתונים אחד. Next.js + TypeScript, Supabase (Postgres, Auth, Storage), Vercel, Web Push. האתר בעברית, RTL, מותאם קודם לטלפון. מקור האמת: `brunch_at_tal_charecter.md`. SPEC: `_bmad-output/specs/spec-brunch-at-tal/`. UX: `_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/` (DESIGN.md, EXPERIENCE.md, mockups/).

## מדיניות

- לענות תמיד בעברית פשוטה וברורה, לכל אורך השיחה, כולל בזמן הרצת סקילים של BMAD.
- מסמכי תכנון (SPEC, UX, סיפורים) נכתבים בעברית. קוד, שמות משתנים, טבלאות ו-commits נכתבים באנגלית.
- **`brunch_at_tal_charecter.md` גובר על ה-SPEC ועל כל מסמך נגזר בכל סתירה.** החריגים היחידים הם החלטות שהתקבלו במפורש עם המשתמשת ונרשמו ב-`.memlog.md` של ה-SPEC או של ה-UX.
- ה-SPEC נגזר ממסמך המקור ונמצאו בו סטיות. לפני כל עבודה לבדוק את הסעיף הרלוונטי במסמך המקור עצמו.
- לא לערוך את `brunch_at_tal_charecter.md`. טעות או חוסר שנמצאו בו מציגים למשתמשת.
- לא לעשות git push בלי בקשה מפורשת, כי push ל-main מפעיל פריסה לפרודקשן ב-Vercel.
- פרויקט ה-Supabase המחובר (`.env.local` ו-MCP) הוא סביבת פיתוח: רק נתונים בדויים, אף פעם לא נתוני לקוחות אמיתיים. פרודקשן יהיה פרויקט נפרד.
- `SUPABASE_SECRET_KEY` וכל סוד אחר נשארים בשרת בלבד. אסור לשים אותם בקוד שרץ בדפדפן או במשתנה `NEXT_PUBLIC_*`.
- לא ליצור משאבים בתשלום ולא לפרסם אתר חי עם נתוני דוגמה בלי החלטה מפורשת של המשתמשת.

## איפה דברים נמצאים

- לפני כתיבת מיגרציה, policy או RPC לקרוא את `security-and-rpc-rules.md` וגם את `data-model.md` שב-SPEC.
- ערכים עסקיים שנערכים באדמין (ולכן לא נכתבים בקוד): `admin-configurable-parameters.md`. תוצאות ביטול: `cancellation-rules.md`.
- לקוחות Supabase: `lib/supabase/client.ts` לדפדפן, `lib/supabase/server.ts` לשרת (מכבד RLS), ו-`lib/supabase/proxy.ts` לרענון session (נקרא מ-`proxy.ts` שבשורש).

## הרצה ובדיקה

- כל שינוי בסכמה מתחיל בקובץ חדש: `npx supabase migration new <name>` (ה-CLI לא מותקן גלובלית, לכן `npx`). אחרי שכותבים את ה-SQL בקובץ, מחילים אותו על המסד עם `apply_migration` של ה-MCP, עם אותו תוכן. לא משנים סכמה ב-`execute_sql`.
- אחרי כל מיגרציה להריץ את ה-security advisor של Supabase (`get_advisors` ב-MCP). הוא מזהה טבלה בלי RLS ופונקציה בלי search_path.
- `npm test` מריץ את Vitest על קבצי `*.test.ts(x)`. בדיקות של RPC ו-RLS רצות מול פרויקט ה-Supabase של הפיתוח, לא מול mock.
## מוסכמות שונות מברירת המחדל

- כסף נשמר כ-integer באגורות (`*_agorot`), ILS, ומוצג ב-₪. אסור לחשב סכומים בנקודה צפה.
- זמנים נשמרים כ-`timestamptz`, ושעון השרת קובע, לא שעון הדפדפן. חישובי לוח שנה (סגירת הרשמה, תוקף עד סוף היום, גבול 48 השעות) נעשים לפי `Asia/Jerusalem`, כולל שעון קיץ.
- RLS פעיל בכל טבלה ב-`public`. ב-policy כותבים `(select auth.uid())` ולא `auth.uid()` ישירות, ושמים אינדקס על העמודה.
- שינוי בכסף, בזכויות או בהרשמות (הרשימה המלאה ב-`security-and-rpc-rules.md`) עובר רק דרך RPC או פונקציית שרת. הדפדפן לא כותב ל-`bookings`, `payments` או `entitlement_movements`. את `customer_id` גוזרים מ-`auth.uid()`, לא מהקלט.
- פונקציית `security definer`: `set search_path = ''`, בדיקת הקוראת והרשאת האדמין בתוך הפונקציה, ו-`revoke execute ... from public, anon`. אחרת Postgres מאפשר לכל אחד להריץ אותה.
- בדיקה, שריון, גריעה, ספירת מקומות, רישום ב-`audit_log` (before/after) והתראה מתבצעים בעסקה אחת. נועלים תמיד באותו סדר: קודם המפגש ואז הזכות. בהזזה נועלים את שני המפגשים לפי סדר המזהים.
- אישור תשלום, צריכת קישור, יצירת חשבון והתראות מקבלים מפתח idempotency ייחודי. קריאה חוזרת עם אותו מפתח מחזירה את התוצאה הקודמת.
- יצירת חשבון ב-Auth Admin API ושיוך הרכישה במסד הם לא עסקה אחת. צריך מצבי ביניים וניסיון חוזר, בלי לאבד תשלום ובלי לצרוך קישור שלא שויך.
- פוש לא נשלח מתוך עסקת הרשמה. הוא נכנס לתור (`notification_jobs`), וכשל פוש לא מבטל את ההרשמה.
- ערכים עסקיים וטקסט שיווקי לא נכתבים בקוד. הם מגיעים מטבלאות ההגדרות והתוכן. רק מיקרו-קופי של המערכת (כפתורים, שגיאות) נשאר בקוד.
- RTL: `<html lang="he" dir="rtl">`. משתמשים רק בכיווני Tailwind לוגיים (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`). `npm run lint` חוסם את `ml-`/`mr-`/`left-`/`right-`/`text-left` בכל מקום חוץ מ-`components/ui/`.

## מלכודות ידועות

- עברית שמועברת כארגומנט דרך PowerShell או Bash משתבשת (כך קרה ב-memlog של ה-SPEC). קבצים עם עברית כותבים בכלי Write או Edit, לא ב-echo ולא בארגומנט shell.

<!-- /bmad:context -->
