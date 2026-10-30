# דוח בדיקות קבלה 6.6: תשלום, חשבון, הרשאות והרשמה

- **תאריך:** 2026-10-30
- **commit בסיס:** `ffb4e44` (branch `story-6-6-acceptance-suite-core`; ההרצות נעשו על השינויים של הסיפור לפני commit)
- **הרצה מלאה של `npm run test:db` (כולל `grants.test.ts`):** ‏74/74 קבצים, 1392/1392 בדיקות עוברות (2026-10-30, ‏2568 שניות, סשן התכנון). הרצה מלאה קודמת נכשלה בניקוי של `booking-concurrency.test.ts` (מגבלת זמן של 10 שניות ל-afterAll); התיקון: `hookTimeout: 60_000` בפרויקט `db` ב-`vitest.config.mts` (ראו Spec Change Log).
- **`npm test`:** ‏228 קבצים, 3023 בדיקות, הכול עובר (2026-10-30).
- **שאריות `test_`:** ‏`node scripts/dev-clean-test-data.mjs` (הרצה יבשה) אחרי ההרצה המלאה: "אין נתוני בדיקה במסד".
- **בדיקות נוספות:** ‏`npm run lint`, ‏`npm run typecheck`, ‏`npm run format:check`, ‏`npm run build` עוברים.
- מקור הסעיפים: `acceptance-criteria.md` של ה-SPEC. מפת הכיסוי המלאה (טענה ← בדיקה) ב-`spec-6-6-acceptance-suite-core.md`, בסעיף Coverage map.

## תוצאות לפי קובץ

| קובץ | בדיקות | תוצאה |
|---|---|---|
| [acceptance-payment-account.test.ts](../../supabase/tests/acceptance-payment-account.test.ts) | 11 (T1–T7, ‏T20, ‏T23, ‏T24 ×2) | עובר |
| [acceptance-permissions.test.ts](../../supabase/tests/acceptance-permissions.test.ts) | 4 (T8–T11) | עובר |
| [acceptance-booking-quota.test.ts](../../supabase/tests/acceptance-booking-quota.test.ts) | 8 (T13–T17, ‏T18 ×2, ‏T19) | עובר |
| [acceptance-intro-business-cancel.test.ts](../../supabase/tests/acceptance-intro-business-cancel.test.ts) | 2 (T25, ‏T26) | עובר |
| [booking-concurrency.test.ts](../../supabase/tests/booking-concurrency.test.ts) | 9 (7 קיימות + T12 ×2) | עובר |
| [proxy.test.ts](../../lib/supabase/proxy.test.ts) | 3 (2 קיימות + T21) | עובר |
| [contact-text.test.tsx](../../components/shared/contact-text.test.tsx) | 2 (T22) | עובר |

אף בדיקה חדשה לא נכשלה, ולכן לא נדרש תיקון בקוד המוצר ולא נכתבה מיגרציה.

## איך נבדק הכיסוי הקיים

כל שורה מסוג C במפת הכיסוי נבדקה שורה אחרי שורה: נפתח ה-it() שבקובץ ובשורה שצוינו, ונקראו ההשוואות שלו (`expect`), כדי לוודא שהן מוכיחות את הטענה ולא רק ש"לא נזרקה שגיאה". הטענות שנמצאו חלשות כבר סומנו N במפה ונכתבה להן בדיקה (T1–T26). תיקוני הפניה שנמצאו בבדיקה, בלי השפעה על התוצאה:

- P5: ‏`join.test.ts:561` בודק דחייה של מייל או טלפון לא תקינים, ולא חשבון קיים. ההוכחה ל-P5 היא `existing-account.test.ts:282` ו-`:323`.
- SP6: ‏`money-rls.test.ts:176` הוא שורה ריקה. ה-it() הוא בשורה 177.
- SI1: ‏`pinned-approval.test.ts:528` הוא שורה ריקה. ה-it() הוא בשורה 529.
- P7: ‏`join/[token]/actions.test.ts:120` מוכיח שהטופס מחזיר CONSENT_REQUIRED בלי הסכמה (בצד המסך). בצד המסד ההוכחה היא `join.test.ts:464`.

## תוצאה לפי סעיף

