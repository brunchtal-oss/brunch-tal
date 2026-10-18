# Epic 3 Context: E3 מפגשים והרשמה: מהרשמה אטומית עד ביטול, זיכוי והחזר

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

לבנות את ליבת המפגשים וההרשמות: קונספטים ומפגשים, הרשמה עצמית אטומית (בודדת ומרובה), סגירת הרשמה ורישום ידני, מוצר מוצמד (בודד, היכרות, זוגי) שנרשם באישור התשלום, הרשמה זוגית והיכרות, ביטול עצמי וביטול דרך טל, זיכוי לחלופות, בקשת החזר והשלמתה, ביטול או שינוי מפגש מצד העסק, הזזה, מחיקת מפגש בלי הרשמות, מוצרים תקפים למפגש, סיום מפגש וניצול, תיקונים בזכות וכלל ההארכה בשבוע ריק. בסוף האפיק לקוחה עם כרטיסייה נרשמת בטלפון, רואה את היתרה יורדת, מבטלת 48 שעות או יותר מראש והכניסה חוזרת לאותה כרטיסייה; שתי לקוחות על המקום האחרון מקבלות אישור אחד; וטל מבטלת מפגש ורואה זיכויים והחזרים נכונים. ה-RPC כאן הם אותם RPC שה-UI של E4 משתמש בהם.

## Stories

- Story 3.1: Concepts and session management (בוצע)
- Story 3.2: Self-booking tracer with a card (בוצע)
- Story 3.3: Multi-date booking and registration close (בוצע)
- Story 3.4: Session details and manual booking (בוצע)
- Story 3.11: Pinned product approval and placement (בוצע)
- Story 3.5: Couple and intro bookings (בוצע)
- Story 3.6: Self-cancel within 48 hours and admin cancel (בוצע)
- Story 3.7: Cancellation credits, alternatives and refund requests (בוצע)
- Story 3.8: Business cancels or changes a session (בוצע)
- Story 3.9: Refund completion (בוצע)
- Story 3.10: Move a booking
- Story 3.16: Admin credit adjustments
- Story 3.12: Session completion job (בוצע)
- Story 3.17: Delete a session
- Story 3.18: Eligible products per session
- Story 3.13: Entitlement corrections
- Story 3.14: Auto-extend rule for empty weeks
- Story 3.19: Manual booking improvements

(3.15 בוטל: נכנס לניקוי המאוחד 5.20, החלטת המשתמשת 2026-10-10.)

## Requirements & Constraints

