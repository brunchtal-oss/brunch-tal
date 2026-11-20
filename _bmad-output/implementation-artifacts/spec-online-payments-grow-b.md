---
title: 'Online payments with Grow — PR B: customer and admin screens'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
baseline_commit: 'd50c3707b2410dd9eac5ead1ab08aedac65c29af'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment, money-entitlements, security, matrix-coverage, ux-accessibility, adversarial]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-online-payments-grow.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-online-payments-grow-a.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR A built the server half of online payments, but no screen starts a purchase, nothing shows the outcome of a payment, and Tal cannot see or handle the new attention items or settings.

**Approach:** Add the screens on top of PR A, all behind the server switch: a purchase sheet on the session page (`/me` always; public page only with `public_online_purchase`) and a card purchase in "הרכישות שלי"; the purchase-terms page and checkbox; the return outcomes (pending page and notices); a "continue joining" banner; three settings rows; Hebrew copy and actions for the new attention items; then the end-to-end run against the Grow sandbox on Vercel Preview.

## Decisions

All decisions of the umbrella spec and of PR A hold. This PR adds:

- **Products for the sheet:** a new RPC `get_purchase_options(p_event_id uuid, p_auth_uid uuid)` (service_role; `p_auth_uid` only from verified claims, as `begin_checkout`). With an event: active, priced products the session accepts (`private.event_accepts_product`, event kind, pinned or card), intro hidden when `intro_blocked` for a known customer. Without an event: active, priced card products. Returns `{enabled, public_purchase, products:[{id, name, type, price_agorot, units, validity_mode, validity_days}]}`; `enabled` = the server switch (passed in by the server) and the `purchase-terms` page is published and, for a guest, `public_online_purchase` (work manager, 2026-11-20: no purchase without published terms). Called from `actions.ts` loaders (pages may import an action; never `lib/server/privileged`). An exported `"use server"` loader is a public endpoint anyone can POST with any `p_event_id`: acceptable only because it reads, and it never takes a uid from its input (the uid comes from the verified claims on the server).
- **Where to buy:** `/me/sessions/[id]` when the preview is `NO_MATCHING_ENTITLEMENT` (and the blocked notice's action becomes "לרכישה"); the public session page for a guest only when enabled; "רכישת כרטיסייה" at the top of `/me/purchases` and on a card detail that is used up or expired.
- **Purchase terms:** a new legal page `purchase-terms` (migration inserts the unpublished `content_pages`/`content_sections` rows, empty `legal_text`), edited in the existing content editor, route `/purchase-terms`, footer link. Its text is Tal's (6.4). The sheet's checkbox links to it.
- **Pending page:** `/pay/pending?c=<id>` (PR A's return path gains `?c=`): no timer; one link "לבדוק שוב" to `/pay/return?c=<id>`.
- **Cookie entries end with the outcome:** the return and failure routes remove the entry on any final outcome (join token issued, known customer paid, failed, expired, issue); only open, pending or paid-awaiting-join entries remain.
- **"Continue joining" banner:** a server component in the public layout and in `/me` (own `<Suspense>`), shown when the cookie holds an entry; text "יש לך רכישה שעוד לא הושלמה." and link "להמשך" to `/pay/return?c=<newest id>`. Cookie parsing moves to a pure `lib/payments/checkout-cookie.ts`.
- **Success notice (user, 2026-11-20; no separate thank-you page):** a known customer's paid return goes to `/me/bookings?payment=paid` (pinned, booked) or `/me/purchases?payment=paid` (card), with the persistent notice "התשלום התקבל ונרשמת למפגש." or "התשלום התקבל והכרטיסייה נוספה לחשבון שלך." respectively. A new customer still goes straight to the join form.
- **Parked purchase of a known customer:** `checkout_return` also returns `booked boolean`; paid and not booked goes to `/me/bookings?payment=no_place`.
- **Preview reachability (work manager, 2026-11-20):** no bypass secret in any URL. Preview stays behind our Basic Auth lock; the user turns off Vercel's own Deployment Protection for Preview during the sandbox run (no code), and may turn it on again after.
- **Parked notice only on screen:** no push for a parked purchase (work manager, 2026-11-20).
- **Guest payer fields (pre-approved):** only if the Grow sandbox form does not ask for name and email itself, the guest sheet adds name and email fields; they go to Grow only and are never stored by us.
- **Terms in dev for the sandbox run:** a clearly marked test text is published on `purchase-terms` in the dev DB only for the run and unpublished after; it is never copied to production (6.1 content copy excludes it until Tal writes the real text).
- **Copy (exact, customer):** sheet title "רכישה ותשלום"; checkbox "קראתי ואני מסכימה ל" + link "תקנון הרכישה"; button "למעבר לתשלום"; hold line for a pinned product "המקום נשמר לך עד סיום התשלום."; pending "התשלום שלך בבדיקה. זה לוקח בדרך כלל דקה." + "לבדוק שוב"; notices by `payment`: failed "התשלום לא הושלם ולא חויבת. אפשר לנסות שוב.", expired "עבר הזמן לתשלום והמקום שוחרר. אפשר להתחיל מחדש.", issue "התשלום התקבל. נחזור אלייך בקרוב כדי להשלים את ההרשמה." with "צרי קשר", no_place "התשלום התקבל, אבל המקום במפגש כבר נתפס. נחזור אלייך כדי לבחור מפגש אחר או החזר." with "צרי קשר". No "טל".
- **Admin copy:** every `online_payment_issue` reason gets a title and one plain sentence of what to check in Grow; `late_document` and `second_payment` show the reference, the Grow document id and the earlier issue. `online_payment_unconfirmed` explains: "Grow דיווחו על תשלום שלא אומת. אם התשלום מופיע ב-Grow, הוא ייכנס לבד תוך כמה דקות. לפני אישור ידני צריך לסגור את הפריט." Actions: "סימון כטופל" (`admin_resolve_online_payment_issue`) and "סגירה" (`admin_close_unconfirmed_checkout`), both OnlineButton through the existing attention action pattern.
- **Settings:** three rows in the business settings editor: "חלון תשלום (דקות)", "תוספת שמירת מקום (דקות)", and a switch "רכישה באתר הציבורי"; a boolean field type is added to the editor.

### Decisions after review (work manager for the user, 2026-11-20)

- **Banner:** shown only for a checkout that is paid and not yet joined, created within the last 24 hours, checked in the DB (read only) through a loader; otherwise nothing. Open, failed or expired checkouts never show it. Shared-device risk stays only for a paid guest within 24 hours (guests buy only while `public_online_purchase` is on). **Approved by the user (2026-11-20): most purchases are made on a phone.**
- **Outcome notices only from a real return:** the pay routes set a short httpOnly cookie (one minute) with the outcome; a page shows a `?payment=` notice only when that cookie matches the parameter. A forged link shows nothing.
- ~~**Failed or expired with no document on the browser return is final.**~~ Reversed in pass 2 (work manager, 2026-11-20): `/pay/return` is Grow's success URL, so a checkout with no document there is always pending (failed or expired included), the entry stays, and reconciliation lands the payment. "לא חויבת" appears only from Grow's failure URL. Pending ends: more than 30 minutes after the checkout's `pay_until` + grace with still no document, the return shows "לא מצאנו תשלום על הרכישה הזו. אם חויבת, צרי קשר ונבדוק." with "צרי קשר" (never "לא חויבת"), and the entry is removed; a later landing reaches Tal as usual.
- **Pass 2 fixes:** options count the caller's own open hold on the same session as available (no false "full" for her re-buy); an `issue` checkout with no payment (e.g. closed by Tal) shows "נחזור אלייך בקרוב לגבי הרכישה." with "צרי קשר", never "התשלום התקבל" (`checkout_return` returns `has_payment`); the banner is not shown once `join_issued_at` is older than 10 minutes.
- **Card copy:** expired "עבר הזמן לתשלום. אפשר להתחיל מחדש."; issue "התשלום התקבל. נחזור אלייך בקרוב כדי להשלים את הרכישה." with "צרי קשר". The session copy stays as above.
- **Returns of a known customer** with a session go to `/me/sessions/<id>?payment=…` (notice there); a known customer's card issue goes to `/me/purchases?payment=issue`. Notices sit at the top of the page.
- **Guest path refuses a signed-in caller** (`NOT_AUTHORIZED`). The server sets `eventId` to null for a card product.
- **Options:** a pinned product is listed only if `plan_pinned_placement` allows it (fits, not full, not already booked, intro); no buy entry at all when the session's registration is closed; `products` is empty when `enabled` is false.
- **`booked`** ignores cancelled bookings; a missing `booked` reads as booked.
- **Production content copy** skips `purchase-terms` unless an explicit flag is passed.
- **Settings switch** uses the 24px checkbox (DESIGN), not a switch. `TERMS_REQUIRED` says "תקנון הרכישה". Admin "unconfirmed" uses one verb ("לא אומת"); close button's accessible name "סגירה: X".
- **Ticket id 17** is marked done only after the sandbox run passes.

## Boundaries & Constraints

**Always:** screens start with the `frontend-design` skill inside DESIGN.md / EXPERIENCE.md (bottom sheet as dialog, initial focus on title, visible X; money results as a persistent `inline-notice`, never a toast; no timer on screen; checkbox per DESIGN tokens; confirm in the thumb zone). Every write or pay button is `OnlineButton`. A fresh idempotency key per sheet opening. No "טל" in customer copy. Money via `formatAgorot`. Logical RTL classes only. New codes only in `lib/errors.ts`. Switch off (or Grow vars missing): every new customer surface is absent and today's screens are unchanged.

**Never:** purchase-terms text in code; changes to how PR A verifies or records payments beyond `booked` in `checkout_return`, the `?c=` on the pending path and the cookie-entry removal; production env changes; real cards.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Switch off | any page | no sheet, no button, no banner; screens as today | — |
| Terms not published | switch on, `purchase-terms` unpublished | `enabled=false`: no buy entry anywhere | — |
| Customer without entitlement | `/me/sessions/[id]`, blocked `NO_MATCHING_ENTITLEMENT` | notice action "לרכישה" opens the sheet with the session's products | none fit → today's contact |
| Guest, public off | public session page | today's "התחברי או צרי קשר" | — |
| Guest, public on | public session page | sheet with the products; pay redirects to Grow | `CHECKOUT_TOO_MANY`, codes → inline notice in the sheet |
| Terms not ticked | press pay | button aria-disabled, reason in `aria-describedby` | — |
| Intro not eligible | known customer | intro not listed | — |
| Card purchase | `/me/purchases`, used-up or expired card | "רכישת כרטיסייה" opens the sheet with card products, no hold line | — |
| Return pending | `/pay/pending?c=` | pending copy + "לבדוק שוב" | — |
| Return outcomes | `?payment=failed/expired/issue/no_place` | the matching persistent notice | unknown value ignored |
| Success URL, no document yet | `/pay/return` on a failed/expired/open checkout | pending, entry kept; after `pay_until` + grace + 30 min: neutral "לא מצאנו תשלום…" + "צרי קשר", entry removed | never "לא חויבת" |
| Paid, known customer | pinned booked / card | `/me/bookings?payment=paid` or `/me/purchases?payment=paid` with the success notice | — |
| Banner | cookie has an open/paid-unjoined entry | banner with "להמשך" | entry removed at the final outcome |
| Attention | each new kind/reason | title, sentence, reference, Grow doc id, earlier issue, action | action errors via `lib/errors.ts` |
| Settings | change window / grace / switch | saved with old → new, audited | out of range → field error |

</frozen-after-approval>

## Code Map

- `lib/server/privileged/checkout.ts` -- `startCheckout` (128/167), `returnPathFor` (460), `closedPathFor` (447), `failFromPayment` (530), cookie helpers (71/96, `CHECKOUT_COOKIE` 51); add `?c=` to the pending path and entry removal on final outcomes; move pure cookie parsing to `lib/payments/checkout-cookie.ts`.
- `app/(public)/pay/return/route.ts`, `pay/failed/route.ts` -- set the trimmed cookie on the response.
- `components/public/public-sessions.tsx` (`PublicSessionAction` 154-199), `app/(public)/sessions/[id]/page.tsx` (add `searchParams`) -- guest buy and notices.
- `app/me/sessions/[id]/booking-panel.tsx` (blocked 180-201; sheet pattern 229-328), `booking-preview.ts` (`blockedAction` 121), `app/me/sessions/[id]/page.tsx` -- customer buy.
- `app/me/purchases/page.tsx`, `app/me/purchases/[id]/page.tsx` (105-160), `app/me/purchase-items.ts` (`pastStatus` 122) -- card purchase and notices.
- `app/me/bookings/page.tsx` -- `no_place` notice.
- `app/(public)/layout.tsx` (66-82), `app/me/layout.tsx` (57) -- banner.
- `app/admin/(shell)/home-items.ts` (`toAttentionItem` 167, `toAttentionItems` 371, `AttentionRow` 25, `AttentionAction` 57), `attention/attention-action.tsx` (31), `attention/actions.ts`, `lib/copy/admin.ts` (`items` 1188) -- attention copy and actions.
- `app/admin/(shell)/settings/settings-draft.ts` (11, 35, 39, 62, 210), `settings-editor.tsx` (117, 133-234), `actions.ts` (44); `products/product-fields.tsx` (`IntroOnlyField` 285), `components/ui/switch.tsx` -- settings rows.
- `lib/content/schema.ts` (343, 413), `lib/content/pages.ts` (186), `app/admin/(shell)/content/content-items.ts` (65-66, 97-98), `lib/seo/page-seo.ts` (31), `outline.ts` (205/233), `sitemap.ts` (30), `lib/nav.ts` (95-103), `app/(public)/terms/page.tsx` -- purchase-terms page; `supabase/migrations/20261006110524_legal_pages.sql` -- seed pattern.
- `lib/payments/online-config.ts` (`onlinePaymentsEnabled` 76) -- switch.
- `lib/copy/customer.ts`, `lib/errors.ts` (215-234) -- copy and codes.
- Guide logs: `C:\Users\ligal\Desktop\Projects\בראנצ' תיקיות משיקות\brunch-guide\guide-additions.md`, `...\brunch-videos\tal-admin-video\video-additions.md` (outside the repo).

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<new>` -- `get_purchase_options` (+ grants), `checkout_return` returns `booked` (create or replace from the live definition), insert the `purchase-terms` page and section rows; regenerate types; `grants.test.ts`.
- [ ] `lib/payments/checkout-cookie.ts`, `lib/server/privileged/checkout.ts` (+ tests) -- pure cookie helpers; pending `?c=`; entry removal on final outcomes; `no_place` path.
- [ ] Start with the `frontend-design` skill. `components/shared/purchase-sheet.tsx` (+ test) -- product list, hold line, terms checkbox, OnlineButton, codes as inline notice, redirect to the Grow URL.
- [ ] `app/me/sessions/[id]/actions.ts`, `app/(public)/sessions/[id]/actions.ts`, `app/me/purchases/actions.ts` -- options loader and start actions (customer uid from claims; guest).
- [ ] Session pages, purchases, bookings, layouts -- buy entry points, notices, banner (Decisions).
- [ ] `app/(public)/pay/pending/page.tsx` -- pending page.
- [ ] Purchase-terms page, editor entry, nav, SEO.
- [ ] Settings editor -- boolean type and three rows.
- [ ] Attention -- copy, fields, two actions.
- [ ] `supabase/tests/online-payments.test.ts`, unit tests -- every matrix row; options RPC (event, card, intro hidden, guest off).
- [ ] Guide and video logs (outside the repo) -- the settings rows, the attention items and the purchase-terms page.
- [ ] `tickets.toml` -- id 17 `status = "done"`.

**Acceptance Criteria:**
- Given the switch is on with sandbox vars on Vercel Preview, when a guest and a logged-in customer each buy a pinned product and a card with Grow's success test card, then each purchase lands once (one payment per document), the guest reaches `/join/<token>` and the customer her area.
- Given Grow's failure test card, when the payment fails, then the session page shows the failed notice and the hold is released.
- Given the first sandbox payment, then the notification payload shape is recorded in Implementation Notes, `s=` never appears in the browser (source or network), and the morning document's status value is recorded (closed vs not cancelled).

## Spec Change Log

- 2026-11-20, review pass 1 (9 lenses: blind, edge-case, verification-gap, intent, money, security, matrix, UX/accessibility, adversarial). No purchase possible when it should not be, no wrong amount, no XSS, no uid from input. Triggers: banner on unpaid checkouts and shared-device join takeover (security 1, adversarial F1/F2, blind, edge, UX); forged `?payment=` notices including a false "לא חויבת" (security 3, adversarial F3, edge); failed/expired stuck as pending (edge, verification-gap, matrix); guest path for signed-in callers (money 2, adversarial F5, edge); full/closed/booked sessions offered (blind, edge, money 3); card copy about a seat (UX 5, money 1); known customer returned to the public page (intent, UX 4). Amended: "Decisions after review". No revert: additive fixes on the existing code (work manager). KEEP: server re-check of the product against the options, uid only from claims, kill switch before any call, persistent inline notices, the sheet's dialog semantics.

- 2026-11-20, review pass 2 (focused security + adversarial). Security: nothing medium or high. Adversarial: **decision 3 (failed/expired final on the browser return) is reversed** — /pay/return is Grow's success URL, so a payment whose document lags behind a checkout already failed (second tab) or expired (slow form) was told "לא חויבת, אפשר לנסות שוב" after a real charge and a guest lost her way to join; now pending with an end after 30 minutes and neutral copy (work manager). Also: own hold no longer blocks her re-buy; issue without payment gets neutral copy; banner hidden after the 10-minute re-issue window. Rejected (low): one-minute notices, two outcomes within one minute, eviction among 5 cookie entries. PR B closes after this pass; later findings go to deferred, target "הדלקת הסליקה".

## Review Triage Log

Pass 1, 2026-11-20. All findings routed to patch except those listed as rejected.

| # | Finding (lenses) | Verdict | Route | Action |
|---|---|---|---|---|
| 1 | Banner on unpaid checkouts; shared-device join takeover (security, adversarial, blind, edge, UX) | high | patch (decision) | Paid-unjoined, 24 h, DB check |
| 2 | Forged `?payment=` shows money messages (security, adversarial, edge) | medium | patch (decision) | One-minute outcome cookie |
| 3 | Failed/expired stay pending forever (edge, verification-gap, matrix, adversarial) | medium | patch (decision) | Final on return |
| 4 | Signed-in caller uses the guest path (money, adversarial, edge) | medium | patch | Refuse |
| 5 | Full, booked or closed sessions offered (blind, edge, money) | medium | patch | Options use placement; closed hides entry |
| 6 | Card copy mentions a seat or a registration (UX, money) | medium | patch | Card variants |
| 7 | Known customer returned to the public page; card issue to `/` (intent, UX) | medium | patch | `/me` paths |
| 8 | Notice below the fold on the public session page (UX) | medium | patch | Top of page |
| 9 | No offline hint on public pages (UX) | medium | patch | Mount the offline banner |
| 10 | Sheet stuck busy after Back (blind, edge, UX) | low | patch | `pageshow` reset |
| 11 | Disabled reason always the terms (blind, edge) | low | patch | Reason matches the cause |
| 12 | Server keeps `eventId` for a card (blind) | low | patch | Null for days products |
| 13 | `booked` counts cancelled bookings; missing `booked` reads as no place (blind, verification, edge) | medium | patch | SQL + default |
| 14 | Products returned when disabled (security, verification) | low | patch | Empty list |
| 15 | Prod content copy does not skip `purchase-terms` (blind) | medium | patch | Skip unless flagged |
| 16 | Ticket done too early (intent, blind, edge) | low | patch | Done after sandbox |
| 17 | Copy/a11y nits: terms name, verbs, label-in-name, new-tab note, SheetTrigger, contact link in sheet, punctuation, switch vs checkbox (UX, blind) | low | patch | As listed |
| 18 | Missing tests: open sheet, admin buttons, page gating, BOOLEAN_FIELDS, kind/weekday, empty terms, settings audit, no push on park (matrix, verification-gap) | medium | patch | Tests added |

Rejected: loader rate limit (read only); price change between load and pay (Grow shows the amount); terms-unpublish race (milliseconds); footer terms link while off (published only by Tal); "לבדוק שוב" feedback (moot after #3).

## Design Notes

The sheet reuses BookingPanel's Sheet: title focus, X, `dl` summary, one main action. The "continue joining" banner (after review) checks each cookie entry once in the DB through the read-only `checkout_banner_state` (at most 5 entries) and shows only a paid, unjoined checkout under 24 hours; `/pay/return` still decides the real state.

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` -- pass.
- `npm run test:db` (only after the work manager's "אפשר test:db") -- pass.

**Manual checks:**
- Vercel Preview end-to-end against the Grow sandbox (Acceptance Criteria). Mandatory last step: unpublish the dev test text and confirm `/purchase-terms` in dev is unpublished again.
- Phone check on a LAN dev server from the worktree.

## Implementation Notes

Build (2026-11-20, before the sandbox run):
- Migration `20261120191002_online_payments_screens.sql`: `get_purchase_options` (service_role; `enabled` = terms published with a body AND (customer OR `public_online_purchase`); the server ANDs it with the kill switch and never calls it while off), `checkout_return` + `booked` (from fixes_3), the `purchase-terms` page/section rows and the `seo/purchase_terms` record (seeded published with the H1, like `seo_content`). Not applied (work manager); `database.types.ts` and `grants.test.ts` hand-updated.
- `startPurchase` (checkout.ts) is the sheet's only entry: it re-reads the options and refuses a product the sheet would not offer (`PRODUCT_NOT_PURCHASABLE`) or a disabled purchase (`ONLINE_PAYMENTS_OFF`), so unpublished terms block a direct POST too. `startCheckout` unchanged.
- Return paths: pending is `/pay/pending?c=`; a known customer's paid return gets `?payment=paid` (or `no_place` when `booked` is false); every final outcome (and `CHECKOUT_NOT_FOUND` for a cookie entry) removes the entry; open/pending/DB errors and "paid on the failure URL" keep it.
- A guest's non-pinned failure lands on `/?payment=…` (PR A path), so the home page shows the notice too (own `<Suspense>`). `/pay/:path*` added to `NOINDEX_SOURCES`.
- Guest payer fields not added (pending the sandbox form check).

Review pass 1 fixes (2026-11-20):
- Migration `20261120194744_online_payments_screens_review.sql`: `get_purchase_options` (pinned only via `plan_pinned_placement`, empty list when disabled or the session's registration closed), `checkout_return.booked` ignores cancelled bookings, new read-only `checkout_banner_state(p_checkout_id, p_browser_secret)` → `{show}` (paid, payment approved and unbound, created < 24 h; service_role).
- Banner: `app/(public)/pay/actions.ts › loadCheckoutBanner` → `checkoutBannerId` (the newest qualifying cookie entry).
- Outcome cookie `bt_payment_outcome` = `<payment>.<card|session>`, httpOnly, 60 s, set by `paymentRedirectResponse`; pages read it with `lib/payments/payment-outcome.ts › readPaymentOutcome`; the kind picks the card wording.
- The sheet's state is a pure reducer (`lib/payments/purchase-sheet-state.ts`); `PurchaseSheetBody` is the open content (the tests render it).
- The production content copy and `prod-check` skip `purchase-terms` (page, section, `seo/purchase_terms`) on both sides unless `--include-purchase-terms` is passed.

Review pass 2 fixes (2026-11-20):
- Migration `20261120204450_online_payments_screens_review_2.sql`: `get_purchase_options` lists a pinned product refused only as `EVENT_FULL` when the customer's own open hold on the session covers its places; `checkout_return` adds `has_payment` (a payment, or an issue with a morning document) and `pending_over` (now > coalesce(hold_until, pay_until + grace) + 30 min); `checkout_banner_state` requires `join_issued_at` null or within 10 minutes.
- `/pay/return`: open, failed and expired stay pending (entry kept) until `pending_over`, then `?payment=not_found` ("לא מצאנו תשלום על הרכישה הזו. אם חויבת, צרי קשר ונבדוק.") and the entry removed; an issue with `has_payment` false (and any issue on the failure URL) → `?payment=review` ("נחזור אלייך בקרוב לגבי הרכישה."). Only `/pay/failed` says "failed".
