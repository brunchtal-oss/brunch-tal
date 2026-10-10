---
id: 8
type: story
title: "Concepts admin and themes — קונספטים וערכות עיצוב"
parent: epic-admin-and-personal-area
covers: [CAP-41]
after: [1]
hitl: false
risk: medium
status: done
---

# Concepts admin and themes — קונספטים וערכות עיצוב

## Description

CAP-41: ‏`/admin/concepts` (תחת "עוד") עם רשימה, הוספה, עריכה (שם, תיאור, סוג ברירת מחדל), תמונת קונספט, ארכיון והחזרה, ומחיקה רק לקונספט בלי מפגשים. בלי ערכות צבע וגופן לקונספט (בוטלו בהחלטת המשתמשת 2026-10-04).

## Acceptance Criteria

Verify: בדיקות: קונספט עם מפגשים עובר לארכיון ולא נמחק (CONCEPT_IN_USE), ומפגשי העבר שומרים אותו; שינוי שדה במפגש לא משנה את הקונספט; לקוחה לא רואה קונספט בארכיון.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-16 (קונספטים)
- DESIGN.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-8-concepts-admin.md`.
- מיגרציה `20261010115255_concepts_admin`: ‏`admin_create_concept`, ‏`admin_update_concept`, ‏`admin_set_concept_archived`, ‏`admin_delete_concept` ו-`admin_set_concept_image`.
- החלטות המשתמשת 2026-10-10: שינוי הסוג מותר גם לקונספט עם מפגשים וחל על מפגשים חדשים בלבד; מחיקה דרך חלון אישור, ארכיון בלי. אחרי בדיקת הטלפון הוסר הטקסט הכללי לעמוד מפגש: מפגש בלי תיאור, שגם לקונספט שלו אין תיאור, לא מציג תיאור.
