---
title: 'Entitlement corrections (3.13)'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'ac81ca96c7c422c519a18541f0c5b2b152c32733'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal cannot extend a card, fix its balance, or change its weekdays or event kind (source §2 line 48: old date, new date and reason recorded; §7 lines 262, 270: extension and balance fix are sensitive; a balance fix links a reason and optionally the original session). An entry returned to an expired card cannot be used "before an extension" (§6), and no extension exists. A paid pinned purchase parked without a place in a session the business cancelled (3.8) has no way out.

**Approach:** One sensitive action per field on a new admin entitlement page, from the customer card and the open cards. Before confirming, Tal sees the future bookings that no longer fit; they stay as they are and appear in "לטיפול" until handled. The customer gets a notification per case. A parked purchase in a cancelled session is settled like a business cancel: the customer chooses a refund or a credit.

**User decisions (2026-10-18):**
- Corrections apply to cards only (`validity_mode = days`, status `active`), expired or not. Pinned purchases are tied to one session.
- Expiry may move later or earlier (any date ≥ `valid_from`); extending an expired card makes its returned entries usable at once (the balance is derived).
- A notification on every correction, one template per case, editable in settings: expiry (`entitlement_changed`, existing type), balance (`entitlement_units_changed`, new), weekdays or event kind (`entitlement_terms_changed`, new). Wording below.
- An affected booking leaves "לטיפול" when cancelled or moved, when its session started, when a later correction makes it fit, or when Tal taps `טופל`.
- Parked purchase in a cancelled session: like a business cancel (§6 table): Tal opens it from "לטיפול"; the customer gets the 3.8 refund-or-credit choice.

## Boundaries & Constraints

