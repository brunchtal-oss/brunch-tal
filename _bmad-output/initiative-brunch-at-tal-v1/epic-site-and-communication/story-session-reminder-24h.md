---
id: 17
type: story
title: "24-hour session reminder — תזכורת 24 שעות לפני מפגש"
parent: epic-site-and-communication
covers: [CAP-21, CAP-22]
after: [8, "4.7", "3.12"]
hitl: true
risk: medium
status: done
---

# 24-hour session reminder — תזכורת 24 שעות לפני מפגש

## Description

CAP-21, CAP-22: הפעלת job_reminders ב-pg_cron לפי policy_snapshot ו-revision (לא להרשמה בלי לקוחה), שנכנסת לתור notification_jobs ונשלחת בפוש דרך ה-worker של 5.8. פוצל מ-5.10 להדגמה (החלטת המשתמשת 2026-10-04).

## Acceptance Criteria

Verify: בטלפון: לקוחה בדויה עם הרשמה מקבלת תזכורת בפוש כשהאפליקציה סגורה. בדיקות: תזכורת נשלחת פעם אחת, לא להרשמה שבוטלה ולא להרשמה שנוצרה אחרי זמן התזכורת; שינוי זמן התזכורת בהגדרות לא משנה הרשמות קיימות.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md, תזמון ופוש
- notification-matrix.md
- demo-scope-2026-10-04.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-17-session-reminder-24h.md`.
- מיגרציה `session_reminders`: ‏`private.job_reminders()` (definer, בלי grant) שבוחרת כל דקה הרשמות `confirmed` עם לקוחה, במפגש `published` שלא התחיל, כש-`now()` עבר את `starts_at` פחות זמן ההקדמה מה-`policy_snapshot` וההרשמה אושרה לפני המועד הזה. נועלת `for update of b skip locked`, ומכניסה `reminder` לתור עם discriminator ‏`booking_id:revision`. ‏`allowed_vars` של `reminder` קיבל את `concept`, ו-`cron.schedule('reminders', '* * * * *', …)`.
- החלטות המשתמשת 2026-10-07: "לטיפול" לצנרת פוש שלא עובדת נשאר ל-5.10; הבדיקה בטלפון רק ב-Android (פריט האייפון פתוח ב-deferred-work); התזכורות ללקוחה הבדויה במסד הפיתוח נשארות; `concept` נוסף ל-`allowed_vars` בלי שינוי בנוסח.
- בדיקות מסד: `supabase/tests/session-reminders.test.ts` (שורה לכל מקרה במטריצה, נעילה ו-`cron.job`).
