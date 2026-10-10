---
title: 'Story 4.11: Notes tab'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '2490d9827df9467b10ff316a46c6307ff17b9093'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal keeps ideas, suppliers and interested people in scattered notes outside the app. CAP-39 (joint decision 2026-09-26, SPEC memlog) gives her an admin-only "רשימות" tab: topics she creates, free notes inside them.

**Approach:** Two new tables `note_topics` and `notes`, admin-only RLS (select only), every write through an admin RPC; one screen `/admin/notes` under "עוד".

## Boundaries & Constraints

**Always:**
- Tables: `note_topics(id, name 1-60 chars trimmed, sort_order, created_at)`; `notes(id, topic_id fk on delete cascade, body 1-2000 chars trimmed, pinned bool, done bool, archived_at timestamptz null, sort_order, created_at, updated_at)`. Index on `notes.topic_id`. RLS: one select policy `(select private.is_admin())`; `revoke all ... from public, anon, authenticated, service_role`, then `grant select ... to authenticated`. No write grants.
- RPCs (`security definer`, `set search_path = ''`, `is_admin` first → `NOT_AUTHORIZED`, revoke then one grant to `authenticated`):
  - with `p_idempotency_key`: `admin_add_note_topic(p_name)` (appended last), `admin_rename_note_topic(p_topic_id, p_name)`, `admin_delete_note_topic(p_topic_id, p_confirmed)`, `admin_add_note(p_topic_id, p_body)` (top of the unpinned notes), `admin_update_note(p_note_id, p_topic_id, p_body)`, `admin_delete_note(p_note_id)`.
  - read: `preview_admin_delete_note_topic(p_topic_id)` returns `private.plan_delete_note_topic` (`{topic_id, name, note_count}`, archived included; AD-7).
