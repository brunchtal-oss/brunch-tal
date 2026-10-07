---
name: בראנץ׳ אצל טל
description: Warm, quiet, type-led brunch hosting site + customer area + admin panel for new mothers. shadcn/ui (base-nova, RTL) on Next.js; this file is the brand-layer delta. Light mode only.
status: final
created: 2026-09-23
updated: 2026-10-07
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
  saffron: '#E9B949'         # design round 2026-10-07: counters only (bell, "לטיפול"), ink number on it (7.6:1); never text, area or button
  # DROPPED (user's decision 2026-10-04, memlog): no concept colours anywhere; kept for history only, never used.
  # Concept "paper" colours (CAP-41) — only in concept-header and session-card band. field + its own dark ink.
  concept-mothers-field: '#CDD3BC'
  concept-mothers-ink: '#3C4631'      # 6.46:1 on field
  concept-couples-field: '#D3CCE0'
  concept-couples-ink: '#3B3350'      # 7.59:1
  concept-grandma-field: '#F0E2B6'
  concept-grandma-ink: '#5A4513'      # 7.08:1
  concept-grandpa-field: '#D2C0A6'
  concept-grandpa-ink: '#3E2E20'      # 7.32:1
  concept-greek-field: '#BDD0DC'
  concept-greek-ink: '#1C3A4F'        # 7.48:1
  # Generic concept: Tal picks one of these six papers
  concept-olive-field: '#D0CEB2'
  concept-olive-ink: '#3D3D22'        # 6.96:1
  concept-plum-field: '#CDBBCF'
  concept-plum-ink: '#46304A'         # 6.51:1
  concept-jade-field: '#B9CFCA'
  concept-jade-ink: '#233F3B'         # 6.96:1
  concept-mustard-field: '#E2CF9E'
  concept-mustard-ink: '#4E3A12'      # 7.05:1
  concept-slate-field: '#C3CAD3'
  concept-slate-ink: '#2E3742'        # 7.30:1
  concept-clay-field: '#DDB9AC'
  concept-clay-ink: '#5A2C1F'         # 6.40:1
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
  numeral-xl:
    # design round 2026-10-07: the one key number of a screen (the card's free entries), at most once per screen; its label beside it in body (16px)
    fontFamily: 'Assistant'
    fontSize: 40px
    fontWeight: '300'
    lineHeight: '1'
  # DROPPED (user's decision 2026-10-04, memlog): the concept name uses Heebo 300 like every heading (26px on the card, display-lg in the header); kept for history only.
  # Concept name (the session title) — one face per concept, only for the concept name, >=22px.
  # Sizes: header 40-46px, card band 34px, card without photo 52px.
  concept-name-mothers:
    fontFamily: 'Heebo'
    fontWeight: '300'
    fontSize: 40px
    lineHeight: '1'
  concept-name-couples:
    fontFamily: 'Bona Nova'
    fontWeight: '400'
    fontSize: 46px
    lineHeight: '1'
  concept-name-grandma:
    fontFamily: 'David Libre'
    fontWeight: '400'
    fontSize: 40px
    lineHeight: '1'
  concept-name-grandpa:
    fontFamily: 'Frank Ruhl Libre'
    fontWeight: '700'
    fontSize: 40px
    lineHeight: '1'
    letterSpacing: -0.01em
  concept-name-greek:
    fontFamily: 'Suez One'
    fontWeight: '400'
    fontSize: 42px
    lineHeight: '1'
  concept-name-generic:
    fontFamily: 'Heebo'
    fontWeight: '300'
    fontSize: 40px
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
  section-public: 48px
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
    # USER 2026-10-04 (supersedes background, wordmark position and appVariant above; built in 5.2 public, 5.7 customer + admin):
    # the bar has its own colour, distinct from the page, and is sticky (always visible while scrolling); the wordmark is centred in every surface;
    # customer area + admin: bell-button + sign-out at inline-end (left in RTL). Colour picked from the palette at build, contrast >= 4.5:1.
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
    # design round 2026-10-07 (versions/combined.html): the one row for every list of sessions (public sessions page and the customer's "לו״ז בראנצ׳ים"); replaces the 64px date column
    status: 'customer only: {components.status-chip} under the date'
    divider: '1px solid {colors.border}, top on the first row and bottom on the last'
    padding: '{spacing.3} 0'
    photo: '84px square, {rounded.sm}, object-fit cover; no photo: {colors.muted} square'
    gap: '{spacing.4} between photo and text'
    eyebrow: '"בראנץ׳" {typography.label} {colors.ink-muted}'
    title: 'concept name {typography.display-sm} {colors.ink}'
    date: 'weekday and date only, {typography.body-sm} {colors.ink}; never the time'
  session-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    # One uniform card for every concept (user's decision 2026-10-04, memlog)
    photo: 'top, aspect-ratio 2:1 (a low, rectangular card), full width; the session photo, else the concept photo (5.4)'
    noPhoto: '{colors.muted} surface with a decorative croissant mark (56px, stroke 1) in {colors.accent}; never an empty frame'
    body: 'padding 12px 16px 14px; "בראנץ׳" {typography.body-sm} {colors.ink-muted}, concept name {typography.display-sm} {colors.ink}, then weekday and date (no time, 2026-10-07) {typography.body-sm} + {components.status-chip} (customer only)'
    nextSession: 'customer home "המפגש הקרוב שלי" (2026-10-07): no card frame; photo full width 5:2 {rounded.md}, then "בראנץ׳", concept name, and one row of weekday-date with the "נרשמת" chip at inline-end'
  concept-header:
    # session page top, same style as session-card (user's decision 2026-10-04, memlog)
    photo: 'full-bleed inside the gutter, aspect-ratio 4:3, same noPhoto surface as session-card'
    name: '"בראנץ׳" {typography.body-sm} {colors.ink-muted} above the concept name in {typography.display-lg}, {colors.ink}'
    when: '{typography.body}, margin-top 12px'
  bell-button:
    # admin top bar (CAP-35)
    size: '{spacing.touch-min} square'
    icon: 'lucide Bell 24px {colors.ink}'
    count: '{typography.label-strong}, {colors.ink} on {colors.saffron} (2026-10-07; was on-primary on primary), pill, min 18px, top inline-end corner; same on the customer bell'
  segmented-switch:
    # two views of one object: פרטים | עבודה, לקוחות | כרטיסיות פתוחות
    border: '1px solid {colors.ink-muted}'
    radius: '{rounded.sm}'
    item: '{typography.body-sm} 600, minHeight {spacing.touch-min}'
    selected: '{colors.on-primary} on {colors.primary}'
  check-item:
    # work-sheet task, shopping item, note done-state
    box: '24px, 1.5px {colors.ink-muted} border, checked {colors.primary} with check mark'
    text: '{typography.body}'
    done: 'text {colors.ink-muted} + line-through (screen and print)'
    minHeight: '{spacing.touch-min}'
  dish-card:
    # work sheet on phone: one dish, tasks grouped by prep day
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    padding: '12px {spacing.4}'
    title: '{typography.body-strong}'
    dayHeading: '{typography.label-strong}, {colors.ink-muted}, divider 1px {colors.border} above'
  worksheet-print:
    # @media print and desktop table
    page: 'A4 portrait, margins 12mm, black on white'
    header: 'concept name Heebo 300 28px + date line; 2px black rule under it'
    table: 'dish column + one column per prep day with content; 1px {colors.border} cells, header row {colors.muted}'
    sections: 'three columns: registrants and photo consent, dietary notes, shopping list'
  open-card-row:
    # CAP-42
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    padding: '12px {spacing.4}'
    title: '{typography.body-strong} customer name + {components.status-chip} expiring when relevant'
    meta: '{typography.label}, {colors.ink-muted}: purchase date, valid until (incl. extension)'
    entry: 'one line per entry: date or "כניסה {n}" + status-chip (נוצלה expired · משוריינת success · פנויה pending)'
  reminder-strip:
    # admin home: current marketing reminder until dismissed
    background: '{colors.muted}'
    radius: '{rounded.md}'
    padding: '12px {spacing.4}'
    text: '{typography.body-sm}'
    dismiss: '{components.button-link} "סגירה"'
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
    available: '"יש מקום" — {colors.success} on {colors.success-tint}, dot {colors.success-dot} (logged-in customer only)'
    few-left: '"מקומות אחרונים" (<= setting, default 4, no number) — {colors.warning} on {colors.warning-tint}, dot {colors.warning-dot} (customer only)'
    full: '"מלא" — {colors.expired} on {colors.expired-tint}, dot {colors.expired-dot} (customer only)'
    confirmed: '{colors.success} on {colors.success-tint}, dot {colors.success-dot}'
    pending: '{colors.pending} on {colors.pending-tint}, dot {colors.pending-dot}'
    expiring: '{colors.warning} on {colors.warning-tint}, dot {colors.warning-dot}'
    expired: '{colors.expired} on {colors.expired-tint}, dot {colors.expired-dot}'
    cancelled: '{colors.expired} on {colors.expired-tint}, dot {colors.expired-dot}'
    error: '{colors.error} on {colors.error-tint}, dot {colors.error-dot}'
    saved: 'same as confirmed (booking result "נשמר")'
    not-saved: 'same as expired (booking result "לא נשמר") + warning inline-notice with the reason'
    consent-yes: '"אווירה ✓" / "אישיות ✓" (work sheet, admin only) — same as confirmed; aria-label in full words'
    consent-no: '"אווירה ✗" / "אישיות ✗" (work sheet, admin only) — same as expiring (warning); aria-label in full words'
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
  home-card:
    # design round 2026-10-07: "הכרטיסייה שלי" on the customer home (look of versions/v1.html); replaces balance-card there only
    surface: 'none: on the page background, no frame, no fill'
    product: 'product name {typography.body-sm} {colors.ink-muted}'
    count: '{typography.numeral-xl} free entries + label "כניסות זמינות" {typography.body} beside it (the one approved new label)'
    bar: '4 equal parts per entry, height 6px, gap 4px, rounded: free {colors.primary}, booked {colors.accent}, used {colors.border}'
    legend: '"נרשמת X/N" and "ניצלת X/N" {typography.body-sm}, each with a 10x6 key in its bar colour'
    validity: '"בתוקף עד DD.MM" {typography.body-sm} {colors.ink-muted}; expiring adds "עוד {n} ימים" + status-chip expiring'
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
  session-tile:
    # design round 2026-10-07: admin home, the two nearest sessions, one under the other, then "לכל המפגשים"
    surface: '{components.card}'
    next: '"המפגש הבא" {typography.label} {colors.ink-muted}, session name {typography.body-strong} 18px, weekday-date {typography.body-sm}, occupancy bar 4px, then places "X/N" · babies · allergies ({typography.numeral-lg} over {typography.label}); no "נרשמות" (it repeats the places); "לפרטי המפגש" {components.button-link}'
    second: 'session name, weekday-date with "X/N" ({typography.numeral-lg}) at inline-end, occupancy bar, "לפרטי המפגש"'
  admin-home-actions:
    # design round 2026-10-07: under the h1 "בית", two equal columns, gap {spacing.2}
    primary: '"הוספת תשלום" {components.button-primary}'
    secondary: '"מפגש חדש" {components.button-secondary}'
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

