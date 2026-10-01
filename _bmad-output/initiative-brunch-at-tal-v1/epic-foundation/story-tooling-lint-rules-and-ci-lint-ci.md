---
id: 2
type: story
title: "Tooling, lint rules and CI — כלים, כללי lint ו-CI"
parent: epic-foundation
covers: [E1-R1, E1-R5]
after: [1]
risk: low
status: done
---

# Tooling, lint rules and CI — כלים, כללי lint ו-CI

## Description

סוגר את שאר פערי E1 מול הקוד: zod, server-only ו-web-push כתלויות, shadcn ל-devDependencies, engines node 24 ו-@types/node ^24 (היום ^26), הסרת --turbopack מ-dev, lib/supabase/public.ts, כללי no-restricted-imports, וכללי no-restricted-syntax החדשים ממוזגים לתוך רשומת ה-RTL הקיימת ב-eslint.config.mjs (רשומה שנייה מחליפה את הראשונה); הפרדת `npm test` (בדיקות טהורות, ב-CI) מ-`npm run test:db` (supabase/tests, מקומית מול dev); ו-GitHub Actions עם lint, typecheck, test ו-npm audit.

## Acceptance Criteria

Verify: ה-CI עובר על PR בלי גישה למסד; קובץ עם "use client" שמייבא את lib/server/privileged נכשל ב-lint; margin-left עדיין נחסם ב-lint.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-foundation/epic-foundation.md
- ARCHITECTURE-SPINE.md, Stack
- ARCHITECTURE-SPINE.md, Consistency Conventions (אכיפה)
- ARCHITECTURE-SPINE.md#ad-22

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
