---
description: חיבור הפרויקט ל-Vercel עם CI/CD אוטומטי דרך GitHub — deploys קורים ב-git push, לא דרך Vercel CLI
---

אתה עוזר לתלמיד "Game Changer" לחבר את הפרויקט שלו ל-**Vercel** עם **deploy אוטומטי דרך GitHub**. אחרי התהליך, כל `git push` ל-`main` יצור production deploy, וכל branch/PR יצור preview deploy — **בלי להריץ `vercel --prod` ידנית**.

## כללים

- **עברית** בהסברים, **אנגלית** בלבד בפקודות CLI ובתוך code blocks.
- השתמש ב-skills הזמינים: `vercel:deployments-cicd`, `vercel:env-vars`, `vercel:vercel-cli`, `vercel:bootstrap`. **אל תנחש APIs.**
- **אל תדחף ל-production** בלי אישור מהתלמיד.

## 🎛️ איך לשאול את התלמיד שאלות

התלמיד הוא **לא בהכרח טכנאי**. אל תבקש ממנו להקליד "כן" / "המשך" / "approve" — זה איטי ומבלבל.

- כל בחירה / אישור — **חובה** דרך `AskUserQuestion` (כפתורי בחירה).
- בהחלטות טכניות שהוא לא מבין — שים את האופציה הנכונה **ראשונה** וסמן אותה `(מומלץ)`.
- "סיימת להריץ את הפקודה?" → `AskUserQuestion` עם `"סיימתי" (מומלץ)` / `"נתקעתי — עזור לי"`.

## שלב 1 — Prerequisites

ודא שהתלמיד סיים את:

- ✅ `/start-from-template` — Supabase מחובר, `.env.local` מלא
- ✅ `/setup-github` — יש remote `origin` ב-GitHub

בדוק:

```bash
git remote get-url origin
```

אם אין remote — **עצור** ושלח את התלמיד להריץ `/setup-github` קודם. זה קריטי: בלי GitHub אין CI/CD.

בדוק שה-`vercel` CLI מותקן:

```bash
vercel --version
```

אם לא:

```bash
npm i -g vercel@latest
```

(אם מותקן אבל ישן — הצע שדרוג עם אותה פקודה.)

## שלב 2 — התחברות ל-Vercel

```bash
vercel login
```

(בחר את הדרך המועדפת — GitHub OAuth מומלץ כי זה גם מחבר את הרשאות ה-Git.)

## שלב 3 — Link Project

הרץ מתוך root הפרויקט:

```bash
vercel link
```

בחר:
- **Scope**: החשבון האישי של התלמיד
- **Link to existing project?** → **No** (יצירת פרויקט חדש)
- **Project name**: ברירת המחדל (שם התיקייה)
- **Directory**: `./` (Enter)

זה יוצר את `.vercel/` בתיקייה — הוא כבר ב-`.gitignore` של Next.js templates.

## שלב 4 — חיבור ל-GitHub repo (הכי חשוב)

זה השלב שמפעיל את ה-CI/CD:

```bash
vercel git connect
```

הפקודה תזהה את ה-remote של `origin` ב-GitHub ותחבר אותו לפרויקט ב-Vercel. אם היא שואלת:
- **Branch**: `main`
- **Framework preset**: Next.js (אמור להתגלות אוטומטית)

> ⚠️ מעכשיו — **כל `git push` ל-`main` = production deploy. כל push לbranch אחר = preview deploy**. זה בדיוק מה שרצינו.

## שלב 5 — העלאת Environment Variables

קרא את `.env.local` של התלמיד ושלח את המשתנים ל-Vercel. אל תשלח משתני secrets בצורה רגילה — עדיף להשתמש ב-bulk import:

```bash
vercel env pull .vercel/.env.local.check        # קבל מצב נוכחי (אם יש)
```

ואז בשביל כל משתנה, הרץ (לכל environment: `production`, `preview`, `development`):

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SECRET_KEY production
```

**חשוב לגבי scope:**

| משתנה | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SECRET_KEY` | ✅ | ✅ | ❌ (שמור ב-`.env.local` המקומי) |
| `AI_GATEWAY_API_KEY` (אם קיים) | ✅ | ✅ | ✅ |

הדרך יעילה יותר: לאחר מילוי `.env.local`, התלמיד יכול לעלות בתשלום אחד דרך הדשבורד (`https://vercel.com/<team>/<project>/settings/environment-variables` → **Import .env**).

