---
name: בראנץ׳ אצל טל
description: Warm, quiet, type-led brunch hosting site + customer area + admin panel for new mothers. shadcn/ui (base-nova, RTL) on Next.js; this file is the brand-layer delta. Light mode only.
status: final
created: 2026-09-23
updated: 2026-09-23
sources:
  - ../../../../brunch_at_tal_charecter.md   # מקור האמת — גובר על SPEC בכל סתירה (למעט החלטות משותפות ב-memlog)
  - ../../../specs/spec-brunch-at-tal/SPEC.md
  - ../../../specs/spec-brunch-at-tal/site-map.md
colors:
  # Palette "קרם וזית" (color-themes-1 variant 2). Light mode only.
  background: '#FAF6EE'
  card: '#FFFDF8'
  muted: '#F2ECDF'
  ink: '#2E2A1F'
  ink-muted: '#6B6450'
  border: '#E6DFCF'
  accent: '#8A875A'          # decorative/graphic only — never text, never behind text
  primary: '#4A4A2A'
  on-primary: '#FAF6EE'
  success: '#4E6B34'
  success-tint: '#E7EDDC'
  success-dot: '#8FA874'
  warning: '#8C5E14'
  warning-tint: '#F4E8D0'
  warning-dot: '#C9A060'
  error: '#B42318'
  error-tint: '#F8E4E1'
  error-dot: '#B42318'
  pending: '#4A5A6A'
  pending-tint: '#E6EAEC'
  pending-dot: '#8C9AA8'
  expired: '#676154'
  expired-tint: '#EDE9E0'
  expired-dot: '#B0A998'
  scrim-ink: '#2E2A1F'       # used with alpha on hero/sheet scrims (same hex as ink)