מקרא הקיצורים (המספר אחרי הנקודתיים הוא שורת ה-it() בקובץ; ‏T1–T26 הן הבדיקות החדשות, בקבצים שבטבלה "תוצאות לפי קובץ"):

| קיצור | קובץ |
|---|---|
| AP | [approve-payment.test.ts](../../supabase/tests/approve-payment.test.ts) |
| RP | [repeat-purchase.test.ts](../../supabase/tests/repeat-purchase.test.ts) |
| J | [join.test.ts](../../supabase/tests/join.test.ts) |
| LL | [link-lifecycle.test.ts](../../supabase/tests/link-lifecycle.test.ts) |
| EA | [existing-account.test.ts](../../supabase/tests/existing-account.test.ts) |
| AA | [account-admin.test.ts](../../supabase/tests/account-admin.test.ts) |
| SR | [session-role-and-token-view.test.ts](../../supabase/tests/session-role-and-token-view.test.ts) |
| TP | [time-and-phone-helpers.test.ts](../../supabase/tests/time-and-phone-helpers.test.ts) |
| BC | [booking-concurrency.test.ts](../../supabase/tests/booking-concurrency.test.ts) |
| PA | [pinned-approval.test.ts](../../supabase/tests/pinned-approval.test.ts) |
| BP | [bind-purchase.test.ts](../../supabase/tests/bind-purchase.test.ts) |
| SB | [self-booking.test.ts](../../supabase/tests/self-booking.test.ts) |
| MB | [multi-booking.test.ts](../../supabase/tests/multi-booking.test.ts) |
| CI | [couple-and-intro.test.ts](../../supabase/tests/couple-and-intro.test.ts) |
| WL | [waitlist.test.ts](../../supabase/tests/waitlist.test.ts) |
| BUS | [business-cancel.test.ts](../../supabase/tests/business-cancel.test.ts) |
| AE | [auto-extend.test.ts](../../supabase/tests/auto-extend.test.ts) |
| SC | [session-completion.test.ts](../../supabase/tests/session-completion.test.ts) |
| AH | [admin-home.test.ts](../../supabase/tests/admin-home.test.ts) |
| MR | [money-rls.test.ts](../../supabase/tests/money-rls.test.ts) |
| G | [grants.test.ts](../../supabase/tests/grants.test.ts) |
| rls | [rls.test.ts](../../supabase/tests/rls.test.ts) |
| cancel-booking | [cancel-booking.test.ts](../../supabase/tests/cancel-booking.test.ts) |
| cancellation-credits | [cancellation-credits.test.ts](../../supabase/tests/cancellation-credits.test.ts) |
| notifications | [notifications.test.ts](../../supabase/tests/notifications.test.ts) |
| entitlement-corrections | [entitlement-corrections.test.ts](../../supabase/tests/entitlement-corrections.test.ts) |
| events-admin | [events-admin.test.ts](../../supabase/tests/events-admin.test.ts) |
| settings-and-templates | [settings-and-templates.test.ts](../../supabase/tests/settings-and-templates.test.ts) |
| actions.test.ts | [app/(auth)/join/[token]/actions.test.ts](<../../app/(auth)/join/[token]/actions.test.ts>) |
| claim-join.test.tsx | [app/(auth)/join/[token]/claim-join.test.tsx](<../../app/(auth)/join/[token]/claim-join.test.tsx>) |
| lib/sessions/public.test.ts | [lib/sessions/public.test.ts](../../lib/sessions/public.test.ts) |

### תשלום וחשבון

