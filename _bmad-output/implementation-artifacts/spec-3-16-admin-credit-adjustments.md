---
title: 'Admin credit adjustments (3.16)'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: 'b6f72ec6fa8b01b6299c73ddad3293d49e8975ad'
route: 'full'
route_source: 'auto'
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

**Problem:** Tal cannot change a credit's alternatives or extend it (source §6 line 242: "האדמין יכולה לשנות חלופות או להאריך ידנית עם סיבה. פרטי כל שינוי נשמרים"; §7 line 262 "טיפול בזיכוי והחזר"; line 270 sensitive). After a move a cancel returns a credit, never money (3.10), and Tal has no way to give money back instead (user decision 2026-10-18).

**Approach:** Two sensitive actions on an active credit, from the "זיכויים והחזרים" section of the customer card (and linked from a cancelled booking in the card's booking history): change alternatives (which is also how Tal extends a credit) and refund instead of credit. Each has plan, preview, checkbox, optional reason, audit (old and new) and a customer notification. The nightly refresh keeps Tal's choices.

**User decisions (2026-10-19):**
- Extending a credit is not a separate action: Tal adds sessions in "שינוי חלופות", also on a credit whose alternatives all passed.
- A credit that funds a confirmed booking cannot be changed or refunded; the section explains why until Tal cancels or moves the booking.
- Tal may choose a refund for a credit still waiting for the customer's choice (business cancel); the choice disappears. Changing its alternatives stays blocked until the customer chooses a credit.

## Boundaries & Constraints

**Always:**
- **Who can be changed:** credit `status = 'active'` and no `confirmed` booking allocated to it (the same freeze as `refresh_credit_options`); change also requires not `choice_pending` (refund allows it). Else `CREDIT_NOT_ACTIVE` / `CREDIT_CHOICE_PENDING` / `CREDIT_IN_USE`. Unbound credits (`customer_id` null) allowed, no notification.
- **Schema (additive migration):** `credit_options.added_by text not null default 'system' check in ('system','admin')`. **Types migration (drop, the user runs it first in the SQL Editor):** `credit_options.replaced_reason` check gains `'admin'`; `notification_templates.type` check from live `pg_get_constraintdef` (+ 3.14's type if already applied) gains `credit_options_changed`, `credit_refund_requested`.
- **Matching session** (for Tal's picks): `published`, same `event_kind` as the credit, not started, registration open, room for `party_size` (`private.occupied_places`), not the origin event, she has no `confirmed` booking in it. Any date, also before `origin_starts_at`.
- **Change alternatives:** `private.plan_admin_change_credit_options(credit_id, event_ids uuid[])` (1–10 distinct matching sessions, else `INVALID_INPUT` detail `events`; same set as now → `NO_CHANGE`) → `{credit_id, customer_id, customer_label, concept_name, origin_starts_at, before:[{event_id, starts_at, concept_name}], after:[…]}`. Action `admin_change_credit_options(p_credit_id, p_event_ids, p_reason, p_confirmed, p_idempotency_key)`: admin → `idempotent_begin` → reason ≤ 2000 → unlocked read → `private.lock_customer` (if bound) → all involved events by id → credit → its options; recheck → plan → `CONFIRM_REQUIRED` → active options not picked become `replaced` / `'admin'`; picked ones not active are inserted (`added_by 'admin'`), or a former row of the same event is set back to `active`, `added_by 'admin'` (unique credit+event); `options_count := used + passed + picked`; audit; notification.
- **Refund instead of credit:** `private.plan_admin_refund_credit(credit_id)` → `{credit_id, customer_label, concept_name, origin_starts_at, amount_agorot = monetary_basis_agorot}`; action `admin_refund_credit(p_credit_id, p_reason, p_confirmed, p_idempotency_key)`: locks profile → credit → payment (source entitlement's) → same writes as `choose_credit_outcome`'s refund branch (credit `refund_requested`, `choice_pending = false`; `refund_requests` with `booking_id = coalesce(private.credit_cancelled_booking(..), origin_booking_id)`, amount = basis), active options untouched (the credit is no longer refreshed). Shown in `/admin/payments` and as `refund_requested` in "לטיפול" with no change to those reads (test). On a `choice_pending` credit the same writes close the choice (her choice card disappears).
- **Refresh rule (also for 5.10's job):** redefine `private.refresh_credit_options` and `private.move_option_candidates` from live: the `starts_at <= origin_starts_at → replaced 'moved'` rule skips `added_by = 'admin'` options; everything else unchanged. Because removed options stay as `replaced`/`'admin'` rows and the fill skips any event that is already an option in any state, a removed option never returns; because `options_count` is reset to Tal's count, the fill never tops up to the original N. An admin option that becomes full, cancelled or passes is handled like any option (replaced by the next matching session with room, or `passed`).
- **Audit:** one `private.audit` row per action on `cancellation_credits` with before/after `{options:[{event_id, starts_at}], options_count}` (refund: the credit row + the `refund_requests` row, as 3.8). `lib/copy/audit-actions.ts` entries, shown, one-line results: `החלופות לזיכוי עודכנו`, `הזיכוי הוחלף בבקשת החזר של {amount}`; action labels `שינוי חלופות לזיכוי`, `החזר במקום זיכוי`.
- **Notifications** (push on, editable, every caller passes all `allowed_vars`, target `/me/bookings`, discriminator = audit id): `credit_options_changed`, vars `['date']` (origin session, `format_day_month`): `עדכון בזיכוי שלך` / `המפגשים שאפשר להירשם אליהם עם הזיכוי מ־{date} עודכנו. הפרטים באזור האישי`. `credit_refund_requested`, vars `['date','amount']`: `בקשת ההחזר התקבלה` / `במקום הזיכוי מ־{date} יוחזרו לך {amount}. נעדכן אותך כשההחזר יבוצע`. (`booking_cancelled_refund` does not fit: its title says the booking was cancelled now.)
- **Reads:** redefine `admin_list_customer_credits` from live + `options:[{event_id, starts_at, concept_name, state, added_by}]` (active/used/passed), `options_count`, `in_use`, `exhausted`. New `admin_list_credit_candidates(p_credit_id)` → next 30 matching sessions `{event_id, starts_at, concept_name, is_option}`. Redefine `admin_get_customer` bookings with `credit_id` (credit whose origin or allocation is the booking) for the history link.
- **Admin UI** (`frontend-design` first; only inside "זיכויים והחזרים", no change to the card's structure, headings or order — fix 9): each active credit lists its alternatives (date, concept) and buttons `שינוי חלופות` and `החזר במקום זיכוי`; a credit whose alternatives all passed shows `כל המפגשים החלופיים עברו. אפשר להוסיף מפגשים ב״שינוי חלופות״`; an in-use credit shows `הזיכוי משמש להרשמה עתידית. כדי לשנות אותו צריך קודם לבטל או להזיז את ההרשמה` instead. Change opens an edit box `אפשר להחליף מפגשים או להוסיף עוד` with checkboxes of candidates (current ones checked) and `סיבה (לא חובה)`, then `SensitiveConfirmDialog` with `לפני` / `אחרי`. Sensitive keys: `credit_options` `האם לשנות את החלופות של הזיכוי?`, `credit_refund` `האם להחליף את הזיכוי בהחזר כספי?`. Booking history: a cancelled booking with `credit_id` links `לזיכוי` to `#credit-<id>`. If 5.21 merged first, wire the two buttons to its offline disabling. No `←`.
- Customer screens unchanged: `get_my_credits` already shows only active/used options. New codes only in `lib/errors.ts`.

**Never:** changing `plan_funding`, `book_core`, `cancel_core`, `move_booking`, `choose_credit_outcome`; card validity (3.13/3.14); the nightly job (5.10); waitlist (5.6); cancelling a payment; card reorder (fix 9); a second refund request for a credit; "טל" in customer copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Change | active credit, options A,B → picks C,D | A,B `replaced`/`admin`; C,D active `admin`; count 2; audit old/new; notification | — |
| No checkbox | any action, `p_confirmed` false | nothing changes | `CONFIRM_REQUIRED` |
| Customer books new | after change, she books C | funded by the credit | — |
| Removed stays out | after change, refresh runs, A has room | A not offered again | — |
| Early pick | C before `origin_starts_at` | stays active after refresh | — |
| Picked fills | C becomes full, refresh | C replaced by next matching session | — |
| Wrong kind / full / origin | couple session for a regular credit | nothing | `INVALID_INPUT` (`events`) |
| Extend exhausted | all options passed, Tal picks E | E active `admin`; count = passed + 1; she can book E | — |
| In use | credit funds a confirmed booking | nothing | `CREDIT_IN_USE` |
| Change pending | `choice_pending` credit | nothing | `CREDIT_CHOICE_PENDING` |
| Refund pending | `choice_pending` credit | refund request; choice closed | — |
| Refund | active credit, basis 18000 | credit `refund_requested`; request 18000 in payments and "לטיפול"; notification | — |
| Refund twice | already `refund_requested` | nothing | `CREDIT_NOT_ACTIVE` |
| After move | credit from a moved then cancelled booking | refund allowed | — |
| Idempotent | same key twice | one change, one notification | — |
| Customer calls | any new admin RPC/preview | nothing | `NOT_AUTHORIZED` |
| All vars | both templates use every allowed var | real flow renders | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261013162639_business_cancel_event.sql` -- live `private.refresh_credit_options` (`:71`), `refresh_customer_credits`, `refresh_credits_for_event`, `choose_credit_outcome` refund branch (copy its writes).
- `20261018092457_move_booking_review_fixes.sql:16` -- live `private.move_option_candidates` (simulates refresh; caller `plan_move`).
- `20261013215833_refund_completion.sql` -- `admin_list_customer_credits` `:451`, `get_my_credits` `:509`; plan/preview/action pattern.
- `20261014114926_refund_completion_targets.sql` -- `admin_list_refund_requests`, `admin_complete_refund` (read only; lock order profile → credit → payment → request).
- `20261018084612_entitlement_corrections.sql` -- pattern: plan `:182-372`, preview `:374-393`, action `:395-607`, grants `:1745-1775`; live `admin_get_attention_items` `:1089` (refund part `:1268`, unchanged), `admin_get_customer` `:1548`.
- `20261018084607_entitlement_correction_types.sql` -- type-check migration pattern. Helpers: `private.lock_customer`, `private.audit`, `private.enqueue_notification`, `private.idempotent_begin/finish`, `private.occupied_places`, `private.credit_cancelled_booking`, `private.format_day_month`, `private.format_agorot`, `private.template_sample_vars`.
- `app/admin/(shell)/customers/[id]/` -- `page.tsx:74,84,190`, `load-card.ts:44`, `credit-items.ts` (`toCustomerCreditItem :97-153`), `credits-section.tsx` (`<li id="credit-{id}">`), `bookings/page.tsx` (~68), `card-items.ts:378`; pattern `entitlements/[entitlementId]/{actions.ts, correction-row.tsx}`.
- `components/admin/sensitive-confirm-dialog.tsx`, `lib/admin/sensitive-actions.ts`, `lib/idempotency.ts`, `app/admin/(shell)/payments/refund-complete.tsx`.
- `lib/copy/admin.ts` -- `customers.card.credits` `:1666`, `sensitive` `:954`, `settings.templates.types` `:1438`, `audit.actions` `:1964`, `audit.results` `:1908`; `lib/copy/audit-actions.ts` (`SHOWN_AUDIT_ACTIONS :146`); `lib/errors.ts`.
- Customer read only: `app/me/bookings/{credits.ts, credit-cards.tsx}`.
- Tests: `supabase/tests/{cancellation-credits, business-cancel, refund-completion, move-booking, self-booking, admin-home, settings-and-templates (count :625, names :638, all vars :651/:668, real flow ~:867), grants (EXPECTED_GRANTS :15)}.test.ts`; `credit-items` unit test.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_credit_adjustment_types.sql` -- **main session; user runs first in SQL Editor:** two checks from live; registered.
- [ ] `supabase/migrations/<ts>_credit_adjustments.sql` -- column, templates, plans, previews, actions, candidates read, redefinitions; revoke all, one grant each.
- [ ] `lib/supabase/database.types.ts` -- regenerate.
- [ ] `supabase/tests/credit-adjustments.test.ts` -- every matrix row; update `settings-and-templates`, `grants`, `cancellation-credits`.
- [ ] `lib/errors.ts`, `lib/copy/{admin,audit-actions}.ts`, `lib/admin/sensitive-actions.ts` -- codes, copy, keys, audit entries.
- [ ] Admin UI (`frontend-design` first): credits section, actions, history link; parser and render tests.
- [ ] Docs -- `completion-plan-2026-10-10.md` (refresh rule for 5.10), `tickets.toml` id 16 done in the PR.

**Acceptance Criteria:**
- Given a changed credit, when the customer opens "ההרשמות שלי", then she sees only the new alternatives and can book one.
- Given either action, when Tal opens the audit log, then it shows one line with the action and its result.

## Implementation Notes

- 2026-10-19 (planning): work only in the worktree `.claude/worktrees/story-3-16` (branch `story-3-16-admin-credit-changes`). Load the `supabase-postgres-best-practices` skill before writing SQL and `frontend-design` before any screen. Create migrations with `npx supabase migration new`, never apply them (MCP `apply_migration` is declined; the user runs them in the SQL Editor). Build every redefinition and the two check constraints from the live DB (`pg_get_functiondef` / `pg_get_constraintdef` via MCP `execute_sql`, read-only); if 3.14 is already applied to dev, keep its types. Write the DB tests but do not run `npm run test:db` or any `--project db` test: the main session runs them after asking the user, once the migrations are applied. `database.types.ts` is hand-edited until then. No git commit, push, `rm`/`git rm` or `.env*` writes (main session).

- 2026-10-20 (implementation): migrations `20261019204034_credit_adjustment_types.sql` and `20261019204039_credit_adjustments.sql`; the type check also keeps 3.14's `entitlement_auto_extended` (applied to dev first). The user ran both in the SQL Editor; registered; advisors: approved WARNs only; `database.types.ts` regenerated (includes 3.14's live RPCs). Review fix in `20261019211608_credit_adjustments_review_fixes.sql` (`refresh_credit_options(id, false)` before the plan): not applied yet. Open: the user runs it; `test:db` (the user holds it until 3.14 and 5.21 finish their checks; with 3.14's template the live table has 23 rows, so the `settings-and-templates` counts become 23 when 3.14 merges); matrix audit; `demo:seed`; phone check. `settings-and-templates` counts 22 on this branch (20 + 2).

- 2026-10-20 (after review): the user ran `20261019211608_credit_adjustments_review_fixes.sql`; registered. `test:db` on credit-adjustments, cancellation-credits, business-cancel, refund-completion, move-booking, self-booking, admin-home, settings-and-templates, grants, customers: 250 of 253 pass; the 3 failures are the template counts in `settings-and-templates` (live table has 23 rows: 3.14's `entitlement_auto_extended` is applied to dev but not on this branch), fixed when origin/main with 3.14 is merged. Every matrix row is covered by a passing test. `demo:seed` skipped (user decision).

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-20):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. medium 1, low 3 patched; 1 deferred; rest rejected.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind, edge | An active option that is already closed, full or booked (not yet refreshed) is replaced as `admin`, so a passed opportunity drops out of `options_count` and the audit `before` is stale | medium | patch | new migration: `refresh_credit_options(id, false)` after the locks, before the plan; test |
| 2 | blind, edge | No candidates: "המשך" shown, does nothing | low | patch | hide it when the list is empty |
| 3 | vgap | `move_option_candidates` admin exception untested | low | patch | DB test: early admin option is a move target |
| 4 | vgap, blind | Untested: reason > 2000 (both RPCs, refund action), unbound credit, `NOT_FOUND` previews/candidates, re-pick of a `replaced('admin')` row; loose booking assertion after a move | low | patch | tests |
| 5 | vgap | `notifications.test.ts` seed list stale since before this story | medium (pre-existing) | defer | deferred-work entry |

Rejected: re-pick of a `used`/`passed` row (unreachable: passed fails the match, used means in use); new option missed by the event lock (fill inserts only on owner paths under the profile lock); refund leaves active option rows (every reader and `plan_funding` require an active credit); lost response retried with a new key (same as every sensitive dialog); 30-session cap, duplicate `REASON_MAX`, duplicate in-use text, prototype key in `creditRefusal`, duplicate candidate filters, unused `added_by` on the client (cosmetic); no `cancellation-credits` change (rule covered in the new file); intent readings match the user decisions.

## Design Notes

`options_count` becomes "the number of opportunities this credit has", so refresh keeps working unchanged for Tal's set: removed events are rows the fill skips, the count stops the top-up. Only the `moved` rule needs an exception, because Tal may pick a session earlier than the cancelled one.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run format:check`, `npm run build` -- pass.
- After apply: `get_advisors` (approved WARNs only), `npm run test:db` (new + listed files, after asking), `npm run demo:seed` -- pass.

**Manual checks (if no CLI):**
- Phone: change without checkbox refused; extend an exhausted credit by adding a session; refund appears in payments and "לטיפול"; customer sees new alternatives, books one, gets the notification; audit shows one line per action.