typography:
  # Display = Heebo (Hebrew by Oded Ezer; free kin of Ezer Block Pro Light). Body/numbers = Assistant (kin of Almoni).
  display-xl:
    # hero wordmark over photo — weight 300 (not 200) for legibility on a scrim
    fontFamily: 'Heebo'
    fontSize: 46px
    fontWeight: '300'
    lineHeight: '1.05'
  display-lg:
    # page / section-lead headings — 300 like all headings (200 is reserved for wordmark-display)
    fontFamily: 'Heebo'
    fontSize: 40px
    fontWeight: '300'
    lineHeight: '1.15'
  wordmark-display:
    # the big business-name wordmark on plain cream only (typographic hero fallback) — the one place for weight 200
    fontFamily: 'Heebo'
    fontSize: 40px
    fontWeight: '200'
    lineHeight: '1.15'
  display-md:
    fontFamily: 'Heebo'
    fontSize: 26px
    fontWeight: '300'
    lineHeight: '1.2'
  display-sm:
    fontFamily: 'Heebo'
    fontSize: 22px
    fontWeight: '300'
    lineHeight: '1.25'
  wordmark:
    fontFamily: 'Heebo'
    fontSize: 20px
    fontWeight: '300'
    lineHeight: '1'
    letterSpacing: 0.01em
  body-lg:
    fontFamily: 'Assistant'
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.65'
  body:
    fontFamily: 'Assistant'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-strong:
    fontFamily: 'Assistant'
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.35'
  body-sm:
    fontFamily: 'Assistant'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Assistant'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  label-strong:
    fontFamily: 'Assistant'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.4'
  eyebrow:
    fontFamily: 'Assistant'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.04em
  button:
    fontFamily: 'Assistant'
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.2'
  numeral-lg:
    fontFamily: 'Assistant'
    fontSize: 26px
    fontWeight: '400'
    lineHeight: '1'
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  '8': 64px
  gutter-mobile: 24px
  section-public: 88px
  section-app: 32px
  touch-min: 44px
  cta-height: 48px
  content-max: 720px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.on-primary}'
    typography: '{typography.button}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.cta-height}'
    padding: '0 22px'
    busy: 'spinner 18px {colors.on-primary} before the label, same width, full opacity (not dimmed)'
    unavailable: '50% opacity + visible reason ({typography.body-sm}, {colors.ink-muted}) next to it'
    withIcon: 'optional leading lucide/brand icon 20px (e.g. WhatsApp send)'
  button-secondary:
    background: 'transparent'
    foreground: '{colors.ink}'
    border: '1px solid {colors.ink}'
    typography: '{typography.button}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.touch-min}'
  button-destructive:
    background: '{colors.error}'
    foreground: '{colors.on-primary}'
    typography: '{typography.button}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.cta-height}'
  button-link:
    background: 'transparent'
    foreground: '{colors.ink}'
    typography: '{typography.body-sm}'
    textDecoration: 'underline, offset 3px'
    minHeight: '{spacing.touch-min}'
  whatsapp-bar:
    background: '{colors.success}'
    foreground: '{colors.on-primary}'
    typography: '{typography.button}'
    minHeight: '{spacing.cta-height}'
    radius: '{rounded.sm}'
    position: 'fixed bottom, full width minus gutters, above safe area'
    reserve: 'page padding-bottom and scroll-padding-bottom = {spacing.cta-height} + {spacing.4} + safe-area'
  top-bar:
    background: '{colors.background}'
    foreground: '{colors.ink}'
    wordmark: '{typography.wordmark}'
    padding: '20px {spacing.gutter-mobile}'
    menuButton: '{spacing.touch-min} square, lucide Menu 24px, {colors.ink}'
    loginButton: '{components.button-secondary} with {typography.label-strong}, minHeight {spacing.touch-min}'
    overHero: 'band {colors.scrim-ink}/72% behind the whole bar; menu + login become solid chips {colors.background} / {colors.ink}'
    appVariant: 'customer area + admin: wordmark row only, padding 12px {spacing.gutter-mobile}; customer home adds h1 in {typography.display-md} below it'
  menu-sheet:
    background: '{colors.card}'
    side: 'inline-end (same side as the menu button)'
    width: 'min(320px, 85vw)'
    item: '{typography.body-lg}, minHeight {spacing.cta-height}, divider 1px {colors.border}'
    activeIndicator: '2px {colors.accent} at inline-start'
    closeButton: '{spacing.touch-min} square, lucide X'
    scrim: '{colors.scrim-ink}/40%'
  hero:
    minHeight: 560px
    scrim: 'top band {colors.scrim-ink}/72% from 0 to 90px, fading to transparent by 140px; bottom: transparent → {colors.scrim-ink}/72% at the top edge of the text block, → {colors.scrim-ink}/85% at 100%. Never below 72% behind any text'
    foreground: '{colors.on-primary}'
    wordmark: '{typography.display-xl}'
    fallbackWordmark: '{typography.wordmark-display}'
    headline: '{typography.display-sm}'
    cta: '{components.button-hero}'
  button-hero:
    background: '{colors.background}'
    foreground: '{colors.ink}'
    typography: '{typography.button}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.cta-height}'
  card:
    background: '{colors.card}'
    foreground: '{colors.ink}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    padding: '{spacing.4}'
  session-row:
    divider: '1px solid {colors.border}'
    padding: '22px 0'
    dateColumn: 64px
    date: '{typography.numeral-lg}'
    title: '{typography.body-strong}'
    meta: '{typography.label}'
  session-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    photoHeight: 150px
    padding: '{spacing.4}'
    title: '{typography.body-strong}'
  chip:
    background: '{colors.muted}'
    foreground: '{colors.ink}'
    typography: '{typography.label}'
    radius: '{rounded.full}'
    padding: '6px 10px'
  chip-type:
    background: 'transparent'
    foreground: '{colors.ink}'
    border: '1px solid {colors.accent}'
    typography: '{typography.label}'
    radius: '{rounded.sm}'
    padding: '2px 8px'
  status-chip:
    typography: '{typography.label-strong}'
    radius: '{rounded.full}'
    padding: '3px 10px'
    dot: 7px
    available: '{colors.success} on {colors.success-tint}, dot {colors.success-dot}'
    few-left: '{colors.warning} on {colors.warning-tint}, dot {colors.warning-dot}'
    full: '{colors.expired} on {colors.expired-tint}, dot {colors.expired-dot}'
    confirmed: '{colors.success} on {colors.success-tint}, dot {colors.success-dot}'
    pending: '{colors.pending} on {colors.pending-tint}, dot {colors.pending-dot}'
    expiring: '{colors.warning} on {colors.warning-tint}, dot {colors.warning-dot}'
    expired: '{colors.expired} on {colors.expired-tint}, dot {colors.expired-dot}'
    cancelled: '{colors.expired} on {colors.expired-tint}, dot {colors.expired-dot}'
    error: '{colors.error} on {colors.error-tint}, dot {colors.error-dot}'
    saved: 'same as confirmed (booking result "נשמר")'
    not-saved: 'same as expired (booking result "לא נשמר") + warning inline-notice with the reason'
  bottom-tab-bar:
    background: '{colors.card}'
    borderTop: '1px solid {colors.border}'
    minHeight: 64px
    itemMinSize: '{spacing.touch-min}'
    label: '{typography.label}'
    active: '{colors.ink}'
    activeIndicator: '{colors.accent}'
    inactive: '{colors.ink-muted}'
    badge: '{typography.label-strong}, {colors.on-primary} on {colors.primary}'
  side-nav:
    background: '{colors.card}'
    borderInlineEnd: '1px solid {colors.border}'
    width: 240px
    itemActiveBackground: '{colors.muted}'
    itemActiveIndicator: '{colors.accent}'
  bottom-sheet:
    background: '{colors.card}'
    radiusTop: '{rounded.lg}'
    scrim: '{colors.scrim-ink}/40%'
    padding: '{spacing.5}'
    grabber: '36x4px {colors.border}, decorative (aria-hidden)'
    closeButton: '{spacing.touch-min} square, lucide X, inline-end of the sheet header'
  sensitive-confirm-dialog:
    background: '{colors.card}'
    radius: '{rounded.md}'
    title: '{typography.display-sm}'
    impactBox: '{colors.muted}'
    checkbox: '24px box, 1.5px {colors.ink-muted} border, checked {colors.primary}'
    confirm: '{components.button-primary} or {components.button-destructive}'
  input:
    background: '{colors.card}'
    foreground: '{colors.ink}'
    border: '1px solid {colors.ink-muted}'
    typography: '{typography.body}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.cta-height}'
    padding: '12px 14px'
    focusRing: '{components.focus-ring}, drawn outside the border (border stays)'
    errorBorder: '{colors.error}'
  focus-ring:
    outer: '2px solid {colors.primary}'
    offset: '2px band filled {colors.on-primary}'
    selector: ':focus-visible'
    tailwind: 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  notification-item:
    divider: '1px solid {colors.border}'
    padding: '{spacing.4} 0'
    title: '{typography.body-strong}'
    time: '{typography.label}'
    unreadDot: '8px {colors.accent}, decorative (aria-hidden) — unread state also as sr-only text'
  balance-card:
    background: '{colors.muted}'
    foreground: '{colors.ink}'
    radius: '{rounded.md}'
    padding: '12px {spacing.4}'
    dot: '8px {colors.accent}'
    numbers: '{typography.body-strong}'
    expiring: 'validity line adds "עוד {n} ימים" + {components.status-chip} expiring; no button'
  inline-notice:
    radius: '{rounded.md}'
    padding: '12px {spacing.4}'
    typography: '{typography.body-sm}'
    info: '{colors.pending} on {colors.pending-tint}'
    warning: '{colors.warning} on {colors.warning-tint}'
    error: '{colors.error} on {colors.error-tint}'
    success: '{colors.success} on {colors.success-tint}'
  attendee-row:
    divider: '1px solid {colors.border}'
    padding: '12px 0'
    name: '{typography.body-strong}'
    detail: '{typography.body-sm}'
    dietary: '{typography.body-sm}, {colors.ink-muted}'
    allergyFlag: '{components.status-chip}'
  task-row:
    # admin home "לטיפול" — same look as notification-item, single target
    divider: '1px solid {colors.border}'
    padding: '{spacing.4} 0'
    minHeight: '{spacing.touch-min}'
    title: '{typography.body-strong}'
    detail: '{typography.body-sm}'
    meta: '{typography.label}, {colors.ink-muted}'
    status: '{components.status-chip} at inline-end'
    chevron: 'lucide chevron 20px {colors.ink-muted}, decorative, mirrored in RTL'
  summary-card:
    # admin next-session / session-morning figures
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    padding: '12px {spacing.2}'
    columns: 4
    value: '{typography.numeral-lg}'
    label: '{typography.label}, {colors.ink-muted}'
    highlight: 'allergies value in {colors.warning}'
  radio-card:
    background: '{colors.card}'
    foreground: '{colors.ink}'
    border: '1px solid {colors.ink-muted}'
    typography: '{typography.body}'
    radius: '{rounded.sm}'
    minHeight: '{spacing.cta-height}'
    padding: '0 14px'
    indicator: '20px circle, 1.5px {colors.ink-muted} border'
    selected: 'background {colors.muted}, border {colors.ink}, indicator border {colors.primary} + 10px {colors.primary} dot'
  empty-state:
    heading: '{typography.display-md}'
    body: '{typography.body-lg}'
    action: '{components.button-primary}'
    padding: '{spacing.7} {spacing.gutter-mobile}'
  value-change-row:
    # admin: current -> new for a non-sensitive business value (settings, product fields, per-session values)
    sourceLine: '{typography.label}, {colors.ink-muted}'
    changeBox: '{colors.muted}'
    radius: '{rounded.sm}'
    padding: '12px {spacing.4}'
    values: '{typography.body-strong}'
    arrow: 'lucide arrow 16px {colors.ink-muted}, decorative, mirrored in RTL'
    save: '{components.button-secondary}'
    reset: '{components.button-link}'
  content-section-row:
    # admin content editor: one block of a public page
    divider: '1px solid {colors.border}'
    padding: '12px 0'
    minHeight: '{spacing.touch-min}'
    title: '{typography.body-strong}'
    detail: '{typography.body-sm}, {colors.ink-muted}'
    status: '{components.status-chip}'
    reorderButton: '{spacing.touch-min} square, lucide chevron up/down 20px {colors.ink}'
  image-upload-field:
    # admin: every image upload (hero, about, gallery, testimonial, session)
    dropzone: '1px dashed {colors.ink-muted} on {colors.card}'
    radius: '{rounded.md}'
    padding: '{spacing.5}'
    preview: 'photo with {rounded.md} corners'
    cropFrame: '2px solid {colors.primary}; outside the frame {colors.scrim-ink}/40%'
    altInput: '{components.input}'
    consentCheckbox: '24px box, 1.5px {colors.ink-muted} border, checked {colors.primary}'
    missingNotice: '{components.inline-notice} warning'
