---
title: 'Online payments with Grow — PR A: data, provider and notification'
type: 'feature'
created: '2026-11-20'
status: 'in-progress'
baseline_commit: '2754c31e662e0a1bb270d11a61749e9442d05fa0'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-online-payments-grow.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way for a verified online payment to create a purchase.

**Approach:** Build the server half of online payments: checkout rows with a seat hold, the Grow client, the notification route, server-to-server verification, the browser return handler and the attention items. No customer screens (PR B). All decisions are in `spec-online-payments-grow.md` (the umbrella spec); this spec adds the ones below.

## Decisions (this PR)

- **Verification is the source of truth (planning, 2026-11-20):** the notification body is not parsed for business data. The route checks the checkout secret, then searches morning for the checkout's document. `provider_transaction_id` = the morning document id, so a repeat notification finds the same document and dedupes. Nothing from the payload is logged.
- **Two triggers, one confirm:** both the notification (notify secret) and the browser return (browser secret) run the same confirm step, so a lost notification still lands when she returns.
- **Document not found yet:** from the notification, answer 503 (Grow retries); from the return, show "pending". Never an issue for "not found".
- **Public purchase setting (user, 2026-11-20):** `business_settings.public_online_purchase boolean default false`; `begin_guest_checkout` raises `PUBLIC_PURCHASE_OFF` when off. Logged-in purchase ignores it.
- **Card from "my purchases" (user, 2026-11-20):** checkout accepts `event_id` null only for a product with `validity_mode = 'days'`, and requires it for `session`.
- **Lock order:** add `checkouts` to AD-6 right after `events` (profiles → events → checkouts → bookings …).
- **A verified document always lands (work manager, 2026-11-20):** `record_online_payment` accepts a checkout in `open`, `failed` or `expired`. A verified document always becomes a payment + entitlement; the pinned booking is placed only if the seat is still free, else `park` (`paid_without_place`). Only `paid` leads to replay (same document) or `second_payment`.
- **One open checkout per logged-in customer:** `begin_checkout` closes her previous `open` checkout (`failed`, hold released, waitlist notified) in the same transaction; a late payment on it still lands (rule above). `startCheckout` never cancels a guest's previous checkout; it expires by itself. Guests are limited by the rate limit only.
- **Unconfirmed safety net (work manager, 2026-11-20):** every authenticated notification first writes `checkouts.last_notified_at` in its own short call (`mark_checkout_notified`), even when the answer will be 503. Attention item `online_payment_unconfirmed`: `last_notified_at` set, state not `paid`, older than 30 minutes, no unresolved issue for it. Tal checks it in Grow.
- **Exact match at morning:** `findCheckoutDocument` keeps only documents of `GROW_DOCUMENT_TYPE`, dated from the checkout's creation day on, not cancelled, whose description contains the reference as a whole token (`· BT-…` at the end, compared exactly, not a substring of another reference).
- **Amount without float:** the morning amount becomes agorot as `parseShekelsToAgorot(n.toFixed(2))` in `lib/money.ts`; tested with `0.1 + 0.2` → 30 agorot.

## Boundaries & Constraints

**Always:** the umbrella spec's Always list. Plus:
- `checkouts` and `online_payment_issues`: RLS on, no grants to `anon`/`authenticated`/`service_role`; read and written only by definer RPCs. `checkouts.customer_id` is set only from `private.current_customer_id()`.
- RPCs: `begin_checkout` → `authenticated`; `begin_guest_checkout`, `checkout_for_confirm`, `mark_checkout_notified`, `record_online_payment`, `cancel_checkout`, `checkout_return` → `service_role`; `admin_resolve_online_payment_issue` → `authenticated` (admin check first). Each with `revoke … from public, anon, authenticated, service_role` then one grant.
- Idempotency: `begin_*` and `admin_resolve_*` use `private.idempotent_begin` (guest scope `'guest'`); the stored result omits raw secrets and a replay returns `{reissue_required: true}`. `record_online_payment` uses only the advisory lock + unique index (AD-5). `cancel_checkout` and `checkout_return` are exempt (absolute state).
- Every new code in `lib/errors.ts`; the new audit action in `lib/copy/audit-actions.ts` + `adminCopy.audit.actions`.