**קונספטים (CAP-41), החלטת המשתמשת 2026-10-04 (memlog):** אין לקונספט צבע או גופן משלו. כל כרטיסי המפגשים אחידים, והצילום (של המפגש, ואם אין, של הקונספט) הוא מה שמבדיל ביניהם. שם הקונספט הוא הכותרת של המפגש, ב-Heebo כמו כל כותרת. אין דוגמאות, אין איורים ואין אייקונים לקונספט. המוקאפ [mockups/concept-themes-3.html](mockups/concept-themes-3.html) והחריג הקודם ("כרטיס תפריט" צבעוני לכל קונספט) הוחלפו.

**כללי אחידות (סבב העיצוב, החלטת המשתמשת 2026-10-07, memlog):** ניקיון, סדר, פרופורציות קבועות, ריווח אחיד ובלי כפילויות. בכל מסך הדבר החשוב ראשון: מה הבא, מה יש לי, רשימות, ובסוף "לכל ה...". **באתר הציבורי ובאזור האישי** התוכן יושב על הרקע בשורות ובקווים דקים, בלי מסגרת סביב סקשן. **בבית האדמין** כל חלק הוא קובייה (`card`), קובייה מתחת לקובייה, בלי קובייה בתוך קובייה. כל נתון מופיע פעם אחת במסך, וקישור לאותו יעד פעם אחת. הסבב משנה עיצוב בלבד, לא תוכן ולא נוסחים (חוץ משני חריגים מאושרים: "כניסות זמינות" בכרטיסייה, והסרת השעה, ראו Typography). דף הבית הציבורי והפוטר לא משתנים בסבב הזה. ההדגמה: `versions/combined.html` (מקומית, לא ב-git).

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
| `saffron` | #E9B949 | **מונים בלבד** (2026-10-07): המונה על הפעמון בשני הסרגלים והמונה של "לטיפול", מספר ב-ink | טקסט, רקע של אזור, כפתור, סימון זמינות | ink עליו 7.6:1 |
| `on-primary` | #FAF6EE | טקסט על primary / success / error / scrim | — | — |

