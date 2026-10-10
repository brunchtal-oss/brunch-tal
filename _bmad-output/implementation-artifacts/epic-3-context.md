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
- Story 3.5: Couple and intro bookings
- Story 3.6: Self-cancel within 48 hours and admin cancel (בוצע)
- Story 3.7: Cancellation credits, alternatives and refund requests
- Story 3.8: Business cancels or changes a session
- Story 3.9: Refund completion
- Story 3.10: Move a booking
- Story 3.16: Admin credit adjustments
- Story 3.12: Session completion job (בוצע)
- Story 3.17: Delete a session
- Story 3.18: Eligible products per session
- Story 3.13: Entitlement corrections
- Story 3.14: Auto-extend rule for empty weeks

(3.15 בוטל: נכנס לניקוי המאוחד 5.20, החלטת המשתמשת 2026-10-10.)

## Requirements & Constraints

- **סדר העבודה (החלטת המשתמשת 2026-10-10, מחליף את היקף ההדגמה):** בונים את כל מה שנשאר, בסבבים של שלושה סיפורים במקביל, כל אחד ב-worktree ו-branch משלו: סבב 1 ‏3.7; סבב 2 ‏3.8 ו-3.5; סבב 3 ‏3.9; סבב 4 ‏3.10, ‏3.13, ‏3.17; סבב 5 ‏3.16, ‏3.14; סבב 6 ‏3.18. ביום שני 2026-10-12 (מבקרים בפרודקשן מול מסד הפיתוח) לא ממזגים ל-main. מיגרציה שמשנה פונקציה קיימת שהמבקרים מפעילים (הרשמה, ביטול, מימון, שיוך; למשל 3.7) מוחלת רק מיום שלישי; מיגרציה שרק מוסיפה טבלה או פונקציה מותרת. נתונים בדויים בלבד, האתר נעול.
- **הרשמה עצמית:** לקוחה מחוברת עם זכות או זיכוי מתאימים ותקפים ביום המפגש נרשמת למפגש `published` ופתוח. השרת בודק פרסום, הרשמה פתוחה, אין הרשמה כפולה, מספיק מקומות וזכות תקפה; רק אז נשמרת ההרשמה ומשוריינת הזכות, באותה עסקה. כשל לא תופס מקום ולא גורע כניסה. מוצר מוצמד לא נרשם עצמית.
- **כרטיסייה בכל יום (2026-10-04, גובר על "שני וחמישי"):** כרטיסייה מוגבלת רק לסוג המפגש. השדה `allowed_weekdays` נשאר למוצר שטל בוחרת להגביל.
- **סוג המפגש תמיד לפי `default_kind` של הקונספט (2026-10-05):** טל לא משנה אותו. רגיל: אמהות בחל״ד, יווני. זוגי: זוגות, עם סבתוש, עם סבוש.
- **מוצרים תקפים למפגש (3.18, 2026-10-10):** `event_products` חוזר ומבטל את הדחייה מ-2026-10-04. עד 3.18 המימון לפי תכונות המוצר בלבד. הבדיקה חלה רק על הרשמות חדשות; מחיר המוצר מוצג כברירת מחדל כשאין `display_price_agorot`. מה פירוש מפגש בלי מוצר מסומן, ואיזה מחיר כשיש כמה, נקבע ב-spec עם המשתמשת.
- **תפוסה:** ללקוחה רק "יש מקום" / "מקומות אחרונים" (סף מההגדרות) / "מלא", לפי גודל ההרשמה (זוגי עם מקום אחד = "מלא"), אף פעם לא מספר. לאורחת אין נתון תפוסה. תינוקות לא נספרים.
- **סגירת הרשמה:** ברירת מחדל 20:00 ביום שלפני (Asia/Jerusalem), לפי זמן השרת גם סביב שעון קיץ; ניתנת לשינוי בהגדרות ולמפגש. טל רושמת בכל זמן עם אותן בדיקות מימון ומכסה. אין חריגה שקטה מהמכסה: מעלים קודם את המכסה.
- **מפגשים:** נוצרים מקונספט (כותרת = שם הקונספט, אין שדה תפריט), טיוטה או פרסום באותה עסקה, שעות ברירת מחדל 10:30–14:30 ומכסה לפי סוג (רגיל 12, זוגי 14) מההגדרות. טיוטה לא מוחזרת ללקוחה. שינוי תאריך או שעה כשיש נרשמות מציג השפעה ושולח התראה; עד 3.8 `admin_update_event` חוסם אותו. ביטול מפגש רגיש ומציג מראש מי עלולה להישאר עם זכות שאי אפשר לממש. מחיקה (3.17) רק למפגש בלי אף שורה ב-`bookings`; אחרת מבטלים (3.8).
- **זוגי והיכרות:** מפגש זוגי מקבל רק הרשמות זוגיות (2 מקומות), בזכות או זיכוי זוגיים; הרשמה זוגית עצמית ממומנת רק מזיכוי זוגי. **אין קיזוז זוגי (החלטת המשתמשת 2026-10-10, גוברת על המקור):** מפגש זוגי משולם בנפרד ולא ממומן מכרטיסייה, גם לא בידי טל; `admin_offset_paired` לא נבנה. כניסות נגרעות מהזכות, מקומות מ-`party_size`. שדה תזונה אופציונלי אחד למלווה. היכרות (2026-10-05): רק למי שלא השתתפה ואין לה שום הרשמה `confirmed`/`completed` (גם עתידית) ואין לה היכרות פעילה; רק מפגש רגיל; ביטול לפני המפגש לא נחשב; אי-הגעה נחשבת השתתפות. "השתתפה" נגזרת רק ממפגשים שהסתיימו (2.9 יצא; 6.2 מוסיף `prior_participation_override`).
- **ביטול:** חלון 48 שעות כולל בדיוק 48, נבדק בשרת ונשמר בהרשמה. כרטיסייה ← הכניסה חוזרת לאותה כרטיסייה בלי הארכה; בודדת/היכרות/זוגית בביטול עצמי ← בחירה בין החזר לזיכוי; בתוך החלון דרך טל ← זיכוי; ביטול מצד העסק ← בחירה בלי מועד אחרון, וטל רואה מי לא בחרה. ב-3.6 נבנה מעבר זמני: ביטול מוצמד מחזיר זכות רגילה ל-N המפגשים הבאים (`private.return_pinned_entitlement`, `booking_cancelled_pinned`); 3.7 מחליף אותו בזיכוי.
- **זיכוי:** הרשמה אחת לאחד מ-N המפגשים המתאימים הבאים (N מההגדרות ברגע היצירה, ברירת מחדל 2), מאותו סוג, שנספרים מתאריך המפגש שבוטל. מפגש מלא או שבוטל מוחלף בבא; החלפה לא מתבטלת לאחור; חלופה שחלפה כשהיה בה מקום היא הזדמנות שחלפה. בלי מפגשים עתידיים הזיכוי ממתין. ביטול נוסף מחזיר את אותו זיכוי. לקוחה שתפסה בעצמה את המקום האחרון לא מאריכה. טל משנה חלופות או מאריכה (רגיש, 3.16).
- **החזר:** בחירה בהחזר מבטלת את הזכות ופותחת בקשה. "הוחזר" רק אחרי שטל מאשרת תאריך, סכום ואסמכתה אופציונלית. סך ההחזרים לא עולה על מה ששולם.
- **הזזה:** ביטול והרשמה חדשה בפעולה אחת; כשל משאיר את המקור בדיוק כפי שהיה. מוצמד ← רק לחלופות הזיכוי; כרטיסייה ← בתוך התוקף כולל הארכות (2026-10-05).
- **הארכה אוטומטית (CAP-36):** +7 ימים לכל שבוע מקומי (ראשון–שבת) שחופף לתוקף ואין בו מפגש מתאים שפורסם (זוגי לא נחשב לכרטיסייה רגילה; שבוטל לא נספר; מלא כן). פעם אחת לשבוע. שאר הביטולים והזיכויים לא מאריכים.
- כל שדה סיבה לא חובה; כל פעולה נרשמת ביומן.
- **Known conflicts:** המקור אומר "אין הארכה אוטומטית", סופר חלופות "אחרי מועד הביטול", נותן לבודדת/היכרות/זוגית תוקף 4 שבועות, מגביל כרטיסייה לשני וחמישי, מתיר קיזוז זוגי, ומחייב להציג את מועד הביטול האחרון לפני האישור; כולם הוחלפו בהחלטות שנרשמו ב-memlog של ה-SPEC.

