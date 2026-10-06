---
id: 7
type: story
title: "Business settings and notification templates — הגדרות ותבניות התראה"
parent: epic-admin-and-personal-area
covers: [CAP-34, CAP-21]
after: [1]
hitl: false
risk: low
status: done
---

# Business settings and notification templates — הגדרות ותבניות התראה

## Description

CAP-34, CAP-21: ‏`/admin/settings` עם כל ברירות המחדל דרך `value-change-row`, ו-`/admin/settings/templates` לעריכת הכותרת והטקסט של כל סוג התראה. שינוי חלון הביטול חל רק על הרשמות חדשות, וליד השדה מוצגת תזכורת לעדכן את נוסח התנאים. הקישור לפרטי העסק מוביל לתוכן האתר › יצירת קשר.

## Acceptance Criteria

Verify: בדיקות: שינוי מכסת ברירת המחדל משנה רק מפגש חדש; שינוי תבנית משנה רק התראה חדשה; כל שינוי נרשם ביומן עם ערך קודם וחדש; תוקף הקישור (48 שעות) לא מופיע כהגדרה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-admin-and-personal-area/epic-admin-and-personal-area.md
- admin-configurable-parameters.md
- ARCHITECTURE-SPINE.md#ad-15
- notification-matrix.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-4-7-business-settings-and-templates.md`.
- מיגרציה `20261006183915_business_settings_and_templates`: עמודת `notification_templates.allowed_vars` עם seed, קריאת תבניות לאדמין, `private.template_sample_vars`, ‏`admin_update_business_settings` ו-`admin_update_notification_template`. תיקוני ביקורת ב-`20261006194417_business_settings_review_fixes`: בדיקת הגרסה מיד אחרי הנעילה, ו-btrim גם של טאב, שורה חדשה ורווח קשיח.
- החלטת המשתמשת 2026-10-06: כל שינוי הגדרה ותבנית נשמר ב-`value-change-row` (ישן ← חדש, בלי צ׳קבוקס).
- נבדק: lint, טיפוסים, בדיקות, בדיקות מסד, build ו-advisor.