---

> **הערה:** הקובץ הזה הוא שכבת המותג מעל shadcn/ui. המוקאפים בתיקייה `mockups/` ממחישים בלבד — **בסתירה בין ה-spines (DESIGN.md / EXPERIENCE.md) לבין מוקאפ, ה-spine קובע.**
>
> רפרנס חזותי: [imports/refrence-desing.md](imports/refrence-desing.md) (Ziona Cafe — "כמעט כמו הרפרנס").

## Brand & Style

בראנץ׳ אצל טל הוא שולחן ערוך בבוקר שקט: מקום שבו אמא בחופשת לידה מתיישבת, נושמת, ואוכלת אוכל ביתי טוב בחברת אמהות אחרות. הממשק מתנהג כמו מארחת טובה — נוכח, חם, ולא דוחף את עצמו קדימה.

השפה החזותית "כמעט כמו Ziona Cafe": הרבה אוויר קרמי, טיפוגרפיה דקה שמובילה, ממשק שטוח עם קווי הפרדה דקים במקום מסגרות וצללים. **הצבע מגיע מהאוכל, לא מהממשק** — צילומי שולחן אמיתיים הם הרגע הצבעוני היחיד. זו החלטה מודעת שגוברת על הניסוח "צבעוני" במסמך המקור (§3) וב-site-map (החלטה משותפת עם המשתמשת, memlog).

כיוון נבחר: [mockups/directions-1.html](mockups/directions-1.html) — כיוון 1 "שקט של Ziona" עם ההירו ופס הוואטסאפ של כיוון 2; מיושם בדף הבית ב-[mockups/key-public-home.html](mockups/key-public-home.html).

שם העסק מוצג ככיתוב (wordmark) ב-Heebo דק — אין לוגו ואין סלוגן. ה-UI מבוסס shadcn/ui (base-nova, RTL, אייקוני lucide); הקובץ הזה מגדיר רק את ההבדלים. מצב בהיר בלבד — אין מצב כהה.

## Colors

פלטת "קרם וזית" (וריאציה 2 ב-[mockups/color-themes-1.html](mockups/color-themes-1.html)): קרם רך ודיו חום-זית, כמו שולחן עץ בבוקר. כל יחסי הניגוד מחושבים מול WCAG 2.x.

