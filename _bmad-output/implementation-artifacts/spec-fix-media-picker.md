---
title: 'fix-media-picker: choose an already uploaded image in every admin image field'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'dc1d5191e149c9b1189d8a6b2bdcad32165051b0'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every admin image field only uploads. To reuse a photo already on the site (e.g. a gallery photo as a session image), Tal must find the file on her phone and upload it again (user decision 2026-11-05: allow choosing an uploaded image everywhere).

**Approach:** One "choose from uploaded images" sheet inside `ImageUploadField`, so every field that renders it gets it: hero, about image, gallery item, image testimonial, session image, concept image, and (after PR B, fix-seo-editor) the SEO share images. Choosing makes a **copy**: a new `media_assets` row in `draft` whose draft file is copied from the chosen one. From there it is exactly a fresh upload (same save, publish, hide).

**Why a copy (not the same `media_id`):** alt text and focus live on the `media_assets` row and the site reads them from there (`lib/content/pages.ts:85`, `lib/media/photo.ts`). Two places sharing one id would overwrite each other's alt and focus on every publish. A copy keeps each place independent and leaves `hide_unused_media` untouched.

**Gate decisions (2026-11-05):** (1) The sheet lists only images on the site now: a family (original + copies) is listed only if a member is in `private.used_media_ids()` (published visible content, `events.image_id`, `concepts.default_image_id`); an image taken off the site disappears from the list, so it is not reused by mistake, e.g. after a customer asked to remove it (user). (2) Newest first, search by alt text, no "on the site" chip (manager). (3) Alt and focus come pre-filled and editable (manager). (4) Bottom sheet; one tap chooses (manager). Spec kept whole, not split (manager).

## Boundaries & Constraints

