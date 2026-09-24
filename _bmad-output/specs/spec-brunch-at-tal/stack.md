# סטאק (הצעת יישום)

- **Next.js + TypeScript:** לממשק ולפעולות שרת. זה כבר קיים בפרויקט: shadcn/ui ב-`components/ui`, ולקוחות Supabase ב-`lib/supabase/{client,server,proxy}.ts`.
- **Supabase:** Postgres לנתונים, Auth להתחברות במייל וסיסמה, Storage למדיה.
- **Vercel:** לאירוח. הפריסה נעשית דרך git push.
- **Web Push:** עם מפתחות VAPID.
- **תזמון משימות:** בזמן ההקמה צריך לבחור מנגנון שרץ גם כשאין דפדפן פתוח. אפשרות אחת: Supabase Cron (pg_cron) עם מעבד תור.
- **ספק מייל:** לא מוגדר בשלב 1. בלי ספק, איפוס הסיסמה נעשה ידנית דרך טל.

## למסור בסוף כל שלב
- קוד, migrations ו-seed בדוי.
- בדיקות.
- README להפעלה ולהרשאות.
- env.example בלי סודות.
- הוראות להגדרת Auth, Storage, פוש ומשימות מתוזמנות.
- אין לפרסם אתר חי עם נתוני דוגמה, ואין ליצור משאבים בתשלום בלי החלטה מפורשת.

## מקורות לבדיקה בזמן הבנייה
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/reference/javascript/auth-admin-createuser
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/cron
- https://supabase.com/pricing
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
