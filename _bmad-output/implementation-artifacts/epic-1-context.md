# Epic 1 Context: E1 תשתית: הפעלה והתחברות בטלפון

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

להקים את הבסיס שכל אפיק אחר נשען עליו: הרשאות מסד מפורשות, schema `private`, חוזה RPC אחד, עזרי זמן, כסף וטלפון, שלוש מעטפות עם טוקני העיצוב, CI ואתר נעול. קודם כול, ניסוי (tracer) שמוכיח בטלפון אמיתי שלקוחה בדויה מפעילה חשבון בקישור חד-פעמי, בוחרת סיסמה, מתחברת ונשארת מחוברת, בלי שירות מייל או הודעות. אין כאן טבלאות או מסכים עסקיים.

## Stories

- Story 1.1: Phone activation and login tracer
- Story 1.2: Tooling, lint rules and CI
- Story 1.3: Time, money and phone helpers
- Story 1.4: RPC contract: idempotency, audit, errors, types
- Story 1.5: Design tokens, fonts and the three shells
- Story 1.6: Site lock, environments and preview deploy
- Story 1.7: Refactor sweep

## Requirements & Constraints

- התחברות במייל וסיסמה דרך Supabase Auth בלבד. אין ניתוק אוטומטי: לקוחה וטל נשארות מחוברות.
- אין ספק מייל: איפוס סיסמה ידני, דרך קישור אישי וחד-פעמי שטל מפיקה. הזנת מייל לא מאמתת אותו.
- הרשמה ציבורית כבויה; חשבון נוצר רק דרך קישור תקף. Confirm email כבוי. "Automatically expose new tables" כבוי.
- קישור: טוקן אקראי חזק, במסד נשמר רק גיבוב, תקף 48 שעות, נצרך פעם אחת, פתיחה או תצוגה מקדימה לא צורכות אותו, והפקת חדש מבטלת את הקודם.
- סיסמאות, טוקנים וקישורים לא נשמרים ביומן, בלוג או במסד העסקי. לוג שרת מכיל רק מזהים וקודי שגיאה.
- נתונים בדויים בלבד. ה-repo ציבורי. האתר נעול ב-Basic Auth עד תחילת E5.
- המעטפות מציגות רק פריטי ניווט שהמסך שלהם כבר קיים. אין טקסט שיווקי או ערך עסקי בקוד: שם העסק, פרטי הקשר וטקסטי הפוטר מגיעים מתוכן שפורסם; בקוד רק מיקרו-קופי (ניווט, כפתורים, שגיאות).
- Done when של האפיק: הניסוי בטלפון; lint, typecheck ו-test ב-CI; בדיקות עזרי זמן, טלפון וכסף; security advisor נקי (WARN ‏0029 על RPC מסוג definer מאושר); preview נעול.

## Technical Decisions

