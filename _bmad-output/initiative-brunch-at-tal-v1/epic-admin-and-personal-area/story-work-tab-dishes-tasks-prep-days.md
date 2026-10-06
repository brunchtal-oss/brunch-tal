---
id: 9
type: story
title: "Work tab: dishes, tasks and prep days — דף עבודה: מנות, משימות וימי הכנה"
parent: epic-admin-and-personal-area
covers: [CAP-38]
after: ["3.4"]
hitl: false
risk: medium
status: done
---

# Work tab: dishes, tasks and prep days — דף עבודה: מנות, משימות וימי הכנה

## Description

CAP-38: ‏`work_sheets`, ‏`work_dishes` ו-`work_tasks` עם `private.ensure_work_sheet` שמעתיקה את ימי ההכנה מההגדרות, ‏`prep_day` לעמודות, "+ יום הכנה" והסרה רק למפגש הזה, ו-`/admin/sessions/[id]/work` עם טבלת מנות × ימים (כרטיס לכל מנה בטלפון), הוספה, עריכה, סידור, מחיקה וסימון בוצע, וקישור ישיר מכרטיס המפגש הבא בבית האדמין. החלטת המשתמשת 2026-10-05 (נכנס להדגמה): לשונית "עבודה" נפרדת בתפריט האדמין שמציגה את שלושת הבראנצ׳ים הקרובים, קישור לדף העבודה מעמוד המפגש, ו-`/admin/sessions/[id]/day` מפנה לדף העבודה.

## Acceptance Criteria

Verify: בדיקות: דף עבודה של בראנץ׳ ביום ה׳ מציג ד׳ וה׳ ושל יום ב׳ מציג א׳ וב׳; יום הכנה שנוסף מופיע רק במפגש הזה; לקוחה לא יכולה לקרוא work_sheets.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-16 (דף עבודה ורשימות)
- mockups/key-admin-worksheet.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-9-work-tab-dishes-tasks-prep-days.md`.
- מיגרציה: `20261006184223_work_sheet` (החלה ב-MCP, advisor ויצירת הטיפוסים: סשן ראשי).
- נבדק: lint, טיפוסים, format, בדיקות יחידה ו-build. בדיקות המסד רצו מול פרויקט הפיתוח בתוך עסקה שהתגלגלה אחורה, לפני החלת המיגרציה. בדיקה בטלפון עוד לא נעשתה.
