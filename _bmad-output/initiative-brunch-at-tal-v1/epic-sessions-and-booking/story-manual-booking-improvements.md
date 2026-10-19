---
id: 19
type: story
title: "Manual booking improvements — שיפורי הרישום הידני"
parent: epic-sessions-and-booking
covers: [CAP-14]
after: [4, 5]
risk: medium
status: done
---

# Manual booking improvements — שיפורי הרישום הידני

## Description

החלטת המשתמשת 2026-10-13 (בדיקה של 4.3): במסך הרישום הידני (/admin/sessions/book?customer=) מוצגים רק מפגשים שאפשר לממן מהזכויות של הלקוחה לפי private.plan_funding (למשל מפגש זוגי לא מוצע לכרטיסייה). הסימון "רשומה" והרישום לכמה מפגשים בבת אחת נבנו ב-4.3.

## Acceptance Criteria

Verify: בדיקות: מפגש זוגי לא מוצע ללקוחה שיש לה רק כרטיסייה; מפגש שאפשר לממן ממשיך להופיע; לקוחה מקבלת NOT_AUTHORIZED.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-sessions-and-booking/epic-sessions-and-booking.md
- ARCHITECTURE-SPINE.md#ad-7 (plan_funding)
- spec-4-3-open-cards-overview.md (Spec Change Log)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
