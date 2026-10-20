---
id: 6
type: story
title: "Waitlist — רשימת המתנה"
parent: epic-site-and-communication
covers: [CAP-15, CAP-12]
after: [16, "3.14", "3.10", "3.5"]
risk: high
status: done
---

# Waitlist — רשימת המתנה

## Description

CAP-15, CAP-12: ‏waitlist_entries, ‏join_waitlist ו-leave_waitlist ללקוחה מחוברת גם בלי יתרה, ‏private.notify_waitlist עם waitlist_cycle לפי גודל ההרשמה, ב-migration חדשה שמגדירה מחדש את הליבות (cancel_core, ‏book_core), את bind_purchase, ‏admin_update_event (העלאת מכסה), ‏admin_cancel_event (הממתינות יוצאות בשקט, החלטת המשתמשת 2026-10-20) ואת claim_push_jobs (בדיקה חוזרת של waitlist_spot לפני שליחה). ממתינות בפרטי המפגש באדמין, קבוצה "רשימת ההמתנה" ב"ההרשמות שלי", הצטרפות ויציאה בעמוד המפגש. מהבדיקה בטלפון (החלטות המשתמשת 2026-10-20): נוסח ההתראה בלי "צריך כניסה מתאימה", "המקום כבר נתפס" בפעמון, והצעת פוש בעמוד המפגש למי שההתראות לא מופעלות אצלה. ניקוי רשומות של מפגשים שעברו תועד בשביל 5.10, והסרת פרטים בשביל 4.6.

## Acceptance Criteria

Verify: בדיקות: אי אפשר להיות פעמיים ברשימה או גם רשומה וגם ממתינה; הרשמה מוצלחת מוציאה מהרשימה; מקום בודד לא מזמין זוג; פינוי אחד לא שולח שתי התראות לאותה ממתינה; לקוחה בלי כניסה מצטרפת להמתנה אבל לא נרשמת; אורחת לא יכולה להצטרף.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- spec — _bmad-output/implementation-artifacts/spec-5-6-waitlist.md
- ARCHITECTURE-SPINE.md#ad-14 (רשימת המתנה), ‏#ad-12 (waitlist_spot)
- brunch_at_tal_charecter.md, §5 רשימת המתנה

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
