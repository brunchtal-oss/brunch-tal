---
id: 18
type: story
title: "Demo data — נתוני הדגמה בדויים"
parent: epic-site-and-communication
after: [4, 17, 3.12, 4.2, 4.12, 2.10, 2.13]
hitl: true
risk: medium
status: done
---

# Demo data — נתוני הדגמה בדויים

## Description

סקריפט ב-scripts/ שממלא את מסד הפיתוח בלבד בנתונים בדויים: לקוחות, רכישות וזכויות, מפגשים עתידיים ומפגש שהסתיים, הרשמות וביטולים, תוכן האתר ותמונות סינתטיות (לא תמונות אמיתיות של נשים או תינוקות, כי ה-repo ציבורי). כסף, זכויות והרשמות נוצרים דרך ה-RPC הקיימות ולא בכתיבה ישירה לטבלאות. הרצה חוזרת לא משכפלת, וכל נתון ניתן לזיהוי ולמחיקה. כולל מסלול הצגה כתוב למבקרים. מהיקף ההדגמה (החלטת המשתמשת 2026-10-04).

## Acceptance Criteria

Verify: בטלפון: מבקר נכנס עם פרטי הכניסה של הנעילה ורואה אתר מלא, לקוחה בדויה עם כרטיסייה והרשמות, ואדמין עם מפגשים, תפוסה ו"לטיפול"; הרצה שנייה של הסקריפט לא מכפילה נתונים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- demo-scope-2026-10-04.md
- AGENTS.md, מדיניות (נתונים בדויים בלבד)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
