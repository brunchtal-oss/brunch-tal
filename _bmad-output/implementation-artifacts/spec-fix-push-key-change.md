---
title: 'Fix: re-subscribe push when the VAPID key changed'
type: 'bugfix'
created: '2026-11-15'
status: 'done'
baseline_commit: 'ab22d1d509d7ad9f5bef7dbde1ac86e09da34135'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ensureSubscription` (`lib/push/client.ts:213-232`) reuses `getSubscription()` without checking which `applicationServerKey` it was made with. The user's phone subscribed before 6.1 with the dev key; after production got its own pair, every sync re-registered that old endpoint and the push service answered `HTTP_403` on every send (prod-check 2026-11-15: 2 failed `marketing_reminder`). Turning push off and on by hand fixed it (new subscription 09:49).

**Approach:** When the existing subscription's key bytes differ from the current `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, unsubscribe, subscribe again, and remove the old endpoint from the server too, from both callers. Document what to do on a future key change.

## Boundaries & Constraints

**Always:** the old endpoint is removed with the same `unregister` action `turnOff` uses (`unregister_push_subscription`, deletes only the caller's own row); the new subscription is registered first, the old endpoint unregistered after, and only when it differs from the new one; a failed unregister never fails the sync or the card.

**Never:** touch `lib/server/privileged/push-worker.ts` (403 stays an error, not `gone`); a migration; a screen or copy change; ask for the permission anywhere new (`subscribe` stays only in `ensureSubscription`, `test/push-permission-on-click.test.ts`).

## I/O & Edge-Case Matrix

| Scenario | Existing subscription | Expected |
|---|---|---|
| Same key | key bytes = current key | kept; no `unsubscribe`, no `subscribe`; `replaced: null` |
| Other key | key bytes ≠ current key | `unsubscribe()`, then `subscribe` with the current key; `replaced` = old endpoint (null if the new endpoint is the same) |
| Key not exposed | `options.applicationServerKey === null` | kept as is; `replaced: null` |
| None | `getSubscription()` → null | `subscribe`, as today; `replaced: null` |

</frozen-after-approval>

## Code Map

- `lib/push/client.ts` -- `ensureSubscription` returns `{ registration: PushRegistration, replaced: string | null } | null`; a pure `sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean | null` (null = not exposed). Keep `urlBase64ToUint8Array` and the `PUSH_CHANGE_EVENT` dispatch.
- `components/shared/push-sync.tsx` -- new prop `unregister: (endpoint: string) => Promise<ActionResult>`; `register(subscription.registration)`, then, if `replaced`, `unregister(replaced)` in its own try/catch. Keep the "on" guard before `ensureSubscription()` (the click test reads it).
- `components/shared/push-card.tsx` -- `enable()`: the same register-then-unregister; it already has `unregister`.
- `app/me/layout.tsx`, `app/admin/(shell)/layout.tsx` -- pass `unregister={unregisterPush}` (already exported by each `notifications/actions.ts`).
- `lib/push/client.test.ts` -- `ensureSubscription` with stubbed `navigator`/`window` and `vi.stubEnv` for the key: the four matrix rows, plus `sameKey`.
- `README.md` (after the VAPID line in "Vercel", ~line 154) -- short subsection "החלפת מפתחות VAPID": new pair; replace both keys in the environment's Vercel; Redeploy; a device that opens the site re-subscribes by itself; devices that never come back keep failing with 403 and show in "לא נשלח" (expected); right after the switch (no need to wait: a device that comes back re-subscribes anyway, its key differs) delete the subscriptions with `created_at` before the switch time, in the same environment's SQL Editor (in production: by the user); `node scripts/prod-check.mjs` shows the state.
- `_bmad-output/implementation-artifacts/deferred-work.md` (~line 1030, the "403 is not gone" entry) -- closed: why 403 is not deleted automatically (a wrong key on our side also returns 403, and deleting would remove every subscription); the browser fix heals every device that comes back; key switch → README.
- `_bmad-output/implementation-artifacts/completion-plan-2026-10-10.md` -- decision line "2026-11-15, החלטת המשתמשת": this fix joins round 13 in track C, and the 403 entry closes with the docs; add it to round 13's row in the table.

## Tasks & Acceptance

**Execution:**
- [ ] the five code files and the test above
- [ ] README, deferred-work, completion-plan

**Acceptance Criteria:**
- Given a device whose subscription was made with an old key, when she opens `/me` or `/admin` with push on, then the device gets a new subscription for the current key, the new endpoint is registered and the old one is removed from `push_subscriptions`.
- Given `test/push-permission-on-click.test.ts`, then it still passes unchanged.

## Implementation Notes

- The return type is a named `EnsuredSubscription`: `test/push-permission-on-click.test.ts` finds the function body by the first `{` after `ensureSubscription()`, so an inline type literal broke it. The test file is unchanged.
- The old endpoint is kept in localStorage (`push-replaced`) from just before `unsubscribe()` until the server removed it (`forgetReplaced()` after `unregister` returns ok), so a failed `subscribe`, `register` or `unregister` is retried on the next sync. The old endpoint is unregistered only after `register` returned ok. Storage that throws: memory only, as before.
- README step 6 filters by `last_seen_at`, not `created_at`: the register upsert refreshes `last_seen_at` but keeps `created_at` when the browser gives the same endpoint back.
- Work manager, 2026-11-15: the README delete runs right after the switch (no waiting), in that environment's SQL Editor (production: the user); PushSync keeps its "on" guard, so a device turned off is never re-subscribed.

## Review Triage Log

Quick review, one reviewer, with `review-accepted.md`.

| # | Finding | Verdict | Route | Action |
|---|---|---|---|---|
| 1 | old endpoint lost when `subscribe` or `register` fails after `unsubscribe()` (held in memory only) | medium | patch | kept in localStorage until `unregister` succeeds; unregister only after a successful register; test for a failed `subscribe` |
| 2 | README delete by `created_at` can remove a re-subscribed device that got the same endpoint back | low | patch | filter by `last_seen_at` |

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` -- all pass. No test:db (no database test touched).

**Manual checks:**
- After the merge, on the user's phone: a real push arrives (work manager).