- **שכבות:** הליבה העסקית במסד (plpgsql, עסקה אחת לכל פעולה). Next.js מתאם דק: Server Components קוראים דרך RLS, Server Actions קוראים RPC דרך `callRpc` ומחזירים `{ ok: true, data } | { ok: false, code }`.
- **זהות:** `profiles.id = auth.users.id`, בלי FK ל-`auth.users`. `private.current_customer_id()` מחזיר `auth.uid()` רק לפרופיל עם `activated_at` ובלי `anonymized_at`. אדמין רק לפי `admin_roles` דרך `private.is_admin()`. מייל נשמר רק ב-`auth.users`.
- **הרשאות:** ברירות המחדל של Supabase מבוטלות ב-`public` וב-`private`; `private` לא חשוף ב-API; כל grant מפורש. RPC: `security definer`, `set search_path = ''`, בדיקת הרשאה בשורה הראשונה, revoke מכל התפקידים ואז grant אחד בדיוק, אף פעם לא `anon`.
- **שגיאות, idempotency ויומן:** `raise exception '<CODE>' using errcode = 'P0001'`, מיפוי למיקרו-קופי רק ב-`lib/errors.ts`. חוזה `private.idempotency_results` ו-`audit_log` חל על כל RPC משנה.
- **טוקנים ואיפוס:** נוצרים ונמצאים רק ב-SQL (`private.issue_token`/`find_token`). איפוס: `reset_begin`/`reset_complete` (service role בלבד), מתוזמרים ב-`lib/server/privileged/reset.ts`, בשלושה שלבים: כוונה במסד, קריאה ל-Auth Admin API, סגירה.
- **service role:** רק ב-`lib/server/privileged/service-client.ts` עם `server-only`; לא לקריאת נתוני לקוחות.
- **מפת נתיבים קבועה, כתובות באנגלית, כותרות בעברית:** `app/(public)` (top-bar, menu-sheet, whatsapp-bar, פוטר); `app/(auth)` בלי ניווט (`/login`, `/admin/login` עם אותו רכיב טופס, `/reset/[token]`, `/join/[token]`); `app/me` (לקוחה); `app/admin/(shell)` (אדמין, כולל `/admin/more` ו-`/admin/notifications`). מסך חדש נוסף תחת מעטפת אחת בלבד.
- **שמירת מעטפות:** `app/me/layout.tsx` דורש `get_my_session_role() = 'customer'`, ו-`app/admin/(shell)/layout.tsx` דורש `admin`; אחרת הפניה ל-`/login?next=…` או `/admin/login?next=…`. הבדיקה בתוך רכיב עטוף `<Suspense>` (`cacheComponents: true`), ולכן ההפניה היא בזרם (200) ולא 307. זו נוחות בלבד; ההרשאה האמיתית היא RLS ו-RPC. `/me` ו-`/admin` דינמיים עם `Cache-Control: private, no-store`; `export const instant = false` מותר רק ב-layout שלהם.
- **נתיבי טוקן:** `Referrer-Policy: no-referrer`, `no-store`, בלי משאבי צד שלישי (גופנים רק דרך `next/font`).
- **עיצוב בקוד:** טוקני DESIGN.md ממופים למשתני shadcn ב-`:root` של `app/globals.css`, בלי בלוק `.dark` ובלי ThemeProvider. ערכות הקונספט (צבע נייר, דיו, גופן) רק ב-`lib/concepts/themes.ts` וב-CSS, והמסד שומר רק מפתח; גופני הקונספט נטענים רק ברכיבי המפגש (לא בסיפור הזה). רכיבי `components/ui/` הם shadcn ולא נערכים ידנית; רכיבי מעטפת ב-`components/{public,customer,admin,shared}/`.
- **Migrations:** `npx supabase migration new <verb>_<subject>`, מוחלת ב-MCP, סשן אחד בכל זמן, לא עורכים קובץ שהוחל. אחרי כל migration: security advisor ויצירת `database.types.ts`.

## UX & Interaction Patterns

