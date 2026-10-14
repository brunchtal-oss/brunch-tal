# Epic 2 Context: E2 חשבונות וכסף: מאישור תשלום ללקוחה מחוברת

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

שכבת החשבונות והכסף: מוצרים, אמצעי תשלום, תשלומים, זכויות ויומן תנועות, הצטרפות בקישור חד-פעמי, חשבון קיים והתנגשויות, פרופיל ותינוקות, שתי הסכמות לצילום וליבת ההתראות. טל מאשרת תשלום בטלפון, מעתיקה קישור, והלקוחה מצטרפת ומגיעה מחוברת ל-`/me` עם היתרה והתפוגה הנכונות, בלי כפילויות ובלי לאבד תשלום. רוב האפיק ממוזג. נשאר סיפור 2.8: איפוס סיסמה ושינוי מייל וטלפון דרך טל, והגבלת קצב להתחברות ולפעולות טוקן. ההגבלה דחופה, כי האתר כבר פתוח בפרודקשן (מאז 2026-10-10, עם `noindex`), ועד 2.8 יש רק ההגבלה המובנית של Supabase Auth.

## Stories

- Story 2.1: Money schema and payment approval core
- Story 2.12: Notification core
- Story 2.2: Join tracer: approve, link, join, personal area
- Story 2.3: Existing account and identity conflicts
- Story 2.4: Link lifecycle and mid-join recovery
- Story 2.5: Repeat purchase and amount override
- Story 2.6: Product catalog admin
- Story 2.7: Payment methods admin (בוטל)
- Story 2.8: Admin-assisted reset, email and phone change, rate limit
- Story 2.9: Prior participation (בוטל)
- Story 2.10: Customer profile, babies and photo consent
- Story 2.13: Two photo consents and two-step join form
- Story 2.11: Refactor sweep (הוחלף ב-5.20)

## Requirements & Constraints

- **התחברות:** מייל וסיסמה דרך Supabase Auth, בלי ניתוק אוטומטי (גם ללקוחה וגם לטל). הסיסמה לא נשמרת מחוץ ל-Auth, לא נשלחת ולא מוצגת לטל.
- **איפוס ידני:** אין ספק מייל. טל מאמתת את זהות הלקוחה ומפיקה קישור איפוס אישי וחד-פעמי, שהיא שולחת בעצמה. קישור איפוס לא חושף מידע של לקוחה אחרת. מייל שהוזן בטופס לא מוצג כמאומת.
- **שינוי מייל או טלפון:** רק דרך טל, אחרי אימות זהות ובדיקת כפילות, ונרשם ביומן. מייל של חשבון אחר נחסם. הלקוחה לא יכולה לשנות טלפון או מייל בעצמה, גם בפנייה ישירה ל-API או ב-`auth.updateUser` עם המפתח הציבורי. אי אפשר להשתלט על חשבון בעזרת טלפון בלבד.
- **הגבלת קצב:** התחברות (`/login` ו-`/admin/login`), הצטרפות, הפעלה ואיפוס מוגבלים בקצב לפי IP ומזהה טוקן. הודעות השגיאה לא חושפות אם חשבון, מייל או טלפון קיימים.
- **קישורים:** תקפים 48 שעות (קבוע), פעם אחת; פתיחה או תצוגה מקדימה לא צורכות; קישור חלופי מבטל את הקודם. הטוקן הגולמי לא נשמר, ולכן אין העתקה מאוחרת, רק הפקה מחדש.
- **תשלום וזכויות:** רק אישור של טל יוצר תשלום וזכות, אחד מכל אחד בכל אישור. retry או לחיצה כפולה לא מכפילים תשלום, זכות, טוקן או חשבון. כרטיסייה תקפה עד סוף היום המקומי, 49 ימים מתאריך הרכישה, ולא מוארכת בהצטרפות.
- לקוחה לא משנה role, תשלום, יתרה, תוקף, הסכמה או עמודה שלא ברשימת המותרות, ולא קוראת נתונים של אחרת. `grants.test.ts` וה-advisor נקיים.