| טוקן | Hex | שימוש | לא משמש ל- | ניגוד |
|---|---|---|---|---|
| `background` | #FAF6EE | רקע כל העמודים | — | ink עליו 13.28:1 |
| `card` | #FFFDF8 | כרטיסים, גיליונות, דיאלוגים, סרגל תחתון | — | ink עליו 14.08:1 |
| `muted` | #F2ECDF | כרטיס יתרה, תיבת השפעה, hover, פריט ניווט פעיל | טקסט | ink 12.16:1 · ink-muted 5.01:1 |
| `ink` | #2E2A1F | כל טקסט ראשי, מסגרת כפתור משני | — | — |
| `ink-muted` | #6B6450 | מטא, תאריכים משניים, תוויות, **מסגרת שדה קלט** | כותרות | 5.47:1 על רקע · 5.80:1 על כרטיס |
| `border` | #E6DFCF | קווי הפרדה דקורטיביים בלבד | גבול של רכיב אינטראקטיבי (1.23:1) | — |
| `accent` | #8A875A | גרפיקה בלבד: נקודה, קו קצר, מחוון טאב פעיל, מסגרת תווית סוג | **טקסט, או כרקע לטקסט** (ink עליו 3.88:1 — נכשל) | 3.42:1 כגרפיקה על רקע — עובר 3:1 |
| `primary` | #4A4A2A | כפתור ראשי, טבעת פוקוס, צ׳קבוקס מסומן | קישוטים | on-primary עליו 8.46:1 |
| `on-primary` | #FAF6EE | טקסט על primary / success / error / scrim | — | — |

**צבעי מצב** — טקסט בצבע המלא על רקע ה-tint שלו, עם נקודת dot לחיזוק (לעולם לא צבע לבד — תמיד גם מילה):

| מצב | טקסט | tint | dot | ניגוד על tint |
|---|---|---|---|---|
| success (זמין, מאושר, נשמר, הוחזר) | #4E6B34 | #E7EDDC | #8FA874 | 5.05:1 |
| warning (כמעט מלא, עומד לפוג) | #8C5E14 | #F4E8D0 | #C9A060 | 4.64:1 |
| error (שגיאה, פעולה הרסנית) | #B42318 | #F8E4E1 | #B42318 | 5.38:1 |
| pending (ממתין, ממתין למימוש, בקשת החזר, רשימת המתנה) | #4A5A6A | #E6EAEC | #8C9AA8 | 5.86:1 |
| expired (פג, מלא, בוטל, מושבת, לא נשמר) | #676154 | #EDE9E0 | #B0A998 | 5.08:1 |

- **"מלא" עמום, לא אדום:** מפגש מלא הוא מצב רגוע ולא שגיאה, ולכן בגוון expired. אדום (`error`) שמור לשגיאות ולפעולות הרסניות.
- `success` משמש גם כרקע כפתור הוואטסאפ (on-primary עליו 5.6:1).
- `error` כרקע רק בכפתור הרסני בתוך `sensitive-confirm-dialog` (on-primary עליו 6.1:1).
- `scrim-ink` = אותו hex כמו ink, תמיד עם שקיפות (הירו: לפחות 72% מאחורי כל טקסט — ראו `hero`; גיליון ותפריט 40%).
- **טקסט on-primary מעל צילום:** שקיפות ה-scrim לא יורדת מ-0.70 בשום נקודה שמאחורי טקסט, גם מול הפיקסל הבהיר ביותר בצילום. on-primary מעל ink/70% מעל לבן = 5.02:1, מעל ink/72% = 5.35:1, מעל ink/85% = 8.21:1. מתחת ל-0.67 זה נכשל ב-4.5:1.

**פוקוס (`{components.focus-ring}`)** — טבעת דו-גונית ב-`:focus-visible` לכל רכיב אינטראקטיבי: פס פנימי 2px ב-`{colors.on-primary}` (ה-offset) ומסביבו טבעת 2px ב-`{colors.primary}`. הפס הבהיר מבדיל את הטבעת מרכיבים ממולאים והטבעת הכהה מבדילה אותה מהרקע:

| הרכיב/המשטח | מה נראה | ניגוד |
|---|---|---|
| רקע / כרטיס / muted (כפתור משני, קישור, שורה) | טבעת primary מול המשטח | 8.46 / 8.97 / 7.74:1 |
| `button-primary` | פס on-primary מול מילוי primary | 8.46:1 |
| `whatsapp-bar` | פס on-primary מול success | 5.6:1 |
| `button-destructive` | פס on-primary מול error | 6.1:1 |
| `input` | הטבעת מחוץ למסגרת (המסגרת נשארת): פס מול ink-muted 5.47:1, טבעת מול רקע 8.46:1 | |
| מעל ההירו (scrim ≥72%) | פס on-primary מול ה-scrim | ≥5.35:1 |

הטבעת לא מוחלפת ב-`outline: none` בשום רכיב, והיא החריגה היחידה לכלל "אין צללים" (Tailwind מממש את ה-offset כ-box-shadow).

**מיפוי ל-shadcn (`app/globals.css`, `:root`)** — מחליף את ערכי ה-neutral הקיימים; בלוק `.dark` לא בשימוש:

| משתנה shadcn | ערך | הערה |
|---|---|---|
| `--background` / `--foreground` | #FAF6EE / #2E2A1F | |
| `--card`, `--popover` / `-foreground` | #FFFDF8 / #2E2A1F | |
| `--primary` / `--primary-foreground` | #4A4A2A / #FAF6EE | |
| `--secondary` / `--secondary-foreground` | #F2ECDF / #2E2A1F | |
| `--muted` / `--muted-foreground` | #F2ECDF / #6B6450 | |
| `--accent` / `--accent-foreground` | **#F2ECDF** / #2E2A1F | ב-shadcn ‏accent = משטח hover. הזית הדקורטיבי **לא** ממופה לכאן; הוא נחשף כ-`--brand-accent: #8A875A` |
| `--destructive` | #B42318 | |
| `--border` | #E6DFCF | |
| `--input` | #6B6450 | גבול שדה חייב 3:1 |
| `--ring` | #4A4A2A | טבעת הפוקוס, תמיד עם `ring-offset-2` בצבע `--background` (#FAF6EE) — ראו "פוקוס" למעלה |
| `--sidebar*` | card / ink / primary / muted / border | פאנל ניהול בדסקטופ |
| `--radius` | 0.5rem | cards = `rounded-lg` (8px); כפתורים ושדות מקבלים `{rounded.sm}` במפורש |
| צבעי מצב | `--success`, `--success-tint`, `--warning`… | משתנים חדשים, נרשמים ב-`@theme inline` |

