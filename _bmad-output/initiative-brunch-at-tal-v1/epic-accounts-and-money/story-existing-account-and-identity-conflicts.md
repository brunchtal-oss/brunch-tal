---
id: 3
type: story
title: "Existing account and identity conflicts — חשבון קיים והתנגשויות"
parent: epic-accounts-and-money
covers: [CAP-5, CAP-4]
after: [2]
risk: high
status: done
---

# Existing account and identity conflicts — חשבון קיים והתנגשויות

## Description

CAP-5, CAP-4: private.find_identity, הרחבת join_begin למסלולים existing_account ו-conflict, הפניה ל-/login?next=/join/<token> ו-claim_join, "טל תחזור אלייך" בהתנגשות, ו-BIND_CONFLICT בלי שגיאה טכנית; בדיקות השיוך להיכרות מתווספות ב-3.11, ולהמתנה ב-5.6.

## Acceptance Criteria

Verify: בדיקות מקצה לקצה: קישור עם מייל קיים לא יוצר חשבון ומשייך רק אחרי התחברות; טלפון בלבד לא משייך; טלפון ומייל של שני חשבונות עוצרים ומופנים לטל; claim_join של משתמשת אחרת מחזיר NOT_AUTHORIZED.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-3
- ARCHITECTURE-SPINE.md#ad-10 (חשבון קיים, שיוך רכישה)
- acceptance-criteria.md, השלמות › תשלום, אמצעי תשלום ושיוך רכישה

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
