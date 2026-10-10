---
title: '4.8 Concepts admin'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '2490d9827df9467b10ff316a46c6307ff17b9093'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-4-media-upload-and-publish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal cannot manage concepts (CAP-41): the five concepts and their descriptions were written straight into the dev DB, there is no picker for `concepts.default_image_id`. Two deferred items point here (5.16 description, 5.4 image picker).

**Approach:** `/admin/concepts` under "עוד": list, add, edit (name, description, default kind), concept image, archive/restore, and delete only when no session uses it. New admin RPCs.

**User decisions (2026-10-10):**
- Changing `default_kind` is allowed also when the concept has sessions; it applies to new sessions only (existing `events.kind` is copied at creation and never changes).
- No site-wide default description (3.11 item): after the phone check it was removed; a session with no description of its own and a concept without one shows no description, as before 4.8.
- Delete uses `SensitiveConfirmDialog` (source §7 "חלון אישור": מחיקה). Archive/restore does not.

## Boundaries & Constraints

**Always:** AD-5 for every RPC (`set search_path = ''`, `private.is_admin()` first, revoke from `public, anon, authenticated, service_role` then one grant to `authenticated`; idempotency key on create/update/delete; `admin_set_concept_archived` and `admin_set_concept_image` are `set_*`, exempt). Audit before/after in the same transaction (`private.audit`). New concept: `theme_key = 'generic'`, `generic_paper_key = 'olive'` (themes dropped 2026-10-04; `theme_key` is only an identifier and the check requires a paper for generic), `sort_order` = max + 1. List order `sort_order, name`. Concept image follows `setSessionImageAction` exactly: `publishMedia` → RPC → `deletePublicMedia(hidden_paths)`. Additive migration only. Admin copy in `lib/copy/admin.ts`, new error text only in `lib/errors.ts`. Screens start with the `frontend-design` skill inside DESIGN.md/EXPERIENCE.md; logical Tailwind directions only.

