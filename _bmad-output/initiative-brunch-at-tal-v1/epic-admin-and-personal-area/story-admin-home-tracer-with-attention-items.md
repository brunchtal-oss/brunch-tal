---
id: 1
type: story
title: "Admin home tracer with attention items — בית האדמין ו\"לטיפול\""
parent: epic-admin-and-personal-area
covers: [CAP-24]
after: ["3.4"]
hitl: true
risk: medium
status: done
---

# Admin home tracer with attention items — בית האדמין ו"לטיפול"

## Description

CAP-24: ‏`/admin` עם המפגש הבא והמפגשים שאחריו ותפוסתם, "לטיפול" (`admin_get_attention_items` כמקור יחיד), תשלומים אחרונים, כרטיסיות שעומדות לפוג לפי הסף בהגדרות, והסכום "תשלומים שאושרו פחות החזרים" שמחושב ב-SQL. מוצגים רק פריטים שהמקור שלהם כבר קיים; כל סיפור עתידי מוסיף את הפריט שלו.

## Acceptance Criteria

Verify: בטלפון, על נתונים בדויים מ-E2 ו-E3: כל רשימה בבית תואמת את מה שבמסד, והמילים "רווח" ו"הכנסה" לא מופיעות; בדיקה: לקוחה שקוראת ל-admin_get_attention_items מקבלת NOT_AUTHORIZED.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-22 ("לטיפול")
- ARCHITECTURE-SPINE.md#ad-9
- mockups/key-admin-home.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-1-admin-home-and-attention-items.md`.
- מיגרציה `20261005225116_admin_home.sql`: ‏`admin_get_attention_items()` (‏`link_conflict`, ‏`link_stuck`, ‏`purchase_without_link`, ‏`paid_without_place`, ‏`pinned_seat_held`, ‏`media_stuck`) ו-`admin_get_home()`.
- הבית: חמישה חלקים ב-`app/admin/(shell)/home/`, כל אחד ב-`<Suspense>` משלו; ‏`task-row` חדש ב-`components/admin/task-row.tsx`.
- נבדק: lint, טיפוסים, בדיקות, בדיקות מסד, build ו-advisor. הבדיקה בטלפון של המשתמשת עוד לא נעשתה.
