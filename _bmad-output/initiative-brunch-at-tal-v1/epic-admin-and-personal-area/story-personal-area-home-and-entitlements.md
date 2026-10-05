---
id: 12
type: story
title: "Personal area home and entitlement screens — בית האזור האישי ומסכי זכויות"
parent: epic-admin-and-personal-area
covers: [CAP-9, CAP-13]
after: ["3.2"]
hitl: false
risk: low
status: done
---

# Personal area home and entitlement screens — בית האזור האישי ומסכי זכויות

## Description

CAP-9, CAP-13: /me עם המפגש הקרוב והיתרות ותוקפן, ו-/me/profile/entitlements ו-[id] עם זמינות, משוריינות ותפוגה, מתוך אותן RPC של E3; ההרשמות, הזיכויים והחזרים ב-/me/bookings נבנו ב-E3.

## Acceptance Criteria

Verify: בטלפון: אחרי שריון, ביטול וסיום מפגש, מסך היתרה זהה למסך הכרטיסיות הפתוחות של טל; סכומים מוצגים ב-₪.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- site-map.md, אזור אישי
- mockups/key-customer-home.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-12-personal-area-home-and-entitlements.md` (done).
- RPC קריאה חדשה `get_my_entitlements` (מיגרציות `20261005194705` ו-`20261005200619`).
- החלטות המשתמשת 2026-10-05: סמן סוג רק במסכי הזכויות; ה-spec הארוך אושר בלי פיצול.
- החלטת המשתמשת 2026-10-06, אחרי הבדיקה בטלפון (memlog של ה-UX):
  - בבית אין אישורי רכישה.
  - "הבראנצ׳ים הקרובים שלי" מוצגים כרשימת תאריכים לחיצה.
  - בבית מוצגת רק כרטיסייה פעילה, עם "ניצלת X/N · נרשמת Y/N".
  - מסך הזכויות נקרא "היסטוריית רכישות" (`/me/purchases`), ויש לו לשונית בסרגל התחתון.
- החלטת המשתמשת 2026-10-06, בדיקה שנייה בטלפון:
  - בבית אין בלוקי הודעה.
  - בכרטיסייה יש עיגול לכל כניסה.
  - בהיסטוריה לכל רכישה שם, ושורה אחת של מחיר, תאריך רכישה ותוקף, בלי סמן סוג.
  - הלשונית "מפגשים" של הלקוחה נקראת "לו״ז בראנצ׳ים".
- הבדיקה בטלפון הוחלפה בבדיקה מול יומן התנועות במסד, אחרי שריון ואחרי הרשמה מוצמדת. ההשוואה למסך הכרטיסיות הפתוחות ובדיקות אחרי ביטול וסיום מפגש נדחו ל-3.6 ול-3.12 (deferred-work).
- נבדק: lint, טיפוסים, בדיקות (1170), בדיקות מסד של ה-RPC, build ו-advisor.
