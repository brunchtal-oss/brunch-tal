---
title: 'Fix: close two public reads (hidden content item, archived concept)'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
baseline_commit: 'a6d6af6a9bbe2e1b0063cac558ace91aa4ee4902'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (PC8) A hidden item inside a published section (testimonial, gallery photo, FAQ, footer link) and a hidden section's whole content (dev: home `promo_banner` `{"text": "בקרוב! בראנץ' 60+", "hidden": true}`) are readable by anon and every user through the API, because `content_sections_public_select` filters rows, not JSON items. Source doc line 417 and spec 5.3:41: "תוכן מוסתר אינו דולף לנתיב ציבורי". (SC5) `concepts_public_select` is `using (true)`, so archived concepts are readable "גם בפנייה ישירה ל-API". Origin: deferred-work `fix-public-read-leaks`; spec-6.7 gate decision 1.

**Approach:** PC8: `published_content` becomes the public copy without hidden content; the full published content moves to a new column `published_content_full` with no anon/authenticated grant, which only definer RPCs read. A `before insert or update` trigger derives `published_content` from `published_content_full` on every write, so the public column can never hold hidden content whoever writes it. `admin_get_content_page` returns the full copy under the same `published_content` key, so the editor, the "שינויים שלא פורסמו" chip, the preview and "חזרה למה שמוצג באתר" are unchanged with no app code change. SC5: `alter policy` + one new admin select policy.

## Boundaries & Constraints

**Always:** no `drop` of any kind (`alter policy`, `create or replace`, `create policy`, `add column`); new private functions `set search_path = ''`, `revoke execute ... from public, anon, authenticated, service_role`, no grant; definer RPC rules unchanged (admin check first line); strip rule identical to `lib/content/visible.ts`: section `hidden === true` → `{"hidden": true}`; otherwise every element of `items` with `hidden === true` removed, order kept; anything else unchanged; site and admin keep working at every moment between migration and merge (no app read path changes); tests per `supabase/tests/support/db.ts` (`inRollback`, `asAuthenticated`, `testName`, `onCleanup`); test sections reset inside the transaction (copy `inCleanHome` pattern).

**Never:** change copy, design or editor behavior; touch `.env*`, Vercel, `demo:*`, `video:*`, `*@video.example.com`, dev-customer, dev-admin, "בדיקה 6.6"/"בדיקה 6.7" customers, or real dev site content outside the migration backfill; run the migration on dev or `test:db` without planning session 4's go; git; remove the post-join fields from the product editor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish list with hidden item | draft `items:[A, B{hidden:true}]`, `admin_publish_content` | anon/customer read `items:[A]`; admin RPC `published_content` = draft (chip "published") | — |
| Hidden section published | draft `{text:"x", hidden:true}` | anon/customer read `{"hidden": true}` | site shows nothing (as today) |
| Direct write (tests, seed scripts) | `update ... set published_content = <full>` | full stored in `published_content_full`, stripped in `published_content` | — |
| Unrelated update | `update ... set draft_content = ...` | both published columns unchanged | — |
| Unpublish reset | `set published_content = null` | both null | — |
| Anon/customer reads full column | `select published_content_full` | — | 42501 permission denied |
| Republish, nothing changed | draft = full, hidden item present | `changed: 0` | — |
| Hidden item with an image | publish with item hidden; then unhide, copy (begin → finish, as in `media.test.ts`), publish | image `hidden` (not deleted) after the first publish; `published` after the second | — |
| Strip rule = site rule | every kind in `lib/content/schema.ts` with `hidden` (each list kind with hidden/visible items, a whole hidden section, `promo_banner` on/off) | `visibleSection(public_content(x))` deep-equals `visibleSection(x)`, and no `hidden: true` element left in `public_content(x).items` | — |
| Archived concept, no non-draft event | anon / customer | 0 rows | — |
| Archived concept, only a draft event | anon / customer | 0 rows | — |
| Archived concept, published/completed/cancelled event | anon / customer, also `events → concepts(name)` embed | name readable | — |
| Archived concept | admin (authenticated) | readable | — |

</frozen-after-approval>

## Spec-gate additions (planning session 4, 2026-10-31)

1. `content_sections` grants are per column (anon, authenticated: id, key, kind, page_slug, published_at, published_content, sort_order; verified on dev), so the new column is unreadable to them by construction; the 42501 test stays.
2. `private.used_media_ids` (used by `hide_unused_media`) reads `visible_media_ids(published_content)` and `not hidden`; it already skips hidden content, so its result does not change and it is not modified. Covered by the hidden-item-with-image matrix row.
3. The strip-rule-equals-site-rule matrix row guards against `private.public_content` and `visible.ts` drifting apart; the direct-write row (only `published_content` written → full gets the value, public is derived) stays.

## Code Map