## Technical Decisions

- **סדר נעילה:** `activation_tokens` ← `profiles` ← `events` ← `bookings` ← `entitlements` ← `cancellation_credits` ← `credit_options` ← `payments` ← `refund_requests` ← `waitlist_entries` ← `notification_jobs`, ובתוך טבלה לפי `id`. `profiles` הוא ה-mutex של הלקוחה. RPC מורכב לוקח את כל הנעילות בתחילתו. לא נועלים ילד כדי לגלות הורה (קריאה בלי נעילה, נעילת הורה, נעילת ילד ובדיקה שוב, אחרת `CONCURRENT_CHANGE`). `admin_cancel_event` נועל פרופילי הנרשמות ואז את המפגש; הזזה נועלת פרופיל ואז את שני המפגשים לפי מזהה.
- **ספירת מקומות:** רק `private.occupied_places` סוכמת `party_size` של הרשמות אמיתיות (`private.is_real_booking`: `confirmed`/`completed`); אין מונה שמור, ובדיקה סורקת את `pg_proc.prosrc`. אינווריאנטים באינדקס ייחודי חלקי `where customer_id is not null`.
- **מימון:** `private.plan_funding(p_customer_id, p_event_id, p_party_size, p_mode)` (`self`/`admin`/`move`/`online`) היא הקוד היחיד שבוחר מימון. עדיפות: (1) זיכוי `available` שהמפגש חלופה פעילה שלו; (2) זכות מתאימה ותקפה ביום המפגש, לפי `expires_on` ואז `id`. כרטיסייה לא מממנת זוגי באף מצב; מוצמדת מממנת רק את `pinned_event_id`. `booking_allocations` עם `num_nonnulls(entitlement_id, credit_id) = 1`. 3.7, ‏3.5, ‏3.10 ו-3.18 משנים אותה, כל אחד בסבב אחר.
- **RPC:** `book_session`, `book_sessions`, `admin_book_customer`, `cancel_booking` (עם `p_choice in ('refund','credit')`), `admin_cancel_booking`, `admin_cancel_event`/`preview_admin_cancel_event`, `choose_credit_outcome`, `admin_complete_refund`, `move_booking`, `admin_delete_event`, `admin_correct_entitlement`. פעולה עוברת ב-`private.book_core`/`private.cancel_core`; `move_booking` משתמש בשתיהן. `get_event_availability` ל-`authenticated` בלבד ומחזירה תווית ו-`registration_open`. מספרים לאדמין רק דרך `admin_*`.
- **חוזה RPC:** definer, `search_path = ''`, הרשאה בשורה הראשונה, `revoke` מכולם ו-`grant` אחד, `p_idempotency_key` (`private.idempotent_begin` לפני כל נעילה). שגיאות כקוד ב-`P0001`, וקוד חדש ב-`lib/errors.ts` באותו commit.
- **זמן:** כל מועד ב-SQL בעזרי `private` הטהורים. `private.can_self_cancel(booking_id)` היא בדיקת הגבול היחידה, נבדקת שוב בביטול ובהזזה. TS רק מציג.
- **snapshot:** `bookings.policy_snapshot` (חלון ביטול, תזכורת) נשמר ביצירה ומועתק בהזזה; `cancellation_credits.options_count` נשמר ביצירה. סף "מקומות אחרונים" נקרא בזמן הקריאה.
- **יומן תנועות:** `reserve` שלילי בהרשמה, `release` חיובי בביטול כרטיסייה, `use` = 0 עם `booking_id` בסיום מפגש, `adjust` ≠ 0 בתיקון. היתרה רק ב-view `entitlement_balances`, לא מתחת לאפס. בכניסה מוצמדת (מ-3.7) אין `release`: הערך עובר לזיכוי.
- **זיכויים והחזרים:** `cancellation_credits` (awaiting_options, available, used, refund_pending, refunded, expired, ‏`choice_pending`) עם `origin_starts_at`; `credit_options` (active, used, lapsed, replaced); `private.refresh_credit_options` נקראת מ-RPC הרשמה, ביטול ומכסה, מהתצוגה ללקוחה ומ-`job_refresh_credit_options`. `monetary_basis_agorot` מחושב פעם אחת ביצירה (`private.monetary_basis`). `refund_requests` (requested, completed). `private.job_complete_events` צריכה לסמן זיכוי שמימן הרשמה כ-`used` (3.7).
- **מוצמד בלי לקוחה (AD-23):** אישור מוצמד ללקוחה חדשה יוצר הרשמה `confirmed` עם `customer_id = null` שנספרת במכסה; משימות והתראות מדלגות על `null`. כל טבלה חדשה עם `customer_id` (זיכויים ובקשות החזר ב-3.7) מרחיבה את `private.bind_purchase` ואת `bind-purchase.test.ts`. בהפרה בשיוך `BIND_CONFLICT`.
- **פעולה רגישה:** `private.plan_<name>` אחת ל-`preview_<name>` ולביצוע, `p_confirmed` ו-`CONFIRM_REQUIRED`; לקוחה שקוראת ל-`preview_admin_*` מקבלת `NOT_AUTHORIZED`. רגישים ב-E3: ביטול ומחיקת מפגש, אישור החזר, תיקון בזכות, הארכה, שינוי חלופות זיכוי. בביטול או שינוי מפגש ה-preview מחזיר נוסח מהתבנית, טל עורכת, והפעולה מקבלת אותו ב-`p_message`.
- **התראות:** רק `private.enqueue_notification` באותה עסקה, וכל קורא מעביר את כל `allowed_vars` של הסוג. סוגים: `booking_confirmed`, `booking_cancelled` (discriminator = `audit_log.id`), `event_changed`/`event_cancelled` (`event_id:revision`, ‏`p_body_override`), `entitlement_changed` (3.13 ו-3.14). הוספת סוג ל-check של `notification_templates.type` היא `drop constraint`, ולכן מיגרציה נפרדת שהמשתמשת מריצה ב-SQL Editor. `events.revision` עולה רק ב-trigger.
- **משימות:** pg_cron פעיל (3.12). `private.job_complete_events` כל 5 דקות, בטוחה להרצה כפולה. ההארכה (3.14) אידמפוטנטית (`week_start` ייחודי לזכות ב-`entitlement_corrections`, actor מערכת); התזמון ב-5.10.
- **קונספטים:** `concepts` עם חמשת הקונספטים, `theme_key` מזהה בלבד, אין צבע או גופן לקונספט. `events.concept_id` FK `on delete restrict`; אין `events.title`. ‏`bookings.event_id` ‏`on delete restrict`; `work_sheets` נמחק ב-cascade עם המפגש, ו-3.17 רושם ביומן גם את נתוני דף העבודה.
- **מטמון:** זמינות, `/me` ו-`/admin` דינמיים עם `Cache-Control: private, no-store`.

