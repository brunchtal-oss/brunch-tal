---
title: '3.18 Eligible products per session'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'ab8e648ea05a9f324db869ea3d7b0ea00b6dcbf3'
route: 'full'
route_source: 'pinned'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Source §7 lists "eligible products" as a session field, but it was deferred on 2026-10-04 (memlog, 3.1): funding matches only kind, weekday and intro (AD-18), so Tal cannot say which products a session accepts.

**Approach:** Table `event_products`, edited in the session editor (create and edit, `ValueChangeRow`, audited old and new), and one helper `private.event_accepts_product(event_id, product_id)` that every eligibility path calls. New bookings only; existing bookings, entitlements and credits are untouched. Prices stay as today (decision 3 below).

## Boundaries & Constraints

**Always:**
- `event_products(event_id, product_id)`, PK on both, FKs, index on `product_id`, RLS. Writes only inside the event RPCs (definer). Select: authenticated with `is_admin()` only; anon none. Explicit grants for authenticated and service_role (AD-5).
- One definition: `event_accepts_product` is called by `entitlement_fits_event` (product = `eligibility_snapshot->>'product_id'`) and by both entitlement queries in `plan_funding`. Callers and effect:
  - `plan_funding`, so `book_session(s)`, `admin_book_customer`, `move_booking` (`move` mode), every preview, and `admin_list_customer_bookable_events` (3.19 hides the session; its "hidden" copy stays).
  - `week_has_eligible_session`, so `job_auto_extend`: a week whose sessions all exclude the card's product extends it (CAP-36).
  - `plan_admin_correct_entitlement`: same check on old and new, so the affected list is unchanged.
  - `admin_get_attention_items` (`correction_affected`, not redefined): an already-warned booking stays listed while its card still does not fit, now including the product.
- `plan_funding` failure codes: an entitlement that passes every rule but the product returns new `PRODUCT_NOT_VALID_FOR_EVENT`; then `ENTITLEMENT_EXPIRED_ON_DATE` (its existence check includes the product); else `NO_MATCHING_ENTITLEMENT`.
- `admin_create_event` and `admin_update_event` accept `product_ids` (array of distinct uuid strings, may be empty). Each must be a product whose `eligible_event_kind` equals the session's kind (active or hidden), else `INVALID_INPUT` field `product_ids`. Allowed with bookings. A changed set writes its own audit row: entity `event_products`, `event_id` set, before/after `{product_ids, product_names}` (names sorted). `admin_duplicate_event` copies the set, with the same audit row.
- Editor field "מוצרים תקפים": checkboxes of active products of the session's kind, plus hidden ones of that kind that are selected or still have an active entitlement, those suffixed " (לא נמכר)". Hint: "בלי סימון, כל מוצר שמתאים לסוג המפגש תקף בו." Empty value text: "כל המוצרים המתאימים". Edit uses `ValueChangeRow` (names joined with ", ").
- Decisions (user, 2026-10-20). Example: a holiday brunch with a guest chef at 180 ₪, where Tal marks only the product "בראנץ׳ חג":
  - (1) No product marked means every fitting product, as today.
  - (2a) Pinned products obey it. `private.plan_pinned_placement` returns `EVENT_NOT_FIT`. `admin_list_bookable_events` returns each event's `product_ids`, and `eventOptionsFor` (`app/admin/(shell)/payments/new/event-options.ts`) hides events that do not accept the product.
  - (2b) Credits obey it too, with the credit's product taken from its `source_entitlement_id`. `move_option_candidates` and `refresh_credit_options` skip sessions that do not accept it. An option that stops fitting is replaced by the next session, like a full one. `plan_funding` step (1) checks it too.
  - (3) No default price: the session page (public and personal area) shows a price only when Tal enters `display_price_agorot`, as today. The deferred item is closed as decided against.
- Customer message `PRODUCT_NOT_VALID_FOR_EVENT` in `lib/errors.ts`: "המפגש הזה לא כלול בכרטיסייה שלך." It gets no contact action.
- Audit copy (`lib/copy/audit-actions.ts`): an `event_products` rule under `admin_create_event`, `admin_update_event`, `admin_duplicate_event`, shown, result "המוצרים התקפים: {names}" or "המוצרים התקפים: כל המוצרים המתאימים".
- Screens start with the `frontend-design` skill, inside DESIGN.md and EXPERIENCE.md. Save buttons are the existing `OnlineButton`-based ones.

