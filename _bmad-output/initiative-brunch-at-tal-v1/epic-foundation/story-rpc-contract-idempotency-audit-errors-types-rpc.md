---
id: 4
type: story
title: "RPC contract: idempotency, audit, errors, types — חוזה RPC"
parent: epic-foundation
covers: [E1-R3]
after: [3]
risk: medium
status: done
---

# RPC contract: idempotency, audit, errors, types — חוזה RPC

## Description

בסיס לכל RPC ול-CAP-26: private.idempotency_results עם idempotent_begin/finish, audit_log עם private.audit ו-audit_diff שמסתירים מידע מזהה, lib/errors.ts, lib/rpc.ts (callRpc), יצירת database.types.ts, ו-supabase/tests/grants.test.ts; ב-migration חדשה הוא מחיל את החוזה גם על reset_begin/reset_complete מ-1.1.

## Acceptance Criteria

Verify: בדיקות מסד מקומיות: קריאה כפולה עם אותו מפתח מחזירה את אותה תוצאה, מפתח עם קלט אחר זורק IDEMPOTENCY_KEY_REUSED, שורת היומן מכילה "<changed>" במקום שם, reset_complete נרשם ביומן בלי טוקן, grants.test.ts נכשל על grant שנוסף בלי כוונה, ולקוחה אחת לא קוראת שורה של אחרת.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md#ad-5
- ARCHITECTURE-SPINE.md#ad-17
- ARCHITECTURE-SPINE.md#ad-19

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
