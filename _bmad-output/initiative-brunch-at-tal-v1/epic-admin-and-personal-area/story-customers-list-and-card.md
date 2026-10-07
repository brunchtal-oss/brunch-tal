---
id: 2
type: story
title: "Customers list and customer card — רשימת לקוחות וכרטיס לקוחה"
parent: epic-admin-and-personal-area
covers: [CAP-25, CAP-9, CAP-40]
after: [1]
hitl: false
risk: medium
status: done
---

# Customers list and customer card — רשימת לקוחות וכרטיס לקוחה

## Description

CAP-25, CAP-9, CAP-40: ‏`admin_list_customers` ו-`admin_get_customer` (חיפוש לפי שם או טלפון, סינון לפי תאריך פעילות אחרון), ו-`/admin/customers/[id]` עם פרופיל, היסטוריה, יתרות ותוקף, התראות, אישור תמונות והערות פנימיות שהלקוחה לא רואה.

## Acceptance Criteria

Verify: בדיקות: חיפוש לפי חלק מהשם או לפי טלפון בכל פורמט מוצא את הלקוחה; סינון לפי תאריך פעילות אחרון מחזיר רק את המתאימות; אישור התמונות מוצג כפי שנשמר; הערה פנימית לא מוחזרת לשום קריאה של הלקוחה; היתרות בכרטיס זהות ל-entitlement_balances.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-3 (מייל רק דרך admin_get_customer)
- site-map.md, פאנל ניהול › לקוחות

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-2-customers-list-and-card.md`.
- מיגרציה `20261006215608_customers_list_and_card`: טבלת `customer_notes` (RLS לאדמין בלבד, בלי כתיבה ל-`authenticated`), ‏`private.customer_last_activity_on`, ‏`private.customer_matches` (כלל החיפוש המשותף, גם ל-`admin_search_customers`), הסוואת גוף ההערה ב-`private.audit_diff`, ‏`admin_list_customers`, ‏`admin_get_customer`, ‏`admin_add_customer_note`, ‏`admin_delete_customer_note`, ו-`customer_id` ב-`expiring_cards` של `admin_get_home`.
- החלטות המשתמשת 2026-10-07: "לקוחות" ראשון ב"עוד" (הסרגל נשאר 5 פריטים); הסינון הוא טווח "פעילות אחרונה מ-… עד …"; הערה: הוספה ומחיקה בלבד; פריטי "לטיפול" לא משתנים.
- אחרי הבדיקה בטלפון (החלטות המשתמשת 2026-10-07, ב-memlog של ה-UX): בלי סינון תאריכים (סטייה מ-§7); חיפוש חי בלי רשימה עד שמקלידים; בלי התראות בכרטיס (סטייה מ-§7); בכרטיס: פרטים ותינוקות ← יתרות ותוקף (כרטיסיות עם פירוט כניסות, ואחריהן כניסות בודדות שלא נוצלו) ← היסטוריית הרשמות ורכישות בעמודים נפרדים ← הערות. מיגרציה שנייה `20261007121030_customers_phone_check`.
