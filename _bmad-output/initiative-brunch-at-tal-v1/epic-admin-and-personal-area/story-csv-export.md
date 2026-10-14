---
id: 4
type: story
title: "CSV export — ייצוא לקוחות"
parent: epic-admin-and-personal-area
covers: [CAP-25]
after: [2]
hitl: false
risk: low
status: done
---

# CSV export — ייצוא לקוחות

## Description

CAP-25: /api/admin/export לאדמין בלבד, עם רשימת עמודות סגורה, בחירה בין מלא לחלקי (הרשימה המסוננת ו/או עמודות שנבחרו), הגנה מפני נוסחאות בתאים, ובלי סודות, טוקנים או מזהי פוש.

- Decision (2026-10-13, החלטת המשתמשת): בקובץ רק שם, טלפון ומייל, ורק לקוחות (בלי קובץ תשלומים או הרשמות). "הרשימה המסוננת" היא תוצאות החיפוש הנוכחי. כל ייצוא נרשם ביומן, בלי טקסט החיפוש. המייל נקרא ב-RPC חדש `admin_export_customers` (חריג ל-AD-3). קידוד UTF-8 עם BOM.

## Acceptance Criteria

Verify: בדיקות: ייצוא חלקי מכיל רק את השורות המסוננות ואת העמודות שנבחרו; תא שמתחיל ב-= נשמר כטקסט; לקוחה מקבלת 403; כל ייצוא נרשם ביומן בלי טקסט החיפוש.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md, Structural Seed (api/admin/export)
- spec — _bmad-output/implementation-artifacts/spec-4-4-csv-export.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
