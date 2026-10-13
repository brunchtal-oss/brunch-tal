---
title: 'Admin sessions list: occupancy and status chip'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'f79064c38d81482b5689d48f0ac12a84b8206dcd'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-screen', 'quick-rpc']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/admin/sessions` shows each session's capacity ("12 מקומות") but not how many places are taken, so Tal opens every session to see how full it is. The chip next to the title crowds line 1.

**Approach:** Line 1 = "בראנץ׳ {concept}" + occupancy; line 2 = weekday and date only, chip at inline-end of that line, before the chevron. Occupancy from a new admin read RPC returning `private.occupied_places` per listed id. Out-of-tree story.

## Boundaries & Constraints

**Always:**
- Occupancy is only `private.occupied_places(e.id)` (AD-6, spec 3.2: the single place that sums `party_size`; a couple booking counts 2; a pinned booking with no customer yet counts; cancelled does not). No `party_size` arithmetic in TS or in any other query.
- New RPC `public.admin_list_session_occupancy(p_event_ids uuid[]) returns jsonb` (AD-5): `security definer`, `stable`, `set search_path = ''`, first line `if not private.is_admin() then raise exception 'NOT_AUTHORIZED'`; `p_event_ids` null → `INVALID_INPUT`. Returns `[{ "event_id", "occupied" }]` for ids that exist; unknown ids are omitted. Read only, no idempotency key. `revoke execute ... from public, anon, authenticated, service_role` then one `grant execute ... to authenticated`. No cardinality cap: admin only, ids come from her own list.
- The list's filter and order stay as today (`sessionsListFilter`, PostgREST, by `starts_at, id`); the page calls the RPC once with the listed ids, through `callRpc`. An id missing from the result shows 0.
- Start with the `frontend-design` skill, within DESIGN.md (status-chip; task-row: chip at inline-end, 44px min height, chevron 20px ink-muted) and EXPERIENCE.md. Row layout and wording only; no new colours, other components unchanged. Logical directions only. Nothing truncated at 360px: a long concept name wraps.
- Hebrew copy lives in `lib/copy/admin.ts` (`adminCopy.sessions`). The number is wrapped in `<bdi>` so "8/12" reads occupied-first in RTL.

**Never:**
- No change to `private.occupied_places`, `admin_update_event`, `admin_get_event_details`, `admin_get_home`, the session page `/admin/sessions/[id]`, the editor, the customer's sessions list or public `/sessions`.
- No change to `SessionStatusChip` itself (3.8 may add a "בוטל" chip; it keeps the same slot).

## I/O & Edge-Case Matrix

| Scenario | State | Row shows |
|----------|-------|-----------|
| Published, partly booked | regular, capacity 12, 8 confirmed singles | line 1: "בראנץ׳ יווני" … "8/12"; line 2: date … "פורסם" |
| Couple booking | couple session, capacity 14, 1 couple booking | "2/14" |
| Pinned booking, no customer yet | 1 confirmed booking, `customer_id` null | counted |
| Cancelled booking | 1 cancelled booking | not counted |
| Draft | draft, capacity 12 (drafts are never bookable) | line 1 title only, no number; chip "טיוטה" |
| Full | occupied + (couple ? 2 : 1) > capacity (incl. over capacity, couple with 1 left) | "מלא" in `text-warning`, no numbers |
| Customer calls RPC | authenticated non-admin | `NOT_AUTHORIZED` |
| Null input | `p_event_ids` null | `INVALID_INPUT` |
| Empty list | no sessions | RPC not called; empty text as today |

