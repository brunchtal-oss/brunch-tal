---
id: 12
type: story
title: "Session completion job — סיום מפגש וניצול"
parent: epic-sessions-and-booking
covers: [CAP-9, CAP-10]
after: [6]
hitl: false
risk: medium
status: done
---

# Session completion job — סיום מפגש וניצול

## Description

CAP-9, CAP-10: הפעלת pg_cron ו-private.job_complete_events שמעבירה מפגש שהסתיים ל-completed, הרשמות ל-completed ומוסיפה תנועות use, כך שאי-הגעה בלי ביטול נחשבת השתתפות. גם הרשמה מוצמדת בלי לקוחה מסתיימת, ו-bind_purchase משייך אותה אחר כך. ‏private.occupied_places סוכמת הרשמות אמיתיות (confirmed או completed). עמוד מפגש שהסתיים מציג ללקוחה שנרשמה "המפגש הסתיים" ו"השתתפת במפגש" (preview_book_session עם EVENT_COMPLETED; החלטות המשתמשת 2026-10-06).

## Acceptance Criteria

Verify: בדיקות: אחרי סיום מפגש הכניסה נוצלה והיתרה תואמת את יומן התנועות; לקוחה שלא הגיעה ולא ביטלה לא זכאית עוד להיכרות; הרצה כפולה של המשימה לא מוסיפה תנועה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-11
- ARCHITECTURE-SPINE.md#ad-14

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-3-12-session-completion-job.md`.
- מיגרציה: `20261006111121_session_completion_job` (הוחלה ב-MCP; ה-cron `complete_events` רץ כל 5 דקות במסד הפיתוח).
- השהיית פרויקט חינמי: pg_cron לא מונע אותה (ראו `unknown` ב-`tickets.toml`); ההחלטה ב-5.10.
- נבדק: lint, טיפוסים, format, בדיקות יחידה, בדיקות מסד, ‏build ו-advisor. בדיקה בטלפון עוד לא נעשתה.
