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

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-join-tracer.md`
  target: 2.3
  summary: התנגשות אחרי שלב 2 (‏`phone_taken` או `bind_conflict` ב-`join_complete`) משאירה משתמשת Auth עם מייל וסיסמה בלי פרופיל. קישור עתידי עם אותו מייל ייכנס ל-`identity_match`, וההתחברות שלה תיתן `ACCOUNT_NOT_ACTIVE`. צריך לרשום אותה לטיפול של טל (או למחוק אותה) כשהקישור עובר ל-conflict.
  evidence: ‏`pending_user_id` נשאר על הטוקן, ושום קוד לא מנקה את משתמשת ה-Auth. ביקורת 2.2 (edge-case, blind-hunter).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-join-tracer.md`
  target: 2.4
  summary: קישור ב-`claiming` נעול ל-`input_hash` הראשון. אם שלב ה-Auth נכשל (מייל ש-Auth דוחה, `email_exists`, תקלה) והלקוחה מתקנת מייל או טלפון, היא מקבלת `LINK_IN_USE` לתמיד. ‏2.4 (המשך ממצב claiming) מחליט: לאפשר claim מחדש כשאין עדיין משתמשת Auth ל-`pending_user_id`, או להעביר ל"לטיפול". גם `email_exists` משאיר את הקישור `claiming` ו-`token_view` מציג אותו כפעיל.
  evidence: ‏`join_begin` זורק `LINK_IN_USE` לכל hash אחר במצב claiming (החלטה ב-spec). ביקורת 2.2, edge-case 1–3.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-join-tracer.md`
  target: E3
  summary: ‏`private.bind_purchase` ו-`token_view` לא בודקים `payments.status = 'approved'` ו-`entitlements.status = 'active'`. כשתהיה פעולה שמבטלת תשלום או שוללת זכות, קישור פתוח ישייך ויתריע על רכישה שבוטלה.
  evidence: היום אף RPC לא קובע `voided`, ‏`revoked` או `refunded`, ולכן זה לא קורה. ביקורת 2.2, edge-case 6–7.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-join-tracer.md`
  target: 2.10
  summary: ‏`babies` פתוחה לכתיבה ישירה של הלקוחה (insert/update לפי עמודות), אבל רק `join_complete` בודק תאריך לידה לא בעתיד ומספר תינוקות. ‏2.10 מוסיף את הבדיקות (trigger או RPC) לפני שמסך הפרופיל כותב.
  evidence: check לא יכול להשוות ל-`now()`. ביקורת 2.2, blind-hunter 6.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-join-tracer.md`
  target: 6.9
  summary: ‏`weak_password` של Auth ממופה תמיד ל"סיסמה קצרה מדי". אם יופעל leaked password protection בפרודקשן, סיסמה ארוכה שדלפה תקבל הודעה מטעה. ההחלטה על ההגנה ב-6.9 קובעת גם את הנוסח (`reasons: ["pwned"]`).
  evidence: ‏`ensureAuthUser` ב-`lib/server/privileged/join.ts`. ביקורת 2.2, blind-hunter 7.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-existing-account-and-identity-conflicts.md`
  target: 2.4
  summary: קישור ב-`awaiting_login` נשאר קשור לחשבון עד שהוא פג, גם כשהלקוחה הקלידה בטעות מייל או טלפון של לקוחה אחרת או לא מצליחה להתחבר. קלט אחר מקבל `LINK_IN_USE`, ו"לטיפול" לא רואה אותו. ‏2.4 מחליט: קישור חלופי מטל, או סימון ב"לטיפול".
  evidence: ‏`join_begin` נועל את `awaiting_login` ל-`input_hash` הראשון (החלטה ב-spec, בדיקה אחת לקישור). ביקורת 2.3, edge-case 1.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-existing-account-and-identity-conflicts.md`
  target: הסרת פרטים (`admin_anonymize_customer`)
  summary: כשלקוחה מוסרת, קישורי `join` שלה במצב `awaiting_login` צריכים לעבור ל-`conflict` (או לבוטל) באותה עסקה. אחרת אף אחת לא יכולה לשייך אותם, ו-`claim_join` מחזיר `NOT_AUTHORIZED` ("חשבון אחר") עד התפוגה.
  evidence: היום אין RPC שמסיר פרטים, ולכן זה לא קורה. ביקורת 2.3, edge-case 6 ו-blind-hunter.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-link-lifecycle-and-mid-join-recovery.md`
  target: 2.6
  summary: ב-toggletip של "תוקף הכרטיסיה פג" ב-`/me` מספר השבועות הוא `Math.round(validity_days / 7)` בלי צורת יחיד או זוגי. כשטל תערוך תוקף שאינו כפולה של 7 (למשל 10 ימים), יוצג "עברו 1 שבועות" או מספר מעוגל. ‏2.6 מחליט: ימים כשאינו כפולה של 7, ונוסח ליחיד ולזוגי (באישור המשתמשת).
  evidence: ‏`validityWeeks` ב-`app/me/purchase-items.ts` ו-`expiredBeforeBoundInfo` ב-`lib/copy/customer.ts`. היום יש רק כרטיסייה של 49 ימים. ביקורת 2.4, blind-hunter ו-edge-case.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-repeat-purchase-and-amount-override.md`
  target: 4.7
  summary: מסך ההגדרות מוסיף את `business_settings.duplicate_payment_window_days` (טווח לזיהוי תשלום כפול, ברירת מחדל 7) ל-`value-change-row`, עם יומן ישן ← חדש.
  evidence: העמודה נוצרה ב-2.5, אבל הכרטיס של 4.7 לא מונה אותה ברשימת ברירות המחדל (admin-configurable-parameters.md, החלטת משתמשת 2026-10-02).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-repeat-purchase-and-amount-override.md`
  target: הסרת פרטים (`admin_anonymize_customer`)
  summary: תשלום של לקוחה שפרטיה הוסרו: `admin_list_payments` מחזיר את `full_name` בלי בדיקת `anonymized_at` (וכותרת ריקה אם השם ריק), ו-`private.similar_payments` מחזיר null שמוצג באזהרת הכפילות כ"לקוחה חדשה". הסיפור שמסיר פרטים מחליט על נוסח ("לקוחה אנונימית", EXPERIENCE) ומיישר את שתי הפונקציות.
  evidence: ביקורת 2.5, ממצא 8. היום אין RPC שקובע `anonymized_at`, ולכן זה לא קורה.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-repeat-purchase-and-amount-override.md`
  target: הסרת פרטים (`admin_anonymize_customer`)
  summary: הסרת פרטים מנקה גם את `payments.payer_label` ("שם לזיהוי") בכל התשלומים של הלקוחה.
  evidence: שם פרטי הוא מידע מזהה (AD-19); העמודה נוספה ב-2.5 אחרי הביקורת.