**צבעי מצב** — טקסט בצבע המלא על רקע ה-tint שלו, עם נקודת dot לחיזוק (לעולם לא צבע לבד — תמיד גם מילה):

| מצב | טקסט | tint | dot | ניגוד על tint |
|---|---|---|---|---|
| success (זמין, מאושר, נשמר, הוחזר) | #4E6B34 | #E7EDDC | #8FA874 | 5.05:1 |
| warning (כמעט מלא, עומד לפוג) | #8C5E14 | #F4E8D0 | #C9A060 | 4.64:1 |
| error (שגיאה, פעולה הרסנית) | #B42318 | #F8E4E1 | #B42318 | 5.38:1 |
| pending (ממתין, ממתין למימוש, בקשת החזר, רשימת המתנה) | #4A5A6A | #E6EAEC | #8C9AA8 | 5.86:1 |
| expired (פג, מלא, בוטל, מושבת, לא נשמר) | #676154 | #EDE9E0 | #B0A998 | 5.08:1 |

**צבעי קונספט** — שדה ("נייר") ודיו כהה מאותו גוון. הדיו משמש לכל טקסט על השדה (שם הקונספט, "בראנץ׳", מועד). אין טקסט קרם על שדה קונספט.

| קונספט | שדה | דיו | ניגוד | גופן השם |
|---|---|---|---|---|
| אמהות בחל״ד — מרווה רכה | #CDD3BC | #3C4631 | 6.46:1 | Heebo 300 |
| זוגות — לילך מאובק | #D3CCE0 | #3B3350 | 7.59:1 | Bona Nova |
| עם סבתוש — צהוב בננה עתיק | #F0E2B6 | #5A4513 | 7.08:1 | David Libre |
| עם סבוש — קפה עם חלב ועץ בהיר | #D2C0A6 | #3E2E20 | 7.32:1 | Frank Ruhl Libre 700 |
| יווני — כחול אגאי מעומעם | #BDD0DC | #1C3A4F | 7.48:1 | Suez One |
| כללי (קונספט חדש) | אחד מ-6: זית #D0CEB2 · שזיף #CDBBCF · ירקן #B9CFCA · חרדל #E2CF9E · צפחה #C3CAD3 · חימר #DDB9AC | הדיו המתאים בטוקנים | 6.40–7.30:1 | Heebo 300 |

- טל בוחרת לכל קונספט ערכה מהטבלה; אין בוחר צבעים חופשי (CAP-41). ערכה חדשה נוספת כאן, בעיצוב, לא באדמין.
- השדה מול רקע הדף הוא 1.2–2.1:1 — קישוטי; גבול הכרטיס (`border`) והצילום מגדירים את הצורה.
- "חרדל" בכללי קרוב לסבתוש; אם טל בוחרת אותו לקונספט חדש, להציע גוון אחר.

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
| מספרים ב-`summary-card` וב-`session-tile` | `{typography.numeral-lg}` | 26px/400 |
| המספר המרכזי של המסך (כניסות זמינות בכרטיסייה) | `{typography.numeral-xl}` | 40px/300, פעם אחת במסך לכל היותר |

**תפקידים קבועים (סבב העיצוב 2026-10-07):**

| תפקיד | טוקן |
|---|---|
| כותרת מסך ("היי {שם}", "בית", "בראנצ׳ים") | `display-md` |
| כותרת סקשן ("המפגש הקרוב שלי", "הכרטיסייה שלי") | `display-sm` |
| שם הקונספט בשורה ובכרטיס מפגש | `display-sm` |
| כותרת קובייה באדמין ("לטיפול") | `body-strong` |
| טקסט, שם בשורה | `body` / `body-strong` |
| מטא: יום ותאריך, פירוט, תוקף | `body-sm` (התאריך ב-ink, השאר ink-muted) |
| תוויות, צ׳יפים, "בראנץ׳" מעל שם | `label` |

- **Heebo** רק לשם העסק, לכותרות (מסך, סקשן) ולשם הקונספט, תמיד 300 (200 רק ב-`wordmark-display`). **Assistant** לכל השאר, בשלושה משקלים בלבד: 400 לטקסט, 600 להדגשה ולכפתורים, 300 רק ל-`numeral-xl`.
- מקסימום שלוש רמות טקסט בסקשן (כותרת, טקסט, מטא). אין גודל או משקל מחוץ לטבלאות האלה.

