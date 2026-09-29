# Rubric review: ARCHITECTURE-SPINE.md (update 2026-09-29)

- Reviewer: independent rubric lens (read-only on everything but this file)
- Date: 2026-09-29
- Scope: whole spine, with close attention to commit 548869d (online-payment readiness: `private.approve_payment_core`, `payments.source/provider/provider_transaction_id`, `payment_methods`, Deferred clearing round)
- Read: ARCHITECTURE-SPINE.md, its .memlog.md, SPEC.md, data-model.md, security-and-rpc-rules.md, online-payments.md, notification-matrix.md, site-map.md, build-sequence.md, glossary.md, acceptance-criteria.md (payment lines), EXPERIENCE.md (payment rows), brunch_at_tal_charecter.md (§1, §2, §6 payment/refund passages)

## Verdict

The spine is in good shape overall: every CAP-1..CAP-42 has a row in the Capability map, the paradigm and the 23 ADs are specific and mostly enforceable, and deployment/infra/operations are each decided, deferred or open. The 2026-09-29 change is directionally right (one approval core, admin-editable methods, clearing deferred), but the new seam is under-specified in exactly the places the clearing round will lean on, one Deferred item contradicts a binding AD (idempotency key type), and seat counting has no single owner even though the Deferred "hold" state must extend it. Two spec companions still name the removed `admin_notifications` table, and data-model drifts from the spine on the credit origin column.

Counts: critical 0 · high 4 · medium 8 · low 8

---

## Critical

None.

---

## High

### H1. Deferred clearing round uses the provider transaction id as the idempotency key, but AD-5 fixes the key as `uuid`

- **Location:** Deferred › "סליקה מקוונת" ("…ומזהה העסקה כמפתח idempotency (AD-5)") vs AD-5 › Idempotency (`p_idempotency_key uuid`, `private.idempotency_results(… key uuid …)`, PK `(actor_scope, rpc, key)`).
- **Problem:** Provider transaction ids are opaque strings, not UUIDs. E2 will build `idempotency_results.key uuid` now. The clearing round then has to either alter a shared table's key type or invent a mapping, and two sessions can pick different mappings (hash to uuid v5, a new text column, or skipping idempotency and relying only on the unique `provider_transaction_id` index). There are also two dedupe mechanisms for the same event (`idempotency_results` and the unique `(provider, provider_transaction_id)`), and nothing says which one is authoritative. That is the "nothing under Deferred could let two units diverge" failure.
- **Fix:** In AD-5 (or the Deferred item), fix the mapping now: "service-role callers with a natural external key derive `p_idempotency_key = uuid_generate_v5(<fixed namespace uuid>, '<provider>:<transaction_id>')` in SQL; `actor_scope = provider:<name>`." State that the unique partial index on `payments(provider, provider_transaction_id) where provider_transaction_id is not null` is the business invariant (backstop), and that `idempotency_results` stays the replay mechanism. Add the index to AD-10's text. Today it is only in the memlog.

### H2. Seat counting has no single owner, but the Deferred "payment hold" must change it everywhere

- **Location:** AD-6 ("ספירת מקומות היא סכום `party_size` של הרשמות `confirmed`"), AD-14 (`get_event_availability`, `notify_waitlist` transitions), AD-18/AD-20 (`book_core`), admin reads (CAP-12/24), Deferred ("הרשמה במצב 'מקום שמור בזמן תשלום' עם `hold_until`, שנספרת במכסה").
- **Problem:** The balance formula has one owner (`entitlement_balances`), but seat occupancy does not. E3/E4 sessions will each write `sum(party_size) filter (where status = 'confirmed')` inline: in `book_core`, `get_event_availability`, `notify_waitlist` before/after, `refresh_credit_options` ("has a place"), the admin session detail, the admin home and the attention list. When the clearing round adds a hold state (a new `bookings.status` value or a `hold_until` column), every copy has to change. A missed copy oversells or mislabels a session, which is the core CAP-13 invariant.
- **Fix:** Add to AD-6 (or AD-14): "Occupancy is computed only by `private.seats_taken(p_event_id) returns int` (and `private.seats_free(p_event_id)`). No SQL outside it filters `bookings` by status to count seats." Also add to AD-23 now that any future non-`confirmed` seat-holding state is counted there and only there, and that it gets a status value in the Consistency Conventions vocabulary first.

### H3. `approve_payment_core` contract is too thin for the clearing seam it exists for