## UX & Interaction Patterns

- כל מסך או רכיב מתחיל בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. מוקאפים: `key-booking-sheet.html`, `key-public-session.html`.
- **נוסח בלי טל:** קופי ללקוחה לא מזכיר את טל. כפתור הפנייה הוא "צרי קשר".
- **מועד הביטול לא מוצג ללקוחה (2026-10-05):** לא בגיליונות, לא בהודעת "נרשמת" ולא בתוצאות הבחירה המרובה. כפתור הביטול יודע בעצמו אם אפשר. כפתור האישור בגיליונות: "להרשמה".
- **כרטיס מפגש אחיד:** `session-card` ו-`concept-header` ב-`components/shared/`. אין תווית רגיל/זוגי ללקוחה; "הרשמה לשני מבוגרים · 2 מקומות" רק בגיליון.
- **`inline-notice`:** ממורכז, שורות מאוזנות, אייקון בתחילת השורה הראשונה. תוצאה תמיד בו, בלי אישור אופטימי; כפתור busy עד תשובה; מפתח idempotency בפתיחת הגיליון.
- **חסימות:** `inline-notice` עם סיבה ומה אפשר לעשות, והכפתור מוחלף בפעולה החלופית (בתוך חלון הביטול: "צרי קשר"; אין כניסה מתאימה; ההרשמה נסגרה; מלא). אין כפתור רשימת המתנה עד 5.6.
- **ביטול:** כרטיסייה בלי בחירה, "הכניסה חזרה לכרטיסייה שלך. בתוקף עד DD.MM". בודדת/זוגית: `radio-card` "זיכוי לאחד מ-{n} המפגשים הבאים" / "החזר כספי". ביטול מצד העסק: כרטיס "בחירה ממתינה" בראש `/me` ובהרשמה + "לבחירה". בקשת החזר: ממתינה לאישור. `/me/bookings` מציג גם זיכויים עם חלופות ובקשות החזר.
- **אדמין:** ביטול מפגש ומחיקה ב-`sensitive-confirm-dialog`; שינוי מועד עם תצוגת השפעה; שינוי ערכים ב-`value-change-row`; רישום ידני למפגש מלא: "המפגש מלא ({n}/{n})" + "להעלות את המכסה".

