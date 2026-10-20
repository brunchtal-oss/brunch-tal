---
id: 18
type: story
title: "Eligible products per session — מוצרים תקפים למפגש"
parent: epic-sessions-and-booking
covers: [CAP-12]
after: [10, 5, 14, 5.6]
risk: high
status: done
---

# Eligible products per session — מוצרים תקפים למפגש

## Description

CAP-12, מקור §7 (שדות המפגש: "מוצרים תקפים"): הטבלה event_products לפי data-model, שדה בחירה של המוצרים התקפים ביצירה ובעריכה של מפגש (value-change-row, יומן ישן ← חדש), ובדיקה ב-private.plan_funding שזכות ממוצר שלא סומן לא מממנת את המפגש. הבדיקה חלה רק על הרשמות חדשות; הרשמה קיימת לא משתנה. מחיר ברירת מחדל ממחיר המוצר יצא מהסיפור (החלטת המשתמשת 2026-10-20): עמוד המפגש מציג מחיר רק כשיש display_price_agorot, כמו היום. מבטל את הדחייה הזמנית מ-2026-10-04 (memlog של ה-SPEC). נכנס בהחלטת המשתמשת 2026-10-10 (completion-plan-2026-10-10.md). נבנה אחרי 5.6 (סבב 7, החלטת המשתמשת 2026-10-19): מריץ שוב את בדיקות ההרשמה וההמתנה, ומעדכן את private.week_has_eligible_session של 3.14 לפי המוצרים התקפים: לפי CAP-36 ("מפגש שאפשר לממש בו את הכרטיסייה"), מפגש שלא מקבל את המוצר של הכרטיסייה לא נחשב מפגש מתאים בשבוע.

## Acceptance Criteria

Verify: בדיקות: מפגש שסומן בו רק מוצר אחד לא ממומן מכרטיסייה ממוצר אחר, בהרשמה עצמית ובהרשמה של טל, עם סיבה ברורה; הרשמה שקיימת לפני השינוי נשארת; שינוי הסימון נרשם ביומן; לקוחה לא כותבת ל-event_products.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- brunch_at_tal_charecter.md, §7 מפגשים (שורה 254)
- data-model.md (event_products)
- ARCHITECTURE-SPINE.md#ad-18
- spec .memlog.md 2026-10-04 (story 3.1)
- deferred-work.md, פריטי event_products ומחיר ברירת המחדל

## Notes

- Open question: מה המשמעות של מפגש בלי שום מוצר מסומן (כל המוצרים המתאימים, כמו היום, או אף אחד), ואיזה מחיר מוצג כשכמה מוצרים תקפים; נקבע ב-spec עם המשתמשת.

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