- **סדר העבודה (החלטת המשתמשת 2026-10-10):** סבבים של שלושה סיפורים במקביל, כל אחד ב-worktree ו-branch משלו. סבב 4: ‏3.10, ‏3.13, ‏3.17 ואחריו 3.19; סבב 5: ‏3.16, ‏3.14; סבב 6: ‏3.18. האתר בפרודקשן פתוח (noindex) מול מסד הפיתוח, נתונים בדויים בלבד; מיגרציה מוחלת על המסד החי מיד.
- **הרשמה עצמית:** השרת בודק פרסום, הרשמה פתוחה, אין הרשמה כפולה, מספיק מקומות וזכות תקפה ביום המפגש; רק אז נשמרת ההרשמה ומשוריינת הזכות, באותה עסקה. כשל לא תופס מקום ולא גורע כניסה. מוצר מוצמד לא נרשם עצמית.
- **כרטיסייה בכל יום (2026-10-04):** מוגבלת רק לסוג המפגש. ‏`allowed_weekdays` נשאר למוצר שטל בוחרת להגביל (בטופס המוצר מוסתר מאחורי "הגבלה לימים מסוימים").
- **סוג המפגש תמיד לפי `default_kind` של הקונספט.** רגיל: אמהות בחל״ד, יווני. זוגי: זוגות, עם סבתוש, עם סבוש.
- **מוצרים תקפים למפגש (3.18):** `event_products`; עד 3.18 המימון לפי תכונות המוצר בלבד. הבדיקה רק על הרשמות חדשות; מחיר המוצר מוצג כברירת מחדל כשאין `display_price_agorot`. מפגש בלי מוצר מסומן ומחיר כשיש כמה: נקבע ב-spec עם המשתמשת.
- **תפוסה:** ללקוחה רק "יש מקום" / "מקומות אחרונים" / "מלא", לפי גודל ההרשמה, אף פעם לא מספר. תינוקות לא נספרים.
- **סגירת הרשמה:** ברירת מחדל 20:00 ביום שלפני (Asia/Jerusalem), לפי זמן השרת. טל רושמת בכל זמן עם אותן בדיקות מימון ומכסה; אין חריגה שקטה מהמכסה.
- **מפגשים:** נוצרים מקונספט (אין `title` ואין תפריט). טיוטה לא מוחזרת ללקוחה. מחיקה (3.17) רק למפגש בלי אף שורה ב-`bookings` (גם לא מבוטלת או ממתינה להצטרפות); אחרת מבטלים (3.8).
- **זוגי והיכרות:** מפגש זוגי מקבל רק הרשמה זוגית (2 מקומות) בזכות או זיכוי זוגיים. **אין קיזוז זוגי (2026-10-10):** כרטיסייה לא מממנת זוגי, גם לא בידי טל; `admin_offset_paired` לא נבנה. היכרות: רק למי שלא השתתפה ואין לה הרשמה אמיתית (גם עתידית) או היכרות פעילה; ביטול לפני המפגש לא נחשב, אי-הגעה נחשבת. "השתתפה" נגזרת רק ממפגשים שהסתיימו.
- **ביטול:** חלון 48 שעות כולל בדיוק 48, נבדק בשרת. כרטיסייה ← הכניסה חוזרת לאותה כרטיסייה בלי הארכה. מוצמד (בודדת/היכרות/זוגית) תמיד הופך לזיכוי, אף פעם לא לזכות: ביטול עצמי בזמן ← בחירה בין החזר לזיכוי; טל בתוך החלון ← זיכוי; טל בזמן ← טל בוחרת; ביטול מצד העסק ← `choice_pending` בלי מועד אחרון. זכויות "חוזרות" ישנות מ-3.6 מתבטלות כמו כרטיסייה.
- **זיכוי:** הרשמה אחת לאחת מ-N החלופות המתאימות הבאות (N נשמר ביצירה), מאותו סוג, נספרות מתאריך המפגש שבוטל. מלאה או מבוטלת מוחלפת בבאה; חלופה שההרשמה אליה נסגרה בלי שימוש נחשבת "עברה". הזיכוי מממן גם הרשמה מחדש לאותו מפגש שבוטל, כל עוד פתוח ויש מקום, בלי להיספר בחלופות (2026-10-10). כל החלופות עברו ← כרטיס שקט עם "צרי קשר"; טל מאריכה או משנה חלופות ב-3.16.
- **החזר:** בחירה בהחזר יוצרת בקשה; "הוחזר" רק אחרי שטל מאשרת תאריך, סכום ואסמכתה (3.9). סך ההחזרים לא עולה על מה ששולם. `admin_complete_refund` משלים רק בקשה קיימת.
- **תיקונים בזכות (3.13):** תוקף, יתרה (קישור אופציונלי למפגש המקורי), ימי מימוש או סוג מפגש, כפעולה רגישה נפרדת לכל תיקון; הרשמות עתידיות שלא מתאימות מוצגות באזהרה ולא משתנות; היתרה לא יורדת מתחת לאפס. בנוסף 3.13 מחליט איך לסגור רכישה מוצמדת ששולמה בלי מקום (park) במפגש שהעסק ביטל: אין לה בקשת החזר, ופריט `paid_without_place` עם `event_status = cancelled` נשאר ב"לטיפול" עד אז (החלטת המשתמשת 2026-10-13).
- **הזזה (3.10):** ביטול והרשמה חדשה בפעולה אחת; כשל משאיר את המקור בדיוק כפי שהיה. מוצמד ← רק לחלופות הזיכוי; כרטיסייה ← בתוך התוקף כולל הארכות.
- **הארכה אוטומטית (3.14):** +7 ימים לכל שבוע מקומי (ראשון–שבת) שחופף לתוקף ואין בו מפגש מתאים שפורסם (זוגי לא נחשב לכרטיסייה רגילה; שבוטל לא נספר; מלא כן). פעם אחת לשבוע.
- **רישום ידני (3.19):** מוצגים רק מפגשים שאפשר לממן מהזכויות של הלקוחה (`plan_funding` במצב `admin`).
- כל שדה סיבה לא חובה; כל פעולה נרשמת ביומן.
- **Known conflicts:** המקור אומר "אין הארכה אוטומטית", סופר חלופות "אחרי מועד הביטול", לא מחשיב את המפגש שבוטל כחלופה, מגביל כרטיסייה לשני וחמישי, מתיר קיזוז זוגי ומחייב להציג את מועד הביטול האחרון; כולם הוחלפו בהחלטות שנרשמו ב-memlog של ה-SPEC.

