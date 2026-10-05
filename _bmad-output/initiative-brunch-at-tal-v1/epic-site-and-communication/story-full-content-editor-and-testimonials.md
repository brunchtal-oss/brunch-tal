---
id: 3
type: story
title: "Full content editor and testimonials — עורך התוכן המלא והמלצות"
parent: epic-site-and-communication
covers: [CAP-27]
after: [2]
hitl: false
risk: medium
status: done
---

# Full content editor and testimonials — עורך התוכן המלא והמלצות

## Description

CAP-27: עריכת כל הבלוקים (כותרות סקשנים, הסבר קצר, איך זה עובד, אודות, שאלות נפוצות, גלריה, המלצות כטקסט או כתמונה, נוסח בקשת אישור התמונות, פרטי העסק, הוראות תשלום והגעה, פוטר) עם סידור, הסתרה, טיוטה, תצוגה מקדימה ופרסום, וסינון XSS בטקסט עשיר.

## Acceptance Criteria

Verify: בדיקות: המלצה נוספת כטקסט עם שם או כתמונה עם טקסט חלופי, ונערכת, מסודרת, מוסתרת ונמחקת; תוכן מוסתר לא מופיע באף נתיב ציבורי; חיפוש בקוד לא מוצא טקסט שיווקי בעמודים הציבוריים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- admin-configurable-parameters.md, תוכן האתר הציבורי
- ARCHITECTURE-SPINE.md#ad-16 (צורת התוכן)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-3-full-content-editor-and-testimonials.md`.
- החלטות המשתמשת 2026-10-05: הוראות התשלום יצאו מעורך פרטי העסק (הערך נשאר במסד), הפוטר נכנס לעורך כרשימת קישורים, הסתרת סקשן כדגל `hidden` בטיוטה, אודות היא שורה בעמוד "בית", ונוסח בקשת אישור התמונות נשאר בסיפור. המלצות כתמונה עוברות ל-5.4 (סוג שדה חדש בתיאור השדות).
- נבדק: lint, טיפוסים, פורמט, בדיקות ו-build. הבדיקה בטלפון של המשתמשת עוד לא נעשתה.
