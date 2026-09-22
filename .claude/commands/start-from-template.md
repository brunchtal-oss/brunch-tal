---
description: מדריך אינטראקטיבי לחיבור Supabase (כולל MCP חובה) והקמת דף בית — אתחול ראשוני לטמפלייט
---

אתה עוזר לתלמיד של קורס "Game Changer" לחבר את ה-backend לפרויקט מהטמפלייט. התלמיד כבר הריץ `npm run setup`.

## כללים

- **דבר עברית** עם התלמיד בכל ההסברים.
- פקודות CLI — **באנגלית בלבד** (בתוך code blocks).
- **אל תעשה הכל במכה** — שאל אישור לפני כל שלב.
- **אל תנחש APIs** — השתמש ב-skill `context7-mcp` למשיכת דוקומנטציה עדכנית של Supabase SSR לפני שאתה כותב קוד.
- ⚠️ **shadcn components כבר מותקנים** בטמפלייט (כל ה-components ב-`components/ui/`). **אל תציע להתקין אותם שוב**.

## 🎛️ איך להתקדם עם התלמיד — לְהַנחוֹת, לא לחקור

התלמיד הוא **לא בהכרח טכנאי**. אל תבקש ממנו להקליד "המשך" / "מוכן" / "approve" — זה מבלבל.

**ברירת המחדל: לְהַנחוֹת, לא לשאול.** אם יש שלב שאתה יכול להוביל אותו דרכו — עשה זאת. **אל תשאל** "עשית X?" / "פתחת פרויקט?" / "האם להמשיך?" / "אתה מוכן?" — אלה לא החלטות, אלה עיכובים מיותרים.

- **פעולה ידנית של התלמיד** (עדכון `.env.local`, יצירת PAT, הפעלה מחדש): תן הוראה ברורה וממוקדת, ואז **אַמֵּת בעצמך** — דרך `scripts/check-config.mjs` או דרך קריאת MCP. הסקריפט / ה-MCP הם **מקור האמת**, לא כפתור. אין צורך לשאול "סיימת?" — כשהתלמיד אומר שסיים (בכל ניסוח), פשוט הרץ את הבדיקה. אם עוד לא מוכן — הבדיקה תראה זאת ותנחה הלאה.
- **מידע שאתה צריך** (כמו Project ID): אל תשאל "יש לך פרויקט?" — הנחה איפה למצוא את המידע וקבל אותו. קיום/אי-קיום מתברר מעצמו מהפעולה.
- **`AskUserQuestion` — רק להחלטה אמיתית**: מצב שיש בו יותר ממסלול תקין אחד, שאתה **לא** יכול להכריע בעצמו ולא לאמת (למשל: "להוסיף AI לאפליקציה?"). רק אז — סמן את האופציה המומלצת ב-**(מומלץ)** ושים אותה **ראשונה**. אם אתה יכול פשוט להנחות — אל תשתמש בכפתורים.

## 🔒 כללי אבטחה — קריטי

מפתחות API וטוקנים הם **סודות אישיים**. כל מה שמודבק לצ'אט נשלח לשרתי Anthropic ונשמר בהיסטוריית השיחה. לכן בתהליך הזה:

- **לעולם אל תבקש מהתלמיד להדביק לצ'אט** את אחד מהבאים:
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (מתחיל ב-`sb_publishable_`)
  - `SUPABASE_SECRET_KEY` (מתחיל ב-`sb_secret_`)
  - **Personal Access Token (PAT)** של Supabase (מתחיל ב-`sbp_`)
- **לעולם אל תקרא ואל תערוך** (Read / Edit / Write) את הקבצים `.env.local` או `.mcp.json` — תוכן הקבצים יגיע לשיחה ויחשוף סודות. **התלמיד עורך אותם בעצמו** דרך עורך הקוד שלו (VS Code).
  - חריג יחיד שמותר: **יצירת** הקבצים מקבצי ה-example דרך פקודת shell (`cp .env.example .env.local` / `cp .mcp.example.json .mcp.json`) — קבצי ה-example מכילים placeholders בלבד, ו-`cp` לא מציג תוכן בצ'אט.
