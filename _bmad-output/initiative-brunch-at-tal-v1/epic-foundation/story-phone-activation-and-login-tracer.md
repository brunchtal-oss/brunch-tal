---
id: 1
type: story
title: "Phone activation and login tracer — ניסוי הפעלה והתחברות בטלפון"
parent: epic-foundation
covers: [E1-R4, E1-R3, E1-R1]
hitl: true
risk: high
status: done
---

# Phone activation and login tracer — ניסוי הפעלה והתחברות בטלפון

## Description

בסיס ל-CAP-7 ול-CAP-4: migration 0001 (ביטול הרשאות ברירת מחדל, schema private), profiles מינימלי, admin_roles, is_admin, current_customer_id ו-get_my_session_role, טבלת activation_tokens עם issue_token/find_token/token_view, reset_begin/reset_complete, מעבר service-client ל-lib/server/privileged עם server-only, lib/server/privileged/reset.ts, והמסכים /reset/[token] (עם Referrer-Policy: no-referrer, no-store ובלי משאבי צד שלישי), /login ו-/me מינימלי. סקריפט dev בלבד (service role, מחוץ ל-app) יוצר אדמין ולקוחה בדויות ב-Auth ומנפיק קישור reset; הוא מוחלף בכפתור admin_issue_link ב-2.8. המשתמשת מכבה ב-Supabase הרשמה ציבורית, Confirm email ו-Automatically expose new tables, ובודקת בטלפון שלה. אין push ל-main לפני 1.6.

## Acceptance Criteria

Verify: בטלפון ברשת המקומית: סקריפט dev מפיק קישור ללקוחה בדויה, היא בוחרת סיסמה, מגיעה ל-/me, נשארת מחוברת אחרי סגירה ופתיחה, ופתיחה חוזרת של הקישור מציגה שהוא כבר מומש.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md#ad-10
- ARCHITECTURE-SPINE.md#ad-4
- ARCHITECTURE-SPINE.md#ad-5
- security-and-rpc-rules.md, הקמת חשבון וקישור
- ARCHITECTURE-SPINE.md#ad-16 (נתיבי טוקן)

## Notes

- Open question: האם cookies של Supabase SSR נשמרים בדפדפן של iPhone ברשת מקומית בלי https; אם לא, הניסוי עובר ל-preview נעול אחרי סיפור 6.

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