| סעיף | תוצאה | הוכחה |
|---|---|---|
| P1 אישור והצטרפות: לקוחה אחת ורכישה אחת, בלי כפילות בלחיצה חוזרת או retry | עובר | AP:161, ‏AP:194, ‏RP:334, ‏J:337, ‏J:376, ‏LL:618; ‏T1 |
| P2 טלפון מקומי ובינלאומי הם אותו מספר | עובר | TP:105, ‏EA:178, ‏EA:323, ‏J:209; ‏T2 |
| P3 קישור פעם אחת, 48 שעות, אין הגדרה שמשנה, קישור חדש מבטל ישן, תצוגה לא מפעילה | עובר | J:337, ‏J:579, ‏EA:605, ‏LL:238, ‏LL:565, ‏AA:100; ‏T3, ‏T4 |
| P4 קישור איפוס לא חושף מידע של אחרת | עובר | SR:333; ‏T5 |
| P5 חשבון קיים: לא נוצר חשבון, שיוך רק אחרי התחברות | עובר | EA:282, ‏EA:323, ‏EA:605, ‏EA:697 |
| P6 זכות שפגה לא מוארכת, ומוצגת אפשרות קשר | עובר (+ M5 עובר) | LL:869, ‏LL:919; ‏T22. ‏T22 בודק רק את הרכיב ContactText. לחלון ההסבר הפתוח במסך אין בדיקה אוטומטית (אין סביבת DOM בבדיקות), ולכן M5. הנוסח "צרי קשר" במקום "לפנות לטל" (ראו הערות) |
| P7 אין חשבון בלי הסכמה; נשמרים מועד וגרסה | עובר | J:464, ‏actions.test.ts:120, ‏J:807; ‏T6 |
| P8 נשארת מחוברת אחרי סגירה ופתיחה | עובר (+ M1 עובר) | T21 (העוגייה המרועננת שומרת `maxAge` ו-`path`). את הסגירה והפתיחה בפועל מראה רק דפדפן: M1 |
| P9 אין שינוי עצמי של טלפון ומייל; שינוי דרך טל נחסם למייל של חשבון אחר | עובר | AA:446, ‏AA:479, ‏AA:513, ‏J:851, ‏AA:259, ‏AA:308; ‏T7 |
| P9 "ונרשם ביומן" | הוחלף בהחלטה | תיקון 6 ב-fixes-log (החלטת המשתמשת 2026-10-18, ‏5.20): צעד שאף אחד לא צריך לבדוק אחר כך לא נרשם ביומן. ‏AA:259 בודק שאין שורה. בלי מיגרציה (סשן התכנון, 2026-10-30, אפשרות א) |

### הרשאות

| סעיף | תוצאה | הוכחה |
|---|---|---|
| R1 בלי זכות: המתנה כן, הרשמה לא; לא מחוברת: כלום | עובר | WL:221, ‏SB:350, ‏WL:826, ‏SB:772, ‏MB:528, ‏G:426, ‏G:460, ‏WL:292, ‏SB:787 |
| R2 בלי אדמין אין קריאה או שינוי של נתוני אחרות, גם ב-API | עובר | rls:60, ‏rls:79, ‏MR:69, ‏MR:105, ‏MR:122, ‏SB:805, ‏WL:782, ‏cancellation-credits:1009, ‏notifications:893, ‏G:426, ‏J:851, ‏J:875; ‏T8, ‏T9, ‏T10, ‏T11 |
| R3 לקוחה לא משנה role, תשלום או יתרה | עובר | MR:177, ‏AP:441, ‏MR:225 |

T11 קרא לכל פונקציה `public.admin_%` ו-`public.preview_admin_%` כלקוחה, עם ארגומנטים ריקים. כולן החזירו NOT_AUTHORIZED או 42501, וספירות `audit_log`, ‏`payments` ו-`entitlement_movements` לא השתנו. T8 מצא RLS פעיל בכל טבלה ב-`public`, ו-policy של קריאה לכל טבלה ש-`authenticated` יכול לקרוא.

### הרשמה ומכסה

