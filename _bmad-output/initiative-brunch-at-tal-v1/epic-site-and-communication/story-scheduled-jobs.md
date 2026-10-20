---
id: 10
type: story
title: "Scheduled jobs: expiry alerts, auto-extend, cleanup — משימות מתוזמנות"
parent: epic-site-and-communication
covers: [CAP-21, CAP-22, CAP-35, CAP-36, CAP-18]
after: [17, "3.14", "3.16", "4.7"]
hitl: true
risk: medium
status: done
---

# Scheduled jobs: expiry alerts, auto-extend, cleanup — משימות מתוזמנות

## Description

CAP-21, CAP-22, CAP-35, CAP-36, CAP-18: job_expiry_alerts (card_expiring ללקוחה ו-admin_card_expiring לטל, ו-credit_expiring ללקוחה 5 ימים לפני שנסגרת ההרשמה לחלופה האחרונה של זיכוי שכל החלופות שלו נקבעו), job_auto_extend שמפעיל את כלל 3.14, job_refresh_credit_options (לפי הכלל של 3.16) ו-job_cleanup, פריט ב"לטיפול" למשימה שנכשלה או שלא רצה בזמן ולערכי Vault חסרים, ובדיקה האם pg_cron מונע השהיה של הפרויקט החינמי.

## Acceptance Criteria

Verify: בדיקות: התראות 21 ו-10 ימים פעם אחת כל אחת ושוב אחרי הארכה; job_refresh_credit_options מחליף חלופה שהתמלאה; job_cleanup מוחק רק מה שעבר את הזמן.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-11, #ad-13, #ad-22
- notification-matrix.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-10-scheduled-jobs.md`.
- מיגרציה `scheduled_jobs` (הוחלה ב-SQL Editor ב-2026-10-20): עמודה `business_settings.credit_expiring_days` (ברירת מחדל 5, בלי שדה בהגדרות; השדה ב-deferred-work לסבב התיקונים), תבנית `credit_expiring`, ‏`private.job_expiry_alerts`, ‏`private.job_refresh_credit_options` (‏`lock_timeout` של 500ms), ‏`private.job_cleanup` (כולל סגירת רשומות המתנה של מפגשים שעברו, לפי הכלל של 5.6), ‏`private.job_intervals`, ושלושה ענפים ב-`admin_get_attention_items`: ‏`job_failed`, ‏`vault_missing`, ‏`push_stuck`. ארבעה `cron.schedule`: ‏`expiry_alerts`, ‏`auto_extend`, ‏`refresh_credit_options`, ‏`cleanup`.
- החלטות המשתמשת 2026-10-20: הימים של התראת הזיכוי בטבלת ההגדרות; ב"לטיפול" משימה באיחור ומשימה כבויה מוצגות באותו נוסח ("{שם}: לא פועל כבר זמן מה", "לבירור יש לפנות לתמיכה הטכנית"), ומשימה שנכשלה פעם אחת "{שם}: לא עבד בפעם האחרונה".
- השהיית פרויקט Free: pg_cron לא מובטח כמונע השהיה; ההחלטה לפני ההשקה (deferred-work, יעד 6.9, ו-README).
- בדיקות מסד: `supabase/tests/scheduled-jobs.test.ts` (29), ועדכונים ב-`settings-and-templates.test.ts` וב-`notifications.test.ts`.
