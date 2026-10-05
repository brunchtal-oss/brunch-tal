---
id: 16
type: story
title: "Public session pages — עמודי המפגשים הציבוריים"
parent: epic-site-and-communication
covers: [CAP-1, CAP-41, CAP-12]
after: [2, "3.2"]
hitl: false
risk: medium
status: done
---

# Public session pages — עמודי המפגשים הציבוריים

## Description

CAP-1, CAP-41, CAP-12: /sessions ו-/sessions/[id] (דינמיים, בלי 'use cache', עם הרכיב המשותף מ-3.2), הפריט "הבראנצ׳ים" ב-publicNav אחרי "בית" (כפתור ההירו מופיע מעצמו דרך hasPublicSessions), אזור "הבראנצ׳ים הקרובים" בבית אחרי הפתיח עם 2–3 המפגשים הקרובים (תאריך, קונספט ותמונת אוכל), ומחיר תצוגה או מחיר המוצר בעמוד המפגש, בלי תווית סוג, בלי תפריט ובלי נתון תפוסה. אם 5.4 כבר נבנה, הסיפור לוקח גם את הסתרת whatsapp-bar כל עוד כפתור ההירו גלוי. נפרד מ-5.2 (החלטת המשתמשת 2026-10-04); הפריטים ב-deferred-work.

## Acceptance Criteria

Verify: בדיקות: אורחת מגיעה ל-/sessions ול-/sessions/[id] בלי התחברות; מפגש בטיוטה לא מופיע; תשובת הקריאה הציבורית למפגשים לא מכילה שום שדה תפוסה; מחיר התצוגה מוצג ולא משנה תשלום; הבית מציג עד 3 מפגשים קרובים ושום מפגש כשאין.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- site-map.md, אתר ציבורי
- ARCHITECTURE-SPINE.md#ad-2
- mockups/key-public-session.html
- deferred-work.md, פריטי 5.2 שיעדם 5.16

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-16-public-session-pages.md` (done). PR #36.
- החלטות המשתמשת 2026-10-05: הפריט בתפריט הוא "בראנצ׳ים". המחיר הוא רק מחיר התצוגה (מחיר המוצר נדחה ל-`event_products`). לאורחת: "להרשמה התחברי או צרי קשר", וללקוחה מחוברת: "להרשמה". התיאור (של המפגש, ואחרת של הקונספט) מעל הפעולה, בלי "מגיעות עם התינוקות". בבית הצילום ביחס 5:2, ובהירו אין כפתור.
- הסתרת whatsapp-bar נשארה ב-5.4 (עוד לא נבנה), ו"האזור שלי" וזיהוי הלקוחה במעטפת נשארו ב-5.7.
- נבדק: lint, טיפוסים, בדיקות, בדיקת מסד ו-build, ובדיקה בטלפון כאורחת וכלקוחה מחוברת.
