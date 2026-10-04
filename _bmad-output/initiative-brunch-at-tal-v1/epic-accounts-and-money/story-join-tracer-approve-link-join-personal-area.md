---
id: 2
type: story
title: "Join tracer: approve, link, join, personal area — אישור, קישור, הצטרפות ואזור אישי"
parent: epic-accounts-and-money
covers: [CAP-2, CAP-4, CAP-29, CAP-40]
after: [12, 1.5, 1.4]
hitl: true
risk: high
status: done
---

# Join tracer: approve, link, join, personal area — אישור, קישור, הצטרפות ואזור אישי

## Description

CAP-2, CAP-4, CAP-29, CAP-40: מסך /admin/payments/new ללקוחה חדשה (מוצר, סכום, תאריך, אמצעי, אסמכתה והערה, תצוגת תפוגה, העתקת קישור), /join/[token] עם token_view (הטוקן עובר קודם דרך lib/auth/clean-token.ts, בדף ובפעולת השמירה, כמו באיפוס ב-1.5), lib/server/privileged/join.ts עם join_begin במסלול claiming בלבד (חשבון קיים והתנגשות ב-2.3), יצירת משתמשת Auth, join_complete ו-private.bind_purchase, השלמת profiles (טלפון ייחודי מנורמל, תינוקות, הרשאות עדכון עצמי לפי עמודות), content_pages עם רשומות למדיניות ולנוסח בקשת התמונות ורשומת פרטי העסק עם המספר 0544256456 (E5 מרחיב אותן), צ׳קבוקס מדיניות חובה וצ׳קבוקס תמונות לא חובה עם הגרסה המפורסמת (0 עד שיתפרסם נוסח), supabase/tests/bind-purchase.test.ts (E3, E5 ו-E6 מרחיבים אותו), ו-/me שמציג את ההודעה והכפתור לפי המוצר, יתרה ותפוגה.

## Acceptance Criteria

Verify: בטלפון: טל מאשרת כרטיסייה ומעתיקה קישור, הלקוחה ממלאת את הטופס בלי לסמן אישור תמונות ומגיעה ל-/me עם 4 כניסות, תפוגה של סוף היום ה-49 מתאריך הרכישה, וההודעה והכפתור של המוצר; שליחה כפולה לא יוצרת חשבון שני, ובלי צ׳קבוקס המדיניות אין חשבון; קישור שהועתק מתוך הודעה בעברית (עם תו כיווניות) נפתח כתקף; ובבדיקות: תקלה אחרי יצירת המשתמשת ב-Auth ולפני join_complete משאירה מצב ביניים, וניסיון חוזר משלים בלי חשבון, זכות או תשלום כפולים (מקור §10, בדיקה מקצה לקצה מוקדמת).

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-10 (הצטרפות, תצוגה)
- ARCHITECTURE-SPINE.md#ad-16 (נתיבי טוקן)
- ARCHITECTURE-SPINE.md, Structural Seed › תהליך ההצטרפות
- mockups/key-admin-payment.html
- products-catalog.md, אחרי ההצטרפות

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
