---
id: 12
type: story
title: "Notification core — ליבת ההתראות"
parent: epic-accounts-and-money
covers: [CAP-21]
after: [1]
risk: medium
status: in-progress
---

# Notification core — ליבת ההתראות

## Description

CAP-21: טבלאות notifications (recipient_kind), notification_templates עם הנוסחים ההתחלתיים מ-notification-matrix, notification_jobs, ו-private.enqueue_notification ו-enqueue_admin_notification עם dedupe_key, כך שכל RPC מכניס התראה באותה עסקה; התצוגה ב-5.7 והפוש ב-5.8.

## Acceptance Criteria

Verify: בדיקות מסד: אותה התראה עם אותו discriminator נוצרת פעם אחת; התראה בלי נמענת נדחית; לקוחה קוראת רק התראות שלה; target_path של לקוחה חייב להתחיל ב-/me.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-12
- notification-matrix.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
