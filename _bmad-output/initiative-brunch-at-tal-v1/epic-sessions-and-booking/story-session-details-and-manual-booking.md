---
id: 4
type: story
title: "Session details and manual booking — פרטי מפגש ורישום ידני"
parent: epic-sessions-and-booking
covers: [CAP-12, CAP-14, CAP-6]
after: [3]
risk: medium
status: done
---

# Session details and manual booking — פרטי מפגש ורישום ידני

## Description

CAP-12, CAP-14, CAP-6: /admin/sessions/[id] עם נרשמות, מקומות פנויים, תינוקות, אלרגיות והעדפות (זוגי כשני מקומות; ממתינות נוספות ב-5.6), admin_book_customer לכל תאריך ובכל זמן עם אותן בדיקות מימון ומכסה והתראת booking_confirmed, כניסה לרישום ממסך התשלום אחרי אישור כרטיסייה ומעמוד הלקוחה (היעד של "רישום למפגש" ב-4.3), ותצוגת בוקר המפגש (/day) אונליין בלבד לפי EXPERIENCE.

## Acceptance Criteria

Verify: בדיקות: טל רושמת לקוחה אחרי הסגירה ומצליחה; רישום ידני למפגש מלא נדחה עד שמעלים מכסה; אחרי אישור כרטיסייה טל ממשיכה ישר לרישום לתאריך; דף בוקר המפגש מוגש עם Cache-Control: private, no-store.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- site-map.md, פאנל ניהול › פרטי מפגש
- ARCHITECTURE-SPINE.md#ad-16
- EXPERIENCE.md, Flow 5 (בוקר המפגש)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