## Technical Decisions

- **סדר נעילה:** `activation_tokens` ← `profiles` ← `events` ← `bookings` ← `entitlements` ← `cancellation_credits` ← `credit_options` ← `payments` ← `refund_requests` ← `waitlist_entries` ← `notification_jobs`, ובתוך טבלה לפי `id`. `profiles` הוא ה-mutex של הלקוחה. RPC מורכב נועל הכול בתחילתו. לא נועלים ילד כדי לגלות הורה (קריאה, נעילת הורה, נעילת ילד ובדיקה שוב, אחרת `CONCURRENT_CHANGE`). הזזה נועלת פרופיל ואז את שני המפגשים לפי מזהה.
- **ספירת מקומות:** רק `private.occupied_places` סוכמת `party_size` של הרשמות אמיתיות (`private.is_real_booking`: `confirmed`/`completed`); אין מונה שמור.
- **מימון:** `private.plan_funding(p_customer_id, p_event_id, p_party_size, p_mode)` (`self`/`admin`/`move`/`online`) הוא הקוד היחיד שבוחר מימון: קודם זיכוי `active` שהמפגש חלופה פעילה שלו (או המפגש שלו עצמו), אחר כך זכות מתאימה ותקפה ביום המפגש, לפי `expires_on` ואז `id`. `booking_allocations` עם בדיוק אחד מ-`entitlement_id`/`credit_id`. ‏3.10 ו-3.18 משנים אותה, בסבבים שונים.
- **RPC קיימים:** `book_session`, `book_sessions`, `admin_book_customer`, `cancel_booking` (`p_choice`), `admin_cancel_booking`, `admin_cancel_event`/`admin_reschedule_event` (+ `preview_*`), `choose_credit_outcome`, `admin_complete_refund`, `admin_list_refund_requests`, `admin_list_customer_credits`, `get_my_credits`. פעולות עוברות ב-`private.book_core`/`private.cancel_core`; `move_booking` ישתמש בשתיהן. מספרים לאדמין רק דרך `admin_*`.
- **חוזה RPC:** definer, `search_path = ''`, הרשאה בשורה הראשונה, `revoke` מכולם ו-`grant` אחד, `p_idempotency_key` (`private.idempotent_begin` לפני כל נעילה). שגיאות כקוד ב-`P0001`, וקוד חדש ב-`lib/errors.ts` באותו commit.
- **זמן:** מועדים ב-SQL רק בעזרי `private` הטהורים. `private.can_self_cancel(booking_id)` היא בדיקת הגבול היחידה, גם בהזזה. `bookings.policy_snapshot` נשמר ביצירה ומועתק בהזזה.
- **יומן תנועות:** `reserve` שלילי, `release` חיובי בביטול כרטיסייה, `use` = 0 בסיום מפגש, `adjust` ≠ 0 בתיקון. היתרה רק ב-view `entitlement_balances`, לא מתחת לאפס. בכניסה מוצמדת אין `release`: הערך עובר לזיכוי.
- **זיכויים והחזרים:** `cancellation_credits.status` ב-(`active`, `used`, `refund_requested`, `refunded`) ודגל `choice_pending`; `origin_starts_at`, `options_count` ו-`monetary_basis_agorot` נקבעים ביצירה. `credit_options.state` ב-(`active`, `used`, `passed`, `replaced`) עם `replaced_reason` (`full`, `event_cancelled`, `booked`). `private.refresh_credit_options` נקראת מהרשמה, ביטול, מכסה ותצוגה. `refund_requests` (`requested`, `completed`).
- **תיקונים והארכה:** טבלת `entitlement_corrections` (חדשה ב-3.13): ‏entitlement_id, ‏field (`expires_on`, `allowed_weekdays`, `eligible_event_kind`), old/new, reason אופציונלי, `affected_booking_ids` (מוצגות ולא משתנות), actor; תיקון יתרה נשמר כתנועת `adjust`. ההארכה (3.14) נרשמת שם עם actor מערכת ו-`week_start` ייחודי לזכות; התזמון ב-5.10.
- **מוצמד בלי לקוחה (AD-23):** הרשמה `confirmed` עם `customer_id = null` נספרת במכסה; משימות והתראות מדלגות על `null`. טבלה חדשה עם `customer_id` מרחיבה את `private.bind_purchase` ואת `bind-purchase.test.ts` (לוקחים את הגוף החי האחרון).
- **פעולה רגישה:** `private.plan_<name>` אחת ל-`preview_<name>` ולביצוע, `p_confirmed` ו-`CONFIRM_REQUIRED`; לקוחה שקוראת ל-`preview_admin_*` מקבלת `NOT_AUTHORIZED`; רישום ב-`lib/admin/sensitive-actions.ts`.
- **התראות:** רק `private.enqueue_notification` באותה עסקה, וכל קורא מעביר את כל `allowed_vars` של הסוג (ובדיקת מסד שעורכת את התבנית לכל השדות). `entitlement_changed` כבר ב-check של הסוגים; ה-discriminator שלו הוא `entitlement_corrections.id`. סוג חדש ב-check הוא `drop constraint`, ולכן מיגרציה נפרדת שהמשתמשת מריצה ב-SQL Editor.
- **משימות:** pg_cron פעיל; `private.job_complete_events` כל 5 דקות, בטוחה להרצה כפולה.
- **מחיקת מפגש:** `bookings.event_id` ‏`on delete restrict`; `work_sheets` ונגזרותיו נמחקים ב-cascade, ו-3.17 רושם ביומן גם את נתוני דף העבודה.
- **מטמון:** `/me` ו-`/admin` דינמיים עם `Cache-Control: private, no-store`.

