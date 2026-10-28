---
title: 'Marketing tags (5.24)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '2ba69b9e2234ed2182e18381f81fd2eaba67090a'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The business cannot measure visits to the public site or run Meta ads with a pixel. The user decided (2026-10-28; the source doc does not mention analytics) on an admin "שיווק" screen where three tool IDs are pasted, never code.

**Approach:** A singleton table `marketing_tags` (three nullable IDs) written only by an admin RPC, read cached by the public layout, which loads GA4 / GTM / Meta Pixel with `next/script` for every visitor of `app/(public)` only. An empty ID turns that tool off.

## Boundaries & Constraints

**Always:**
- **Formats** (one module, `lib/marketing-tags.ts`, used by the screen, the Server Action and the public view; the same regexes as DB `check`s and RPC checks): GA4 `^G-[A-Z0-9]{4,15}$`, GTM `^GTM-[A-Z0-9]{4,12}$`, Meta Pixel `^[0-9]{10,20}$`. Input is trimmed (also NBSP) and upper-cased; blank = `null` = off. Anything else: `INVALID_INPUT` with `{"field": …}`; nothing is saved.
- **DB:** `public.marketing_tags` (`id boolean pk default true check (id)`, `ga4_measurement_id`, `gtm_container_id`, `meta_pixel_id`, `version`, `updated_at`), one row inserted with all IDs null. RLS on; select policy `to anon, authenticated using (true)`. Grants explicit (AD-5): anon gets `select` on the three ID columns only; authenticated and service_role `select`; no write grant.
- **RPC** `admin_update_marketing_tags(p_ga4_measurement_id, p_gtm_container_id, p_meta_pixel_id, p_expected_version, p_idempotency_key)`: definer, `search_path = ''`, `is_admin()` first, `idempotent_begin/finish`, row lock, `STALE_VERSION`, normalize + check, same values change nothing; otherwise `version + 1` and `private.audit(…, 'admin_update_marketing_tags', 'marketing_tags', null, …)` before/after. Revoke from all, grant to `authenticated`.
- **Public read:** `getMarketingTags()` with `'use cache'`, `cacheTag("marketing-tags")`, `cacheLife("minutes")`, anon client, the three columns only; the action calls `updateTag("marketing-tags")` after a save. A read error or an invalid stored value yields that tool off, never a broken page.
- **Loading:** only from `app/(public)/layout.tsx`; never `/me`, `/admin`, `/login`, `/admin/login`, `/join`, `/reset`, `/offline`, `/api`. Not gated by `hasCookieAck`. IDs reach a script string only after the format check. GA4: gtag.js + `config` (its own page_view on load and on history changes). GTM: the standard container loader. Meta: the base code with `init` + `track PageView` (fbevents also tracks history changes). No other events, no `<noscript>` fallbacks.
- **Leaving the public area** (the scripts stay in the page after a client navigation): (1) a document whose first URL (`performance` navigation entry) is outside the public area never loads tags; (2) while tags are on, a capture-phase click listener turns a click on a same-origin link to `/me`, `/admin`, `/login`, `/join`, `/reset`, `/offline` or `/api` into a full page load (`location.assign`); (3) if the component unmounts on such a path anyway, the page reloads.
- **No token in the referrer** (planning session, 2026-10-28): a full load from `/join/<token>` or `/reset/<token>` to a public page would put the token in `document.referrer`, which GA (`dr`) and Meta send. Already in place (checked): `Referrer-Policy: no-referrer` in `next.config.mjs` for `/join/:path*`, `/reset/:path*` and `/login?next=/join/…`, plus `metadata.referrer` on both token pages; keep them. A new pure test in `next.config.test.ts` finds every `[token]` route under `app/` and asserts its `no-referrer` rule, so a future token route cannot miss it.
- **Screen** `/admin/marketing`, a row "שיווק" in "עוד" before "הגדרות" (`NavIcon` "marketing", lucide `MegaphoneIcon`). One `ValueChangeRow` per ID (save alone with the version read; sends the other two as saved); empty shows "כבוי". `OnlineButton` comes with `ValueChangeRow`. Client check shows the format error under the field.
- **Microcopy** (`lib/copy/admin.ts › marketingTags`): title "שיווק"; section "כלי מדידה ופרסום"; labels "מזהה Google Analytics 4", "מזהה Google Tag Manager", "מזהה הפיקסל של Meta"; change-line names "Google Analytics", "Tag Manager", "פיקסל Meta"; hints "מתחיל ב-G, למשל G-AB12CD34EF", "מתחיל ב-GTM, למשל GTM-AB12CD3", "מספרים בלבד, למשל 123456789012345"; errors "המזהה צריך להתחיל ב-G- ואחריו אותיות באנגלית ומספרים", "המזהה צריך להתחיל ב-GTM- ואחריו אותיות באנגלית ומספרים", "המזהה של הפיקסל הוא מספר של 10 עד 20 ספרות"; off "כבוי"; scope "חל על כל המבקרות באתר הציבורי, כמה דקות אחרי השמירה. לא באזור האישי ולא באדמין"; intro "מדביקים כאן רק את המזהה של כל כלי, לא קוד. שדה ריק מכבה את הכלי. נמדדות כניסות לעמודים; לחיצות באתר מגדירים בתוך Tag Manager או Meta"; privacy notice "לפני שמדביקים מזהה, צריך לעדכן את מדיניות הפרטיות: לכתוב באילו כלי מדידה ופרסום האתר משתמש ומה הם אוספים." + link "לעריכת מדיניות הפרטיות" (`/admin/content/privacy`); double-count note "אם Google Analytics מוגדר בתוך Tag Manager, משאירים את השדה של Google Analytics ריק, כדי שכל כניסה לא תיספר פעמיים". Audit action "עדכון כלי מדידה ופרסום"; fields as the labels.
- Screens start with `frontend-design`, within DESIGN.md / EXPERIENCE.md; mobile first; logical directions; IDs in `dir="ltr"` inputs.

