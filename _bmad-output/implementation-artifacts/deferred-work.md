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
  status: החלק של 3.6 נסגר ב-3.6 (2026-10-06, החלטת המשתמשת): תבנית לכל מקרה. ‏`booking_cancelled` (כרטיסייה) בנוסח קבוע, ו-`booking_cancelled_pinned` חדשה למוצמדת, עם המשתנים `{date}` ו-`{expires_on}`. ‏3.7 מוסיף את מקרי הזיכוי וההחזר, ו-3.13/3.14 את `entitlement_changed`.

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

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-product-catalog-admin.md`
  target: 2.11
  summary: הבדיקה שמוצר מוסתר לא מוצע ב"הוספת תשלום" מריצה עותק של השאילתה ב-`form-data.ts` ולא אותה עצמה. להוציא את הסינון לפונקציה שבדיקה מריצה.
  evidence: ביקורת 2.6, ממצא 7. הסינון (`.eq("active", true)`) קודם ל-2.6 ולא השתנה, והאישור דוחה מוצר מוסתר (`PRODUCT_NOT_AVAILABLE`).
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-publish-hero-to-home-tracer.md`
  target: 4.7
  summary: מסך ההגדרות (`/admin/settings`) מוסיף שורה "פרטי העסק" שמובילה לעורך `/admin/content/contact`. זו אותה רשומה (טיוטה ← פרסום), לא עותק נפרד בהגדרות.
  evidence: ‏EXPERIENCE (Flow 7 וההגדרות): פרטי העסק נערכים "מהגדרות › פרטי העסק או מתוכן האתר › קשר". העורך נבנה ב-5.1, ו-`/admin/settings` עוד לא קיים.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-concepts-and-session-management.md`
  target: אחרי ההדגמה (סיפור חדש)
  summary: "מוצרים תקפים" למפגש (מקור §7): הטבלה `event_products`, שדה סימון במסך המפגש ובדיקה ב-`private.plan_funding` שמוצר שלא סומן לא מממן את המפגש. הבדיקה חלה רק על זכויות חדשות.
  evidence: data-model מגדיר את הטבלה, אבל אף סיפור לא בונה אותה, ו-AD-18 בוחר מימון רק לפי סוג, יום בשבוע והיכרות. נדחה בהחלטת המשתמשת 2026-10-04 (3.1, שאלה 1).

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-concepts-and-session-management.md`
  target: 3.2
  summary: מ-3.2 יש הרשמות, ועד 3.8 `admin_update_event` משנה מועד או סוג של מפגש עם נרשמות בלי תצוגת השפעה ובלי התראה ("לא להזיז אירוע בשקט", מקור §7). ‏3.2 חוסם ב-`admin_update_event` שינוי של `date`, ‏`start_time`, ‏`end_time` או `kind` כשיש הרשמה פעילה (קוד שגיאה חדש), ו-3.8 מחליף את החסימה בתצוגת השפעה.
  evidence: ביקורת 3.1, intent-alignment. היום אין טבלת `bookings`, ולכן זה לא קורה.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-concepts-and-session-management.md`
  target: 3.4
  summary: הסינון של רשימת `/admin/sessions` (טיוטות ומפגשים שפורסמו ועוד לא התחילו) לא נבדק בבדיקה. בנוסף, מפגש שבוטל או הסתיים נפתח ב-`/[id]/edit` עם שדות עריכה שכל שמירה בהם נכשלת. ‏3.4 (פרטי מפגש) מחליט מה מוצג למפגש עבר, מבוטל או שהסתיים, ומוסיף בדיקה לסינון.
  evidence: ביקורת 3.1, verification-gap ו-blind-hunter. היום אין מפגש מבוטל או שהסתיים (3.8, ‏3.12), ואין בפרויקט בדיקות של שאילתות בעמודים.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.16
  summary: העמודים `/sessions` ו-`/sessions/[id]`, הפריט "הבראנצ׳ים" ב-`publicNav` (אחרי "בית"), אזור המפגשים בבית (בין `home/intro` ל-`gallery/testimonials`, ‏`sort_order` 3–4 פנויים) ומחיר התצוגה בעמוד המפגש.
  evidence: 5.2 בנה רק את החלק הסטטי. כפתור ההירו מופיע מעצמו כש-`/sessions` נכנס ל-`publicNav` (`hasPublicSessions`).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.7
  summary: לקוחה מחוברת רואה "האזור שלי" במקום "כניסה לאזור האישי" בסרגל העליון ובתפריט, ו-`whatsapp-bar` לא מוצג לה. צריך לקרוא את ה-session בלי לשבור את המטמון של העמודים הציבוריים (רכיב דינמי בתוך `Suspense`, לא `'use cache'` עם cookies).
  evidence: ‏EXPERIENCE › `top-bar` ו-`whatsapp-bar`. היום המעטפת הציבורית סטטית לגמרי ולא יודעת מי מחוברת.
  status: נסגר ב-5.7 (2026-10-06). ‏`components/public/viewer-shell.tsx` קורא את `getViewerRole()` בתוך `Suspense`: לקוחה רואה "האזור שלי" ← ‏`/me` ובלי פס וואטסאפ, אדמין רואה "לפאנל הניהול" ← ‏`/admin` עם הפס. העמודים הציבוריים נשארים במטמון. ה-chips ברשימה: רשומה חדשה למטה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.4
  summary: הסתרת `whatsapp-bar` (‏`inert` ו-`visibility: hidden`) כל עוד כפתור ההירו גלוי, והופעה כשהוא יוצא מהמסך.
  evidence: ‏EXPERIENCE › `whatsapp-bar`. כפתור ההירו לא מוצג עד 3.2, ולכן היום הפס גלוי תמיד (כמו בעמוד בלי כפתור הירו). אם 3.2 נבנה אחרי 5.4, הסיפור שמוסיף את הכפתור לוקח את זה.
  status: לא רלוונטי, החלטת המשתמשת 2026-10-05: מאז 2026-10-05 אין בהירו כפתור, ולכן הפס גלוי תמיד.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: עורך לסקשנים החדשים (`text_block`, ‏`steps`, ‏`faq`, ‏`testimonials`, ‏`footer`) והעמודים `about`, ‏`how-it-works`, ‏`gallery`, ‏`site`, כולל תצוגה מקדימה. היום התוכן שלהם מוזן רק כשורות בדויות במסד הפיתוח. ב-`publishTags` כבר יש `site` ← `content:global`.
  evidence: ‏`EDITABLE_PAGES` ב-`content-items.ts` כולל רק `home` (הירו) ו-`contact` (פרטי העסק).
  status: נסגר ב-5.3 (2026-10-05). העורך מקבץ את כל הסקשנים לפי המקום באתר, עם טיוטה, תצוגה מקדימה ופרסום (`/admin/content/[slug]`).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.4
  summary: תמונות באודות, בגלריה ובהמלצות (המלצה כתמונה), וצילום בהירו.
  evidence: 5.2 מציג המלצות טקסט בלבד, לפי ה-spec.
  status: נסגר ב-5.4 (2026-10-05). צילום בהירו (עם scrim), תמונה ב-about › main, הסקשן החדש `gallery/photos` ב-`/gallery` לפני ההמלצות, והמלצה כתמונה. בכל תמונה טקסט חלופי מומלץ ונקודת מוקד.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-concepts-and-session-management.md`
  target: 4.7
  summary: מסך ההגדרות מוסיף את `business_settings.default_session_start_time` ו-`default_session_end_time` ("שעות מפגש חדש", ברירת מחדל 10:30–14:30) ל-`value-change-row`, עם יומן ישן ← חדש.
  evidence: העמודות נוספו אחרי בדיקת הטלפון של 3.1 (החלטת המשתמשת 2026-10-04), ועד 4.7 טל לא יכולה לשנות אותן.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.5
  summary: עמוד "תנאי שימוש" חדש (slug ‏`terms`, נתיב `/terms`) לצד מדיניות הפרטיות (`/privacy`) והצהרת הנגישות (`/accessibility`). הפוטר כבר מקשר לכל אחד מהם ברגע שהעמוד שלו מתפרסם (`publicLegalNav` ב-`lib/nav.ts`). לפי EXPERIENCE הקישור להצהרת הנגישות קיים תמיד, גם לפני פרסום, ולכן ב-5.5 הוא מוצג קבוע.
  evidence: החלטת המשתמשת 2026-10-04. תנאי שימוש לא מופיעים במסמך המקור.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.4
  summary: המלצות כתמונות (צילומי מסך של ביקורות מוואטסאפ), עם טקסט חלופי. לפני פרסום מסתירים שם ומספר טלפון, ורק באישור הכותבת.
  evidence: בקשת המשתמשת 2026-10-04. מסמך המקור (מפת האתר) אוסר פרסום מזוהה בלי אישור.
  status: נסגר ב-5.4 (2026-10-05). פריט המלצה עם `kind: "image"`. טל מעלה צילום שכבר ערכה בטלפון (השם והטלפון הוסתרו), בלי צ׳קבוקס הסכמה: האחריות שלה היא האישור (החלטת המשתמשת, memlog של ה-UX). הטקסט החלופי מומלץ ומציע תמלול קצר.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.16
  summary: בבית, אחרי הפתיח: "הבראנצ׳ים הקרובים" עם 2–3 המפגשים הקרובים (תאריך, קונספט ותמונת אוכל), מהטבלאות של 3.1 ומרכיב כרטיס המפגש המשותף.
  evidence: בקשת המשתמשת 2026-10-04. מסמך המקור: "מפגשים קרובים" בבית.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: ‏`body` של `text_block` אופציונלי בשביל `home/contact`, אבל אותה סכמה משמשת את `home/intro`, ‏`about/main` ו-`contact/intro`. בעורך של 5.3 צריך לחייב טקסט בסקשנים האלה (חובה לכל סקשן, לא לכל kind).
  evidence: ביקורת התיקונים של 5.2 (2026-10-04).
  status: נסגר ב-5.3 (2026-10-05). ‏`schemaForSection` מחייב `body` בשלושת הסקשנים, בעורך וב-Action. האתר ממשיך לפרסר לפי kind.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: הוראות התשלום כבר לא מוצגות באתר הציבורי (החלטת המשתמשת 2026-10-04), אבל השדה עדיין נערך בפרטי העסק. צריך להחליט איפה הן מוצגות (למשל אחרי הצטרפות או באזור האישי), או להסתיר את השדה.
  evidence: ‏`FIELDS` ב-`app/admin/(shell)/content/contact/page.tsx` עדיין כולל את `payment_instructions`.
  status: נסגר ב-5.3 (2026-10-05, החלטת המשתמשת). השדה יצא מעורך פרטי העסק. הערך נשאר בסכמה ובמסד, והעורך שומר אותו בכל שמירה. איפה להציג אותן: רשומה חדשה למטה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: הסקשן `site/footer` כבר לא מוצג (הפוטר בלי שם העסק ובלי טקסט, החלטת המשתמשת 2026-10-04). העורך של 5.3 לא צריך לכלול אותו, וכדאי להחליט אם להסיר את השורה מהמסד.
  evidence: ‏`app/(public)/layout.tsx` כבר לא קורא את `site`.
  status: נסגר ב-5.3 (2026-10-05, החלטת המשתמשת): נכנס לעורך. עמוד "פוטר" עם רשימת קישורים (שם וכתובת `https://`), שמוצגים בפוטר מעל הקישורים הקבועים. הטקסט הישן עדיין עובר את הסכמה ולא מוצג. השורה `site/footer` נשארת, ולכן אין מחיקה ב-5.19.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md`
  target: 5.16
  summary: שלושת הפריטים הציבוריים שהופנו ל-3.2 מ-5.2 (`/sessions` ו-`/sessions/[id]` עם מחיר התצוגה, "הבראנצ׳ים" ב-`publicNav` ועדכון `nav.test.ts`, ואזור "הבראנצ׳ים הקרובים" בבית) נבנים בסיפור מסכים נפרד, עם `session-card` ו-`concept-header` של 3.2, בלי תפוסה ובלי תווית רגיל/זוגי.
  evidence: החלטת המשתמשת 2026-10-04 בתכנון 3.2. תצוגה בלבד בלי שינוי סכמה, ולכן ביקורת מקוצרת, ויכול לרוץ במקביל ל-3.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md`
  target: 3.11
  summary: ‏`private.plan_funding` דורש `available ≥ party_size`, ו-`private.book_core` משריין `units = party_size`. אבל מוצר זוגי הוא כניסה אחת לשני מבוגרים (מקור §2; ב-seed ‏`units 1, party_size 2`), ולכן זכות זוגית לא תתאים אף פעם למפגש זוגי. גם בגיליון כתוב "כניסה אחת" באופן קבוע. ‏3.11 מפריד בין מספר המקומות למספר הכניסות (כניסות מהזכות, מקומות מ-`party_size`), ומציג בגיליון את `units`.
  evidence: ביקורת 3.2 (intent-alignment, edge-case, blind). לא מגיע ב-3.2, כי זכות זוגית מוצמדת ולא נבחרת ב-self.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md`
  target: 3.8
  summary: ‏`preview_book_session` מחזיר `EVENT_NOT_BOOKABLE` עם `booked: false` למפגש שאינו `published`, לפני שהוא מחפש את ההרשמה שלה. במפגש שבוטל (3.8) או הסתיים (3.12) עמוד המפגש לא יציג את ההרשמה שלה. צריך לחפש את ההרשמה לפני בדיקת הסטטוס.
  evidence: ביקורת 3.2 (blind, edge). לא בודק עכשיו: עד 3.8 ו-3.12 אין מפגש מבוטל או שהסתיים.
  status: נסגר למפגש שהסתיים ב-3.12 (2026-10-06): ‏`preview_book_session` מחפש את ההרשמה שלה (`confirmed` או `completed`) לפני בדיקת הסטטוס, ובמפגש `completed` עם הרשמה שלה מחזיר `booked: true` עם `EVENT_COMPLETED`, והעמוד מציג "המפגש הסתיים" ו"השתתפת במפגש". נשאר ל-3.8 למפגש שבוטל (היום עדיין `EVENT_NOT_BOOKABLE` עם `booked: false`).

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md`
  target: 3.6
  summary: בעמוד המפגש, להרשמה שעברה את מועד הביטול העצמי מוצג רק "את רשומה למפגש הזה." בלי הכוונה. בנוסף אין בדיקת רכיב ל-`BookingPanel` (מפתח idempotency לכל פתיחה, נעילת busy). ‏3.6 מוסיף את מצב "הביטול דרך טל" (בנוסח בלי "כתבי לטל") ובדיקת רכיב לגיליון ההרשמה ולגיליון הביטול.
  evidence: ביקורת 3.2 (blind, verification-gap).
  status: נסגר ב-3.6 (2026-10-06). אחרי מועד הביטול העצמי מוצג "כבר אי אפשר לבטל את ההרשמה הזו בעצמך" עם "צרי קשר", ולפניו כפתור הביטול. בדיקת רכיב ב-`app/me/sessions/[id]/booking-panel.test.tsx` מרנדרת רק את הפאנל הסגור: רשומה בתוך החלון (כפתור הביטול), אחרי החלון ("צרי קשר", בלי מועד), ומצב שאפשר להירשם (כפתור ההרשמה). הגיליונות הפתוחים עצמם (הרשמה וביטול, מפתח לכל פתיחה, busy) עוד בלי בדיקת רכיב, כי אין testing-library.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-pwa-install-and-offline.md`
  target: אחרי ההגשה
  summary: השבתת כל הכפתורים שמשנים נתונים כשאין חיבור, כולל באדמין (UX memlog, review fixes). בהדגמה רק `/offline`, ופעולה שנשלחת בלי רשת נכשלת בשגיאה הקיימת.
  evidence: מסמך ההיקף 2026-10-04: אופליין מלא ומצב קריאה בלבד לא נכנסים ל-5.9.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-pwa-install-and-offline.md`
  target: 2.10
  summary: קישור "הדרכת התקנה" (`/install`) ברשימת הפרופיל ב-`/me` (EXPERIENCE › פרופיל). ב-5.9 הקישור רק בפוטר הציבורי.
  evidence: מסך הפרופיל עוד לא קיים.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-pwa-install-and-offline.md`
  target: 5.15
  summary: לטופס הנעילה (`POST /site-lock`) אין הגבלת ניסיונות, כמו ל-Basic Auth. אם הנעילה נשארת אחרי ההדגמה, להוסיף הגבלה או להסתמך על הסרתה ב-5.15.
  evidence: ‏`handleSiteLockPost` ב-`lib/site-lock.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-pwa-install-and-offline.md`
  target: אחרי ההגשה
  summary: לאתר אין דף שגיאה כללי (`app/error.tsx`). פעולה שנשלחת בלי רשת (התחברות, הרשמה, ביטול) מציגה את דף ברירת המחדל של Next באנגלית ("This page couldn't load"). צריך דף שגיאה בעברית, בעיצוב האתר, עם "לנסות שוב" (מתחיל ב-frontend-design, נוסח לאישור).
  evidence: בדיקת האופליין בדפדפן אחרי 5.9 (2026-10-04): שליחת טופס ההתחברות בלי רשת. לא הוצג אישור, אבל הדף באנגלית. החלטת המשתמשת: לדחות.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: 4.1
  summary: פריט "שולם בלי מקום" ב"לטיפול": רכישה מוצמדת ש-`private.place_pinned_booking` השאיר ב-`park` (תשלום וזכות עם `pinned_event_id`, בלי הרשמה). ב-3.11 ה-`park` נבנה ונבדק רק בקריאה ישירה לליבה (`online`).
  evidence: אין עדיין `admin_get_attention_items`; ‏`supabase/tests/pinned-approval.test.ts` (park).
  status: נסגר ב-4.1 (2026-10-06). פריט `paid_without_place` ב-`admin_get_attention_items`, מוביל לעמוד המפגש; נבדק ב-`supabase/tests/admin-home.test.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: 3.4
  summary: שורת "לקוחה חדשה · ממתינה להצטרפות" ברשימת הנרשמות של המפגש: הרשמה מוצמדת עם `customer_id` ריק עד ההצטרפות. היא כבר נספרת במכסה (`occupied_places`).
  evidence: ‏3.11 יוצר את ההרשמות האלה; רשימת הנרשמות נבנית ב-3.4.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: 2.9
  summary: ‏`private.has_participated` קורא רק הרשמות שהסתיימו. כש-2.9 מוסיף השתתפות מיבוא או מתיקון של טל (`profiles.prior_participation_override`), הפונקציה צריכה לקרוא גם אותה, כדי שלקוחה מיובאת לא תקבל היכרות שוב (מקור §2).
  evidence: ביקורת 3.11 (blind). העמודה עוד לא קיימת, ולכן לא נבדק עכשיו.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: 3.6
  summary: הרשמה מוצמדת עם `customer_id` ריק שההצטרפות שלה הסתיימה ב-`BIND_CONFLICT` ממשיכה לתפוס מקום במפגש. טל רואה רק קישור ב-conflict. צריך דרך לשחרר אותה (`admin_cancel_booking`) ולהציג אותה לטל ("לטיפול" של 4.1).
  evidence: ביקורת 3.11 (blind, edge). אין עדיין ביטול באדמין.
  status: נסגר. השחרור ב-3.6 (2026-10-06): טל מבטלת את השורה "לקוחה חדשה · ממתינה להצטרפות" מרשימת הנרשמות (`admin_cancel_booking`), המקום משתחרר ואין התראה. התצוגה ב-4.1 (2026-10-06): פריט `pinned_seat_held` ב"לטיפול" (עד סוף המפגש), מוביל לעמוד המפגש.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: סבב הסליקה
  summary: ‏`approve_payment_core` זורק `INTRO_NOT_ELIGIBLE` גם במצב `park` (אחרת האינדקס הייחודי היה זורק 23505). כשנבנה המסלול המקוון: לבדוק את המקרה הזה ולהחליט מה רואה הלקוחה ששילמה.
  evidence: ביקורת 3.11 (verification). אין עדיין קורא ל-`park`.


- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md`
  target: סיפור קטן אחרי 3.11
  summary: טקסט ברירת מחדל לפרטי בראנץ׳ שטל יכולה לערוך (למשל טקסט כללי כשאין תיאור למפגש ולקונספט, ועריכת תיאור הקונספט). החלטת המשתמשת 2026-10-05: בהמשך, כסיפור נפרד.
  evidence: בדיקת הטלפון של 3.11.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: עם `event_products`
  summary: מחיר ברירת מחדל ממחיר המוצר בעמוד המפגש הציבורי. ב-5.16 מוצג רק `display_price_agorot`, ובלעדיו אין שורת מחיר.
  evidence: החלטת המשתמשת 2026-10-05 (spec 5.16, Intent).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: 5.15
  summary: ל-anon יש הרשאת קריאה לכל הטבלה `events` (`grant select on table`), כולל העמודה `capacity_adults`. העמודים הציבוריים לא בוחרים אותה (`PUBLIC_SESSION_COLUMNS`), אבל ההרשאה עצמה עדיין פתוחה. לצמצם את ההרשאה לעמודות הציבוריות לפני הסרת הנעילה.
  evidence: ‏RLS ‏`events_anon_select` והרשאות העמודות של anon; ‏`lib/sessions/public.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: אחרי ההגשה
  summary: עריכת תיאור הקונספט (`concepts.description`) באדמין. אין היום מסך קונספטים, והתיאורים של חמשת הקונספטים נכתבו ישירות במסד הפיתוח.
  evidence: ‏spec 5.16, Design Notes.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: 5.19
  summary: ‏`npm run build` בלי `.env*` נכשל ב-prerender של `/contact` ("Supabase public client is not configured"), כי קוראי התוכן במטמון (5.2) יוצרים את הלקוח הציבורי בזמן הבנייה. ה-CI לא מריץ build, וב-Vercel יש משתנים, ולכן זה לא חוסם פריסה. צריך להחליט: לקרוא בלי לזרוק כשאין הגדרה, או לוותר על ה-AC הזה.
  evidence: ‏build ב-worktree של 5.16 אחרי הסרה זמנית של `.env.local` (2026-10-05). העמודים של 5.16 דינמיים ולא נכשלו.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: 5.4
  summary: בכרטיסי "הבראנצ׳ים הקרובים" בבית, תמונת המפגש (או הקונספט) בצד שמאל של המלבן (inline-end ב-RTL), במקום הצילום ביחס 5:2 למעלה. ב-`/sessions` ובראש עמוד המפגש בלי שינוי.
  evidence: החלטת המשתמשת 2026-10-05, בבדיקה בטלפון של 5.16 (memlog של ה-UX).
  status: נסגר ב-5.4 (2026-10-05). ‏`SessionCard` עם `layout="horizontal"`: צילום ריבועי ב-inline-end.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md`
  target: 5.3
  summary: ההירו כבר לא מציג כפתור (החלטת המשתמשת 2026-10-05), אבל `cta_label` עדיין שדה חובה בסכמת `hero` (`lib/content/schema.ts`) ובעורך (`app/admin/(shell)/content/home/page.tsx`). להסיר את השדה מהעורך ולהפוך אותו לאופציונלי בסכמה, בלי לפסול תוכן שכבר פורסם.
  evidence: ‏`HomeHero` לא קורא את `hero.cta_label` מאז 5.16.
  status: נסגר ב-5.3 (2026-10-05). ‏`cta_label` אופציונלי בסכמה ויצא מהעורך. הירו שפורסם איתו עדיין עובר, ושמירה מהעורך מורידה אותו.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-full-content-editor-and-testimonials.md`
  target: (בלי יעד)
  summary: להחליט איפה מוצגות הוראות התשלום (למשל אחרי הצטרפות או באזור האישי). השדה `payment_instructions` נשאר בסכמת פרטי העסק ובמסד, אבל לא נערך ולא מוצג.
  evidence: החלטת המשתמשת 2026-10-05: השדה יוצא מעורך פרטי העסק, והמקום שלו נרשם כאן.


- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md`
  target: 4.1
  summary: תמונה שתקועה ב-`copying` יותר מ-15 דקות מופיעה ב"לטיפול" (`admin_get_attention_items()`, ‏AD-21), עם פעולה לפרסם שוב.
  evidence: ‏5.4 בנה את המצב ואת ה-retry (פרסום חוזר ממשיך מהמצב השמור), אבל "לטיפול" עוד לא קיים. זו ההרחבה הראשונה מתוך ארבע (5.4, ‏5.5, ‏5.8, ‏5.10).
  status: נסגר ב-4.1 (2026-10-06). פריט `media_stuck` (‏`copying` 15 דקות ומעלה), מוביל ל-`/admin/content`; הפעולה היא פרסום חוזר של העמוד.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md`
  target: מסך הקונספטים
  summary: בורר תמונה לקונספט (`concepts.default_image_id`, שכבר במסד). ‏`photoUrl` כבר נופל לתמונת הקונספט כשאין תמונת מפגש. צריך RPC של אדמין שקובע את התמונה (פרסום + הסתרה של הקודמת, כמו `admin_set_event_image`).
  evidence: החלטת המשתמשת 2026-10-05: בהדגמה רק תמונת מפגש.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md`
  target: 5.10
  summary: ניקוי טיוטות יתומות ב-`media-drafts` ושורות `media_assets` במצב `draft` שלא שובצו (העלאה שנזנחה, תמונה שהוחלפה לפני שמירה), וקבצי טיוטה של תמונות שהוסתרו מזמן.
  evidence: ‏5.4 לא מוחק קבצי טיוטה: הם משמשים לתצוגה המקדימה ולפרסום חוזר. ‏`hidden` מוחק רק את הקובץ הציבורי.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md`
  target: 5.18 / 6.x
  summary: הקבצים הציבוריים מוגשים עם `cache-control: max-age=600` (נקבע בהעלאה ועובר בהעתקה). קובץ שהוסתר עלול להמשיך להיות מוגש כ-10 דקות אחרי המחיקה: מה-CDN של Supabase ומהמטמון של next/image (‏`images.minimumCacheTTL: 60`, ולכן ה-max-age של המקור קובע). להחליט לפני ההשקה אם זה מספיק.
  evidence: בבדיקת המסד של 5.4 הכתובת הציבורית החזירה 200 מיד אחרי המחיקה, ו-4xx רק עם query string חדש.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-personal-area-home-and-entitlements.md`
  target: 3.6
  summary: אחרי ביטול הרשמה, לבדוק שהבית ו-`/me/purchases` (`get_my_entitlements`) זהים למסך הכרטיסיות הפתוחות של טל (4.3). באותו סיפור להוסיף לבית את הקישור "לכל ההרשמות שלי" ל-`/me/bookings`, ואת פעולות הביטול וההזזה בכרטיס "המפגש הקרוב".
  evidence: ‏4.12 נבנה לפני 3.6 ו-4.3. אין עדיין ביטול, `/me/bookings` או מסך כרטיסיות פתוחות (Never של spec 4.12).
  status: החלק של 3.6 נסגר ב-3.6 (2026-10-06): בבית יש ביטול (או "צרי קשר") מתחת לכרטיס "המפגש הקרוב" והקישור "לכל ההרשמות שלי" ל-`/me/bookings`, והיתרה אחרי ביטול נבדקה מול `get_my_entitlements` ב-`supabase/tests/cancel-booking.test.ts`. ההזזה (3.10) וההשוואה למסך הכרטיסיות הפתוחות (4.3) נשארות לסיפורים שלהן.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-personal-area-home-and-entitlements.md`
  target: 3.12
  summary: אחרי סיום מפגש (תנועת `use`), לבדוק שהכניסה עוברת מ"משוריינות" ל"נוצלו" בבית ובפירוט, שכרטיסייה שנוצלה כולה עוברת ל"קודמות", ושהמסך זהה למסך הכרטיסיות הפתוחות של טל.
  evidence: ‏`is_used_up` ו-`used` נבדקו ב-`supabase/tests/my-entitlements.test.ts` בלי סיום מפגש אמיתי, כי 3.12 עוד לא נבנה.
  status: נסגר ב-3.12 (2026-10-06): ב-`supabase/tests/my-entitlements.test.ts` ‏`private.job_complete_events` מעבירה את הכניסה מ-`reserved` ל-`used` דרך `get_my_entitlements`, וכרטיסייה שנוצלה כולה מקבלת `is_used_up` (הבית והפירוט נגזרים מהמספרים האלה). ההשוואה למסך הכרטיסיות הפתוחות של טל נשארת ל-4.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-personal-area-home-and-entitlements.md`
  target: (בלי יעד)
  summary: בדיקה דטרמיניסטית ש-`days_left` ב-`get_my_entitlements` נספר לפי התאריך ב-`Asia/Jerusalem` ולא לפי UTC, גם בשעות שאחרי חצות המקומית.
  evidence: הבדיקה הקיימת קובעת את `expires_on` באותו ביטוי שבו משתמש ה-RPC, ולכן `current_date` (‏UTC) היה נכשל רק בין חצות ל-02:00 או 03:00. הקוד נכון. חסר מנגנון להזרקת זמן לבדיקות המסד.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-12-personal-area-home-and-entitlements.md`
  target: (הסיפור שיבנה ביטול תשלום)
  summary: `get_my_entitlements` לא מחזיר את מצב התשלום (`payments.status`). כשיתווסף ביטול תשלום (`voided`), להחליט איך הזכות והסכום מוצגים ללקוחה, ולהוסיף לכך שדה ובדיקה.
  evidence: ה-RPC מחזיר `amount_agorot` ו-`paid_on` מכל תשלום, בלי הבדל. אין היום פעולה שמבטלת תשלום (unverified, medium אם יתממש).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-customer-profile-babies-and-photo-consent.md`
  target: (בלי יעד)
  summary: אין גבול תחתון לתאריך לידה של תינוק, לא בטופס ההצטרפות, לא בפרופיל ולא ב-`private.babies_guard`. טעות הקלדה כמו 1026-07-05 נשמרת, ומוצגת אצל טל כגיל של "1000 שנים". הגבול הוא ערך עסקי (גיל מקסימלי או שנה), ולכן החלטה של המשתמשת.
  evidence: ביקורת 2.10 (blind). אותו מצב קיים ב-`join_complete` מ-2.2.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-customer-profile-babies-and-photo-consent.md`
  target: הסרת פרטים (`admin_anonymize_customer`) או כל RPC שנועל פרופיל ואז משנה תינוקות קיימים
  summary: ‏`private.babies_guard` נועל את שורת התינוק ואחריה את הפרופיל (ב-update וב-delete), בעוד ש-`join_complete` ו-`set_photo_consent` נועלים קודם את הפרופיל. RPC עתידי שינעל פרופיל ואז ימחק או יעדכן תינוקות קיימים עלול להיתקע (deadlock) מול מחיקה של הלקוחה. RPC כזה צריך לנעול את התינוקות לפני הפרופיל, או שה-guard ישתנה.
  evidence: ביקורת 2.10 (blind). היום אין פונקציה כזו (unverified, medium אם תיווצר).

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-self-cancel-and-admin-cancel.md`
  summary: ‏`supabase/tests/admin-booking.test.ts` יוצר מפגש בעוד 3 ימים עם כרטיסייה מ-`seedMoney` שתקפה רק בשני ובחמישי, ולכן 4 בדיקות נכשלות ב-`NO_MATCHING_ENTITLEMENT` ברוב ימי השבוע.
  evidence: נמצא בהרצה של 3.6 ב-2026-10-06 (שלישי, המפגש ביום שישי). ‏`support/money.ts:37` ‏`'{1,4}'`. הבדיקה מ-3.4; צריך לבחור את היום הבא שהוא שני או חמישי, או זכות בלי הגבלת ימים.
  status: נסגר ב-3.12 (2026-10-06, החלטת המשתמשת: אין הגבלת ימים במוצר אלא אם טל בוחרת). ‏`seedMoney` יוצרת כרטיסייה בלי הגבלת ימים (`allowed_weekdays` ריק), ‏`approve-payment.test.ts` מצפה ל-`null`, ובדיקת יום ראשון ב-`self-booking.test.ts` מגבילה את הזכות במפורש לשני וחמישי.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-admin-home-and-attention-items.md`
  target: 4.3
  summary: שורות "כרטיסיות שעומדות לפוג" בבית האדמין מקשרות למסך הכרטיסיות הפתוחות, מסונן לכרטיסיות שעומדות לפוג (EXPERIENCE › בית).
  evidence: ב-4.1 השורה בלי קישור, כי המסך עוד לא קיים (spec 4.1, Always).

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-admin-home-and-attention-items.md`
  target: 3.7
  summary: בסכום של בית האדמין להוסיף את שורת "החזרים שבוצעו ({n})" ולחשב את `net_agorot` פחות ההחזרים ב-`admin_get_home`, ולהוסיף את חלק "בקשות החזר פתוחות" ואת פריט בקשת ההחזר ב-`admin_get_attention_items`.
  evidence: ב-4.1 אין טבלת החזרים, ולכן `net_agorot = approved_agorot` ואין שורת החזרים (spec 4.1, Always ו-Never).

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-admin-home-and-attention-items.md`
  target: 4.2
  summary: בבית האדמין, השם של הלקוחה בשורת "כרטיסיות שעומדות לפוג" (ובפריט "לטיפול" של לקוחה שכבר יש לה חשבון) מקשר לכרטיס הלקוחה שלה. ‏`admin_get_home` צריך להחזיר גם `customer_id` (היום רק `entitlement_id`). אם 4.3 מוסיף לשורה קישור לכרטיסיות הפתוחות, להחליט יחד איך השורה נשארת יעד אחד.
  evidence: בקשת המשתמשת בבדיקה בטלפון של 4.1 (2026-10-06). כרטיס הלקוחה עוד לא קיים (4.2, סבב 6).
  status: נסגר ב-4.2 (2026-10-07). ‏`admin_get_home` מחזיר `customer_id` בכל שורה של `expiring_cards`, והשם בשורה מקשר לכרטיס (השורה עצמה לא קישור). פריטי "לטיפול" לא משתנים (החלטת המשתמשת 2026-10-07: רק "שילמה ואין לה מקום" שייך ללקוחה עם חשבון, והוא מוביל לעמוד המפגש). ההחלטה על יעד אחד לשורה כשמתווסף קישור לכרטיסיות הפתוחות נשארת ל-4.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-12-session-completion-job.md`
  target: (בלי יעד)
  summary: בדיקת הכפילות ב-`bind_purchase` ("כבר יש לה הרשמה במפגש הזה") והאינדקס `bookings_confirmed_customer_event_uidx` מסתכלים רק על `confirmed`. אחרי ש-`job_complete_events` מסיים מפגש, הרשמה מוצמדת בלי לקוחה משויכת ללקוחה שכבר הייתה לה הרשמה באותו מפגש, בלי `BIND_CONFLICT`, ויש לה שתי הרשמות ושני ניצולים. התיקון: לספור גם `completed` בבדיקה (`private.is_real_booking`), עם בדיקה.
  evidence: ביקורת 3.12 (edge, intent). נדיר: טל אישרה בטעות "לקוחה חדשה" למי שיש לה חשבון, למפגש שהיא כבר רשומה אליו, והקישור נפתח אחרי סוף המפגש. החלטת המשתמשת 2026-10-06: לא לתקן ב-3.12.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-12-session-completion-job.md`
  target: 3.7
  summary: ‏`private.job_complete_events` מדלגת על הקצאה מזיכוי (`booking_allocations.credit_id`). כשזיכויים נבנים, סיום מפגש צריך לסמן את הזיכוי שמימן את ההרשמה כמנוצל (`used`), עם בדיקה.
  evidence: ביקורת 3.12 (blind). היום אין זיכויים, ולכן אין הקצאה כזו.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-12-session-completion-job.md`
  target: 4.9
  summary: הכפתור בעמוד המפגש באדמין נקרא עכשיו "ללשונית העבודה" (`adminCopy.sessions.morningView`), אבל עדיין פותח את `/admin/sessions/[id]/day`. ‏4.9 מפנה אותו לדף העבודה של המפגש, ו-`/day` מפנה לשם.
  evidence: החלטת המשתמשת בבדיקת הטלפון של 3.12 (2026-10-06), נרשמה ב-memlog של ה-UX. התכנון של 4.9 ב-`demo-scope-2026-10-04.md`.
  status: נסגר ב-4.9 (2026-10-06). הכפתור פותח את `/admin/sessions/[id]/work`, ו-`/day` מפנה לשם.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-in-app-notification-centers.md`
  target: אחרי ההגשה
  summary: לקוחה מחוברת ב-`/sessions` (הרשימה הציבורית) רואה `status-chip` על מפגש שהיא רשומה אליו, כמו ב-`/me/sessions`. צריך לקרוא את ההרשמות שלה ברכיב דינמי בתוך `Suspense`, בלי לשבור את המטמון של הרשימה.
  evidence: ‏spec 5.16 (Always) השאיר את ה-chips ל-5.7, ו-5.7 הוציא אותם (Never). היום הרשימה הציבורית זהה לאורחת וללקוחה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-5-privacy-and-accessibility.md`
  target: 6.9
  summary: ‏`join_complete` שומר את `published_version` של המדיניות ברגע השליחה, לא את הגרסה שהלקוחה ראתה. טופס שנפתח לפני פרסום (או לפני פרסום חוזר) ונשלח אחריו נשמר עם הגרסה החדשה. לבחון אם להעביר את הגרסה שהוצגה ולהשוות, או לרשום את ההחלטה.
  evidence: ביקורת 5.5 (2026-10-06). ההתנהגות קיימת מ-2.2, ו-5.5 לא שינה את `join_complete` לפי הכוונה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-5-privacy-and-accessibility.md`
  target: 5.14
  summary: אין בדיקה שעמוד העורך ועמוד התצוגה המקדימה מעבירים את חסימת הפרסום של הצהרת הנגישות (`editor-page.tsx`, ‏`statementBlocked` ב-preview). החלקים הטהורים והרכיבים עצמם נבדקים.
  evidence: ביקורת 5.5 (2026-10-06). רכיבי שרת שדורשים RSC harness; פעולת הפרסום כבר בודקת את הסכמה בשרת.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-9-work-tab-dishes-tasks-prep-days.md`
  target: 4.13
  summary: אין בדיקה אוטומטית ל-redirect של `/admin/sessions/[id]/day` אל `/work`, לקישור "ללשונית העבודה" בעמוד המפגש וללשונית `/admin/work` (עד שלושה בראנצ׳ים, קישור לכל דף).
  evidence: ביקורת 4.9 (2026-10-06, ‏verification-gap). מסכים דקים בלי לוגיקה משלהם; הבדיקה בטלפון מכסה אותם.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-9-work-tab-dishes-tasks-prep-days.md`
  target: 3.17
  summary: `work_sheets.event_id` הוא `on delete cascade`, ולכן מחיקת מפגש מוחקת את דף העבודה, המנות, המשימות ופריטי הקניות (`shopping_items`, ‏4.10, גם הם `on delete cascade` מ-`work_sheets`) בלי שורת יומן. ‏3.17 (מחיקת מפגש בלי הרשמות) רושם ביומן גם את נתוני דף העבודה שנמחקים, או לפחות את מספרם.
  evidence: ביקורת 4.9 (2026-10-06, ‏blind-hunter). ה-cascade נבחר ב-spec של 4.9 כדי ש-3.17 יוכל למחוק מפגש.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-business-settings-and-templates.md`
  summary: כל סיפור שמוסיף קורא ל-`enqueue_notification` (5.17 reminder, 5.6 waitlist_spot, 3.8 event_cancelled/event_changed, 3.13 entitlement_changed, 5.10 card_expiring/admin_card_expiring) מעביר את כל `allowed_vars` של הסוג, ומוסיף בדיקת מסד שעורכת את התבנית לכל השדות המותרים ומריצה את הזרימה האמיתית.
  evidence: ביקורת 4.7, ממצא 9 (medium, לא אומת). ‏`allowed_vars` של 9 הסוגים בלי קורא נקבע מראש. קורא שמעביר פחות שדות ייכשל ב-render בתוך העסקה ויבטל אותה.
  status: ‏reminder בוצע ב-5.17 (‏`allowed_vars` = ‏`date`, ‏`time`, ‏`concept`, ובדיקת "כל השדות" ב-`session-reminders.test.ts`).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-push-pipeline-and-permission.md`
  target: 4.6
  summary: ‏`admin_anonymize_customer` (הסרת פרטים) מוחק גם את המנויים של הלקוחה ב-`push_subscriptions` (ואיתם `notification_deliveries`, ב-cascade), באותה עסקה. מחיקת המשתמשת ב-Auth כבר מוחקת אותם (`on delete cascade`).
  evidence: ‏spec 5.8 (Always, ‏`push_subscriptions`): ההרחבה של הסרת הפרטים נשארת ל-4.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-push-pipeline-and-permission.md`
  target: סבב העיצוב
  summary: הגדרות ההתראות בפרופיל (שורה עם קישור לכרטיס הפוש) והצעת הפוש אחרי הרשמה ראשונה מוצלחת ("המקום שלך שמור", EXPERIENCE). ב-5.8 הכרטיס במרכזי ההתראות של `/me` ו-`/admin` הוא המקום היחיד.
  evidence: החלטת המשתמשת 2026-10-06 באישור spec 5.8 (החלטה 2).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-push-pipeline-and-permission.md`
  target: 5.10
  summary: צנרת פוש שלא עובדת (ערכי Vault חסרים או שגויים, ‏`CRON_SECRET` שלא תואם, ‏`app_url` שגוי) לא מופיעה ב"לטיפול": המשימות לא נלקחות, ואחרי 24 שעות נסגרות `skipped`, והענף `push_failed` סופר רק `failed`.
  evidence: ביקורת 5.8 (blind-hunter). ‏AD-22 מונה ב"לטיפול" ערכי Vault חסרים ו-`private.job_*` שנכשל או לא הצליח בזמן; אפשר לגזור גם `queued` ותיקות או `net._http_response` עם 401/5xx.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-push-pipeline-and-permission.md`
  target: לפני ההדגמה (בדיקה בלבד)
  summary: בדיקת פוש באייפון עם האפליקציה מותקנת במסך הבית (iOS 16.4 ומעלה), כלקוחה וכאדמין: הפעלה מהכרטיס במרכז ההתראות, פוש תוך דקה כשהאפליקציה סגורה, ולחיצה שפותחת את `target_path`. אם משהו נכשל, תיקון ב-PR קצר.
  evidence: ב-2026-10-06 נבדק רק Android (לקוחה ואדמין); לא היה אייפון זמין (החלטת המשתמשת). באייפון פוש עובד רק מהאפליקציה המותקנת.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-17-session-reminder-24h.md`
  target: 5.18
  summary: לקוחות בדויות של נתוני ההדגמה נוצרות בלי `push_subscriptions`. כך התזכורות שלהן (‏`job_reminders`) נשמרות רק במרכז ההתראות, ומשימת הפוש נסגרת `skipped`. אין צורך בקוד.
  evidence: ‏spec 5.17 (Always, נתוני הדגמה): פוש נשלח רק למנוי שנרשם לאותה לקוחה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-17-session-reminder-24h.md`
  target: 4.6
  summary: הסרת פרטים (`admin_anonymize_customer`) מבטלת את ההרשמות העתידיות של הלקוחה, או ש-`private.job_reminders` מדלג על פרופיל עם `anonymized_at`; אחרת לקוחה שפרטיה הוסרו תקבל תזכורת חדשה אחרי הניקוי.
  evidence: ביקורת 5.17 (edge-case-hunter). ‏`job_reminders` בודק רק `customer_id is not null`; ‏`profiles.anonymized_at` קיים, אבל אין עדיין זרימה שקובעת אותו.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-two-photo-consents.md`
  target: 4.6
  summary: הסרת פרטים (`admin_anonymize_customer`) מאפסת את שתי ההסכמות לתמונות, גם את `personal_photo_consent`, ‏`_at` ו-`_text_version` שנוספו ב-2.13, ולא רק את `photo_consent*`.
  evidence: ביקורת 2.13 (blind-hunter). עוד אין פונקציית הסרה. בלי זה, לקוחה שפרטיה הוסרו נשארת "אישרה תמונות אישיות".