כללים:
- **כל הכותרות ב-Heebo 300.** משקל 200 רק ב-`{typography.wordmark-display}` — שם העסק הגדול על רקע קרם חלק. אף פעם לא מעל צילום ולא מתחת ל-28px.
- גבהים של מכלים עם טקסט (הירו, סרגל תחתון) מוגדרים כ-`min-height`, לא `height` — טקסט מוגדל או ריווח טקסט מותאם לא נחתכים.
- **מינימום 13px לכל טקסט.** ברפרנס של Ziona התוויות הן 9–10px ו-12px; זה קטן מדי לנגישות ולקריאה בטלפון ביד אחת, לכן הועלה ל-13px. זו סטייה מכוונת מהרפרנס.
- **גופני קונספט: בוטלו** (החלטת המשתמשת 2026-10-04). שם הקונספט ב-Heebo 300: `display-sm` (22px) בכרטיס, `display-lg` בראש עמוד המפגש. `{typography.concept-name-*}` נשארו לתיעוד בלבד.
- אין אותיות רישיות/UPPERCASE (עברית); אין הטיה (italic).
- תאריך: `יום שני 12.10` (יום בשבוע ו-DD.MM). **שעת הבראנץ׳ מופיעה רק בעמוד המפגש עצמו** (של האורחת, של הלקוחה ושל טל), בפורמט `יום שני 12.10 · 10:00`, שעון 24 שעות. לא ברשימות, לא בכרטיס המפגש הקרוב, לא בקוביות האדמין ולא בשורות (החלטת המשתמשת 2026-10-07).
- מחיר: `128 ₪` — שקלים בלבד, בלי אגורות בתצוגה; מספרי טלפון ומספרים מעורבים עטופים ב-`<bdi>` כדי לא להתהפך ב-RTL.

## Layout & Spacing

סולם 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. ריווח מבני גדול יוצר את תחושת "השקט".

- **שוליים בטלפון:** `{spacing.gutter-mobile}` (24px) באתר הציבורי ובאזור האישי; 16px מותר בטבלאות אדמין צפופות.
- **בין סקשנים באתר הציבורי:** `{spacing.section-public}` (48px) — הנשימה של כיוון 1, מצומצמת כדי שיותר ייכנס במסך (החלטת משתמשת 2026-09-29, במקום 88px).
- **בין סקשנים באזור האישי ובאדמין:** `{spacing.section-app}` (32px) — אזורי עבודה צפופים יותר מהאתר השיווקי (החלטת משתמשת 2026-09-29).
- **יעד מגע מינימלי:** `{spacing.touch-min}` (44px) לכל רכיב אינטראקטיבי, גם כשהוויזואל קטן יותר (צ׳יפ סינון, כפתור אייקון). CTA ראשי `{spacing.cta-height}` (48px).
- **רוחב תוכן מרבי:** `{spacing.content-max}` (720px) לטקסט וטפסים בדסקטופ; ההירו נשאר full-bleed וטבלאות האדמין יכולות להיות רחבות יותר (החלטת משתמשת 2026-09-29).
- עמודה אחת בטלפון. נקודות שבירה: ברירת המחדל של Tailwind (`md` 768, `lg` 1024; החלטת משתמשת 2026-09-29). אדמין: סרגל תחתון → `side-nav` מ-`lg`. אזור אישי: הסרגל התחתון נשאר בכל רוחב.
- כל ריווח אופקי בתכונות לוגיות (`ps/pe`, `ms/me`, `inset-inline`) — לא left/right.
- אזור בטוח: סרגל תחתון, פס הוואטסאפ וגיליון תחתון מוסיפים `env(safe-area-inset-bottom)`.
- **שמירת מקום לרכיבים צמודים לתחתית:** כל עמוד שיש בו `whatsapp-bar` או `bottom-tab-bar` מקבל `padding-bottom` ו-`scroll-padding-bottom` בגובה הרכיב + אזור בטוח, כך שתוכן, פוטר ורכיב ממוקד לעולם לא מוסתרים מתחתיו.

**ריווח לפי תפקיד (סבב העיצוב 2026-10-07).** רק ערכי הסולם. אותו תפקיד, אותו ערך, בכל מסך:

| איפה | ערך |
|---|---|
| שוליים בצדי המסך (טלפון) | 24 (`gutter-mobile`) |
| בין סקשנים: אתר ציבורי / אזור אישי ואדמין | 48 / 32 |
| כותרת סקשן ← התוכן שלה | 12 |
| בין קוביות (אדמין) | 12 |
| ריפוד בתוך קובייה | 16 |
| שורה ברשימה: ריפוד אנכי | 12; גובה מינימלי 48, ושורה עם שתי שורות טקסט 56 |
| תווית ← ערך (מספר ותווית מתחתיו) | 4 |
| בין שני כפתורים צמודים | 8 (שתי עמודות שוות) |
| תמונה ← טקסט בשורה | 16 |

**פרופורציות קבועות:** תמונה בשורת מפגש 84×84; תמונת המפגש הקרוב 5:2 ברוחב מלא; כפתור 48 גובה, פינה 4; צ׳יפ 24; אייקון בסרגלים 24, chevron בשורה 20; פס תפוסה 4 ופס כניסות 6; יעד מגע 44 לפחות.

**יישור:** באזור האישי ובאדמין הכול מיושר להתחלה; סכום או מספר בסוף שורה מיושר לסוף. באתר הציבורי היישור הקיים נשאר.

## Elevation & Depth

שטוח. **אין צללים** — לא על כרטיסים, לא על כפתורים, לא על פס הוואטסאפ. ההפרדה נוצרת מטון (background ↔ card ↔ muted), מקו `border` דק ומרווח. שכבות צפות (גיליון תחתון, דיאלוג) מובחנות ע״י scrim של `scrim-ink` בשקיפות 40%, לא ע״י צל. רכיבי shadcn שמגיעים עם `shadow-*` מאופסים ל-`shadow-none`.

