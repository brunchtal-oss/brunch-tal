---
title: 'SEO tab in the content editor and six search signals (fix-seo-editor, PR B of fix-search-ready)'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'dc1d5191e149c9b1189d8a6b2bdcad32165051b0'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-fix-search-ready.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR A (#150) built the search infrastructure with fixed H1s, one site description and one share image chain. Tal cannot set a page's heading, Google title, description or share image, cannot see a page's heading outline, and six search signals were left out.

**Approach:** An "SEO" page in the content editor (same draft, save and publish flow) holding one record per public page plus a site-wide share image. The site reads these from published content, with today's texts as the seeded values and as the code fallback, so nothing on the site changes until Tal edits. Add FAQPage, Event, llms.txt, an alt-text warning and `htmlLimitedBots` (only if verified).

## Boundaries & Constraints

**Gate decisions (2026-11-05):** (1) Share image: upload only in this PR, through the existing `ImageInput`; the SEO image field takes its image control through one prop/slot, so a later "pick from uploaded images" screen (its own story, for every image field) plugs in without changing the SEO code. (2) Home H1 is seeded with the published business name and is independent afterwards (user). (3) The alt warning is in the content editor only, including the SEO tab (manager). (4) No `founder` (user). (5) No extra SEO field (manager).

**Always:**
- Storage: a new content page slug `seo`, sections `site` (kind `seo_site`: `image`) and one per public page (kind `page_seo`), keys `home`, `sessions`, `how_it_works`, `gallery`, `contact`, `privacy`, `terms`, `accessibility`. `page_seo` = `{ h1: required, ≤80; title?: ≤70; description?: ≤300; image?: imageSchema }`. The image sits at `$.image` (the only path the publish, hide-unused and resolve code sees).
- Migration (`npx supabase migration new seo_content`): insert the page and the nine sections with `on conflict do nothing`, draft = published = full copy, seeded with today's H1 texts (`shellCopy.nav.*`, `footer.*`; home = the published business name, else WORDMARK). Pattern: `20261028090046_cookie_notice.sql`. No schema change, no drop. The manager applies it on dev; I never apply it.
- Reads: `getPublishedPage("seo")` (cached, tag `content:seo`); `publishTags("seo")` = `content:seo`. Only `published_content`. A missing or invalid record falls back to today's code value per field.
- Chains: H1 = record h1, else today's text. Title = record title (absolute), else today's (inner: H1 + template; home: `homeTitle(name, heroTitle)`). Description = record description, else the site description (`pageDescription` reads the record). Share image = record image, else `site.image`, else the hero photo, else `/og-default.jpg`.
- Soft warnings only (never block save/publish): title over 60, description over 155, an image with no alt (every image field of the content editor). Counter and a Google-style preview (title, URL from `siteUrl()` + path, description) on each SEO record.
- Outline: a pure `pageOutline(pageId, sections)` in `lib/seo/outline.ts` returns H2/H3 as the site renders them: content headings link to `/admin/content/<editorPage>/<key>#field-<path>`, microcopy headings (e.g. "הבראנצ׳ים הקרובים", hidden steps H2, a11y contact H2) show without a link; `/sessions` rows show one line "שמות המפגשים, אוטומטי". A test renders fixtures and asserts the outline equals the rendered headings for every page.
- Event and llms.txt use only sessions the public site shows, through the same public read (`getPublicSession` / `listUpcomingPublicSessions`: published, not started; never a draft or hidden one). A cancelled or past session has no public page (it is `notFound()`), so it gets no Event at all; `eventStatus` is always `EventScheduled` (the simpler option, manager 2026-11-05). llms.txt lists upcoming sessions only.
- The outline leaves out a content heading that is empty or hidden on the site, so it matches the rendered headings exactly.
- Sessions: not in the tab; one explanatory line there. Their title/description/canonical stay automatic.
- FAQPage (`/how-it-works`): only visible items with both question and answer. Event (`/sessions/[id]`): only what the page shows: name, `startDate` with the Israel offset, `eventStatus` scheduled, offline attendance, `location` Place (business name + published address, shown in the footer), image, description, `offers` (decimal price, ILS) only when a display price is set; never capacity or availability. llms.txt: 404 unless `isIndexable`; H1 name, site description, pages with their descriptions, upcoming sessions (concept, date and time, price, absolute link), policies; section labels in `lib/copy`; `text/plain; charset=utf-8`; escape Markdown structure in content.
- `htmlLimitedBots`: default regex of the installed Next (copied from `node_modules/next/dist/shared/lib/router/utils/html-bots.js`) plus `GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|CCBot`; a unit test asserts it contains the installed default. Keep it only if `curl -A "GPTBot/1.2"` on a local `next start` session page shows the session H1 inside `<main>` before any `<div hidden id="S:`; else remove and log in Implementation Notes.
- JSON-LD via `jsonLdString` (escape every `<`; grep `u003c` after writing). The screens start with `frontend-design`, within DESIGN.md and EXPERIENCE.md. No "טל" in customer-visible text.

**Never:** a media picker or a list-media RPC (separate story); `founder`; the alt warning in the concept or session editors; apply a migration, run `test:db` without the manager's go, `demo:*`, `video:*`; a footer link row; llms-full.txt or `.md` twins; Review/AggregateRating; capacity, availability, kind or payment/arrival instructions in any tag or file; any mention of an external report, its path or finding ids.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Untouched | seeded records | Site HTML equal to before (H1, title, description, image) |
| H1 edited | gallery h1 "גלריה" published | H1 and title "גלריה · {name}" |
| Google title | contact title set | `<title>` = it, absolute |
| Home, empty title | — | `homeTitle(name, heroTitle)` as today |
| Description | gallery set / empty | it / site description |
| Share image chain | none / site only / page | hero or og-default / site / page |
| Record missing or invalid | `seo` not published | code fallback, no error |
| Draft only | h1 saved, not published | site unchanged |
| Long title | 72 chars | warning text, save allowed |
| Image no alt | any editor image | warning text, save allowed |
| FAQ | hidden item / no answer | left out of FAQPage |
| Event | no display price / no address | no `offers` / Place with name only |
| llms.txt | switch off / on | 404 / text |
| Session state | draft, hidden, cancelled, started | no Event (page is not found), not in llms.txt |
| Outline | section title empty, or section/item hidden | heading absent from the outline, as on the site |

</frozen-after-approval>

## Code Map

- `app/admin/(shell)/content/content-items.ts` -- `EDITABLE_PAGES` (:23), `EDITABLE_SLUGS` (:72), `publishTags` (:137), `findSectionRef`, `editorPageOf`, `schemaForSection` (:257). Add `seo`.
- `app/admin/(shell)/content/section-fields.ts` -- `sectionSpec(ref)` (:184) per kind; `image(...)` field; `fieldId(path)` (:691) for anchors; `fromContent`/`toContent`.
- `app/admin/(shell)/content/content-editor.tsx` -- renders specs; `ImageInput` (:731) over `components/admin/image-upload-field.tsx` (upload only; no media picker exists).
- `app/admin/(shell)/content/actions.ts` -- save (`admin_set_content_draft`, :60), publish (:128: parse drafts, `publishMedia`, `admin_publish_content`, `updateTag`). Reuse unchanged.
- `app/admin/(shell)/content/page.tsx`, `[slug]/page.tsx` -- editor lists; titles from `adminCopy.content`.
- `lib/content/schema.ts` -- add `pageSeoSchema`, `seoSiteSchema` to `contentSchemas`; `imageSchema` (:85).
- `lib/content/visible.ts` -- `visibleSection`, `visibleImages` (:124); decide `ALWAYS_FILLED` for the new kinds.
- `lib/content/pages.ts` -- `getPublishedPage`, `sectionContent`.
- `lib/seo/metadata.ts` -- `pageDescription` (:171, the plug-in point), `shareImage`, `siteSeoFrom`, `homeTitle`, `sessionMetadata`; `lib/seo/site-seo.ts`; `lib/root-metadata.ts`.
- `lib/seo/structured-data.ts` -- `buildStructuredData`, `jsonLdString`; `components/public/json-ld.tsx`.
- H1 sites: `components/public/home-hero.tsx:53,78`, `components/public/public-page.tsx` (`PublicPageHeading`), `components/public/page-views.tsx:124,147,181`, `components/public/legal-views.tsx:90,123`, `app/(public)/sessions/page.tsx:15-30`; titles in each `app/(public)/*/page.tsx`.
- Headings for the outline: `components/public/sections.tsx` (text blocks :51-78, steps :167-187, faq :212-256, gallery/testimonials :328-362), `upcoming-sessions.tsx:45`, `legal-text.tsx` ("## " lines), `legal-views.tsx:67`.
- `components/public/public-sessions.tsx` `PublicSessionView` (:117) -- shows photo, H1, date with time, display price, description; no address.
- `lib/time.ts`, `lib/money.ts` -- Israel time and agorot; add an integer-only decimal formatter for `offers.price`.
- `next.config.mjs` -- add `htmlLimitedBots`; `lib/seo/indexing.mjs` `isIndexable`.
- Migration pattern: `supabase/migrations/20261028090046_cookie_notice.sql`. Slug/key/kind regex checks only (`20261001201839_create_join_flow.sql:94,115`); RPCs have no allow-list.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261105211006_seo_content.sql` -- seed per Always -- manager applies; then `get_advisors` and `generate_typescript_types` (manager). (File written; not applied.)
- [x] `lib/content/schema.ts` (+ test) -- the two schemas.
- [x] `lib/seo/page-seo.ts` (+ test) -- `getPageSeo()` (cached) and pure resolvers for H1, title, description, image per Always.
- [x] Public pages and `home-hero.tsx`, `PublicPageHeading` callers, `legal-views.tsx` -- H1 and metadata from the resolvers; `lib/root-metadata.ts`/`app/layout.tsx` share-image chain; `pageDescription` reads the record.
- [x] `content-items.ts`, `section-fields.ts`, `content-editor.tsx`, `lib/copy/admin.ts` -- frontend-design first; the SEO editor page: site row, eight page rows, sessions line; per record: fields, counters, Google preview, outline with edit links; soft alt warning on every image field.
- [x] `lib/seo/outline.ts` (+ test against rendered fixtures).
- [x] `lib/seo/structured-data.ts` (+ test), `/how-it-works` and `/sessions/[id]` pages -- FAQPage, Event.
- [x] `app/llms.txt/route.ts`, `lib/seo/llms.ts` (+ test), `lib/copy/shell.ts`.
- [x] `next.config.mjs` (+ test) -- `htmlLimitedBots`, verified as in Always.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- close the six-signal entry: what was built, `founder` closed without building (user decision 2026-11-05), `htmlLimitedBots` per its verification.

**Acceptance Criteria:**
- Given the seeded records, when any public page is rendered, then H1, title, description and og image equal PR A's output.
- Given an SEO record published, when the page is requested, then the change shows after `content:seo` is updated, with no redeploy.
- Given an editor link in the outline, when clicked, then the section's editor opens at that field.
- Given the switch off, then robots.txt, headers and llms.txt (404) behave as in PR A.

## Implementation Notes

- Migration `20261105211006_seo_content.sql` is written, not applied (manager: apply on dev, then `get_advisors`, `generate_typescript_types`). No schema change, so the types should not change. `lib/seo/page-seo.test.ts` checks the seed's H1s against `DEFAULT_H1` and `WORDMARK`.
- `htmlLimitedBots` kept: on a local `next start` (port 3107, `SITE_LOCKED=false`), `curl -A "GPTBot/1.2"` on a session page returned the H1 inside `<main>`, the `<title>` in `<head>`, the Event JSON-LD, and no `<div hidden id="S:`; a browser UA still streams.
- Image control slot: `ImageInput` in `content-editor.tsx` takes `control` (`ImageControlProps`), default `UploadImageControl`; a future picker replaces it there. The alt warning is a new optional `altWarning` prop of `ImageUploadField`, passed only by the content editor.
- Outline input is the admin's full published rows (indices of hidden items kept, so `#field-items-<i>-title` matches the editor), page skipped while unpublished. Home's "הבראנצ׳ים הקרובים" and the automatic session line appear only when `listUpcomingPublicSessions(1)` finds one; home › contact only with a usable WhatsApp number. The site-wide cookie notice H2 (layout) is not part of any page's outline.
- llms.txt lists a page's description only when it differs from the site description (already the file's quote line), to avoid eight repeats.
- The admin preview (`[slug]/preview`) shows the published SEO H1s; `/admin/content/seo/preview` is notFound and the SEO editor has no preview button.
- `lib/marketing-tags.test.ts` skips dotted app dirs (`llms.txt` is a file route, not a document).

