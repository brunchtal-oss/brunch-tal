---
type: initiative
title: "בראנץ׳ אצל טל — גרסה ראשונה (בלי סליקה)"
parent: none
covers: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17, CAP-18, CAP-19, CAP-20, CAP-21, CAP-22, CAP-23, CAP-24, CAP-25, CAP-26, CAP-27, CAP-28, CAP-29, CAP-30, CAP-31, CAP-32, CAP-33, CAP-34, CAP-35, CAP-36, CAP-37, CAP-38, CAP-39, CAP-40, CAP-41, CAP-42]
after: []
assignee: ""
risk: high
---

# בראנץ׳ אצל טל — גרסה ראשונה (בלי סליקה)

## Description

אתר שיווקי, אזור אישי ופאנל ניהול על מסד נתונים אחד, לעסק שמארח בראנצ׳ים לנשים בחופשת לידה. ה-SPEC ב-`_bmad-output/specs/spec-brunch-at-tal/` הוא מקור הדרישות (CAP-1 עד CAP-42), ומסמך המקור `brunch_at_tal_charecter.md` גובר עליו בכל סתירה. היוזמה בונה את כל היכולות לפי סדר הבנייה ב-`build-sequence.md`, בשישה אפיקים E1 עד E6. סבב הסליקה (`online-payments.md`) אינו חלק מהיוזמה.

## Outcome

טל מנהלת את העסק מהטלפון: מאשרת תשלום, שולחת קישור, והלקוחה מצטרפת, נרשמת ומבטלת בעצמה. אות ההצלחה הוא ה-Success signal של ה-SPEC: תפוסה, יתרות והחזרים נכונים בלי רשומה כפולה או אבודה, וכל הבדיקות ב-`acceptance-criteria.md` עוברות מול מסד Supabase אמיתי של סביבת בדיקה.

## Done when

1. טל מאשרת תשלום בטלפון ומעתיקה קישור. הלקוחה מצטרפת, נרשמת למפגש ומבטלת. אחר כך טל רואה תפוסה, יתרות והחזרים נכונים, בלי רשומה כפולה או אבודה.
2. כל הבדיקות ב-`acceptance-criteria.md` עוברות מול מסד Supabase אמיתי של סביבת בדיקה.
3. כל CAP-1 עד CAP-42 פעילה בפרודקשן, בפרויקט Supabase נפרד מהפיתוח, עם תוכן אמיתי שטל הזינה ובלי תוכן שיווקי בקוד.
4. יש גיבוי חיצוני, ושחזור ממנו נבדק פעם אחת.
5. טל עברה בדיקה תפעולית מלאה, והאתר נפתח לציבור (בלי noindex).

## Boundaries

האפיקים הולכים לפי סדר הבנייה במקור (§11) וב-`build-sequence.md`: כל אפיק הוא שלב שמסתיים בתהליך שעובד מקצה לקצה. זה פרויקט אחד (repo אחד, מסד אחד, בעלת פיתוח אחת), ולכן הגבול בין האפיקים הוא יכולת ולא צוות או שירות. מחוץ ליוזמה: ה-Non-goals של ה-SPEC, וסבב הסליקה.

- Touch point: Supabase Auth (הגדרות הפרויקט: הרשמה ציבורית כבויה, Confirm email כבוי, redirects) — הגדרה בלבד; owner: epic-foundation
- Touch point: Supabase Storage (buckets `media-drafts`, `media-public`) — הגדרה; owner: epic-site-and-communication
- Touch point: Vercel (env, preview, production, שדרוג תוכנית) — הגדרה; owner: epic-foundation, ובהשקה epic-launch
- Touch point: pg_cron, pg_net, Vault (הרחבות Supabase) — הגדרה; owner: epic-sessions-and-booking מפעילה את pg_cron למשימת סיום מפגש, epic-site-and-communication מוסיפה pg_net, Vault ושאר המשימות
- Touch point: GitHub (Actions ב-CI, והפיכת ה-repo לפרטי) — הגדרה; owner: epic-foundation, ובהשקה epic-launch
- Touch point: Web Push (זוג VAPID לכל פרויקט Supabase) — הגדרה; owner: epic-site-and-communication, ובפרודקשן epic-launch
- Touch point: יעד הגיבוי החיצוני — הגדרה, ייתכן שבתשלום; owner: epic-launch
- Touch point: WhatsApp — קישורים ידניים בלבד (`wa.me`), בלי API; owner: כל אפיק שמציג קישור