## Cross-Story Dependencies

- **תלויות:** ‏3.7 אחרי 3.6. ‏3.5 אחרי 3.11 ו-3.7. ‏3.8 אחרי 3.7, ‏3.9 אחרי 3.8, ‏3.10 אחרי 3.9, ‏3.16 אחרי 3.10. ‏3.17 אחרי 3.4, ‏3.7 ו-4.10. ‏3.18 אחרי 3.10 ו-3.5. ‏3.13 אחרי 3.12, ‏3.14 אחרי 3.13. ל-E5: ‏5.6 (רשימת המתנה) אחרי 3.10 ו-3.5, ומוסיף "רשומה וגם ממתינה" ו-`notify_waitlist` בכל פונקציה שמשחררת מקום; פוש 5.8, תזכורת 5.17 (3.8 מחשב אותה מחדש אחרי שינוי שעה), תזמון ההארכה 5.10.
- **"לטיפול" (`admin_get_attention_items`):** ‏3.7 מוסיף בקשות החזר פתוחות (וגם בבית האדמין "החזרים שבוצעו ({n})" ו-`net_agorot` פחות ההחזרים), ‏3.8 `choice_pending`, ‏3.13 הרשמות שנפגעו מתיקון. כל אחד בסבב אחר.
- **פריטים שהועברו:** `preview_book_session` מחפש את ההרשמה לפני בדיקת הסטטוס (עבר מ-3.8 ל-3.5, כי שניהם נוגעים בעמוד המפגש). כפילות ב-`bind_purchase` אחרי `completed` ← 3.5. `bind_purchase` ו-`token_view` בודקים מצב תשלום וזכות, ומצב תשלום ב-`get_my_entitlements` ← 3.9. ‏3.5 מחליט אם `booking_confirmed` זוגי נשלח גם בפוש.
- **התנגשויות:** ‏3.7 ו-5.19 נוגעים ב-`lib/errors.ts` וב-`lib/copy/customer.ts` (קוד רק אחרי ש-5.19 ממוזג). ‏3.14 ו-3.16 שולחים שניהם `entitlement_changed`. ‏5.6 מגדיר מחדש את פונקציות ההרשמה ו-3.18 משנה את `plan_funding`; מי שממזג שני מריץ את כל בדיקות ההרשמה. אחרי כל מיזוג עם מיגרציה יוצרים מחדש את `database.types.ts`.
- רכיבים לשימוש חוזר: `components/admin/sensitive-confirm-dialog.tsx`, `lib/admin/sensitive-actions.ts`, `components/admin/value-change-row.tsx`, `components/shared/session-card.tsx`, `components/shared/concept-header.tsx`, `components/shared/inline-notice.tsx`.
