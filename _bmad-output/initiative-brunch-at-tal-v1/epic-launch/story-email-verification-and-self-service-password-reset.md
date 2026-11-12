---
id: 11
type: story
title: "Email verification and self-service password reset — אימות מייל ואיפוס סיסמה עצמי"
parent: epic-launch
after: [1]
hitl: true
risk: medium
status: done
---

# Email verification and self-service password reset — אימות מייל ואיפוס סיסמה עצמי

## Description

נוסף בהחלטת המשתמשת 2026-11-10, אחרי שנקבע הדומיין morethanfood.co.il. מסמך המקור (§ שחזור סיסמה, ו-§ אימות כתובת המייל ואיפוס סיסמה אוטומטי) מתיר איפוס אוטומטי במייל רק אחרי הגדרת ספק שליחת מיילים ואימות כתובת המייל. עד הסיפור הזה האיפוס נשאר ידני דרך טל. ההיקף: ספק מיילים חינמי (למשל Resend) כ-SMTP של Supabase Auth, רשומות SPF ו-DKIM ב-DNS של הדומיין, אימות כתובת המייל (גם בהצטרפות וגם במילוי הטופס בידי טל, 2.15), עמוד "שכחתי סיסמה" עם hitRateLimit, ונוסחי המיילים בעברית. מייל לא מוצג כמאומת לפני האימות. המפתח של הספק בצד השרת בלבד. נשלף מיד אחרי 6.1 (צריך את פרויקט ה-Supabase של הפרודקשן) ואחרי רכישת הדומיין, לפני 6.3 (החלטת המשתמשת 2026-11-10: לא אחרי המסירה). רשומות ה-DNS של המייל נוספות אצל הרשם בלי קשר לחיבור האתר לדומיין; עד המסירה הקישורים במיילים מפנים לכתובת vercel.app. בשער ה-spec: מה קורה ללקוחות קיימות שהמייל שלהן לא אומת, והאם האיפוס הידני של טל נשאר כגיבוי.

## Acceptance Criteria

Verify: בפרודקשן: מייל אימות ומייל איפוס מגיעים לתיבה (לא לספאם), קישור האיפוס חד-פעמי ופג, מייל שלא אומת לא מקבל קישור איפוס, והגבלת הקצב חוסמת ניסיונות חוזרים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-launch/epic-launch.md
- brunch_at_tal_charecter.md (שחזור סיסמה; אימות מייל ואיפוס אוטומטי)
- ARCHITECTURE-SPINE.md (יצירת חשבון)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
