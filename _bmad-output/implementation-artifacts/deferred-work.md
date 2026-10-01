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
  target: 2.1
  summary: כשנבנות `business_settings` ו-`policy_snapshot`, להוסיף check constraints: ימים לפני הסגירה ושעות חלון הביטול אי-שליליים, ושעת הסגירה לא בין 00:00 ל-03:00 (שעה שנעלמת או כפולה במעבר שעון).
  evidence: `registration_closes_at` ו-`cancel_deadline` טהורים ולא בודקים קלט. ערך שלילי יקבע סגירה אחרי תחילת המפגש. המקום הנכון לאכוף הוא הטבלה שמזינה אותם. ‏`business_settings` נוצרת ב-2.1 (רטרוספקטיבה של E1, 2026-10-01), ושם גם `policy_snapshot` אם הוא נוצר מאוחר יותר.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-time-money-and-phone-helpers.md`
  target: 2.1 אם נדרש, אחרת 2.2
  summary: בסיפור הראשון שבודק RLS או RPC עם לקוחה אמיתית, להוסיף ל-`supabase/tests/support/db.ts` יצירה ומחיקה של משתמשות Auth בדויות עם הקידומת `runId`.
  evidence: ARCHITECTURE-SPINE שורה 296 ("כל בדיקה יוצרת משתמשות ונתונים עם קידומת `test_<run-id>` ומוחקת אותם"). היום `asAuthenticated` מקבל uuid אקראי בלי משתמשת Auth, וזה מספיק לעזרים הטהורים. ה-verify של 2.1 בודק שלקוחה לא קוראת תשלום של אחרת. סשן 2.1 יחליט אם פרופיל בלי משתמשת Auth מספיק לזה (ל-`profiles` אין FK ל-`auth.users`).

- source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-01.md`
  target: 6.9
  summary: לפני ההשקה להחליט אם מפעילים בפרויקט ה-Supabase של production את Leaked password protection (WARN ‏`auth_leaked_password_protection` של ה-advisor).
  evidence: החלטת המשתמשת ברטרוספקטיבה של E1 (2026-10-01): מקבלים את ה-WARN בפרויקט הפיתוח. ייתכן שההגדרה דורשת תוכנית בתשלום של Supabase, ולכן זו החלטה שלה.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-money-schema-and-payment-approval-core.md`
  target: סיפור היבוא
  summary: ‏`entitlements.payment_id` הוא `not null`. סיפור יבוא הלקוחות צריך להתיר `import_batch_id` במקומו (אחד מהשניים חובה) לפני שיתרות פתיחה נכנסות.
  evidence: ‏data-model.md כותב "payment_id (או import_batch_id)", ויומן התנועות כבר כולל `opening_balance`. נמצא בביקורת של 2.1 (blind-hunter).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 3.6, ‏3.13/3.14
  summary: ב-2.12 יש תבנית אחת לכל סוג. ‏3.6 מחליט על נוסח לכל מקרה ב-`booking_cancelled` (זיכוי, החזר, ביטול בלי החזר), ו-3.13/3.14 ב-`entitlement_changed` (הארכה, החזרת כניסה, תיקון). אפשרות: שדה `{outcome}` שהקורא מעצב, או תבניות נוספות בטבלה.
  evidence: החלטת המשתמשת ב-2.12: תבנית אחת לסוג, ונוסח לכל מקרה נדחה לסיפורים שיוצרים את ההתראות.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 5.8
  summary: משימות `queued` ב-`notification_jobs` מצטברות מ-2.2 ועד שיש עובד פוש. ‏5.8 מחליט מה עושים בהן כשהעובד עולה (לשלוח, לסגור בלי שליחה את מה שהתיישן, או לפי גיל המשימה), כדי שלקוחה לא תקבל בבת אחת פוש ישן.
  evidence: ‏`private.enqueue_notification` יוצרת משימה לכל סוג עם פוש, ואין עדיין `claim_push_jobs` או עובד.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 3.5
  summary: ‏`booking_confirmed` מוגדר בתבנית כאזור אישי בלבד (`push = false`), אבל ב-memlog של ה-SPEC (שורה 264) התראת אישור להרשמה זוגית נשלחת גם בפוש "כשיש פוש". ‏3.5 צריך להחליט: סוג נפרד, ערוץ שנקבע לפי הקריאה, או לוותר על הפוש.
  evidence: ב-2.12 הערוץ קבוע לסוג (AD-12, "הערוצים והנמענת לכל סוג קבועים באותה טבלה").

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 2.5
  summary: הערכים ב-`p_vars` הם טקסט שהקורא עיצב (תאריך DD.MM, סכום ב-₪). כשהקורא הראשון שמעצב תאריך או סכום נבנה (`purchase_repeat`), ליצור עזר SQL אחד לכל עיצוב ב-`private`, כדי שכל RPC יעצב אותו דבר.
  evidence: ‏`private.enqueue_notification` מחליפה `{key}` בערך כמו שהוא. ב-2.12 עוד אין קורא.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 4.7
  summary: עריכת תבנית צריכה להיבדק בשמירה: רק שדות `{…}` שהסוג מעביר, וסוגריים מאוזנים. אחרת כל enqueue של הסוג זורק `INVALID_INPUT` ומבטל את ה-RPC של התשלום או ההרשמה.
  evidence: ‏`private.render_notification_text` בודקת רק בזמן ה-enqueue, ואין בטבלה רשימת שדות מותרים לכל סוג. ביקורת 2.12, ממצא 5.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 4.7
  summary: ‏RPC העריכה (או trigger) מעלה את `version` ואת `updated_at`, קובע את `updated_by`, ומשנה רק `title` ו-`body`. ‏`push`, ‏`body_mode` ו-`recipient_kind` קבועים.
  evidence: ב-2.12 אין שום אכיפה במסד לאלה, ובבדיקה הגרסה עולה ידנית. ביקורת 2.12, ממצא 6.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-notification-core.md`
  target: 5.8
  summary: הודעה כללית עד 2000 תווים בעברית (כ-4000 בייט) עלולה לעבור את מגבלת ה-payload של Web Push (כ-4KB). העובד מקצר את הגוף לפוש (ההתראה באזור האישי נשארת מלאה), או ש-`admin_send_broadcast` מגביל את האורך.
  evidence: ‏`enqueue_notification` מקבלת override עד 2000 תווים, ואין גבול אחרי הרינדור. ביקורת 2.12, ממצא 7.