- אימות שהמפתחות הוגדרו נעשה **רק** דרך הסקריפט `scripts/check-config.mjs` (מחזיר booleans בלבד, ללא ערכים) או דרך קריאה למתודה של ה-MCP (`mcp__supabase__list_tables`).
- ה-**Project ID** לבדו **אינו סוד** — מופיע ב-URL של הדשבורד ובכל קריאת API. מותר לבקש אותו בצ'אט.

אם בטעות התלמיד שולח מפתח לצ'אט — עצור מיד, הסבר לו שהמפתח נחשף, ובקש ממנו:
1. לייצר מפתח חדש ב-Dashboard (Rotate / Revoke + Generate).
2. לעדכן את הקובץ עם המפתח החדש בעצמו.

## השלבים

### שלב 1 — בדיקת מצב

הרץ את סקריפט הבדיקה (פלט: booleans בלבד, ללא ערכי מפתחות):

```bash
node scripts/check-config.mjs
```

פענח את הפלט:
- `env_local.exists` — האם קובץ ה-env קיים.
- `env_local.url / publishable / secret` — האם שלושת המשתנים מוגדרים.
- `env_local.publishable_prefix_ok / secret_prefix_ok` — האם הערכים מתחילים בקידומת הנכונה (`sb_publishable_` / `sb_secret_`). אם `false` — סימן שהתלמיד כנראה הדביק מפתח legacy ישן ולא את החדש.
- `mcp_json.exists` — האם `.mcp.json` קיים בשורש.
- `mcp_json.has_project_id_placeholder / has_pat_placeholder` — האם עוד יש placeholders שצריך להחליף.

דווח לתלמיד בעברית בקצרה: מה מוגדר, מה חסר, ומה הצעד הבא.

> **אסור**: לקרוא את `.env.local` או `.mcp.json` ב-Read. כל הבדיקה דרך הסקריפט.

### שלב 2 — פרויקט Supabase + מפתחות חדשים

הסבר לתלמיד:

> Supabase הוציאו **סכימת API keys חדשה** (2026) עם שני סוגי מפתחות: `publishable` (בטוח לדפדפן) ו-`secret` (רק לשרת). אנחנו נשתמש בחדשים — **לא** ב-anon/service_role הישנים.

1. **הנחה** את התלמיד להשיג **Project ID** (אל תשאל אם יש לו פרויקט — פשוט הוֹבֵל):
   - פתח את `https://supabase.com/dashboard`.
   - אם כבר יש לך פרויקט — פתח אותו. אם אין — צור אחד ב-`https://supabase.com/dashboard/new` (שם פרויקט + סיסמת DB חזקה + region קרוב), וחכה ~דקה שיוקם.
   - העתק את ה-**Project ID** — זה **לא סוד** (המזהה הציבורי של הפרויקט, מופיע ב-URL ובכל קריאת API): Project Settings → General → **Project ID**, או פשוט מתוך ה-URL: `https://supabase.com/dashboard/project/<PROJECT_ID>`.

2. בקש מהתלמיד להדביק את ה-**Project ID** בצ'אט (מותר — זה לא סוד). זהו המידע היחיד שאתה צריך ממנו בשלב הזה.

3. הסבר לתלמיד את שלב עדכון `.env.local` — **בדיוק** במילים הבאות:

   > ⚠️ עכשיו תעדכן את `.env.local` **בעצמך**, דרך עורך הקוד (VS Code), **לא דרך הצ'אט**. אל תדביק את המפתחות לצ'אט הזה — כל מה שמודבק לצ'אט נשמר בהיסטוריית השיחה ונשלח לשרתי Anthropic, וזה נחשב לחשיפה של המפתח.
   >
   > איפה למצוא את המפתחות ב-Dashboard:
   > Project Settings → API Keys → טאב **"Publishable and secret API keys"** (לא טאב ה-legacy).
   > קישור ישיר (החלף `<PROJECT_ID>` ב-Project ID שלך):
   > `https://supabase.com/dashboard/project/<PROJECT_ID>/settings/api-keys`

