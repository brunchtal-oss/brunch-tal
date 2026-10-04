---
title: 'Card valid on every weekday — כרטיסייה בלי הגבלת ימים'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['blind-hunter']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** כרטיסייה נחסמת במפגש ביום שאינו שני או חמישי. המשתמשת החליטה (2026-10-04, אחרי הבדיקה בטלפון של 3.2) שהכרטיסייה מוגבלת רק לפי סוג המפגש (רגיל או זוגי), לא לפי יום. ההחלטה גוברת על מקור §2 ("שני וחמישי").

**Approach:** מיגרציה שמנקה את `allowed_weekdays` במוצר הכרטיסייה ובזכויות הכרטיסייה. השדה "ימי מימוש" נשאר במערכת, אבל במסך המוצרים הוא מוסתר מאחורי הקישור "הגבלה לימים מסוימים" (נוסח שאושר). מוצר שכבר מוגבל מציג את השדה. ההחלטה נרשמת ב-memlog של ה-SPEC.

</frozen-after-approval>

## Implementation Notes

הנתיב oneshot: מיגרציית נתונים של שתי שורות ושינוי תצוגה בטופס המוצר, בלי שינוי בפונקציות. המשתמשת בחרה בזה במקום מחיקה מלאה של השדה (כ-20 קבצים ו-drop).

- מיגרציה `20261004200534_card_every_weekday` (נתונים בלבד, בלי drop) הוחלה מה-MCP. ‏`business-settings.test.ts` מצפה עכשיו ל-`null` בכרטיסייה של ה-seed. ההחלטה נרשמה ב-memlog של ה-SPEC וב-`products-catalog.md`.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, ביקורת מקוצרת). patch 2, השאר reject.

| # | ממצא | פסק | ניתוב |
|---|------|-----|-------|
| 1 | הקישור נעלם בלחיצה והפוקוס נופל ל-body; ‏`aria-expanded={false}` קבוע | medium | patch: פוקוס על היום הראשון אחרי פתיחה, בלי `aria-expanded` |
| 2 | אין בדיקה שכרטיסייה בלי הגבלת ימים נרשמת ביום ראשון (הבאג מהטלפון) | medium | patch: בדיקה ב-`self-booking.test.ts` |

Reject (6): במצב סגור לא כתוב "כל הימים" (הקישור עצמו אומר שאין הגבלה); אין דרך לסגור את הבורר (סימון כל השבעה = כל יום, נדיר); fixtures עם `{1,4}` (ההגבלה עדיין קיימת ונבדקת במכוון); אין audit למיגרציה (נתוני פיתוח בדויים, בפרודקשן אין זכויות עדיין); המיגרציה מנקה כל מוצר כרטיסייה (כך ההחלטה: הכרטיסייה לא מוגבלת); בדיקות אינטראקציה (review-accepted).
