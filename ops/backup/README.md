# הגיבוי החיצוני (6.3): מה מעתיקים ל-repo הפרטי

<div dir="rtl">

התיקייה הזאת היא רק תבנית. הגיבוי עצמו רץ ב-repo **פרטי** של העסק ב-GitHub (למשל `brunch-backups`), ולא ב-repo הזה, שהוא ציבורי עד המסירה. כאן אין אף פעם סוד, גיבוי, תמונה או נתון אמיתי. הוראות השחזור בעברית פשוטה: README הראשי, "גיבוי ושחזור".

## מה מעתיקים, ולאן

| מכאן (`ops/backup/`) | ב-repo הפרטי |
| --- | --- |
| ‏`backup.sh`, ‏`drill.sh`, ‏`counts.sql`, ‏`cron-dump.sql`, ‏`media-list.sql`, ‏`lib.mjs`, ‏`tool.mjs`, ‏`media.mjs`, ‏`restore-media.mjs` | ‏`scripts/` (אותם שמות) |
| ‏`workflows/backup.yml`, ‏`workflows/restore-drill.yml` | ‏`.github/workflows/` |
| ‏`.gitattributes` (סקריפטי bash נשמרים עם LF) | ‏`.gitattributes` בשורש |
| המפתח הציבורי (`backup-public.asc`, שלב 1 למטה) | ‏`keys/backup-public.asc` |

את `media/` (פרודקשן) ואת `media-dev/` (החזרה על הפיתוח) ה-workflow יוצר ומעדכן בעצמו. אחרי שינוי בקבצים כאן מעתיקים שוב את אותם קבצים.

## 1. זוג המפתחות (פעם אחת, במחשב של המשתמשת)

ב-Git Bash (ה-`gpg` של Git for Windows, בלי התקנה), בתיקייה זמנית מחוץ ל-repo:

```bash
export GNUPGHOME="$(mktemp -d)"
gpg --batch --passphrase '' --quick-gen-key "brunch-backup" default default never
gpg --armor --export brunch-backup > backup-public.asc
gpg --armor --export-secret-keys brunch-backup > backup-private.asc
```

- ‏`backup-public.asc` הוא המפתח הציבורי. הוא לא סוד, ונכנס ל-repo הפרטי ב-`keys/`.
- ‏`backup-private.asc` הוא המפתח הפרטי, **בלי סיסמה** (החלטת המשתמשת 2026-11-20: אובדן המפתח הוא הסיכון הגדול יותר, והגיבויים ממילא ב-repo פרטי). שני עותקים: אצל המשתמשת ואצל טל (תיקייה פרטית ב-Google Drive שלה או מנהל הסיסמאות שלה). לא ב-repo, לא בצ'אט ולא במייל. אחרי ששני העותקים במקומם מוחקים את הקובץ ואת התיקייה הזמנית.

## 2. התפקיד `backup_reader` (בכל פרויקט, ב-SQL Editor)

המיגרציה `backup_reader_role` יוצרת את התפקיד בלי התחברות: קורא הכול (`pg_read_all_data`, ‏`bypassrls`), לא כותב כלום. המשתמשת מפעילה התחברות עם סיסמה חדשה וארוכה (נשמרת במנהל הסיסמאות, אף פעם לא בקובץ):

```sql
alter role backup_reader with login password '<סיסמה חדשה>';
```

קודם בפרויקט הפיתוח (לחזרה), ואחר כך בפרודקשן, עם סיסמה אחרת לכל אחד.

## 3. הסודות ב-repo הפרטי (Settings → Secrets and variables → Actions)

| שם | ערך |
| --- | --- |
| ‏`PROD_BACKUP_DB_URL` | ‏Connect → **Session pooler** של הפרודקשן (פורט 5432), עם המשתמש `backup_reader.<project-ref>` במקום `postgres.<project-ref>` והסיסמה של `backup_reader` (תו מיוחד מקודד, למשל `@` כ-`%40`): `postgresql://backup_reader.<ref>:<password>@aws-…-<region>.pooler.supabase.com:5432/postgres` |
| ‏`DEV_BACKUP_DB_URL` | אותו דבר לפרויקט הפיתוח, לחזרה בלבד |
| ‏`DRILL_PRIVATE_KEY` | **זמני:** כל התוכן של `backup-private.asc`, רק לפני תרגול שחזור. מוחקים אותו מיד אחרי התרגול |

