---
title: 'Online payments with Grow (round 13)'
type: 'feature'
created: '2026-11-20'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/online-payments.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every purchase needs Tal to approve a payment by hand and send a join link. Customers cannot buy on the site.

**Approach:** A customer picks a product on a session page, accepts the purchase terms, and goes to a Grow (morning) hosted payment form created per purchase. A pinned product holds the seat while she pays. A verified provider notification grants the entitlement (and the pinned booking) through `private.approve_payment_core` with `source = online`. The browser return sends a new customer to the join form and an existing one to her area. Everything ships behind a server kill switch, off in production until Grow approves the live site.

## Decisions

- **Hold (work manager, 2026-11-20):** the seat hold lives on the checkout row (`event_id`, `party_size`, `hold_until`, `state = open`) and is counted only in `private.occupied_places`. No `held` booking status. Update ARCHITECTURE-SPINE (AD-23, Deferred, status vocabulary). Creating a checkout with a hold locks the event first, like `book_core`, in the global lock order.
- **Notification auth (work manager, 2026-11-20):** per-checkout `notifyUrl` = `/api/payments/grow?c=<checkout>&s=<random secret>`; only the sha256 of `s` is stored. The payment is granted only after a server-to-server check with morning: `POST /documents/search` by the checkout's `description`, which carries a reference unique to that checkout (not only the product), and the date, expecting exactly one closed document of the checkout's amount in ILS. More than one match is an issue (`not_verified`), never an approval. The first sandbox payment must also confirm that the `notifyUrl` (with `s=`) does not appear in the browser (page source or network). If it does, stop and return to the work manager.
- **Split (work manager, 2026-11-20):** two PRs, each with its own spec. PR A (`spec-online-payments-grow-a.md`): migration, RPCs, Grow client, route, return handler, kill switch, DB and unit tests. PR B (`spec-online-payments-grow-b.md`): buy sheet, terms checkbox and page, return/waiting pages, "continue joining" banner, admin settings and attention copy, sandbox end-to-end.
- **Kill switch (work manager, 2026-11-20):** server env `ONLINE_PAYMENTS_ENABLED=true` and all Grow vars present. Off: no buy section; today's screens exactly.
- **Assisted join (2.15):** works unchanged on an unbound online purchase (same purchase page). Verified, not rebuilt.
- **Personal data:** a checkout stores no name, email or phone. They go only to Grow in the form request. Unpaid checkouts are deleted after 30 days by `private.job_cleanup`.
- **Void (2.14):** an online payment is voided with the same `admin_void_purchase`; the money is returned in the Grow dashboard.
- **Refunds (user, 2026-11-20):** as today. Tal refunds in the Grow dashboard and cancels the document in morning (for an exempt business: a negative receipt), then marks it in the app. No "refund mode" setting. (Card refund from the Grow dashboard not yet confirmed; Tal asks Grow support.)
- **Document type (user, 2026-11-20):** exempt business → receipt, `GROW_DOCUMENT_TYPE=400`.
- **Intro race (user, 2026-11-20):** an `online_payment_issues` row (`intro_not_eligible`) for Tal, no payment row; the customer sees "התשלום התקבל. נחזור אלייך בקרוב כדי להשלים את ההרשמה." with "צרי קשר".
- **Times (user, 2026-11-20):** settings `online_payment_window_minutes` (default 10) and `online_hold_grace_minutes` (default 5); hold = window + grace. A late payment gets the seat if still free, else `paid_without_place`. An unpaid-and-unjoined online purchase shows in attention after a fixed 24 hours.

## Grow facts (OpenAPI at developers.morning.co/docs/openapi.bundled.json, read 2026-11-20)

- `POST /payments/form` (bearer) returns `{url}`. Fields: `description, type (320 tax-invoice/receipt | 400 receipt), amount (shekels), currency 'ILS', vatType 0, lang 'he', pluginId, group 100 (card), client{name,emails,phone}, successUrl, failureUrl, notifyUrl, custom` (string, echoed to all three URLs). morning creates the document when the payment succeeds.
- No field closes the form after a time. No refund endpoint.
- Token: `POST {idp}/idp/v1/oauth/token` (`client_id`, `client_secret`, `grant_type=client_credentials`), valid 1 hour. Hosts: production `api.morning.co` + `api.greeninvoice.co.il/api/v1`; sandbox `api.sandbox.morning.dev` + `sandbox.d.greeninvoice.co.il/api/v1`.
- Verification: `POST /documents/search` (filters `description`, `fromDate`, `type`, `status`), `POST /documents/payments/search` (filter `paymentId`).
- UI-configured webhooks are HMAC-signed; the `notifyUrl` payload is undocumented and captured from the first sandbox payment.

## Boundaries & Constraints

**Always:**
- The notification only points at a checkout row; customer, product, event and amount come from that row, never from the payload.
- Dedupe = unique `(provider, provider_transaction_id)` + `pg_advisory_xact_lock(hashtext('grow:' || txn))`; a repeat returns the existing result (AD-5).
- After authentication, any business failure is written as an `online_payment_issues` row and the route answers 200. If that write itself fails (DB down, error), the route answers 5xx so Grow retries.
- The route processes notifications even when the kill switch is off.
- Checkout start takes an idempotency key from the screen (`lib/idempotency.ts`): a double tap opens one checkout and one hold.
- The hold follows the same self-booking rules as `book_session` (`plan_pinned_placement`). When a hold is released (failure return or expiry job), `private.notify_waitlist(event, free_before)` runs as in `cancel_core`.
- `private.is_real_booking` unchanged. Secrets only in server env, never `NEXT_PUBLIC_*`, repo or DB. Raw per-checkout secrets returned once (AD-10 pattern).
- Money in agorot; shekel conversion only in `lib/money.ts`, no `parseFloat`.
- Write/pay buttons use `OnlineButton`. Screens start with the `frontend-design` skill, inside DESIGN.md / EXPERIENCE.md (no timer on screen). No "טל" in customer copy.
- 6.8 must include the new tables `checkouts` and `online_payment_issues` in its prod test-data cleanup.

