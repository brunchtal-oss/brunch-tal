---
id: 3
type: story
title: "Multi-date booking and registration close — בחירה מרובה וסגירת הרשמה"
parent: epic-sessions-and-booking
covers: [CAP-13, CAP-14]
after: [2]
risk: medium
status: done
---

# Multi-date booking and registration close — בחירה מרובה וסגירת הרשמה

## Description

CAP-13, CAP-14: book_sessions(p_items) שנועלת את כל המפגשים מראש לפי סדר המזהים ומחזירה תוצאה לכל תאריך, סגירת ההרשמה העצמית לפי registration_closes_at וזמן השרת, והבחירה המרובה בגיליון ההרשמה.

## Acceptance Criteria

Verify: בדיקות: בקשה שנשלחה לפני 20:00 ביום הקודם ועובדה אחריה נדחית לפי זמן השרת, גם בשבוע מעבר שעון קיץ; בחירה של שלושה תאריכים כשאחד מלא מחזירה הצלחה לשניים וסיבה לשלישי, בלי לגרוע עליו כניסה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-5 (book_sessions)
- ARCHITECTURE-SPINE.md#ad-8

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
