---
type: epic
title: "E5 אתר ותקשורת: אתר שיווקי, המתנה, פוש ותזמון"
parent: initiative-brunch-at-tal-v1
covers: [CAP-1, CAP-12, CAP-15, CAP-18, CAP-21, CAP-22, CAP-23, CAP-27, CAP-25, CAP-28, CAP-29, CAP-32, CAP-33, CAP-34, CAP-35, CAP-36, CAP-40, CAP-41]
after: []
assignee: ""
risk: high
---

# E5 אתר ותקשורת: אתר שיווקי, המתנה, פוש ותזמון

## Description

שלב 5 בסדר הבנייה: האתר השיווקי ועריכת התוכן, מדיניות הפרטיות והצהרת הנגישות, ואחר כך רשימת המתנה, PWA, התראות, משימות מתוזמנות והודעה כללית. בסוף האפיק אורחת רואה אתר שכל התוכן בו מגיע מטל, ולקוחה מקבלת בטלפון תזכורת בפוש לפני מפגש, גם כשהאפליקציה סגורה.

## Outcome

האתר מציג את העסק בלי תוכן בקוד, וטל ולקוחותיה מקבלות את ההתראות הנכונות בזמן, פעם אחת (acceptance-criteria.md › התראות ומשימות, ערכים ותוכן שנערכים באדמין).

## Requirements

המקור הממוספר הוא ה-SPEC. האפיק מספק את החלקים האלה:

- CAP-1: האתר הציבורי, בלי נתוני תפוסה ובלי הרשמה לאורחת.
- CAP-12, CAP-41 (חלק): תמונת המפגש ותמונת ברירת המחדל של הקונספט (5.4), ומחיר התצוגה בעמוד הציבורי (5.2).
- CAP-15: רשימת המתנה, כולל הבדיקות בפונקציות של E3 שמשחררות מקום.
- CAP-18 (חלק): המשימה המתוזמנת להשלמת חלופות זיכוי.
- CAP-21: מרכז ההתראות של הלקוחה, סימון נקרא, והפוש. התבניות נבנו ב-E4, והכנסה לתור קיימת מ-E2.
- CAP-22: משימות רקע בשרת (pg_cron, pg_net, Vault) ועובד הפוש.
- CAP-23: PWA.
- CAP-27: תוכן בטיוטה ופרסום, והעלאת מדיה.
- CAP-25, CAP-28: סימון לקוחה לא פעילה, והסינון שלו ברשימת הלקוחות.
- CAP-40 (חלק): גרסת נוסח בקשת התמונות שנשמרת עם האישור.
- CAP-29 (חלק): עמוד מדיניות הפרטיות, עריכה וגרסאות. הצ׳קבוקס בטופס נבנה ב-E2.
- CAP-32: הודעה כללית.
- CAP-33: הצהרת נגישות.
- CAP-34 (חלק): לוח תזכורות השיווק ונוסחיו בהגדרות.
- CAP-35: מרכז ההתראות של טל, התראת כרטיסייה שעומדת לפוג ותזכורות שיווק.
- CAP-36 (חלק): המשימה המתוזמנת שמפעילה את כלל ההארכה מ-E3.

## Done when

1. אורחת בטלפון רואה בית, מפגשים, אודות, איך זה עובד, גלריה, המלצות, קשר, מדיניות ונגישות. כל טקסט ותמונה מגיעים מתוכן שטל פרסמה, שינוי שפורסם מופיע בלי פריסה, וטיוטה או תוכן מוסתר לא מופיעים באף נתיב ציבורי.
2. בתשובות ה-API הציבורי ובעמודים הציבוריים אין שום נתון תפוסה.
3. לקוחה שהתקינה את האפליקציה ואישרה פוש מקבלת תזכורת פעם אחת, 24 שעות לפני המפגש, גם כשהאפליקציה סגורה. כשל פוש לא מבטל הרשמה.
4. כשמתפנה מקום, כל הממתינות מקבלות התראה אחת, ומקום בודד לא מזמין זוג.
5. טל מקבלת תזכורות שיווק בלוח הזמנים (שעון ישראל, גם במעבר שעון קיץ) ו-21 ימים לפני תפוגת כרטיסייה עם כניסות פנויות, כל אחת פעם אחת, ולקוחה לא רואה אותן.
6. האתר פתוח בלי נעילה אבל עם noindex (5.15), והעובד `/api/jobs/push` נקרא מ-pg_cron.

## Boundaries

האתר הציבורי, עורך התוכן, מדיה, התראות, פוש, PWA ומשימות רקע. לא תוכן אמיתי (טל מזינה אותו ב-E6), לא פרויקט הפרודקשן (E6), ולא חיבור API לוואטסאפ (Non-goals).

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/initiative-brunch-at-tal-v1.md
- spec — _bmad-output/specs/spec-brunch-at-tal/SPEC.md, CAP-1, CAP-15, CAP-21 עד CAP-23, CAP-27 עד CAP-29, CAP-32, CAP-33, CAP-35
- spec — _bmad-output/specs/spec-brunch-at-tal/site-map.md, אתר ציבורי, תמונות
- spec — _bmad-output/specs/spec-brunch-at-tal/notification-matrix.md
- spec — _bmad-output/specs/spec-brunch-at-tal/admin-configurable-parameters.md, תוכן האתר הציבורי
- spec — _bmad-output/specs/spec-brunch-at-tal/acceptance-criteria.md, התראות ומשימות; ערכים ותוכן שנערכים באדמין
- source — brunch_at_tal_charecter.md, §3, §5 (רשימת המתנה), §8 התראות ומשימות מתוזמנות
- architecture — _bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md, AD-11, AD-12, AD-13, AD-14, AD-15, AD-16, AD-21, AD-22
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-public-home.html
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/mockups/key-public-session.html
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md (הצהרת נגישות, פוש, התקנה)

## Notes

- Decision (2026-09-29): tracer bullet הוא סיפור 1 (טל עורכת את ההירו, מפרסמת, והוא מופיע בבית בלי פריסה), כי הוא עובר בעורך, בסכמת התוכן, במטמון ובעמוד הציבורי.
- Decision (2026-09-29): ה-PWA (9) בא לפני הפוש (8), כי פוש ב-iPhone דורש התקנה במסך הבית ו-service worker. הפוש הוא החלק הכי פחות ודאי (iPhone, VAPID ו-Vault).
- Decision (2026-09-29): `admin_get_attention_items()` (4.1) מורחב בסדר קבוע: 5.4 (מדיה תקועה), 5.5 (הצהרה שלא פורסמה), 5.8 (פוש שנכשל), 5.10 (משימה שנכשלה, Vault חסר). לכן 5.5 אחרי 5.4, 5.8 אחרי 5.5, ו-5.10 אחרי 5.8.
- Decision (2026-09-29): `/sessions` ועמוד המפגש הציבורי דינמיים, בלי `'use cache'`, כדי ש-E3 לא יצטרך לקרוא ל-`updateTag` בכל שינוי מפגש.
- Decision (2026-09-29, רשום ב-memlog של הארכיטקטורה): נעילת האתר מוסרת בתחילת E5 (5.15), אחרי שהגבלת הקצב של 2.8 קיימת, ובמקומה noindex עד הפתיחה. כך הפוש ב-iPhone נבדק בלי Basic Auth.
- Assumption: רשימת ההמתנה (CAP-15) כולה כאן, ולא ב-E3. ראו Notes של epic-sessions-and-booking.
- Unknown: האם pg_cron מונע השהיה של פרויקט Supabase חינמי (spine Deferred). 5.10 בודק ומדווח; ההחלטה על שדרוג ב-6.1.
