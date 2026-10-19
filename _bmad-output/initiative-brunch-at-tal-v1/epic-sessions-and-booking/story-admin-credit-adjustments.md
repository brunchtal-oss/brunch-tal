---
id: 16
type: story
title: "Admin credit adjustments — שינוי חלופות והארכת זיכוי בידי טל"
parent: epic-sessions-and-booking
covers: [CAP-18]
after: [10]
risk: medium
status: done
---

# Admin credit adjustments — שינוי חלופות והארכת זיכוי בידי טל

## Description

CAP-18: פעולה רגישה (plan, preview וצ׳קבוקס) שבה טל משנה את החלופות של זיכוי או מאריכה אותו ידנית, עם יומן והתראה ללקוחה, מתוך עמוד הלקוחה או ההרשמה באדמין. בנוסף (החלטת המשתמשת 2026-10-18, מ-3.10): טל יכולה להחליט על החזר כספי במקום זיכוי, על כל זיכוי פעיל (גם אחרי הזזה או ביטול): הזיכוי עובר ל-refund_requested ונפתחת בקשת החזר על monetary_basis_agorot, עם סיבה ויומן.

## Acceptance Criteria

Verify: בדיקות: שינוי חלופות בלי צ׳קבוקס נדחה; אחרי שינוי הלקוחה רואה רק את החלופות החדשות ויכולה להירשם לאחת מהן; השינוי נרשם ביומן עם ערך קודם וחדש.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- cancellation-rules.md, זיכוי למפגשים חלופיים
- admin-configurable-parameters.md
- ARCHITECTURE-SPINE.md#ad-7

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