## Typography

זוג 1 ב-[mockups/typography-2.html](mockups/typography-2.html). שני קולות בלבד. **Heebo** (העברית שלו צוירה ע״י עודד עזר — הקרוב החינמי ל-Ezer Block Pro Light של Ziona) לכותרות ולכיתוב שם העסק. **Assistant** (הקרוב ל-Almoni) לכל השאר — גוף, תוויות, כפתורים, ו**תמיד** למספרים, תאריכים, שעות, מחירים ויתרות. שניהם מ-Google Fonts עם subset עברי, `display=swap`.

| תפקיד | טוקן | שימוש |
|---|---|---|
| שם העסק בהירו עם צילום | `{typography.display-xl}` | 46px/300, מעל scrim (קו של 200 נבלע בצילום) |
| שם העסק בהירו הטיפוגרפי (בלי צילום) | `{typography.wordmark-display}` | 40px/200 — השימוש היחיד במשקל 200 |
| כותרת עמוד גדולה | `{typography.display-lg}` | 40px/300 |
| כותרת סקשן, "היי {שם}" בבית האזור האישי | `{typography.display-md}` | 26px/300 |
| כותרת דיאלוג, כותרת-משנה בהירו | `{typography.display-sm}` | 22px/300 |
| wordmark בסרגל עליון | `{typography.wordmark}` | 20px/300 |
| פסקאות שיווקיות | `{typography.body-lg}` | 17px |
| גוף, שדות | `{typography.body}` | 16px (מונע zoom ב-iOS) |
| שם מפגש, שם לקוחה | `{typography.body-strong}` | 16px/600 |
| מטא, הודעות inline | `{typography.body-sm}` | 15px |
| תוויות, צ׳יפים, טאבים | `{typography.label}` / `{typography.label-strong}` | 13px |
| תווית-על לסקשן | `{typography.eyebrow}` | 13px, ריווח 0.04em |
| כפתורים | `{typography.button}` | 16px/600 |
| תאריך בעמודת מפגש, מספרים ב-`summary-card` | `{typography.numeral-lg}` | 26px/400 |

כללים:
- **כל הכותרות ב-Heebo 300.** משקל 200 רק ב-`{typography.wordmark-display}` — שם העסק הגדול על רקע קרם חלק. אף פעם לא מעל צילום ולא מתחת ל-28px.
- גבהים של מכלים עם טקסט (הירו, סרגל תחתון) מוגדרים כ-`min-height`, לא `height` — טקסט מוגדל או ריווח טקסט מותאם לא נחתכים.
- **מינימום 13px לכל טקסט.** ברפרנס של Ziona התוויות הן 9–10px ו-12px; זה קטן מדי לנגישות ולקריאה בטלפון ביד אחת, לכן הועלה ל-13px. זו סטייה מכוונת מהרפרנס.
- אין אותיות רישיות/UPPERCASE (עברית); אין הטיה (italic).
- תאריך: `יום שני 12.10 · 10:00` — שעון 24 שעות, DD.MM, מפריד נקודה אמצעית.
- מחיר: `128 ₪` — שקלים בלבד, בלי אגורות בתצוגה; מספרי טלפון ומספרים מעורבים עטופים ב-`<bdi>` כדי לא להתהפך ב-RTL.

## Layout & Spacing

סולם 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. ריווח מבני גדול יוצר את תחושת "השקט".

- **שוליים בטלפון:** `{spacing.gutter-mobile}` (24px) באתר הציבורי ובאזור האישי; 16px מותר בטבלאות אדמין צפופות.
- **בין סקשנים באתר הציבורי:** `{spacing.section-public}` (88px) — הנשימה של כיוון 1.
- **בין סקשנים באזור האישי ובאדמין:** `{spacing.section-app}` (32px) [ASSUMPTION] — אזורי עבודה צפופים יותר מהאתר השיווקי.
- **יעד מגע מינימלי:** `{spacing.touch-min}` (44px) לכל רכיב אינטראקטיבי, גם כשהוויזואל קטן יותר (צ׳יפ סינון, כפתור אייקון). CTA ראשי `{spacing.cta-height}` (48px).
- **רוחב תוכן מרבי:** `{spacing.content-max}` (720px) לטקסט וטפסים בדסקטופ [ASSUMPTION]; ההירו נשאר full-bleed.
- עמודה אחת בטלפון. נקודות שבירה: ברירת המחדל של Tailwind (`md` 768, `lg` 1024) [ASSUMPTION]. אדמין: סרגל תחתון → `side-nav` מ-`lg`.
- כל ריווח אופקי בתכונות לוגיות (`ps/pe`, `ms/me`, `inset-inline`) — לא left/right.
- אזור בטוח: סרגל תחתון, פס הוואטסאפ וגיליון תחתון מוסיפים `env(safe-area-inset-bottom)`.
- **שמירת מקום לרכיבים צמודים לתחתית:** כל עמוד שיש בו `whatsapp-bar` או `bottom-tab-bar` מקבל `padding-bottom` ו-`scroll-padding-bottom` בגובה הרכיב + אזור בטוח, כך שתוכן, פוטר ורכיב ממוקד לעולם לא מוסתרים מתחתיו.

## Elevation & Depth

שטוח. **אין צללים** — לא על כרטיסים, לא על כפתורים, לא על פס הוואטסאפ. ההפרדה נוצרת מטון (background ↔ card ↔ muted), מקו `border` דק ומרווח. שכבות צפות (גיליון תחתון, דיאלוג) מובחנות ע״י scrim של `scrim-ink` בשקיפות 40%, לא ע״י צל. רכיבי shadcn שמגיעים עם `shadow-*` מאופסים ל-`shadow-none`.