## Shapes

- `{rounded.sm}` 4px — כפתורים, שדות, `radio-card`, תווית סוג, צילום בתוך מסגרת.
- `{rounded.md}` 8px — כרטיסים, כרטיס יתרה, דיאלוג, הודעות inline, צילומי גלריה.
- `{rounded.lg}` 12px — פינות עליונות של גיליון תחתון בלבד; התחתית ישרה (החלטת משתמשת 2026-09-29).
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
| `top-bar` | מותאם | **אתר ציבורי:** רקע background. wordmark ב-inline-start. ב-inline-end, מהקצה פנימה: כפתור תפריט (אייקון lucide `Menu` 24px, 44×44) ולידו "כניסה לאזור האישי" (`button-secondary` עם `label-strong`, גובה ≥44px). **מעל ההירו:** פס scrim ink/72% מאחורי כל גובה הסרגל (wordmark on-primary ≥5.35:1); כפתור התפריט וכפתור הכניסה הופכים לצ׳יפים אטומים — רקע `{colors.background}`, טקסט/אייקון ink (13.28:1) — כך שהם קריאים על כל צילום. **אזור אישי ואדמין (`appVariant`):** שורת wordmark בלבד, ריפוד 12px; בבית האזור האישי מתחתיה `h1` "היי {שם}" ב-`display-md`. **שינוי (המשתמשת, 2026-10-04), גובר על הנאמר כאן:** לסרגל צבע משלו שמבדיל אותו משאר העמוד, ושם העסק במרכזו בכל שלושת המשטחים. הסרגל צמוד לראש המסך וגלוי תמיד, גם בגלילה. באזור האישי ובאדמין: כפתור התראות (`bell-button`) וכפתור התנתקות ב-inline-end (צד שמאל). הצבע נבחר מהפלטה בזמן הבנייה, בניגודיות של 4.5:1 לפחות. נבנה ב-5.2 (ציבורי) וב-5.7 (אזור אישי ואדמין) |
| `menu-sheet` | `Sheet` | התפריט הציבורי. נפתח מצד inline-end (צד הכפתור), רוחב min(320px, 85vw), רקע card, scrim 40%. בראש: wordmark + כפתור סגירה X 44×44. רשימת עמודי ה-site-map בסדר קבוע, כל פריט `body-lg` בגובה ≥48px עם קו הפרדה; העמוד הנוכחי מסומן בפס 2px accent ב-inline-start ובמשקל 600. בתחתית: "כניסה לאזור האישי" כ-`button-primary` ברוחב מלא, ומתחתיו מדיניות פרטיות והצהרת נגישות כ-`button-link` |
| `hero` | מותאם | צילום שולחן מלמעלה, full-bleed, `min-height` 560px בטלפון (גדל עם התוכן). scrim: פס עליון ink/72% מאחורי הסרגל; באמצע שקוף; מתחילת בלוק הטקסט ועד התחתית ≥ink/72% ובקצה 85%. **כלל:** בשום נקודה מאחורי טקסט השקיפות לא יורדת מ-0.72 (on-primary ≥5.35:1 גם מעל פיקסל לבן). בתחתית: wordmark `{typography.display-xl}` (משקל 300), כותרת `{typography.display-sm}`, שורת תיאור `{typography.body}`, `button-hero`. בלי צילום מאושר — וזו ברירת המחדל עד שצילום נבדק מול הכלל — fallback טיפוגרפי של כיוון 1 (רקע קרם, שם העסק ב-`{typography.wordmark-display}` ממורכז, `button-primary`) |
| `card` | `Card` | `{colors.card}`, מסגרת `{colors.border}`, פינה 8px, ריפוד 16px, בלי צל |
| `session-row` | מותאם | **מ-2026-10-07 (סבב העיצוב, גובר על עמודת התאריך שבהמשך השורה):** השורה היחידה לכל רשימת מפגשים: עמוד הבראנצ׳ים הציבורי ו"לו״ז בראנצ׳ים" באזור האישי (בדף הבית רק כשייפתח לשינוי). באזור האישי `status-chip` (יש מקום / מקומות אחרונים / מלא) מתחת לתאריך. תמונה 84×84 בפינה 4 (בלי תמונה: ריבוע muted), ריווח 16, ואז "בראנץ׳" ב-`label` ink-muted, שם הקונספט ב-`display-sm`, יום ותאריך ב-`body-sm` ink, בלי שעה. קו דק בין השורות, השורה כולה קישור אחד. **הנוסח הקודם, לווריאנט הבחירה בלבד:** רשימה עם קווי הפרדה דקים (כיוון 1). עמודת תאריך 64px: `{typography.numeral-lg}` + יום ב-`label`. תוכן: שם הקונספט ("בראנץ׳ {קונספט}") `body-strong`, בלי שורת שעה (2026-10-07) — תווית הסוג לא מוצגת ללקוחה (CAP-41, החלטת משתמשת 2026-09-26), שורה של `status-chip` + רמז חזותי "לפרטים" עם chevron (טקסט `label` עם קו תחתון, לא כפתור נפרד — השורה כולה היא יעד אחד). מפגש מלא: שם ב-ink-muted. וריאנט **בחירה** (כרטיסייה): צ׳קבוקס 24px בצד inline-start, בלי רמז "לפרטים"; שורה נבחרת ברקע `{colors.muted}` **וגם** צ׳קבוקס מסומן (הרקע לבדו 1.09:1 — לא מספיק); שורה לא זכאית: טקסט ink-muted + סיבה ב-`label` |
| `session-card` | `Card` | כרטיס אחיד לכל הקונספטים (החלטת המשתמשת 2026-10-04, memlog): צילום רחב למעלה ביחס 2:1, כרטיס נמוך ומלבני (תמונת המפגש, ואם אין, תמונת הקונספט; 5.4). מתחתיו "בראנץ׳" ב-`body-sm` ink-muted, שם הקונספט ב-`display-sm` בדיו הרגיל, ואז יום ותאריך ב-`body-sm` (בלי שעה, 2026-10-07) ו-`status-chip` (רק ללקוחה מחוברת). **"המפגש הקרוב שלי" בבית האזור האישי:** בלי מסגרת, צילום 5:2 ברוחב מלא, ואז "בראנץ׳", שם הקונספט ושורה של יום ותאריך עם צ׳יפ "נרשמת" ב-inline-end. **בלי צילום:** משטח muted עם סימן קרואסון קישוטי בצבע accent, אף פעם לא מסגרת ריקה. בלי צבע או גופן לקונספט. אין תווית סוג ואין "לשני מבוגרים" |
| `concept-header` | מותאם | ראש עמוד המפגש, באותו סגנון כמו `session-card` (החלטת המשתמשת 2026-10-04): צילום 4:3 ברוחב מלא, ומתחתיו "בראנץ׳" + שם הקונספט ב-`display-lg` + מועד, בדיו הרגיל. בלי צילום: אותו משטח muted כמו בכרטיס |
| `chip` | `Badge` | בסיס: `{colors.muted}`, 13px, pill. לא אינטראקטיבי; צ׳יפ סינון אינטראקטיבי מקבל אזור מגע 44px |
| `chip-type` | `Badge` outline | **אדמין בלבד** (רשימות מפגשים ועריכה): מסגרת `{colors.accent}` (גרפיקה, 3.42:1), טקסט ink, פינה 4px. לא מוצג לאורחת או ללקוחה |
| `status-chip` | `Badge` | pill, tint + טקסט + dot 7px, `label-strong`. **יש מקום** success · **מקומות אחרונים** warning · **מלא** expired (עמום, לא אדום) — שלושתם רק ללקוחה מחוברת, בלי מספר (באדמין התפוסה מוצגת כמספר בטקסט `label` ליד השם, "9/12", ולא כצ׳יפ) · **מאושר** success · **ממתין** / **ממתין למימוש** (קישור הצטרפות) pending · **עומדת לפוג** (`expiring`) warning · **פג תוקף** expired · **בוטל** expired · **שגיאה** error. תוצאה לכל תאריך בהרשמה מרובה: **נשמר** = success, **לא נשמר** = expired, והסיבה ב-`inline-notice` warning מתחת. תמיד מילה, לעולם לא נקודה לבד; הנקודה `aria-hidden` |
| `bottom-tab-bar` | מותאם | 5 פריטים, רקע card, קו עליון border, `min-height` 64px + safe-area. פריט: אייקון 24px מעל תווית `label`; תווית ארוכה ("ההרשמות שלי") רשאית לשבור לשתי שורות ב-320px. פעיל: ink + 600 + פס 2px `{colors.accent}` ברוחב 24px מעל האייקון; לא פעיל: ink-muted. מונה התראות: מספר ב-`label-strong`, ink על `{colors.saffron}` (7.6:1; מ-2026-10-07) |
| `side-nav` | `Sidebar` | אדמין ≥`lg`: רוחב 240px, רקע card, פריט פעיל ברקע muted עם פס accent בצד inline-start |
| `bottom-sheet` | `Drawer` (vaul) / `Sheet side=bottom` | רקע card, פינות עליונות 12px, grabber 36×4 (קישוטי), ריפוד 24px, scrim 40%. שורת כותרת: כותרת הגיליון ב-inline-start, **כפתור סגירה גלוי** (lucide `X`, 44×44) ב-inline-end. כפתור ראשי ברוחב מלא בתחתית, באזור האגודל. גובה מרבי 90vh עם גלילה פנימית |
| `sensitive-confirm-dialog` | `AlertDialog` | card, פינה 8px, כותרת `display-sm` בצורת שאלה ("האם לאשר החזר?"), תיבת השפעה ברקע muted (מה ישתנה, למי), צ׳קבוקס 24px עם תווית מלאה, כפתור אישור (primary או destructive לפי הפעולה) + `button-secondary` "ביטול". בטלפון — רוחב מלא פחות 16px |
| `input` | `Input` | רקע card, מסגרת 1px `{colors.ink-muted}` (5.8:1), פינה 4px, גובה 48px, 16px. תווית מעל ב-`body-sm` 600; שדה חובה מסומן בתווית במילה "(חובה)" ולא בכוכבית בלבד. פוקוס: `{components.focus-ring}` מחוץ למסגרת (המסגרת נשארת). שגיאה: מסגרת error + הודעה ב-`body-sm` error עם אייקון (קישוטי) מתחת. נעול (מוצר וסכום בטופס הצטרפות): רקע muted, אייקון מנעול, טקסט ink (קריא — לא אפור). שדה סיסמה: כפתור "הצגת סיסמה" (אייקון עין, 44×44) ב-inline-end של השדה |
| `focus-ring` | `ring` של shadcn | ראו Colors › פוקוס: פס 2px on-primary + טבעת 2px primary, ב-`:focus-visible` בלבד, לכל רכיב אינטראקטיבי בשלושת המשטחים |
| `notification-item` | מותאם | שורה ברשימה עם קו הפרדה. לא נקראה: נקודה 8px accent (קישוטית) + כותרת `body-strong` + המילה "לא נקראה" לקורא מסך; נקראה: כותרת `body`. זמן יחסי ב-`label` ink-muted. השורה כולה היא קישור אחד (≥44px) |
| `balance-card` | מותאם | רקע `{colors.muted}`, פינה 8px, נקודה accent. שורה: סוג · **מספרים ב-`body-strong`** · "בתוקף עד DD.MM" ב-ink-muted. שורה משנית: משוריינות / תפוגה. עומדת לפוג: שורת התוקף מוסיפה "עוד {n} ימים" + `status-chip` expiring, בלי כפתור; פגה: expired; זיכוי: שתי החלופות כשורות קטנות. נקודת ה-accent קישוטית. **בבית האזור האישי מוחלף ב-`home-card`** (2026-10-07) |
| `home-card` | מותאם | "הכרטיסייה שלי" בבית האזור האישי (2026-10-07, המראה של גרסה 1): בלי מסגרת ובלי רקע. שם המוצר `body-sm` ink-muted; מספר הכניסות הפנויות ב-`numeral-xl` ולידו "כניסות זמינות" ב-`body` (הנוסח החדש היחיד שאושר); פס של חלק לכל כניסה, גובה 6, רווח 4 (פנויה primary, משוריינת accent, נוצלה border); מקרא "נרשמת X/N" ו-"ניצלת X/N" ב-`body-sm` עם מפתח צבע; "בתוקף עד DD.MM" ב-ink-muted (עומדת לפוג: + "עוד {n} ימים" ו-`status-chip` expiring) |
| `inline-notice` | `Alert` | tint + טקסט בצבע המצב, אייקון lucide (קישוטי), פינה 8px. מבנה קבוע: סיבה (שורה אחת) + פעולה (`button-link` או `button-secondary`). ממורכז, בשורות מאוזנות, כך שאף פעם לא נשארת מילה בודדת בשורה האחרונה; האייקון בתחילת השורה הראשונה, והפעולות ממורכזות (החלטת המשתמשת 2026-10-04). כך גם ה-Alert במסכי ההתחברות. בכל האפליקציה טקסט רץ נשבר ב-`text-wrap: pretty` וכותרות ב-`balance` |
| `attendee-row` | מותאם | אדמין: שם `body-strong` (+ "×2" לזוגי), שורת תינוק/ת וגיל `body-sm`. שדה "אלרגיות והעדפות תזונתיות" הוא טקסט אחד שהלקוחה כתבה — מוצג כמו שהוא ב-`body-sm`, בתוך רקע tint של warning כדי שיבלוט לטל; הגבלת המלווה בזוגי מוצגת באותו אופן עם "מלווה:". **שדה ריק — לא מוצג כלום** (בלי "טרם נמסר"). בדף העבודה גם אישור התמונות כ-`status-chip`. המערכת לא מפרקת את הטקסט לצ׳יפים |
| `bell-button` | `Button` ghost | סרגל עליון של האדמין, ב-inline-end: פעמון lucide 24px באזור 44×44, מונה לא-נקראו כ-pill `saffron` עם מספר ב-ink (2026-10-07, גם בפעמון של הלקוחה). פותח את מרכז ההתראות של טל |
| `segmented-switch` | `ToggleGroup` / קישורים | שתי תצוגות של אותו דבר ("פרטים \| עבודה" במפגש, "לקוחות \| כרטיסיות פתוחות"): מסגרת 1px ink-muted, פינה 4px, כל חצי 44px לפחות; הנבחר ב-primary עם טקסט on-primary |
| `check-item` | `Checkbox` + תווית | משימה, פריט קניות, פתק: תיבה 24px; מסומן — התיבה ב-primary **והטקסט ב-ink-muted עם קו מחיקה**, גם בהדפסה |
| `dish-card` | `Card` | דף העבודה בטלפון: מנה אחת לכרטיס, שם `body-strong`, ובתוכו קבוצה לכל יום הכנה (כותרת `label-strong` ink-muted עם התאריך) ורשימת `check-item` |
| `worksheet-print` | `@media print` + `Table` | דסקטופ והדפסה: טבלה — עמודת מנה ועמודה לכל יום הכנה שיש בו תוכן; מתחתיה שלוש עמודות: נרשמות ואישור תמונות · תזונה ואלרגיות · רשימת קניות. כותרת: שם הקונספט בגופן שלו + מועד, וקו 2px בדיו הקונספט. בהדפסה: שחור על לבן, בלי ניווט, בלי כפתורים, עמודה ריקה לא מודפסת. ראו [key-admin-worksheet](mockups/key-admin-worksheet.html) |
| `open-card-row` | `Card` | כרטיסייה פתוחה: שם הלקוחה + `status-chip` expiring כשרלוונטי; מטא: נרכשה · בתוקף עד (כולל הארכה); שורה לכל כניסה — תאריך המפגש או "כניסה {n}" + `status-chip` (נוצלה expired · משוריינת success · פנויה pending) |
| `reminder-strip` | `Alert` | תזכורת השיווק הנוכחית בראש בית האדמין: רקע muted, טקסט `body-sm`, "סגירה" כ-`button-link`. נעלם עד התזכורת הבאה |
| `task-row` | מותאם | שורת "לטיפול" בבית האדמין, באותו מראה של `notification-item`: קו הפרדה, ריפוד 16px, כותרת `body-strong` ("סוג · שם הלקוחה"), פירוט `body-sm`, זמן/מטא ב-`label` ink-muted, `status-chip` ב-inline-end ו-chevron קישוטי. השורה כולה היא יעד אחד. ראו [key-admin-home](mockups/key-admin-home.html) |
| `summary-card` | `Card` | מספרי המפגש הבא ומבט בוקר המפגש: card עם מסגרת border, פינה 8px, ארבע עמודות (מקומות · הרשמות/נרשמות · תינוקות · אלרגיות). מספר ב-`numeral-lg`, תווית ב-`label` ink-muted; מספר האלרגיות ב-`{colors.warning}` (5.54:1 על card). בבית האדמין מוחלף ב-`session-tile` |
| `session-tile` | `Card` | בית האדמין (2026-10-07): שני המפגשים הקרובים, אחד מתחת לשני, ואחריהם "לכל המפגשים". **הבא:** "המפגש הבא" ב-`label`, שם המפגש, יום ותאריך, פס תפוסה 4, ומתחת שלושה ערכים: מקומות ("X/N") · תינוקות · אלרגיות (`numeral-lg` מעל `label`, ריווח 22 ביניהם). **בלי "נרשמות"**, שחוזר על המקומות. "לפרטי המפגש" כ-`button-link`. **השני:** שם, יום ותאריך ו-"X/N" ב-inline-end, פס תפוסה, "לפרטי המפגש" |
| `admin-home-actions` | `Button` | ראש בית האדמין, מתחת ל-`h1`: "הוספת תשלום" (`button-primary`) ו"מפגש חדש" (`button-secondary`), שתי עמודות שוות, רווח 8 |
| `radio-card` | `RadioGroup` | בחירה אחת מתוך מעט אפשרויות כשורות גדולות (לקוחה חדשה / קיימת, אמצעי תשלום, זיכוי / החזר): רקע card, מסגרת 1px ink-muted, פינה 4px, גובה ≥48px, עיגול 20px. נבחרה: רקע muted **וגם** מסגרת ink **וגם** עיגול מלא ב-primary (הרקע לבדו לא מספיק). אמצעי תשלום — רשת של שתיים בשורה רק כשכל השמות נכנסים בשורה אחת; אחרת (שם ארוך, 320px, זום 200%) עמודה אחת. התווית נשברת ולא נחתכת. ראו [key-admin-payment](mockups/key-admin-payment.html) |
| `empty-state` | מותאם | כותרת `display-md`, משפט `body-lg`, פעולה אחת `button-primary`. בלי איור; מותר צילום אוכל שטל העלתה (החלטת משתמשת 2026-09-29) |
| `value-change-row` | מותאם | אדמין: מתחת לשדה שורת מקור ב-`label` ink-muted ("מההגדרות: 20:00 ביום הקודם"). אחרי שינוי: תיבה ברקע `{colors.muted}`, פינה 4px, ריפוד 12×16 — "ישן ← חדש" ב-`body-strong` (החץ קישוטי, משתקף ב-RTL), הערת היקף ב-`body-sm`, `button-secondary` "לשמור את השינוי" ו-`button-link` "חזרה לברירת המחדל". בלי צ׳קבוקס — הוא רק ב-`sensitive-confirm-dialog` |
| `content-section-row` | מותאם | עורך התוכן, וגם רשימות מסודרות בהגדרות (אמצעי תשלום, בלי צ׳יפים של טיוטה ופרסום, רק "מוסתר" = expired): שורה ברשימה עם קו הפרדה (כמו `task-row`), שם הבלוק `body-strong`, תקציר `body-sm` ink-muted, `status-chip` (טיוטה = pending · פורסם = success · מוסתר = expired · "שינויים שלא פורסמו" = warning) ב-inline-end. כפתורי סידור "למעלה"/"למטה" 44×44 (chevron 20px ink) ו"הסתרה" מחוץ לאזור הלחיץ של השורה |
| `image-upload-field` | מותאם | אזור בחירה: מסגרת מקווקוות 1px ink-muted על card, פינה 8px, ריפוד 24px. אחרי בחירה: תצוגה בפינות 8px + מסגרת חיתוך לטלפון 2px primary, ומחוצה לה scrim-ink/40%. מתחת: שדה "טקסט חלופי (חובה)" (`input`), צ׳קבוקס הסכמה 24px (כמו ב-`sensitive-confirm-dialog`), וכשחסר אחד מהם — `inline-notice` warning עם הסיבה. לצילום הירו אין שדה טקסט חלופי (קישוטי) |
| `testimonial-carousel` | מותאם (CSS scroll-snap, בלי תלות חדשה) | המלצות בבית וב-/gallery (החלטת משתמשת 2026-10-07): שורה אופקית שמחליקים ביד, המלצה אחת ברוחב כמעט מלא בטלפון וההבאה מציצה בקצה כרמז. כפתורי הקודם והבא עם אייקון (יעד מגע 44px כמו שאר הכפתורים, aria-label) ונקודות מיקום (aria-current). לא זזה לבד אף פעם. RTL: הראשונה בצד ההתחלה. המלצת טקסט והמלצת תמונה באותו גובה שורה. המלצה אחת: בלי כפתורים ונקודות. `prefers-reduced-motion`: מעבר מיידי. הצבעים, הגופנים והפינות מהטוקנים הקיימים |

