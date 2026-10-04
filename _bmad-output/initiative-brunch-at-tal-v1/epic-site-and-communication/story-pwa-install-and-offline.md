---
id: 9
type: story
title: "PWA install and offline — התקנה ואופליין"
parent: epic-site-and-communication
covers: [CAP-23]
after: [2]
hitl: true
risk: medium
status: done
---

# PWA install and offline — התקנה ואופליין

## Description

CAP-23: app/manifest.ts ואייקונים, public/sw.js שנכתב ידנית (מטמון רק ל-/_next/static, אייקונים ו-/offline, ניווט network-only, push ו-notificationclick), /offline, ו-/install עם הדרכת התקנה והסבר ל-iPhone.

## Acceptance Criteria

Verify: בדיקות: אחרי ניווט ב-/me וב-/admin, ה-Cache Storage לא מכיל HTML שלהם או /api; באופליין מוצג /offline ואי אפשר להירשם או לבטל; האפליקציה ניתנת להתקנה בטלפון.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/epic-site-and-communication.md
- ARCHITECTURE-SPINE.md#ad-16 (Service worker)
- EXPERIENCE.md

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->

- spec: `_bmad-output/implementation-artifacts/spec-5-9-pwa-install-and-offline.md` (done). PR #29, #30.
- ההתקנה עובדת גם באתר נעול (AD-22, החלטת המשתמשת 2026-10-04): ‏manifest ואייקונים פטורים, עוגיית נעילה וטופס בדף הנעילה.
- נבדק: התקנה באנדרואיד, ואופליין ומטמון בדפדפן אוטומטי. נשאר: בדיקה באייפון (טופס הנעילה באפליקציה המותקנת), לפני 5.8.