## Spec Change Log

- 2026-11-05, user decisions after her check of the editor (relayed by the manager); microcopy and order only, no behavior change. (1) Each SEO field label keeps its Hebrew text and adds the professional term in English, LTR, small and secondary, as part of the same label (read by screen readers; one label per field): "הכותרת הראשית של העמוד" + H1, "כותרת בגוגל (לא חובה)" + Title tag, "תיאור בגוגל (לא חובה)" + Meta description, "תמונת שיתוף לעמוד (לא חובה)" + og:image, "תמונת שיתוף לכל האתר" (site record) + og:image. The outline keeps its H2/H3 as is. LTR through `dir="ltr"` on an element, never a direction character. (2) The editor page is named "SEO" everywhere (title, content list row, back link, any mention), placed in the content list below the footer and above the privacy policy. KEEP: everything else.

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap, intent-alignment; 2026-11-05). Verdicts: 0 high, 3 medium, 5 low patched, 1 deferred, 7 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | og:title/og:url/twitter:title only when the record has a description or image | medium | patch | Always build the page's share tags; "title only" test |
| 2 | llms.txt route untested (404 off, header, policy filter, dedupe) | medium | patch | `app/llms.txt/route.test.ts`; short `s-maxage` |
| 3 | Outline edit links never checked against real editor fields | medium | patch | Property test over `EDITABLE_PAGES`/`sectionSpec`/`fieldId`; outline calls `fieldId` |
| 4 | `/sessions` outline shows the automatic H2 with no upcoming sessions | low | patch | Pass the sessions flag; omit the line |
| 5 | Event `name` is the bare concept; no `organizer` | low | patch | `customerCopy.sessionTitle`; organizer = business |
| 6 | "No preview" assertion cannot fail | low | patch | Pure `previewHref` helper + test |
| 7 | Google title hint does not say it replaces the business name | low | patch | One sentence in `lib/copy/admin.ts` |
| 8 | `seoExtras` (rows to outline, preview context) untested | low | defer | Admin guidance only; needs a pure extraction first |

