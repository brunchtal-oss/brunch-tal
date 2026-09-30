# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-phone-activation-and-login-tracer.md`
  summary: אדמין אחרי איפוס סיסמה, או משתמשת מחוברת שאינה לקוחה פעילה, נכנסות ללולאה `/me` ← `/login` בלי הודעה. צריך יעד לפי תפקיד (`/admin`) והודעה למי שמחוברת בלי הרשאה.
  evidence: `requireCustomer` מפנה כל תפקיד שאינו customer ל-`/login?next=/me`, ומסך ההצלחה באיפוס תמיד מקשר ל-`/me`. אזור האדמין עוד לא קיים (1.5).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-phone-activation-and-login-tracer.md`
  summary: ניסיון חוזר באיפוס עובר דרך `reset_begin`. לכן קישור שפג בין הניסיונות, או תשובה של `reset_complete` שנשמרה אבל לא הגיעה, מציגים "פג" או "כבר שימש" אחרי שהסיסמה כבר השתנתה. הענפים `already_consumed` ו"מסיים גם אם פג" ב-`reset_complete` לא נגישים מהאפליקציה.
  evidence: `completeReset` תמיד קורא ל-`reset_begin`, שמעלה `LINK_EXPIRED` או `LINK_USED`. תיקון דורש מצב ביניים או סימון, בניגוד ל-Design Notes של 1.1. כדאי לבדוק ב-1.4 (idempotency).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-phone-activation-and-login-tracer.md`
  summary: בדיקות מסד אוטומטיות ל-1.1 כשתשתית ה-`pg` של 1.3 תהיה מוכנה. צריך לבדוק ש-anon ו-authenticated נדחים מ-`reset_begin`, `reset_complete`, `token_view` ו-`issue_reset_token`, שקישור חלופי מבטל את הקודם, ש-`get_my_session_role` מחזיר customer, admin או none כ-invoker, שמדיניות `profiles` מחזירה רק את השורה של המשתמשת, ומה קורה בניסיון חוזר מול ה-RPC האמיתיים.
  evidence: היום כל אלה נבדקו רק ידנית ב-SQL שמתגלגל אחורה. בבדיקות Vitest ה-RPC ב-mock.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-phone-activation-and-login-tracer.md`
  summary: `alter default privileges for role postgres revoke execute on functions from public` גלובלי עלול לחסום מ-anon ומ-authenticated פונקציות של הרחבות שייווצרו בעתיד.
  evidence: לא אומת. כדי להכריע צריך לבדוק באיזה תפקיד Supabase יוצר הרחבות מהדשבורד, ואם פונקציות ההרחבה נקראות ישירות מהתפקידים האלה.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-phone-activation-and-login-tracer.md`
  summary: לבדוק אם ביומני הבקשות של Vercel מופיע `/reset/<token>`, בניגוד ל-AD-16.
  evidence: לא אומת. `logging.incomingRequests.ignore` משפיע רק על הקונסול של `next dev`. צריך לבדוק ב-1.6 מול פריסת preview.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-site-lock-environments-and-preview-deploy.md`
  summary: לפני ההשקה להחליט מה עושים עם `/reset/<token>` ו-`/join/<token>` ביומני הבקשות של Vercel (להוציא את הטוקן מהנתיב, או לקבל עם תוקף קצר ויומן מוגבל).
  evidence: Vercel רושם את נתיב הבקשה ואי אפשר לכבות את זה בקוד. החלטת המשתמשת ב-1.6 (2026-09-29): מקבלים בינתיים, כי הנתונים בדויים, הטוקן חד-פעמי ל-48 שעות, ורק בעלת החשבון רואה את היומן.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-site-lock-environments-and-preview-deploy.md`
  summary: לוודא שהנעילה לא נפתחת אם `VERCEL_ENV` חסר בזמן ריצה ב-Vercel (למשל אם מכבים "Automatically expose System Environment Variables").
  evidence: לא אומת (maybe-false, medium). `isSiteLocked` מזהה Vercel רק לפי `VERCEL_ENV`. הבדיקה בטלפון מול preview ו-production מאשרת את המצב הנוכחי. כדי להכריע: לבדוק בתיעוד של Vercel אם `VERCEL_ENV` זמין תמיד בזמן ריצה.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-site-lock-environments-and-preview-deploy.md`
  summary: כשיתווספו manifest ו-service worker (פוש), לבדוק שהם עובדים מאחורי הנעילה. הדפדפן לא שולח Basic Auth בבקשת manifest בלי `crossorigin="use-credentials"`.
  evidence: ה-matcher נועל כל נתיב, כולל קבצים סטטיים. היום אין manifest, ולכן זה לא שובר כלום עדיין.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-tooling-lint-rules-and-ci.md`
  summary: ב-AGENTS.md להמליץ על `npx vitest run --project unit ...` להרצת בדיקה בודדת, כי בלי `--project` ‏Vitest מריץ גם את בדיקות המסד.
  evidence: ממצא 11 בסקירת 1.2. עם שני projects, `npx vitest run -t "<שם>"` מריץ את שניהם. התיקון הוא בקובץ הנחיות לסוכנים, ולכן נדחה.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-tooling-lint-rules-and-ci.md`
  summary: לעדכן את מסמכי התכנון אחרי 1.2 ו-1.6: טבלת האכיפה ב-ARCHITECTURE-SPINE (דפי הטוקן רשאים לייבא privileged), רשומת "פערי E1 מול הקוד" ב-Deferred של ה-SPINE (נסגרו), `epic-1-context.md` ("אין push ל-main לפני 1.6"), והפריט של 1.1 ב-deferred-work שנשאר "לבדוק ב-1.6".
  evidence: ממצא 12 בסקירת 1.2. ה-SPINE גובר על שאר המסמכים, ולכן החריגה לדפי הטוקן צריכה להופיע בו.