**Always:**
- **Table `entitlement_corrections`** (data-model, AD-12): `id, entitlement_id, field ('expires_on'|'units'|'allowed_weekdays'|'eligible_event_kind'), old_value jsonb, new_value jsonb, related_event_id (units only, nullable), reason (≤ 2000, nullable), actor_id, actor_kind ('admin'|'system'), week_start date null (reserved for 3.14, unique per entitlement), created_at`. Child `entitlement_correction_bookings(correction_id, booking_id, handled_at, handled_by)` (pk both ids) holds the warned bookings. RLS on, admin select only; no customer access; explicit grants.
- **Fit helper** `private.entitlement_fits_event(entitlement, event)`: the plan_funding entitlement checks except balance (status, kind, weekday of the local day, `valid_from ≤ day ≤ expires_on`, card not for couple). plan_funding is not changed.
- **Plan** `private.plan_admin_correct_entitlement(entitlement_id, field, value jsonb)` → `{ok, code}` or `{ok, entitlement_id, customer_id, customer_label, field, old_value, new_value, available, affected: [{booking_id, event_id, starts_at, concept_name}]}`: confirmed bookings funded by this card, session not started, that fit now and would not fit with the new value. `units` value = the new available count (≥ 0; delta ≠ 0), affected always empty. Codes: `NOT_FOUND`, `NOT_A_CARD` (pinned, revoked, refunded), `NO_CHANGE`, `INVALID_INPUT` (detail `field`: date < `valid_from`, weekdays not 1–7 distinct 0..6 (null = all days), kind not regular/couple, units < 0, reason > 2000, related event not one of this card's bookings). `preview_admin_correct_entitlement` = admin check + plan.
- **Action** `admin_correct_entitlement(p_entitlement_id, p_field, p_value jsonb, p_related_event_id, p_reason, p_confirmed, p_idempotency_key)` (`authenticated`, admin): admin check → `idempotent_begin` → unlocked read → lock profile (`private.lock_customer`, if bound) → events of the affected bookings by id → entitlement; recheck customer (`CONCURRENT_CHANGE`) → plan → `CONFIRM_REQUIRED` unless `p_confirmed` → write: expiry/weekdays/kind update the row; units insert one `adjust` movement (delta, reason) → correction row + child rows → audit (entitlement before/after, or the movement; reason) → notification for a bound customer (vars `expires_on`, `units` = all `allowed_vars`; discriminator correction id; target `/me/purchases/<id>`) → `{correction_id, affected_count}`. Bookings are never changed.
- **Templates** (push on, `allowed_vars ['expires_on','units']`): `entitlement_changed` → title `תוקף הכרטיסייה עודכן`, body `הכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות. הפרטים באזור האישי`. `entitlement_units_changed` → `היתרה בכרטיסייה עודכנה` / `יש לך עכשיו {units} כניסות פנויות בכרטיסייה, בתוקף עד {expires_on}. הפרטים באזור האישי`. `entitlement_terms_changed` → `עדכון בכרטיסייה שלך` / `השתנו הימים או סוג המפגשים שאפשר להירשם אליהם עם הכרטיסייה. הפרטים באזור האישי`.
- **Parked:** `private.plan_admin_settle_parked_purchase(entitlement_id)` (active pinned, no booking on its payment, event `cancelled`; else `NOT_PARKED`) → `{customer_label, concept_name, starts_at, amount_agorot}`; preview; `admin_settle_parked_purchase(p_entitlement_id, p_reason, p_confirmed, p_idempotency_key)`: locks profile (if bound) → event → entitlement → payment; inserts a `cancelled` booking on its payment (same `policy_snapshot` shape as book_core), its allocation, `reserve` −units and `use` 0 (as cancel_core's pinned branch), and a credit with `choice_pending` (same columns as cancel_core); audit; bound → `event_cancelled` template (no override), discriminator `event_id:revision`, target `/me/bookings`. Unbound → bind moves it as any business-cancelled credit (3.8). The `paid_without_place` item ends by itself.
- **Attention** (`admin_get_attention_items`, redefined from live `pg_get_functiondef`, nothing removed): new kind `correction_affected` {id = booking, customer_id, customer_label, since = correction time, entitlement_id, event_id, concept_name, starts_at, field} for an unhandled child row whose booking is `confirmed`, not started, and does not fit now (latest correction per booking). `admin_set_correction_booking_handled(p_booking_id)` (set_*, no key) marks all its child rows handled, audited.
- **Reads:** `admin_get_entitlement(p_entitlement_id)` → card, balances, entries, its bookings, corrections (newest first, actor, reason, related session), `is_extended`. `is_extended` (current `expires_on` later than before the first expiry correction) added to `admin_list_open_cards` and `admin_get_customer` entitlements, redefined from live.
- **Admin UI** (`frontend-design` first): page `customers/[id]/entitlements/[entitlementId]` (AD-2 seed), linked from the card's plates and open-card rows; one row per field with `שינוי`; `units` has an optional session picker (this card's bookings) and every row a reason field `סיבה (לא חובה)`. Sensitive keys: `entitlement_expiry` `האם להאריך או לשנות את התוקף?`, `entitlement_units` `האם לתקן את היתרה?`, `entitlement_terms` `האם לשנות את תנאי הכרטיסייה?`, `parked_settle` `האם להציע ללקוחה החזר או זיכוי?`. Impact rows `לפני` / `אחרי`; the warning list titled `הרשמות שכבר לא יתאימו (הן יישארו כפי שהן)` like `AtRiskList`. History rows `{שדה}: {ישן} ← {חדש}` are forbidden; use `היה {ישן}, עכשיו {חדש}`. Marker `(כולל הארכה)` after the expiry on open cards, the card plate and the page. "לטיפול": `correction_affected` → `הרשמה שלא מתאימה לכרטיסייה אחרי תיקון`, link to the entitlement page, button `טופל`; `paid_without_place` with a cancelled event gets the settle button.
- New codes only in `lib/errors.ts`; copy in `lib/copy/*`; audit action and field labels; template type names.
- Migrations only after "מתחילים לבנות": types first (drop migration from the live check, keeping 3.10's types if merged), user runs in the SQL Editor and it is registered.

**Never:** cancelling, moving or rebilling a booking because of a correction; a balance below 0; correcting a pinned purchase; changing plan_funding, cancel_core, book_core, move_booking or the product; auto-extension (3.14); credit options (3.16); anonymization (4.6); "טל" in customer copy; `←` in any screen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Extend | Card to 01.11, new 15.11, reason | Expiry 15.11, correction + audit, `entitlement_changed`, `(כולל הארכה)` | — |
| Expired card | Expired, 1 returned entry, extend | Entry bookable at once | — |
| No checkbox | any field, `p_confirmed` false | Nothing changes | `CONFIRM_REQUIRED` |
| Balance down | available 2 → 0 | `adjust` −2, reserved untouched | — |
| Below zero | → −1 | Nothing changes | `INVALID_INPUT` (`units`) |
| Weekdays | Sun only; future Tue booking | Preview lists it; after: booking unchanged, item in "לטיפול" | — |
| Booking after correction | Weekdays Sun only, she books Tue | Refused by plan_funding | `NO_MATCHING_ENTITLEMENT` |
| Handled | Tal taps `טופל` | Item gone, booking unchanged | — |
| Pinned | correction on a single | Nothing changes | `NOT_A_CARD` |
| Idempotent | same key twice | One correction, one notification | — |
| Customer calls | any new admin RPC or preview | Nothing | `NOT_AUTHORIZED` |
| Parked, bound | paid pinned, cancelled session, no booking | Cancelled booking + credit `choice_pending`; she gets `event_cancelled` and chooses; item gone | — |
| Parked, not cancelled | event still published | Nothing | `NOT_PARKED` |
| All vars | each template edited to use every allowed var | Real flow renders | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql` -- `entitlements` `:144-173` (weekdays/kind "change only through a correction" `:142`), movements `:187-236` (`adjust` ≠ 0, booking_id optional, no event column; append-only trigger). `entitlement_balances` latest `20261003141504:68-106` (adjust affects available only).
- `20261013161248_couple_and_intro.sql:197-329` -- `private.plan_funding` entitlement checks `:273-292`; copy them into the fit helper, do not edit.
- `20261013203359_account_admin_and_rate_limit.sql:715-1029` -- live `admin_get_attention_items` (`paid_without_place` `:823-850`, union of `(since, id, item)`).
- `20261013215833_refund_completion.sql:87-357` -- pattern plan/preview/action, `INVALID_INPUT` detail, confirm order. `20261013162639_business_cancel_event.sql` -- `cancel_core` pinned branch `:300-360` (movements, credit insert, audit), parked list in `plan_admin_cancel_event` `:590-619`, `bind_purchase` (moves choice_pending credits, sends `event_cancelled`), `admin_reschedule_event` `:1179-1197` (also writes `expires_on`, pinned only).
- Helpers: `private.idempotent_begin/finish` (`20260930191525:34,91`), `private.audit` (`20260930193304:69`), `private.enqueue_notification` (`20261001184225:223`), `private.lock_customer` (`20261006215608:509`). Type check latest `20261013215828_refund_completed_type.sql:17-29` (18 types); templates and `allowed_vars` `20261006183915:41`.
- Reads to redefine from live: `admin_list_open_cards` (`20261013080437:19`), `admin_get_customer` (`20261007183144:394`).
- Admin UI: `customers/[id]/{page.tsx (BalancePlate ~199, SinglePlate ~254), card-items.ts (toBalanceItem :244), load-card.ts}`; `customers/open-cards/{open-card-row.tsx (:53-55, buttons :75-89), open-cards-items.ts (:97-112)}`; `sessions/[id]/{session-cancel.tsx, at-risk-list.tsx, actions.ts, event-plan.ts}` and `payments/{refund-complete.tsx, actions.ts}` as patterns; `components/admin/sensitive-confirm-dialog.tsx`; `lib/admin/sensitive-actions.ts` (3.17 also adds a key); `home-items.ts` (switch ~142, filter ~280), `home/attention-list.tsx`, `attention/`; `lib/copy/admin.ts` (`sensitive` :879, `home.items` ~971, `customers` 1407, `settings.templates.types`, `audit.actions` 1693, `audit.fields` 1776); `audit/audit-data.ts`.
- Customer UI: `app/me/purchases/[id]/` (movement `adjust` = `תיקון`, `lib/copy/customer.ts:62`), credit choice card from 3.8 (`app/me/bookings/`) unchanged.
- Tests: `open-cards`, `my-entitlements`, `admin-home`, `self-booking`, `grants` (`EXPECTED_GRANTS`), `settings-and-templates` (count `:625`, names `:638`, all vars `:651`, real flow per template ~`:740`), `business-cancel`, `bind-purchase`, `audit-data.test.ts` (`:130`, `:312`), `home-items.test.ts`.
- `scripts/demo-seed.mjs` -- run after apply; no change expected.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_entitlement_correction_types.sql` -- **main session; user runs in SQL Editor:** live type check + `entitlement_units_changed`, `entitlement_terms_changed`; registered.
- [ ] `supabase/migrations/<ts>_entitlement_corrections.sql` -- tables, RLS, grants, templates (two inserts, `entitlement_changed` text update), fit helper, plans, previews, actions, `admin_set_correction_booking_handled`, `admin_get_entitlement`, redefined `admin_get_attention_items`, `admin_list_open_cards`, `admin_get_customer`; revoke all, one grant each.
- [ ] `lib/supabase/database.types.ts` -- regenerate.
- [ ] `supabase/tests/entitlement-corrections.test.ts` -- every matrix row, plus update `open-cards`, `admin-home`, `settings-and-templates`, `grants`, `my-entitlements`.
- [ ] `lib/errors.ts`, `lib/copy/{admin,customer}.ts`, `lib/admin/sensitive-actions.ts`, `audit/audit-data.ts` -- codes, copy, keys, labels.
- [ ] Admin screens (`frontend-design` first): entitlement page, links and marker, attention rows and buttons; parser and render tests.
- [ ] Docs -- `deferred-work.md` (close 2.12 `entitlement_changed` part, 4.7 allowed_vars for 3.13, 3.9 parked item), `completion-plan-2026-10-10.md`, `tickets.toml` id 13 done in the PR.

**Acceptance Criteria:**
- Given a corrected card, when the customer opens her purchase page, then the new expiry or balance shows and the history row reads `תיקון`.
- Given a correction, when Tal opens the entitlement page, then the history shows the old and new value, the reason, the actor and the date.

## Implementation Notes

- 2026-10-18 (planning): write migrations with `npx supabase migration new`, but do not apply them (MCP `apply_migration` is declined; the user runs them in the SQL Editor). Build each redefinition and the type check from the live DB (`pg_get_functiondef`, MCP `execute_sql`, read-only). Until applied, DB tests run the migration SQL inside each rolled-back test through a temporary hook in `supabase/tests/support/db.ts` (as in 3.8/3.9; restore the file afterwards), and `database.types.ts` is hand-edited. Before writing SQL load the `supabase-postgres-best-practices` skill.

- 2026-10-18 (implementation): migrations `20261018084607_entitlement_correction_types.sql` (type check, the user runs it first) and `20261018084612_entitlement_corrections.sql` (everything else). Not applied. Redefinitions of `admin_get_attention_items`, `admin_list_open_cards` and `admin_get_customer` match the live `prosrc` (md5 checked) plus the additions. Additions beyond the text: a missing entitlement is `NOT_FOUND` (plan and `admin_get_entitlement`); all seven weekdays are stored as null ("all days"); `allowed_weekdays` old/new values are sorted arrays or JSON null; `admin_get_entitlement` also returns `correctable`, `valid_from`, `days_left`, `paid_on`; the settle plan also returns `entitlement_id`, `customer_id`, `event_id`; `admin_set_correction_booking_handled` returns `{booking_id, handled_count}` and refuses a booking never warned (`NOT_FOUND`); the parked booking is `booked_by = 'admin'`. A purchase not bound yet has the page at `customers/unbound/entitlements/<id>` (open cards link it; the page 404s when the segment does not match the card's customer). `TaskRow` gained a `children` slot (relative z-10) for the two "לטיפול" buttons. `entitlement_changed` template version is bumped by the wording update. 3.10 (`booking_moved_type`, `move_booking`) was applied to dev the same day, so the type check keeps `booking_moved` and the template count in `settings-and-templates` is 20 (18 live + 2); the "every type has a name" test passes only once 3.10's copy is merged. 3.10's migration files sort after these (075210 > 075037): rename these to a later timestamp before apply, or 3.10's type check must list the two new types on a fresh `db push`. DB tests ran with a temporary hook in `supabase/tests/support/db.ts` (removed): all 14 new tests and the touched files passed before another session's concurrent tests caused deadlocks with the hook's DDL; `database.types.ts` hand-edited. `tickets.toml` id 13 left for the PR (no status field).

- 2026-10-18, applied and checked: the migrations were renamed to sort after 3.10's (`20261018075210/075214`, applied to dev the same day; the type check keeps `booking_moved`). The user ran both in the SQL Editor (the review-round-1 version); both registered in `schema_migrations`. Advisors: only approved WARNs (plus the pre-existing INFO on tables without policies). `database.types.ts` regenerated (it includes 3.10's and 3.17's RPCs, live in dev). `test:db` on the touched files: pass, except what waits for 3.10/3.17 code on `main` (`grants` explicit list, template names `booking_moved`); `self-booking` "only book_core inserts bookings" now also lists `admin_settle_parked_purchase` (its cancelled row). `demo:seed` did not run: `.demo-data.local.json` is missing in every folder (pre-existing; the script changes nothing).
- 2026-10-18 (review round 1, user decision): a card may still be set to `couple`; the dialog warns `כרטיסייה לא מממנת מפגש זוגי, ולכן אחרי השינוי היא לא תתאים לאף מפגש`. New balance cap: 0–99 available.
- 2026-10-19 (local check, user decision): the expiry question is `האם לשנות את התוקף?` (overrides the wording in Boundaries).
- 2026-10-19 (local check, user decisions, override the 2026-10-18 couple warning): a card's event kind is never changed to couple: the row shows the value without `שינוי` (`fieldEditable`) and the plan refuses it (`INVALID_INPUT`, `eligible_event_kind`; migration `20261018212133_card_event_kind_fixed.sql`, run by the user and registered). The entitlement page has no "הרשמות מהכרטיסייה" section (it repeated the entries); the `correction_affected` item opens the session page, where the booking is cancelled or moved.

## Spec Change Log

## Review Triage Log

**Round 1 (2026-10-18):** blind-hunter, edge-case-hunter, verification-gap, intent-alignment. intent_gap 1 (decided by the user, no revert: card → couple stays allowed with a warning), medium 5, low 8, false 2.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | blind, edge | Reopening a row after a save shows the old value; a second "המשך" resends it | medium | patch | reset the draft on open |
| 2 | blind | Entitlement page does not render its bookings, though the attention item sends Tal there to cancel or move | medium | patch | bookings section with session links |
| 3 | edge | Meter total uses `original_units` after a balance fix | low | patch | total = used + reserved + available |
| 4 | vgap, edge | Card set to `couple` fits no session, silently | medium | intent_gap → decided | user: keep, warning line in the dialog |
| 5 | edge | Units input invalid: no message; a typo (1000) renders 1000 rows | low | patch | message; cap 99 (UI, action, plan) |
| 6 | blind | Reason > 2000 refused only after confirm | low | patch | `maxLength` on the fields |
| 7 | blind, edge | "ההצעה נשלחה ללקוחה" for an unbound purchase | low | patch | separate done text |
| 8 | blind, edge | Settle `event_cancelled` deduped against 3.8's for the same customer and revision | medium | patch | discriminator `event_id:revision:<booking_id>`; test |
| 9 | blind | `validUntil()` unused | low | patch | delete |
| 10 | vgap | Shortening expiry before a booking never tested | medium | patch | test |
| 11 | vgap, blind | Settle idempotency, handled `NOT_FOUND`/repeat, `admin_get_entitlement` `NOT_FOUND`/`correctable`, `admin_get_customer.is_extended` untested | low | patch | tests |
| 12 | vgap | New `actions.ts` files untested | low | patch | `actions.test.ts` ×2 |
| 13 | vgap | `extended` and the entitlement link untested in card and open-card parsers | low | patch | parser cases |
| 14 | vgap, blind | Attention buttons never rendered in a test | low | patch | render test |
| 15 | blind | `CONCURRENT_CHANGE` in both actions untested | medium (unverified) | defer | needs a paused committing bind, as 3.9 #9 |

Rejected: hard-coded 1 unit in the settle (false: `place_pinned_booking` allocates 1 too); entitlement vs payment customer gap (false: approval binds both, bind fills both); plan fallbacks to 0/"" (the plan always returns them); unused `customerLabel`/`days_left` fields (harmless); `טופל` without confirm/undo (user decision, audited); no notification at bind for a card corrected while unbound (she sees the current values on joining); optional reason (SPEC CAP-9 and AC "שדה סיבה ריק לא חוסם"); "moved" exit untested (move cancels the original booking, 3.10); "קיבלה הודעה" wording; UI-level end-to-end tests (review-accepted).

## Design Notes

The parked settle writes the same rows a business cancel of a placed pinned booking would have left (cancelled booking, `reserve` + `use`, credit `choice_pending`), so 3.8's choice, 3.9's refund completion and bind work unchanged and the `paid_without_place` item ends by itself. The balance is set as a target number, not a delta, so a stale preview cannot double-subtract; the plan recomputes the delta under the lock. The child table (not an array) gives per-booking `טופל`.

## Verification

**Commands:**
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run format:check`, `npm run build` -- pass.
- After apply: `get_advisors` (only approved WARNs), `npm run test:db` (new + listed files), `npm run demo:seed` -- pass.

**Manual checks (if no CLI):**
- Phone: extend → customer sees new expiry and a notification; balance fix without checkbox refused; weekdays fix lists a future booking that stays; "לטיפול" shows it; `(כולל הארכה)` on open cards.
