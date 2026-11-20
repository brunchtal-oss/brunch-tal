---
id: 3
type: story
title: "External backup and restore drill — גיבוי חיצוני ושחזור"
parent: epic-launch
covers: [E6-R4]
after: [11]
hitl: true
risk: medium
status: done
---

# External backup and restore drill — גיבוי חיצוני ושחזור

## Description

E6-R4: גיבוי קבוע של מסד הפרודקשן (ושל ה-bucket הציבורי) למקום חיצוני, והוראות שחזור ב-README; הגיבוי קיים לפני שהתוכן נערך בפרודקשן ולפני שנכנסת לקוחה אמיתית. ההיקף תלוי בתוכנית Supabase שנבחרה בנקודת ההחלטה לפני 6.1 (בתוכנית החינמית אין גיבויים, ומותרים שני פרויקטים בלבד). החלטת המשתמשת 2026-11-01: גיבוי יומי מוצפן ל-repo פרטי ב-GitHub של העסק (לא Google Drive), ומפתח הפענוח רק אצל טל.

## Acceptance Criteria

Verify: תרגיל שחזור מהגיבוי עובר לפני שנכנסים נתונים אמיתיים, ומספרי השורות בטבלאות העיקריות זהים למקור.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-launch/epic-launch.md
- ARCHITECTURE-SPINE.md, Deferred (גיבוי חיצוני ושחזור)

## Notes

- Open question: איפה נשמר הגיבוי ומה הוא עולה, ואיפה רץ תרגיל השחזור (פרויקט שלישי הוא משאב בתשלום, ומסד הפיתוח לא משמש לשחזור); החלטה של המשתמשת.

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
