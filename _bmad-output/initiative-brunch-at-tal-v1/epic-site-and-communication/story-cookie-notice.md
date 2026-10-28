---
id: 23
type: story
title: "Cookie notice — הודעת עוגיות"
parent: epic-site-and-communication
after: [22]
hitl: true
risk: low
status: done
---

# Cookie notice — הודעת עוגיות

## Description

סיפור חדש (החלטת המשתמשת 2026-10-28; מסמך המקור לא מזכיר עוגיות): הודעת עוגיות באתר הציבורי בלבד, כפאנל לא חוסם בתחתית המסך עם כפתור "הבנתי", עד שלוחצים עליו במכשיר הזה (localStorage, המפתח cookie_notice_ack, תוקף 365 ימים). הנוסח הוא בלוק תוכן חדש cookie_notice בעמוד התוכן cookie-notice (כותרת, פסקה וטקסט קישור למדיניות הפרטיות), שנערך ומתפרסם בעורך הקיים, ובלי תוכן שפורסם אין הודעה. אין כפתור סירוב ואין קוד מעקב; hasCookieAck() מוכן ללשונית השיווק העתידית.

## Acceptance Criteria

Verify: בטלפון: ביקור ראשון מציג את ההודעה; הקישור פותח את /privacy; "הבנתי" סוגר, והיא לא חוזרת אחרי רענון ובעמודים אחרים; לא מוצגת ב-/login, /me, /admin; פס הוואטסאפ גלוי מתחתיה; עריכה ופרסום מופיעים בחלון פרטי בלי פריסה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- completion-plan-2026-10-10.md (סבב 9)
- spec-5-23-cookie-notice.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

נבנה ב-spec-5-23-cookie-notice.md: מיגרציית שורות 20261028090046_cookie_notice.sql, הסכמה ב-lib/content/schema.ts, ההחלטה במכשיר ב-lib/cookie-notice.ts, הפאנל ב-components/public/cookie-notice.tsx, ועמוד "הודעת עוגיות" בעורך התוכן.