**Never:**
- No switching payments on in production; no real Plugin ID (after launch).
- No purchase-terms text in code (content, story 6.4).
- No change to the manual approval path beyond what the shared core requires.
- No real card numbers; only Grow's published sandbox cards.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Pinned, new customer | guest buys a single for an open session | hold → pay → verified notification → payment + entitlement + booking (`customer_id` null) → return → `/join/<token>` | — |
| Card, logged-in | customer buys a card | no hold; entitlement on her account; `purchase_repeat` push; return → `/me/purchases` | — |
| Double tap | same idempotency key twice | one checkout, one hold | — |
| Duplicate notification | same txn twice | one payment; second returns the first result | — |
| Seat lost | payment after the hold ended, session full | payment + entitlement, no booking → existing `paid_without_place` | — |
| Waitlist | session full, a seat frees | hold allowed only like a self-booking; release of a hold notifies the waitlist | — |
| Bad secret | wrong/missing `s` | 401, nothing written | — |
| Not verified at morning | no matching closed document, or amount/currency differ | no payment; issue `not_verified` / `amount_mismatch` | 200 |
| Second txn on a paid checkout | — | issue `second_payment` | 200 |
| Issue write fails | DB unavailable | nothing written | 5xx, Grow retries |
| Failure return | Grow failureUrl | checkout `failed`, hold released → session page notice | — |
| Kill switch off | — | no buy section; today's screens | route still processes |
| notifyUrl leak | `s=` visible in the browser in the first sandbox payment | stop, back to the work manager | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` (new) -- tables, settings columns, `occupied_places`, RPCs, `job_release_holds` (its own cron job `release_holds`, every minute; work manager 2026-11-20: kept separate), added to `private.job_intervals()` so attention's `job_failed` watches it, with its Hebrew name next to `complete_events` in `lib/copy/admin.ts` (~line 1354) and covered in `admin-home.test.ts`; attention kinds, `job_cleanup`. Base every redefinition on live `pg_get_functiondef` (copies in the session scratchpad `db-defs/`).
- `private.approve_payment_core` -- called as is: `('online', null, 'system', customer, product, event, amount, null, paid_on, null, null, null, 'grow', txn, 'park')`.
- `private.plan_pinned_placement(customer, product, event, payment)` -- checkout checks; accepts a null customer.
- `private.occupied_places`, `private.cancel_core` (lines 75, 237: `free_before` + `notify_waitlist`) -- hold count and release pattern.
- `public.admin_get_attention_items` (latest in `20261022154256_refactor_sweep_db.sql`) -- new kinds; delay `purchase_without_link` for online payments.
- `public.admin_update_business_settings`, `app/admin/(shell)/settings/settings-editor.tsx`, `settings-fields.tsx` -- new number fields.
- `lib/site-lock.ts` -- add `/api/payments/` to `SITE_LOCK_EXEMPT_PREFIXES`.
- `lib/server/secret.ts` (`sameSecret`), `app/api/jobs/push/route.ts` -- machine-route pattern.
- `lib/server/privileged/join.ts`, `lib/server/join-link.ts` (`joinLinkFor`), `lib/server/privileged/rate-limit.ts` (`hitRateLimit`, first step of the guest checkout action).
- `components/public/public-sessions.tsx` (`PublicSessionAction`), `app/me/sessions/[id]/page.tsx`, `booking-panel.tsx`, `booking-preview.ts` (`NO_MATCHING_ENTITLEMENT`) -- buy entry points.
- `app/admin/(shell)/home-items.ts`, `lib/copy/admin.ts` (`home.items`), `lib/errors.ts`, `lib/copy/customer.ts`, `lib/copy/audit-actions.ts`, `lib/content/schema.ts`, `/terms` (`LegalTextView`).
- Tests: `grants.test.ts` (EXPECTED_GRANTS), `pinned-approval`, `approve-payment`, `bind-purchase`, `session-occupancy`, `booking-concurrency`, `waitlist`, `cancel-booking`, `purchase-void`, `join`, `admin-join-fill`, `admin-home`, `scheduled-jobs`.

## Tasks & Acceptance

(Written in the A and B specs after the business questions are answered.)

## Decisions (2026-11-20, continued)

- **Where to buy (user):** the session page in `/me` always (products that fit the session, cards included). The public session page only when the new admin setting `public_online_purchase` is on (default off; guest checkout rejected server-side with `PUBLIC_PURCHASE_OFF`; column in PR A, settings row and public section in PR B). Separate from the server kill switch.
- **Card from "my purchases" (user):** a "רכישת כרטיסייה" button in `/me/purchases` opens the same purchase sheet with the visible card products, no session, no hold. Checkout accepts a null `event_id` only for a non-pinned product.
- **Verification detail (planning):** the notification is only a trigger; the payment is the verified morning document, and `provider_transaction_id` is its id. The browser return runs the same confirm step. See PR A.

## Open items (not blocking)

- Tal asks Grow support whether a full or partial card refund can be made from the Grow dashboard and whether it creates the morning cancel document automatically.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` -- pass.
- `npm run test:db` (only after the work manager's "אפשר test:db") -- pass, including the updated `grants.test.ts`.

**Manual checks:**
- First sandbox payment: capture the `notifyUrl` payload; confirm `s=` never appears in the browser; confirm `/documents/search` finds the document by its description.
