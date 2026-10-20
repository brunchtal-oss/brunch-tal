---
id: 11
type: story
title: "Marketing reminders for Tal — תזכורות שיווק לטל"
parent: epic-site-and-communication
covers: [CAP-35, CAP-34]
after: [10]
risk: low
status: done
---

# Marketing reminders for Tal — תזכורות שיווק לטל

## Description

CAP-35, CAP-34: /admin/settings/marketing עם לוח הזמנים (א׳, ג׳, ד׳ ב-09:00, ב׳ וה׳ ב-20:00) ומאגר נוסחים שנערך, marketing_reminder_texts עם המאגר ההתחלתי מ-notification-matrix כנתוני seed ב-migration, job_marketing_reminders שבוחר את הנוסח הישן ביותר ושולח פעם אחת לכל מועד (בלי נוסח פעיל לא נשלח כלום), ופס התזכורת (reminder-strip) בבית האדמין עד שטל סוגרת אותו.

## Acceptance Criteria

Verify: בדיקות: בהרצה כפולה באותו מועד נשלחת תזכורת אחת; שני מועדים רצופים מקבלים נוסחים שונים; המועד נכון בשבוע מעבר שעון קיץ; לקוחה לא יכולה לקרוא את ההתראות האלה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-11 (job_marketing_reminders)
- notification-matrix.md, התראות לטל

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
