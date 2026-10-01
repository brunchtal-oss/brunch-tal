---
id: 5
type: story
title: "Design tokens, fonts and the three shells — טוקנים, גופנים ומעטפות"
parent: epic-foundation
covers: [E1-R2]
after: [1]
risk: low
status: done
---

# Design tokens, fonts and the three shells — טוקנים, גופנים ומעטפות

## Description

טוקני הצבע והגופנים מ-DESIGN.md ב-globals.css, ושלוש המעטפות (ציבורית, /me, /admin/(shell)) עם בדיקת תפקיד ב-Suspense דרך get_my_session_role (מ-1.1), /admin/login, תפריט "עוד" (/admin/more) בטלפון, וניווט שמציג רק מסכים קיימים.

## Acceptance Criteria

Verify: בטלפון: /me מפנה ל-/login כשאין התחברות, /admin מפנה ל-/admin/login ללקוחה, והמעטפות מוצגות RTL בגופנים ובצבעים של DESIGN.md.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md#ad-2
- ARCHITECTURE-SPINE.md#ad-16
- DESIGN.md
- EXPERIENCE.md, Information Architecture

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
