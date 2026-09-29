---
type: epic
title: "E1 תשתית: הפעלה והתחברות בטלפון"
parent: initiative-brunch-at-tal-v1
covers: []
after: []
assignee: ""
risk: medium
---

# E1 תשתית: הפעלה והתחברות בטלפון

## Description

השלב הראשון בסדר הבנייה (§11 שלב 1): הקמת הפרויקט, הגדרות העיצוב והמיגרציות, וקודם כל ניסוי הפעלה והתחברות בטלפון בלי שירות הודעות. בסוף האפיק כל סשן בנייה מאוחר יותר מוצא את הבסיס מוכן: הרשאות מסד מפורשות, חוזה RPC אחד, עזרי זמן וכסף, שלוש מעטפות, CI ואתר נעול.

## Outcome

מי שבונה את E2 ואילך לא ממציאה שוב תשתית, והניסוי מוכיח בטלפון אמיתי שהפעלה בקישור חד-פעמי והתחברות עובדות בלי מייל.

## Requirements

לאפיק אין CAP משלו. הוא הבסיס ל-CAP-4 ול-CAP-7 (build-sequence.md).

- E1-R1: הפרויקט תואם ל-Stack ולעץ המקור ב-ARCHITECTURE-SPINE.md, כולל סגירת "פערי E1 מול הקוד" (Deferred). (build-sequence.md E1, spine Stack ו-Structural Seed)
- E1-R2: הגדרות העיצוב: טוקנים, גופנים, RTL ושלוש המעטפות לפי DESIGN.md ו-EXPERIENCE.md. (build-sequence.md E1, AD-2)
- E1-R3: מיגרציות הבסיס: ביטול הרשאות ברירת המחדל, schema `private`, עזרי זמן, כסף וטלפון, idempotency, יומן ושגיאות. (§11 שלב 1, AD-3, AD-5, AD-8, AD-9, AD-17, AD-19)
- E1-R4: ניסוי הפעלה והתחברות בטלפון בלי שירות הודעות. בסיס ל-CAP-4 ול-CAP-7. (§11 שלב 1, AD-10)
- E1-R5: סביבות ותפעול: `SITE_LOCKED`, CI, README, env.example בלי סודות, seed בדוי ו-checklist של Auth. (§11 "למסור בסוף כל שלב", AD-22)

## Done when

1. בטלפון אמיתי, לקוחה בדויה פותחת קישור חד-פעמי, בוחרת סיסמה, מתחברת, סוגרת את הדפדפן ופותחת שוב, ועדיין מחוברת. פתיחה שנייה של אותו קישור לא עובדת.
2. `npm run lint`, `npm run typecheck` ו-`npm test` (בדיקות טהורות) עוברים ב-GitHub Actions. `npm run test:db` רץ מקומית מול מסד הפיתוח, ו-`grants.test.ts` שבו נכשל על כל הרשאה שלא ניתנה במפורש (AD-22).
3. בדיקות העזרים עוברות: בדיוק 48 שעות, סגירה ב-20:00 ביום שלפני סביב מעבר שעון קיץ, סוף יום מקומי, טלפון מקומי ובינלאומי כאותו מספר, וכסף באגורות בלי נקודה צפה.
4. ה-security advisor של Supabase נקי.
5. גרסת preview ב-Vercel עולה מאחורי `SITE_LOCKED` (הנעילה נשארת עד תחילת E5) עם נתונים בדויים בלבד, וה-README מסביר הפעלה, הרשאות והגדרת Auth.

## Boundaries

תשתית בלבד. אין כאן טבלאות עסקיות (מוצרים, תשלומים, מפגשים): כל אפיק מוסיף את הטבלאות שלו ב-migration חדשה. אין מסכים עסקיים. המעטפות מציגות רק פריטי ניווט שהמסך שלהם כבר קיים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/initiative-brunch-at-tal-v1.md
- spec — _bmad-output/specs/spec-brunch-at-tal/build-sequence.md, E1
- spec — _bmad-output/specs/spec-brunch-at-tal/stack.md
- source — brunch_at_tal_charecter.md, §10 (אימות והקמת חשבונות), §11 סדר פיתוח מומלץ
- architecture — _bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md, AD-2, AD-3, AD-4, AD-5, AD-8, AD-9, AD-10, AD-16, AD-17, AD-19, AD-22, Consistency Conventions, Stack, Structural Seed, Deferred
- constraint — _bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md
- design — _bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md, Information Architecture

## Notes

- Decision (2026-09-29): tracer bullet הוא ניסוי ההפעלה בטלפון (סיפור 1), דרך מסלול האיפוס הידני (`purpose = reset`) על לקוחה בדויה. זה קוד אמיתי שנשאר: E2 בונה עליו את ההצטרפות, ו-CAP-7 משתמש בו לאיפוס דרך טל.
- Decision (2026-09-29): הניסוי רץ מול שרת פיתוח ברשת המקומית, כדי שלא יעלה אתר חי לפני שהנעילה קיימת (סיפור 6).
- Decision (2026-09-29): סגירת אפיק בסיפור "Refactor sweep" (ברירת המחדל). אין סוויטת קצה-לקצה נפרדת כאן: בדיקות הקבלה המלאות ב-E6.
- Decision (2026-09-29): סדר הסיפורים שומר על כלל ה-migrations של AD-22 (סשן אחד מחיל migration בכל זמן): 1.3 ואחריו 1.4. 1.2, 1.5 ו-1.6 לא נוגעים במסד ויכולים לרוץ במקביל אחרי 1.1.
- Decision (2026-09-29): אין push ל-main לפני 1.6, כי push מפעיל פריסה לפרודקשן בלי נעילה.
- Decision (2026-09-29): הסקריפט שמנפיק קישור איפוס ב-1.1 הוא כלי dev מחוץ ל-app, ומוחלף ב-`admin_issue_link` ב-2.8. 1.4 מחיל את חוזה ה-RPC (idempotency, יומן) גם על `reset_begin`/`reset_complete`.
- Decision (2026-09-29, רשום ב-memlog של הארכיטקטורה): בדיקות המסד מתחברות ישירות ל-Postgres של dev דרך `pg` (devDependency בלבד), ומחרוזת החיבור רק ב-`.env.local`. 1.3 בונה את התשתית המשותפת.
- Assumption: פרופיל מינימלי (מזהה, שם, `activated_at`, `anonymized_at`) נוצר כאן, ו-E2 מוסיף לו עמודות ב-migration חדשה.
