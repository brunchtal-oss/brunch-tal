---
id: 10
type: story
title: "Work tab: registrants, diet, photo consent, shopping, print — דף עבודה: נרשמות, קניות והדפסה"
parent: epic-admin-and-personal-area
covers: [CAP-38, CAP-40, CAP-41]
after: [9]
hitl: false
risk: low
status: done
---

# Work tab: registrants, diet, photo consent, shopping, print — דף עבודה: נרשמות, קניות והדפסה

## Description

CAP-38, CAP-40, CAP-41: רשימת הנרשמות, העדפות תזונה ואלרגיות כולל המלווה (בלי מי שלא כתבה), אישור התמונות לכל נרשמת, `shopping_items` עם סימון נקנה, הדפסה ב-`@media print` עם כותרת בעיצוב האחיד, בלי עמודה ריקה ועם קו מחיקה לפריט שסומן, וייצוא הקניות ל-`wa.me` עם הפריטים שלא נקנו.

## Acceptance Criteria

Verify: בטלפון ובהדפסה לדפדפן: ההדפסה כוללת מנות ומשימות, נרשמות, תזונה (כולל מלווה), אישור תמונות ורשימת קניות, בלי עמודה ריקה; הייצוא פותח וואטסאפ עם הודעה שמכילה את הפריטים שלא נקנו; הדף מוגש בלי מטמון.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-16 (דף עבודה ורשימות)
- mockups/key-admin-worksheet.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-10-work-tab-registrants-shopping-print.md`.
- מיגרציה: `20261006215720_work_sheet_shopping` (החלה ב-MCP, advisor ויצירת הטיפוסים: סשן ראשי).
- נבדק: lint, טיפוסים, format, בדיקות יחידה ו-build. בדיקות המסד (`shopping-items.test.ts`, ‏`admin-booking.test.ts`, ‏`work-sheet.test.ts`, ‏`grants.test.ts`) רצו מול פרויקט הפיתוח עם המיגרציה בתוך עסקה שהתגלגלה אחורה, לפני החלתה. בדיקה בטלפון והדפסה מהמחשב עוד לא נעשו.
