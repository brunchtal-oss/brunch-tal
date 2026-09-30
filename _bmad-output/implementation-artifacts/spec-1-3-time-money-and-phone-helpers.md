---
title: '1.3 Time, money and phone helpers — עזרי זמן, כסף וטלפון'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: 'df89a386af910704fda6b2b564090406bf4b78e3'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** אין עזרי זמן (AD-8), כסף וטלפון (AD-9) משותפים, ואין תשתית לבדיקות מסד.

**Approach:** עזרי SQL טהורים ב-`private`, ‏`lib/money.ts` ו-`lib/time.ts` לתצוגה בלבד, ותשתית בדיקות מסד (`pg` ישיר ל-dev) לכל בדיקת RPC עתידית.

## Boundaries & Constraints

**Always:** עזרי הזמן ב-`'Asia/Jerusalem'`, טהורים (בלי `now()`), ‏`set search_path = ''`, ‏revoke מכל התפקידים ובלי grant (נקראים מפונקציות definer; מי שיוסיף view יוסיף grant). ‏`lib/money.ts` בלי נקודה צפה. מחרוזת החיבור רק ב-`.env.local`.

**Decisions:**
- `local_day_end(d)` = תחילת היום המקומי הבא. בתוקף = `now() < local_day_end(expires_on)`.
- `registration_closes_at(starts_at, days_before, local_time)` ו-`cancel_deadline(window_hours, starts_at)` מקבלים ערכים מפורשים. הקורא יחלץ אותם מה-snapshot.
- `cancel_deadline` מחסיר שעות אמיתיות, גם במעבר שעון. הבדיקה: `now() <= deadline`.
- `normalize_phone` מחזיר E.164 או `null` (הקורא זורק `INVALID_PHONE`). מספר שמתחיל ב-0 יחיד הוא ישראלי. `+` או `00` עם קידומת אחרת: E.164 כללי, 8 עד 15 ספרות.
- `formatAgorot`: ‏"128 ₪", ‏"1,234 ₪". סכום עם אגורות: ‏"127.50 ₪", בלי עיגול.
- בדיקות: SSL בלי אימות תעודה (dev, נתונים בדויים). לפני חיבור נבדק שהמחרוזת מכילה את ה-ref של `NEXT_PUBLIC_SUPABASE_URL`.

