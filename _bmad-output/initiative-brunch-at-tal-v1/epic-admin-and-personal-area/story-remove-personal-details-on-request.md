---
id: 6
type: story
title: "Remove personal details on request — הסרת פרטים אישיים"
parent: epic-admin-and-personal-area
covers: [CAP-30]
after: [3, 3.13, 5.6, 5.10]
risk: high
status: done
---

# Remove personal details on request — הסרת פרטים אישיים

## Description

CAP-30: admin_anonymize_customer רגיש ודו-שלבי (ניקוי וסימון anonymization_pending, מחיקת משתמשת Auth, סגירה), שמנקה שם, טלפון, מייל, תינוקות, אלרגיות, payload של התראות, idempotency, guest_details והערות פנימיות, ומשאיר תשלומים והרשמות אנונימיים; anonymization_pending תקוע נוסף ל"לטיפול". מנויי הפוש (5.8) ורשימת ההמתנה (5.6) כבר קיימים כשהוא נבנה (סבב 7, החלטת המשתמשת 2026-10-19), ולכן הוא מנקה גם אותם; נתוני יבוא ב-6.2 מוסיפים את עצמם לפונקציה ולבדיקה שלה. בא אחרי 4.3 כי שניהם משנים את כרטיס הלקוחה. ההסרה חסומה כל עוד יש ללקוחה הרשמה עתידית: טל רואה את ההרשמות, מבטלת אותן בעצמה (החזר או זיכוי), ורק אז מסירה.

## Acceptance Criteria

Verify: בדיקות: אחרי ההסרה אין בשום טבלה או ביומן מידע מזהה של הלקוחה, וסכום הבית ודוח ההחזרים לא השתנו; תקלה אחרי הצעד הראשון ממשיכה ב-retry ומופיעה ב"לטיפול" אחרי 15 דקות. הסרה ללקוחה עם הרשמה עתידית נדחית ומציגה את ההרשמות.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- ARCHITECTURE-SPINE.md#ad-19
- ARCHITECTURE-SPINE.md#ad-21

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
