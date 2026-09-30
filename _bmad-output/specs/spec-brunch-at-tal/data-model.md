# מבנה נתונים מוצע

לפי §9 במקור: בסיס למיגרציות SQL, לא התחייבות לשמות קבצים. שינויים מהמקור מסומנים בסוגריים עם הסיבה. הצורה הטכנית (מפתחות, הרשאות, מצבים, יומן) נקבעת ב-[ARCHITECTURE-SPINE.md](../../planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md). בכל הבדל טכני בין הקובץ הזה לבינו, מסמך הארכיטקטורה קובע.

## כללים כלליים
- לכל ישות עסקית: מזהה UUID, זמני יצירה ועדכון לפי הצורך, ומפתחות זרים.
- הטלפון ייחודי אחרי נרמול (E.164). המייל נבדק למניעת שיוך לכמה חשבונות.
- שדות כספיים הם integers באגורות. הממשק מציג שקלים (₪).
- אין יתרה עצמאית. היתרה נגזרת מיומן התנועות.
- אין ערך עסקי ואין תוכן שיווקי בקוד. הם נשמרים בטבלאות שלמעלה ונערכים באדמין (admin-configurable-parameters.md). כל שינוי נרשם ב-audit_log עם before ו-after.

## ישויות
| ישות | שדות עיקריים ותפקיד |
|---|---|
| profiles | id (זהה למזהה משתמשת ה-Auth. אין עמודת auth_user_id, ארכיטקטורה AD-3. המייל, שם המשתמש, נשמר רק ב-Auth ומשתנה רק דרך אדמין), pending_email (רק ללקוחה מיובאת שעוד לא הופעלה. מתאפס בהפעלה, AD-3), full_name, phone_e164, activated_at (במקום activation_status), prior_participation_override (מיבוא, או תיקון של טל. CAP-10. "השתתפה בעבר" נגזר ממנו ומהרשמות שהסתיימו, AD-14. "לא פעילה" נגזרת בזמן הקריאה ואינה נשמרת, במקום activity_status, AD-14), dietary_notes (טקסט אחד, null = לא מוצג בשום מקום. החלטה משותפת, במקום dietary_preferences, allergy_status ו-allergy_details), privacy_consent_at, privacy_policy_version, photo_consent (ברירת מחדל false), photo_consent_at, photo_consent_text_version (CAP-40. כל שינוי נרשם ביומן), anonymized_at, account_op_state ו-account_op_started_at (מצב ביניים של פעולה דו-שלבית: email_change_pending או anonymization_pending, AD-21), created_at |
| customer_notes | customer_id, body, created_by, created_at. הערות פנימיות של אדמין, ללקוחה אין גישה (§7) |
| babies | id, customer_id, name, birth_date. שדות §9 האופציונליים ליבוא שמכיר רק גיל: age_months_at_entry, age_recorded_on, estimated_birth_date, is_estimated |
| admin_roles | user_id, role. תפקיד אחד: admin. נכתב רק בשרת מורשה, בנפרד מהפרופיל |
| products | name, type, price_agorot, units, validity_mode (days או session. session = מוצמד למפגש, CAP-37), validity_days (רק ב-days), allowed_weekdays, eligible_event_kind, party_size, intro_only, post_join_message, post_join_button_label (לכל מוצר. ברירת המחדל: הנוסח מ-§4), active. כל השדות נערכים באדמין |
| payments | customer_id (ריק עד מימוש קישור ההצטרפות), product_id, amount_agorot, paid_on, payment_method_id (במקום method, מתוך payment_methods. חובה ב-manual וריק ב-online), reference (אופציונלי), note (אופציונלי), amount_override_reason (אופציונלי), status (approved, voided. בגרסה הראשונה אין פעולה שקובעת voided, ו-voided שמור לפעולת ביטול תשלום עתידית, AD-10), source (manual או online, בלי ברירת מחדל. בגרסה הראשונה תמיד manual), provider ו-provider_transaction_id (רק ב-online, וייחודיים יחד), recorded_by (מלא ב-manual בלבד), product_snapshot (כולל שם אמצעי התשלום ברגע האישור. תשלום עבר מוצג תמיד עם השם השמור). אין עמודת idempotency_key: ההגנה מביצוע כפול היא בטבלה אחת, idempotency_results (AD-5). הכנה לסליקה: [online-payments.md](online-payments.md) |
| payment_methods | name, sort_order, hidden. אמצעי התשלום שטל בוחרת מהם באישור תשלום. היא מוסיפה, משנה שם, מסתירה ומציגה שוב, ומסדרת. אמצעי שלא שימש אף פעם אפשר למחוק; אמצעי ששימש רק מוסתר. תמיד נשאר לפחות אמצעי גלוי אחד. seed: ביט, פייבוקס, העברה בנקאית, מזומן |
| entitlements | customer_id (ריק עד שיוך הרכישה, כמו payments), payment_id (או import_batch_id), kind, original_units, valid_from, expires_on (תקף עד סוף היום המקומי. במוצר מוצמד: יום המפגש. בכרטיסייה: כולל הארכות אוטומטיות), pinned_event_id (רק במוצר מוצמד), eligibility_snapshot (מהמוצר ברגע המענק), allowed_weekdays ו-eligible_event_kind (הערכים הנוכחיים. מתחילים מה-snapshot ומשתנים רק בתיקון), status (רק active, revoked, refunded. "פגה" ו"נוצלה" נגזרות ולא נשמרות, AD-14) |
| entitlement_corrections | entitlement_id, field (expires_on, allowed_weekdays, eligible_event_kind), old_value, new_value, reason (אופציונלי), affected_booking_ids (הרשמות עתידיות שלא עמדו בערך החדש והוצגו באזהרה. הן לא משתנות), actor_id, created_at. הארכה אוטומטית (CAP-36) נרשמת כאן עם actor מערכת ו-week_start (תחילת השבוע הריק), ייחודי לכל זכות ושבוע, כך שהרצה חוזרת לא מאריכה פעמיים. תיקון יתרה נשמר כתנועת adjust ביומן התנועות |
| entitlement_movements | entitlement_id, booking_id, action (grant, reserve, use, release, adjust, opening_balance), units (עם סימן קבוע לכל פעולה, AD-14), reason (אופציונלי), actor_id, reverses_id. רק הוספה: אין עדכון ואין מחיקה |
| concepts | name, description, default_image_id, default_kind (regular או couple), theme_key (mothers, couples, grandma, grandpa, greek או generic. הצבעים והגופנים מוגדרים ב-DESIGN.md, לא במסד), generic_paper_key (רק ב-generic: olive, plum, jade, mustard, slate או clay), sort_order, archived_at. seed: אמהות בחל״ד, זוגות, עם סבתוש, עם סבוש, יווני (CAP-41) |
| events | concept_id (חובה. הכותרת המוצגת היא שם הקונספט, ואין עמודת title. ממנו מתמלאים גם kind, description, image_id וערכת העיצוב), description, image_id, kind (אין עמודת menu. החלטה משותפת, גוברת על §9), starts_at, ends_at, capacity_adults ו-registration_closes_at (מתמלאים מ-business_settings ונערכים למפגש), registration_close_overridden (טל קבעה ידנית, AD-8), status, revision (עולה רק ב-trigger בשינוי זמן, סוג או ביטול, AD-12), waitlist_cycle (AD-14), display_price_agorot (אופציונלי. ריק = מחיר המוצר המתאים. לתצוגה בלבד) |
| event_products | event_id, product_id. התאמת מוצרים למפגש בלי לשנות זכויות ישנות |
| bookings | customer_id (ריק בהרשמה שנוצרה באישור מוצר מוצמד ללקוחה חדשה, עד מימוש קישור ההצטרפות), payment_id (במוצר מוצמד), event_id, party_size, status, booked_by, confirmed_at, cancelled_at, cancellation_actor, guest_details (רק הגבלות התזונה של המלווה, אופציונלי, בלי שם. החלטה משותפת), policy_snapshot (חלון הביטול וזמן התזכורת בעת האישור) |
| booking_allocations | booking_id, entitlement_id או credit_id (בדיוק אחד מהם, AD-18), units. שומר את הרכב המימון, גם בקיזוז כרטיסייה בזוגי ובמימוש זיכוי |
| waitlist_entries | customer_id, event_id, party_size, joined_at, status, last_notified_cycle |
| cancellation_credits | customer_id, origin_booking_id, source_entitlement_id, event_kind, party_size, options_count (מההגדרות ביצירת הזיכוי), origin_starts_at (מועד המפגש שבוטל. החלופות נספרות ממנו, CAP-18, AD-14), original_cancelled_at (לתיעוד בלבד), monetary_basis_agorot (מחושב פעם אחת ביצירה, AD-20), status, choice_pending (ביטול מצד העסק, בלי מועד אחרון) |
| credit_options | credit_id, event_id, state, assigned_at, replaced_reason. ההיסטוריה נשמרת. לכל היותר options_count הזדמנויות פעילות או מנוצלות |
| refund_requests | customer_id, payment_id, booking_id, amount_agorot, status, requested_at, completed_at, reference, handled_by |
| notifications | recipient_id, recipient_kind (customer או admin, ראו השורה הבאה), type (רשימה סגורה, AD-12), payload (כולל הנוסח שנשלח בפועל), target_path, dedupe_key, created_at, read_at |
| (התראות לטל) | אין טבלה נפרדת (ארכיטקטורה AD-12, החלטת משתמשת): `notifications` עם `recipient_id` (מזהה משתמשת Auth) ו-`recipient_kind` (customer / admin). התראת אדמין נוצרת לכל אדמין. סוגי אדמין: admin_card_expiring, marketing_reminder |
| marketing_reminder_texts | body, sort_order, active, last_sent_at. מאגר הנוסחים של תזכורות השיווק. הבא בסבב: active עם last_sent_at הישן ביותר |
| notification_templates | type (סוג אירוע ב-notification-matrix), body, version, updated_by, updated_at. נוסח התחלתי מהמקור. עריכה חלה על התראות חדשות |
| broadcasts | id, audience (all או active), body, created_by, created_at |
| push_subscriptions | user_id (לקוחה או אדמין. גם טל נרשמת לפוש, CAP-35. AD-12), endpoint, keys, platform, enabled. נכתב רק דרך register_push_subscription. אין גישה ציבורית |
| notification_jobs | notification_id, scheduled_at, status (queued, sending, sent, failed), lease_until, attempt_count, next_attempt_at, last_error, dedupe_key |
| notification_deliveries | job_id, subscription_id (ייחודי יחד). ניסיון חוזר לא שולח שוב למכשיר שכבר קיבל (AD-12) |
| activation_tokens | payment_id, customer_id (הלקוחה ששויכה אחרי המימוש), purpose (join, claim, reset), token_hash (sha256 hex. הטוקן עצמו לא נשמר, AD-10), expires_at (48 שעות, קבוע ולא מההגדרות), state, conflict_reason (למה הקישור הועבר לטל, למשל התנגשות בשיוך רכישה), pending_user_id, bound_user_id, input_hash, consumed_at. שימוש שרת בלבד |
| idempotency_results | actor_scope, rpc, key, request_hash, result, created_at. הטבלה היחידה להגנה מביצוע כפול, ב-schema פנימי (AD-5) |
| import_batches | id, source_file, imported_by, imported_at, row_count, conflicts |
| content_pages | slug, draft_content, published_content, published_at, published_version (עולה בכל פרסום. ההסכמה למדיניות שומרת אותו, AD-16), updated_by. עמודי האתר: בית, אודות, איך זה עובד, גלריה, יצירת קשר, פוטר, מדיניות פרטיות (עם גרסה) והצהרת נגישות |
| content_sections | page_slug, key (למשל hero, intro, how_it_works, faq, footer, business_details), kind, sort_order, hidden, draft_content, published_content, published_at, updated_by. בלוק מסודר בתוך עמוד. פריטים חוזרים (שלבים, שאלות) נשמרים בתוכו כרשימה מסודרת. business_details: שם העסק, טלפון ווואטסאפ, הודעת וואטסאפ מוכנה, כתובת, הוראות הגעה, קישור ניווט, הוראות תשלום |
| media_assets | storage_path, section_id (אופציונלי), alt_text (חובה לפרסום), mobile_crop (אזור החיתוך לטלפון), sort_order, publish_state (draft, copying, published, hidden, AD-16/AD-21), consent_confirmed כשרלוונטי |
| testimonials | kind (text או image), author_display_name (בטקסט), text (בטקסט), media_id (בתמונה, עם alt_text חובה), sort_order, hidden, draft ופרסום |
| work_sheets | event_id (ייחודי), prep_days (רשימה מסודרת של היסטים ביחס ליום המפגש, מתחילה מההגדרות, למשל [-1, 0]. "+ יום הכנה" מוסיף היסט, למשל -2) |
| work_dishes | work_sheet_id, name, sort_order |
| work_tasks | dish_id, day_offset, body, done, sort_order |
| shopping_items | work_sheet_id, body, quantity (טקסט חופשי, אופציונלי), bought, sort_order |
| note_topics | name, sort_order |
| notes | topic_id, body, pinned, done, archived_at, created_at, updated_at |
| business_settings | ברירות מחדל עם גרסת הגדרות: default_validity_days, registration_close_rule (ימים לפני + שעה), default_capacity_adults לפי סוג מפגש (regular 12, couple 14), cancel_window_hours, credit_options_count (2), reminder_lead_hours (24), admin_expiring_days (21, במקום expiring_threshold_days), last_places_threshold (4), default_prep_days ([-1, 0]), customer_expiring_days (10), marketing_reminder_schedule (ימים ושעה: א׳ ג׳ ד׳ 09:00, ב׳ ה׳ 20:00), inactivity_months. פרטי העסק עברו ל-content_sections (business_details), כדי שיהיו להם טיוטה ופרסום |
| audit_log | actor_id, actor_kind (admin, customer, system), action, entity_type, entity_id, customer_id, event_id (לסינון לפי מפגש, CAP-26), before, after (רק מה שהשתנה, בלי פרטים מזהים, AD-19), reason (אופציונלי), created_at |

