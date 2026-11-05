---
title: 'Small cleanups: screens, video seed, stale course commands'
type: 'bugfix'
created: '2026-11-04'
status: 'done'
baseline_commit: '8172ad9cb82c57c5d0eeb4f727ec9764e655862b'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An external audit (2026-11-03; items R1, R10–R16, R18, S8, P1–P4) found small client bugs (lost form input, stale idempotency keys, silent search failure, lost notice, wrong caps and offsets, stale bell count), a weak regression test, a video-seed script that can make an existing customer an admin, and stale course files that contradict the repo.

**Approach:** Fix each in place with the patterns the codebase already uses (key renewed on input change as in `customer-notes.tsx`, throw mapped to `SERVER_ERROR` as in `customer-live-search.tsx`, `--tab-bar-height` as in `globals.css`). No migration, no SQL, no new copy beyond one script message.

## Boundaries & Constraints

**Always:** Screens start with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. Every change keeps AD-5: the same key for an unchanged retry after a lost answer, a new key once the input changed or an answer arrived. No "טל" in customer copy.

**Decisions (work manager, 2026-11-04):** R11 also covers "edit dish" and "edit task" (`work-parts.tsx:172,414`), plus any other admin work-page or notes form with the same success-only renewal; the same pattern elsewhere is listed in Implementation Notes, not fixed. R1: choosing another product counts as touched; an untouched form still takes the new price; unit-tested. R15: the a11y button moves only while the selection bar is shown; elsewhere its position is unchanged. Length accepted.

