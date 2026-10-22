---
title: 'Fix 13: Notes board redesign, topics removed'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '787cc4289fc3572ba7dd838b77619f46fd33056d'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-11-notes-tab.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The notes tab (4.11) groups notes under topics; the user finds topics add clutter and are not needed (fixes-log 13, user 2026-10-21, after the sketch round: "להוריד לגמרי את הנושאים").

**Approach:** Topics are removed entirely (table, RPCs, screen). One board of all notes, sketch A ("לוח פתקים", https://claude.ai/artifact/SiEhnMqjAVSgbUNZJZ7qpJ v2): paper notes, the first line of `notes.body` is the title, the rest free text. Pin, done, archive/restore, order, edit and delete stay.

## Boundaries & Constraints

**Always:**
- Migration (`npx supabase migration new notes_without_topics`), from the live `pg_get_functiondef` of each function: renumber `notes.sort_order` into one board order (`row_number() over (order by topic sort_order, topic id, note sort_order, note id)`); `alter table notes drop column topic_id`; drop `note_topics`, `admin_add_note_topic`, `admin_rename_note_topic`, `preview_admin_delete_note_topic`, `admin_delete_note_topic`, `admin_set_note_topic_order`, old `admin_add_note(uuid,text,uuid)`, `admin_update_note(uuid,uuid,text,uuid)`, `admin_set_note_order(uuid,uuid[])`, `private.lock_note_topic`, `lock_topic_of_note`, `note_top_order(uuid)`, `plan_delete_note_topic`.
- New/replaced RPCs (definer, `search_path = ''`, `is_admin` first → `NOT_AUTHORIZED`, revoke then one grant to `authenticated`): `admin_add_note(p_body, p_idempotency_key)` (top of the unpinned notes), `admin_update_note(p_note_id, p_body, p_idempotency_key)`, `admin_set_note_order(p_ids)` (full list of all notes, archived included, else `CONCURRENT_CHANGE`); `create or replace` of `admin_delete_note`, `admin_set_note_pinned`, `admin_set_note_done`, `admin_set_note_archived` (same signatures).
- Migration timing (user 2026-10-21): one migration, run now (before `test:db` and the phone check); the production notes tab is broken until the merge deploys. Tell the planning session before she runs it.
- Locking (AD-6, no parent row): every note write first takes `pg_advisory_xact_lock(hashtext('notes'))`, then locks/re-reads the note (`for update`), unknown → `NOT_FOUND`. No-op → no update, no audit. Audit unchanged (`entity_type` `notes`, body masked by `private.audit_diff`).
- Screen `/admin/notes`, phone-first, starts with `frontend-design`, inside DESIGN.md/EXPERIENCE.md, as sketch A: `PageHeading` "רשימות"; "+ פתק" (primary, at the inline-start = right) opens a `WorkPanel` with the body (hint "השורה הראשונה מוצגת ככותרת"); board of `card` notes in a grid (2 columns on phone, 3 from `md`), row order, `align-items: start`, slight alternating tilt; title `body-strong` 17px, rest `body-sm` ink-muted, full text, `whitespace-pre-line`; pinned note on `muted` with the pin icon and a decorative `accent` tape strip; footer: done `check-item` (plain text, not a label, as 4.11), a small pin toggle (44px target, `aria-pressed`, label "נעיצה"/"ביטול נעיצה", saves at once, user 2026-10-21; no long-press) and the pencil (44px) opening the note sheet (body, pin, archive, move up/down, delete). Done = strike-through + muted, stays in place. "להציג ארכיון"/"להסתיר ארכיון" (`?archive=1`), archived list under the board with "החזרה".
- Copy: remove topic strings; empty board "עוד אין פתקים. פתק הוא מקום לרעיונות, ספקים או מתעניינות." + "+ פתק"; sheet title for a new note "פתק חדש". Keep all other existing labels. Buttons that write use `OnlineButton`/`useOnlineGuard`.
- Remove `delete_note_topic` from `lib/admin/sensitive-actions.ts`. Keep the topic action names in `lib/copy/audit-actions.ts` (old log rows; already hidden).
- Docs: SPEC memlog event (topics removed, changes the 2026-09-26 joint decision and CAP-39); UX memlog line; EXPERIENCE.md rows 91 and 341, `data-model.md`, `security-and-rpc-rules.md:17`, `site-map.md:47`, ARCHITECTURE-SPINE row 480; fixes-log row 13 status; completion-plan fixes round.

**Never:** No topics, tags or filters in any form; no new column; no customer access; no search; no change to `customer_notes`; do not touch `private.audit_diff`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Add | body "  ספק פרחים\nטלפון  " | trimmed row, top of unpinned; title "ספק פרחים" | — |
| Empty / long | "   " or 2001 chars | nothing written | `INVALID_INPUT` `{field:"body"}` |
| Replay / reuse | same key same body / other body | one row, one audit / refused | `IDEMPOTENCY_KEY_REUSED` |
| Migration | 2 topics with notes | all notes kept, one order (topic 1's notes first), no `topic_id`, no `note_topics` | — |
| Stale order | `p_ids` missing a note or foreign id | nothing changes | `CONCURRENT_CHANGE` |
| Archive/restore | archived note | hidden; restore keeps pinned/done/sort_order | — |
| One-line note | body "איציק לקינוחים" | title only, no body paragraph | — |
| Customer | any RPC / select | 0 rows | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010110501_notes.sql` -- current tables 16-51, helpers 57-170 (`note_text` reused as is), RPCs 465-841 (pattern: `idempotent_begin` → lock → write → `private.audit` → `idempotent_finish`), grants 843-877. Base the new bodies on the live `pg_get_functiondef`.
- `supabase/tests/notes.test.ts` -- rewrite topic cases (239-337, 451-528) for the board; keep matrix tests; add migration-shape check (no `topic_id`, no `note_topics`). `grants.test.ts:76-238` -- drop topic rows, new signatures.
- `app/admin/(shell)/notes/` -- `page.tsx` (read `notes` only), `notes-data.ts` (drop topics/`topicHref`/`needsConfirmedDelete`; add `noteTitle(body)` → `{title, rest}`; `noteOrderAfterMove` over the whole board), `actions.ts` (drop topic actions, new signatures), `notes-view.tsx` (board, no `TopicSwitcher`/`TopicTools`), `note-item.tsx` (card, sheet without "העברה לנושא", `AddNote` as a sheet); tests beside them.
- `components/admin/edit-kit.tsx` (`WorkPanel`, `TextForm` `multiline`/`max`, `MoveButtons`, `DeleteStep`, `ErrorNotice`), `use-work-action.ts` -- reuse unchanged.
- `lib/copy/admin.ts:2039-2100` (`notes`), `lib/admin/sensitive-actions.ts:15-16`, `lib/supabase/database.types.ts` (regenerate).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_notes_without_topics.sql` -- per Always. Main session: user runs it in the SQL Editor (drop), register in `schema_migrations`, `get_advisors`, `generate_typescript_types`.
- [ ] `supabase/tests/notes.test.ts`, `grants.test.ts` -- matrix rows, board order, advisory-lock path, audit mask.
- [ ] `app/admin/(shell)/notes/*` -- start with `frontend-design`; screen per sketch A; unit tests: `noteTitle`, board move order, Action shape rejections, markup (empty board, title/rest, pinned tape, done strike, archive toggle, no topic UI).
- [ ] `lib/copy/admin.ts`, `lib/admin/sensitive-actions.ts` -- copy and sensitive list.
- [ ] Docs listed in Always (main session writes the memlog lines).

**Acceptance Criteria:**
- Given notes that were in two topics, when the migration runs and the page loads, then all notes show on one board with no topic UI, pinned first.
- Given a note "ליגל\nענבר", when shown, then "ליגל" is the title and "ענבר" the text; edit, pin, done, archive, restore and reorder persist after refresh.

## Implementation Notes

- Work in worktree `.claude/worktrees/fix-notes-redesign` (branch `fix-notes-redesign`; `node_modules` and `.env.local` present). Migration file created by the main session: `supabase/migrations/20261021064354_notes_without_topics.sql` (empty); write only there. Read live definitions with `select pg_get_functiondef(...)` via the Supabase MCP `execute_sql` (read-only; never DDL or writes). A subagent cannot apply migrations: hand-edit `lib/supabase/database.types.ts` for the new signatures and removed table/RPCs so the build passes; do not run `test:db`. No git commits, no file deletions, no `.env*` writes; report anything left for the main session. Stop only your own node processes.

## Spec Change Log

## Review Triage Log

Round 1 (2026-10-21; blind-hunter, edge-case-hunter, verification-gap, intent-alignment on the full diff). high 0, medium 0, low 13, false 3. No intent_gap or bad_spec.

| # | Finding | Verdict | Route | Evidence and action |
|---|---|---|---|---|
| 1 | Lock test skips `admin_set_note_order` | low | patch | `calls` list has six RPCs, not the order one. NOTE_ORDER added with a real reorder |
| 2 | Same-length list with a repeated id untested | low | patch | Every refused case is caught by the length or containment check first. Case added |
| 3 | Ordering tests read the board without the lock | low | patch | A committed dev note between read and call fails the test. Board lock taken first in the test |
| 4 | Archive rows ignore the first-line title | low | patch | `ArchivedNoteItem` shows the body as one paragraph. Title + rest via `noteTitle` |
| 5 | Renumbering test runs a copy of the SQL | low | defer | One-time migration, already applied; live check after it: 2 notes kept, one order. Logged in deferred-work |

Rejected: 1000-id cap now spans the board, up/down labels on a grid (the move is visible and announced with its place), long one-line title not clamped, hint not linked by `aria-describedby` (needs a new kit prop), add sheet keeps the draft and key on close, focus after the first note from the empty state, tilt tied to reduced motion, lock key name `'notes'` (low, unlikely in daily use or the fix adds surface beyond a direct correction); topic names dropped (user decision, test data only), fixes-log row 13 text (updated by the main session at the end), footer overflow at 320-360px (false: 24+44+44+gaps fit the 112-132px inner width with the pencil's `-me-2.5`; checked again on the phone).

## Verification

**Commands:**
- `npm run test:db` (notes, grants, audit) -- pass; `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` -- pass; `get_advisors` -- only `0029` and `auth_leaked_password_protection`.

**Manual checks:**
- Phone, admin: new note, title from first line, pin, done, archive and restore, reorder; "+ פתק" on the right.
