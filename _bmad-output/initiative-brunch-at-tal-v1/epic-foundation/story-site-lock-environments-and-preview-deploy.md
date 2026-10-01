---
id: 6
type: story
title: "Site lock, environments and preview deploy — נעילת אתר וסביבות"
parent: epic-foundation
covers: [E1-R5]
after: [1]
hitl: true
risk: low
status: done
---

# Site lock, environments and preview deploy — נעילת אתר וסביבות

## Description

SITE_LOCKED עם Basic Auth ב-proxy.ts ורשימת prefixes פטורים (/api/jobs/), env.example בלי סודות (כולל הסרת AI_GATEWAY_API_KEY), seed.sql בדוי, README עם checklist של Auth, Vault ו-Vercel ועם הפקודות test ו-test:db, ופריסה ראשונה ל-preview ול-production מאחורי הנעילה, באישור push מהמשתמשת.

## Acceptance Criteria

Verify: כתובות ה-preview וה-production דורשות סיסמה בכל נתיב חוץ מ-/api/jobs/, והניסוי של 1.1 עובר גם דרכן בטלפון.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md#ad-22
- build-sequence.md, למסור בסוף כל שלב

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