## Do's and Don'ts

| Do | Don't |
|---|---|
| לתת לצילום האוכל להיות הצבע; זעפרן רק במונים | צבעים רוויים, גרדיאנטים, רקעים צבעוניים בממשק; זעפרן כטקסט, כרקע או לסימון זמינות |
| שורות וקווים באתר ובאזור האישי; קוביות רק בבית האדמין | מסגרת סביב סקשן באתר; קובייה בתוך קובייה |
| כל נתון פעם אחת במסך | "8/12 מקומות" וגם "8 נרשמות"; כותרת שחוזרת על התוכן שמתחתיה |
| שעת הבראנץ׳ רק בעמוד המפגש | שעה ברשימות, בכרטיס המפגש הקרוב או בקוביות |
| ערכי ריווח וגודל מהטבלאות בלבד | ערך "בערך", גודל או משקל שלא בטבלה |
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
| צבע קונספט רק בראש עמוד המפגש ובפס הכרטיס, עם הדיו הכהה שלו | צבע קונספט ברקע דף, בכפתורים או בתוויות סטטוס; טקסט קרם על שדה קונספט |
| גופן קונספט רק לשם הקונספט, 22px ומעלה | גופן קונספט לטקסט רץ, למועד או לכפתור |
| שם הקונספט כתמונה כשאין צילום | מסגרת צילום ריקה או אייקון במקום צילום |
| שדה ריק (אלרגיות) — לא להציג | "טרם נמסר", "—", "אין מידע" |
| פריט שבוצע — תיבה מסומנת וקו מחיקה | רק לשנות צבע, או להעלים את הפריט |
