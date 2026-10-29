---
title: 'Accessibility widget (5.25)'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '4365cf330e10cf5b81732825a620a09efd197f06'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Customers have no on-page accessibility controls (text size, contrast, readable font). The user decided (2026-10-29) on the free, MIT-licensed AccessibleWeb Widget, self-hosted, on every customer-facing page and never in `/admin`.

**Approach:** Install `accessible-web-widget@1.6.2` (exact, no dependencies, no install scripts). Our own fixed button in the root layout opens the library's panel (`hideButton: true`, `AccessibleWebWidget.instance.open()`). The library is imported dynamically on the first click, or right after mount when this device already saved settings.

## Boundaries & Constraints

**Always:**
- **Where:** a pure `showsAccessibilityButton(pathname)` in `lib/accessibility-widget.ts`: true for every page except `/admin` and `/admin/...` (`/admin/login` included) and `/api`. So it shows on `app/(public)`, `/login`, `/join/…`, `/reset/…`, `/offline`, `/me/…` and not-found pages. Mounted once in `app/layout.tsx` (`<Suspense>`, `usePathname`). If the library was loaded and the path becomes an admin path (client navigation), `location.reload()`: the library has no teardown, and its applied settings and skip link must not stay in admin.
- **Options** (`window.AccessibleWebWidgetOptions`, set before the import): `lang: "he"`, `position: "bottom-left"`, `hideButton: true`, `hideAttribution: true` (its footer link goes off-site), the theme below, `readableFontUrls` to `/fonts/a11y/OpenDyslexic3-Regular.woff`, `/fonts/a11y/AtkinsonHyperlegible-Regular.woff2`, `/fonts/a11y/Lexend-Regular.woff2`, and `axeCoreUrl: "/fonts/a11y/axe-disabled.js"` (a same-origin path that does not exist, so nothing ever reaches jsDelivr). Before the import, `acc-dev` is removed from the URL (`history.replaceState`), so the dev tools never turn on, in any environment.
- **Self-hosted fonts:** the three files and `LICENSE.txt` (SIL OFL 1.1, which allows redistribution with the license) are copied from the library's repo tag `v1.6.2`, `examples/fonts/`, into `public/fonts/a11y/`. The files are Latin-only; Hebrew text in "readable font" falls back to the system font (Arial). This is a library limit. The build strips the library's MIT banner, so its `LICENSE` is served as `public/licenses/accessible-web-widget.txt`, with no link from any page (work manager, 2026-10-29).
- **Filters** (work manager, 2026-10-29): if contrast or saturation makes the whatsapp-bar or tab bar follow the page, a small CSS change on our side is allowed (for example, the filter on the page content only). Otherwise it is documented as a limit. Never patched inside the library. Awkward Hebrew labels in the panel are reported, not fixed.
- **No external requests and no data sent:** the 1.6.2 code has no `fetch`, XHR, `sendBeacon` or WebSocket (checked). Its only remote URLs are the fonts and axe-core, both overridden above. Settings live in `localStorage["accweb"]`, with a cookie `accweb` (`SameSite=Strict`) only when localStorage throws. These are the visitor's own preferences, not tracking, so the cookie notice and the privacy policy do not change.
- **Theme** (DESIGN.md colours): `primaryColor` `#4A4A2A`, `primaryColorDark` and `activeColor` `#2E2A1F`, `primaryColorLight` and `hoverColor` `#6B6450`, `backgroundColor` `#FAF6EE`, `cardBackground` `#FFFDF8`, `textColor` `#2E2A1F`, `textColorInverted` `#FAF6EE`, `borderColor` `#E6DFCF`, `focusRingColor` `#4A4A2A`, `buttonBorderRadius` `4px`, `borderRadius` `8px`.
- **Our button** (`frontend-design`, within DESIGN.md): a native `<button>`, 48×48 (target ≥44), round, `bg-primary` with a lucide `AccessibilityIcon` 24px in `text-primary-foreground`, flat, no shadow. `fixed end-4 z-30`, `print:hidden`, `data-a11y-button`. `aria-label` "תפריט נגישות", `aria-haspopup="dialog"`, plus `aria-busy` while the import runs. It is not an `OnlineButton`, because it sends nothing. A failed import (for example offline before the chunk was cached) leaves the button ready for another click.
- **Placement** (`app/globals.css`, one `--a11y-room: 4rem` while `[data-a11y-button]` is in the page): the bottom is 16px + safe area. Above the whatsapp-bar, 16px above it (the cookie notice's offset). Above the bottom-tab-bar, 16px above it. While the cookie notice is open, 8px above the notice: the notice publishes its height as `--cookie-notice-height` on `<html>` (`ResizeObserver` in `CookieNotice`, removed on unmount). The page keeps `--a11y-room` more bottom room and scroll-padding, so no content or focused control ends under the button: in `/me` on the body, in the public shell in the footer's padding (with and without the bar), and in the auth layout and `/offline` on the body.

**Never:** editing the library or its CSS from outside the documented options; a CDN, jsDelivr, Google Fonts or any remote font; the widget in `/admin`; a paid service; editing the accessibility statement's text; a CSP (none exists); other screen redesigns; `demo:*`/`video:*` or `*@video.example.com` data; `test:db`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit | home, nothing saved | button shown; library not downloaded | — |
| Open | tap / Enter on the button | library loads, Hebrew RTL panel opens; focus returns to our button on close | import fails: nothing opens, next click retries |
| Saved | font size set, reload | library loads after mount and applies it | storage blocked: cookie fallback (library) |
| Admin | `/admin`, `/admin/login`, `/admin/sessions` | no button, library never imported | — |
| Into admin | library loaded, client nav to `/admin/…` | full reload, no widget | — |
| Dev param | `/?acc-dev=true` | param removed before import; no dev tools, no request to jsDelivr | — |
| Bars | whatsapp-bar / tab bar / cookie notice shown | button above each, none covered | short window (<480px): bar in the flow, button at the bottom |

</frozen-after-approval>

## Code Map

- `app/layout.tsx` -- mount `<AccessibilityButton />` inside its own `<Suspense fallback={null}>` after `{children}`.
- `components/public/cookie-notice.tsx` -- `CookieNoticePanel` (non-preview only) publishes `--cookie-notice-height`.
- `app/globals.css:217-290` -- tab-bar, whatsapp-bar, footer and `[data-cookie-notice]` offset rules to extend with `--a11y-room`; `short` variant at 480px.
- `app/(auth)/layout.tsx`, `app/offline/` -- no footer or tab bar: body room rule.
- `components/shared/skip-link.tsx` -- button classes to mirror; `lib/copy/shell.ts` -- add `accessibilityButton: "תפריט נגישות"`.
- `public/sw.js` -- caches `/_next/static/*` cache-first (the widget chunk too after a first load); `/fonts/*` is not cached. No change.
- `next.config.mjs` -- no CSP (checked); no change.
- The package has no types for its main entry: a local `declare module "accessible-web-widget"` and a `Window` declaration for `AccessibleWebWidget` and `AccessibleWebWidgetOptions`.
- Tests: `app/globals.test.ts` (rules exist), `components/public/public-shell.test.tsx` (pattern of walking the layouts).

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json` -- `npm install --save-exact accessible-web-widget@1.6.2` (never `npm ci`); confirm MIT, zero dependencies, no install scripts; `npm audit --omit=dev --audit-level=high`.
- [x] `public/fonts/a11y/` -- three font files + `LICENSE.txt` from tag `v1.6.2` `examples/fonts/`.
- [x] `lib/accessibility-widget.ts` + test -- `showsAccessibilityButton`, `hasSavedSettings` (localStorage or cookie `accweb`, try/catch), `widgetOptions()`, `stripDevParam(url)`. The test walks every `page.tsx` under `app/` and checks the predicate: true outside `app/admin` and `app/(auth)/admin`, false inside them.
- [x] `types/accessible-web-widget.d.ts` -- module and `Window` declarations.
- [x] `components/shared/accessibility-button.tsx` + test -- `"use client"` button (`frontend-design` skill first): render rule, aria attributes, load-on-click, load-when-saved, reload into admin (mocked import).
- [x] `app/layout.tsx`, `components/public/cookie-notice.tsx`, `app/globals.css`, `app/globals.test.ts`, `lib/copy/shell.ts` -- mount, notice height, placement and room, copy.
- [x] `tickets.toml` (E5) -- `[[entry]] id = 25` like 24, `after = [24]`, `hitl = true`, `risk = "low"`, done in the PR.
- [x] `completion-plan-2026-10-10.md` -- section "2026-10-29, החלטת המשתמשת: סיפור חדש 5.25, כפתור נגישות" with the two decisions; 5.25 in the round 9 row.
- [x] `deferred-work.md` -- target 6.4: add a sentence about the accessibility button to the accessibility statement (business content, the business edits it).

**Acceptance Criteria:**
- Given a 390×844 phone, when the home, `/sessions`, `/login` and `/me` load, then the button is visible and does not cover the whatsapp-bar, the tab bar or the cookie notice, and no page scrolls sideways.
- Given the panel is open in the browser, when text size and contrast are changed and the page reloads, then both stay applied, and the network panel shows no request outside the site's origin.

## Implementation Notes

- Work only in the worktree `C:\Users\ligal\Desktop\Projects\brunch-5-25` (run `npm install` first; never `npm ci`; never stop a node process you did not start). Fonts: `gh api -H "Accept: application/vnd.github.raw" "repos/ifrederico/accessible-web-widget/contents/examples/fonts/<file>?ref=v1.6.2" > <dest>`. Start the button with the `frontend-design` skill (Skill tool). No git commands that write, no file deletion, no `.env*`.
- Turbopack strips every comment, including the library's `/*!` MIT banner (checked in the built chunk). So the library's `LICENSE` is served as `public/licenses/accessible-web-widget.txt` (main session).
- Confirmed in the browser: with contrast or saturation on, the whatsapp-bar and the cookie notice follow the page (the filter sits on the public layout's root `div`). No small CSS fix is possible, because the library marks nothing on the page while a filter is on. Accepted as a library limit (work manager, 2026-10-29). The tab-bar offset is `4.25rem + 1px` (measured 69px). Library quirk: in RTL the panel's text-size slider fills from the opposite side.
- Self-check (work manager's request, main session): every page at 390×844 and 360×740, top and scrolled to the end, as a guest (with and without the cookie notice) and as `dev-customer`. At 360px the tab bar's labels wrap to two lines, so the bar publishes `--tab-bar-height` (`ResizeObserver` in `BottomTabBar`) and the button's offset and `/me`'s bottom room use it. After that, nothing at the end of any page is covered. The public menu-sheet opens over the button. A focused field in a short window (keyboard) is not covered. `/admin/login` has no button. There were no external requests. The dev customer has no entitlement or booking, so the booking and cancel sheets could not be opened; they are the same `Sheet` (z-50) as the menu-sheet. Panel labels: all Hebrew, `dir="rtl"`, none awkward. Screenshots: scratchpad `shots-5-25/`.

## Spec Change Log

## Review Triage Log

Pass 1 (quick, one reviewer, with `review-accepted.md` and a supply-chain check). Supply chain: clean (exact `1.6.2`, integrity matches the registry, MIT, no dependencies, no install scripts, no fetch/XHR/beacon/WebSocket). high 0, medium 1, low 1 routed; the MIT finding goes to the work manager.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 2 | The body room under the auth layout's and `/offline`'s `min-h-svh` makes those pages scroll by 64px | medium | patch | room moved to `#main` (inside `min-h-svh`); test updated |
| 3 | `/fonts/a11y/*.woff[2]` run the Supabase session refresh in `proxy.ts` | low | patch | `woff2?` added to `STATIC_ASSET`; two cases in `proxy.test.ts` |
| 4 | The frozen text says the MIT banner stays in the served code, but the build strips it; the served license file is not linked | low | patch | work manager approved the served file with no link; frozen text updated (2026-10-29) |

Rejected: #1 text-to-speech may use a browser network voice (for example Edge's online Hebrew voices). The browser sends the text to its own speech service, only when the visitor turns the tool on, like the browser's own read-aloud. The library and the site send nothing. Reported to the work manager as information.

## Design Notes

Why our own button instead of the library's: its button offset is fixed pixels set once inside a shadow root, so it cannot follow the whatsapp-bar, the tab bar or the cookie notice, and its colour is not ours. With `hideButton` the library still builds the panel and its own skip link (first in `<body>`, translated by the library). Why load on demand: the minified library is 373KB (96KB gzip), too heavy for every first visit on a phone. Known library limit: contrast and saturation apply a CSS `filter` to `body > *`, which makes `position: fixed` children (whatsapp-bar, tab bar) follow the page instead of the screen while a filter is on. Check it in the browser and report it; do not patch the library.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass
- `npm audit --omit=dev --audit-level=high` -- no high

**Manual checks:**
- 390×844 (work manager): button on home, `/sessions`, `/login`, `/me`, not on `/admin`. Not covering whatsapp-bar, tab bar or cookie notice. Hebrew right-aligned panel. Text size and contrast persist after reload. No external requests. Keyboard: Tab to the button, then Enter opens the panel.