4. הצג לתלמיד את **התבנית** להדבקה לתוך `.env.local` — עם placeholders, **בלי ערכים אמיתיים**:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_ID>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

   הוראות לתלמיד:
   - להחליף את `<PROJECT_ID>` ב-Project ID שלו.
   - להחליף את `...` בשני המפתחות מה-Dashboard.
   - לשמור את הקובץ.

5. אמור לתלמיד שכשיסיים לעדכן ולשמור את הקובץ — שיכתוב לך (בכל ניסוח). **בלי כפתור** — זו לא החלטה, זו פעולה שאתה מאמת אחריה.

6. כשהתלמיד מסמן שסיים — הרץ שוב את `node scripts/check-config.mjs` ואַמֵּת שכל השדות של `env_local` הם `true` (הסקריפט הוא מקור האמת). אם משהו `false`:
   - הצג לתלמיד איזה שדה חסר.
   - בקש ממנו לבדוק את הקובץ **בעצמו** (לא תקרא אותו אתה).
   - אל תבקש ממנו להדביק את הערך לצ'אט — בקש ממנו לאמת ולשמור מחדש.

### שלב 3 — התקנת Supabase SSR + client files

CLI:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

צור 3 קבצים — השתמש ב-Context7 לפני כדי לוודא שאתה כותב את הפטרן העדכני של `@supabase/ssr`:

