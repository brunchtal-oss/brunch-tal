---
id: 8
type: story
title: "Push pipeline and permission flow — פוש והרשאה"
parent: epic-site-and-communication
covers: [CAP-22, CAP-21, CAP-35]
after: [5, 7, 9, "4.1"]
hitl: true
risk: high
status: done
---

# Push pipeline and permission flow — פוש והרשאה

## Description

CAP-22, CAP-21, CAP-35: הפעלת pg_net ו-Vault (app_url של כתובת production קבועה, cron_secret), private.invoke_push_worker ו-job_invoke_push_worker, /api/jobs/push עם Bearer ו-timingSafeEqual, claim_push_jobs ו-finish_push_job עם lease, notification_deliveries, backoff ומחיקת מנוי ב-404/410, register/unregister_push_subscription (כולל בהתנתקות), בקשת הרשאה רק אחרי הסבר ולחיצה ב-/me וב-/admin של טל, הסבר למכשיר שלא תומך, הרחבת הסרת הפרטים למנויים, ו-notification_jobs שנכשלו ב"לטיפול". הנתיב /api/jobs/push נכנס ל-SITE_LOCK_EXEMPT_PREFIXES, כי האתר נעול עד 5.15.

## Acceptance Criteria

Verify: בטלפון (Android ו-iPhone עם האפליקציה במסך הבית): התראה שנכנסה לתור מגיעה תוך דקה כשהאפליקציה סגורה, גם לטל; retry לא שולח שוב למכשיר שקיבל; כשל פוש לא משנה את ההרשמה; בקשה בלי סוד מקבלת 401; מי שסירבה לא נשאלת בכל כניסה; waitlist_spot שהמקום שלו נתפס נסגר בלי שליחה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-11
- ARCHITECTURE-SPINE.md#ad-12 (העובד, מנויים)
- ARCHITECTURE-SPINE.md#ad-22

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-8-push-pipeline-and-permission.md`.
- החלטות המשתמשת 2026-10-06: משימה שנוצרה לפני יותר מ-24 שעות נסגרת `skipped` בלי שליחה (גם 16 שהצטברו מאז 2.2); ההרשאה מוצעת רק בכרטיס במרכזי ההתראות של `/me` ו-`/admin`, שמשמש גם כהגדרות (פרופיל והצעה אחרי הרשמה ראשונה נדחו לסבב העיצוב); בדיקה בטלפון אחרי המיזוג.
- הבדיקה החוזרת של `waitlist_spot` עברה ל-5.6 (demo-scope). הרחבת הסרת הפרטים: מנויים נמחקים עם משתמשת ה-Auth (cascade); ‏`admin_anonymize_customer` של 4.6 ימחק אותם (deferred-work).
- ‏`/api/jobs/` כבר היה ברשימת הפטור מ-1.6.