Rejected: home H1 frozen at the seed and required (gate decision 2, user: seeded then independent; 6.1 copies content rows); llms.txt lists how-it-works/gallery/contact before they are published (same rule as the sitemap and the menu); home JSON-LD uses the site values (it describes the business, not the page); Event `addressLocality` (the address is one free-text field); outline item index after a draft reorder (the outline shows the published page, by design); preview dropped for `seo` and sessions not in the tab (spec decisions); `htmlLimitedBots` verified by one manual curl (as the spec requires).

## Design Notes

- One `seo` page instead of a section per page slug: publishing an SEO change must not publish pending drafts of the page's own content (publish is per slug), and one tag (`content:seo`) refreshes all metadata.
- Seeding today's texts in both the DB and the code fallback makes the change invisible until Tal edits, and keeps production safe before the migration reaches it.
- Docs to check in the installed `node_modules/next/dist/docs` before writing: `htmlLimitedBots.md`, `generate-metadata.md` (streaming metadata), route handlers (for llms.txt), `json-ld` guide. Skill seo-geo-aeo step 3: title 50-60, description 150-160, FAQ answers in the HTML, Event and FAQPage fields.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` -- all pass; invisible-chars test passes; `grep -c u003c lib/seo/structured-data.ts` ≥ 1.

**Manual checks (manager, local dev server, after the migration on dev):**
- Every public page looks the same before any edit; edit and publish one record per field and see it on the site; outline links; warnings; llms.txt in both switch states; `curl -A "GPTBot/1.2"` result for htmlLimitedBots.
