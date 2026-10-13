---
id: 5
type: story
title: "Couple and intro bookings — הרשמה זוגית והיכרות"
parent: epic-sessions-and-booking
covers: [CAP-11, CAP-10, CAP-21]
after: [11, 7]
risk: medium
status: done
---

# Couple and intro bookings — הרשמה זוגית והיכרות

## Description

CAP-11, CAP-10, CAP-21: הרשמה זוגית שתופסת 2 מקומות ורק בזכות או בזיכוי זוגיים, שדה תזונה למלווה בפרטי ההרשמה ב-/me/bookings (גם להרשמה שטל יצרה באישור התשלום), התראת booking_confirmed להרשמה זוגית שמובילה לפרטי ההרשמה ומזכירה לעדכן שם את תזונת המלווה (באזור האישי עכשיו, ובפוש מ-5.8), ובדיקות היכרות בהרשמה (הרשמת היכרות פעילה אחת). אין קיזוז זוגי מכרטיסייה, גם לא בידי טל (החלטת המשתמשת 2026-10-10, memlog של ה-SPEC). בא אחרי 3.7, כי הרשמה זוגית עצמית ממומנת מזיכוי זוגי.

נבנה גם (החלטות המשתמשת 2026-10-13, בדיקה בטלפון): מוצר מוצמד שנשלח ללקוחה קיימת שולח רק את התראת ההרשמה; מסך ההתראות ופתיחת פוש מסמנים "נקראה"; התוויות "בוטל" ו"התקיים".

## Acceptance Criteria

Verify: בדיקות: מפגש זוגי עם מקום אחד מציג "מלא" ללקוחה; כרטיסייה לא מוצעת ללקוחה למפגש זוגי, וגם טל לא יכולה לממן ממנה הרשמה זוגית; אחרי שטל מאשרת מוצר זוגי הלקוחה מקבלת התראה אחת שמובילה לפרטי ההרשמה, ושם היא שומרת את תזונת המלווה; שתי הרשמות היכרות פעילות במקביל נדחות.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- spec — _bmad-output/implementation-artifacts/spec-3-5-couple-and-intro-bookings.md
- ARCHITECTURE-SPINE.md#ad-18
- ARCHITECTURE-SPINE.md#ad-7
