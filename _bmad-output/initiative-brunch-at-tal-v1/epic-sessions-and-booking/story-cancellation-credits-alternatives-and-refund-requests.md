---
id: 7
type: story
title: "Cancellation credits, alternatives and refund requests — זיכויים, חלופות ובקשות החזר"
parent: epic-sessions-and-booking
covers: [CAP-18, CAP-17, CAP-19]
after: [6]
risk: high
status: done
---

# Cancellation credits, alternatives and refund requests — זיכויים, חלופות ובקשות החזר

## Description

CAP-18, CAP-17, CAP-19: cancellation_credits ו-credit_options, private.refresh_credit_options שסופרת מ-origin_starts_at (נקראת גם מהעלאת המכסה של 3.1), ענף הביטול של כניסה בודדת, היכרות וזוגית עם בחירה בין החזר לזיכוי, refund_requests ו-private.monetary_basis שמחושב פעם אחת ביצירת הזיכוי, מימון הרשמה מזיכוי לפני זכות, options_count מההגדרות ברגע היצירה, והרחבת bind_purchase ו-bind-purchase.test.ts לזיכויים ולבקשות החזר. מוסיף ל-admin_get_attention_items של 4.1 את הפריט בקשות החזר פתוחות.

## Acceptance Criteria

Verify: בדיקות: זיכוי מוצמד שבוטל ביום א׳ למפגש של יום ה׳ לא מציע את יום ב׳ ומציע את שני המפגשים המתאימים שאחרי יום ה׳; חלופה שהתמלאה מוחלפת בבאה; בלי מפגשים עתידיים הזיכוי נשאר ממתין; ביטול נוסף מחזיר את אותו זיכוי; כשהלקוחה עצמה תפסה את המקום האחרון הזיכוי לא מתארך; בחירת החזר פותחת בקשה ומבטלת את השימוש בזכות; שינוי מספר החלופות בהגדרות לא משנה זיכוי קיים.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- cancellation-rules.md, זיכוי למפגשים חלופיים
- ARCHITECTURE-SPINE.md#ad-14 (חלופות זיכוי)
- ARCHITECTURE-SPINE.md#ad-20

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