## Shapes

- `{rounded.sm}` 4px — כפתורים, שדות, `radio-card`, תווית סוג, צילום בתוך מסגרת.
- `{rounded.md}` 8px — כרטיסים, כרטיס יתרה, דיאלוג, הודעות inline, צילומי גלריה.
- `{rounded.lg}` 12px — פינות עליונות של גיליון תחתון בלבד [ASSUMPTION].
- `{rounded.full}` — צ׳יפים, נקודות סטטוס, אווטאר.

גאומטריה ממושמעת: אין קימורים מוגזמים על מכלים גדולים; צורה עגולה רק לרכיבים קטנים ואורגניים.

## Components

המסכים המרכזיים ממומשים במוקאפים: [key-public-home](mockups/key-public-home.html), [key-public-session](mockups/key-public-session.html), [key-customer-home](mockups/key-customer-home.html), [key-booking-sheet](mockups/key-booking-sheet.html), [key-admin-home](mockups/key-admin-home.html), [key-admin-payment](mockups/key-admin-payment.html).

רכיבי shadcn בשימוש כמות שהם (אחרי מיפוי הצבעים): `Separator`, `Skeleton`, `Label`, `Textarea`, `Select`, `Popover`, `Calendar`, `Tabs`, `Sheet` (בסיס ל-`menu-sheet`), `Checkbox`, `Table` (אדמין דסקטופ), `Sonner`/Toast, `Avatar`. אייקונים: lucide, 20–24px, קו 1.5, צבע ink/ink-muted; אייקונים כיווניים (חצים, chevron) משתקפים ב-RTL.

