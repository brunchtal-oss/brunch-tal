---
id: 21
type: story
title: "Customer polish — ליטושים ללקוחה"
parent: epic-site-and-communication
covers: [CAP-22, CAP-23, CAP-1]
after: [7, 8, 9, 16]
risk: low
status: done
---

# Customer polish — ליטושים ללקוחה

## Description

סיפור מסכים קטן מפריטי deferred-work (החלטת המשתמשת 2026-10-10, completion-plan-2026-10-10.md): (1) השבתה של כל הכפתורים שמשנים נתונים כשאין חיבור, גם באדמין, עם הסבר קצר (5.9); (2) הצעה להפעיל פוש אחרי הרשמה ראשונה מוצלחת ("המקום שלך שמור", EXPERIENCE), ושורת "התראות" בפרופיל שמובילה לכרטיס הפוש (5.8); (3) status-chip "רשומה" ב-/sessions הציבורי ללקוחה מחוברת, ברכיב דינמי בתוך Suspense בלי לשבור את המטמון (5.7, 5.16); (4) תיקון 7 ממסמך התיקונים: שדה תזונת המלווה עובר מ"ההרשמות שלי" לעמוד המפגש של הלקוחה (/me/sessions/[id]), ובהתראת האישור הזוגית (booking_confirmed_couple) הנוסח והקישור מפנים לעמוד המפגש; תבנית שטל כבר ערכה לא משתנה. עבר לסבב 5 (החלטת המשתמשת 2026-10-19), כדי שמנגנון ההשבתה בלי רשת יהיה קיים לפני הסיפורים הבאים. דף שגיאה בעברית והגלריה בלי תמונות לא נכנסים (החלטת המשתמשת 2026-10-10).

## Acceptance Criteria

Verify: בטלפון: במצב טיסה הכפתורים שמשנים נתונים מושבתים עם הסבר, וחוזרים כשהרשת חוזרת; אחרי הרשמה ראשונה מוצגת הצעת הפוש פעם אחת, ומי שסירבה לא נשאלת שוב; מהפרופיל מגיעים לכרטיס הפוש; ב-/sessions לקוחה מחוברת רואה "רשומה" על המפגש שלה ואורחת לא רואה. בדיקות: הרשימה הציבורית נשארת במטמון לאורחת.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- EXPERIENCE.md (פרופיל, הצעת הפוש, status-chip)
- deferred-work.md, פריטי 5.7, 5.8 ו-5.9
- spec-5-8-push-pipeline-and-permission.md (החלטה 2)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