- Delete decisions (user, 2026-10-10): a topic with notes is deleted only through `SensitiveConfirmDialog` (`SENSITIVE_ACTIONS.delete_note_topic` "האם למחוק את הנושא?", impact "{n} פתקים יימחקו, כולל פתקים בארכיון", checkbox); its notes go with it (cascade). `p_confirmed` is required only when `note_count > 0`, else `CONFIRM_REQUIRED`. An empty topic and a single note are deleted with the inline two-step confirm (`DeleteStep`), no checkbox.
- Move (user, 2026-10-10): the note edit panel has "העברה לנושא" (topic select). A move locks both topics in id order, puts the note at the top of the target's unpinned notes, keeps pinned/done/archived, and audits `topic_id` old → new.
  - exempt (AD-5): `admin_set_note_pinned`, `admin_set_note_done`, `admin_set_note_archived(p_note_id, p_archived boolean)`, `admin_set_note_topic_order(p_ids)`, `admin_set_note_order(p_topic_id, p_ids)` (full list of the topic's notes, else `CONCURRENT_CHANGE`).
- Every note write locks the topic row first (`for update`), then re-reads the note (AD-6). A call that changes nothing returns without update and without audit. Each change writes `private.audit` (`entity_type` `note_topics`/`notes`, no customer/event); a delete puts the deleted row (and a topic's notes count) in `before`.
- `private.audit_diff` masks `notes.body` as `"<changed>"` (notes about interested people hold names and phones, AD-19). `create or replace` from the latest version on origin/main at write time; topic names are not masked.
- Display order: pinned notes first, then the rest, each by `sort_order`. Done notes stay in place with strike-through and a real checkbox (`check-item`, EXPERIENCE:382). Archived notes hidden; "להציג ארכיון" shows them per topic with "החזרה", which restores to the same place.
- Screen: phone-first, starts with `frontend-design`, inside DESIGN.md and EXPERIENCE.md. Topic switcher (selected topic in `?topic=`), the topic's notes, "+ פתק", per-note actions (edit, pin, archive, delete, move up/down), topic actions (rename, move, delete). Result via inline notice, no optimistic UI, buttons locked until answer. Empty states: no topics → "עוד אין נושאים. נושא הוא מקום לרעיונות, ספקים או מתעניינות." + "+ נושא"; topic with no notes → "אין פתקים בנושא הזה." + "+ פתק". Labels: "רשימות", "+ נושא", "+ פתק", "בוצע", "נעיצה" / "ביטול נעיצה", "לארכיון", "להציג ארכיון", "להסתיר ארכיון", "החזרה", "מחיקה", "שינוי שם".
- Nav: "רשימות" row in `adminMoreNav` (`lib/nav.ts`) with a new `notes` icon; reached from "עוד" and the side-nav "עוד" tab.
- Reuse the work-sheet editing kit (`useWorkAction`, `useKeyFor`, `WorkPanel`, `TextForm`, `MoveButtons`, `DeleteStep`, `ErrorNotice`) by moving it to `components/admin/` with a `max` prop on `TextForm`; the work sheet keeps the same look and behaviour.

**Never:**
- No customer access, no customer link on a note, no notes in exports or customer RPCs.
- No hard-coded business values; no "טל" in copy.
- No topic archive, no note search, no rich text. Do not touch `admin_get_attention_items`, `admin_get_home`, booking/cancel functions or `private.audit`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Add note | topic exists, body "  ספק פרחים  " | row with trimmed body, top of unpinned | — |
| Empty / too long | body "   " or 2001 chars | nothing written | `INVALID_INPUT` detail `{field:"body"}` |
| Replay | same key, same args | same result, one row, one audit | — |
| Key reuse | same key, other body | — | `IDEMPOTENCY_KEY_REUSED` |
| Archive and restore | archived note | hidden by default; restore keeps pinned/done/sort_order | — |
| Delete note | existing note | row gone; replay returns stored result; not restorable | other id → `NOT_FOUND` |
| Delete topic | topic with 3 notes (1 archived), `p_confirmed` false | nothing deleted; preview `note_count` 3 | `CONFIRM_REQUIRED` |
| Move note | note to another topic, stale target id | moved to top of target; or nothing | missing topic → `NOT_FOUND` |
| Stale order | `p_ids` missing one note or with a foreign id | nothing changes | `CONCURRENT_CHANGE` |
| Same value | `set_done(true)` on done note | no update, no audit | — |
| Customer | any RPC / select | 0 rows | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261006184223_work_sheet.sql` -- pattern: tables + RLS + grants 29-82, lock helpers 136-200, `work_text` 205, `admin_add_work_dish` 341 (idempotent_begin → lock → write → audit → idempotent_finish), `admin_set_work_dish_order` 506, `admin_set_work_task_done` 749, grants 1006-1043. Fixes in `20261006191118_work_sheet_review_fixes.sql` (trim all whitespace, deleted children in before, no-op returns without audit; order at 161).
- `supabase/migrations/20261006215608_customers_list_and_card.sql:125` -- latest `private.audit_diff`, add `(p_table = 'notes' and k = 'body')`.
- `supabase/migrations/20260930191525_create_rpc_contract.sql:34,91` -- `private.idempotent_begin/finish(scope, rpc, key, jsonb)`. `20260930193304_fix_reset_begin_and_audit.sql:69` -- `private.audit(actor_id, actor_kind, action, entity_type, entity_id, customer_id, event_id, old, new, reason)`.
- `supabase/tests/work-sheet.test.ts` -- template (seed 47, helpers 66-90, replay ~359); `support/db.ts` (`inRollback`, `asAuthenticated`, `testName`, `onCleanup`, `queryError`, `insertAuthUser`); admin = insert into `public.admin_roles`. `grants.test.ts:15` -- sorted `EXPECTED_GRANTS` strings.
- `app/admin/(shell)/sessions/[id]/work/{work-parts.tsx,use-work-action.ts}` -- kit to move; imports in `work-sheet.tsx`, `shopping-list.tsx` and siblings follow.
- `app/admin/(shell)/settings/page.tsx` -- page pattern (`PageHeading`, Suspense, RLS select via `lib/supabase/server`); role gate is in the shell layout. `sessions/[id]/work/actions.ts` -- Action shape checks (`isUuid`, `isText`, `isIdList`) + `callRpc`.
- `lib/nav.ts:8-61` (`NavIcon`, `adminMoreNav`), `components/shared/nav-icon.tsx:~31`, `lib/nav.test.ts:159-171` (icon list).
- `lib/copy/admin.ts` -- add `notes` after `customers`; `lib/errors.ts` has all generic codes; `lib/admin/sensitive-actions.ts`, `components/admin/sensitive-confirm-dialog.tsx` (`SensitiveConfirmDialog`, `ImpactRow`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_notes.sql` -- (`npx supabase migration new notes`) tables, RLS, grants, lock helpers, all RPCs, `audit_diff`. Main session: `apply_migration`, `get_advisors`, `generate_typescript_types`.
- [x] `supabase/tests/notes.test.ts` -- every matrix row, cascade on topic delete, order of pinned/unpinned, audit masks body; `grants.test.ts` rows.
- [x] `components/admin/` (moved kit) + work-sheet imports -- no behaviour change; existing work tests pass.
- [x] `app/admin/(shell)/notes/{page.tsx,actions.ts,notes-data.ts,*.tsx}` -- start with the `frontend-design` skill; Actions per RPC; parsing; screen.
- [x] `lib/nav.ts`, `nav-icon.tsx`, `lib/nav.test.ts`, `lib/copy/admin.ts`, `lib/admin/sensitive-actions.ts` (`delete_note_topic`).
- [x] Pure tests beside the files: parsing and ordering, Action shape rejections, screen markup (empty states, archive toggle, strike-through + checkbox).
- [x] `tickets.toml` -- 4.11 done in the PR; `completion-plan-2026-10-10.md` round 1 status.

**Acceptance Criteria:**
- Given a topic with notes, when Tal pins, marks done, archives, restores, reorders and refreshes, then order and state persist and archived notes appear only with "להציג ארכיון".
- Given a customer session, when it calls any notes RPC or selects the tables, then `NOT_AUTHORIZED` / 0 rows.

## Implementation Notes

- Work in worktree `.claude/worktrees/story-4-11` (branch `story-4-11-notes-tab`; `node_modules` and `.env.local` present). Migration file created by the main session: `supabase/migrations/20261010110501_notes.sql` (empty); write only there, no `drop`. A subagent cannot `apply_migration`: hand-edit `lib/supabase/database.types.ts` for the new tables and RPCs so the build passes; the main session applies, runs the advisor, regenerates types and runs `npm run test:db`. Report what is left for the main session. No git commits, no file deletions (a moved file: create the new one and leave the old for the main session to delete, reporting it).

- Done (main session, 2026-10-10): `apply_migration` was declined again (no approval prompt in VS Code); the user ran the migration in the SQL Editor, the main session registered `20261010110501 notes` in `schema_migrations`, the advisor shows only `0029` and `auth_leaked_password_protection`, `database.types.ts` was regenerated (additions only), and the old `work/use-work-action.ts` was deleted. The kit lives in `components/admin/edit-kit.tsx` and `components/admin/use-work-action.ts`; `TextForm` gained `max` and `multiline`. A new or moved note gets the topic's lowest `sort_order` minus one. Review patches: the done checkbox is named by `aria-labelledby` and the body is plain text, so tapping it does not toggle; `needsConfirmedDelete` picks the delete path. Ticket: `story-notes-tab.md` pulled and marked done.

## Spec Change Log

## Review Triage Log

Round 1 (2026-10-10; blind-hunter, edge-case-hunter, verification-gap, intent-alignment on the full diff). high 0, medium 1, low 13, false 4. No intent_gap or bad_spec.

| # | Finding | Verdict | Route | Evidence and action |
|---|---|---|---|---|
| 1 | Tapping a note's text toggles "בוצע" and saves | medium | patch | The body is the checkbox `<label>`; on a phone, reading or copying a phone number marks it done. Body becomes plain text, checkbox named via `aria-labelledby` |
| 2 | A failed delete preview shows its error behind the open sheet | low | patch | `rowError` notice is outside `WorkPanel`. Error shown inside the panel |
| 3 | Delete-topic button not locked while a rename or reorder is pending | low | patch | Only `previewing` guarded. `aria-disabled` + early return on `pending` |
| 4 | Dialog uses `topic.name` from props, not the preview's name | low | patch | Stale name next to a fresh count. Use `plan.name` |
| 5 | Delete path (inline vs dialog) untested; archived-only topic must use the dialog | low | patch | `noteCount={notes.length}` only. Pure helper + unit test |
| 6 | "1 פתקים יימחקו" | low | patch | `impactNotesValue(1)`. Singular wording |
| 7 | Comment on `admin_update_note` wrong for a pinned note | low | patch | A pinned note goes to the top of the pinned group. Comment only (migration applied) |
| 8 | In-place edit keeping `sort_order`, move keeping pinned/archived, topic-order no-op, unknown topic on add/rename, rename validation: untested | low | patch | Only one-note and unpinned cases in `notes.test.ts`. Cases added |
| 9 | Audit-mask test can pass vacuously | low | patch | `if ("body" in row.before)`, duplicate and always-true assertions. Explicit per-row checks |

Rejected: 1000-note cap on reorder, concurrent `max(sort_order)` on topic add, note moved between unlocked read and lock, deleted note → `CONCURRENT_CHANGE` in `admin_update_note`, duplicate topic names (low, one admin, not met in daily use); focus lost after first note or delete, no 2000-char hint, `inputRef` ignored on multiline (workaround present), kit reads `adminCopy.work`, `note_text` duplicates `work_text` (low, fix adds surface beyond a direct correction); null `p_topic_id` code, anon not exercised, frontend-design not visible in diff, "screen tests are static" (false: Action rejects non-uuid, `grants.test.ts` pins anon, the skill ran, `review-accepted.md` browser flow).

## Verification

**Commands:**
- `npm run test:db` (notes, grants, work-sheet, shopping-items) -- pass.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass.
- `get_advisors` security -- only `0029` and `auth_leaked_password_protection`.

**Manual checks:**
- Phone, admin: topic and note created, edited, pinned, done, archived and restored; a deleted note does not return.