**Decisions (user, 2026-10-10):**
1. Occupancy is the bare number "{occupied}/{capacity}" (as the admin home tile), right after the title on line 1 ("בראנץ׳ יווני · 4/12"), bold like the title; under line 2 a 4px occupancy bar, the admin home tile's bar (user phone check 2026-10-10, replacing "at inline-end above the chip"). No unit word.
2. A draft shows no number and no bar; its chip "טיוטה" says it all.
3. A full session shows the word "מלא" in `text-warning` (existing token) instead of the numbers, with a full bar. Full = no room for one more booking of its kind, the session page's `isFull` rule.

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261004212706_pinned_product_approval.sql:1027-1088` -- `admin_list_bookable_events`: pattern for an admin read RPC with `occupied_places` and its grants.
- `supabase/migrations/20261004183409_bookings_and_self_booking.sql:798-961` -- `get_event_availability(uuid[])`: pattern for an id-array input (`INVALID_INPUT` on null).
- `supabase/migrations/20261006111121_session_completion_job.sql:31` -- current `private.occupied_places` (counts `confirmed` and `completed` via `is_real_booking`). Do not touch.
- `supabase/tests/self-booking.test.ts:820` -- guard: only `occupied_places` may `sum(...party_size)`; the new RPC must not.
- `app/admin/(shell)/sessions/page.tsx:59-71` -- `SessionsContent`: list query; add the RPC call and pass occupancy.
- `app/admin/(shell)/sessions/sessions-list.tsx` -- the row layout to change.
- `app/admin/(shell)/sessions/session-draft.ts:300` -- `listSummary` (date · places) becomes date only; add the occupancy/full helpers here (display only).
- `app/admin/(shell)/sessions/[id]/load-details.ts:115` -- `isFull` rule to mirror (not import: it takes `EventDetails`).
- `lib/copy/admin.ts:542-552` -- `adminCopy.sessions` (`places`, `status`).
- `lib/rpc.ts` -- `callRpc` (typed from `database.types.ts`).
- `supabase/tests/admin-home.test.ts` -- fixture pattern (seedMoney, insert bookings as owner, `asAuthenticated`, `inRollback`).
- `supabase/tests/grants.test.ts:101` -- add the new EXECUTE line in order.
- `app/admin/(shell)/sessions/session-screens.test.tsx:56`, `session-draft.test.ts:271` -- tests to update.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_admin_session_occupancy.sql` -- create via `npx supabase migration new admin_session_occupancy`; the RPC above with comment header -- main session: user runs it in SQL Editor, session records it in `schema_migrations`, runs `get_advisors` (only WARN 0029 allowed) and regenerates `lib/supabase/database.types.ts`.
- [x] `supabase/tests/session-occupancy.test.ts` -- one test per matrix row on the RPC (couple = 2, pinned no-customer counted, cancelled not, unknown id omitted, NOT_AUTHORIZED, INVALID_INPUT), in `inRollback` with `testName`.
- [x] `supabase/tests/grants.test.ts` -- add `function public.admin_list_session_occupancy(p_event_ids uuid[]) authenticated EXECUTE`.
- [x] `app/admin/(shell)/sessions/session-draft.ts` + `lib/copy/admin.ts` -- `listSummary` → date only; add `sessions.occupancy: (o, c) => \`${o}/${c}\`` and `sessions.full: "מלא"`; a pure helper returning `null` (draft) / `{ full: true }` / `{ text }`. Remove `sessions.places` if nothing else uses it.
- [x] `app/admin/(shell)/sessions/page.tsx` -- call the RPC with the listed ids (skip when empty), map to `Record<id, occupied>`, pass to `SessionsList`; RPC error throws like the list query.
- [x] `app/admin/(shell)/sessions/sessions-list.tsx` -- new two-line layout (frontend-design first).
- [x] `_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md` -- a dated "החלטת המשתמשת" bullet under "## החלטות": this out-of-tree fix and the three display decisions.
- [x] `session-draft.test.ts`, `session-screens.test.tsx` -- listSummary has no places and no time; the row renders occupancy, the chip on line 2, draft and full per decisions.

**Acceptance Criteria:**
- Given a published session with a couple booking, when Tal opens `/admin/sessions` at 360px, then line 1 shows the title and occupancy counting 2, line 2 the date and "פורסם" at inline-end level with the date, nothing truncated.
- Given the dev DB, when `npm run test:db` runs the new test and `grants.test.ts`, then both pass.

## Implementation Notes

- `adminCopy.sessions.full` already exists (the session page's "המפגש מלא (x/y)"), so the list's word is `sessions.listFull: "מלא"`. `sessions.places` removed (no other use).
- The occupancy number carries an `sr-only` " מקומות" (existing `sessions.summary.places`), as the admin home tile does; nothing visible changes.
- `database.types.ts`: the new function entry was added by hand in the generator's format; the main session regenerates it after applying the migration.
- The RPC test passed against the dev DB with the migration executed inside the test's rolled-back transaction (temporary edit, reverted); the migration itself is not applied.

## Spec Change Log

- 2026-10-10, user phone check: occupancy moves from inline-end to right after the title, bold; a 4px occupancy bar under each non-draft row. `OccupancyBar` moves from `app/admin/(shell)/home/session-tile.tsx` to `components/admin/occupancy-bar.tsx` (shared, unchanged). KEEP: the RPC, the draft/full rules, the chip on line 2 at inline-end.

## Review Triage Log

Pass 1 (quick-screen, quick-rpc; review-accepted.md passed): 0 findings (high 0, medium 0, low 0, false 0, maybe-false 0).

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` -- pass.
- `npx vitest run --project db supabase/tests/session-occupancy.test.ts supabase/tests/grants.test.ts supabase/tests/self-booking.test.ts` -- pass.
- `npm run build` -- succeeds.

**Manual checks:**
- Phone, 360px: the four checks from the request (layout, couple = 2, draft per decision, no truncation).
