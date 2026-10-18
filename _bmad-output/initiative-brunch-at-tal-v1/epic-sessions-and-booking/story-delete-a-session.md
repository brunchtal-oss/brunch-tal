---
id: 17
type: story
title: "Delete a session — מחיקת מפגש"
parent: epic-sessions-and-booking
covers: [CAP-12]
after: [4, 7, "4.10"]
risk: medium
status: done
---

# Delete a session — מחיקת מפגש

## Description

CAP-12, עיקרון 3 (SPEC › Constraints): admin_delete_event רגישה (חלון אישור עם צ׳קבוקס) למפגש בטיוטה ולמפגש שפורסם ועוד לא הסתיים, רק כשאין לו אף שורה ב-bookings ואין רכישה מוצמדת אליו. מפגש שהוא חלופה בזיכוי נמחק, והזיכוי מקבל חלופה אחרת כמו אחרי ביטול (החלטת המשתמשת 2026-10-18). דף העבודה נמחק איתו, והיומן שומר את המצב שלפני, כולל מספר המנות, המשימות ופריטי הקניות. הקישור הישן מציג "המפגש לא נמצא".

## Acceptance Criteria

Verify: בדיקות: טיוטה נמחקת; מפגש שפורסם בלי הרשמות נמחק ונעלם מ-/sessions; מפגש עם הרשמה, גם שבוטלה או שממתינה להצטרפות, נדחה עם קוד שגיאה ובלי שינוי; מחיקה בלי צ׳קבוקס נדחית; לקוחה לא יכולה לקרוא ל-RPC; הרשמה שנכנסת במקביל למחיקה מסתיימת באחת מהשתיים בלבד; ריצה חוזרת עם אותו מפתח idempotency מחזירה את אותה תוצאה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- SPEC.md › Constraints, עיקרון 3
- ARCHITECTURE-SPINE.md#ad-5, #ad-6
- EXPERIENCE.md › חלון אישור לפעולות רגישות
- spec-3-17-delete-a-session.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