- **Location:** AD-10 › "ליבת אישור אחת" and "אישור תשלום"; AD-18 ("ומממנת רק את `pinned_event_id` שלה, במצב `admin` מתוך `admin_approve_payment`"); AD-23; online-payments.md › "מוצר מוצמד", "לקוחה קיימת".
- **Problems:**
  1. **Signature is `(p_source, …)`.** The parameters that decide behaviour are not fixed: target customer (null for a new customer, id for CAP-6), `p_event_id`, `p_payment_method_id`, amount/override reason, `paid_on`, `p_recorded_by`, provider fields. E2 builds the core, E3 extends it for pinned products, and the clearing round calls it. Three sessions will each reshape it.
  2. **Booking mode is hard-wired.** AD-10 says the core books "דרך `private.book_core` במצב `admin`", and AD-18 names `admin_approve_payment` as the only caller for pinned funding. Admin mode skips registration-close checks (CAP-14). The online flow needs the opposite: self checks (registration open, intro eligibility), and those run *before* the payment page, followed by converting an existing hold, not creating a fresh booking. As written, the seam doesn't fit the flow it was built for, and a builder who hard-codes `admin` makes online bookings bypass closure.
  3. **Customer binding for online is not constrained.** AGENTS.md and AD-3 derive `customer_id` only from `auth.uid()`. A service-role RPC has no `auth.uid()`, so the customer must come from something. Unless the spine says what, the clearing round may trust provider metadata or a return-URL parameter, which online-payments.md itself rejects.
  4. **Who emits notifications and the audit actor.** For `manual`, the audit actor is the admin. For `online`, `recorded_by` is null, but `audit_log.actor_kind` / `actor_id` for that case is unstated (system? customer?).
- **Fix:** In AD-10, state the core's fixed inputs: `p_source`, `p_customer_id uuid null` (supplied only by the wrapper: from admin input for manual, from a server-created checkout/hold row for online, never from provider payload), `p_product_id`, `p_event_id null`, `p_amount_agorot`, `p_amount_override_reason`, `p_paid_on`, `p_payment_method_id null`, `p_recorded_by null`, `p_provider null`, `p_provider_transaction_id null`. Also state: "the booking step is a parameter (`admin` for manual; for online, convert the caller's hold). Checks are the caller's mode, not the core's." Amend AD-18 to read "from `private.approve_payment_core`" instead of "from `admin_approve_payment`". Add to the Deferred item: "the online customer and event are bound by an authenticated RPC that creates the checkout/hold row before redirect; the provider notification only references that row."

### H4. `security-and-rpc-rules.md` (read before every migration, per AGENTS.md) still names the removed `admin_notifications` table

- **Location:** security-and-rpc-rules.md › "מסד הנתונים" line 16 ("התראות אדמין (admin_notifications)…"); also glossary.md line 35 ("מרכז התראות אדמין … | admin_notifications").
- **Problem:** AD-12 removes `admin_notifications` (single `notifications` table with `recipient_kind`), and data-model.md agrees. But AGENTS.md tells builders to read `security-and-rpc-rules.md` before writing any migration/policy/RPC, and gives the spine explicit precedence only over data-model.md, not over this file. A session building CAP-35 can reasonably create `admin_notifications` with its own RLS, which is exactly the "second admin notification system" AD-12 exists to prevent.
- **Fix:** Update security-and-rpc-rules.md line 16 to read "התראות אדמין (`notifications` עם `recipient_kind = 'admin'`, AD-12)…" and glossary.md line 35 to `notifications (recipient_kind = admin)`. Optionally widen the AGENTS.md precedence sentence so the spine wins on technical questions over every SPEC companion, not only data-model.md.

---

## Medium

### M1. data-model.md drifts from the spine on the credit origin column

- **Location:** data-model.md › `cancellation_credits` (`original_cancelled_at`), vs AD-14 › "חלופות זיכוי" and AD-20 (`cancellation_credits.origin_starts_at`).
- **Problem:** CAP-18 counts alternatives from the cancelled session's start, not the cancellation moment. The data-model only carries the cancellation timestamp, which invites the wrong base. The spine wins, but the Deferred item says the schema is built "per data-model.md with the corrections in AD-3, AD-5, AD-12, AD-14, AD-18, AD-19". A builder has to notice that AD-14 quietly adds a column.
- **Fix:** Add `origin_starts_at` to data-model.md's `cancellation_credits` row (keep `original_cancelled_at` if wanted, for display), with "(AD-14: alternatives are counted from it)".

### M2. AD-21 intent states have no home in the data model

