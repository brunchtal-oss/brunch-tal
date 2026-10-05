---
id: 2
type: story
title: "Self-booking tracer with a card — הרשמה עצמית בכרטיסייה"
parent: epic-sessions-and-booking
covers: [CAP-13, CAP-9]
after: [1]
hitl: true
risk: high
status: done
---

# Self-booking tracer with a card — הרשמה עצמית בכרטיסייה

## Description

CAP-13, CAP-9: טבלאות bookings ו-booking_allocations (עם האינדקסים הייחודיים החלקיים where customer_id is not null), private.occupied_places ו-is_real_booking, private.plan_funding, private.book_core ו-book_session עם סדר הנעילה של AD-6, שריון ביומן והתראת booking_confirmed, הרחבת private.bind_purchase ו-bind-purchase.test.ts ל-bookings, get_event_availability ל-authenticated בלבד שמחזירה רק תווית, הרכיב המשותף components/shared (כרטיס מפגש וכותרת קונספט), ו-/me/sessions, /me/sessions/[id] וגיליון הרשמה שמציג מה ינוצל, תוקף, מועד הביטול האחרון, וכשהפעולה חסומה את הסיבה ומה אפשר לעשות.

## Acceptance Criteria

Verify: בטלפון: לקוחה בדויה עם כרטיסייה נרשמת ורואה 3 כניסות זמינות ואחת משוריינת, בלי תווית רגיל/זוגי; בדיקת מסד מקבילה של שתי לקוחות על המקום האחרון נותנת אישור אחד; מפגש מחוץ לתוקף הכרטיסייה נחסם עם סיבה; anon לא יכול לקרוא ל-get_event_availability; בדיקת pg_proc.prosrc מוצאת סכימת party_size רק ב-occupied_places.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-6
- ARCHITECTURE-SPINE.md#ad-14
- ARCHITECTURE-SPINE.md#ad-18
- mockups/key-booking-sheet.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-3-2-self-booking-tracer-with-a-card.md` (done). PR #32.
- הפריט שנדחה ל-3.11 (מקומות מול כניסות בזוגי) נסגר ב-3.11.
