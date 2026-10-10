---
id: 19
type: story
title: "Demo refactor sweep — ניקוי מאוחד לפני ההדגמה"
parent: epic-site-and-communication
covers: []
after: [18, 16, 5, 9, 7, "4.7", "4.10"]
hitl: false
risk: low
status: done
---

# Demo refactor sweep — ניקוי מאוחד לפני ההדגמה

## Description

ניקוי אחד, במקום ניקוי בסוף כל אפיק, על כל מה שנבנה עד ההדגמה, לפי רשומות הבנייה וממצאי הביקורת שנדחו. ניקויי האפיקים (2.11, 3.15, 4.13, 5.14) נשארים לאחרי ההגשה ומכסים את מה שייבנה אחריה (החלטת המשתמשת 2026-10-04).

## Acceptance Criteria

Verify: lint, typecheck ו-test עוברים, grants.test.ts וה-advisor נקיים, ומסלול ההצגה של 5.18 עובר מקצה לקצה ב-preview מאחורי הנעילה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- demo-scope-2026-10-04.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-19-demo-refactor-sweep.md`.
- סקריפטים: ‏`dev-seed-media` מתנתק רק מקומית (`scope: "local"`) ומשתמש בשמירת הפיתוח המשותפת. בניית ה-SQL של `demo-clear` עברה ל-`scripts/demo-clear-sql.mjs` (טהורה, נכשלת כשחסרה רשימה או כשאדמין ברשימת מחיקה), ו-`step()` של `demo-seed` עבר ל-`createStep` ב-`demo-plan.mjs`. בדיקות unit: ‏`test/demo-clear.test.ts`, ‏`test/demo-plan.test.ts`, ‏`test/demo-cast.test.ts` (הקאסט תואם לתסריט: E5 ‏10 מתוך 12, ולמאיה כניסה פנויה).
- ניקוי בלי שינוי בהתנהגות, במראה או בנוסח: קוד שגיאה ומפתח נוסח שלא בשימוש נמחקו; ‏`lib/form-values.ts` מאחד עזרים כפולים; ‏`asSaveResult` משותף; ‏`formatSessionDate`, ‏`formatClockTime` ו-`localToday` במקום עותקים; בדיקות ל-`newIdempotencyKey` ול-`toConflictReason`.
- החלטות המשתמשת 2026-10-10: build בלי `.env*` לא נדרש עוד (README); הפריט על כרטיס הלקוחה באדמין ל"סיפור חדש אחרי ההגשה"; שמות קובצי המיגרציה ל-6.1.