| רכיב | בסיס shadcn | מפרט חזותי |
|---|---|---|
| `button-primary` | `Button` default | מילוי `{colors.primary}`, טקסט `{colors.on-primary}`, `{typography.button}`, פינה 4px, גובה 48px. אפשר אייקון מוביל 20px (למשל "שליחה בוואטסאפ" באדמין). **בטעינה (busy):** ספינר 18px on-primary לפני הטקסט, אותו רוחב, **בלי עמעום**. **לא זמין:** שקיפות 50% **וגם** סיבה גלויה לידו (`body-sm` ink-muted) |
| `button-secondary` | `Button` outline | שקוף, מסגרת 1px `{colors.ink}`, גובה ≥44px. hover: `{colors.muted}` |
| `button-destructive` | `Button` destructive | מילוי `{colors.error}`, טקסט on-primary. רק בתוך `sensitive-confirm-dialog` |
| `button-link` | `Button` link | טקסט ink עם קו תחתון (offset 3px), אזור מגע 44px |
| `button-hero` | `Button` | מילוי `{colors.background}` וטקסט ink — הכפתור היחיד שמונח על צילום |
| `whatsapp-bar` | מותאם (מכיוון 2) | פס כפתור ברוחב מלא, צמוד לתחתית המסך בכל עמוד ציבורי: `{colors.success}`, אייקון וואטסאפ + הטקסט "להצטרפות צרי קשר עם טל" ב-`{colors.on-primary}`, גובה `{spacing.cta-height}`, פינות `{rounded.sm}`, שוליים `{spacing.gutter-mobile}` מהצדדים, מעל אזור בטוח. בלי צל. העמוד שומר מקום מתחתיו (ראו Layout). מתי מוצג ומוסתר — EXPERIENCE › `whatsapp-bar` |
| `top-bar` | מותאם | **אתר ציבורי:** רקע background. wordmark ב-inline-start. ב-inline-end, מהקצה פנימה: כפתור תפריט (אייקון lucide `Menu` 24px, 44×44) ולידו "כניסה לאזור האישי" (`button-secondary` עם `label-strong`, גובה ≥44px). **מעל ההירו:** פס scrim ink/72% מאחורי כל גובה הסרגל (wordmark on-primary ≥5.35:1); כפתור התפריט וכפתור הכניסה הופכים לצ׳יפים אטומים — רקע `{colors.background}`, טקסט/אייקון ink (13.28:1) — כך שהם קריאים על כל צילום. **אזור אישי ואדמין (`appVariant`):** שורת wordmark בלבד, ריפוד 12px; בבית האזור האישי מתחתיה `h1` "היי {שם}" ב-`display-md` |
| `menu-sheet` | `Sheet` | התפריט הציבורי. נפתח מצד inline-end (צד הכפתור), רוחב min(320px, 85vw), רקע card, scrim 40%. בראש: wordmark + כפתור סגירה X 44×44. רשימת עמודי ה-site-map בסדר קבוע, כל פריט `body-lg` בגובה ≥48px עם קו הפרדה; העמוד הנוכחי מסומן בפס 2px accent ב-inline-start ובמשקל 600. בתחתית: "כניסה לאזור האישי" כ-`button-primary` ברוחב מלא, ומתחתיו מדיניות פרטיות והצהרת נגישות כ-`button-link` |
| `hero` | מותאם | צילום שולחן מלמעלה, full-bleed, `min-height` 560px בטלפון (גדל עם התוכן). scrim: פס עליון ink/72% מאחורי הסרגל; באמצע שקוף; מתחילת בלוק הטקסט ועד התחתית ≥ink/72% ובקצה 85%. **כלל:** בשום נקודה מאחורי טקסט השקיפות לא יורדת מ-0.72 (on-primary ≥5.35:1 גם מעל פיקסל לבן). בתחתית: wordmark `{typography.display-xl}` (משקל 300), כותרת `{typography.display-sm}`, שורת תיאור `{typography.body}`, `button-hero`. בלי צילום מאושר — וזו ברירת המחדל עד שצילום נבדק מול הכלל — fallback טיפוגרפי של כיוון 1 (רקע קרם, שם העסק ב-`{typography.wordmark-display}` ממורכז, `button-primary`) |
| `card` | `Card` | `{colors.card}`, מסגרת `{colors.border}`, פינה 8px, ריפוד 16px, בלי צל |
| `session-row` | מותאם | רשימה עם קווי הפרדה דקים (כיוון 1). עמודת תאריך 64px: `{typography.numeral-lg}` + יום ב-`label`. תוכן: שם `body-strong`, מטא (שעה · סוג) `label` ב-ink-muted, שורה של `status-chip` + רמז חזותי "לפרטים" עם chevron (טקסט `label` עם קו תחתון, לא כפתור נפרד — השורה כולה היא יעד אחד). מפגש מלא: שם ב-ink-muted. וריאנט **בחירה** (כרטיסייה): צ׳קבוקס 24px בצד inline-start, בלי רמז "לפרטים"; שורה נבחרת ברקע `{colors.muted}` **וגם** צ׳קבוקס מסומן (הרקע לבדו 1.09:1 — לא מספיק); שורה לא זכאית: טקסט ink-muted + סיבה ב-`label` |
| `session-card` | `Card` | צילום 150px למעלה (פינות עליונות 8px), שורת תאריך + `status-chip`, שם `body-strong`, `chip-type` ("רגיל"/"זוגי") + "מגיעות עם התינוקות", כפתורים ברוחב מלא. מלא: צילום באפור חלקי |
| `chip` | `Badge` | בסיס: `{colors.muted}`, 13px, pill. לא אינטראקטיבי; צ׳יפ סינון אינטראקטיבי מקבל אזור מגע 44px |
| `chip-type` | `Badge` outline | מסגרת `{colors.accent}` (גרפיקה, 3.42:1), טקסט ink, פינה 4px |
| `status-chip` | `Badge` | pill, tint + טקסט + dot 7px, `label-strong`. **זמין** success · **נותרו מעט** warning · **מלא** expired (עמום, לא אדום) · **מאושר** success · **ממתין** / **ממתין למימוש** (קישור הצטרפות) pending · **עומדת לפוג** (`expiring`) warning · **פג תוקף** expired · **בוטל** expired · **שגיאה** error. תוצאה לכל תאריך בהרשמה מרובה: **נשמר** = success, **לא נשמר** = expired, והסיבה ב-`inline-notice` warning מתחת. תמיד מילה, לעולם לא נקודה לבד; הנקודה `aria-hidden` |
| `bottom-tab-bar` | מותאם | 5 פריטים, רקע card, קו עליון border, `min-height` 64px + safe-area. פריט: אייקון 24px מעל תווית `label`; תווית ארוכה ("ההרשמות שלי") רשאית לשבור לשתי שורות ב-320px. פעיל: ink + 600 + פס 2px `{colors.accent}` ברוחב 24px מעל האייקון; לא פעיל: ink-muted. מונה התראות: מספר ב-`label-strong`, `{colors.on-primary}` על `{colors.primary}` (8.46:1) |
| `side-nav` | `Sidebar` | אדמין ≥`lg`: רוחב 240px, רקע card, פריט פעיל ברקע muted עם פס accent בצד inline-start |
| `bottom-sheet` | `Drawer` (vaul) / `Sheet side=bottom` | רקע card, פינות עליונות 12px, grabber 36×4 (קישוטי), ריפוד 24px, scrim 40%. שורת כותרת: כותרת הגיליון ב-inline-start, **כפתור סגירה גלוי** (lucide `X`, 44×44) ב-inline-end. כפתור ראשי ברוחב מלא בתחתית, באזור האגודל. גובה מרבי 90vh עם גלילה פנימית |
| `sensitive-confirm-dialog` | `AlertDialog` | card, פינה 8px, כותרת `display-sm` בצורת שאלה ("האם לאשר החזר?"), תיבת השפעה ברקע muted (מה ישתנה, למי), צ׳קבוקס 24px עם תווית מלאה, כפתור אישור (primary או destructive לפי הפעולה) + `button-secondary` "ביטול". בטלפון — רוחב מלא פחות 16px |
| `input` | `Input` | רקע card, מסגרת 1px `{colors.ink-muted}` (5.8:1), פינה 4px, גובה 48px, 16px. תווית מעל ב-`body-sm` 600; שדה חובה מסומן בתווית במילה "(חובה)" ולא בכוכבית בלבד. פוקוס: `{components.focus-ring}` מחוץ למסגרת (המסגרת נשארת). שגיאה: מסגרת error + הודעה ב-`body-sm` error עם אייקון (קישוטי) מתחת. נעול (מוצר וסכום בטופס הצטרפות): רקע muted, אייקון מנעול, טקסט ink (קריא — לא אפור). שדה סיסמה: כפתור "הצגת סיסמה" (אייקון עין, 44×44) ב-inline-end של השדה |
| `focus-ring` | `ring` של shadcn | ראו Colors › פוקוס: פס 2px on-primary + טבעת 2px primary, ב-`:focus-visible` בלבד, לכל רכיב אינטראקטיבי בשלושת המשטחים |
| `notification-item` | מותאם | שורה ברשימה עם קו הפרדה. לא נקראה: נקודה 8px accent (קישוטית) + כותרת `body-strong` + המילה "לא נקראה" לקורא מסך; נקראה: כותרת `body`. זמן יחסי ב-`label` ink-muted. השורה כולה היא קישור אחד (≥44px) |
| `balance-card` | מותאם | רקע `{colors.muted}`, פינה 8px, נקודה accent. שורה: סוג · **מספרים ב-`body-strong`** · "בתוקף עד DD.MM" ב-ink-muted. שורה משנית: משוריינות / תפוגה. עומדת לפוג: שורת התוקף מוסיפה "עוד {n} ימים" + `status-chip` expiring, בלי כפתור; פגה: expired; זיכוי: שתי החלופות כשורות קטנות. נקודת ה-accent קישוטית |
| `inline-notice` | `Alert` | tint + טקסט בצבע המצב, אייקון lucide (קישוטי), פינה 8px. מבנה קבוע: סיבה (שורה אחת) + פעולה (`button-link` או `button-secondary`) |
| `attendee-row` | מותאם | אדמין: שם `body-strong` (+ "×2" לזוגי), שורת תינוק/ת וגיל `body-sm`. שדה "אלרגיות והעדפות תזונתיות" הוא טקסט אחד שהלקוחה כתבה — מוצג כמו שהוא ב-`body-sm`, בתוך רקע tint של warning כדי שיבלוט לטל; שדה ריק מוצג כ-`status-chip` pending "טרם נמסר". המערכת לא מפרקת את הטקסט לצ׳יפים |
| `task-row` | מותאם | שורת "לטיפול" בבית האדמין, באותו מראה של `notification-item`: קו הפרדה, ריפוד 16px, כותרת `body-strong` ("סוג · שם הלקוחה"), פירוט `body-sm`, זמן/מטא ב-`label` ink-muted, `status-chip` ב-inline-end ו-chevron קישוטי. השורה כולה היא יעד אחד. ראו [key-admin-home](mockups/key-admin-home.html) |
| `summary-card` | `Card` | מספרי המפגש הבא ומבט בוקר המפגש: card עם מסגרת border, פינה 8px, ארבע עמודות (מקומות · הרשמות/נרשמות · תינוקות · אלרגיות). מספר ב-`numeral-lg`, תווית ב-`label` ink-muted; מספר האלרגיות ב-`{colors.warning}` (5.54:1 על card) |
| `radio-card` | `RadioGroup` | בחירה אחת מתוך מעט אפשרויות כשורות גדולות (לקוחה חדשה / קיימת, אמצעי תשלום, זיכוי / החזר): רקע card, מסגרת 1px ink-muted, פינה 4px, גובה ≥48px, עיגול 20px. נבחרה: רקע muted **וגם** מסגרת ink **וגם** עיגול מלא ב-primary (הרקע לבדו לא מספיק). אמצעי תשלום — רשת של שתיים בשורה. ראו [key-admin-payment](mockups/key-admin-payment.html) |
| `empty-state` | מותאם | כותרת `display-md`, משפט `body-lg`, פעולה אחת `button-primary`. בלי איור [ASSUMPTION]; מותר צילום אוכל שטל העלתה |
| `value-change-row` | מותאם | אדמין: מתחת לשדה שורת מקור ב-`label` ink-muted ("מההגדרות: 20:00 ביום הקודם"). אחרי שינוי: תיבה ברקע `{colors.muted}`, פינה 4px, ריפוד 12×16 — "ישן ← חדש" ב-`body-strong` (החץ קישוטי, משתקף ב-RTL), הערת היקף ב-`body-sm`, `button-secondary` "לשמור את השינוי" ו-`button-link` "חזרה לברירת המחדל". בלי צ׳קבוקס — הוא רק ב-`sensitive-confirm-dialog` |
| `content-section-row` | מותאם | עורך התוכן: שורה ברשימה עם קו הפרדה (כמו `task-row`), שם הבלוק `body-strong`, תקציר `body-sm` ink-muted, `status-chip` (טיוטה = pending · פורסם = success · מוסתר = expired · "שינויים שלא פורסמו" = warning) ב-inline-end. כפתורי סידור "למעלה"/"למטה" 44×44 (chevron 20px ink) ו"הסתרה" מחוץ לאזור הלחיץ של השורה |
| `image-upload-field` | מותאם | אזור בחירה: מסגרת מקווקוות 1px ink-muted על card, פינה 8px, ריפוד 24px. אחרי בחירה: תצוגה בפינות 8px + מסגרת חיתוך לטלפון 2px primary, ומחוצה לה scrim-ink/40%. מתחת: שדה "טקסט חלופי (חובה)" (`input`), צ׳קבוקס הסכמה 24px (כמו ב-`sensitive-confirm-dialog`), וכשחסר אחד מהם — `inline-notice` warning עם הסיבה. לצילום הירו אין שדה טקסט חלופי (קישוטי) |

