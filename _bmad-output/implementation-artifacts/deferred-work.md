# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-site-lock-environments-and-preview-deploy.md`
  target: 5.15
  summary: לפני ההשקה להחליט מה עושים עם `/reset/<token>` ו-`/join/<token>` ביומני הבקשות של Vercel (להוציא את הטוקן מהנתיב, או לקבל עם תוקף קצר ויומן מוגבל).
  evidence: Vercel רושם את נתיב הבקשה ואי אפשר לכבות את זה בקוד. החלטת המשתמשת ב-1.6 (2026-09-29): מקבלים בינתיים, כי הנתונים בדויים, הטוקן חד-פעמי ל-48 שעות, ורק בעלת החשבון רואה את היומן.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-site-lock-environments-and-preview-deploy.md`
  target: 5.8/5.9
  summary: כשיתווספו manifest ו-service worker (פוש), לבדוק שהם עובדים מאחורי הנעילה. הדפדפן לא שולח Basic Auth בבקשת manifest בלי `crossorigin="use-credentials"`.
  evidence: ה-matcher נועל כל נתיב, כולל קבצים סטטיים. היום אין manifest, ולכן זה לא שובר כלום עדיין.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-time-money-and-phone-helpers.md`
  target: הסיפור שיוצר את `business_settings` (4.7 או קודם)
  summary: כשנבנות `business_settings` ו-`policy_snapshot`, להוסיף check constraints: ימים לפני הסגירה ושעות חלון הביטול אי-שליליים, ושעת הסגירה לא בין 00:00 ל-03:00 (שעה שנעלמת או כפולה במעבר שעון).
  evidence: `registration_closes_at` ו-`cancel_deadline` טהורים ולא בודקים קלט. ערך שלילי יקבע סגירה אחרי תחילת המפגש. המקום הנכון לאכוף הוא הטבלה שמזינה אותם.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-time-money-and-phone-helpers.md`
  target: 2.2
  summary: בסיפור הראשון שבודק RLS או RPC עם לקוחה אמיתית, להוסיף ל-`supabase/tests/support/db.ts` יצירה ומחיקה של משתמשות Auth בדויות עם הקידומת `runId`.
  evidence: ARCHITECTURE-SPINE שורה 296 ("כל בדיקה יוצרת משתמשות ונתונים עם קידומת `test_<run-id>` ומוחקת אותם"). היום `asAuthenticated` מקבל uuid אקראי בלי משתמשת Auth, וזה מספיק לעזרים הטהורים.
