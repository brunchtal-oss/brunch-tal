---
id: 5
type: story
title: "Repeat purchase and amount override — רכישה חוזרת ושינוי סכום"
parent: epic-accounts-and-money
covers: [CAP-6, CAP-2]
after: [2]
risk: medium
status: done
---

# Repeat purchase and amount override — רכישה חוזרת ושינוי סכום

## Description

CAP-6, CAP-2: חיפוש לקוחה לפי שם או טלפון במסך התשלום, אישור ללקוחה קיימת שמוסיף זכות נפרדת ומכניס purchase_repeat לתור, שינוי סכום עם סיבה לא חובה ואישור, רשימת התשלומים /admin/payments, אזהרת תשלום דומה לפני האישור (אותו מוצר, סכום ואמצעי, תאריך רכישה בטווח business_settings.duplicate_payment_window_days שברירת המחדל שלו 7 ונערך בהגדרות, ובלקוחה קיימת גם אותה לקוחה; טל מאשרת במפורש; החלטת משתמשת 2026-10-02), והרכיבים המשותפים sensitive-confirm-dialog ו-lib/admin/sensitive-actions.ts.

## Acceptance Criteria

Verify: בדיקות: כרטיסייה שנייה ללקוחה קיימת נשמרת נפרד ולא משנה את תוקף הראשונה; תשלום דומה בתוך הטווח מציג אזהרה ונשמר רק אחרי אישור מפורש, ומחוץ לטווח בלי אזהרה; שינוי סכום בלי צ׳קבוקס נדחה, עם צ׳קבוקס וסיבה ריקה עובר ונרשם ביומן; שורת notifications מסוג purchase_repeat נוצרת פעם אחת גם ב-retry.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-7
- ARCHITECTURE-SPINE.md#ad-10 (המעטפת של טל)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
