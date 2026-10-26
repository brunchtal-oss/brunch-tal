# Epic 2 Context: E2 חשבונות וכסף: מאישור תשלום ללקוחה מחוברת

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

שכבת החשבונות והכסף: מוצרים, אמצעי תשלום, תשלומים, זכויות ויומן תנועות, הצטרפות בקישור חד-פעמי, חשבון קיים והתנגשויות, פרופיל ותינוקות, שתי הסכמות לצילום, ליבת ההתראות, ואיפוס ושינוי מייל וטלפון דרך טל עם הגבלת קצב. טל מאשרת תשלום בטלפון, מעתיקה קישור, והלקוחה מצטרפת ומגיעה מחוברת ל-`/me` עם היתרה והתפוגה הנכונות, בלי כפילויות ובלי לאבד תשלום. כל סיפורי האפיק ממוזגים חוץ מ-2.14 (נוסף 2026-10-26, החלטת המשתמשת): "ביטול הרכישה", הפעולה הראשונה שקובעת `payments.status = voided`. בטעות ברישום תשלום טל מבטלת את הרכישה כולה (תשלום, זכות, קישור שלא מומש והרשמות עתידיות) בפעולה רגישה אחת וסופית, והתשלום יוצא מסכום החודש.

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
- Story 2.10: Customer profile, babies and photo consent
- Story 2.13: Two photo consents and two-step join form
- Story 2.14: Purchase void

## Requirements & Constraints

- **תשלום וזכויות:** רק אישור של טל יוצר תשלום וזכות. retry או לחיצה כפולה לא מכפילים תשלום, זכות, טוקן, חשבון או ביטול. כרטיסייה תקפה עד סוף היום המקומי, 49 ימים מתאריך הרכישה.
- **ביטול רכישה (2.14), בעסקה אחת:** התשלום `voided`, הזכות `revoked`, קישור הצטרפות שלא מומש מבוטל, הרשמות עתידיות שמומנו מהרכישה מתבטלות בלי זיכוי ובלי החזרת כניסה (המקום מתפנה ורשימת ההמתנה מקבלת הודעה כרגיל), ויומן עם סיבה. נחסם כשכניסה כבר נוצלה (הרשמה מהרכישה למפגש שכבר התחיל) או כשכבר קיימים זיכוי או החזר לרכישה. אין שחזור; בטעות טל רושמת תשלום חדש. עובד גם על רכישה שלא שויכה.
- **תשלום מבוטל:** יוצא מסכום החודש בבית האדמין (הסכום נסכם רק מ-`approved`) ומכל ייצוא או סיכום כספי. מוצג בהיסטוריה בכרטיס הלקוחה עם התגית "בוטל".
- **פריטים פתוחים שנכנסים ל-2.14:** `private.bind_purchase` ו-`token_view` בודקים מצב תשלום וזכות, כך שקישור פתוח לרכישה שבוטלה לא משייך ולא מתריע; `get_my_entitlements` מחזיר את מצב התשלום, ונקבע איך זכות וסכום מבוטלים מוצגים ללקוחה. רכישה שהוחזרה (3.9) נשארת ניתנת לשיוך בכוונה.
- **ללקוחה (המלצה לשלב ה-spec):** הודעה ניטרלית עם "צרי קשר" רק אם הפעילה את החשבון.
- לקוחה לא משנה role, תשלום, יתרה, תוקף או הסכמה, ולא קוראת נתונים של אחרת. `grants.test.ts` וה-advisor נקיים.

## Technical Decisions