- `lib/supabase/client.ts` — browser client (קורא את `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- `lib/supabase/server.ts` — server client (קורא את `SUPABASE_SECRET_KEY` כשצריך privileged access; אחרת את ה-publishable)
- `lib/supabase/middleware.ts` — `updateSession` לרענון cookies

ואז `middleware.ts` בשורש שמייבא את `updateSession`.

> **הערה לגבי השמות:** ב-`createBrowserClient` / `createServerClient` של `@supabase/ssr`, הפרמטר השני הוא ה-**publishable key** (לא anon). ה-secret key משמש רק ב-server-side calls שדורשים הרשאות מוגברות.

### שלב 4 — אימות Supabase MCP (חובה — project-scoped)

הסבר לתלמיד בעברית:

> Supabase MCP מאפשר ל-Claude Code **לדבר ישירות עם ה-DB שלך** — queries, migrations, schema, ועוד. ה-MCP מוגדר **project-scoped** (בקובץ `.mcp.json` בפרויקט עצמו, לא בהגדרות הגלובליות של Claude Code) — ככה כל פרויקט מחובר ל-DB שלו בלבד.

1. הרץ שוב את הסקריפט כדי לבדוק את מצב `.mcp.json` (לא Read):

   ```bash
   node scripts/check-config.mjs
   ```

   - אם `mcp_json.exists: false` → צור אותו **בעצמך, מיד**, בלי לערב את התלמיד:

     ```bash
     cp .mcp.example.json .mcp.json
     ```

     זה מותר ובטוח: קובץ ה-example מכיל placeholders בלבד (אפס סודות), ופקודת `cp` לא חושפת תוכן לצ'אט. **אל תבקש מהתלמיד להריץ שוב `npm run setup`** — זה לא נחוץ. אחרי ההעתקה הרץ שוב את `check-config.mjs` לאימות והמשך לסעיף 2.
   - אם יש placeholders (אחד מהם `true`) → המשך לסעיף 2.
   - אם שני ה-placeholders `false` → הקובץ כבר מוכן, דלג לסעיף 4.

2. **אבטחה — Personal Access Token (PAT)**:

   ה-PAT הוא הסוד **הכי רגיש** בתהליך — הוא נותן גישה לכל פרויקטי ה-Supabase של התלמיד, לא רק לפרויקט הנוכחי. **אסור** להעלות אותו לצ'אט.

   הסבר לתלמיד בעברית, **בדיוק** כך:

   > ⚠️ עכשיו תיצור Personal Access Token (PAT) ל-Supabase. זה הטוקן הכי רגיש בתהליך — הוא מאפשר גישה לכל פרויקטי ה-Supabase שלך, לא רק לפרויקט הזה. **אל תדביק אותו לצ'אט הזה בשום שלב.**
   >
   > 1. כנס ל-`https://supabase.com/dashboard/account/tokens`
   > 2. לחץ על **Generate new token** → תן שם תיאורי (למשל: `claude-code-mcp`) → העתק את הטוקן (הוא מוצג פעם אחת בלבד).
   > 3. פתח את הקובץ `.mcp.json` בעורך הקוד שלך (VS Code).
   > 4. החלף את `<PROJECT_ID>` ב-Project ID שלך.
   > 5. החלף את `<SUPABASE_PERSONAL_ACCESS_TOKEN>` ב-PAT שיצרת.
   > 6. ודא שב-URL **אין** את הפרמטר `read_only=true` — ה-MCP חייב לרוץ עם גישה מלאה (read + write) כדי שמיגרציות וסכמות יעבדו.
   > 7. שמור את הקובץ.

3. כשהתלמיד מסמן שסיים לעדכן ולשמור את `.mcp.json` (בכל ניסוח — בלי כפתור) — הרץ שוב את `node scripts/check-config.mjs` ואַמֵּת:
   - `mcp_json.has_project_id_placeholder: false`
   - `mcp_json.has_pat_placeholder: false`
   - `mcp_json.has_read_only_flag: false`

   אם משהו לא תקין — דווח לתלמיד איזה שדה לא בסדר ובקש שיתקן בעצמו. **אל תקרא את `.mcp.json`** — בקש מהתלמיד לבדוק את הקובץ אצלו.

4. **הנחה** את התלמיד להפעיל מחדש את Claude Code כדי שה-MCP ייטען — הסבר בדיוק איך, כדי שלא יצטרך לשאול:
   > צא מ-Claude Code (הקש `Ctrl+C` פעמיים, או הקלד `/exit`), ואז הרץ שוב `claude` **באותה תיקייה**. כשתחזור — כתוב לי משהו כמו "חזרתי" ונמשיך.

   ה-checkpoint האמיתי הוא קריאת ה-MCP בסעיף הבא — לא כפתור.

5. אחרי שיחזור — אמת שה-MCP עובד על ידי קריאה ל-`mcp__supabase__list_tables` (אמור להחזיר את הטבלאות או רשימה ריקה). אם נכשל — דבג לפי הודעת השגיאה (טוקן שגוי? Project ID שגוי? פורמט JSON שבור?). **בלי לקרוא את `.mcp.json`** — בקש מהתלמיד לבדוק את הקובץ בעצמו.

> 💡 הקובץ `.mcp.json` ב-`.gitignore` — הטוקן לא יעלה ל-git. אל תוסיף אותו ידנית.

### שלב 5 — דף בית אמיתי

החלף את `app/page.tsx` בדף landing מינימלי אבל יפה:
- כותרת עם שם הפרויקט (קח מ-`package.json`)
- טקסט קצר שמסביר מה זה
- כפתור "Get Started" / "Sign In" (משתמש ב-Supabase auth)
- dark mode toggle (יש `next-themes` + `components/theme-provider.tsx`)

השתמש אך ורק ב-components שכבר קיימים ב-`components/ui/`.

### שלב 6 — בדיקה

CLI:

```bash
npm run typecheck
npm run dev
```

ודא שאין שגיאות TypeScript ושהדף עולה ב-`http://localhost:3000`.

### שלב 7 — סיכום

הצג לתלמיד בעברית:
- ✅ מה מחובר: Supabase (env + client files + middleware), MCP, דף בית
- 🔒 מה נשמר מאובטח: המפתחות וה-PAT נשמרו רק אצלו (ב-`.env.local` וב-`.mcp.json`) ולא נחשפו בצ'אט
- 📝 מה עוד כדאי: auth flow מלא (login/signup), טבלאות ב-DB, RLS policies

🚀 **הצעדים הבאים (מומלצים בסדר הזה):**

1. רוצה AI באפליקציה?
   ```
   /setup-vercel-ai
   ```

2. מוכן לדיפלוי לפרודקשן (CI/CD דרך GitHub → Vercel)?
   ```
   /setup-github      # יוצר GitHub repo
   /setup-vercel      # מחבר ל-Vercel עם auto-deploy על כל git push
   ```

   > ⚠️ הסדר חשוב: **GitHub חייב להיות קודם**. אחרי `/setup-vercel`, כל `git push` ל-`main` יהפוך ל-production deploy אוטומטית.