**Never:** טבלאות, RPC, ‏`can_self_cancel`, גיל תינוק (נדחה לסיפור התינוקות), החלטה עסקית לפי `Date.now()`.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected |
|----------|-------|----------|
| 48 בדיוק | מפגש `2026-10-26 10:00` מקומי, חלון 48 | `2026-10-24 08:00Z`. ‏`deadline <= deadline` אמת, ‏`+1µs` שקר |
| סגירה, סוף קיץ | מפגש `2026-10-25 10:00` מקומי, יום 1, ‏20:00 | `2026-10-24 17:00Z` (לא 18:00Z) |
| סגירה, תחילת קיץ | מפגש `2026-03-27 10:00` מקומי, יום 1, ‏20:00 | `2026-03-26 18:00Z` |
| תוקף 49 | `local_day_end('2026-10-01'::date + 49)` | `2026-11-19 22:00Z` |
| שבוע | רביעי `2026-09-30` / ראשון `2026-09-27` | `2026-09-27` |
| יום הכנה | מפגש `2026-10-01 00:30` מקומי, היסט 0 / ‏-1 | `2026-10-01` / ‏`2026-09-30` |
| טלפון | `054-123 4567`, ‏`+972 54 123 4567`, ‏`00972541234567`, ‏`+972054…` | `+972541234567` |
| טלפון לא תקין | `''`, ‏`12345`, ‏`abc`, ‏`+972 5`, ‏null | `null` |
| כסף, פירוק | `"128"`, ‏`"128.5"`, ‏`" 1,234.50 ₪"` | `12800`, ‏`12850`, ‏`123450` |
| כסף, דחייה | `""`, ‏`"-5"`, ‏`"1.234"`, ‏`"12,34"`, ‏`"1e3"`, מעל `MAX_SAFE_INTEGER` | `null` |
| חיבור חסר | אין `DEV_DATABASE_URL`, או ref שונה | `test:db` נכשל בהודעה ברורה, בלי להתחבר |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260929154816_create_identity_and_reset_tokens.sql` -- סגנון הערות ו-revoke/grant.
- `vitest.config.mts` -- פרויקט `db` ומיפוי `server-only` כבר קיימים. חסר `setupFiles`.
- `scripts/dev-reset-link.mjs:21` -- `process.loadEnvFile(".env.local")`.
- `eslint.config.mjs` -- `supabase/tests/**` פטור מכלל הכתיבה.
- DESIGN.md:632-633 -- `יום שני 12.10 · 10:00`, ‏`128 ₪`. ‏EXPERIENCE.md:414 -- לקורא מסך: "יום שני, 12 באוקטובר, 10:00".

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_create_time_and_phone_helpers.sql` -- ששת העזרים, `immutable`. אחריה advisor וטיפוסים.
- [x] `package.json` -- `pg`, ‏`@types/pg` (dev).
- [x] `supabase/tests/support/db.ts`, ‏`setup.ts`, ‏`vitest.config.mts` -- env ובדיקת ref, ‏Pool, ‏`runId` (`test_<random>`), ‏`testName`, ‏`onCleanup` (ב-`afterAll`), ‏`inRollback`, ‏`asAuthenticated(client, userId)`.
- [x] `supabase/tests/time-and-phone-helpers.test.ts` -- המטריצה, ובלי execute ל-`anon`/‏`authenticated`.
- [x] `supabase/tests/support.test.ts` -- `inRollback` לא משאיר שינוי. ‏`asAuthenticated` מחזיר את ה-uid ב-`auth.uid()`.
- [x] `lib/money.ts` + test -- `formatAgorot`, ‏`parseShekelsToAgorot`.
- [x] `lib/time.ts` + test -- `formatDayMonth`, ‏`formatTime`, ‏`formatWeekday`, ‏`formatSessionDateTime`, ‏`formatAccessibleDateTime`, ‏`formatLocalDate` (`YYYY-MM-DD` בלי הזזת אזור זמן).
- [x] `.env.example`, ‏`README.md`, ‏`AGENTS.md` -- `DEV_DATABASE_URL` (session pooler) ו-`test:db`.

**Acceptance Criteria:**
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ולא נשארות שורות `test_%`.
- Given checkout בלי `.env*`, when `npm test`, ‏lint, ‏typecheck ו-build, then עוברים.
- Given המיגרציה הוחלה, when get_advisors, then אין WARN או ERROR חדשים.

## Implementation Notes

- מיגרציות: `20260930171231_create_time_and_phone_helpers.sql`, ואחרי הביקורת `20260930172341_fix_normalize_phone.sql` (`create or replace`), כי קובץ שהוחל לא נערך. בקובץ הראשון נשארו תווי bidi בלתי נראים בגוף `normalize_phone` הישן. הקובץ השני מחליף אותו וכתוב רק ב-escapes. כלי הכתיבה של הסוכן הפכו `\uXXXX` לתווים עצמם, ולכן צריך לבדוק בתים בקבצים כאלה.
- ישראלי: נייד 5X ו-VoIP 7X בני 9 ספרות אחרי ה-0, קווי 2, 3, 4, 8, 9 בני 8. מספר בלי קידומת (`541234567`, ‏`972…` בלי `+`) הוא null.
- `formatAgorot` זורק RangeError על ערך שאינו מספר שלם בטוח, ומציג שלילי כ-`-128 ₪`. ‏`lib/time.ts` זורק על מחרוזת ISO בלי אזור זמן.
- `devDatabaseUrl` דורש ref של 20 תווים מ-`https://<ref>.supabase.co`, ו-`postgres.<ref>` כשם משתמש או `db.<ref>.supabase.co` כ-host. שגיאת פענוח לא מדפיסה את המחרוזת.
- ‏get_advisors (security) אחרי שתי המיגרציות: אין ממצא חדש. הטיפוסים לא השתנו, כי `private` לא חשוף.
- lint, ‏typecheck, ‏`npm test` (245) ו-build עוברים.
- 2026-09-30, אחרי שהמשתמשת הכניסה `DEV_DATABASE_URL` (Session pooler): ‏`npm run test:db` עבר (54 בדיקות, שני קבצים). אחרי ההרצה אין במסד שורות `test_%`.
- Supavisor מתעלם מפרמטרים שנשלחים בזמן ההתחברות (`statement_timeout` חזר `2min`). לכן ה-timeouts נקבעים ב-`SET` בתוך `onConnect` של ה-Pool, שמחכה לו לפני שהוא מוסר את החיבור. זה החליף את `pool.on("connect")`, שגרם לאזהרת deprecation של `pg` על שתי שאילתות במקביל.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. ‏medium 2, ‏low 19, ‏false 2. ‏patch 13, ‏defer 2, ‏reject 8.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | `normalize_phone` מקבל אורך שגוי לקידומת (`054123456`) | medium | אומת ב-regex `^0[2-9][0-9]{7,8}$` | patch: מיגרציה חדשה |
| 2 | תווי bidi בלתי נראים כתווים ממשיים ב-regex | low | אומת בבתים (verification-gap) | patch: escapes |
| 3 | אין בדיקה ל-NBSP, ‏U+202A–E, ‏U+2066–9 (verification-gap) | low | אומת בבדיקות | patch |
| 4 | תווי העתקה נוספים (ZWSP, מקפים) מחזירים null | low | אומת: לא בקבוצה | patch (עם 2) |
| 5 | `url.includes(ref)` חלש, ref ‏"127" מ-URL מקומי, ו-TypeError שעלול להדפיס סיסמה | medium | אומת ב-`db.ts` | patch |
| 6 | אין `pool.on("error")` | low | אומת: pg פולט error על client במנוחה | patch |
| 7 | כישלון `statement_timeout` נבלע | low | אומת: `.catch(() => undefined)` | patch + בדיקה |
| 8 | `inRollback` מסתיר את השגיאה ומחזיר חיבור שבור ל-Pool | low | אומת ב-`finally` | patch |
| 9 | `asAuthenticated` מחוץ לעסקה רץ בשקט כ-owner | low | אומת: `set local` מחוץ לעסקה רק מזהיר | patch |
| 10 | בדיקת "לא דולף" רצה על חיבור אחר ב-Pool | low | אומת: `sql()` על Pool של 2 | patch |
| 11 | `service_role` לא נבדק ב-has_function_privilege | low | אומת | patch |
| 12 | `toInstant` מקבל ISO בלי offset | low | אומת: `new Date` לפי אזור הסביבה | patch |
| 13 | `parseShekelsToAgorot` דוחה טקסט עם סימני כיוון | low | אומת: `trim()` לא מסיר אותם | patch |
| 14 | 42501 אולי מגיע מהרשאת schema | false | ל-`authenticated` יש usage על `private` (מיגרציה ראשונה) | reject |
| 15 | ערכים שליליים ושעה במעבר שעון ב-`registration_closes_at`/‏`cancel_deadline` | low | אמיתי, אבל האכיפה שייכת לטבלת ההגדרות | defer |
| 16 | אין יצירת משתמשות Auth בדויות בתשתית | low | ‏SPINE שורה 296. לא נדרש לעזרים הטהורים | defer |
| 17 | אין בדיקה שלא נשארו שורות `test_%` | low | כל שינוי ב-`inRollback`. נבדק ידנית אחרי ההרצה | reject |
| 18 | `runCleanups` מפספס throw של ערך falsy | low | לא סביר בשימוש רגיל | reject |
| 19 | אפסים מובילים (`"0128"`) מתקבלים | low | הערך חד-משמעי | reject |
| 20 | קלט לא-מחרוזת ל-`parseShekelsToAgorot` | low | הטיפוס `string` | reject |
| 21 | `Intl.DateTimeFormat` חדש בכל קריאה | low | תיקון מוסיף מטמון. אין בעיית ביצועים מוכחת | reject |
| 22 | נתיב מקומי עם שם המשתמש ב-spec | low | תיקון עורך את ה-spec | reject |
| 23 | חתימות עם ערכים מפורשים ולא snapshot (intent-alignment) | false | החלטה מאושרת ב-Decisions | reject |

## Design Notes

```sql
registration_closes_at = (((p_starts_at at time zone 'Asia/Jerusalem')::date - p_days_before) + p_local_time) at time zone 'Asia/Jerusalem'
local_day_end          = (p_day + 1)::timestamp at time zone 'Asia/Jerusalem'
cancel_deadline        = p_starts_at - make_interval(hours => p_window_hours)
```

- כללי `supabase-postgres-best-practices` (המשתמשת ביקשה). הסקיל ב-`C:/Users/ligal/.claude/skills/supabase-postgres-best-practices/references/`, ורלוונטיים בעיקר `conn-pooling`, ‏`conn-prepared-statements`, ‏`conn-idle-timeout` ו-`security-privileges`. מה שנגזר מהם: session pooler (פורט 5432, לא transaction pooler 6543), ‏Pool קטן (`max: 2`) עם `idleTimeoutMillis`, ‏`statement_timeout` ו-`idle_in_transaction_session_timeout` בחיבור, ו-`pool.end()` בסוף. ‏`language sql immutable strict parallel safe`. אם `strict` נותן ערך ריק במקום שגיאה ב-`registration_closes_at` או ב-`cancel_deadline`, זה מקובל, כי השוואה מול ערך ריק לא מתירה פעולה.