ועוד **Variable** אחד (לשונית Variables באותו מסך, לא סוד): ‏`BACKUP_KEY_FINGERPRINT`, טביעת האצבע של המפתח הציבורי (40 תווים): השדה העשירי בשורה הראשונה שמתחילה ב-`fpr` בפלט של `gpg --show-keys --with-colons backup-public.asc`. ‏`backup.sh` משווה אליה את `keys/backup-public.asc` ועוצר אם היא חסרה או שונה, כדי שמפתח שהוחלף (שלאף אחת אין את החצי הפרטי שלו) לא יצפין גיבוי שאי אפשר לפתוח.

ה-workflow מקבל מ-GitHub את `GITHUB_TOKEN` לבד (`contents: write` בלבד). כתובת התמונות הציבוריות נגזרת מה-ref שבשם המשתמש, ולכן אין סוד נוסף.

## 4. חזרה על הפיתוח, ואז פרודקשן

1. **חזרה:** Actions → ‏`backup` → Run workflow עם `dev`. נוצר Release ‏`dev-db-<date>` עם `dev-db-<date>.tar.gpg` ו-`counts-<date>.json`, והתמונות נכנסות ל-`media-dev/`. אחר כך `restore-drill` עם `dev` (עם `DRILL_PRIVATE_KEY` זמני).
2. **פרודקשן:** אותו דבר עם `prod` (‏Release ‏`db-<date>`, תמונות ב-`media/`). בודקים שהקובץ מוצפן (נפתח כטקסט רק כבליל תווים), מורידים ומפענחים במחשב (README הראשי, "פענוח במחשב"), ומריצים את `restore-drill` עם `prod`. בסוף מוחקים את `DRILL_PRIVATE_KEY`.
3. מאז ה-cron רץ כל לילה (01:17 UTC) על הפרודקשן בלבד.

## איך זה עובד, בקיצור

