---
title: '5.9 PWA install and offline — התקנה ואופליין'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '63eafd77422e2d4ff1b7b48ab5e03f577280a06c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/demo-scope-2026-10-04.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** האתר לא ניתן להתקנה. באייפון פוש עובד רק באפליקציה שהותקנה למסך הבית (מקור §11, ‏iOS 16.4+), ולכן 5.8 תלוי בסיפור הזה. ההדגמה רצה באתר נעול. כרגע ה-manifest נחסם ב-401 (Next מוסיף `use-credentials` רק ב-preview), ואפליקציה מותקנת באייפון לא מציגה חלון Basic Auth. היקף ההדגמה: התקנה. אופליין מלא ומצב קריאה בלבד לא נכנסים.

**Approach:** ‏`app/manifest.ts`, אייקונים, ‏`public/sw.js` שנכתב ביד לפי AD-16, ‏`/offline` סטטי, ‏`/install` עם הדרכה, ‏push ו-notificationclick בסיסיים (הרשאה ומנויים ב-5.8). הנעילה נשארת, ומקבלת שלוש תוספות שמאפשרות התקנה באתר נעול (החלטת המשתמשת 2026-10-04, אפשרות A).

## Boundaries & Constraints

**Always:**
- ‏`public/sw.js`: ‏JS עם `// @ts-check`, בלי כלי בנייה, ‏`Cache-Control: no-cache`. נרשם רק ב-production build (`scope: '/'`, ‏`updateViaCache: 'none'`).
- המטמון מטפל רק ב-GET מאותו origin: ‏`/_next/static/*` ו-`/icons/*` הם cache-first (רק 200 נשמר). ‏`/offline` ונכסי ה-`/_next/static` שלו נשמרים ב-install. לשם המטמון יש `VERSION`, ו-activate מוחק גרסאות ישנות.
- ניווט GET הוא network-only. רק כשל רשת מחזיר את `/offline` מהמטמון. 401 (הנעילה) או 500 עוברים כמו שהם.
- כל `push` מסתיים ב-`showNotification`, גם בלי payload או כשה-payload שבור (כותרת `WORDMARK`). החוזה מול 5.8: ‏`{ title, body, target_path }`. ‏notificationclick פותח את `target_path` רק כשהוא מתחיל ב-`/me` או ב-`/admin`, אחרת `/`. אם יש חלון פתוח, עוברים אליו. אחרת נפתח חלון חדש.
- ‏manifest: ‏`name` ו-`short_name` "בראנץ׳ אצל טל", ‏`lang: 'he'`, ‏`dir: 'rtl'`, ‏`display: 'standalone'`, ‏`start_url: '/me'`, ‏`theme_color` ‏`#4A4A2A`, ‏`background_color` ‏`#FAF6EE`, אייקונים 192, 512 ו-maskable 512. ב-layout: ‏`appleWebApp` (capable, title) ו-`/icons/apple-touch-icon.png` (180).
- אייקון: "צלחת מלמעלה". רקע זית `#4A4A2A`, עיגול קרם `#FAF6EE` ובתוכו טבעת דקה, בלי טקסט.
- ‏`/offline` סטטי לגמרי (בלי מסד ובלי cookies), מחוץ למעטפות. ‏`/install` נמצא תחת `(public)`, והפוטר הציבורי מקשר אליו. כפתור אנדרואיד מוצג רק אחרי `beforeinstallprompt`, ובלעדיו מוצגים הצעדים. ב-`display-mode: standalone` מוצג "כבר מותקנת".
- **נעילה (AD-22):**
  1. ‏`SITE_LOCK_PUBLIC_FILES` היא רשימה חדשה ונפרדת: ‏`/manifest.webmanifest` (מדויק) ו-`/icons/` (prefix). ‏`SITE_LOCK_EXEMPT_PREFIXES` לא משתנה.
  2. כשנכנסים עם Basic Auth תקין ובלי עוגייה תקינה, נשמרת עוגיית `site_lock`: ‏HttpOnly, ‏Secure, ‏SameSite=Lax, ‏Path=/, ‏30 יום. הערך הוא HMAC-SHA256 של המשתמש, במפתח של סיסמת הנעילה. עוגייה תקינה פותחת כמו Basic Auth, והחלפת משתמש או סיסמה מבטלת אותה. ההשוואה ב-`timingSafeEqual`.
  3. כש-GET נדחה עם `Accept: text/html`, תשובת ה-401 (עם `WWW-Authenticate`) מכילה דף טופס בעברית, ‏RTL, עם צבעי DESIGN: שם משתמש, סיסמה ו-`next` נסתר. ‏`POST /site-lock` מטופל בתוך `proxy.ts`: כשהפרטים נכונים, ‏303 ל-`next` עם העוגייה; כשהם שגויים, ‏401 עם הטופס והשגיאה. ‏`next` מתקבל רק כשהוא מתחיל ב-`/` ולא ב-`//`, אחרת `/`. בקשה שנדחתה ואינה HTML מקבלת את התשובה הקיימת.