- **RPC:** definer עם `set search_path = ''`, בדיקת אדמין בשורה הראשונה, `private.idempotent_begin` מיד אחריה, revoke מכולם ו-grant אחד ל-`authenticated`. שינוי חתימה הוא `drop` ואז `create` באותה migration. שגיאה עסקית ב-`P0001` עם קוד יציב, וההודעה בעברית רק ב-`lib/errors.ts`.
- **פעולה רגישה:** `private.plan_<name>` אחת מחשבת גם את מה שמוצג בחלון (כאן: ההרשמות שיבוטלו והחסימות) וגם את מה שמתבצע. `preview_<name>` היא בדיקת הרשאה ואז ה-plan; הפעולה דורשת `p_confirmed` וזורקת `CONFIRM_REQUIRED`. המפתח והשאלה נרשמים ב-`lib/admin/sensitive-actions.ts`. ה-preview נדחה ללקוחה ב-`NOT_AUTHORIZED`.
- **סדר נעילה:** `activation_tokens` ← `profiles` ← `events` ← `bookings` ← `entitlements` ← `cancellation_credits` ← `credit_options` ← `payments` ← `refund_requests` ← `waitlist_entries` ← `notification_jobs`, ובתוך טבלה לפי `id`. כל הנעילות בתחילת ה-RPC. לא נועלים ילד כדי לגלות הורה: קוראים בלי נעילה, נועלים, בודקים שוב (`CONCURRENT_CHANGE`). ברכישה משויכת נועלים את `profiles` של הלקוחה.
- **סטטוסים:** `payments.status` approved, voided; `entitlements.status` active, revoked, refunded; `activation_tokens.state` כולל `revoked` (`expired` נגזר). ב-AD-10 ובטבלת הסטטוסים כתוב שאין פעולה שקובעת `voided`; 2.14 משנה זאת.
- **יתרה ותפוסה נגזרות:** יתרה רק מ-`entitlement_balances`; `entitlement_movements` append-only (שחרור הוא `release`, ובביטול רכישה לא מחזירים כניסה). ספירת מקומות רק ב-`private.occupied_places`. כל RPC שמשחרר מקום קורא ל-`private.notify_waitlist(event_id)` באותה עסקה.
- **ביטול הרשמה רגיל לא מתאים כמו שהוא:** `admin_cancel_booking`/`private.cancel_core` יוצרים זיכוי או `release` (AD-20). ביטול רכישה צריך ענף בלי זיכוי ובלי שחרור.
- **הרשמה בלי לקוחה:** הרשמה מוצמדת לרכישה שלא שויכה היא `bookings` עם `customer_id = null` ו-`payment_id`. `enqueue_notification` ו-`notify_waitlist` מדלגים על נמענת ריקה.
- **התראות:** רק `private.enqueue_notification` באותה עסקה, עם `dedupe_key = type:recipient_id:discriminator`; סוג חדש נכנס ל-check, לתבניות ולשמות ב-copy.
- **יומן:** `private.audit` עם המבצעת כפרמטר, `before`/`after` רק דרך `private.audit_diff`, עם `customer_id` ו-`event_id`. פעולה חדשה מקבלת שם, כלל תצוגה ומשפט תוצאה ב-`lib/copy/audit-actions.ts`.
- **"לטיפול":** `admin_get_attention_items()` הוא המקור היחיד, נגזר ממצבים שמורים. `purchase_without_link` נגזר מתשלום `approved` בלי קישור חי; לבדוק שגם שאר הפריטים (למשל `paid_without_place`) לא מציגים רכישה מבוטלת.
- **זהות והרשאות:** הקוראת רק מ-`private.current_customer_id()`, אדמין רק מ-`private.is_admin()`. בלי service role לפעולה הזו (אין שלב Auth).

## UX & Interaction Patterns

- כל מסך נבנה אחרי הפעלת הסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- "ביטול הרכישה" יושב בדף הרכישה באדמין (`customers/[id]/entitlements/[entitlementId]`, ו-`customers/unbound/entitlements/<id>` לרכישה שלא שויכה), ליד התיקונים של 3.13. השורה ב-`/admin/payments` לחיצה ומובילה לדף הרכישה, בלי כפתור נפרד.
- חלון האישור הוא `sensitive-confirm-dialog`: כותרת בצורת שאלה, תיבת השפעה שמפרטת את ההרשמות שיבוטלו, צ׳קבוקס "אני מאשרת ש…" חובה, "סיבה (לא חובה)". הכפתור ההרסני רק בתוך החלון.
- כפתור שמשנה נתונים משתמש ב-`OnlineButton`/`useOnlineGuard`. מפתח idempotency נוצר בטעינת הטופס.
- אין "טל" בנוסח ללקוחה: "צרי קשר" (וואטסאפ מפרטי העסק). בהיסטוריה לא כותבים "ישן ← חדש", אלא "היה {ישן}, עכשיו {חדש}".

## Cross-Story Dependencies

- 2.14 בא אחרי 2.2, 3.9 (החזרים), 3.13 (דף הרכישה ותיקונים בזכות) ו-5.6 (רשימת המתנה). 6.1 אחריו. סבב 9, במקביל לשתי התוספות של המשתמשת ולתיקון ה-seed; `test:db` ומיגרציות בתיאום עם לשונית הסרטון.
- נוגע בפונקציות של סיפורים אחרים: `private.bind_purchase` ו-`token_view` (2.2–2.4), `get_my_entitlements` (4.12), `admin_get_customer` ו-`admin_get_entitlement` (4.2, 3.13), `admin_get_attention_items` (4.1 ושישה מרחיבים). הגדרה מחדש נבנית מה-`prosrc` החי ועוד התוספת. `bind-purchase.test.ts` ו-`grants.test.ts` מתעדכנים.
- בוטלו: 2.7 (ארבעת אמצעי התשלום מה-seed), 2.9 (העבר ל-6.2, שגם הוא בוטל), 2.11 (הניקוי ב-5.20).
