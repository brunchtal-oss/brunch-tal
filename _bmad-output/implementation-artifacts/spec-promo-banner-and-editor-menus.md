---
title: 'Fixes 15 and 17: home promo banner, content editor menus'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '787cc4289fc3572ba7dd838b77619f46fd33056d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (15) Tal has no way to announce something short on the home page (e.g. "בקרוב בראנצ׳ים 60+"). (17) The content editor menus label every published page and section "פורסם" / "התוכן מופיע באתר", which is noise; only what is not on the site yet needs a marker, and the row titles are small.

**Approach:** (15) A new content kind `promo_banner` on the home page: one text field and an on/off switch, draft and publish like every other section; on the site a green strip right under the hero with on-primary text, shown only when on and not empty. (17) Drop the published chip and hint everywhere in `/admin/content`; keep "שינויים שלא פורסמו" and "טיוטה" ("לא מוצג באתר עד שיפורסם"); row titles 16px → 17px.

## Boundaries & Constraints

**Always:**
- Banner text lives only in `content_sections` (AGENTS: no marketing text in code). Zod `promoBannerSchema` in `lib/content/schema.ts`: `text: optionalText(80)`, `hidden`. The site skips a row that fails it.
- On/off is the existing section flag `hidden` (off = `hidden: true`), so publish diff, preview and `visibleSection` work with no new path. In the editor it is a switch, not the hide button.
- The "מוסתר" chip stays in the menus, also for a banner switched off (user decision 2026-10-21).
- Strip (user decision 2026-10-22, after the phone check; replaces the green 16px strip): a straight olive ribbon, `bg-primary` (#4A4A2A) with `text-primary-foreground` (#FAF6EE), 8.46:1; a dashed "stitch" line above and below the text (on-primary 55%); text in bold Rubik 700 (`--font-promo`, outside DESIGN's two families), 24px phone / 30px desktop, centred, `text-balance`, full width, 16px side gutter. Not tilted. Plain text, not a link.
- Publishing the home page updates the existing tag `content:home` (`publishTags`); no new tag.
- Micro-copy, verbatim: section title "באנר פרסומי"; text label "טקסט הבאנר (לא חובה)"; switch label "הצגת הבאנר באתר"; hint under the switch "כשהמתג כבוי או שאין טקסט, הבאנר לא מוצג".
- New and changed controls that write use the existing `OnlineButton` paths (the switch only changes form state; save/publish already use `OnlineButton`).
- Screens start with the `frontend-design` skill, inside DESIGN.md and EXPERIENCE.md.

**Never:**
- No link or button on the banner: text only in this version (user decision 2026-10-21). No change to the hero itself. No new page (fix 16 dropped).
- No change to `admin_set_content_draft` / `admin_publish_content` or to their audit entries.
- Do not edit `components/ui/` (wrap `switch.tsx` if used).
- No `demo:seed` / `demo:clear`; stop only this worktree's processes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| On, with text, published | `{text:"בקרוב בראנצ׳ים 60+", hidden:false}` | Green strip right under the hero, before the intro, on `/` and in the admin home preview | — |
| Off, published | `hidden:true` | No strip, no empty space | — |
| On, text blank | `{text:"  "}` | No strip (`hasContent` false) | — |
| Never published | `published_content` null | No strip; editor row chip "טיוטה", detail "לא מוצג באתר עד שיפורסם" | — |
| Too long | 81 chars | Field error "עד 80 תווים"; draft not saved | zod in action and form |
| Off in draft only | published on, draft `hidden:true` | Site still shows strip; row chips "שינויים שלא פורסמו" + "מוסתר" | — |
| Menus, published, no draft | any section/page | No chip; row detail = section summary, or nothing | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/<new>_home_promo_banner.sql` -- `insert into public.content_sections (page_slug,key,kind,sort_order) values ('home','promo_banner','promo_banner',1) on conflict (page_slug,key) do nothing`. Needed: `admin_set_content_draft` raises NOT_FOUND without the row (`20261004122702_content_publish.sql` L117). `kind` has no allowed-list CHECK. Sort 1 ties hero; harmless, `HomeView` picks by key.
- `lib/content/schema.ts` -- `contentSchemas` registry L350; `optionalText` L11, `hidden` L149; add `promo_banner`.
- `lib/content/visible.ts` -- `visibleSection` already drops hidden / empty blocks; no change expected.
- `components/public/page-views.tsx` -- `HomeView` L41: `sectionContent(home,"promo_banner","promo_banner")`, render after `<HomeHero>` L68.
- `components/public/promo-banner.tsx` (new) -- the strip.
- `app/admin/(shell)/content/content-items.ts` -- `EDITABLE_PAGES.home` L22: add the ref after hero. `sectionStatus` / `pageStatus` unchanged.
- `app/admin/(shell)/content/section-fields.ts` -- `sectionSpec` L181: case `promo_banner` (`hideable:true`, text 80, plus a flag that the hide control is a switch).
- `app/admin/(shell)/content/content-editor.tsx` -- hide control L513: render the switch when the spec asks; else the existing button.
- `app/admin/(shell)/content/content-status-chip.tsx` -- `CHIP` L11, `statusHint` L36: no published chip; `statusHint("published")` returns "".
- `app/admin/(shell)/content/content-row.tsx` -- title L24 `text-base` → `text-[17px]` (as fix 9's card headings); chips filtered.
- `app/admin/(shell)/content/page.tsx` L56, `[slug]/page.tsx` L65-71, `editor-page.tsx` L65-68 -- pass chips without "published"; no hint line when empty.
- `lib/copy/admin.ts` L235, L261-269 -- add `"home/promo_banner"` and `promoBanner` labels; remove `status.published`, `publishedHint`. Shared with fix 13: touch only these keys.
- Tests: `lib/content/schema.test.ts`, `visible.test.ts`, `components/public/page-views.test.tsx`, `app/admin/(shell)/content/content-items.test.ts`, `section-fields.test.ts`, `content-screens.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/` -- `npx supabase migration new home_promo_banner`, write the insert -- **main session:** tell the planning session (brunch-at-tals-72) first; user runs it in SQL Editor; main session registers it in `schema_migrations`, runs `get_advisors`, regenerates `lib/supabase/database.types.ts`.
- [x] `lib/content/schema.ts` -- `promoBannerSchema` and registry entry.
- [x] `components/public/promo-banner.tsx`, `page-views.tsx` -- the strip under the hero (`frontend-design` first).
- [x] `content-items.ts`, `section-fields.ts`, `content-editor.tsx`, `lib/copy/admin.ts` -- banner in the editor with the switch and copy above.
- [x] `content-status-chip.tsx`, `content-row.tsx`, `page.tsx`, `[slug]/page.tsx`, `editor-page.tsx`, `lib/copy/admin.ts` -- fix 17.
- [x] Tests -- matrix rows: schema (80/81, blank), `visibleSection` (off, blank), `HomeView` order (strip after hero, before intro), menus never render "פורסם" / "התוכן מופיע באתר", 17px title.
- [ ] `fixes-log.md` rows 15 and 17 -- "מצב" updated at the end (main session).

**Acceptance Criteria:**
- Given the banner switched on with text and published, when `/` loads on phone and desktop, then the ribbon is under the hero and cream-on-olive text is readable (8.46:1).
- Given the banner switched off and published, when `/` reloads, then it is gone.
- Given any page or section in `/admin/content`, when its menus render, then "פורסם" and "התוכן מופיע באתר" never appear, and "טיוטה" / "שינויים שלא פורסמו" still do.

## Verification

**Commands:**
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` -- all pass.

**Manual checks:**
- Phone and desktop: write text, switch on, publish → strip under the hero; switch off, publish → gone. Editor menus: no "פורסם", markers only on draft / unpublished changes, larger titles.

## Implementation Notes

- Migration file `supabase/migrations/20261021065232_home_promo_banner.sql` is written (insert only); applying, registering, advisors and types are still the main session's.
- The switch is a custom `role="switch"` button in `content-editor.tsx` (`ShowSwitch`, 44px row, DESIGN focus ring), not `components/ui/switch.tsx` (its 18px track and ring do not meet DESIGN). With the switch there is no "section hidden" notice; the hint under it says it.
- `statusChips(status, hidden)` in `content-status-chip.tsx` builds every menu's chips; `ChipStatus` no longer has "published".
- `sectionSummary` also reads `text`, so the banner row shows its text.

## Spec Change Log

- 2026-10-22, user at the phone check: the green 16px strip did not catch the eye. Two rounds of three mockups on the live home page (scratchpad); she chose the "ribbon" made straight. Amended the strip line in Always and the first AC. KEEP: kind, schema, switch, visibility, menus and tests are unchanged; Rubik is loaded in `app/layout.tsx` as `--font-promo` with `preload: false` (next/font cannot run under Vitest).

## Review Triage Log

Pass 1 (quick lens): high 0, medium 0, low 3, false 0, maybe-false 0.

| # | Verdict | Route | Finding / evidence |
|---|---|---|---|
| 1 | low | patch | `[slug]/page.tsx` detail is `summary \|\| statusHint`: a never-published section with saved text loses the draft hint that fix 17 keeps. Patched: draft rows show the summary and the hint. |
| 3 | low | patch | `page-views.tsx` HomeView comment line ~105 cols; re-wrapped. |

Rejected: #2 (no test for the `editor-page.tsx` header) — low; the chips and hint come from `statusChips` / `statusHint`, which are tested, and the component needs the RPC; checked in the browser instead.