**Never:** change existing bookings, entitlements or credits (other than option replacement in 2b); touch `admin_get_attention_items`, 4.6 anonymization functions, `job_intervals` or 5.11 jobs (stop and ask if needed); a `drop`; a new sensitive action; product management changes (2.6); "טל" in customer copy; `←` in any screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| No product marked | session with no rows | as today: every fitting product |
| Card excluded, self | only "בראנץ׳ רגיל" marked, customer has a fitting card | preview and book: `PRODUCT_NOT_VALID_FOR_EVENT`, no place taken |
| Card excluded, Tal | same, `admin_book_customer` / manual booking list | same code; session not offered, counted in "hidden" |
| Card marked | card product marked | books from the card |
| Existing booking | booked, then card unmarked | booking stays confirmed, allocations unchanged |
| Move | card booking moved to a session excluding the card | refused with the code; source kept |
| Expired and excluded | card expired on that date and excluded | `PRODUCT_NOT_VALID_FOR_EVENT` |
| Pinned | approving a "בראנץ׳ רגיל" payment for a session marked only "בראנץ׳ חג" | not offered in the picker; RPC `EVENT_NOT_FIT` |
| Credit | credit from a "בראנץ׳ רגיל" booking; the next session is marked only "בראנץ׳ חג" | skipped in its options; booking it with the credit refused |
| Auto-extend | week's only session excludes the card | card extended 7 days |
| Wrong kind | couple product sent for a regular session | `INVALID_INPUT` field `product_ids` |
| Same set saved | unchanged `product_ids` | no audit row |
| Customer write | authenticated insert into `event_products` | denied |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new file. Redefine from live `pg_get_functiondef`: `private.entitlement_fits_event` (20261018212133), `private.plan_funding` (20261013161248), `public.admin_create_event` (20261005111717), `public.admin_update_event` (20261019233604, keep the 5.6 waitlist lines), `public.admin_duplicate_event`, `private.plan_pinned_placement`, `public.admin_list_bookable_events`, `private.move_option_candidates` and `private.refresh_credit_options` (20261019204039). `week_has_eligible_session` needs no change (it calls `entitlement_fits_event`). Reuse `private.apply_event_changes`, `private.save_event`, `private.audit`, `private.idempotent_begin/finish`.
- `app/admin/(shell)/sessions/actions.ts` -- `createEventAction` :20, `updateEventAction` :37 (shape check for `product_ids`).
- `app/admin/(shell)/sessions/session-draft.ts` -- `createPayload` :233, `EditorField` :381, `fieldChange` :384, `draftFromRow` :162, `SessionRow` :52.
- `app/admin/(shell)/sessions/new/session-create-form.tsx` (:62), `new/page.tsx` -- add the field; load products.
- `app/admin/(shell)/sessions/[id]/edit/session-editor.tsx` -- `DRAFT_KEYS` :48, `fieldRow()` :129; `edit/page.tsx` :61 and `load-session.ts` `SESSION_COLUMNS` :11 (embed `event_products(product_id)`).
- `components/admin/value-change-row.tsx` -- reuse as is. Checkbox pattern: `WeekdaysField` in `app/admin/(shell)/products/product-fields.tsx` :185; `components/ui/checkbox`.
- `app/admin/(shell)/payments/new/form-data.ts` :22 -- product query to copy (do not refactor it).
- `lib/errors.ts` :58-60; `app/me/sessions/[id]/booking-preview.ts` `blockedAction` :120.
- `lib/copy/audit-actions.ts` :232-235; `lib/copy/admin.ts` (session editor copy).
- `supabase/tests/grants.test.ts` (`EXPECTED_GRANTS`), `supabase/tests/support/db.ts`.
- Do not change: `admin_get_attention_items`, `book_core`, `cancel_core`, `lib/sessions/public.ts`, the price line in `components/public/public-sessions.tsx` and `app/me/sessions/[id]/page.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_eligible_products.sql` -- table, RLS, grants, helper, redefinitions above -- **main session**: user runs it in SQL Editor, session records it in `schema_migrations`, then `get_advisors` and `generate_typescript_types` into `lib/supabase/database.types.ts`.
- [x] `lib/errors.ts` -- the new code, with no contact action in `booking-preview.ts`.
- [x] `app/admin/(shell)/payments/new/event-options.ts` (+ its parsing in `form-data.ts`) -- hide events that do not accept the product; unit test.
- [x] `session-draft.ts`, `actions.ts`, create form and page, editor and page, `load-session.ts`, `lib/copy/admin.ts` -- the field (start with `frontend-design`).
- [x] `lib/copy/audit-actions.ts` -- the `event_products` rules and result.
- [x] `supabase/tests/eligible-products.test.ts` -- every matrix row, plus the 3.19 list and the audit row; `grants.test.ts` -- new table and grants.
- [x] unit tests for `fieldChange`/`createPayload` with `product_ids`.
- [x] `deferred-work.md` -- close the `event_products` item as built and the default-price item as decided against (2026-10-20); `.memlog.md` of the SPEC -- the 2026-10-04 deferral is lifted, and decisions 1-3 (3 overrides CAP-12's "ברירת מחדל: מחיר המוצר המתאים"); `completion-plan-2026-10-10.md` and the 3.18 entry in `epic-sessions-and-booking/tickets.toml` -- the default price is out (user's decision 2026-10-20).