- **Location:** AD-21 (`email_change_pending`, `anonymization_pending`, `media_assets.publish_state = copying`); data-model.md (`profiles` has no such state; `media_assets.publication_status`).
- **Problem:** The states are named, but not where they live (a `profiles` column? a separate `account_operations` table?) or the vocabulary. The name also drifts: `publish_state` vs `publication_status`. The E2 (email change) and E5/E6 (anonymization, media) sessions will each pick their own. AD-22's "לטיפול" must query them, so a third session depends on the choice.
- **Fix:** Add to the Consistency Conventions status vocabulary: `profiles.account_op_state` null, email_change_pending, anonymization_pending (+ `account_op_started_at`), or name a single `private.account_operations` table. Rename to one term for media (`media_assets.publish_state` draft, copying, published, hidden) and align data-model.md.

### M3. "The only code that creates payment, entitlement, join token" is literally false and can mislead E6

- **Location:** AD-10 › "ליבת אישור אחת".
- **Problem:** Import (CAP-31) creates entitlements (`opening_balance`) and `claim` tokens. `admin_issue_link` reissues `join` tokens. Read literally, the rule forces import through the payment core (no payment exists) or makes the reissue path look illegal.
- **Fix:** Reword to: "the only code that creates a `payments` row and the entitlement, first `join` token and pinned booking derived from it. Import (`admin_import_*`) and `admin_issue_link` (replacement tokens) are the only other creators of entitlements and tokens, through `private.issue_token`."

### M4. `payment_method_id` nullability per source is undecided

- **Location:** AD-10 ("אמצעי התשלום הוא `payment_method_id` מ-`payment_methods`"); data-model.md `payments`.
- **Problem:** E2 will make `payment_method_id` either NOT NULL, forcing an admin-hideable "card" row that online payments depend on, or nullable without a rule. Either choice constrains the clearing round.
- **Fix:** Add a check constraint to AD-10: `(source = 'manual') = (payment_method_id is not null)`, with a matching `(source = 'online') = (provider is not null)`. That puts online payments' method in `provider`, not in the admin list.

### M5. Renaming a payment method rewrites history

- **Location:** AD-10 (`payment_method_id` FK); admin-configurable-parameters.md ("חל רק על תשלומים חדשים"); EXPERIENCE.md (edit name; "תשלומי עבר ממשיכים להציג אותו").
- **Problem:** Payments reference the method by FK only. Editing a method's name changes the label on every past payment, which contradicts "applies only to new payments" and the audit intent of AD-15 (snapshots).
- **Fix:** Either snapshot `payment_method_name` on `payments` (as part of `product_snapshot` or its own column) at approval, or state explicitly in AD-10 that renaming is a display correction and past payments show the current name. Pick one.

### M6. Cron job failures are not surfaced; only push failures are

- **Location:** AD-22 › "לטיפול" (lists `notification_jobs` failed but not job runs); memlog decision says "Push failures and cron failures surface in admin attention items".
- **Problem:** A failing `job_complete_events`, `job_auto_extend` or `job_expiry_alerts` fails silently: no `reserve→use`, no auto-extension, no alerts. There is no observability tool (Deferred), so the attention list is the only channel, and it doesn't cover this. That is an operations gap that contradicts the recorded decision.
- **Fix:** Add to AD-22's attention sources: "the most recent run of each `private.job_*` in `cron.job_run_details` with `status = 'failed'`, or no successful run within 3× its interval", read by `admin_get_attention_items` (definer). Keep `job_cleanup`'s retention above that window.

### M7. Payment-core rules are filed under the token AD; AD-10 Binds miss the CAPs it now governs

- **Location:** AD-10 heading/Binds (CAP-2, 4, 5, 7, 29, 31) vs content (CAP-6 existing-customer approval, CAP-34 payment methods, CAP-37 pinned booking); Capability map CAP-34 row (no `payment_methods`).
- **Problem:** A session building CAP-6 or the settings screen that scans ADs by Binds won't land on AD-10. AD-10 is also now the longest AD and mixes three concerns (tokens, account creation, payments).
- **Fix:** Split the payment bullets into a new **AD-24: אישור תשלום, מקורות תשלום ואמצעי תשלום**, binding CAP-2, CAP-6, CAP-34, CAP-37, with a pointer from AD-10. The memlog says AD IDs are stable, and adding AD-24 keeps that. At minimum, add CAP-6, CAP-34 and CAP-37 to AD-10's Binds, and add `payment_methods` to the CAP-34 map row.

### M8. "Last visible method" and "hidden vs archived" are ambiguous

- **Location:** AD-10 ("אמצעי שכבר שימש עובר לארכיון ולא נמחק, וה-RPC לא מאפשר להסתיר את האמצעי הגלוי האחרון"); data-model.md (`hidden`, `archived_at`).
- **Problem:** Two flags both remove a method from the approval form. The rule guards "hide" only, so archiving or deleting the last one isn't covered. It also doesn't say whether `admin_approve_payment` rejects a hidden or archived id (a stale form can submit one), and two concurrent hides can both pass the check.
- **Fix:** Define "selectable = `not hidden and archived_at is null`" once (a view or helper). The hide, archive and delete RPCs lock all `payment_methods` rows (`for update`) and reject leaving zero selectable. `approve_payment_core` rejects a non-selectable method with `PAYMENT_METHOD_UNAVAILABLE`.

