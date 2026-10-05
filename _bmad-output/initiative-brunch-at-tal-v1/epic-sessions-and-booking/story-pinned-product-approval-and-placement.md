---
id: 11
type: story
title: "Pinned product approval and placement — אישור מוצר מוצמד ושריון המקום"
parent: epic-sessions-and-booking
covers: [CAP-37, CAP-2, CAP-6, CAP-4, CAP-10, CAP-11]
after: [2, "2.3", "2.5"]
hitl: false
risk: high
status: done
---

# Pinned product approval and placement — אישור מוצר מוצמד ושריון המקום

## Description

CAP-37, CAP-2, CAP-6, CAP-4, CAP-10, CAP-11: הסרת PINNED_NOT_AVAILABLE, private.place_pinned_booking, בחירת מפגש במסך אישור התשלום ללקוחה חדשה וקיימת, הרשמה עם customer_id ריק שנספרת במכסה ומוצגת "ממתינה להצטרפות", מעבר שלה ב-bind_purchase, בדיקות השיוך להיכרות (השתתפה בעבר, זכות היכרות פעילה אחת באינדקס ייחודי), זכות זוגית עם 2 מבוגרים, מצב park שנבדק, ו-/me שמציג אחרי ההצטרפות את המפגש שהיא רשומה אליו עם ההודעה והכפתור של המוצר. מוסיף ל-admin_get_attention_items של 4.1 את הפריט "שולם בלי מקום" של park.

## Acceptance Criteria

Verify: בדיקות: אישור מוצמד בלי מפגש או למפגש מלא נכשל בלי ליצור כלום; retry לא מכפיל; ההרשמה השמורה נספרת במכסה לפני ההצטרפות ועוברת ללקוחה בה; קישור היכרות ללקוחה שהשתתפה, או לקוחה קיימת שכבר רשומה לאותו מפגש, מסתיים ב-conflict ומופיע לטל; היכרות שנייה בזמן שיש פעילה נדחית; park שומר תשלום וזכות בלי הרשמה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-23
- ARCHITECTURE-SPINE.md#ad-10 (ליבת אישור אחת, שיוך רכישה)
- acceptance-criteria.md, השלמות › תשלום, אמצעי תשלום ושיוך רכישה

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-3-11-pinned-product-approval-and-placement.md` (done). PR #38.
- החלטות המשתמשת 2026-10-05 (memlog של ה-SPEC ושל ה-UX): היכרות רק ללקוחה בלי אף הרשמה ורק למפגש רגיל; סוג המפגש תמיד לפי הקונספט; בורר המפגשים בלי שעה; הלקוחה רואה את שם הקונספט ברכישה מוצמדת; תיאור במקום "מגיעות עם התינוקות"; "שם לזיהוי" חובה ללקוחה חדשה ואזהרת כפילות רק לשם זהה.
- "שולם בלי מקום" נדחה ל-4.1 ו"ממתינה להצטרפות" ל-3.4 (deferred-work).
- נבדק: lint, טיפוסים, בדיקות (1066), בדיקות מסד (462), build, advisor, ובדיקה בטלפון.
