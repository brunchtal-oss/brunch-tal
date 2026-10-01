---
id: 3
type: story
title: "Time, money and phone helpers — עזרי זמן, כסף וטלפון"
parent: epic-foundation
covers: [E1-R3]
after: [1]
risk: medium
status: done
---

# Time, money and phone helpers — עזרי זמן, כסף וטלפון

## Description

בסיס ל-CAP-2, CAP-9, CAP-14, CAP-16: עזרי SQL טהורים ב-private (local_day_end, registration_closes_at, cancel_deadline, local_week_start, prep_day, normalize_phone), lib/money.ts ו-lib/time.ts לתצוגה בלבד, ותשתית בדיקות המסד המשותפת (חיבור Postgres ישיר עם pg כ-devDependency ומחרוזת חיבור של dev ב-.env.local בלבד, קידומת test_<run-id> ומחיקה, server-only ממופה לריק ב-Vitest) שכל בדיקת RPC מאוחרת משתמשת בה.

## Acceptance Criteria

Verify: בדיקות מול מסד הפיתוח עוברות לבדיוק 48 שעות, ל-20:00 ביום שלפני בשבוע מעבר שעון קיץ, לסוף היום המקומי ה-49, ולטלפון 054... ו-+972... כאותו E.164; בדיקות טהורות ל-formatAgorot ו-parseShekelsToAgorot עוברות.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md#ad-8
- ARCHITECTURE-SPINE.md#ad-9

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