- המסכים ודף הטופס מתחילים בסקיל `frontend-design`, בתוך DESIGN.md ו-EXPERIENCE.md. הנוסחים ב-`lib/copy/pwa.ts`, ושל הנעילה ב-`lib/copy/site-lock.ts`.
- בקבצים משותפים (`next.config.mjs`, ‏`lib/nav.ts`, ‏`lib/copy/*`, ‏`deferred-work.md`) רק מוסיפים. ב-`proxy.ts` השינוי מצומצם לנעילה.

**Never:**
- לא נשמרים במטמון: HTML של `/me` או `/admin`, ‏`/api`, בקשות RSC (`?_rsc`), ותשובה שאינה 200.
- אין RPC, טבלה או מיגרציה. לא נוגעים ב-`/me/sessions`, ב-session-card או ב-concept-header (סשן 3.2).
- אין offline queue, אין מצב קריאה בלבד ואין השבתת כפתורים באופליין (נדחה). פעולה שנשלחת בלי רשת נכשלת עם השגיאה הקיימת ולא מציגה אישור.
- אין next-pwa או Workbox. אין נתיב חדש ברשימת הפטורים. הסיסמה לא נשמרת בעוגייה.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ניווט עם רשת | ‏`navigate` ל-`/me` | מהרשת, כלום לא נשמר | — |
| ניווט בלי רשת | ‏`fetch` נכשל | ‏`/offline` מהמטמון | ‏`/offline` לא במטמון: ‏`Response.error()` |
| נכס סטטי | ‏`/_next/static/x.js` | מהמטמון, ואם אינו שם, מהרשת ונשמר | תשובה שאינה 200 לא נשמרת |
| ‏API או RSC | ‏`/api/x`, ‏`/me?_rsc=1` | בלי `respondWith` | — |
| push | ‏`{title, body, target_path:'/me/bookings'}` | התראה, ולחיצה פותחת `/me/bookings` | בלי data או לא JSON: ‏`WORDMARK`. ‏`target_path` חיצוני: ‏`/` |
| נעול, manifest | ‏`/manifest.webmanifest` בלי פרטים | 200 | — |
| נעול, עוגייה | עוגייה תקינה, בלי Basic | עובר | עוגייה מזויפת או ישנה: נדחה |
| נעול, Basic תקין | בלי עוגייה | עובר, ונשמרת `site_lock` | — |
| נעול, דף | GET ‏HTML בלי פרטים | ‏401, ‏`WWW-Authenticate` וטופס | לא HTML: התשובה הקיימת |
| טופס | ‏`POST /site-lock` נכון, ‏`next=/me` | ‏303 ל-`/me` + עוגייה | שגוי: ‏401 וטופס עם שגיאה. ‏`next=//x`: ‏`/` |

</frozen-after-approval>

## Code Map