| סעיף | תוצאה | הוכחה |
|---|---|---|
| B1 מקום אחרון: לכל היותר אחת; כניסה אחת לא מממנת שתי הרשמות במקביל | עובר | BC:278, ‏BC:317, ‏BC:445, ‏BC:482; ‏T12 (הלקוחה עצמה, וגם טל) |
| B2 זוגי: שני מקומות; מקום אחד לא מספיק ולא שולח התראת המתנה | עובר | PA:312, ‏CI:686, ‏CI:718, ‏PA:441, ‏WL:542 |
| B3 כרטיסייה של 4: יתרה נכונה אחרי שריון, ביטול והשתתפות | עובר | SB:204, ‏cancel-booking:352, ‏SC:258; ‏T13 |
| B4 מפגש מחוץ לתוקף נחסם, גם אם הכרטיסייה בתוקף היום | עובר | SB:319, ‏MB:290 |
| B5 תוקף עד סוף היום המקומי ה-49: באותו יום מותר, למחרת נחסם | עובר | AP:62, ‏TP:62, ‏TP:70, ‏entitlement-corrections:302; ‏T14 |
| B6 זוגי בתשלום נפרד, לקוחה לא מקזזת מכרטיסייה | עובר | SB:517, ‏CI:747 |
| B6 "אדמין יכולה, כחריגה מתועדת" | הוחלף בהחלטה | completion-plan שורה 9, ‏memlog:290 (2026-10-10): גם טל לא מקזזת מכרטיסייה לזוגי. ‏CI:747 מוכיח זאת |
| B7 מוצר מוצמד: בלי מפגש אי אפשר; עסקה אחת; retry לא מכפיל; מלא או לא מתאים נכשל בלי כלום; נספר לפני ההצטרפות ועובר אליה | עובר | PA:375, ‏PA:236, ‏PA:356, ‏PA:399, ‏PA:722, ‏PA:941, ‏PA:487, ‏SB:437; ‏T15, ‏T16 |
| B8 מכסה 12 / 14 מההגדרות | עובר | events-admin:134, ‏events-admin:171, ‏settings-and-templates:247; ‏T17 |
| B9 הארכה אוטומטית של 7 ימים | עובר | AE:169, ‏AE:241, ‏AE:548, ‏AE:349, ‏AE:272, ‏AE:405, ‏AE:421; ‏T18 |
| B10 סגירה ב-20:00 ביום הקודם, גם במעבר שעון; זמן השרת קובע | עובר | TP:44, ‏TP:52, ‏BC:351, ‏MB:423; ‏T19 |
| B11 לא הגיעה ולא ביטלה: הכניסה מנוצלת ואין היכרות | עובר | SC:408, ‏PA:759 |

### השלמות › תשלום, אמצעי תשלום ושיוך רכישה

| סעיף | תוצאה | הוכחה |
|---|---|---|
| SP1 תאריך התפוגה או המפגש בתצוגה המקדימה זהים למה שנשמר | עובר | AP:212; ‏T20 |
| SP2 כרטיסייה חדשה לא מתמזגת ולא מאפסת | עובר | RP:117 |
| SP3 טלפון ומייל של שני חשבונות: עצירה והפניה לטל | עובר | EA:192, ‏EA:400, ‏AH:176 |
| SP4 אמצעי מוסתר נדחה בתשלום | עובר | AP:395 |
| SP4 הראשון ברשימה מסומן מראש | עובר (M2, ידני) | M2 |
| SP4 הוספה, שינוי שם, הסתרה, סידור, אמצעי ששימש לא נמחק, הגלוי האחרון | הוחלף בהחלטה | completion-plan שורה 8 (2026-10-10): סיפור 2.7 יצא מהיקף הגרסה |
| SP5 שינוי שם של אמצעי לא משנה תשלומים קיימים, גם בייצוא | הוחלף בהחלטה | completion-plan שורה 8 (2026-10-10) ושורה 22 (2026-10-13) |
| SP6 כל תשלום עם מי שרשמה ואמצעי; רק אישור יוצר תשלום | עובר | AP:62, ‏AP:625, ‏AP:631, ‏AP:640, ‏G:426, ‏MR:177 |
| SP7 מפגש מוצמד שבוטל לפני ההצטרפות: הזיכוי, הבחירה וההתראה אצלה | עובר | BP:384; ‏T23 |
| SP8 רשומה או השתתפה: לא משויך כלום, הודעה ולא שגיאה, "לטיפול" | עובר | BP:461, ‏BP:497, ‏BP:527, ‏BP:583, ‏actions.test.ts:475, ‏claim-join.test.tsx:108; ‏T24 |
| SP8 "שממתינה לאותו מפגש" | הוחלף בהחלטה | memlog:306 (2026-10-20) ומסמך המקור §5 שורה 221: ממתינה מקבלת את ההרשמה והיציאה מההמתנה. ‏WL:699 מוכיח זאת |

### השלמות › היכרות, מפגשים והמתנה

