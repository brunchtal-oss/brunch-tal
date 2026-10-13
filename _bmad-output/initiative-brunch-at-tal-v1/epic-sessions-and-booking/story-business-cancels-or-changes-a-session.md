---
id: 8
type: story
title: "Business cancels or changes a session — ביטול או שינוי מפגש מצד העסק"
parent: epic-sessions-and-booking
covers: [CAP-12, CAP-17, CAP-18]
after: [7]
risk: high
status: done
---

# Business cancels or changes a session — ביטול או שינוי מפגש מצד העסק

## Description

CAP-12, CAP-17, CAP-18: preview ו-admin_cancel_event רגישים שנועלים לפי AD-6 (פרופילי הנרשמות, אחר כך המפגש) ומציגים את מי שעלולה להישאר עם זכות שאי אפשר לממש, זיכוי עם choice_pending ו-choose_credit_outcome בלי מועד אחרון עם מסך הבחירה ללקוחה, שינוי תאריך או שעה עם תצוגת השפעה, ונוסח הודעה מהתבנית שטל עורכת לפני השליחה (event_cancelled, event_changed), גם להרשמה שמורה שעוד לא הצטרפה. מוסיף ל-admin_get_attention_items של 4.1 את הפריט choice_pending. מחיקת מפגש בלי הרשמות נמצאת ב-3.17.

## Acceptance Criteria

Verify: בדיקות: ה-preview מציג לפני האישור את מי שתישאר עם זכות שאי אפשר לממש; ביטול מפגש יוצר לכל נרשמת זיכוי או release לפי סוג הזכות והתראה אחת; מי שלא בחרה מופיעה לטל; מפגש מוצמד שבוטל לפני ההצטרפות מופיע אצל הלקוחה אחרי ההצטרפות עם זיכוי, בחירה והתראה; cancel_booking ו-admin_cancel_event במקביל לא נתקעים; ביטול בלי צ׳קבוקס נדחה. תזכורת שכבר תוזמנה (5.17) מחושבת מחדש אחרי שינוי שעה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-7 (נוסח מתבנית)
- ARCHITECTURE-SPINE.md#ad-12 (events.revision)
- cancellation-rules.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