- **אופי:** שקט, קרמי, שטוח, "הצבע מגיע מהאוכל". מצב בהיר בלבד. **אין צללים** (רכיבי shadcn עם `shadow-*` מאופסים), הפרדה בטון, קו `border` דק ומרווח. shadcn base-nova, RTL, אייקוני lucide 20–24px, אייקונים כיווניים משתקפים.
- **צבעים ("קרם וזית"):** background #FAF6EE, card #FFFDF8, muted #F2ECDF, ink #2E2A1F, ink-muted #6B6450, border #E6DFCF (קישוטי בלבד), primary #4A4A2A, on-primary #FAF6EE. מיפוי shadcn: `--accent` = muted (משטח hover), והזית #8A875A נחשף כ-`--brand-accent` וגרפי בלבד (לא טקסט ולא רקע לטקסט). `--input` = ink-muted (מסגרת שדה 3:1), `--ring` = primary, `--destructive` #B42318, `--radius` 0.5rem, `--sidebar*` = card/ink/primary/muted/border. צבעי מצב (success, warning, error, pending, expired, כל אחד עם tint ו-dot) נרשמים כמשתנים חדשים ב-`@theme inline`; הערכים ב-DESIGN.md.
- **גופנים:** Heebo לכותרות ול-wordmark (כל הכותרות במשקל 300; 200 רק ב-wordmark הגדול על קרם), Assistant לגוף, תוויות, כפתורים ותמיד למספרים ותאריכים. Google Fonts עם subset עברי, `display=swap`. מינימום 13px לכל טקסט; שדות 16px. בלי italic ובלי UPPERCASE. טלפונים ומספרים מעורבים ב-`<bdi>`.
- **ריווח וצורה:** סולם 4/8/12/16/24/32/48/64; שוליים בטלפון 24px; בין סקשנים 48px באתר הציבורי ו-32px באזור האישי ובאדמין; יעד מגע 44px, CTA ‏48px; רוחב תוכן מרבי 720px. פינות: 4px כפתורים ושדות, 8px כרטיסים, 12px רק לפינות עליונות של גיליון. גובה מכלים עם טקסט ב-`min-height`.
- **פוקוס:** טבעת דו-גונית ב-`:focus-visible` לכל רכיב (`ring-2 ring-primary ring-offset-2 ring-offset-background`), אף פעם `outline: none`.
- **מעטפת ציבורית:** `top-bar` ברקע background, wordmark (Heebo 20/300) ב-inline-start; ב-inline-end כפתור תפריט (lucide Menu, ‏44×44) ו"כניסה לאזור האישי" (`button-secondary`). התפריט פותח `menu-sheet` (Sheet מצד inline-end, רוחב min(320px, 85vw), wordmark + X, עמוד נוכחי בפס accent 2px ב-inline-start, בתחתית "כניסה לאזור האישי" ברוחב מלא ומתחתיו מדיניות פרטיות והצהרת נגישות). פוטר עם קישורים קבועים (מדיניות, נגישות, "כניסת מנהלת" קטן). `whatsapp-bar` צמוד לתחתית ("להצטרפות צרי קשר עם טל", success, 48px, מעל safe-area), והעמוד שומר מקום מתחתיו (`padding-bottom` ו-`scroll-padding-bottom`).
- **מעטפת אזור אישי:** `top-bar` בגרסת app (שורת wordmark בלבד, ריפוד 12px); `bottom-tab-bar` בכל רוחב (גם בדסקטופ, ממורכז): בית · מפגשים · ההרשמות שלי · התראות · פרופיל. רקע card, קו עליון, `min-height` 64px + safe-area, אייקון 24px מעל תווית 13px; פעיל ב-ink, 600 ופס accent 24px מעל האייקון; לא פעיל ink-muted.
- **מעטפת אדמין:** סרגל עליון עם wordmark ו-`bell-button` (Bell 24px, מונה pill ב-primary) ל-`/admin/notifications`. בטלפון `bottom-tab-bar`: בית · מפגשים · לקוחות · תשלומים · עוד (`/admin/more` מרכז את השאר, ובתחתיתו הצהרת נגישות). מ-`lg` (1024) `side-nav` ברוחב 240px, רקע card, פריט פעיל ברקע muted ופס accent, וכל פריטי "עוד" ברמה אחת.
- **נגישות בכל מעטפת:** "דילוג לתוכן הראשי" ראשון בסדר הטאב; landmarks `header`/`nav` עם `aria-label`/`main`/`footer` (ו-`aside` לפס הוואטסאפ); `h1` אחד; `<title>` "{שם העמוד} · בראנץ׳ אצל טל"; אחרי מעבר עמוד הפוקוס עובר ל-`h1` (`tabindex=-1`); תוויות בעברית לכל כפתור אייקון; מונה התראות כלול בשם הקישור; `prefers-reduced-motion` מכובד; reflow ב-320px וזום 200%. הצהרת נגישות מקושרת מהפוטר, מ-`menu-sheet`, מדף ההתחברות, מ"פרופיל" ומ"עוד".
- **התחברות ואיפוס:** מייל וסיסמה; "שכחתי סיסמה" מסביר שטל תשלח קישור, עם וואטסאפ לטל; כישלון "המייל או הסיסמה לא תואמים" ב-`role="alert"`. מסכי הקישור (תקף, כבר מומש, פג) כבר מומשו ב-1.1.

## Cross-Story Dependencies

- 1.1 קודם לכול. אחריו 1.2, 1.5 ו-1.6 לא נוגעים במסד; 1.3 ואחריו 1.4 (migrations בטור). 1.1–1.6 הושלמו; push ל-main מותר רק באישור, כי הוא מפעיל פריסה (נעולה).
- 1.5 משתמש ב-`get_my_session_role` וב-layout של `/me` מ-1.1. הלולאה `/me` ← `/login` (אדמין אחרי איפוס, או מחוברת שאינה לקוחה פעילה) נסגרה ב-1.5: יעד לפי תפקיד (`/admin`) והודעה למי שמחוברת בלי הרשאה.
- 1.7 אוסף את הפריטים שנדחו ב-`deferred-work.md`.
- E2 מוסיף עמודות ל-`profiles` ובונה הצטרפות על תשתית הטוקנים; 2.8 מחליף את סקריפט ה-dev בכפתור `admin_issue_link`. מסכים עסקיים של אפיקים מאוחרים נכנסים לתוך המעטפות של 1.5 ומוסיפים את פריט הניווט שלהם כשהם קיימים.