## Do's and Don'ts

| Do | Don't |
|---|---|
| לתת לצילום האוכל להיות הצבע | צבעים רוויים, גרדיאנטים, רקעים צבעוניים בממשק |
| קווי הפרדה דקים, טון ומרווח | צללים, כרטיסים "צפים", מסגרות כבדות |
| כותרות ב-Heebo 300; 200 רק לשם העסק הגדול על קרם; Assistant לכל מספר ותאריך | Heebo למספרים; משקל 200 בכותרת או מעל צילום |
| טבעת פוקוס דו-גונית עם offset בכל רכיב | `outline: none`, או טבעת שמחליפה את מסגרת השדה |
| scrim ≥72% מאחורי כל טקסט על צילום | "לבדוק מול הצילום" במקום כלל מספרי |
| טקסט 13px ומעלה | תוויות 9–12px כמו ברפרנס |
| accent כגרפיקה בלבד (נקודה, קו, מחוון) | טקסט ב-accent או טקסט על accent |
| מסגרת שדה ב-ink-muted | מסגרת שדה ב-border (1.23:1) |
| סטטוס = מילה + tint + נקודה; "מלא" עמום | סטטוס בצבע בלבד; "מלא" באדום |
| יעד מגע 44px גם לרכיב קטן חזותית | כפתורים קטנים "כמו ברפרנס" בלי אזור מגע |
| תכונות לוגיות (start/end) ושיקוף אייקונים כיווניים | left/right קשיחים |
| להשאיר סקשן מוסתר כשאין תוכן מאושר | placeholder, "Lorem", המלצה מומצאת |