**Acceptance Criteria:**
- Given a session edited from "all" to one product, when saved, then the audit log shows the old and new product names and the session list still loads.
- Given the edit page of a session with bookings, when the products change, then the save succeeds and no booking changes.

## Implementation Notes

- Migration `20261020200233_eligible_products.sql` run by the user in the SQL Editor on 2026-10-20, recorded in `schema_migrations`; advisors clean (only the approved 0029 and leaked-password WARNs); types regenerated.
- Also redefined `private.move_card_code` and `private.move_target_code`: card moves do not go through `plan_funding`, so the Move matrix row needed them.
- Credit options that stop fitting are replaced with `replaced_reason = 'full'` (a new reason would need a `drop` of the check).
- Audit result on edit reads "המוצרים התקפים: X (קודם: Y)", so the old names show too (AC 1).
- A credit-only customer gets `NO_MATCHING_ENTITLEMENT` on an excluded session: the preview refreshes her credits first and the option is already replaced.
- Main session: the session editor's price hint said "מחיר תצוגה ריק: מוצג מחיר המוצר", which contradicts decision 3; now "בלי מחיר תצוגה, לא מוצג מחיר במפגש".
- A product-set edit replaces a credit option at once (`refresh_credits_for_event`, `p_fill false`, as a capacity change does); the next session is filled by `job_refresh_credit_options` (15 minutes) or the customer's next view.
- Review patches: Tal-worded `PRODUCT_NOT_VALID_FOR_EVENT` in `bookRefusal`/`moveRefusal`, the products field error in the editor, `load-session.test.ts`, more DB cases.
- test:db 2026-10-20: 357/359; the two failures (`grants`, `scheduled-jobs`) are 4.6 and 5.11 objects already in the shared database.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-20, lenses: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Verdicts: 0 high, 4 medium, 4 low (patched or deferred), 9 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Tal's manual-booking and move screens show the customer text for `PRODUCT_NOT_VALID_FOR_EVENT` | medium | patch | `bookRefusal`/`moveRefusal` lack the code; Tal-worded entry added with tests |
| 2 | Editor's `ProductsField` gets no `problem`, so a refusal on `product_ids` is not shown at the field | low | patch | create form passes it, editor did not |
| 3 | `toSessionRow` mapping of `event_products` untested | medium | patch | dropping the embed breaks the editor silently; `load-session.test.ts` added |
| 4 | DB gaps: refresh inside `admin_update_event`, credit and pinned moves, credit origin session, weak `bookError` check | medium | patch | removing those lines failed no test; cases added to `eligible-products.test.ts` |
| 5 | A product whose `eligible_event_kind` changes after being marked leaves a wrong-kind row: duplicate fails `INVALID_INPUT`, editor hides it | medium | defer | needs SQL in duplicate and `admin_update_product`; rare (kind change of a product in use) |
| 6 | `plan_admin_cancel_event` at-risk check ignores the product | low | defer | pre-existing function not in this story's map; only the cancel preview warning |

Rejected: 7 customer text says "כרטיסייה" for credit/pinned (user's chosen wording; customer screens never offer an excluded target, credits get `NO_MATCHING_ENTITLEMENT`); 8 `replaced_reason 'full'` (decision 2b "like a full one"; a new value needs a `drop`); 9 no `service_role` grant (explicit revoke is the decision, nothing reads it as service_role); 10 audit "(קודם: …)" suffix (meets AC 1); 11 weaker kind-field assertion in `session-screens.test.tsx` (still fails if the field renders); 12 hidden product held only through a credit is not offered (rare; clearing the set restores it); 13 100-id cap in the Action (harmless); 14 no list-level hint for customers (outside the intent); 15 `aria-invalid` on the fieldset (the fieldset's `aria-describedby` already links the error or hint, as in `WeekdaysField`); 16 correction affected list for bookings already excluded (rare, low); 17 snapshot without `product_id` (every row carries it, `grant_from_payment` writes it).

## Design Notes

`plan_funding` inlines the fit rules instead of calling `entitlement_fits_event`, so the helper is the single shared piece; both entitlement queries call it with `(e.eligibility_snapshot->>'product_id')::uuid` (all 70 dev rows carry it and match `payments.product_id`).

```sql
select not exists (select 1 from public.event_products where event_id = p_event_id)
    or exists (select 1 from public.event_products
               where event_id = p_event_id and product_id = p_product_id);
```

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` -- pass.
- `npm run test:db` (after asking the user; announce "מתחיל test:db" and "המסד פנוי") on: self-booking, multi-booking, manual-booking-funding, couple-and-intro, pinned-approval, bind-purchase, cancel-booking, business-cancel, cancellation-credits, credit-adjustments, move-booking, entitlement-corrections, auto-extend, waitlist, scheduled-jobs, grants, eligible-products -- pass.

**Manual checks:**
- Phone: Tal marks one product; a customer with a card from another product cannot book and sees the reason, and the manual booking list hides the session; an earlier booking stays; the payment approval picker does not offer the session for another product.
