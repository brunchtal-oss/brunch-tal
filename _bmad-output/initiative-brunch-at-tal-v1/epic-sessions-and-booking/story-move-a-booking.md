---
id: 10
type: story
title: "Move a booking — הזזת מועד"
parent: epic-sessions-and-booking
covers: [CAP-20]
after: [9]
risk: medium
status: done
---

# Move a booking — הזזת מועד

## Description

CAP-20: move_booking ללקוחה בתוך החלון ולטל בכל זמן, שנועל פרופיל ואז את שני המפגשים לפי סדר המזהים, בודק מקום וזכות ביעד, ומבצע cancel_core ו-book_core בפעולה אחת עם העתקת policy_snapshot והתראות.

## Acceptance Criteria

Verify: בדיקות: הזזה למפגש מלא נכשלת וההרשמה המקורית נשארת בדיוק כפי שהייתה; הזזה מוצלחת לא מעניקה כניסה נוספת; הזזה של מוצר מוצמד מותרת רק לאחת מחלופות הזיכוי.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- cancellation-rules.md, הזזת מועד
- ARCHITECTURE-SPINE.md#ad-6

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
