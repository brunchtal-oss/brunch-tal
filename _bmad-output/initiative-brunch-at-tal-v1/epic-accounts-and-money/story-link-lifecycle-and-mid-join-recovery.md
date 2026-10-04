---
id: 4
type: story
title: "Link lifecycle and mid-join recovery — חיי הקישור והתאוששות מתקלה"
parent: epic-accounts-and-money
covers: [CAP-4, CAP-2]
after: [3]
risk: high
status: done
---

# Link lifecycle and mid-join recovery — חיי הקישור והתאוששות מתקלה

## Description

CAP-4, CAP-2: admin_issue_link לקישור חלופי שמבטל את הקודם, מסך /admin/links עם סטטוסים (ממתין, מומש, פג, בוטל) והלקוחה ששויכה, תצוגת קישור שפג או כרטיסייה שפגה עד מילוי הטופס עם פנייה לטל, והמשך ממצב claiming אחרי תקלה באמצע (כולל טוקן תקוע מעל 15 דקות). בא אחרי 2.3 כי שניהם משנים את join.ts.

## Acceptance Criteria

Verify: בדיקות מקצה לקצה: קישור שפג אחרי 48 שעות מציג פנייה לטל והתשלום נשאר; כרטיסייה שתאריך הרכישה שלה ישן מ-49 ימים לא מוארכת בהצטרפות ומוצגת פנייה לטל; קישור חלופי מבטל את הישן; תקלה מדומה אחרי יצירת משתמשת Auth ולפני join_complete ממשיכה בכניסה חוזרת בלי חשבון כפול; פתיחה או תצוגה מקדימה לא צורכות קישור.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-10 (מצבים, תקוע)
- ARCHITECTURE-SPINE.md#ad-21
- brunch_at_tal_charecter.md, §10 (בדיקה מוקדמת מקצה לקצה)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
