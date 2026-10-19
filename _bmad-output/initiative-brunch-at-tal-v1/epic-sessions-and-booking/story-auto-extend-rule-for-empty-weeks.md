---
id: 14
type: story
title: "Auto-extend rule for empty weeks — כלל ההארכה בשבוע בלי מפגש"
parent: epic-sessions-and-booking
covers: [CAP-36]
after: [13]
risk: medium
status: done
---

# Auto-extend rule for empty weeks — כלל ההארכה בשבוע בלי מפגש

## Description

CAP-36: private.week_has_eligible_session (מפגש published או completed, לא טיוטה ולא בוטל) ופונקציית הארכה אידמפוטנטית לכל שבוע מקומי שהסתיים (7 ימים, week_start ייחודי לזכות, יומן כפעולת מערכת והתראת entitlement_auto_extended, סוג חדש לפי החלטת המשתמשת 2026-10-19), כולל כרטיסייה שהתפוגה שלה נפלה בתוך השבוע הריק; רק כרטיסייה (לא מוצמד) שנשאר בה משהו; התזמון ב-5.10.

## Acceptance Criteria

Verify: בדיקות: שבוע בלי מפגש מתאים מאריך פעם אחת גם בהרצה חוזרת; שבוע שיש בו רק מפגש זוגי מאריך כרטיסייה רגילה; שבוע שהמפגש היחיד בו בוטל מאריך; שבוע עם מפגש מתאים מלא, או שכבר הסתיים, לא מאריך; שבוע שנוסף בהארכה נבדק גם הוא.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-11 (job_auto_extend)
- ARCHITECTURE-SPINE.md#ad-8 (local_week_start)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
