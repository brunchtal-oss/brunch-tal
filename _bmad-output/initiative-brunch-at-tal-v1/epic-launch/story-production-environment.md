---
id: 1
type: story
title: "Production environment — סביבת פרודקשן"
parent: epic-launch
covers: [E6-R3]
after: [7]
hitl: true
risk: high
status: done
---

# Production environment — סביבת פרודקשן

## Description

E6-R3, החלק החינמי בלבד (החלטת המשתמשת 2026-10-29: 6.1 מפוצל; שדרוג Vercel, repo פרטי, דומיין והחלטת שדרוג Supabase עברו לסיפור המסירה, id 10). לפניו נקודת החלטה בלי תשלום: שם הדומיין ותוכנית Supabase. המשתמשת יוצרת פרויקט Supabase לפרודקשן בתוכנית החינמית; supabase db push למסד ריק, הגדרות Auth, Vault (app_url, cron_secret), זוג VAPID ו-CRON_SECRET משלו, VAPID_SUBJECT של העסק, חשבון האדמין האמיתי של טל ב-admin_roles, ה-checklist מה-README, noindex פעיל, וחיבור Vercel production למסד החדש. מעתיקים מהפיתוח את התוכן האמיתי של האתר (הכול חוץ מלוח הבראנצ'ים): לא מפגשים, לקוחות, הרשמות, תשלומים, זכויות, זיכויים, התראות, יומן או טוקנים, ולא נתוני *@video.example.com או test_; מוצרים, הגדרות, תבניות ואמצעי תשלום לפי החלטה בשער ה-spec. מסד הפיתוח נשאר תמיד. בשער ה-spec: לאן ה-Vault של dev (app_url) מצביע, כדי שה-cron של dev לא יקרא לפרודקשן, ואיך בודקים את הפרודקשן אחרי מיזוג. ב-README: הוראה קצרה להרצת שרת התרגול המקומי של טל ובאילו חשבונות בדויים נכנסים. נוספו 2026-10-22: מה שנשאר מ-5.15 (בדיקה שהגבלת הקצב של 2.8 פעילה על /login ו-/admin/login, ו-SITE_LOCKED ב-preview אם רוצים), והממצאים של הבדיקה המקדימה שמיועדים ל-6.1 (deferred-work): הרצה אמיתית של המיגרציות במסד הריק, העמודים המשפטיים מפורסמים לפני שהאתר נפתח, סכמות חשופות ב-Data API, והוראות להוספת האדמין.

## Acceptance Criteria

Verify: בפרודקשן: ה-advisor נקי, grants.test.ts עובר מול הפרויקט החדש בקריאה בלבד, טל מתחברת כאדמין, pg_cron קורא לעובד הפוש, ה-cron של dev לא מקבל 401, והאתר החי מציג את התוכן שהועתק בלי אף נתון בדוי.

## References

- parent — _bmad-output/initiative-brunch-at-tal-v1/epic-launch/epic-launch.md
- ARCHITECTURE-SPINE.md#ad-22 (סביבות)
- ARCHITECTURE-SPINE.md, Deferred
- build-sequence.md, השלמות לפני השקה

## Notes

- Open question: לאן ה-Vault של dev מצביע אחרי המעבר; איך בודקים את הפרודקשן אחרי מיזוג בלי החשבונות הבדויים.

## Plan

<!-- Filled in by the coding agent; never sent to a tracker. -->