**Never:** customer screens, the purchase-terms page, admin settings rows or attention copy (PR B). No network call inside a transaction.

## I/O & Edge-Case Matrix

Umbrella matrix applies. Additional rows:

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Card without session | `begin_checkout(card, null)` | checkout, no hold | — |
| Pinned without session / days with session | — | `PINNED_EVENT_REQUIRED` / `EVENT_NOT_ALLOWED` | no row |
| Session full / closed / already booked | pinned | the `plan_pinned_placement` code | no row, no hold |
| Guest, setting off | `begin_guest_checkout` | `PUBLIC_PURCHASE_OFF` | no row |
| Terms not accepted | `p_terms_accepted` false | `TERMS_REQUIRED` | no row |
| Hold counts | open checkout, `hold_until > now()` | `occupied_places` includes its `party_size` | — |
| Hold expires | job after `hold_until` | `expired`; waitlist notified with `free_before` as if the hold still counted | — |
| Return before notification | browser return, document exists | confirm runs, payment created | — |
| Return, not yet at morning | — | `{state: 'pending'}` | — |
| Return, new customer paid | — | live join token revoked, new raw token returned | — |
| Morning down | notification | 503; only `last_notified_at` written | Grow retries |
| Paid after `cancel_checkout` | she paid, then started a new checkout (old one `failed`) | payment + entitlement; booking if the seat is free, else `paid_without_place` | — |
| Paid after expiry | job set `expired`, then the notification | same as the row above | — |
| Never confirmed | notifications stopped with 503, she never returned | after 30 min: `online_payment_unconfirmed` in attention | — |
| Second open checkout, logged-in | new `begin_checkout` | previous `open` → `failed`, hold released, waitlist notified | — |
| Reference near-miss | morning has `BT-AB12` and `BT-AB123` | only the exact token matches | — |
| Void online purchase | `admin_void_purchase` | works as for manual | — |
| Assisted join | `admin_begin_join_fill` on an online purchase | works unchanged | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- one new migration; redefinitions from live `pg_get_functiondef` (scratchpad `db-defs/`): `private.occupied_places`, `public.admin_update_business_settings`, `public.admin_get_attention_items`, `private.job_cleanup`, `private.job_intervals`, `public.rate_limit_hit`.
- `private.approve_payment_core` (unchanged) -- called with `('online', null, 'system', c.customer_id, c.product_id, c.event_id, c.amount_agorot, null, paid_on, null, null, null, 'grow', document_id, 'park')`; audits as `approve_payment`.
- `private.plan_pinned_placement(customer, product, event, null)` -- pinned checks, null customer allowed. `private.intro_blocked(customer, null)` -- days-mode intro for a known customer.
- `private.cancel_core` lines 75 / 237 -- `free_before` + `private.notify_waitlist` pattern.
- `public.admin_approve_payment` -- copy its `purchase_repeat` enqueue for a known customer, non-pinned product.
- `private.issue_token('join', payment_id)`, `live_join_uidx` -- revoke-then-issue on return.
- `lib/server/privileged/rate-limit.ts` (`RateLimitBucket`, add `checkout`), `lib/server/secret.ts` (`sameSecret`), `app/api/jobs/push/route.ts` (route pattern), `lib/site-lock.ts` (`SITE_LOCK_EXEMPT_PREFIXES`), `lib/money.ts`, `lib/server/join-link.ts`.
- Tests: `supabase/tests/grants.test.ts`, `bind-purchase.test.ts` (add `checkouts` to the "never bound" list: its `customer_id` stays as created), `admin-home.test.ts`, `scheduled-jobs.test.ts`, `purchase-void.test.ts`, `admin-join-fill.test.ts`, `session-occupancy.test.ts`, `waitlist.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `ARCHITECTURE-SPINE.md` -- AD-6 lock order, AD-23 + Deferred (hold on the checkout row, no `held`), status vocabulary (`checkouts.state` open, paid, failed, expired, issue; `online_payment_issues.reason`). `admin-configurable-parameters.md` -- three new rows. `data-model.md` -- two tables.
- [ ] `supabase/migrations/<ts>_online_payments.sql` -- (1) `business_settings`: `online_payment_window_minutes int default 10 check 1..60`, `online_hold_grace_minutes int default 5 check 0..30`, `public_online_purchase boolean default false`; extend `admin_update_business_settings` (a boolean branch). (2) `checkouts(id, created_at, customer_id null, product_id, event_id null, party_size, amount_agorot, product_name, reference unique, state, pay_until, hold_until null, notify_secret_hash, browser_secret_hash, terms_accepted_at, payment_id unique null, closed_at, last_notified_at null)` with checks `(event_id is null) = (hold_until is null)`, `(state = 'paid') = (payment_id is not null)`, index on `(event_id) where state = 'open'`. (3) `online_payment_issues(id, created_at, checkout_id, provider_transaction_id null, amount_agorot null, reason in (not_verified, amount_mismatch, second_payment, intro_not_eligible, approve_failed), detail jsonb, resolved_at, resolved_by)`, unique `(checkout_id, coalesce(provider_transaction_id, ''))`. (4) `occupied_places` + open unexpired holds. (5) `private.begin_checkout_core`, `begin_checkout`, `begin_guest_checkout`: price > 0 and active product else `PRODUCT_NOT_PURCHASABLE`; lock event `for update`; secrets 32 random bytes base64url, sha256 stored; `reference` = `'BT-' || 10 hex of id`. (6) `checkout_for_confirm(p_checkout_id, p_secret, p_secret_kind)` → `{state, reference, amount_agorot, created_on}` or `CHECKOUT_NOT_FOUND` (also for a wrong secret); `mark_checkout_notified(p_checkout_id, p_notify_secret)` sets `last_notified_at` (exempt from idempotency, absolute value). (7) `record_online_payment(p_checkout_id, p_secret, p_secret_kind, p_document_id, p_outcome in (verified, not_verified, amount_mismatch), p_amount_agorot, p_paid_at)`: advisory lock, replay by `(grow, document_id)`, locks profiles → event → checkout; accepts `open`/`failed`/`expired`, and on `paid` only replay or `second_payment`; issue rows, else state `paid` then the core inside `begin … exception when sqlstate 'P0001'` (`INTRO_NOT_ELIGIBLE` → that reason, other code → `approve_failed`); `paid_on = (p_paid_at at time zone 'Asia/Jerusalem')::date`; `purchase_repeat` for a known customer and non-pinned product. (8) `cancel_checkout(p_checkout_id, p_browser_secret)`: open → `failed` + waitlist. (9) `checkout_return(p_checkout_id, p_browser_secret)` → `{state, product_kind, event_id, customer_known, join_token?, joined?}`. (10) `private.job_release_holds` + `cron.schedule('release_holds', '* * * * *', …)` + `job_intervals` row; also expires non-pinned checkouts after `pay_until + grace`. (11) `job_cleanup`: delete `failed`/`expired` checkouts older than 30 days. (12) attention: `online_payment_issue` (unresolved), `online_purchase_incomplete` (online, unbound, approved, older than 24 h), `online_payment_unconfirmed` (Decisions); `purchase_without_link` skips `source = 'online'`. (13) `admin_resolve_online_payment_issue(p_issue_id, p_idempotency_key)` + audit. (14) `rate_limit_hit`: bucket `checkout`, 10 per hour per IP.
- [ ] `lib/supabase/database.types.ts` -- regenerate (MCP).
- [ ] `lib/money.ts` (+ test) -- `agorotToProviderAmount(a): number` (exact, from the integer string) and `providerAmountToAgorot(n)` = `parseShekelsToAgorot(n.toFixed(2))` (test `0.1 + 0.2` → 30).
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- before switching `public_online_purchase` on: check whether 10 checkouts per hour per IP is low enough that a full session cannot be blocked by holds.
- [ ] `lib/payments/online-config.ts` (+ test) -- `onlinePaymentsEnabled(env)`: `ONLINE_PAYMENTS_ENABLED === 'true'` and `GROW_ENV` in (sandbox, production), `GROW_CLIENT_ID`, `GROW_CLIENT_SECRET`, `GROW_PLUGIN_ID`, `GROW_DOCUMENT_TYPE` in (320, 400) present. `growConfig(env)` returns the hosts by `GROW_ENV`, or null.
- [ ] `lib/server/privileged/grow.ts` (+ test, mocked `fetch`) -- `server-only`; token cached until 60 s before `expiresAt`; `createPaymentForm({…})` → url (`lang 'he'`, `currency 'ILS'`, `vatType 0`, `group 100`, `maxPayments 1`, `custom` = checkout id); `findCheckoutDocument(reference, fromDate)` → `{kind: 'none'|'one'|'many', document?}`; 10 s timeout; never logs secrets or payer data.
- [ ] `lib/server/privileged/checkout.ts` (+ test) -- `startCheckout` (rate limit for a guest, begin RPC, Grow form with `successUrl /pay/return`, `failureUrl /pay/failed`, `notifyUrl /api/payments/grow?c=…&s=…`, description `<product name> · <reference>`; on Grow failure `cancel_checkout` and `GROW_UNAVAILABLE`; cookie `bt_checkout` = `<id>.<browser secret>`, httpOnly, secure, sameSite lax, 7 days) and `confirmCheckout(id, secret, kind)` (`mark_checkout_notified` when kind is notify → checkout_for_confirm → search → outcome → record).
- [ ] `app/api/payments/grow/route.ts` (+ test of a pure handler) -- POST only; `c`, `s` from the query; body read and dropped (max 64 KB); 401 `CHECKOUT_NOT_FOUND`, 503 when Grow is not configured, unreachable or has no document yet, 503 on a DB error, 200 otherwise; `no-store`.
- [ ] `app/(public)/pay/return/route.ts`, `app/(public)/pay/failed/route.ts` -- read the cookie; return: confirm, then redirect paid+new → `/join/<token>`, paid+known → `/me/bookings` (pinned) or `/me/purchases`, pending → `/pay/pending`, issue/failed/expired → `/sessions/<event>?payment=<state>` (`/me/purchases?payment=…` without an event). Failed: `cancel_checkout`, same redirect.
- [ ] `lib/site-lock.ts` (+ test) -- add `/api/payments/`.
- [ ] `lib/errors.ts` -- `TERMS_REQUIRED`, `PUBLIC_PURCHASE_OFF`, `PRODUCT_NOT_PURCHASABLE`, `CHECKOUT_NOT_FOUND`, `GROW_UNAVAILABLE`, `ONLINE_PAYMENTS_OFF`.
- [ ] `lib/copy/audit-actions.ts`, `lib/copy/admin.ts` -- `admin_resolve_online_payment_issue`; job name `release_holds`: "שחרור מקומות שנשמרו לתשלום".
- [ ] `.env.example`, `README.md` ("סביבות") -- the six Grow vars, no values; production stays empty until Grow approves.
- [ ] `supabase/tests/online-payments.test.ts` + the tests in the Code Map -- every matrix row (umbrella and this spec) and `EXPECTED_GRANTS`.

**Acceptance Criteria:**
- Given two concurrent `begin_checkout` calls for the last seat, when both run, then exactly one gets a hold.
- Given the same notification delivered twice concurrently, when both run, then one payment, one entitlement and one booking exist.
- Given the kill switch is off, when `startCheckout` is called, then it returns `ONLINE_PAYMENTS_OFF` and no row is created, while the route still confirms an existing checkout.

## Spec Change Log

## Review Triage Log

## Design Notes

The sandbox payment capture (umbrella Verification) runs in PR B, where a checkout can start from a screen. PR A is proved by DB and unit tests; an optional smoke run of `startCheckout` against the sandbox happens only if the vars are already in `.env.local`.

Vercel Preview may also have Vercel Deployment Protection in front of it, separate from our Basic Auth lock. Before the PR B end-to-end run, check that `POST /api/payments/grow` on a preview URL is reachable without a Vercel login.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` -- pass.
- `npm run test:db` (only after "אפשר test:db") -- pass.
- `get_advisors` (security) -- only the approved WARNs.

## Implementation Notes
