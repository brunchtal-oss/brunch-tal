---
id: 13
type: story
title: "Entitlement corrections — תיקונים בזכות מסוימת"
parent: epic-sessions-and-booking
covers: [CAP-9]
after: [12]
risk: medium
status: done
---

# Entitlement corrections — תיקונים בזכות מסוימת

## Description

CAP-9: admin_correct_entitlement (תוקף, יתרה עם קישור אופציונלי למפגש המקורי, ימי מימוש או סוג מפגש) כפעולה רגישה נפרדת לכל תיקון, entitlement_corrections, אזהרה ברשימת ההרשמות העתידיות שכבר לא מתאימות, התראת entitlement_changed, ועמוד הזכות באדמין. מוסיף ל-admin_get_attention_items של 4.1 את הפריט הרשמות שנפגעו מתיקון.

## Acceptance Criteria

Verify: בדיקות: תיקון בלי צ׳קבוקס נדחה; הרשמה אחרי תיקון נבדקת לפי הערכים החדשים; הרשמות עתידיות שלא מתאימות מוצגות לפני האישור ונשארות בדיוק כפי שהיו אחריו; היתרה לא יורדת מתחת לאפס.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-7
- admin-configurable-parameters.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