**Never:** free code, HTML or script fields; tags in `/me`, `/admin` or token routes; custom events or a decline button; cookie-ack gating; editing the privacy policy text; a CSP change (none exists); `drop`; `demo:*`/`video:*` scripts or `*@video.example.com` data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save GA4 | " g-ab12cd34ef " | stored `G-AB12CD34EF`; public site loads gtag within minutes | — |
| Clear | "" | `null`; that tool's script gone | — |
| Bad format | `<script>`, `GTM-12 34`, `12345` (pixel) | not saved; field error | DB/RPC `INVALID_INPUT` too |
| Two tabs | save with an old version | not saved | `STALE_VERSION` message |
| All empty | dev now | no tag script on any public page | — |
| Exit by link | tags on, tap "האזור האישי" | full page load to `/login`; no tags there | — |
| Entered from `/me` | document started at `/me`, then a public page | no tags in this document | — |
| From a token page | tags on, `/join/<token>` → tap the logo (full load) | the public page's `document.referrer` is empty | `no-referrer` header + meta |
| Anon read | anon selects `version` | denied | — |
| Non-admin | customer calls the RPC | nothing changes | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261020194721_marketing_reminders.sql:176-270` -- admin RPC template (idempotency, lock, version, audit); `20261001162630_create_money_schema.sql:245` -- boolean singleton.
- `app/admin/(shell)/settings/{page,settings-editor,actions}.tsx|ts` -- page shape (`PageHeading`, `Suspense`, read with RLS), `ValueChangeRow` + `asSaveResult`, action validation (`UUID`, `validVersion`).
- `components/admin/value-change-row.tsx` -- reuse as is.
- `lib/nav.ts:42-74` (`adminMoreNav`, `NavIcon`), `components/shared/nav-icon.tsx`; `lib/nav.test.ts` checks every href has a page.
- `lib/content/business-details.ts:14` -- `'use cache'` reader pattern; `lib/supabase/public.ts`.
- `app/(public)/layout.tsx` -- add `getMarketingTags()` to `Promise.all`, render `<MarketingTags>` last.
- `lib/copy/audit-actions.ts:382` -- `{ entity: "marketing_tags", edit: true }`; `lib/copy/admin.ts:~2291` (audit actions), `~2338` (audit fields).
- No CSP or script-blocking header in `next.config.mjs` (checked); no change there.
- Tests to extend: `components/public/public-shell.test.tsx` (only the public layout renders `<MarketingTags>`), `lib/nav.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261028093236_marketing_tags.sql` -- `npx supabase migration new marketing_tags`: table, row, RLS, grants, RPC. STOP: file name to the planning session (db push, `get_advisors`), then `generate_typescript_types` -- main session applies
- [x] `supabase/tests/marketing-tags.test.ts` -- save/clear/normalize, invalid formats, stale version, idempotent retry, audit row, non-admin, anon column grant (after the planning session's go)
- [x] `lib/marketing-tags.ts` + test -- formats, `normalizeTagId`, `tagProblem`, `marketingTagsView` (invalid → off), `isPublicPath`
- [x] `lib/content/marketing-tags.ts` -- cached `getMarketingTags()`
- [x] `components/public/marketing-tags.tsx` + test -- `"use client"` scripts and the leaving-the-area rules
- [x] `app/(public)/layout.tsx` -- read and render
- [x] `next.config.test.ts` -- every `app/**/[token]` route has a `no-referrer` header rule
- [x] `app/admin/(shell)/marketing/{page.tsx,marketing-tags-editor.tsx,actions.ts}` + tests -- screen (`frontend-design`), action (shape + format, `callRpc`, `updateTag`)
- [x] `lib/nav.ts`, `components/shared/nav-icon.tsx`, `lib/copy/{admin,audit-actions}.ts` -- row, icon, copy, audit rule
- [x] `_bmad-output/specs/spec-brunch-at-tal/admin-configurable-parameters.md` -- the three IDs (Hebrew)
- [x] `tickets.toml` (E5) -- `[[entry]] id = 24` like 23, `after = [23]`, `hitl = true`, `risk = "medium"`, done in the PR
- [x] `completion-plan-2026-10-10.md` -- decision "2026-10-28, החלטת המשתמשת: סיפור חדש 5.24, לשונית שיווק" with the four decisions; 5.24 in the round 9 row (no longer deferred to 6.4/6.8)
- [x] `deferred-work.md` -- target 6.1: the `marketing_tags` row exists in production empty; Tal pastes IDs only after updating the privacy policy

**Acceptance Criteria:**
- Given an ID saved in the admin, when a private window opens the home page minutes later, then the tool's script loads, with no deploy.
- Given a 390px phone, when the marketing screen is open, then the three rows, the notice and the link fit with no sideways scroll.

## Implementation Notes

- Work only in the worktree `C:\Users\ligal\Desktop\Projects\brunch-at-tals-5-24` (`npm install` done; never `npm ci`; never stop a node process you did not start). The migration `supabase/migrations/20261028093236_marketing_tags.sql` is applied to the dev DB (planning session, db push, advisors clean) and `lib/supabase/database.types.ts` is regenerated; do not edit either. `test:db` is approved for this story's file only: `npx vitest run --project db supabase/tests/marketing-tags.test.ts`. No git commands that write.
- Browser check (planning session, 390x844, localhost:3024): screen order, format error, a saved `G-TEST1234` loads gtag on home in a clean window; after "כניסה" no requests on `/login`, `/me`, `/admin/login`, `/join/xyz`; `/join` sends `no-referrer`; IDs cleared afterwards. The intro's "לחיצות והמרות" became "לחיצות באתר" (planning session): conversions happen outside the public area, where no tag loads.

## Spec Change Log

## Review Triage Log

Pass 1 (thorough: blind, edge-case, verification-gap, intent). high 0, medium 2, low 6 routed; the rest rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| B1 | Meta base code runs `autoConfig` (button-click and metadata events) | medium | patch | `fbq('set','autoConfig',false,id)` before `init`; test |
| E1 | No navigation entry falls back to the current path, so a document that started at `/me` loads tags | medium | patch | missing entry = not public; pure `startedPublic` + tests |
| B3 | Invisible direction marks in a pasted ID are kept, so a correct ID is rejected | low | patch | `normalizeTagId` strips them (escapes); the action sends the normalized value |
| B4 | `PRIVATE_PREFIXES` not tied to the routes | low | patch | test walks `app/` outside `(public)` |
| VG1 | No test calls a row's save (other IDs as saved, version as read) | low | patch | payload test |
| VG2 | `getMarketingTags` untested (tag, columns, error = off) | low | patch | `lib/content/marketing-tags.test.ts` |
| B6 | Direct writes checked for anon only | low | patch | customer and admin `42501` in the db test |
| B15 | Row type declared twice | low | patch | editor extends the lib type |

Rejected: B2 GA enhanced measurement is a GA property setting, the code sends only `config`; B5/E8 only `[token]` folders (the spec's rule, both token routes covered); B7/E3/E4 stale draft and back-to-back saves (two tabs or a sub-second second save; `STALE_VERSION` shows and a retry works; same as the settings screen); B8/E5 a failed read cached for minutes (same as the sibling readers); B9 click/unmount wiring (full browser flow, manual check); B10, B13, B14 and the intent auditor's "המרות" wording (approved micro-copy; reported to the planning session); B11 5.23 history docs; B12 internal visits (intent: every visitor); VG4 layout render (same as 5.23; manual check); E2 non-link exits (none exist; fallback by design); E6/E7 hypothetical header sources.

## Design Notes

Why the leaving-the-area rules: GA4 and Meta record history changes on their own, so a script loaded on a public page would also report `/me` or `/join/<token>` after a client navigation. All exits from the public pages are links (checked: no `redirect` or Server Action under `app/(public)`), so (2) covers them; (1) covers the back button into a document that started outside; (3) is a fallback.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass; `npm run test:db` after the go

**Manual checks:**
- 390x844: the screen saves, clears and rejects a bad ID; with a test ID the public page requests googletagmanager.com / connect.facebook.net and `/me`, `/admin`, `/login` request none.
