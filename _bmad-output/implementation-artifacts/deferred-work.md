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
  target: 3.2
  summary: העמודים `/sessions` ו-`/sessions/[id]`, הפריט "הבראנצ׳ים" ב-`publicNav` (אחרי "בית"), אזור המפגשים בבית (בין `home/intro` ל-`gallery/testimonials`, ‏`sort_order` 3–4 פנויים) ומחיר התצוגה בעמוד המפגש.
  evidence: 5.2 בנה רק את החלק הסטטי. כפתור ההירו מופיע מעצמו כש-`/sessions` נכנס ל-`publicNav` (`hasPublicSessions`).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.7
  summary: לקוחה מחוברת רואה "האזור שלי" במקום "כניסה לאזור האישי" בסרגל העליון ובתפריט, ו-`whatsapp-bar` לא מוצג לה. צריך לקרוא את ה-session בלי לשבור את המטמון של העמודים הציבוריים (רכיב דינמי בתוך `Suspense`, לא `'use cache'` עם cookies).
  evidence: ‏EXPERIENCE › `top-bar` ו-`whatsapp-bar`. היום המעטפת הציבורית סטטית לגמרי ולא יודעת מי מחוברת.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.4
  summary: הסתרת `whatsapp-bar` (‏`inert` ו-`visibility: hidden`) כל עוד כפתור ההירו גלוי, והופעה כשהוא יוצא מהמסך.
  evidence: ‏EXPERIENCE › `whatsapp-bar`. כפתור ההירו לא מוצג עד 3.2, ולכן היום הפס גלוי תמיד (כמו בעמוד בלי כפתור הירו). אם 3.2 נבנה אחרי 5.4, הסיפור שמוסיף את הכפתור לוקח את זה.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: עורך לסקשנים החדשים (`text_block`, ‏`steps`, ‏`faq`, ‏`testimonials`, ‏`footer`) והעמודים `about`, ‏`how-it-works`, ‏`gallery`, ‏`site`, כולל תצוגה מקדימה. היום התוכן שלהם מוזן רק כשורות בדויות במסד הפיתוח. ב-`publishTags` כבר יש `site` ← `content:global`.
  evidence: ‏`EDITABLE_PAGES` ב-`content-items.ts` כולל רק `home` (הירו) ו-`contact` (פרטי העסק).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.4
  summary: תמונות באודות, בגלריה ובהמלצות (המלצה כתמונה), וצילום בהירו.
  evidence: 5.2 מציג המלצות טקסט בלבד, לפי ה-spec.

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

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 3.2
  summary: בבית, אחרי הפתיח: "הבראנצ׳ים הקרובים" עם 2–3 המפגשים הקרובים (תאריך, קונספט ותמונת אוכל), מהטבלאות של 3.1 ומרכיב כרטיס המפגש המשותף.
  evidence: בקשת המשתמשת 2026-10-04. מסמך המקור: "מפגשים קרובים" בבית.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: ‏`body` של `text_block` אופציונלי בשביל `home/contact`, אבל אותה סכמה משמשת את `home/intro`, ‏`about/main` ו-`contact/intro`. בעורך של 5.3 צריך לחייב טקסט בסקשנים האלה (חובה לכל סקשן, לא לכל kind).
  evidence: ביקורת התיקונים של 5.2 (2026-10-04).

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-public-pages-static.md`
  target: 5.3
  summary: הוראות התשלום כבר לא מוצגות באתר הציבורי (החלטת המשתמשת 2026-10-04), אבל השדה עדיין נערך בפרטי העסק. צריך להחליט איפה הן מוצגות (למשל אחרי הצטרפות או באזור האישי), או להסתיר את השדה.
  evidence: ‏`FIELDS` ב-`app/admin/(shell)/content/contact/page.tsx` עדיין כולל את `payment_instructions`.
