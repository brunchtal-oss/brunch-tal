---
description: יצירת GitHub repo וחיבור הפרויקט המקומי אליו — תנאי מקדים לדיפלוי אוטומטי ב-Vercel
---

אתה עוזר לתלמיד "Game Changer" ליצור **GitHub repository** ולחבר אליו את הפרויקט המקומי. זה **תנאי מקדים** ל-`/setup-vercel` — כל הדיפלויים יעבדו דרך `git push`, לא דרך Vercel CLI.

## כללים

- **עברית** בהסברים, **אנגלית** בלבד ב-CLI commands ובתוך code blocks.
- **אל תעשה פעולות destructive** (מחיקת repo, force push, וכו') בלי אישור מפורש.
- **אל תחשוף טוקנים** בפלט.

## 🎛️ איך לשאול את התלמיד שאלות

התלמיד הוא **לא בהכרח טכנאי**. אל תבקש ממנו להקליד "כן" / "המשך" — זה איטי ומבלבל.

- כל בחירה / אישור — **חובה** דרך `AskUserQuestion` (כפתורי בחירה).
- בהחלטות טכניות שהוא לא בהכרח מבין — שים את האופציה הנכונה **ראשונה** וסמן אותה `(מומלץ)`.
- שאלת טקסט חופשי (כמו שם ה-repo): הצע ברירת מחדל, ושאל ב-`AskUserQuestion` "להשתמש בברירת המחדל `<NAME>`?" עם אופציות `"כן, השתמש ב-<NAME>" (מומלץ)` / `"לא, אתן שם אחר"` (במקרה השני בקש את השם).

## שלב 1 — Prerequisites

בדוק שה-`gh` CLI מותקן ושהתלמיד מחובר:

```bash
gh --version
gh auth status
```

אם `gh` לא מותקן — הדרך את התלמיד:

```bash
brew install gh          # macOS
# או: https://cli.github.com/ להתקנות אחרות
```

אם לא מחובר:

```bash
gh auth login
```

(בחר GitHub.com → HTTPS → אישור דרך browser.)

## שלב 2 — בדיקת מצב הפרויקט

1. ודא שיש git repo מקומי (`git status`). אם לא — צור (`git init -b main`).
2. בדוק שכבר לא קיים remote בשם `origin` (`git remote -v`). אם כן — שאל ב-`AskUserQuestion` (כותרת: "Remote קיים"):
   - `"לבטל — אני אסיים לבד" (מומלץ)`
   - `"החלף את ה-remote הקיים בחדש"` (פעולה destructive — וודא לפני)
3. ודא ש-`.env.local` וקבצי secrets כבר ב-`.gitignore` לפני שדוחפים. **זה קריטי** — אסור לדחוף מפתחות.

## שלב 3 — שאל את התלמיד

השתמש ב-`AskUserQuestion` לכל אחת מהשאלות הבאות (אל תבקש שיקליד תשובות):

1. **שם ה-repo** — קח ברירת מחדל משם הפרויקט ב-`package.json`. שאל (כותרת: "שם ה-repo"):
   - `"השתמש ב-<DEFAULT_NAME>" (מומלץ)`
   - `"אני אבחר שם אחר"` (אם זה נבחר — בקש את השם בהודעה רגילה)

2. **public או private?** שאל (כותרת: "סוג הריפו"):
   - `"Private — פרטי" (מומלץ — תמיד אפשר להפוך ל-public אחר כך)`
   - `"Public — פתוח לציבור"`

3. **תיאור קצר** — שאל (כותרת: "תיאור"):
   - `"בלי תיאור" (מומלץ — אפשר להוסיף אחר כך)`
   - `"אני אוסיף תיאור"` (אם נבחר — בקש את התיאור)

## שלב 4 — יצירה ודחיפה

צור את ה-repo ודחוף את הקוד בפקודה אחת עם `gh repo create`:

```bash
gh repo create <REPO_NAME> --private --source=. --remote=origin --push --description "<DESCRIPTION>"
```

(שנה `--private` ל-`--public` אם התלמיד בחר public.)

אם יש שינויים לא commited — עשה commit קודם:

```bash
git add -A
git commit -m "chore: prepare for initial push"
```

## שלב 5 — ודא CI-ready

אחרי שה-repo נוצר:

1. ודא שה-URL של ה-repo הודפס (`gh repo view --web` פותח בדפדפן אם צריך).
2. בדוק שה-default branch הוא `main`:
   ```bash
   git branch --show-current
   ```
3. שאל את התלמיד דרך `AskUserQuestion` (כותרת: "Branch protection") אם להגדיר הגנה על `main`:
   - `"דלג בינתיים" (מומלץ — אפשר תמיד להוסיף אחר כך, ובפרויקטים פרטיים זה דורש GitHub Pro)`
   - `"כן, הסבר לי איך"` (אם נבחר — הצג את הפקודה למטה והסבר על דרישת GitHub Pro)

אם בחר להפעיל branch protection, הסבר שזה דורש GitHub Pro לפרויקטים private, ואפשר להגדיר ידנית בדשבורד או עם:

```bash
gh api -X PUT "repos/:owner/:repo/branches/main/protection" --input protection.json
```

(אל תריץ את זה אוטומטית — רק הראה.)

## שלב 6 — סיכום

הצג לתלמיד בעברית:

- ✅ Repo נוצר: `<URL>`
- ✅ Branch ראשי: `main`
- ✅ Remote `origin` מחובר
- 📝 הצעד הבא: `/setup-vercel` — יחבר את ה-repo הזה ל-Vercel ויגדיר CI/CD אוטומטי. מעכשיו **כל `git push` ידביק deploy**.

> ⚠️ **תזכורת חשובה:** לעולם אל תדחוף את `.env.local` או את `.mcp.json`. הם ב-`.gitignore` — אבל אם הוספת קבצי secrets אחרים, ודא שגם הם שם לפני `git push` הבא.