## UX & Interaction Patterns

- כל מסך או רכיב מתחיל בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md.
- **נוסח בלי טל:** קופי ללקוחה לא מזכיר את טל; כפתור הפנייה "צרי קשר". מועד הביטול האחרון לא מוצג ללקוחה.
- **`inline-notice`:** תוצאה תמיד בו, בלי אישור אופטימי; כפתור busy עד תשובה; מפתח idempotency בפתיחת הגיליון. חסימה: סיבה ומה אפשר לעשות, והכפתור מוחלף בפעולה החלופית.
- **ביטול:** כרטיסייה בלי בחירה; מוצמד: `radio-card` זיכוי או החזר. ביטול מצד העסק: כרטיס "בחירה ממתינה" בראש `/me`. ‏`/me/bookings` מציג זיכויים עם חלופות ובקשות החזר. בהיסטוריה "ביטלת"; צ׳יפים "בוטל" / "התקיים".
- **אדמין:** פעולות רגישות ב-`sensitive-confirm-dialog`; שינוי ערכים ב-`value-change-row` (ישן ← חדש); שינוי מועד עם תצוגת השפעה.

## Cross-Story Dependencies

- **תלויות:** ‏3.10 אחרי 3.9, ‏3.16 אחרי 3.10. ‏3.17 אחרי 3.4, ‏3.7 ו-4.10; ‏3.19 אחרי 3.4 ו-3.5. ‏3.18 אחרי 3.10 ו-3.5. ‏3.13 אחרי 3.12, ‏3.14 אחרי 3.13. ל-E5: ‏5.6 אחרי 3.10 ו-3.5 (מוסיף `notify_waitlist` בכל פונקציה שמשחררת מקום); ‏5.10 מתזמן את ההארכה ואת `credit_expiring`.
- **"לטיפול" (`admin_get_attention_items`):** מורחבת ב-3.7, ‏3.8, ‏2.8, ‏3.13 (הרשמות שנפגעו מתיקון), ‏4.6 ו-5.10, כל אחד בסבב אחר. לוקחים את הגוף החי האחרון.
- **התנגשויות:** ‏3.14 ו-3.16 שולחים שניהם `entitlement_changed`. ‏3.10 ו-3.18 משנים את `plan_funding`; ‏5.6 מגדיר מחדש את פונקציות ההרשמה, ומי שממזג שני מריץ את כל בדיקות ההרשמה. אחרי כל מיגרציה יוצרים מחדש את `database.types.ts`.
- רכיבים לשימוש חוזר: `components/admin/sensitive-confirm-dialog.tsx`, `components/admin/value-change-row.tsx`, `components/shared/session-card.tsx`, `components/shared/concept-header.tsx`, `components/shared/inline-notice.tsx`.