**Always:**
- Field map (all through `ImageUploadField`): content editor `image` fields in `section-fields.ts` (hero `image`, about/main `image`, gallery item `image`, testimonial `kind: image`), session (`session-fields.tsx`, create and edit), concept (`concept-fields.tsx`), and PR B's `seo_site.image` and `page_seo.image` (no extra wiring: they render through `ImageInput`).
- Migration: `media_assets.source_id uuid null references media_assets(id)` + index. A copy's `source_id` = the source's `source_id`, else its `id` (always the original). No grant on the new column to anon/authenticated.
- `admin_list_media()` (read-only definer, `is_admin()` first line, grant `authenticated`, no idempotency key): one row per family in use (any member id in `private.used_media_ids()`), keyed by the original (`source_id is null`) whose draft object exists in `storage.objects` (`media-drafts`). Per row: `id` (the original), `created_at`, `alt_text`/`focus_x`/`focus_y` from the family row with the latest `updated_at` and a non-null alt (else the original's). Order `created_at desc`.
- `admin_copy_media(p_source_id, p_idempotency_key)`: `is_admin()` first, idempotent (AD-5), source must exist with a draft object (else `MEDIA_NOT_UPLOADED`; unknown id `NOT_FOUND`), inserts the draft row with `source_id`, returns `media_id`. No audit row (like `admin_create_media`).
- Server actions in `app/admin/(shell)/media/actions.ts`: `listMediaAction()` (RPC + `signedDraftUrls`) and `copyMediaAction({sourceId, idempotencyKey})` (RPC, then `storage.from("media-drafts").copy(source, newId)` with the admin's own session; "already exists" = success; returns `{mediaId, previewUrl}`). Regular client only (same-bucket copy under RLS, like the upload); nothing in `lib/server/privileged`.
- `ImageUploadField` imports these actions itself; no new required prop, no change in its callers.
- Sheet = `WorkPanel` (`components/admin/edit-kit.tsx`). Tile buttons create data, so they use `useOnlineGuard`/`OnlineButton`; the opening button only opens a view.
- Copy in `lib/copy/admin.ts` › `image`; new error codes only in `lib/errors.ts`. Screen work starts with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md.

**Never:** sharing one `media_id` between two places; changes to `hide_unused_media`, `used_media_ids`, publish RPCs or `admin_set_*_image`; deleting images or draft files; editing PR B's files before PR B is merged (`content-editor.tsx`, `section-fields.ts`, `content-items.ts`, `lib/content/*`, `lib/seo/*`); `test:db`, migration apply, `demo:*`, `video:*` without the manager's go; any mention of an external report.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Choose for a session | Gallery photo chosen in the session field, save | New row `copying`→`published`, session shows it; gallery photo unchanged | — |
| Different alt per place | Same photo in hero and session, different alt | Each place keeps its own alt and focus after both publish | — |
| Copy of a copy | Choose a photo that is itself in use as a copy | The list shows only the original; the new row's `source_id` = original | — |
| Upload never finished | Row with no draft object | Not listed | Copy: `MEDIA_NOT_UPLOADED` |
| Copy retried | Same idempotency key; file copy answered "already exists" | Same `media_id`, success | — |
| Customer or anon | Calls either RPC | — | `NOT_AUTHORIZED` |
| Offline | Sheet open, no connection | Tiles `aria-disabled`, offline hint | Nothing is sent |
| Taken off the site | Family's last use removed and published (now `hidden`) | Not listed | — |
| No images | Nothing on the site yet | Sheet shows the empty notice | — |

</frozen-after-approval>

## Code Map

- `components/admin/image-upload-field.tsx` -- add the button and sheet; on a choice set `local[newId] = previewUrl` and `onChange({media_id, alt, focus_x, focus_y})`, announce. PR B adds `altWarning` here: expect a merge conflict, keep both.
- `components/admin/edit-kit.tsx` › `WorkPanel` -- reuse as the sheet (title focus, X, busy lock). Do not edit.
- `lib/media/drafts.ts` › `signedDraftUrls` -- thumbnails (signed draft URLs, admin session). Native `<img loading="lazy">`, square `object-cover`.
- `app/admin/(shell)/content/actions.ts:46` -- `createMediaAction` pattern (UUID check, `callRpc`) for the new actions.
- `supabase/migrations/20261022154256_refactor_sweep_db.sql:761` -- live `admin_create_media` (template for `admin_copy_media`). `20261005194206_media_upload_and_publish.sql:47-120,152` -- table, RLS, storage policies (insert allowed only for a `draft` row's name: the copy target qualifies), `private.used_media_ids()`.
- `supabase/tests/media.test.ts`, `supabase/tests/support/db.ts`, `supabase/tests/grants.test.ts` › `EXPECTED_GRANTS`.
- `app/admin/(shell)/content/content-screens.test.tsx` -- existing `ImageUploadField` tests; mock the new actions module there.

## Tasks & Acceptance

**Execution:**
- [x] Skill `frontend-design` before the screen work (DESIGN › `image-upload-field`, `bottom-sheet`).
- [x] `supabase/migrations/<ts>_media_picker.sql` -- column, index, both RPCs, revoke/grant (AD-5). Created with `npx supabase migration new`; applied to dev by the manager. Then `get_advisors`, `database.types.ts` regenerated, `grants.test.ts` rows.
- [x] `supabase/tests/media-picker.test.ts` -- every matrix row at DB level (list: in-use families only, taken-off-site family absent, session and concept uses count, family alt; copy idempotency, `source_id` of a copy of a copy, `MEDIA_NOT_UPLOADED`, `NOT_AUTHORIZED`), synthetic PNG only, `onCleanup`. Run only with the manager's go.
- [x] `app/admin/(shell)/media/actions.ts` + `actions.test.ts` -- input checks, "already exists" = success, copy failure returns a code.
- [x] `components/admin/image-upload-field.tsx`, `media-picker-sheet.tsx` (new, `"use client"`) + test -- sheet, search by alt, empty and no-match notices, offline tiles, choose sets value and preview.
- [x] `lib/copy/admin.ts`, `lib/errors.ts` (only if a new code is needed).
- [ ] **Session main, after PR B merges:** merge origin/main, resolve `image-upload-field.tsx`, confirm both SEO image fields show the button.

**Acceptance Criteria:**
- Given a 360px phone, when Tal opens the sheet, searches, and chooses, then no horizontal scroll, targets are 44px or more, and focus returns to the field.
- Given the security advisor after the migration, then no new WARN or ERROR beyond those approved in AGENTS.md.

## Implementation Notes

- Migration `20261105211043_media_picker.sql` is written but **not applied** (manager's go). `database.types.ts` was edited by hand to match (column, FK, both RPCs); regenerate with `generate_typescript_types` after the apply, then run `get_advisors`. `media-picker.test.ts` and `grants.test.ts` not run yet (manager's go).
- `admin_copy_media` also returns `source_path`; the action copies from it. New code `MEDIA_COPY_FAILED` (file copy failed; choosing the same tile again reuses the key, so the same row is retried).
- The sheet body is `PickerBody` (exported for static tests; no DOM test env). The field remounts the sheet per opening (`key`), so search and keys reset without setState in an effect. After a choice, focus goes to the field's button (`id`) after the close.

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-11-05):** four lenses (blind, edge-case, verification-gap, intent). 27 findings, merged into 9 patch groups, 1 defer, rest reject.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `admin_copy_media` copies any source with a draft file, so an image taken off the site can be copied from a stale list (blind, edge) | medium | patch | New migration: source family must have a member in `used_media_ids()` (else `NOT_FOUND`) |
| 2 | List alt/focus can come from a copy just hidden (`hide_unused_media` bumps `updated_at`) (blind) | medium | patch | Lateral orders in-use members first |
| 3 | Thumbnails are full 2000px draft files via one unbounded `createSignedUrls` (blind, edge) | medium | patch | List returns an in-use published `public_path`; tiles use next/image |
| 4 | Key map lives in the keyed sheet; reopen after `MEDIA_COPY_FAILED` makes a new key and an orphan row (edge, blind) | low | patch | Map kept in a ref in `ImageUploadField` |
| 5 | `picked` says "after saving"; content editor shows after publishing (blind) | low | patch | Same ending as `uploaded` |
| 6 | No test of choosing: key reuse, busy guard, pre-filled alt/focus, preview fallback (verification-gap x2, blind) | medium | patch | Pure helpers + unit tests |
| 7 | DB permission tests weak: anon accepts two codes, no anon list case, no key-mismatch case (blind) | low | patch | Exact codes + two cases |
| 8 | Unnamed tiles share one label; hint on `<ul>` not announced (blind) | low | patch | Position in the label; describedby removed |
| 9 | Search misses geresh/gershayim vs ASCII apostrophe/quote (edge) | low | patch | Normalised both sides |
| 10 | Every tap and abandoned pick leaves a draft row and file; prod cleanup must also respect `source_id` (blind, verification-gap) | low | defer | deferred-work entry (target 6.1) |

Rejected: FK without `on delete` vs dev draft cleanup (unreachable: a source is always in a used family, so never `draft`); focus return by `setTimeout` (checked in the phone test); current image not excluded (harmless extra copy); `used_media_ids` counts past/cancelled sessions and per-family listing (gate decision 1); spec says "synthetic PNG, onCleanup" while the test uses `inRollback` (fix edits the spec); original's draft file missing (never deleted for a used family); pick bypasses each field's `createMedia` (by design, one shared copy action); SEO fields untested (main-session task after PR B).

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` (incl. `test/invisible-chars.test.ts`), `npm run build` -- all pass.
- `npm run test:db -- supabase/tests/media-picker.test.ts supabase/tests/grants.test.ts` -- only with the manager's go.

**Manual checks:**
- Manager, on a phone: choose a gallery photo as a session image and as a concept image, give each a different alt, save; the site shows both, the gallery is unchanged.