| סעיף | תוצאה | הוכחה |
|---|---|---|
| SI1 אין שתי זכויות היכרות או שתי הרשמות היכרות; ביטול לפני המפגש אינו ביקור | עובר | PA:487, ‏BP:583, ‏CI:779, ‏PA:839, ‏PA:529, ‏PA:881, ‏cancel-booking:655; ‏T25 |
| SI2 טיוטה לא נראית; שינוי מועד עם נרשמות מציג השפעה ושולח התראה | עובר (+ M3 עובר) | events-admin:215, ‏lib/sessions/public.test.ts:128, ‏:158, ‏:166, ‏SB:401, ‏BUS:974, ‏BUS:1019, ‏events-admin:350. החלון במסך: M3 |
| SI3 לא גם רשומה וגם ממתינה; הרשמה מוציאה מההמתנה; מקום שהתפנה פעם אחת שולח התראה אחת | עובר | WL:256, ‏WL:270, ‏WL:625, ‏WL:650, ‏WL:666, ‏WL:699, ‏WL:462, ‏WL:511, ‏WL:886 |
| SI4 אין מועד אחרון לבחירה; מי שלא בחרה מופיעה לטל; לפני ביטול רואים את מי שבסיכון | עובר (+ M4 עובר) | AH:943, ‏BUS:816, ‏BUS:493, ‏BUS:450; ‏T26. הרשימה במסך: M4 |

**סיכום:** כל 35 הסעיפים מסומנים עובר או הוחלף בהחלטה, ואין סעיף שלא עובר. הבדיקות הידניות: M1, ‏M2 ו-M3 עוברות; גם M4 ו-M5 עוברות, על שתי לקוחות בדיקה שנוצרו לשם כך דרך המסכים (פירוט למטה).

## בדיקות ידניות בדפדפן (סשן התכנון, פיתוח מקומי)

### תוצאות (2026-10-30)

סשן התכנון בדק באתר החי, שרץ על אותו קוד ועל מסד הפיתוח, ב-Chrome ברוחב 390×844, כ-dev-customer וכ-dev-admin. בכל בדיקה עצר לפני האישור. אחרי הבדיקות נבדק במסד שלא השתנה כלום: מועד המפגש לא זז, ובחצי השעה האחרונה לא נרשמה שורה ביומן.

- **M1 (P8): עובר.** עוגיית `sb-…-auth-token` קבועה, עם תפוגה ב-2027-12-04 (כ-400 יום), גם ללקוחה וגם לאדמין. סגירת הדפדפן דומתה בהשמטת עוגיות ה-session ובפתיחת context חדש: ‏`/me` ו-`/admin` נפתחו בלי מסך התחברות. החלק "אחרי יותר משעה" לא הורץ; הוא מכוסה בכך שהעוגייה קבועה, וב-T21.
- **M2 (SP4): עובר.** ב-`/admin/payments/new/new-customer` מסומן מראש "ביט" (`paymentMethodId-0`, ‏checked=true), והאחרים לא.
- **M3 (SI2): עובר.** מפגש 3c3cdf28 עם 9 נרשמות. שעת ההתחלה שונתה ל-11:00, ו"לשמור את השינוי" נדחה (EVENT_HAS_BOOKINGS) ופתח את החלון "האם לשנות את מועד המפגש?": מועד נוכחי וחדש, מספר הנרשמות (9) ונוסח ההודעה. הכפתור "שינוי המועד" הוא aria-disabled=true עד שמסמנים את תיבת האישור. במפגש הזה אין לקוחות בסיכון, ולכן לא הוצגה רשימה.
- **M4 (SI4): עובר.** החלון "האם לבטל את המפגש?" נבדק קודם בכל 6 המפגשים העתידיים שיש בהם הרשמות. בכולם הוא מוצג לפני האישור, עם הספירות לפי סוג. באף אחד מהם לא הייתה לקוחה בסיכון. לכן נוצרה, באישור המשתמשת, לקוחת בדיקה דרך המסכים:
  - תשלום ללקוחה חדשה: כרטיסייה ששולמה ב-15.09, בתוקף עד 03.11.
  - ההצטרפות נעשתה דרך הקישור, והלקוחה נרשמה בעצמה למפגש 3c3cdf28 (‏02.11).
  - "ביטול מפגש" הציג "לקוחה אחת עלולה להישאר עם כניסה שאי אפשר לממש", עם השם, "כרטיסייה אישית, בתוקף עד 03.11. אין מפגש מתאים לפני התפוגה", וקישור לכרטיס הלקוחה (`/admin/customers/<id>`).
  - "ביטול המפגש" הוא aria-disabled=true עד שמסמנים את התיבה. הבדיקה נעצרה לפני האישור.