- Live defs (verified 2026-10-31 via `pg_get_functiondef`/`pg_policies`): `admin_publish_content(text,uuid)` compares `s.draft_content is distinct from s.published_content` twice (the `MEDIA_NOT_COPIED` exists and the loop) and sets `published_content = draft_content`; `admin_get_content_page(text)` returns `'published_content', s.published_content`; `private.used_media_ids()` reads `published_content` (stripped gives the same ids: `visible_media_ids` already skips hidden) -- leave it.
- Column grants: anon/authenticated select only id, key, kind, page_slug, published_at, published_content, sort_order (`20261001201839_create_join_flow.sql:145`, all revoked from service_role). New column gets no grant → `EXPECTED_GRANTS` in `grants.test.ts` unchanged.
- `private.is_admin()` is executable by authenticated only (not anon), so it cannot go in a policy for anon: SC5 admin access is a separate `concepts_admin_select` policy `to authenticated`. `events` policies: anon `status <> 'draft'`, authenticated same `or is_admin` (no reference to concepts, no recursion); index `events_concept_id_idx` exists.
- Site reads `published_content` with the anon client: `lib/content/pages.ts:54,168`, `home.ts:18`, `business-details.ts:21`, `join-form.ts:17` -- no change. Concept reads: embeds from events (`lib/sessions/public.ts:25`, `app/me/sessions/load-sessions.ts:23`, `app/me/purchases/[id]/page.tsx:91`, `app/me/load-entitlements.ts:34`), admin direct (`app/admin/(shell)/concepts/page.tsx:53`, `[id]/page.tsx:44`, `sessions/new/page.tsx:39`) -- no change.
- Admin editor reads only through `admin_get_content_page` (`actions.ts:32 readPage`; `content-items.ts:189 hasPendingDraft`, `:243 editorContent`; `actions.ts:117` discard; `preview/page.tsx:93`) -- no change.
- `scripts/dev-clean-media-drafts.mjs:51` strpos over `published_content` -- add `published_content_full`.
- Test patterns: `content-publish.test.ts` (`inCleanHome`, `PUBLISH`, `anonHero`), `media.test.ts` (`SET_DRAFT`, `cleanGallery`), `concepts-admin.test.ts:380-410` (archive), `events-admin.test.ts:120-130` (create event).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_close_public_read_leaks.sql` (via `npx supabase migration new close_public_read_leaks`) -- (1) `private.public_content(jsonb) returns jsonb` immutable SQL, the strip rule; (2) `alter table public.content_sections add column published_content_full jsonb`; (3) `private.content_sections_public_copy()` trigger fn + `create trigger content_sections_public_copy before insert or update`: on insert, full := coalesce(full, published_content); on update, if full unchanged and `published_content` distinct from old → full := new.published_content; always `published_content := private.public_content(full)`; (4) backfill `update public.content_sections set published_content_full = published_content where published_content is not null`; (5) `create or replace admin_publish_content`: both comparisons against `published_content_full`, `set published_content_full = draft_content` (rest verbatim from live def); (6) `create or replace admin_get_content_page`: `'published_content', s.published_content_full`; (7) `alter policy concepts_public_select ... using (archived_at is null or exists (select 1 from public.events e where e.concept_id = concepts.id and e.status <> 'draft'))`; (8) `create policy concepts_admin_select on public.concepts for select to authenticated using ((select private.is_admin()))`; comments in English -- **session main: planning session 4 applies it on dev after "go"**.
- [x] `lib/supabase/database.types.ts` -- regenerate (`generate_typescript_types`) after the migration.
- [x] `supabase/tests/acceptance-public-reads.test.ts` -- T11: matrix rows 1–9 (the strip-rule row calls `private.public_content` as postgres and imports `visibleSection` from `lib/content/visible.ts`; as admin via `admin_set_content_draft` + `admin_publish_content` on a reset section; read as anon and as a customer via `asAuthenticated`; admin RPC `published_content` deep-equals the draft); includes the hidden promo banner case. T18: matrix rows 10–13 with a `testName` concept archived, events created per case.
- [x] `scripts/dev-clean-media-drafts.mjs` -- add `or strpos(coalesce(s.published_content_full::text, ''), m.id::text) > 0`.
- [x] Deliberate break (not committed): inside a rolled-back transaction, (a) `alter policy concepts_public_select using (true)` → T18 must fail; (b) `alter table ... disable trigger content_sections_public_copy` + `update set published_content = published_content_full` → T11 must fail. Then confirm live defs equal the migration's (`pg_policies`, `pg_get_functiondef`, `pg_trigger`).
- [x] `_bmad-output/specs/spec-brunch-at-tal/data-model.md:46` -- add `published_content_full` (Hebrew, one clause: התוכן המלא שפורסם, לאדמין בלבד; `published_content` הוא העותק הציבורי בלי מוסתרים).
- [x] `_bmad-output/implementation-artifacts/acceptance-report-6-7.md` -- PC8 (:173) and SC5 (:201) → עובר with T11/T18 refs; rows :100, :124; summary line :223.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md:834` -- status סגור with PR number (planning session gives it); add a 6.1 note: the content copy to prod copies `draft_content` and `published_content_full` (the trigger derives the public copy), never only `published_content`.

