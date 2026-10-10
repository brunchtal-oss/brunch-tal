---
id: 13
type: story
title: "Two photo consents and two-step join form — שתי הסכמות לצילום וטופס הצטרפות בשני שלבים"
parent: epic-accounts-and-money
covers: [CAP-40, CAP-4]
after: [2, 10, 4.2, 4.10]
risk: high
status: done
---

# Two photo consents and two-step join form — שתי הסכמות לצילום וטופס הצטרפות בשני שלבים

## Description

CAP-40, CAP-4 (עודכנו 2026-10-07, החלטת המשתמשת; הפרטים ב-memlog של ה-SPEC ושל ה-UX מאותו יום): הסכמה שנייה ב-profiles לתמונות אישיות (photo_consent הקיימת נשארת תמונות אווירה, כך שלקוחה קיימת מקבלת אישית = לא אישרה), בלי שינוי שם עמודה ובלי drop. פונקציית ההצטרפות דורשת תשובה בשתיהן. מסך השיוך (claim) לא שואל ולא משנה הסכמות. RPC נוספת לשינוי ההסכמה האישית מהפרופיל, לצד set_photo_consent. בלוק התוכן join-form/photo_consent עובר לשתי שאלות והערה, עם הנוסח של המשתמשת מילה במילה, סכמת zod, עורך ותצוגה מקדימה. טופס ההצטרפות בשני שלבים ("הבא" ו"חזרה" בלי מחיקה). שדה האלרגיות בטופס מסומן "(לא חובה)" עם הסבר קטן. תצוגה: הפרופיל עם שתי השאלות, כרטיס הלקוחה ושורת הנרשמת ב"אישרה / לא אישרה תמונות אווירה / אישיות", ולשונית העבודה עם טקסט קצר בלי בועיות ("אווירה ✗ · אישיות ✓", ✗ בצבע warning; החלטת המשתמשת 2026-10-07). מהיקף ההדגמה, סבב 8 מסלול B, לפני 5.18.

## Acceptance Criteria

Verify: בדיקות מסד: הצטרפות עם שתי תשובות נשמרת עם מועד וגרסה; חסרה אחת נדחית ב-INVALID_INPUT; שיוך לא משנה הסכמות; שינוי ההסכמה האישית נרשם ביומן ונדחה ללקוחה שלא הופעלה; grants.test.ts. בטלפון: "הבא" עם שדה ריק מציג שגיאה, "חזרה" שומר ערכים, בלי בחירה לא נשלח, הפרופיל שומר כל הסכמה בנפרד, ולשונית העבודה מציגה את שתי ההסכמות בטקסט הקצר.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- SPEC.md › CAP-40
- spec .memlog.md 2026-10-07
- ux .memlog.md 2026-10-07
- EXPERIENCE.md › קישור הצטרפות — תקף
- ARCHITECTURE-SPINE.md#ad-5
- ARCHITECTURE-SPINE.md#ad-14
- demo-scope-2026-10-04.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