שאל אותו דרך `AskUserQuestion` (כותרת: "העלאת env vars"):
- `"Import .env דרך הדשבורד" (מומלץ — מהיר ובלי להדביק מפתחות לטרמינל)`
- `"vercel env add מהטרמינל, אחד-אחד"`

> 💡 שים לב: `NEXT_PUBLIC_APP_URL` ב-production צריך להיות ה-URL האמיתי (`https://<project>.vercel.app` או custom domain) — לא `localhost:3000`.

## שלב 6 — Supabase: הוסף את Vercel URL ל-Redirect URLs

אחרי שהפרויקט קיים ב-Vercel, הוא יקבל URL בצורה `https://<project>.vercel.app`. התלמיד צריך להוסיף אותו לרשימת ה-**Redirect URLs** ב-Supabase (אחרת auth redirect יישבר בפרודקשן):

1. Supabase Dashboard → Project Settings → Authentication → URL Configuration
2. הוסף תחת **Redirect URLs**:
   ```
   https://<project>.vercel.app/**
   https://<project>-*.vercel.app/**       (לdeployments preview)
   ```
3. עדכן גם את **Site URL** ל-domain הסופי (אם קיים).

הסבר לתלמיד בעברית למה זה חשוב: בלי זה, התחברות מהאפליקציה ב-production תחזיר שגיאה של `redirect_uri_mismatch`.

## שלב 7 — (אופציונלי) `vercel.ts` config

שאל את התלמיד דרך `AskUserQuestion` (כותרת: "vercel.ts"):
- `"דלג — לא צריך" (מומלץ — Next.js נתמך אוטומטית בלי vercel.ts)`
- `"כן, אני רוצה config מתקדם (rewrites/headers/crons)"`

אם בחר באופציה השנייה — הצע להתקין את `@vercel/config` וליצור `vercel.ts` בשורש.

```bash
npm install @vercel/config
```

> השתמש ב-skill `vercel:deployments-cicd` אם התלמיד רוצה לצלול לקונפיגורציות מתקדמות.

## שלב 8 — הדיפלוי הראשון (דרך Git, לא דרך CLI)

**חשוב: אנחנו לא מריצים `vercel --prod`.** זו הנקודה של כל הסטאפ הזה — הדיפלוי קורה ב-push.

לפני הפוש — שאל את התלמיד דרך `AskUserQuestion` (כותרת: "דיפלוי ראשון לפרודקשן"):
- `"כן, push ל-main = production deploy" (מומלץ)`
- `"חכה — אני אבדוק קודם"`

```bash
git add -A
git commit -m "chore: configure Vercel deployment"
git push origin main
```

פתח את דשבורד Vercel וצפה ב-build:

```bash
vercel ls                  # list recent deployments
```

או בדפדפן:

```bash
vercel inspect             # opens current deployment
```

## שלב 9 — בדיקה

אחרי שה-build ירוק:

1. פתח את ה-URL בדפדפן — ודא שהאפליקציה עולה.
2. נסה להתחבר (Supabase auth) — ודא שה-redirect עובד.
3. אם משהו לא עובד:
   - `vercel logs <deployment-url>` לראות logs
   - בדוק env vars חסרים: `vercel env ls`
   - ודא ש-Redirect URLs ב-Supabase נכונים

## שלב 10 — סיכום

הצג לתלמיד בעברית:

- ✅ Vercel project מחובר ל-GitHub
- ✅ CI/CD פעיל: `git push` = deploy
- ✅ Environment variables סונכרנו
- ✅ Supabase Redirect URLs עודכנו
- 🚀 **Production URL**: `https://<project>.vercel.app`
- 💡 **Preview deploys**: כל PR/branch יקבל URL משלו אוטומטית
- 📝 **דיפלוי הבא**: פשוט עשה `git push` — זהו. אל תריץ `vercel --prod` ידנית.

> 🎯 **best practices שהתלמיד קיבל:**
> - אין deploys ידניים — כל production deploy עובר דרך `main` ב-Git
> - Preview deploys אוטומטיים לכל branch → feature testing נקי
> - Env vars מנוהלים דרך Vercel Dashboard / CLI — לא נדחפים לקוד
> - Supabase auth עובד גם מ-preview URLs בזכות wildcard redirect