---

## Low

### L1. Inconsistent list of ADs that correct data-model.md

- **Location:** Spine intro, line 29 ("AD-3, AD-5, AD-14, AD-17") vs Deferred › schema ("AD-3, AD-5, AD-12, AD-14, AD-18, AD-19").
- **Fix:** Use one list. AD-17 doesn't correct the data model. Add AD-8, AD-10, AD-20 and AD-23, which also add or constrain columns.

### L2. `payments.status = voided` has no owning action

- **Location:** Consistency Conventions vocabulary; data-model.md. No `admin_void_payment` RPC, no CAP, and the source doesn't mention voiding.
- **Fix:** Either name the RPC (sensitive, with preview; cascade rules for the entitlement, token and pinned booking) or drop `voided` until a CAP needs it. Refunds already cover money returned.

### L3. The unique index on provider transaction id lives only in the memlog

- **Location:** AD-10 omits it; memlog 2026-09-29 has `(provider, provider_transaction_id)`; data-model says "המזהה ייחודי" (scope unclear).
- **Fix:** State the partial unique index `(provider, provider_transaction_id) where provider_transaction_id is not null` in AD-10 (see H1).

### L4. Vault setup is missing from the environment checklist

- **Location:** AD-22 › "Auth בכל סביבה" (README checklist covers Auth settings only); AD-11 (`app_url`, `cron_secret` in Vault; the job is a no-op without them).
- **Problem:** A new environment (the production project) quietly sends no push if Vault isn't populated.
- **Fix:** Add "Vault `app_url` + `cron_secret`, Vercel `CRON_SECRET`, VAPID pair" to the same README checklist, and add "Vault values missing" as an attention item.

### L5. security-and-rpc-rules.md filters profiles by `auth.uid()`

- **Location:** security-and-rpc-rules.md line 13 vs AD-3 (`private.current_customer_id()`, which is null for non-activated or anonymized users).
- **Fix:** Reword to "פרופיל ותינוקות לפי `private.current_customer_id()`, התראות לפי `recipient_id = auth.uid()`".

### L6. The rate-limiting mechanism is deferred with no single-owner rule

- **Location:** Deferred › "מנגנון הגבלת הקצב".
- **Problem:** It's fine that the mechanism is chosen in E2, but nothing says it is one module. Join, claim, reset and login could each get their own limiter.
- **Fix:** Add "one helper (`lib/server/privileged/rate-limit.ts` or a `private.rate_limit_hit` RPC) used by every token/login action".

### L7. AD-1 Binds omit CAP-34 and CAP-35..42 writes

- **Location:** AD-1 Binds (stops at CAP-34 minus several). The rule itself covers "every admin write".
- **Fix:** Add CAP-3 (already there), CAP-34, CAP-36, CAP-37, CAP-38, CAP-39, CAP-40 and CAP-41, or replace the Binds with "every mutating CAP".

### L8. The Deferred clearing item extends SITE_LOCKED exemptions without updating AD-22

- **Location:** AD-22 ("חוץ מ-`/api/jobs/push`") vs Deferred (the payment route is "פטור מ-SITE_LOCKED").
- **Fix:** Reword AD-22 to "exempt only machine-to-machine routes under `/api/jobs/**` and `/api/payments/**`, each authenticated by its own secret or signature". That fixes the pattern now, so proxy matchers aren't hand-edited per route.

---

## Checklist summary

| Criterion | Result |
| --- | --- |
| Fixes the real divergence points, none missed | Mostly. Gaps: seat-count owner (H2), core contract (H3), AD-21 state storage (M2) |
| Every AD Rule enforceable and prevents its divergence | Yes, except AD-10's payment bullets (H3, M4, M8) |
| Nothing under Deferred lets two units diverge | No: clearing-round idempotency key (H1) and hold state (H2) |
| Covers every CAP-1..CAP-42 | Yes, every CAP has a map row. Binds gaps are cosmetic (M7, L7) |
| Deployment, infra and operations each decided, deferred or open | Yes. The operations gap is cron failure visibility (M6) and Vault checklist (L4) |
| data-model.md agrees with spine | Drift: `origin_starts_at` (M1), `publish_state`/`publication_status` (M2), unique index scope (L3) |
| No stale references | `admin_notifications` in security-and-rpc-rules.md and glossary.md (H4). No stale names in the spine itself |