## קשרים
- ללקוחה יכולים להיות הרבה תינוקות, רכישות, זכויות והרשמות. למפגש יכולות להיות הרבה הרשמות וממתינות.
- רכישה יוצרת זכות. booking_allocations קושרת זכות להרשמה.
- זיכוי שומר קשר למקור, כך שביטול נוסף לא יוצר זיכוי חדש.
- אסור לשמור רשימת לקוחות כמערך בתוך מפגש.

## מצבים
הרשימה המלאה והסגורה נמצאת בארכיטקטורה (Consistency Conventions › אוצר סטטוסים). העיקריים:
- **event:** draft, published, cancelled, completed. "מלא" נגזר מהתפוסה ואינו מצב שמור.
- **booking:** confirmed, cancelled, completed. הרשמה שהסתיימה בלי ביטול היא completed ומנוצלת, גם באי-הגעה.
- **credit:** awaiting_options, available, used, expired, refund_pending, refunded, ובנוסף choice_pending (בוליאני נפרד).
- **activation_token:** pending (ממתין למימוש), awaiting_login (חשבון קיים, ממתין להתחברות), claiming (בתהליך יצירת חשבון), consumed (מומש), revoked (בוטל), conflict (הועבר לטל). "פג תוקף" נגזר מ-expires_at ואינו נשמר (AD-10).
- יומן התנועות מונע יתרה שלילית.

## אילוצים ואינדקסים
- ייחודיים: הרשמה פעילה אחת ללקוחה במפגש, המתנה פעילה אחת ללקוחה במפגש, זכות היכרות פעילה אחת והרשמת היכרות פעילה אחת ללקוחה (חלקיים, רק כש-customer_id מלא, AD-23. בשיוך רכישה נבדקים שוב לפני כתיבה), מפתחות idempotency (ב-idempotency_results), מפתחות התראות, ו-(provider, provider_transaction_id) ב-payments כשהם מלאים.
- אינדקסים: foreign keys, מועדי מפגשים, customer_id, סטטוסים ומשימות שמוכנות לשליחה.

## ניקוי (§10)
- התראות שנקראו נמחקות אחרי 90 יום. משימות שליחה שהסתיימו נמחקות אחרי 30 יום.
- אין למחוק תנועות תשלום או הרשמות במסגרת הניקוי.
