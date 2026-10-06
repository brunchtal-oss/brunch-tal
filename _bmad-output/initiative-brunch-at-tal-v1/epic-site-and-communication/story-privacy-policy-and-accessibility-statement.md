---
id: 5
type: story
title: "Privacy policy and accessibility statement — מדיניות פרטיות והצהרת נגישות"
parent: epic-site-and-communication
covers: [CAP-29, CAP-33, CAP-40]
after: [4, "4.1"]
hitl: false
risk: low
status: done
---

# Privacy policy and accessibility statement — מדיניות פרטיות והצהרת נגישות

## Description

CAP-29, CAP-33, CAP-40: /privacy ו-/accessibility מתוכן שפורסם, עריכה בטיוטה, תצוגה מקדימה ופרסום עם published_version שנשמרת בהסכמה (וגם גרסת נוסח בקשת התמונות), כללי ההצהרה מ-EXPERIENCE (שדות חובה שחוסמים פרסום, "עודכן לאחרונה" אוטומטי, אי אפשר להסתיר אחרי פרסום, קישורים מהתפריט, מההתחברות, מהפרופיל ומ"עוד"), מצב לפני פרסום ראשון שמציג רק פרטי קשר קיימים, ופריט ב"לטיפול" כל עוד ההצהרה לא פורסמה. כולל עמוד "תנאי שימוש" (/terms) מ-deferred-work.

## Acceptance Criteria

Verify: בדיקות: לפני הפרסום הראשון /accessibility מציג רק פרטי קשר קיימים; כל פרסום של המדיניות מעלה גרסה, והצטרפות אחריו נשמרת עם הגרסה החדשה; שני העמודים נגישים בלי התחברות ומקושרים מהפוטר.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- EXPERIENCE.md, הצהרת נגישות
- ARCHITECTURE-SPINE.md#ad-16
- ARCHITECTURE-SPINE.md#ad-22 ("לטיפול")

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-5-privacy-and-accessibility.md`.
- `join_complete` ו-`set_photo_consent` כבר קוראים את `published_version` בזמן השמירה ולא שונו. המיגרציה זורעת את העמודים והבלוקים ומוסיפה את `accessibility_unpublished` ל"לטיפול".
- הנוסחים של המשתמשת (2026-10-06) נטענו למסד הפיתוח בלבד, לא ל-repo. אחרי הבדיקה בטלפון (החלטות המשתמשת, memlog של ה-UX): כל עמוד משפטי הוא שדה טקסט אחד שמדביקים אליו את כל הנוסח. בהצהרה יש בנוסף שם, טלפון ומייל כשדות חובה. עיצוב הטקסט בטוח: כותרות `## `, פסקאות, רשימות, מודגש, וקישורי https/tel/mailto.
- נבדק: lint, טיפוסים, פורמט, בדיקות יחידה, בדיקות המסד של "לטיפול", ההצטרפות והתוכן, ו-build. ביקורת מלאה (ארבע עדשות), 8 תיקונים, 2 נדחו ל-deferred-work.
