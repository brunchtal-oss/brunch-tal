---
title: 'Search-ready code, off until launch (fix-search-ready)'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'a60f932a799d3fcda00d98a7522a4c59c3c414bc'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The public site cannot be found or quoted by search and AI engines: no sitemap, no description/share tags, no canonical, one title for every session page, no structured data, an English 404, and opening it in one step would index the login and private pages.

**Approach:** Build all of it now behind one server switch, `SITE_INDEXABLE`, off by default. Off, every response stays exactly as today (robots.txt disallows all, `X-Robots-Tag: noindex, nofollow` on every path). 6.9 turns it on after the domain; nothing here turns it on.

## Boundaries & Constraints

**Always:**
- Indexable = `SITE_INDEXABLE` is `true` (trimmed, case-insensitive) AND `VERCEL_ENV === "production"`. One pure function decides it, used by `next.config.mjs` and `app/robots.ts`. Preview and local without `VERCEL_ENV=production` are never indexable.
- On: `X-Robots-Tag: noindex, nofollow` stays on `/me`, `/me/:path*`, `/admin`, `/admin/:path*`, `/login`, `/reset/:path*`, `/join/:path*`, `/offline`, `/install`, `/api/:path*`. robots.txt never disallows `/login` or `/admin/` (a blocked page cannot show its noindex).
- Pages carry `robots: { index: false, follow: false }` in both states: `/login`, `/admin/login`, `/offline`, `/install`, `app/me/layout.tsx`, `app/admin/(shell)/layout.tsx`.
- Metadata, sitemap and JSON-LD read only the public copy (`published_content`, via `lib/supabase/public.ts` or the site's existing readers), never `published_content_full` or a draft. A hidden item or section never reaches any tag (unit test: a hidden footer social link is not in `sameAs`).
- Decisions (manager, 2026-11-05): inner pages (/sessions, /how-it-works, /gallery, /contact, legal) use the site description (the hero description), no editor change; the description comes from one `pageDescription(page, site)` function, so PR B can plug in per-page descriptions; there is always a share image: the published hero photo, else `/og-default.jpg` (1200×630, food only, alt "שולחן בראנץ׳ ערוך מלמעלה"; user decision 2026-11-05, replaces "no image"); the session title uses the existing `customerCopy.sessionTitle(concept)` (dev concepts checked 2026-11-05: none starts with "בראנץ׳", so no doubling).
- No marketing text in code: descriptions, images and names come from published content, business details or the session. New microcopy (the 404 page) lives in `lib/copy/shell.ts`; the hidden H2 reuses `sections.steps`.
- Site URL: `NEXT_PUBLIC_SITE_URL` (http/https, trailing slash dropped), else `https://${VERCEL_PROJECT_PRODUCTION_URL}`, else `http://localhost:3000`. Used for `metadataBase`, sitemap URLs, robots `sitemap`, JSON-LD `url`.
- Openings: Next replaces nested `openGraph`/`twitter` objects, so a page that sets them spreads the parent's (`ResolvingMetadata`).
- JSON-LD: `JSON.stringify(data).replace(/</g, "\\u003c")`; the write tool can turn the escape into a real `<` (it happened while writing this spec), so after writing, grep the file for `u003c` (AGENTS.md hidden-char pitfall).
- The 404 page and the hidden H2 start with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. No "טל" in customer-visible text.

**Never:** turn the switch on anywhere or touch `SITE_LOCKED`; a footer link row; `error.tsx`; H1 design change; CAPTCHA; FAQPage, Event, BreadcrumbList, llms.txt, an alt-text warning, `htmlLimitedBots`, a `founder` Person, a content-editor SEO tab (all go to PR B of this round, user decision 2026-11-05); fixing the about photo file; a migration; `test:db`, `demo:*`, `video:*`; writing `.env*` files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Off (default) | `SITE_INDEXABLE` unset, any env | robots: `User-agent: *` / `Disallow: /`, no Sitemap; one header rule `/:path*` noindex, nofollow (as today) |
| On in production | `SITE_INDEXABLE=true`, `VERCEL_ENV=production` | robots: named bots + `*` allow `/`, disallow `/api/`, `Sitemap: <site>/sitemap.xml`; noindex header only on the private list |
| On in preview | `SITE_INDEXABLE=true`, `VERCEL_ENV=preview` | Same as Off |
| Odd value | `SITE_INDEXABLE=" TRUE "` / `yes` | On / Off |
| Session page | published, upcoming | title `{customerCopy.sessionTitle(concept)} · {formatSessionDate}` (+ site template), description = session description cut to ≤155 chars at a word with `…`, og image = session photo, canonical `/sessions/{id}` |
| Session without description/photo | nulls | parent description and image kept |
| Missing/started session | `getPublicSession` → null | title `sessionNotFound.title`, `robots` noindex |
| Home | hero title set / blank | `{absolute: "{name} · {hero.title}"}` / `{absolute: name}` |
| Sitemap | legal page unpublished | `/privacy`/`/terms` absent; `/accessibility` always; upcoming published sessions listed |
| JSON-LD | address blank | `Organization` instead of `LocalBusiness`; every `<` in any text becomes the six-character escape (backslash, `u003c`) |
| Unknown path | `/nope` | Hebrew 404 with links to `/` and `/sessions`, status 404 |
| `/about` | GET | 308 to `/` |

</frozen-after-approval>

## Code Map

- `next.config.mjs` -- `headers()` (one `/:path*` noindex rule, l.77-81) and `redirects()` (`/about` `permanent: false`). Keep all other rules unchanged.
- `app/robots.ts` / `app/robots.test.ts`, `next.config.test.ts` -- today: disallow all; tests lock it. Update for both states.
- `lib/site-lock.ts` -- model for env-param pure functions (`isSiteLocked(env)`); do not change.
- `lib/root-metadata.ts` (+ `app/layout.tsx` `generateMetadata`) -- only title template, appleWebApp, apple icon. Extend here.
- `lib/content/business-details.ts` -- `getBusinessDetails`, `businessNameOf` (cached, `content:global`). Fields: `business_name`, `phone`, `whatsapp_phone` (E.164), `address` (free text).
- `lib/content/pages.ts` -- `getPublishedPage("home")` (hero + `images` map: `images[hero.image.media_id].src` is an absolute Supabase URL), `getPublishedSections`, `getPublishedPageSlugs`, `getPublishedAt` (all cached, tagged `content:<slug>`, `cacheLife("minutes")`).
- `lib/content/home.ts` -- `getHomeHero()` (title, description).
- `lib/content/visible.ts` `footerLinks` + `sectionContent(site,"footer","footer")` -- visible footer links (social) for `sameAs`.
- `lib/nav.ts` -- `publicNav` (/, /sessions, /how-it-works, /gallery, /contact), `publicLegalNav`, `visibleLegalNav(slugs)` (accessibility always).
- `lib/sessions/public.ts` -- `getPublicSession(id)`, `listUpcomingPublicSessions(limit)`; uncached, anon client, `photo.photoUrl` absolute.
- `app/(public)/sessions/[id]/page.tsx` -- static `metadata` (5.16 uniform title, l.18-19) to replace; body in `<Suspense>` after `connection()`; keep `not-found.tsx` there.
- `app/(public)/page.tsx` -- home; no metadata today.
- `components/public/sections.tsx` StepsSection l.158-190 -- H2 only with a title; steps are H3. About photo l.115-124 (`sizes` stays: see Design Notes).
- `lib/copy/shell.ts` -- `public.sessionNotFound`, `sections.steps` ("איך זה עובד").
- `lib/time.ts` `formatSessionDate` ("יום שני 12.10", Israel time).
- `app/(public)/{sessions,how-it-works,gallery,contact,accessibility,privacy,terms}/page.tsx` -- static `metadata` with title only; add canonical.
- `app/(auth)/login/page.tsx`, `app/(auth)/admin/login/page.tsx`, `app/offline/page.tsx`, `app/(public)/install/page.tsx`, `app/me/layout.tsx`, `app/admin/(shell)/layout.tsx` -- add noindex. `app/(auth)/join/[token]/page.tsx:29` is the existing pattern.
- `.env.example`, `README.md` (Vercel checklist l.119+) -- add the two variables.

## Tasks & Acceptance

**Execution:**
- [x] `lib/seo/indexing.mjs` (+ `.test.ts`) -- `isIndexable(env)` and `NOINDEX_SOURCES` (the private list); JSDoc-typed so `next.config.mjs` and TS import it -- one decision, two users.
- [x] `lib/site-url.ts` (+ test) -- `siteUrl(env = process.env)` per Always -- one base for all URLs.
- [x] `next.config.mjs` -- headers: Off = today's `/:path*` rule; On = a noindex rule per `NOINDEX_SOURCES`. `/about` `permanent: true`. Update `next.config.test.ts`: both states (import the config with stubbed env, e.g. `vi.stubEnv` + `vi.resetModules`), and a 308 test.
- [x] `app/robots.ts` + test -- Off as today; On: one rule naming Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, Claude-User, ClaudeBot, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, CCBot, plus `*`, both `allow: "/"`, `disallow: "/api/"`; `sitemap`.
- [x] `lib/seo/metadata.ts` (+ test) -- `truncateDescription(text, 155)`; `sessionPageTitle(concept, startsAt)` = `customerCopy.sessionTitle(concept)` + " · " + `formatSessionDate`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- two entries: (1) the six skill signals (FAQPage, Event, llms.txt, alt-text warning, `htmlLimitedBots`, founder), one line each, target "6.9: לבדוק בביקורת seo-geo-aeo על האתר החי"; (2) the about photo is a 2.5 MB PNG saved as `.jpg`: check why the upload pipeline did not compress it, target "לא נקבע".
- [x] `lib/root-metadata.ts`, `app/layout.tsx` -- add `metadataBase`, `description` (hero description), `openGraph` (`type: "website"`, `locale: "he_IL"`, `siteName`, description, hero image when published), `twitter: { card: "summary_large_image" }`. Update its test if any.
- [x] `app/(public)/page.tsx` -- `generateMetadata`: absolute title, canonical `/`; render `<JsonLd>`.
- [x] `lib/seo/structured-data.ts` (+ test), `components/public/json-ld.tsx` -- pure builder: `@graph` of `LocalBusiness` (or `Organization`) {name, url, telephone = phone ?? whatsapp_phone, address, image, description, sameAs} and `WebSite` {name, url}; omit empty fields; tests cover escape, blank address, hidden footer link absent.
- [x] `app/(public)/sessions/[id]/page.tsx` -- `generateMetadata({params}, parent)`: `await connection()`, read via a React `cache()` wrapper shared with the body; per matrix.
- [x] Other public pages -- `alternates: { canonical: "<path>" }`.
- [x] Private pages/layouts listed in Always -- `robots` noindex.
- [x] `app/sitemap.ts` (+ test of a pure `buildSitemap` in `lib/seo/sitemap.ts`) -- entries per matrix; `lastModified` from `getPublishedAt(slug)` (home→`home`, others by their slug; `/sessions` none); sessions read in a `"use cache"` function with `cacheLife("minutes")` (ids and start only). No /install, /offline, auth, token, /me, /admin.
- [x] `app/not-found.tsx`, `lib/copy/shell.ts` -- frontend-design first. Hebrew H1, one line, links "לדף הבית" and "למפגשים"; style like `sessions/[id]/not-found.tsx`; metadata title.
- [x] `components/public/sections.tsx` -- StepsSection without title: `<h2 className="sr-only">` with the existing `label`, used as the section's name.
- [x] `.env.example`, `README.md` -- `SITE_INDEXABLE` (server only, off until 6.9, redeploy after change), `NEXT_PUBLIC_SITE_URL` (final domain at handover).

**Acceptance Criteria:**
- Given Off, when building, then `robots.txt` and every header equal today's output byte for byte.
- Given On in production, when `/me` or `/admin/sessions` is requested, then it carries both the noindex header and the noindex meta.
- Given any public page, when its HTML is read, then it has a canonical link and og/twitter tags with absolute URLs.
- Given the home page, then exactly one H1 (unchanged) and one `application/ld+json` script.
- Given `/how-it-works` with an untitled steps section, then the heading order is H1, H2, H3.

## Implementation Notes

## Spec Change Log

- 2026-11-05, user decisions relayed by the manager after the spec gate (they override the gate answers). (1) The round splits in two PRs: this is PR A (infrastructure); PR B adds an SEO tab to the content editor (per-page title, description, share image, H1, H2/H3 outline with edit links) and the six skill signals. (2) Description: every page uses the site description now, through one `pageDescription` function that PR B replaces. (3) Always a share image: hero photo, else `public/og-default.jpg` (copied from the user's file; food only, no people, no EXIF/GPS; 1200×630, 253 KB). (4) The six-signal entry in deferred-work now targets PR B. Avoids: pages without a share image in WhatsApp previews, and a description wired per page twice. KEEP: everything else as approved; review patches of pass 1 stand, except the "summary card without image" patch, now moot.

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap, intent-alignment; 2026-11-05). Verdicts: 0 high, 3 medium, 6 low patched, 1 deferred, 11 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Session `generateMetadata` untested; spread of resolved parent og/twitter may carry the root's title; no `og:url` | medium | patch | Pure `sessionMetadata` + tests of the 3 matrix rows; explicit og/twitter title and og:url |
| 2 | `getSiteSeo` and home absolute title untested; `SiteSeo.details` unused | medium | patch | Pure `siteSeoFrom` / `homeTitle` + tests; unused field removed |
| 3 | Sitemap: `catch` inside `"use cache"` caches `[]` after a transient error | medium | patch | Cache only the successful read; catch outside |
| 4 | Sitemap uses the default limit 100 | low | patch | Explicit higher limit |
| 5 | `twitter.card` large-image with no image | low | patch | `summary` without an image |
| 6 | `noindexRules` comment says env is read at config load | low | patch | Wording |
| 7 | Nothing says to set `NEXT_PUBLIC_SITE_URL` before turning the switch on | low | patch | One README line |
| 8 | Noindex `metadata` exports on private pages/layouts have no test | low | defer | Header still covers them; check the meta on the live site in 6.9 |

Rejected: training crawlers allowed (user decision 2026-11-04, all AI tools); root 404 also on /me and /admin (manager approved; standalone page, no public shell, links home); hidden H2 near the H1 (correct outline, intended); `/about` 308, live 404, metadata and JSON-LD while Off (user's item list; intent's "as today" is robots.txt and X-Robots-Tag, frozen parenthesis); build-safety comment (`getPublishedPageSlugs` returns [] on error, so true); grep check weak (fix edits the spec); surrogate split and bare "…" in `truncateDescription` (only a single space-less word at the cut, unlikely); `NEXT_PUBLIC_SITE_URL` with a path (unsupported config, not plausible).

## Design Notes

- Docs checked in context7 (`/vercel/next.js/v16.2.9`, latest there; installed 16.4.x — also check `node_modules/next/dist/docs` when present): `generate-metadata.mdx` (merging, metadataBase, Cache Components: uncached `generateMetadata` defers with the page; a page that is otherwise static plus runtime metadata errors), `metadata/robots.mdx` (per-agent rules, `sitemap`), `metadata/sitemap.mdx` (special route handler, cached by default), `guides/json-ld.mdx` (native `<script>`, escape every `<` as `u003c` with a backslash), `file-conventions/not-found.mdx` (root `app/not-found` catches unmatched URLs; `global-not-found` not used).
- robots.ts and headers read env at build: on Vercel `VERCEL_ENV` exists at build, so a switch change needs a redeploy (README).
- About photo (item 12): the published about › main photo in dev is 1672×941, landscape. Not portrait, so `sizes` stays. Side note: the file is a 2.5 MB PNG saved as `.jpg`.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` -- all pass.
- `grep -c 'u003c' components/public/json-ld.tsx lib/seo/structured-data.ts` -- ≥1, and `npm test` invisible-chars passes.

**Manual checks (manager, local dev server):**
- Off: `npm run dev`. On: `SITE_INDEXABLE=true VERCEL_ENV=production SITE_LOCKED=false` in the dev server's env. Check `/robots.txt`, `/sitemap.xml`, headers (`curl -I`) of `/`, `/sessions`, `/login`, `/me`, `/admin`; meta of `/` and one session page; `/nope`; `/about` → 308.