**Never:** redefine `admin_create_event`, `admin_update_event`, `admin_duplicate_event`, `admin_publish_event`, booking functions, `private.plan_funding`, `admin_get_attention_items` (stop and ask if needed). Touch the session editor (`session-editor.tsx`, `sessions/actions.ts`, `session-draft.ts`). Concept themes/colours, reordering concepts, valid products per session (3.18), session delete (3.17). A `drop` in the migration. Customer-facing text containing "טל".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Create | name "חגים", kind couple | row with generic/olive, last in order; editor opens | — |
| Duplicate name | name equal (btrim, case-insensitive) to any concept, archived too | nothing saved | `CONCEPT_NAME_TAKEN` |
| Bad input | empty/101-char name, 2001-char description, kind `x`, unknown key | nothing saved | `INVALID_INPUT` + `detail.field` |
| Kind change with sessions | concept with 3 sessions, couple → regular | concept changes; those sessions keep `couple`; next new session is regular | — |
| Archive / restore | `p_archived` true / false | `archived_at` now / null; archived not in `/admin/sessions/new` or `admin_create_event` (already filters); old sessions still show name and image | — |
| Delete unused | concept with no events | row gone; its image hidden, `hidden_paths` deleted | — |
| Delete in use | any event row (any status) | nothing changes | `CONCEPT_IN_USE` → "יש לקונספט מפגשים, ולכן אי אפשר למחוק אותו. אפשר להעביר אותו לארכיון." |
| Set image | published media id / null | `default_image_id` set / cleared; previous image hidden if unused; sessions without own image show it | unpublished → `MEDIA_NOT_PUBLISHED` |
| Missing concept | unknown id on any RPC | — | `NOT_FOUND` |
| Non-admin | customer or anon calls any new RPC | nothing changes | `NOT_AUTHORIZED` / no grant |
| Repeat key | same key, same payload | stored result, no second row | same key, other payload → `IDEMPOTENCY_KEY_REUSED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004143612_concepts_and_events.sql:22-50,163-176` -- `concepts` table, checks, RLS select `using (true)`, grants. `20261005193920_media_upload_and_publish.sql:90-94,152,440-495` -- `default_image_id`, `private.used_media_ids()` (already counts concepts), `admin_set_event_image` (copy for `admin_set_concept_image`). `private.hide_unused_media` current body: `20261005203730_media_publish_review_fixes.sql:19`.
- `supabase/migrations/20261004102035_product_catalog_admin.sql:23,139,246,320,488-498` -- create/update pattern (`apply_*_changes`, `save_*`, revoke/grant). `20261006191118_work_sheet_review_fixes.sql:99` -- delete RPC with key.
- `app/admin/(shell)/products/**` -- screen template: `page.tsx` (Suspense list), `new/`, `[id]/` editor, `actions.ts` (shape check → `callRpc` → `ActionResult`), `newIdempotencyKey()`; tests `actions.test.ts`, `product-screens.test.tsx`, `products-list.test.tsx`.
- `app/admin/(shell)/sessions/actions.ts:105,131-166` -- `createSessionMediaAction`, `setSessionImageAction` (copy, don't edit). `sessions/[id]/edit/session-editor.tsx:222-267` `ImageBox` and `[id]/edit/page.tsx:71` `signedDraftUrls` -- reference for the concept image box. `components/admin/image-upload-field.tsx:51`, `lib/server/privileged/media.ts:64,114`.
- `components/admin/sensitive-confirm-dialog.tsx:162`, `lib/admin/sensitive-actions.ts` (add `concept_delete`).
- `lib/nav.ts:8,39-61` (`NavIcon`, `adminMoreNav`), `components/shared/nav-icon`, `lib/nav.test.ts:140-166`. Shared with 4.11/4.5: append the item, don't reorder.
- `app/admin/(shell)/sessions/new/page.tsx:36-42` -- already filters `archived_at is null`; no change.
- `supabase/tests/grants.test.ts:15` (`EXPECTED_GRANTS`, alphabetical), `product-catalog.test.ts`, `media.test.ts`, `events-admin.test.ts:50` (maps concepts by `theme_key`: keep seeded concepts unarchived in tests).
- `scripts/demo-seed.mjs:409-462` -- finds concepts by `theme_key` and active only; archiving a seeded concept makes it fail ("אין קונספט פעיל"). Generic concepts don't affect it.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_concepts_admin.sql` -- `admin_create_concept(p_concept jsonb, p_idempotency_key uuid)` → `{concept_id}`; `admin_update_concept(p_concept_id uuid, p_changes jsonb, p_idempotency_key uuid)` (keys `name`, `description`, `default_kind`; lock row `for update`); `admin_set_concept_archived(p_concept_id uuid, p_archived boolean)`; `admin_delete_concept(p_concept_id uuid, p_idempotency_key uuid)` → `{hidden_paths}` (lock, `CONCEPT_IN_USE` if any event, delete, `hide_unused_media`); `admin_set_concept_image(p_concept_id uuid, p_media_id uuid)` → `{concept_id, image_id, hidden_paths}`. Apply via MCP, `get_advisors`, regenerate `database.types.ts`.
- [x] `supabase/tests/concepts-admin.test.ts` -- every matrix row except the fallback; audit rows; archived concept refused by `admin_create_event`; past session still joins its archived concept. `grants.test.ts` -- five new lines.
- [x] `lib/errors.ts` -- `CONCEPT_IN_USE` (text above), `CONCEPT_NAME_TAKEN` "כבר יש קונספט בשם הזה".
- [x] `app/admin/(shell)/concepts/{page.tsx,concepts-list.tsx,load-concept.ts,concept-draft.ts,concept-fields.tsx,actions.ts,new/page.tsx,new/concept-create-form.tsx,[id]/page.tsx,[id]/concept-editor.tsx}` + tests -- `frontend-design` first. List: photo thumb, name, kind chip, "בארכיון" chip; archived hidden behind "להציג ארכיון"/"להסתיר ארכיון"; "+ קונספט". Create: name, description, kind → editor. Editor: fields + "שמירה"; notes "שינוי הסוג חל על מפגשים חדשים בלבד", "מפגש חדש מקבל את התיאור הזה", "שינוי השם מופיע בכל המפגשים של הקונספט", image "מוצגת בכל מפגש בלי תמונה משלו"; "העברה לארכיון"/"החזרה מהארכיון" with "קונספט בארכיון לא מוצע במפגש חדש. מפגשים קיימים לא משתנים."; "מחיקת הקונספט" via `SensitiveConfirmDialog` (`concept_delete`: "האם למחוק את הקונספט?"); `CONCEPT_IN_USE` shown inline next to the archive button.
- [x] `lib/copy/admin.ts` -- key `concepts`. `lib/admin/sensitive-actions.ts` -- `concept_delete`. `lib/nav.ts`, `nav-icon`, `lib/nav.test.ts` -- "קונספטים" (`/admin/concepts`) appended to `adminMoreNav`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- close 2 items (5.16 description, 5.4 picker) and the 3.11 default-text item as removed; new item: `admin_duplicate_event` copies a session of an archived concept (target 5.20). `tickets.toml` 4.8 done (in the PR).

**Acceptance Criteria:**
- Given a new concept with description and image, when Tal opens `/admin/sessions/new`, then it is offered and the new session takes its kind and description.
- Given a published session with no image, when its concept has an image, then the card and `/sessions` show the concept's image.
- After the migration, `npm run demo:seed` still runs.

## Implementation Notes

- Migration `20261010115255_concepts_admin` applied through MCP; advisor shows only the approved WARNs (0029, leaked password).
- `database.types.ts`: the five RPC entries were added by hand in generator format, because the shared dev DB already holds another story's `notes` functions; regenerating would pull them into this branch. `grants.test.ts` fails on the dev DB only on those `notes` grants (merge with that story).
- User decision 2026-10-10 after the phone check: the default description was removed (did not belong in the content editor). A session page shows the session's description, else the concept's, else nothing; no `session-page` content, reader or schema.
- Story done marker: `story-concepts-admin.md` (status done) next to the epic's `tickets.toml`, as for the other E4 stories.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-10; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): 5 patch, 0 defer, 0 loopback.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind, edge | `DeleteBox` rotates the key after a thrown call; a retry of a committed delete gets `NOT_FOUND` | medium | patch | Key kept on a thrown call, rotated only on a returned result. |
| 2 | edge | Create form never rotates the key on edit; resubmit after a thrown call → `IDEMPOTENCY_KEY_REUSED` | low | patch | Key rotated in the fields' `onChange`, as in the editor. |
| 3 | blind | Two comments in `lib/copy/admin.ts` now sit above the wrong keys | low | patch | Moved back above `sessions:` and `legal:`. |
| 4 | blind, intent | Description note "new sessions only" is wrong: a session without its own description shows the concept's live | medium | patch | Note (wording by the user): "מפגש חדש מקבל את התיאור הזה, ואפשר לשנות אותו במפגש. בלי תיאור במפגש, יוצג התיאור הזה."; SQL comments aligned. |
| 5 | verification | Seeded `session-page › default_description` row and its anon visibility after publish have no DB test | medium | patch | Two tests in `supabase/tests/content.test.ts` (seed row; visible to anon only after publish). |

Rejected: delete offered without a session count / dead-end dialog (low; spec routes `CONCEPT_IN_USE` to the archive box, fix adds UI branches); `CONCEPT_NAME_TAKEN` not tied to the name field (low, adds branches); image save button clickable until refresh (low; same value writes nothing, same as the session box); kind shown as text not a chip (cosmetic); emoji length (`review-accepted.md`); untrimmed legacy names (dev data only); archive racing `admin_create_event` (rare, function out of bounds); spec Verification vs grants note, ticket Verify wording, preview without page context, repeat-key tests only for create, archiving a seeded concept breaks seed/tests (dev only, in Code Map), page wiring of the fallback untested (phone check covers), production concept seeding (6.1) — descriptive or low.

## Design Notes

Delete returns `hidden_paths` because a deleted concept's image may become unused (`used_media_ids` stops counting it); `on delete set null` is irrelevant here since the concept row itself goes. Name check is in the RPC, not a unique index, so archived duplicates from dev data don't block the migration.

## Verification

**Commands:**
- `npm run test:db` (concepts-admin, grants, events-admin, media) -- pass
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass

**Manual checks:** phone: the four checks in the ticket prompt (create with image → offered; concept image fallback; in-use concept archives, not offered, old session shows it).
