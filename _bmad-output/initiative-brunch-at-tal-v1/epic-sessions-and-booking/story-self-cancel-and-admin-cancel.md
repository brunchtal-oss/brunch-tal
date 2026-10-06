---
id: 6
type: story
title: "Self-cancel within 48 hours and admin cancel — ביטול עצמי וביטול דרך טל"
parent: epic-sessions-and-booking
covers: [CAP-16, CAP-17, CAP-10]
after: [4]
hitl: false
risk: medium
status: done
---

# Self-cancel within 48 hours and admin cancel — ביטול עצמי וביטול דרך טל

## Description

CAP-16, CAP-17, CAP-10: private.can_self_cancel ו-cancel_deadline מה-policy_snapshot, cancel_booking בחתימה הסופית (כולל p_choice) עם release לאותה כרטיסייה והתראת booking_cancelled, admin_cancel_booking גם בתוך החלון, ו-/me/bookings עם כפתור ביטול או "צרי קשר". בהדגמה ביטול של מוצר מוצמד (בודדת, היכרות, זוגית) מחזיר את הכניסה כזכות לאחד מ-N המפגשים המתאימים הבאים, עם התראת booking_cancelled_pinned (החלטות המשתמשת 2026-10-05 ו-2026-10-06); ענף הזיכוי וההחזר מחליף את זה ב-3.7.

## Acceptance Criteria

Verify: בדיקות: ביטול בדיוק 48 שעות לפני מצליח ורגע אחרי נחסם בשרת; אחרי ביטול כרטיסייה של 4 כניסות מציגה יתרה נכונה בלי הארכה; שינוי חלון הביטול בהגדרות לא משנה הרשמה קיימת; הרשמת היכרות שבוטלה לפני המפגש לא הופכת את הלקוחה ל"השתתפה".

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-20
- cancellation-rules.md, טבלת תוצאות

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-3-6-self-cancel-and-admin-cancel.md`.
- מיגרציות: `20261005231322_booking_cancelled_pinned_type` (SQL Editor), `20261005232647_cancel_booking`, `20261005234204_cancel_booking_preview_key`.
- נבדק: lint, טיפוסים, format, בדיקות יחידה, בדיקות מסד של `cancel-booking`, ‏build ו-advisor. בדיקה בטלפון עוד לא נעשתה.
