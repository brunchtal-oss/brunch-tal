---
title: 'Cookie notice (5.23)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '74d4100911fc1d78b03179b301dfcce1ecca5df9'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The public site has no cookie notice. The user wants one now (decision 2026-10-28; the source doc does not mention cookies), so that the future marketing tab (GA/GTM/Meta, built in the 6.4/6.8 wait) can load tracking only for a device that clicked "הבנתי".

**Approach:** A new content block `cookie_notice` on its own content page `cookie-notice`, edited and published in the existing editor. A client component in `app/(public)/layout.tsx` shows it as a non-blocking panel at the bottom of the screen until "הבנתי" is clicked on this device; the choice is kept in `localStorage` under a documented key.

## Boundaries & Constraints

**Always:**
- **Kind** `cookie_notice` (`lib/content/schema.ts`): `title` (optional, 120), `body` (optional, 1000), `link_label` (optional, 80). No `hidden` (like the legal kinds). An emoji in `title` parses and passes `test/invisible-chars.test.ts`.
- **Shown only** when published and `title` or `body` is non-blank (the site's rule: no published content, no notice). The link is shown only when `link_label` is filled and `privacy` is published (`getPublishedPageSlugs`, as the footer); it goes to `/privacy` in the same tab.
- **Link joins the paragraph:** when the body's last word is a single Hebrew letter (a prefix: `ב`, `ל`, `מ`, `ו`, `ה`, `כ`, `ש`), the link follows it with no space; otherwise with one space. "…אפשר לעיין ב" + "מדיניות הפרטיות שלנו" reads "…אפשר לעיין במדיניות הפרטיות שלנו".
- **Choice:** `localStorage["cookie_notice_ack"]` = ISO time of the click. Missing, unparseable or older than 365 days: shown. Every access in try/catch; a failed read shows the notice, a failed write still closes it for this page load. `lib/cookie-notice.ts` exports the key and `hasCookieAck(): boolean` for the future tracking code. Changing the wording does not show it again.
- **Cache:** the layout reads the block with `getPublishedSections("cookie-notice")` (cached, tag `content:cookie-notice`, `updateTag` by the existing publish action). Only the choice is read, in the browser, via `useSyncExternalStore` whose server snapshot is "acked": nothing in the server HTML, no flash and no layout shift for a device that already clicked.
- **Where:** only `app/(public)` (layout). Not in `/login`, `/me`, `/admin`, `/join`, `/offline`. Shown to any viewer of the public site.
- **Panel:** `role="dialog"`, `aria-modal="false"`, `aria-labelledby` the title (or `aria-label` = the body's first line when there is no title). Focus is not moved or trapped; no Escape close. In the DOM right after `SkipLink`. Fixed, `z-30` (above the whatsapp-bar's `z-20`, below sheets), bottom above the whatsapp-bar while it is shown (same offset as `scroll-padding-bottom` in `app/globals.css`), bottom 0 below a 480px height. Max height 60svh with inner scroll. Hidden in print. Logical directions only; 44px targets.
- **Microcopy** in `lib/copy/shell.ts`: button "הבנתי". Admin copy in `lib/copy/admin.ts`: page "הודעת עוגיות", section "נוסח ההודעה", fields "כותרת", "הפסקה", "טקסט הקישור למדיניות הפרטיות", hint "הקישור מוצג בסוף הפסקה ומוביל לעמוד מדיניות הפרטיות. אם הפסקה מסתיימת באות אחת (למשל ב), הקישור מתחבר אליה בלי רווח."
- "הבנתי" sends nothing to the server, so it is a plain button, not `OnlineButton`.
- Screens start with the `frontend-design` skill, within DESIGN.md (cream and olive, Heebo, no shadow; the look of the site, not the sample screenshot). No "טל" in customer-facing copy.
- **Initial wording** (planning session, from the user's sample; business text, so never in code or migration): title "האתר משתמש בעוגיות 🍪"; body "הפרטיות שלך חשובה לנו. לידיעתך, באתר זה אנחנו משתמשות ב"קבצי עוגיות" (cookies) וכלים דומים אחרים על מנת לספק לך חוויית גלישה טובה יותר, תוכן מותאם אישית וכדי לבצע ניתוחים סטטיסטיים. למידע נוסף אפשר לעיין ב"; link "מדיניות הפרטיות שלנו". Entered and published through the local editor on the dev DB.

**Never:** a decline button, tracking code or a marketing tab; a notice in `/me` or `/admin`; changes to the privacy policy's content, `admin_publish_content` or any table's schema; `cookies()` or the choice read inside `'use cache'`; `demo:*`/`video:*` scripts or `*@video.example.com` data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit | published, no key | panel shown on every public page | — |
| Clicked | "הבנתי" | closes; key saved; no panel after reload or on other pages | write throws: closes for this page load |
| Old choice | key 366 days old | shown again | unparseable value: shown |
| Not published | never published, or title and body blank | nothing | — |
| Privacy not published | `link_label` filled | paragraph without link | — |
| Join rule | body ends "לעיין ב" / "ראו" | "לעיין במדיניות…" / "ראו מדיניות…" | — |
| Other areas | `/login`, `/me`, `/admin`, `/join/…` | no panel | — |
| Storage blocked | `localStorage` throws on read | shown | no crash |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261021065232_home_promo_banner.sql` -- precedent: rows only, no content; `admin_set_content_draft` raises NOT_FOUND without the row.
- `lib/content/schema.ts:318-385` -- legal kinds without `hidden`, `contentSchemas`; add `cookieNoticeSchema`.
- `lib/content/visible.ts:46` -- `visibleSection`: a block with nothing is already dropped (no change expected).
- `lib/content/pages.ts:35,144` -- `getPublishedSections`, `getPublishedPageSlugs`.
- `app/(public)/layout.tsx` -- add the read to `Promise.all`, render the notice after `SkipLink`.
- `app/admin/(shell)/content/content-items.ts:23-88` -- `EDITABLE_PAGES` (after `accessibility`), `EDITABLE_SLUGS`; `publishTags` default gives `content:cookie-notice`; `sectionSummary` reads `title`.
- `app/admin/(shell)/content/section-fields.ts:184` -- `sectionSpec` case, `hideable: false`.
- `app/admin/(shell)/content/[slug]/preview/page.tsx:150` -- `PageView` case: the panel static (not fixed), link shown when `link_label` filled.
- `lib/copy/admin.ts:219-249` -- `pages`, `sections`; `lib/copy/shell.ts` -- button.
- `components/public/whatsapp-bar.tsx`, `app/globals.css:250-274` -- bar height and `short:` rule to mirror.
- Tests to extend: `lib/content/schema.test.ts`, `app/admin/(shell)/content/content-items.test.ts`, `section-fields.test.ts`, `components/public/public-shell.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>_cookie_notice.sql` -- `npx supabase migration new cookie_notice`: `content_pages ('cookie-notice')` and `content_sections ('cookie-notice','notice','cookie_notice',1)`, `on conflict do nothing`, no content. Not applied here: the file name goes to the planning session (db push, `get_advisors`); no schema change, so no types regen -- main session
- [ ] `lib/content/schema.ts` + test -- kind, emoji title, no `hidden`
- [ ] `lib/cookie-notice.ts` + test -- key, `hasCookieAck`, save, 365 days, try/catch, store subscribe; `joinLink` rule
- [ ] `components/public/cookie-notice.tsx` + test -- `"use client"` panel (`frontend-design`): matrix rows, a11y attributes, no render on the server snapshot
- [ ] `app/(public)/layout.tsx`, `app/globals.css` -- read, render, offset above the bar
- [ ] `app/admin/(shell)/content/{content-items,section-fields}.ts`, `[slug]/preview/page.tsx`, `lib/copy/{admin,shell}.ts` + tests -- editor page, fields, preview
- [ ] Initial wording through the local editor, published (dev DB) -- main session
- [ ] `_bmad-output/initiative-brunch-at-tal-v1/epic-site-and-communication/tickets.toml` -- `[[entry]] id = 23` like id 22, `after = [22]`, `hitl = true`, `risk = "low"`; done in the PR
- [ ] `completion-plan-2026-10-10.md` -- decision section "2026-10-28, החלטת המשתמשת: סיפור חדש 5.23, הודעת עוגיות" with the three decisions; 5.23 in the round 9 row (before Tal's video, because the editor is in admin)
- [ ] `deferred-work.md` -- target 6.1: copy the `cookie-notice` block to production with the legal pages before the site opens

**Acceptance Criteria:**
- Given the notice is published, when it is edited and published again in the admin, then a private window shows the new wording without a deploy.
- Given a 390px phone, when the panel is open, then the whatsapp-bar stays visible below it and nothing scrolls sideways.

## Implementation Notes

- Work only in the worktree `C:\Users\ligal\Desktop\Projects\brunch-at-tals-5-23` (run `npm install` there first; never `npm ci`, never stop any node process but your own). Creating the migration file with `npx supabase migration new` is fine; applying it, `test:db` and entering the wording are left to the main session.
- Migration applied by the planning session (db push, 2026-10-28; advisors clean). The initial wording was entered and published in the local editor (dev DB); a 390x844 guest check showed the notice, the joined link to `/privacy`, and no notice after "הבנתי", a reload and `/sessions`. Without the rows `/admin/content` throws (it loads every editor page), so the migration goes with the merge.
- Review patches: focus moves to `#main` after "הבנתי"; a future stored time is invalid. A test checks that only `app/(public)/layout.tsx` renders `<CookieNotice>`.

## Spec Change Log

## Review Triage Log

Pass 1 (quick, one reviewer). high 0, medium 0, low 3, false 0, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 2 | "הבנתי" unmounts the focused button; focus falls to `<body>` | low | patch | `CookieNotice` onAck focuses `#main` (`preventScroll`) |
| 3 | `isAckValid` accepts a future time, so it never expires | low | patch | `at > now` is invalid; future case in the table test |

Rejected: #1 the open notice can cover a focused control near the bottom and the footer's last links (low, unlikely: the notice is the first stop after the skip link, so a keyboard user meets "הבנתי" first; the fix needs a measured height).

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass

**Manual checks:**
- Phone (dev server on the home network): first visit shows it; the link opens `/privacy`; "הבנתי" closes it and it stays closed after reload and on other pages; not on `/login`, `/me`, `/admin`; whatsapp-bar not hidden; edit + publish shows in a private window.
