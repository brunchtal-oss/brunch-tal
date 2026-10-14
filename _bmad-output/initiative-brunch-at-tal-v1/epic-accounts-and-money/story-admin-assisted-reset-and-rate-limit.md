---
id: 8
type: story
title: "Admin-assisted reset, email and phone change, rate limit — איפוס, מייל וטלפון דרך טל"
parent: epic-accounts-and-money
covers: [CAP-7]
after: [4]
risk: medium
status: done
---

# Admin-assisted reset, email and phone change, rate limit — איפוס, מייל וטלפון דרך טל

## Description

CAP-7: /admin/customers/[id] עם חלק החשבון בלבד, admin_issue_link לאיפוס (מחליף את סקריפט ה-dev של 1.1), admin_change_email דו-שלבי ו-admin_change_phone עם find_identity ויומן, חסימת שינוי עצמי של מייל וטלפון (כולל auth.updateUser מהדפדפן), התחברות דרך Server Action, ומנגנון אחד להגבלת קצב להתחברות ולפעולות טוקן. מוסיף ל-admin_get_attention_items של 4.1 את הפריט email_change_pending תקוע.

## Acceptance Criteria

Verify: בדיקות: שינוי מייל למייל של חשבון אחר נחסם ונרשם ביומן; קישור איפוס לא חושף מידע של לקוחה אחרת; לקוחה לא יכולה לשנות phone_e164 או מייל, גם לא ב-auth.updateUser עם המפתח הציבורי; ניסיונות התחברות רבים מאותו IP נחסמים בהודעה שלא חושפת אם החשבון קיים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-21
- ARCHITECTURE-SPINE.md, Deferred (מנגנון הגבלת הקצב)
- security-and-rpc-rules.md, התחברות, איפוס, טלפון ומייל
- spec — _bmad-output/implementation-artifacts/spec-2-8-admin-assisted-reset-and-rate-limit.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