## Technical Decisions

- **זהות:** `profiles.id = auth.users.id`. הקוראת נגזרת רק מ-`private.current_customer_id()` (ריק ללא מופעלת או מוסרת), אדמין רק מ-`private.is_admin()`. המייל נמצא רק ב-`auth.users.email` (חריג: `profiles.pending_email` ללקוחה מיובאת שלא הופעלה). אדמין קוראת מייל רק דרך `admin_get_customer`/`admin_list_customers`, לא דרך Admin API ולא דרך עמודת מראה.
- **בדיקת כפילות אחת:** `private.find_identity(p_email, p_phone)` מנרמלת (מייל `lower(trim())`, טלפון `private.normalize_phone`) ובודקת מול `auth.users.email`, `profiles.phone_e164` ו-`profiles.pending_email`. היא משמשת גם את `admin_change_email` ו-`admin_change_phone`. תוצאות: אין התאמה; חשבון אחד (בלי לחשוף באיזה שדה); `conflict` (שני חשבונות, או פרופיל מיובא שלא הופעל). `phone_e164` ייחודי.
- **לקוח service role:** רק ב-`lib/server/privileged/*` (כל קובץ מתחיל ב-`import "server-only"`), מיובא רק מ-`app/**/actions.ts`, `app/api/**` ו-`page.tsx` של נתיבי הטוקן. מותר רק ל-Auth Admin API לכתיבה (יצירה, סיסמה, מייל, מחיקה), ל-RPC של `service_role` ול-Storage. אסור לקרוא דרכו נתוני לקוחות.
- **פעולה מוגברת דו-שלבית:** פעולה שמשלבת מסד ו-Auth היא (1) RPC שכותב מצב כוונה, (2) קריאה אידמפוטנטית ל-Auth מ-`lib/server/privileged/*`, (3) RPC סוגר ואידמפוטנטי. retry ממשיך מהמצב השמור. שינוי מייל: RPC עם `find_identity` שכותב `profiles.account_op_state = email_change_pending` ו-`account_op_started_at`, אחר כך `updateUserById`, אחר כך סגירה. מצב תקוע מעל 15 דקות מופיע ב"לטיפול".
- **טוקנים:** נוצרים רק ב-`private.issue_token` (32 בייט, base64url; נשמר רק `token_hash`), נמצאים רק ב-`private.find_token`. שום קוד TS לא מגבב טוקן. לאיפוס כבר קיימים `public.issue_reset_token` (service role, משמש היום את `scripts/dev-reset-link.mjs`), `reset_begin`/`reset_complete`, `private.reset_target_valid` ואינדקס של קישור איפוס חי אחד למשתמשת. כפתור טל עובר דרך `admin_issue_link`, שמבטל את הקישור הקודם באותה עסקה. אף RPC של `authenticated` לא מקבל טוקן שאינו `join`. `admin_issue_link(purpose => 'claim')` לפרופיל מופעל זורק `ALREADY_ACTIVATED`.
- **נתיבי טוקן** (`/join/[token]`, `/reset/[token]`): `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, בלי משאבי צד שלישי. הטוקן עובר `lib/auth/clean-token.ts`. התצוגה רק דרך `token_view`, ופתיחה לא משנה מצב.
- **הגבלת קצב:** מנגנון אחד בלבד לכל פעולות הטוקן וההתחברות, `private.rate_limit_hit` במסד או `lib/server/privileged/rate-limit.ts` בשרת. 2.8 בוחר ביניהם, וגם איך חוסמים שינוי מייל עצמי ב-Auth (הגדרת פרויקט או hook). הגדרת Auth שלא נשמרת ב-migration נכנסת ל-checklist ב-README.
- **"לטיפול":** `admin_get_attention_items()` הוא המקור היחיד, נגזר ממצבים שמורים. 2.8 מוסיף פריט `email_change_pending` תקוע.
- **RPC:** definer עם `set search_path = ''`, בדיקת קוראת והרשאה בשורה הראשונה, revoke מכולם ו-grant אחד. כל RPC שמשנה נתונים מקבל מפתח idempotency. שינוי חתימה הוא `drop` ואז `create` באותה migration. פעולה רגישה: `private.plan_<name>` אחת ל-preview ולביצוע, עם `p_confirmed` ו-`CONFIRM_REQUIRED`. שגיאה עסקית ב-`P0001`, וההודעה בעברית רק ב-`lib/errors.ts`.
- **יומן ולוגים:** `private.audit` מקבלת את המבצעת כפרמטר, ו-`private.audit_diff` מסתיר שם, טלפון ושדות מזהים. היומן לא כולל סיסמאות או קישורים מלאים. לוג בשרת לא מכיל טוקן, סיסמה, מייל, טלפון או שם, רק מזהים וקודי שגיאה.
- **כסף וזכויות (ממוזג):** `private.approve_payment_core` היא הקוד היחיד שיוצר `payments` והזכות שנגזרת ממנו; `admin_approve_payment` היא המעטפת; שיוך רק ב-`private.bind_purchase`; יתרה רק מה-view `entitlement_balances`. סדר נעילה: `activation_tokens` ← `profiles` ← `events` ← … ← `notification_jobs`, ובתוך טבלה לפי `id`. שורת `profiles` היא ה-mutex של הלקוחה.

## UX & Interaction Patterns

- כל מסך נבנה אחרי הפעלת הסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- אין "טל" בנוסח המערכת ללקוחה: "צרי קשר" (וואטסאפ מפרטי העסק).
- `/me/profile`: טלפון ומייל לקריאה בלבד, עם "צרי קשר".
- `/admin/customers/[id]` (נבנה ב-4.2, עם הערות, הרשמות ורכישות): 2.8 מוסיף את חלק החשבון: קישורים, מייל, טלפון, הפקת קישור איפוס ושינוי מייל או טלפון. קישור שהופק מוצג כמו קישור הצטרפות ("שליחה בוואטסאפ" + "העתקת הקישור"). פעולה רגישה פותחת `sensitive-confirm-dialog` (כותרת בצורת שאלה, תיבת השפעה, צ׳קבוקס "אני מאשרת ש…" חובה, "סיבה (לא חובה)").
- שגיאות התחברות וקצב: הודעה כללית אחת, בלי לחשוף אם החשבון קיים.
- מפתח idempotency נוצר בטעינת הטופס ונשלח בכל ניסיון.

## Cross-Story Dependencies

- ממוזגים: 2.1, 2.12, 2.2, 2.3, 2.4, 2.5, 2.6, 2.10, 2.13. בוטלו: 2.7 (נשארים ארבעת אמצעי התשלום מה-seed), 2.9 (6.2 מוסיף `prior_participation_override`), 2.11 (הניקוי ב-5.20).
- 2.8 בסבב 3, מסלול B, במקביל ל-3.9 ול-4.4. 4.4 מוסיף כפתור ברשימת הלקוחות, ו-2.8 נוגע בכרטיס הלקוחה. שישה סיפורים מרחיבים את `admin_get_attention_items` (3.7, 3.8, 2.8, 3.13, 4.6, 5.10), כל אחד בסבב אחר.
- 5.15 (הסרת הנעילה הסופית ובדיקת הגבלת הקצב) אחרי 2.8 ו-5.20. 4.6 (הסרת פרטים) משתמש באותו דפוס דו-שלבי (`anonymization_pending`).
- הכפתור של טל להפקת קישור איפוס (`admin_issue_link`) מחליף את סקריפט ה-dev של 1.1 (`scripts/dev-reset-link.mjs`, דרך `issue_reset_token`).
