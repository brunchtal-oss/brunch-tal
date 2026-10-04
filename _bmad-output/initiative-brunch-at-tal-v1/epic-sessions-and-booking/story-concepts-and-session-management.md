---
id: 1
type: story
title: "Concepts and session management — קונספטים וניהול מפגשים"
parent: epic-sessions-and-booking
covers: [CAP-12, CAP-41, CAP-34]
after: [2.6, 2.1]
risk: medium
status: done
---

# Concepts and session management — קונספטים וניהול מפגשים

## Description

CAP-12, CAP-41, CAP-34: טבלת concepts עם חמשת הקונספטים ההתחלתיים, טבלת events (שם מהקונספט, מכסה לפי סוג מההגדרות, registration_closes_at עם trigger, revision), admin_create/duplicate/update/publish של מפגש, ו-/admin/sessions עם יצירה, שכפול לטיוטה, עריכה ופרסום; שינוי מכסה, סגירה ומחיר תצוגה דרך value-change-row. שדות התמונה של המפגש ושל הקונספט והבורר שלהם נוספים ב-5.4, עם טבלת המדיה.

## Acceptance Criteria

Verify: בדיקות: מפגש מהקונספט "עם סבתוש" נוצר זוגי עם מכסה 14; מפגש רגיל מקבל 12; טיוטה לא מוחזרת לאף קריאה של לקוחה; שינוי מכסה נרשם ביומן עם ערך קודם וחדש; למפגש אין שדה תפריט.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-8 (registration_closes_at)
- ARCHITECTURE-SPINE.md#ad-15
- ARCHITECTURE-SPINE.md#ad-16 (קונספטים)
- site-map.md, פאנל ניהול › מפגשים

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