**Acceptance Criteria:**
- Given the migration ran on dev, when anon reads `home/promo_banner`, then it gets `{"hidden": true}` and the banner text is only in `published_content_full`.
- Given the migration ran and before the merge, when the old deployed site and admin load, then every page and the content editor chips render exactly as before.
- Given `get_advisors`, then only WARN 0029 and leaked-password remain.
- Given the full `test:db` run (planning session), then `grants.test.ts`, `content.test.ts`, `content-publish.test.ts`, `media.test.ts`, `concepts-admin.test.ts`, `acceptance-content-values.test.ts` and the new file pass, and the dry-run cleanup finds no `test_` row.

## Implementation Notes

- `private.public_content` filters items with `where (t.i -> 'hidden') is distinct from 'true'::jsonb` instead of the Design Notes' `where not (jsonb_typeof(i) = 'object' and i->'hidden' = 'true'::jsonb)`: for an item without `hidden` the latter is `not null` = null, which would drop every visible item. Same rule otherwise (`->` on a non-object is null, so it is kept).
- T18's embed is a scalar subquery (`select (select c.name ...) from events e`), equivalent to the PostgREST left join; the `left join` text trips the RTL lint rule.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-31; blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Verdicts: high 0, medium 2, low 5 (kept), false 4, rejected low 6.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Two permissive SELECT policies on `concepts` for authenticated | medium | patch | Performance advisor WARN `multiple_permissive_policies` (new). Second migration: one policy per role (`concepts_anon_select`, `concepts_authenticated_select`), as on `events`. |
| 2 | A data migration that rewrites `published_content` from itself loses hidden content for good | medium | patch + defer | Trigger `elsif` turns the stripped write into the full copy. Column comment and data-model.md rule (patch); AGENTS.md pitfall deferred (agent-context file). |
| 3 | Trigger insert path and both-columns update untested | low | patch | All T11 writes were updates. Tests added: insert with only `published_content`, with only `published_content_full`, update of both. |
| 4 | `asAnon` keeps a previous `request.jwt.claim.sub` | low | patch | Clears `claim.sub`. |
| 5 | `published_content_full` has no audit field label | low | patch | Label "תוכן מלא שפורסם" + `audit-data.test.ts` list. |
| 6 | Archived concept's default image stays in `media-public` | low | defer | Pre-existing (`used_media_ids` counts every concept image); intent covers the row through the API. |

Rejected: deliberate-break procedure unworkable (false: run inside each test's own transaction, function body replaced not trigger disabled; T18 1 and T11 4 failed as expected); acceptance report missing (false: pending task); `audit_log` reads full copy (false: admin-only policy); all-hidden list keeps its title, strip ignores kind for non-hideable kinds, parity test skips zod parse, write equal to the current public copy ignored, no object check on the full column, tests use SQL roles not PostgREST (low, unreachable through the editor or already guarded by the derived column's check); Design Notes snippet bug (fix edits this spec; recorded in Implementation Notes).

## Design Notes

Why not strip `published_content` only in the RPC (option a): the editor falls back to `published_content` when there is no draft and "חזרה למה שמוצג באתר" copies it into the draft, so hidden items would vanish from Tal's editor; the column swap through `admin_get_content_page` avoids that. Why not a new public column (option b): the deployed site reads `published_content`, so revoking it breaks every public page until the merge. The trigger (not RPC-only writes) keeps tests and seed scripts that write `published_content` directly consistent.

```sql
-- private.public_content
select case
  when p_content->'hidden' = 'true'::jsonb then '{"hidden": true}'::jsonb
  when jsonb_typeof(p_content->'items') = 'array' then jsonb_set(p_content, '{items}',
    coalesce((select jsonb_agg(i order by n) from jsonb_array_elements(p_content->'items') with ordinality t(i, n)
              where not (jsonb_typeof(i) = 'object' and i->'hidden' = 'true'::jsonb)), '[]'::jsonb))
  else p_content end
```

## Verification

**Commands:**
- `npx vitest run --project db supabase/tests/acceptance-public-reads.test.ts supabase/tests/grants.test.ts supabase/tests/content.test.ts supabase/tests/content-publish.test.ts supabase/tests/media.test.ts supabase/tests/concepts-admin.test.ts supabase/tests/acceptance-content-values.test.ts` (after go) -- all pass
- `node scripts/dev-clean-test-data.mjs` -- dry run, no `test_` rows
- `npm run lint && npm run typecheck && npm test && npm run format:check && npm run build` -- all pass (includes `test/invisible-chars.test.ts`)
