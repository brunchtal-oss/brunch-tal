---
id: 4
type: story
title: "Media upload and publish — העלאת תמונות ופרסומן"
parent: epic-site-and-communication
covers: [CAP-27, CAP-12, CAP-41]
after: [3]
hitl: true
risk: medium
status: done
---

# Media upload and publish — העלאת תמונות ופרסומן

## Description

CAP-27, CAP-12, CAP-41: buckets media-drafts ו-media-public ומדיניות האחסון ב-migration, media_assets עם publish_state, העלאה עם בדיקת סוג וגודל, טקסט חלופי מומלץ (לא חובה) ונקודת מוקד לטלפון, בלי סימון הסכמה (החלטת המשתמשת 2026-10-05, memlog של ה-UX), פרסום דו-שלבי (copying, העתקה, סגירה) והסתרה שמוחקת את הקובץ הציבורי, copying תקוע ב"לטיפול", שדות התמונה של המפגש ושל הקונספט עם הבורר שלהם (בכרטיס ובראש עמוד המפגש מוצגת תמונת המפגש, ואם אין, תמונת הקונספט, דרך photoUrl של components/shared/session-photo.tsx; החלטת המשתמשת 2026-10-04), והגשה בגודל מותאם בלי טעינת כל הגלריה מראש; בבדיקות רק תמונות סינתטיות.

## Acceptance Criteria

Verify: בדיקות: תמונה בלי טקסט חלופי מתפרסמת ומוצגת עם alt ריק (אין סימון הסכמה ואין חובת טקסט חלופי, החלטת המשתמשת 2026-10-05); קובץ ב-media-drafts לא נגיש בכתובת ציבורית; תמונה שהוסרה מוסתרת לפני שהקובץ הציבורי נמחק; תקלה באמצע ההעתקה ממשיכה ב-retry ולא משאירה קובץ יתום.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-16 (מדיה)
- ARCHITECTURE-SPINE.md#ad-21
- site-map.md, תמונות

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md`.
- החלטות המשתמשת 2026-10-05: בהדגמה רק תמונת מפגש (העמודה של הקונספט במסד, הבורר נדחה), נקודת מוקד במקום חיתוך, בלי צ׳קבוקס הסכמה, טקסט חלופי מומלץ ולא חובה, המלצה כצילום מסך שטל ערכה, ותמונות `photos/` במסד הפיתוח דרך `npm run dev:seed-media`. פריט `whatsapp-bar` נסגר כלא רלוונטי.
- נבדק: lint, טיפוסים, פורמט, בדיקות יחידה, בדיקות המסד של המדיה, התוכן והמפגשים, ו-build. ביקורת מלאה (ארבע עדשות), 8 תיקונים.