- `lib/site-lock.ts` -- ‏`checkSiteLock` (טהור, ‏`sameSecret` לשימוש חוזר), ‏`siteLockDeniedResponse`. הרשימה, העוגייה, דף הטופס וטיפול ה-POST נכנסים לכאן כפונקציות טהורות.
- `proxy.ts` -- הנעילה רצה ראשונה. ‏`STATIC_ASSET` מדלג על רענון ה-session. כאן מעבירים את ה-cookie, מצמידים `site_lock` לתשובה של `updateSession` ומטפלים ב-`POST /site-lock` לפני `updateSession`.
- `lib/site-lock.test.ts`, ‏`proxy.test.ts` -- דפוסי הבדיקה (`vi.stubEnv`, ‏`NextRequest`).
- `next.config.mjs` + `next.config.test.ts` -- ‏`headers()`: מוסיפים רשומה ל-`/sw.js` (`no-cache`, ‏`application/javascript; charset=utf-8`).
- `app/layout.tsx` -- ‏`metadata`, ‏`viewport.themeColor`, רכיב הרישום.
- `app/(public)/layout.tsx`, ‏`components/public/site-footer.tsx` -- המעטפת של `/install` והקישור בפוטר.
- `components/shared/wordmark.tsx`, ‏`page-heading.tsx`, ‏`inline-notice.tsx`, ‏`components/ui/card.tsx`, ‏`button.tsx` -- שימוש חוזר.
- `lib/copy/shell.ts` (`WORDMARK`), ‏`lib/nav.test.ts` (לכל href יש page).
- `node_modules/sharp` -- זמין ליצירת PNG מ-SVG.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/generate-icons.mjs` + `public/icons/*.png` -- ‏SVG ← ‏PNG ב-sharp: ‏192, ‏512, ‏maskable 512, ‏apple-touch-icon 180. הקבצים נשמרים ב-git.
- [x] `app/manifest.ts` -- לפי Always.
- [x] `public/sw.js` -- ‏install, ‏activate, ‏fetch, ‏push, ‏notificationclick.
- [x] `test/sw.test.ts` -- מריץ את sw.js ב-`vm` עם `self`, ‏`caches`, ‏`clients` ו-`fetch` מדומים. מכסה את שורות ה-SW במטריצה, ומוודא שאחרי ניווט ל-`/me`, ל-`/admin` ול-`/api` יש במטמון רק `/offline`, ‏`/_next/static` ו-`/icons`.
- [x] `components/shared/service-worker-register.tsx` + `app/layout.tsx` -- רישום, ‏metadata ו-viewport.
- [x] `next.config.mjs` + `next.config.test.ts` -- כותרות `/sw.js`.
- [x] `app/offline/page.tsx` -- ‏`frontend-design`. ‏wordmark, ‏h1, ההסבר ו"לנסות שוב".
- [x] `app/(public)/install/page.tsx` + `components/public/install-guide.tsx` (+ test) -- ‏`frontend-design`. שני כרטיסים, צעדים ממוספרים, כפתור, "כבר מותקנת".
- [x] `components/public/site-footer.tsx` -- קישור "התקנת האפליקציה".
- [x] `lib/copy/pwa.ts`, ‏`lib/copy/site-lock.ts` -- הנוסחים המאושרים (ראו Design Notes).
- [x] `lib/site-lock.ts` + `lib/site-lock.test.ts` -- הרשימה, העוגייה, הטופס וה-POST. מכסה את שורות הנעילה במטריצה.
- [x] `proxy.ts` + `proxy.test.ts` -- החיבור.
- [x] סשן ראשי: ‏`deferred-work.md` (השבתת כפתורים באופליין, קישור מהפרופיל ב-2.10, הגבלת ניסיונות בטופס הנעילה), ‏AD-22 ב-memlog של הארכיטקטורה, ‏README (בדיקה בטלפון והנעילה באפליקציה).

**Acceptance Criteria:**
- Given build של production, when פותחים DevTools › Application, then ה-manifest תקין, ה-SW פעיל והאתר ניתן להתקנה.
- Given ניווט ב-`/me` וב-`/admin` ואחריו Offline, when בודקים את Cache Storage, then אין HTML שלהם ואין `/api`, וניווט מציג `/offline`.
- Given טופס הרשמה או ביטול פתוח, when שולחים בלי רשת, then מוצגת שגיאה ולא אישור.
- Given אתר נעול, when מתקינים באנדרואיד ובאייפון לפי `/install` ופותחים מהאייקון, then אחרי הזנת פרטי הנעילה בטופס האפליקציה נפתחת במסך מלא ונשארת פתוחה גם בפתיחות הבאות.

## Implementation Notes

- בדיקת ה-SW עברה מ-`public/sw.test.ts` ל-`test/sw.test.ts`, כדי שלא תוגש כקובץ סטטי.
- ‏Next דוחה Location יחסי מתוך ה-proxy, ולכן `handleSiteLockPost` מקבל את ה-origin. ‏`next` נדחה גם כשהוא מכיל `\` או תו בקרה.
- העוגייה לא נשמרת בתשובה לקובץ סטטי, אלא בתשובה הבאה לדף.
- משימות "סשן ראשי" בוצעו: ‏deferred-work (שלוש רשומות), ‏memlog של הארכיטקטורה (AD-22), ‏README.

## Spec Change Log

## Review Triage Log

**סבב 1 (quick, מבקר אחד):** ‏4 ממצאים. ‏medium 1, ‏low 3.

| # | ממצא | verdict | route | ראיה / פעולה |
|---|---|---|---|---|
| 2 | ‏`GET /site-lock` מקבל טופס עם `next=/site-lock`, ואחרי כניסה מגיע ל-404 | low | patch | ‏`safeLockNext` ממיר את נתיב הטופס ל-`/` |
| 4 | ‏`// @ts-check` של `public/sw.js` לא נבדק ב-typecheck או ב-CI (`tsconfig` כולל רק ts/tsx) | medium | patch | ‏`tsconfig.sw.json` ו-`typecheck` מריץ גם אותו |
| 1b | אייקון שנוצר מחדש נשאר ישן במטמון (cache-first, שם בלי hash) עד שמעלים `VERSION` | low | patch | ההערה ב-sw.js וה-README: להעלות את `VERSION` גם כשמחליפים אייקונים |

נדחו: ‏1a (מטמון `/_next/static` גדל בין פריסות; זניח, הדפדפן מפנה לפי מכסה, והתיקון מוסיף לוגיקה), ‏3 (סימון משימות ב-spec; תיקון של ה-spec עצמו).

## Design Notes

**נוסחים מאושרים (2026-10-04):** ‏`/install`: כותרת "התקנת האפליקציה". פתיח: "אפשר להוסיף את האתר למסך הבית ולפתוח אותו כמו אפליקציה."
- כרטיס "אנדרואיד": כפתור "התקנת האפליקציה", או הצעדים: 1. "פתחי את האתר ב-Chrome." 2. "לחצי על התפריט ⋮ בפינה." 3. "בחרי "התקנת אפליקציה" או "הוספה למסך הבית"."
- כרטיס "iPhone": הערה "באייפון, התראות מגיעות רק אחרי הוספה למסך הבית, ב-iOS 16.4 ומעלה." צעדים: 1. "פתחי את האתר ב-Safari." 2. "לחצי על כפתור השיתוף (ריבוע עם חץ למעלה)." 3. "בחרי "הוספה למסך הבית"." 4. "לחצי "הוספה". מעכשיו פותחים מהאייקון במסך הבית."
- מותקנת: "האפליקציה כבר מותקנת במכשיר הזה."
- ‏`/offline`: כותרת "אין חיבור". טקסט: "נראה שאין חיבור כרגע. אי אפשר להירשם או לבטל בלי חיבור. כשהחיבור יחזור, אפשר לנסות שוב". כפתור "לנסות שוב".
- פוטר: "התקנת האפליקציה".
- טופס הנעילה: "האתר עדיין סגור.", "שם משתמש", "סיסמה", "כניסה". שגיאה: "שם המשתמש או הסיסמה לא נכונים."

**בדיקה בטלפון (HTTPS בלבד):** ‏SW והתקנה לא עובדים מכתובת 192.168. ה-preview מוגן גם ב-Vercel Authentication, ואפליקציה מותקנת באייפון לא מקבלת את העוגייה של Vercel. לכן אנדרואיד נבדק ב-preview, ואייפון ב-production אחרי המיזוג (זו גם כתובת ההדגמה).

**עדכון ה-SW:** מעלים את `VERSION` כשמשתנה `/offline` או ההתנהגות, כי `/offline` נשמר רק ב-install.

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` -- עוברים.
- `npx next start` אחרי build, ואז `curl -sI localhost:3000/sw.js` -- ‏200 עם `no-cache`. ‏`/manifest.webmanifest` ‏200. עם `SITE_LOCKED=true`: ‏manifest ‏200, ‏`/` עם `Accept: text/html` ‏401 וטופס.

**Manual checks:**
- בדיקה בעין בטלפון לפי Design Notes.
