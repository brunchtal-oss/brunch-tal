---
id: 1
type: story
title: "Publish hero to home tracer — פרסום ההירו לבית"
parent: epic-site-and-communication
covers: [CAP-27, CAP-1]
after: [2.2, 1.5]
hitl: true
risk: medium
status: done
---

# Publish hero to home tracer — פרסום ההירו לבית

## Description

CAP-27, CAP-1: content_pages ו-content_sections (מרחיבים את הטבלה ואת רשומת פרטי העסק של 2.2), סכמות zod ב-lib/content/schema.ts, admin_publish_content עם גרסה, קריאה ב-'use cache' דרך lib/supabase/public.ts עם cacheTag ו-updateTag, פרטי העסק בטיוטה ופרסום עם קישור אליהם מ-/admin/settings, ו-/admin/content/home עם עריכת ההירו ותצוגה מקדימה.

## Acceptance Criteria

Verify: בטלפון: טל משנה את כותרת ההירו, רואה אותה בתצוגה מקדימה, מפרסמת, והבית מציג אותה בלי פריסה; טיוטה לא מופיעה בבית; בלוק שלא עובר את הסכמה לא מוצג.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-16 (Next, צורת התוכן)
- admin-configurable-parameters.md, תוכן האתר הציבורי
- mockups/key-public-home.html

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
