---
id: 1
type: story
title: "Money schema and payment approval core — סכמת כסף וליבת אישור תשלום"
parent: epic-accounts-and-money
covers: [CAP-2, CAP-9, CAP-34, CAP-37]
after: [1.4, 1.3]
risk: high
status: done
---

# Money schema and payment approval core — סכמת כסף וליבת אישור תשלום

## Description

CAP-2, CAP-9, CAP-34, CAP-37: טבלאות products (עם הקטלוג ההתחלתי וההודעה והכפתור שאחרי ההצטרפות), payment_methods (ביט, פייבוקס, העברה בנקאית, מזומן), payments (עם source, provider, provider_transaction_id ו-product_snapshot), entitlements, entitlement_movements (append-only), ה-view entitlement_balances, business_settings עם ברירות המחדל ו-check constraints (ימים לפני הסגירה ושעות חלון הביטול אי-שליליים, ושעת הסגירה לא בין 00:00 ל-03:00; deferred-work מ-1.3), ו-private.approve_payment_core בחתימה הסופית, admin_approve_payment ו-preview_admin_approve_payment ללקוחה חדשה עם issue_token('join').

## Acceptance Criteria

Verify: בדיקות מסד: אותו מפתח פעמיים יוצר תשלום, זכות וטוקן אחד, והקריאה החוזרת מחזירה reissue_required ולא את הטוקן; התפוגה ב-preview זהה לשמורה; מוצר מוצמד נדחה ב-PINNED_NOT_AVAILABLE; אמצעי מוסתר נדחה; יתרת ה-view שווה למענק; ערך שלילי או שעת סגירה בין 00:00 ל-03:00 ב-business_settings נדחים; לקוחה לא יכולה לכתוב ל-payments, ל-entitlement_movements או ל-role, ולא לקרוא תשלום או זכות של לקוחה אחרת.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-10 (ליבת אישור אחת, עמודות התשלום, אמצעי תשלום)
- ARCHITECTURE-SPINE.md#ad-12
- ARCHITECTURE-SPINE.md#ad-14
- ARCHITECTURE-SPINE.md#ad-15
- products-catalog.md
- notification-matrix.md
- online-payments.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
