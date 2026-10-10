---
id: 7
type: story
title: "Payment methods admin — ניהול אמצעי תשלום"
parent: epic-accounts-and-money
covers: [CAP-34, CAP-2]
after: [6]
risk: low
status: dropped
---

# Payment methods admin — ניהול אמצעי תשלום

## Description

CAP-34, CAP-2: /admin/settings/payment-methods עם הוספה, שינוי שם, הסתרה והצגה, סידור ומחיקה של אמצעי שלא שימש, שמירה על אמצעי גלוי אחד לפחות, ושם האמצעי מה-snapshot בכל תשלום עבר.

## Acceptance Criteria

Verify: בדיקות: כל שינוי מוצג כישן ← חדש ונרשם ביומן; אמצעי ששימש לא נמחק (PAYMENT_METHOD_IN_USE); הסתרת האמצעי הגלוי האחרון נדחית (LAST_PAYMENT_METHOD); שינוי שם לא משנה את השם בתשלום שכבר אושר; הראשון ברשימה מסומן מראש במסך התשלום.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-10 (אמצעי תשלום)
- online-payments.md
- acceptance-criteria.md, השלמות › תשלום, אמצעי תשלום ושיוך רכישה

## Notes

Dropped: החלטת המשתמשת 2026-10-10 (completion-plan-2026-10-10.md). אמצעי התשלום נשארים ארבעת אלה מה-seed, ושינוי בהם רק ב-SQL.

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