- **M5 (P6): עובר.** גם כאן נוצרה, באישור המשתמשת, לקוחת בדיקה דרך המסכים:
  - תשלום ללקוחה חדשה: כרטיסייה ששולמה ב-10.09, בתוקף עד 29.10. הטופס הציג "תאריך התפוגה כבר עבר. הרכישה תופיע אצל הלקוחה כפגה".
  - ההצטרפות נעשתה דרך הקישור.
  - ב-`/me/purchases` מוצג "תוקף הכרטיסיה פג". כפתור המידע (עם `aria-labelledby`) פתח את ההסבר "עברו 7 שבועות מרכישת הכרטיסיה ולכן פג תוקפה. לבירורים צרי קשר", ו"צרי קשר" הוא קישור ל-`https://wa.me/972…` (‏`target=_blank`, ‏`rel="noopener noreferrer"`).
- **ניקוי אחרי M4 ו-M5:**
  - שתי הרכישות בוטלו דרך "ביטול הרכישה" של טל (סיבה: "בדיקה ידנית של 6.6"), ושני התשלומים במצב `voided`.
  - ההרשמה למפגש 02.11 בוטלה איתן. המפגש חזר ל-9 נרשמות, פורסם, באותו מועד.
  - שתי לקוחות הבדיקה ("בדיקה 6.6 כרטיסייה שפגה", "בדיקה 6.6 לקוחה בסיכון", מייל `check-6-6-*@example.com`) נשארות במסד הפיתוח, בלי רכישה פעילה.

### הצעדים

- **M1 (P8):** להתחבר כ-dev-customer, לפתוח `/me`, לסגור את הדפדפן לגמרי, לפתוח שוב `/me`: אין מסך התחברות. לחזור על זה אחרי יותר משעה. לחזור כ-dev-admin ב-`/admin`.
- **M2 (SP4):** ‏dev-admin ← `/admin/payments/new`, לבחור מוצר: האמצעי הראשון, "ביט", כבר מסומן.
- **M3 (SI2):** במפגש עם הרשמה, לשנות את השעה: עוד לא נשמר כלום. החלון מציג שעה ישנה וחדשה, מספר נרשמות, רשימת מי שבסיכון והודעה לפני האישור, והאישור חסום בלי הצ׳קבוקס. לעצור לפני האישור ולא לשמור.
- **M4 (SI4):** במפגש עם לקוחה בכניסה בודדת, "ביטול מפגש" מציג את רשימת מי שבסיכון, עם קישורים לכרטיסי הלקוחות, לפני האישור. לעצור לפני האישור ולא לשמור.
- **M5 (P6):** בפיתוח מקומי, להתחבר כלקוחה שיש לה כרטיסייה שפגה לפני השיוך, לפתוח `/me/purchases` וללחוץ על כפתור המידע ליד הכרטיסייה שפגה: בחלון ההסבר, "צרי קשר" הוא קישור לוואטסאפ.

## הערות נוסח

- P6, ‏SP8: "לפנות לטל" / "טל תחזור אליה" ← הנוסח במסך הוא "צרי קשר" (UX memlog:119, ‏2026-10-02). ההתנהגות לא השתנתה.
- B9 סותר את שורות 48 ו-234 במסמך המקור. גוברת ההחלטה המשותפת מ-2026-09-26 (memlog:194). כלל השבוע הראשון החלקי נמצא בהחלטות של spec 3.14 (2026-10-19).
- הניסוח הישן של B6 (קיזוז על ידי אדמין) נשאר ב: `acceptance-criteria.md:27`, ‏`coverage.md:86`, ‏`ARCHITECTURE-SPINE.md:241`, ‏`ARCHITECTURE-SPINE.md:460`. לא נערכו כאן.