מסלול ה-tracer לאורך האפיקים: לקוחה בדויה מתחברת בטלפון (E1), מצטרפת מקישור של טל (E2), נרשמת למפגש ומבטלת (E3), טל רואה אותה בבית האדמין (E4), היא מקבלת תזכורת בפוש (E5), והכול רץ בפרודקשן (E6).

## References

- spec — _bmad-output/specs/spec-brunch-at-tal/SPEC.md, Capabilities, Constraints, Non-goals
- spec — _bmad-output/specs/spec-brunch-at-tal/build-sequence.md, סדר הבנייה והשלמות לפני השקה
- spec — _bmad-output/specs/spec-brunch-at-tal/acceptance-criteria.md
- source — brunch_at_tal_charecter.md, §11 בדיקות קבלה ושלבי בנייה, §12 השלמות לפני השקה
- architecture — _bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md, AD-1 עד AD-23 (ההחלטות שכמה אפיקים חייבים לאמץ)
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md
- coverage — _bmad-output/initiative-brunch-at-tal-v1/coverage.md, מיפוי CAP ובדיקות קבלה לאפיקים

## Notes

- Decision (2026-09-29): שישה אפיקים E1 עד E6 לפי `build-sequence.md`, וכל אחד מפורק לסיפורים כבר עכשיו, לבקשת המשתמשת. אפיק עתידי ייבדק שוב כשיגיע תורו.
- Decision (2026-09-29): סבב הסליקה (`online-payments.md`) לא מפורק עכשיו. הוא יבוא אחרי שייבחר ספק, כיוזמה או אפיק נפרדים. ההכנה שנדרשת כבר עכשיו (חתימת הליבה, עמודות `source`, `provider`, `provider_transaction_id`, אמצעי תשלום שנערכים) נמצאת ב-E2.
- Decision (2026-09-29): ההחלטות שכמה אפיקים חייבים לאמץ כבר נמצאות ב-ARCHITECTURE-SPINE.md (AD-1 עד AD-23). אין צורך בסבב ארכיטקטורה נוסף.
- Assumption: כותרות הסיפורים בפורמט "English — עברית", כי שם הקובץ נגזר מהחלק באנגלית. התיאורים בעברית.
- Assumption: כל אפיק בונה את המסכים שהתהליך שלו צריך כדי לעבוד מקצה לקצה (למשל מסך אישור התשלום ב-E2, גיליון ההרשמה ב-E3). E4 בונה את שאר האדמין והאזור האישי על אותן פונקציות.
- Assumption: הטבלאות והעזרים שכל RPC צריך באותה עסקה (יומן ב-E1, התראות בתוך האפליקציה והגדרות ב-E2) נבנים באפיק הראשון שכותב אליהם, גם כשהמסך שלהם שייך לאפיק מאוחר יותר (AD-1, AD-6, AD-12).
- Decision (2026-09-29): סטיות משיוך ה-CAP ב-build-sequence.md, כי התלויות מחייבות: CAP-9 (שריון, ניצול ותיקונים) ו-CAP-11 (זוגי) ב-E3 ולא ב-E2; CAP-15 (המתנה) כולה ב-E5; CAP-28 ב-E5 כמו שכתוב. הפירוט ב-coverage.md.
- Decision (2026-09-29): נעילת האתר (`SITE_LOCKED`) נשארת ב-E1 עד E4 ומוסרת בתחילת E5 (5.15), ובמקומה noindex עד הפתיחה ב-6.9. זו סטייה מ-AD-22, רשומה ב-memlog של הארכיטקטורה.
- Decision (2026-09-29): טבלת התוכן ורשומת פרטי העסק נוצרות ב-E2 (2.2), ולפני הפרסום הראשון נשמרת גרסה 0 של המדיניות. ראו Notes של epic-accounts-and-money.
- Unknown: איפה נמצאים היום נתוני הלקוחות הקיימות. חוסם רק את היבוא ב-E6 (build-sequence.md).
