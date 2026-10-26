---
id: 14
type: story
title: "Purchase void — ביטול רכישה"
parent: epic-accounts-and-money
after: [2, 3.9, 3.13, 5.6]
hitl: true
risk: high
status: done
---

# Purchase void — ביטול רכישה

## Description

סיפור חדש (החלטת המשתמשת 2026-10-26, completion-plan-2026-10-10.md): הפעולה "ביטול הרכישה" בדף הרכישה באדמין (customers/[id]/entitlements/[entitlementId], גם customers/unbound/... לרכישה שלא שויכה, ליד התיקונים של 3.13). השורה ב-/admin/payments לחיצה ומובילה לדף הרכישה. הפעולה בעסקה אחת: payments.status = voided (יוצא מסכום החודש ומהייצוא), entitlements.status = revoked, קישור הצטרפות שלא מומש מבוטל, הרשמות עתידיות שמומנו מהרכישה מתבטלות בלי זיכוי ובלי החזרת כניסה (המקום מתפנה ורשימת ההמתנה מקבלת הודעה כרגיל), רישום ביומן עם סיבה. פעולה רגישה (lib/admin/sensitive-actions.ts): חלון האישור מפרט את ההרשמות שיבוטלו. חסימה: כניסה שכבר נוצלה (הרשמה מהרכישה למפגש שכבר התחיל), או זיכוי או החזר שכבר קיימים לרכישה. הביטול סופי, בלי שחזור (טעות: טל רושמת תשלום חדש). כולל את פריטי deferred-work: bind_purchase ו-token_view בודקים מצב תשלום וזכות, ו-get_my_entitlements מחזיר מצב תשלום. לשלב ה-spec, לפי ההמלצה: הודעה ניטרלית ללקוחה עם "צרי קשר" רק אם הפעילה את החשבון; תשלום מבוטל מופיע בהיסטוריה בכרטיס הלקוחה עם התגית "בוטל".

## Acceptance Criteria

Verify: בדיקות מסד: ביטול רכישה עם הרשמה עתידית מבטל אותה בלי זיכוי ומפנה מקום; כניסה שנוצלה, זיכוי או החזר חוסמים; קישור שלא מומש נדחה אחרי הביטול (token_view ו-bind_purchase); התשלום יוצא מסכום החודש ומהייצוא; אותו מפתח פעמיים מבטל פעם אחת; grants.test.ts. בטלפון: טל מבטלת מדף הרכישה ומשורת התשלום, חלון האישור מפרט את ההרשמות, והתשלום מופיע "בוטל" בכרטיס הלקוחה.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-accounts-and-money/epic-accounts-and-money.md
- ARCHITECTURE-SPINE.md#ad-10
- ARCHITECTURE-SPINE.md#ad-5
- ARCHITECTURE-SPINE.md#ad-12
- spec-3-13-entitlement-corrections.md
- spec-3-9-refund-completion.md
- deferred-work.md (הסיפור שיבנה ביטול תשלום)

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
