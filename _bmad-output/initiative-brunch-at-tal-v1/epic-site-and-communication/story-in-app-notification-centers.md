---
id: 7
type: story
title: "In-app notification centers — מרכזי התראות בתוך האפליקציה"
parent: epic-site-and-communication
covers: [CAP-21, CAP-35]
after: ["4.12", "2.12"]
hitl: false
risk: low
status: done
---

# In-app notification centers — מרכזי התראות בתוך האפליקציה

## Description

CAP-21, CAP-35: ‏/me/notifications ו-/admin/notifications (פעמון בסרגל העליון) מתוך notifications לפי recipient_id, ‏mark_notifications_read, ויעד (target_path) לכל התראה. הסרגל העליון החדש של האזור האישי והאדמין: צבע משלו, צמוד לראש המסך, ובצד שמאל (inline-end) פעמון עם מונה וכפתור התנתקות. שאר כפתורי ההתנתקות במשטחים האלה יוצאים.

## Acceptance Criteria

Verify: בדיקות: לקוחה לא רואה התראת אדמין גם בפנייה ישירה ל-API; סימון נקרא מתעדכן בשני המכשירים; לחיצה על התראה מובילה ליעד שלה. בטלפון: בכל מסך של האזור האישי והאדמין הסרגל העליון צבעוני ונשאר גלוי בגלילה, והפעמון וההתנתקות בצד שמאל עובדים; אין כפתור התנתקות אחר ואין לשונית התראות בסרגל התחתון.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-12
- notification-matrix.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-7-in-app-notification-centers.md`.
- החלטות המשתמשת 2026-10-06 (memlog של ה-UX): בבית האזור האישי אין סקשן התראות (רק המונה על הפעמון); שם העסק בסרגל ב-inline-start (ימין) ולא במרכז; אפשר לסמן התראה כלא-נקראה (`mark_notifications_unread`). בסרגל של האדמין בלבד, לפני הפעמון: כפתור אייקון "מעבר לאתר" ל-`/` באותה לשונית.
- גם המעטפת הציבורית מכירה לקוחה מחוברת ("האזור שלי", בלי פס וואטסאפ; מ-deferred-work). ה-chips ברשימה הציבורית נדחו.