- **הגיבוי (`backup.sh`):** החלוקה של Supabase (roles / schema / data, כולל `auth.users` ו-`storage.objects`). ‏`supabase db dump` (‏CLI ‏`supabase@3.1.0`) רק מדפיס את סקריפטי ה-pg_dump שלו (`--dry-run`), והם רצים בתמונת `postgres:17.6` ב-Docker של ה-runner (נעוצה ב-digest, `PG_IMAGE`). הסיבה: ה-CLI תמיד מוסיף `--role "postgres"`, שדורש חברות ב-`postgres` (הרשאת כתיבה), ו-`backup_reader` לא חבר בו. ‏`prepareDumpScript` (‏`lib.mjs`) מסיר את הדגל הזה ואת פרטי החיבור, ומשאיר את כל השאר כמו ש-Supabase כתבו. הגיבוי של Supabase לא כולל את סכמת `cron` (נמצא בריצה הראשונה על הפיתוח, 2026-11-20), ולכן `cron-dump.sql` כותב את המשימות המתוזמנות ל-`cron.sql`: שורת `cron.schedule(...)` לכל משימה ב-`cron.job`. אחר כך tar של ארבעת הקבצים (`roles.sql`, ‏`schema.sql`, ‏`data.sql`, ‏`cron.sql`; ‏`cron.sql` נמצא רק בתוך ההצפנה), הצפנה ב-`gpg --recipient-file keys/backup-public.asc`, ובדיקה שהקובץ הוא הודעת gpg ולא טקסט. הקבצים הגלויים נמחקים מה-runner מיד.
- **ספירות:** ‏`counts-<date>.json` סופר את השורות בקובץ הגיבוי עצמו (כל טבלה ב-`public`, ‏`auth.users`, ‏`storage.objects`; לא `cron.job`, שלא נמצא ב-dump), את מספר התמונות הציבוריות, ובשדה נפרד `cron_jobs` את מספר המשימות ב-`cron.sql`. ‏`counts.sql` סופר גם את המסד החי מיד אחרי הגיבוי: טבלה שחסרה בגיבוי מכשילה את הריצה, ומספר שונה רק מודפס (שורות שנכתבו בזמן הגיבוי).
- **תמונות (`media.mjs`):** רשימת `media-public` נקראת מ-`storage.objects`, וכל קובץ חדש או שהשתנה יורד מהכתובת הציבורית שלו (בלי מפתח) ונכנס ל-git. קבצים לא נמחקים. ‏`media-drafts` לא מגובה (החלטת המשתמשת 2026-11-20): אחרי שחזור האתר מציג את כל התמונות, וחיתוך מחדש של תמונה ישנה דורש העלאה מחדש.
- **Release לכל יום:** ‏`db-<date>` (‏`dev-db-<date>` לפיתוח). ריצה חוזרת באותו יום מחליפה את הקבצים. שמירה: 30 הימים האחרונים, ועוד הגיבוי הראשון של כל חודש ל-12 חודשים. Release נמחק באמת (היסטוריית git לא הייתה משחררת מקום).
- **כשל:** כל שלב שנכשל מכשיל את הריצה. כשל עד ההצפנה (כולל) לא שומר כלום. קודם נשמר ה-Release של המסד, ורק אחריו התמונות (הורדה, commit, ‏`git pull --rebase` ו-push): כשל בתמונות משאיר את ה-Release של היום, הניקוי של הגיבויים הישנים עדיין רץ, והריצה מסומנת כנכשלה. פרויקט מושהה או סוד שגוי: "הגיבוי נכשל: אין חיבור למסד". GitHub שולח מייל על ריצה מתוזמנת שנכשלה **למי ששינה לאחרונה את שורת ה-cron** ב-`backup.yml`, לא לבעלת ה-repo. מי שמעתיקה את הקובץ ל-repo הפרטי היא שמקבלת את המיילים; כדי שטל תקבל אותם, היא עושה את השינוי האחרון בשורה הזאת (deferred-work, יעד id 10).
- **היומן:** רק שמות קבצים, גדלים, שמות טבלאות ומספרי שורות. הסיסמה, השרת והמשתמש מוסתרים (`::add-mask::`), ושגיאת psql מודפסת בלי ערכים (`safeErrorLines`).
- **התרגול (`drill.sh`):** מוריד Release, מפענח עם `DRILL_PRIVATE_KEY`, מרים מחסנית Supabase מקומית וזמנית על ה-runner (`supabase start`, ‏Postgres 17; אף פעם לא פרויקט הפיתוח; ‏Auth ו-Storage בגרסאות קבועות שכתובות בראש `drill.sh`, ‏`AUTH_VERSION` ו-`STORAGE_VERSION`, דרך `supabase/.temp/gotrue-version` ו-`storage-version`, כי הגרסאות שה-CLI נועץ ישנות מהשרת, ונתוני `auth` לא נכנסים אליהן. כשתרגול נכשל על עמודה חסרה ב-`auth` או ב-`storage`, מעדכנים את שתיהן לגרסה האחרונה ב-github.com/supabase/auth וב-github.com/supabase/storage), משחזר לפי התיעוד של Supabase בעסקה אחת, מעלה את התמונות (`restore-media.mjs`), ומשווה: כל טבלה בדיוק כמו ב-`counts-<date>.json`; אחרי הרצת `cron.sql` מספר השורות ב-`cron.job` שווה ל-`cron_jobs` (בגיבוי ישן בלי `cron.sql` השלב מדולג, עם שורה ביומן); וכל תמונה ציבורית שהוחזרה מוגשת (200). אי-התאמה מכשילה את התרגול ונותנת את שם הטבלה.
- ‏`npm test` בודק את העזרים הטהורים (`test/backup-lib.test.ts`) ואת `tool.mjs` עצמו (`test/backup-tool.test.ts`). אין כאן `shellcheck`; הסקריפטים ב-`set -euo pipefail`, בלי `set -x`.

</div>