**Never:** No migration or SQL; don't touch the product form, `AGENTS.md`, `lib/server/privileged/reset.ts` or `rate-limit.ts`. No P5–P8. Never run `test:db`, `demo:*` or `video:*`. File deletions (task 11) wait for the work manager's approval (given 2026-11-04 for the four commands and `check-config.mjs`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| R1 edited form, price changes | typed payer/method/reference; `CONFIRM_REQUIRED`, refresh brings `A:120` | form keeps every value and the error; amount stays 100, so the approval opens the price-change dialog |
| R1 untouched form | no input, no answer yet; any product price changes | form remounts with the new prices (today's behavior) |
| R10 answered failure | confirm → `{ok:false}` | fresh keys stored per chosen date; next confirm sends them |
| R10 lost answer | confirm throws | same keys kept and sent again |
| R11 edited retry | lost answer, then the text/day/date edited | new key, no `IDEMPOTENCY_KEY_REUSED` |
| R11 unchanged retry | lost answer, resubmit as is | same key |
| R12 network drop | `searchCustomersAction` throws | inline error `errorMessage("SERVER_ERROR")`; a stale older answer never overwrites |
| R13 last waitlist exit | every list now empty | the success notice stays, with focus, above the empty state |
| R14 many entries | 25 available, 30 sessions | at most 20 selectable; counter shows `n/20`; 21st row capped |
| R16 booking in page | refresh brings a new non-null `initialCount` | bell shows it; an older in-flight `load()` result is dropped |
| S8 anchor-less account with a profile | `admin@video.example.com` exists with `public.profiles` row, no anchor | script fails with a Hebrew message, grants nothing |

</frozen-after-approval>

## Code Map

- `app/admin/(shell)/payments/new/payment-form-host.tsx:74-78` -- remount key includes every price (`catalog`).
- `app/admin/(shell)/payments/new/payment-form.tsx` -- `<form>` at ~396, all inputs native (radio cards too), so a form-level `onChange` sees every edit; `state` = server answer.
- `app/admin/(shell)/sessions/book/multi-booking.tsx:141-196` -- `openSheet` sets keys; `confirm` clears them after an answer (`setKeys({})`); bar `bottom-[calc(4rem+…)] lg:bottom-0` at ~313.
- `app/admin/(shell)/sessions/[id]/work/work-sheet.tsx:266` (AddDishButton), `work-parts.tsx:275` (add task: body + day select), `app/admin/(shell)/notes/note-item.tsx:327` (AddNote), `app/admin/(shell)/sessions/[id]/edit/session-editor.tsx:453` (DuplicateBox, `setWhen`) -- key renewed only on success. Pattern: `app/admin/(shell)/customers/[id]/customer-notes.tsx:114-119`.
- `app/admin/(shell)/payments/new/existing/customer-search.tsx:58-74` -- no try/catch; `latest` ref guards staleness. Also used by manual booking (`hrefTemplate`).
- `app/me/bookings/bookings-list.tsx:80-104` -- empty return outside `ResultNoticeHost` (`components/shared/result-notice.tsx`; state survives when the root element type stays the same).
- `app/me/sessions/select/selection.ts` (`toggleSelection`, `pruneSelection`), `session-selector.tsx:84-143,234-241` (`full`, `remaining`, counter, bar), `app/me/sessions/actions.ts:47` (literal `20`). Admin analogue: `booking-results.ts` `MAX_SESSIONS`/`selectionCap`.
- `app/globals.css:337-362` -- `[data-a11y-button]` positioning (whatsapp-bar precedent); `components/shared/bottom-tab-bar.tsx:33-48` -- publishes `--tab-bar-height` (includes safe area) via ResizeObserver.
- `components/shared/bell-button.tsx:49-80` -- `useState(initialCount)` once; `apply`, `requestSeq`.
- `app/admin/(shell)/products/product-screens.test.tsx:62,93` -- `not.toContain("postJoin")`. Removed labels (PR #144, `bae7ebc`): "הודעה אחרי רכישה (לא חובה)", "תווית הכפתור (לא חובה)".
- `scripts/video-seed.mjs:202-249` -- `settleAnchor` adopts an anchor-less `FILMING_ADMIN_EMAIL` row (`else setAnchor`); `q()` for SQL.
- `.claude/commands/{start-from-template,setup-vercel-ai,setup-github,setup-vercel}.md`; `scripts/check-config.mjs` -- used only by `start-from-template.md`.
- `.claude/skills/pwa-push-notifications/SKILL.md:42`; `supabase/migrations/20261006184326_push_pipeline.sql:44,732` -- RLS on, no policy, `revoke all`.

## Tasks & Acceptance

**Execution:**
- [ ] `payment-form-host.tsx`, `payment-form.tsx` -- R1: form reports "touched" (form `onChange`, and any non-null `state`) via a new `onTouched` prop; host freezes the catalog part of the key while touched, resets touched on a new session (`reset`).
- [ ] `multi-booking.tsx` -- R10: in `confirm`, build the sent keys (`keys[id] ?? new`), `setKeys(sent)` before the request; after an answered failure `setKeys` fresh keys for the chosen dates instead of `{}`.
- [ ] `work-sheet.tsx`, `work-parts.tsx`, `note-item.tsx`, `session-editor.tsx` -- R11: renew the key in each input's change handler (text, task day select, duplicate date/times), keep success renewal. Covers AddDishButton, add task, edit dish (~414), edit task (~172), AddNote (~327), NotePanel edit-note (~197/227: `body` changes without a new key), DuplicateBox. `useKeyFor()` in `components/admin/use-work-action.ts` may be reused where it fits.
- [ ] `customer-search.tsx` -- R12: try/catch → `{ok:false, code:"SERVER_ERROR"}`, after the `latest` check order kept (stale throw ignored).
- [ ] `bookings-list.tsx` -- R13: wrap the empty state in the same `ResultNoticeHost className=…`.
- [ ] `selection.ts`, `actions.ts`, `session-selector.tsx` -- R14: export `MAX_BOOK_DATES = 20` from `selection.ts`, `selectionCap(available) = Math.min(available, MAX_BOOK_DATES)`; selector uses it for toggle, prune, `full`, `remaining` and counter; action uses the constant. Unit test.
- [ ] `session-selector.tsx`, `multi-booking.tsx`, `globals.css` -- R15 (frontend-design first): bars at `bottom-[var(--tab-bar-height,calc(4.25rem+1px+env(safe-area-inset-bottom)))]` (admin keeps `lg:bottom-0`); customer bar gets `data-selection-bar`, publishes `--selection-bar-height`, and CSS lifts `[data-a11y-button]` 16px above it while present.
- [ ] `bell-button.tsx` -- R16: effect on `initialCount`: when non-null and different from the last prop, `++requestSeq.current` then `apply(initialCount)`.
- [ ] `product-screens.test.tsx` -- R18: assert both removed labels are absent in create form and editor (keep the id check).
- [ ] `scripts/video-seed.mjs` -- S8: before `setAnchor` on an existing row, if `public.profiles` has its id, `fail("לחשבון <email> יש פרופיל של לקוחה, ולכן הסקריפט לא הופך אותו לאדמין צילום. בודקים את החשבון ידנית.")`.
- [ ] (main session) delete the four `.claude/commands/*.md` and `scripts/check-config.mjs` -- P1, P3, P4.
- [ ] `.claude/skills/pwa-push-notifications/SKILL.md` -- P2: the table exists (migration name), RLS on, no policy, no table grant to any role, only definer RPCs reach it; a schema change starts with `npx supabase migration new`, then `get_advisors`.
- [ ] `.gitignore` -- add `.claude/settings.local.json`.

**Acceptance Criteria:**
- Given the four commands are deleted, when `grep -r check-config` runs outside `_bmad-output`, then nothing matches.
- Given any changed file, when `npm test` runs, then `test/invisible-chars.test.ts` passes.

## Design Notes

R15: the a11y button (`end-4`, 48px) would sit inside the corner of "להמשך" once the bar is correctly placed; lifting it like the whatsapp-bar precedent keeps both buttons free. Admin has no a11y button.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, `npm test` -- all pass.

**Manual checks:**
- Phone width (work manager) and a real phone (user): selection bar fully above the tabs, "ביטול הבחירה" and "להמשך" tappable, a11y button not over them; R13 notice after leaving the last waitlist; R16 bell count after a booking.

## Implementation Notes

- R11 sweep (2026-11-04), same pattern outside this fix's scope, reported to the work manager, NOT fixed here: `app/admin/(shell)/products/new/product-create-form.tsx:57/103` (no input renews the key; product form is out of bounds); `app/admin/(shell)/sessions/new/session-create-form.tsx:82/151/157` (no input renews the key, and "draft"/"publish" send different payloads under one key).
- R14: `remaining` stays `available - chosen` (it is "יישארו N כניסות", her balance), not the cap.
- R10 key logic extracted to pure `bookingKeys()` in `booking-results.ts`, unit-tested. R1 via `catalogKey`/`formRemountKey` (`approval-history.ts`), R14 via `selectionCap`, both unit-tested. R11–R13, R16 and S8 are component/script behavior with no DOM or DB test harness in `npm test`; they are covered by the browser check (accepted, `review-accepted.md`: full flow in a browser is the end check).
- `scripts/video-seed.mjs`: only the 7-line S8 guard; the implementer's whole-file Prettier reformat was reverted (Prettier checks only ts/tsx).
- `test/invisible-chars.test.ts` failed once under a full parallel run, passed alone and in the next full run (3116/3116); load flake, unrelated.
- Build in the worktree (no `.env.local` there) runs with the main folder's env loaded by a scratchpad wrapper: 73/73 pages.
- 2026-11-05: `session-create-form.tsx` from the sweep is now fixed here (Spec Change Log); `product-create-form.tsx` is in `deferred-work.md`.

## Spec Change Log

- 2026-11-05, work manager decision after the R11 sweep: scope extended. `session-create-form.tsx` is fixed here: a new key pair on any edit (concept, times, close, description, capacity, price, products) and after a success; one key per submit button ("יצירת טיוטה" / "פרסום", `newSubmitKeys`/`submitKey` in `session-draft.ts`, unit-tested), so the other button after a lost answer is a new request and the same button resends its key. The image is saved by its own action after the create, so it does not renew the keys. `product-create-form.tsx` stays out (another tab is changing it): logged in `deferred-work.md` as open, target "לא נקבע (קטנים, לפי הזדמנות)". KEEP: all pass-1 fixes.

## Review Triage Log

Pass 1 (quick, one reviewer, with `review-accepted.md`): 2 findings: 1 medium, 1 low; 0 false.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | R1: a touched form keeps a frozen key after its chosen product leaves the catalog; `product` is undefined, the select shows/sends the first option with the old amount and no dialog | medium | patch | Real: `products.find` misses, `{product && …}` hides amount and dialog. `formRemountKey` keeps the frozen key only while every frozen product id is still offered; unit test for removed and added products |
| 2 | Comment in `globals.css` and the spec's manual check name the clear button "ניקוי הבחירה"; it is "ביטול הבחירה" (`lib/copy/customer.ts:126`) | low | patch | Direct correction in both |
