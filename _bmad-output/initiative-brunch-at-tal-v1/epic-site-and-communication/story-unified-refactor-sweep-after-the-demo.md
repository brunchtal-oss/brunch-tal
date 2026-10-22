---
id: 20
type: story
title: "Unified refactor sweep after the demo — ניקוי מאוחד אחרי ההדגמה"
parent: epic-site-and-communication
after: [2.8, 3.16, 3.17, 3.18, 3.5, 4.3, 4.4, 4.5, 4.6, 4.8, 4.11, 6, 10, 11, 12, 13, 21]
risk: low
status: done
---

# Unified refactor sweep after the demo — ניקוי מאוחד אחרי ההדגמה

## Description

ניקוי אחד במקום ניקויי האפיקים 2.11, 3.15, 4.13 ו-5.14 (החלטת המשתמשת 2026-10-10, completion-plan-2026-10-10.md), על כל מה שנבנה אחרי 5.19, לפי רשומות הבנייה וממצאי הביקורת שנדחו. כולל את הפריטים מ-deferred-work שהיעד שלהם אחד מהניקויים האלה, יישור שמות קובצי המיגרציה לגרסאות ב-supabase_migrations.schema_migrations (כדי ש-6.1 יוכל להריץ את כולן מאפס), ואימות וסימון "נסגר" לפריטי deferred-work שהיעד שלהם סיפור שכבר נבנה. ניקוי נתוני הבדיקה (תיקון 8) עובר לסקריפט חדש ונפרד; את סקריפטי ההדגמה (demo-*.mjs, demo:seed, demo:clear) 5.20 לא משנה ולא מוחק, כי 22 כותב אותם מחדש (החלטת המשתמשת 2026-10-22).

## Acceptance Criteria

Verify: lint, typecheck ו-test עוברים, grants.test.ts וה-advisor נקיים, כל 116 קובצי המיגרציה (ומה שנוסף אחריהם) תואמים לגרסה שלהם במסד, סקריפט הניקוי מוחק רק נתוני בדיקה (test_, פרופיל בלי חשבון), וה-preview עולה מאחורי הנעילה. בלי demo:seed ובלי demo:clear (החלטת המשתמשת 2026-10-22).

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
