---
id: 3
type: story
title: "Open cards overview — כרטיסיות פתוחות"
parent: epic-admin-and-personal-area
covers: [CAP-42]
after: [2]
hitl: false
risk: medium
status: done
---

# Open cards overview — כרטיסיות פתוחות

## Description

CAP-42: admin_list_open_cards מ-entitlement_balances ומ-booking_allocations (כרטיסיות בתוקף בימים ויתרות פתיחה מיבוא, לא זכויות מוצמדות), /admin/customers/open-cards עם מיון לפי תפוגה וסינונים "יש כניסות פנויות" ו"עומדת לפוג", ולכל כניסה תאריך המפגש והסטטוס או "פנויה"; קישורים לפרופיל ולרישום למפגש (3.4), וקישור מ"עומדות לפוג" בבית האדמין לתצוגה המסוננת.

- Decision (2026-10-10, החלטת המשתמשת): כרטיס הלקוחה נשאר בדיוק כמו שהוא, בלי שורות "בוטלה". ההרשמות שבוטלו נשארות ב"היסטוריית הרשמות". השם בשורת "עומדת לפוג" בבית מוביל לרשימה המסוננת, עם הכרטיסייה מודגשת. הסף הוא "סף עומדת לפוג לטל" מההגדרות, כמו בבית.

## Acceptance Criteria

Verify: בדיקות: כרטיסייה ששלוש כניסות בה נוצלו ואחת משוריינת מופיעה, ואחרי סיום המפגש הרביעי יורדת ונשארת בכרטיס הלקוחה; כרטיסייה שפגה, בוטלה או הוחזרה יורדת; לקוחה מקבלת NOT_AUTHORIZED.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-14 (כרטיסיות פתוחות)
- spec — _bmad-output/implementation-artifacts/spec-4-3-open-cards-overview.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
