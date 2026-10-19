---
title: 'Concise audit log'
type: 'bugfix'
created: '2026-10-18'
status: 'done'
baseline_commit: 'd8bc591ea1c6c9a9308f9b6f1e8579590833db4c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['edge-case-hunter', 'rpc-adversarial']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5-audit-log-viewer.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** /admin/audit shows every row `private.audit` writes: work sheet, notes, drafts, images and technical steps; one operation shows as 2–3 rows (a payment approval twice, a cancellation as booking + credit); a row is a list of every column with dashes. Source §7: "מי ביצעה, מתי, באיזו לקוחה או מפגש, מה השתנה ומדוע". User decision 2026-10-18: show only actions worth checking later, each as one concise line.

**Approach:** One TS mapping (action → label, primary `entity_type`, result sentence) is the whitelist; the server action passes it to `admin_list_audit`, which returns only primary rows (paging and counts stay correct), with the other rows of the same operation attached and names derived at read time. The screen shows: action, subject, when, who, one result sentence, and for edits only the changed fields.

## Boundaries & Constraints

**Always:**
- Filtering is in SQL: `p_shown text[]` of `"{action}/{entity_type}"` pairs; a row is listed only when its pair is in it. Empty or null → `INVALID_INPUT` (field `shown`).
- Same operation = same `created_at` (`now()`, one transaction), `action` and `actor_id`, and, when the primary row has a customer, the same customer. Its other rows come back as `related: [{entity_type, changes}]`, filtered by the existing key rules.
- Customer of a row (display and the customer filter) = `customer_id`, else derived at read time: `profiles` → `entity_id`; `payments`/`activation_tokens` → that row's current `customer_id`; else `customer_id` in before/after. The customer filter also matches an operation whose related row has that customer (a session cancel shows under each customer). Session filter and dates unchanged.
- Anonymized customer → "לקוחה שפרטיה הוסרו". Session subject → "בראנץ׳ {קונספט} {DD.MM}" (deleted session: from `before`, as 3.17 does).
- Product/concept subject → its current name (deleted concept: `before.name`); content section and template → their Hebrew name from existing admin copy; unknown → no subject.
- Edits show only fields whose value changed, not technical, not masked, not empty on both sides: `"{field}: {after} (במקום {before})"`; added `"{field}: {after}"`. No field list in any other row.
- A shown action without a result sentence shows its name only. Every Hebrew string in `lib/copy/`.
- Reason line stays ("סיבה: …").

**Never:**
- Change any function that writes the log, `audit_log`, `private.audit` or what is recorded (5.20).
- Raw before/after in the browser. A cursor other than `(created_at, id)` of the primary row.
- Grouping in TS (it breaks paging).

**Shown (action / primary entity → result sentence):**
- `approve_payment`/payments → "שולמו {סכום} על {product_snapshot.name}". (`admin_approve_payment` hidden: same approval, and any future source goes through the core, AD-10.)
- `admin_complete_refund`/refund_requests → "הוחזרו {סכום}"; partial "הוחזרו {x} מתוך {y}".
- `book_session`, `book_sessions`, `admin_book_customer`/bookings → "נרשמה", party_size>1 "נרשמה ({n} מקומות)".
- `cancel_booking`, `admin_cancel_booking`/bookings → related refund_requests: "נפתחה בקשת החזר"; related credit: "התקבל זיכוי {למפגש אחד | לשני מפגשים | ל-{n} מפגשים}" (options_count); neither: "הכניסה חזרה לכרטיסייה".
- `choose_credit_outcome`/cancellation_credits → refund chosen: "נבחר החזר, נפתחה בקשת החזר"; else "נבחר זיכוי".
- events: `admin_create_event`, `admin_duplicate_event`, `admin_publish_event` (name only); `admin_update_event`, `admin_reschedule_event` (changed fields); `admin_cancel_event` → "בוטלו {n} הרשמות" (n>0); `admin_delete_event` → "הוסרו {n} חלופות זיכוי" only when n>0; `complete_event` (name only).
- customers: `admin_issue_link`/activation_tokens → "קישור {להצטרפות | לצירוף לחשבון קיים | לאיפוס סיסמה}, בתוקף עד {date}"; `revoke_link`, `reset_complete`, `join_complete`/profiles, `bind_purchase`/payments, `admin_add_customer_note`, `admin_delete_customer_note` (name only); `admin_finish_email_change` → "המייל עודכן"; `admin_change_phone` → "מספר הטלפון עודכן"; `admin_export_customers` → "יוצאו {n} לקוחות"; `set_photo_consent`, `set_personal_photo_consent` → "אישרה" / "ביטלה את האישור".
- products: `admin_create_product` (name only); `admin_update_product`, `admin_set_product_price` (changed fields).
- `admin_update_business_settings`, `admin_update_notification_template`, `admin_update_concept` (changed fields); `admin_publish_content`, `admin_create_concept`, `admin_delete_concept` (name only); `admin_set_concept_archived` → "הועבר לארכיון" / "הוחזר מהארכיון".

**Hidden** (listed in the same file as `HIDDEN_AUDIT_ACTIONS`, for 5.20): work sheet, notes and topics, `admin_set_content_draft`, every media action and `admin_set_event_image`/`admin_set_concept_image`, `admin_approve_payment`, `admin_begin_email_change`, `join_begin`, `migrate_identity_match`, `refresh_returned_entitlements`, `set_booking_guest_details` (masked, nothing to check) and `claim_join` (it calls `bind_purchase`, already shown) -- the last two per the recommendation, adopted when the user approved the build (2026-10-19).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Approval | admin approves a card, 472 ₪ | one item "אישור תשלום", customer (or none until bound), "שולמו 472 ₪ על כרטיסייה אישית" | — |
| Cancel with credit | customer cancels a single, picks credit, N=2 | "ביטול הרשמה" · "בראנץ׳ יווני 12.10" · "התקבל זיכוי לשני מפגשים" | — |
| Session edit | capacity 12→14, revision bumped | "מכסה: 14 (במקום 12)" only | — |
| Session cancel, customer filter | session with 2 bookings cancelled; filter = one of them | the cancel item is listed, "בוטלו 2 הרשמות" | — |
| Hidden only | range with only work-sheet rows | empty state | — |
| 51 shown rows among 200 hidden | first page | 50 items, "טעינת עוד" | — |
| Bad whitelist | `p_shown` null or empty | — | `INVALID_INPUT` field `shown` |
| Unknown shown action | pair in the map without result | name only, no field list | — |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010125930_audit_viewer.sql` -- current `admin_list_audit` (filters, keyset, key-dropping rules, names). Reuse its body; add `p_shown`, `related`, derived customer, subject. Signature changes → drop + create (SQL Editor, AGENTS.md).
- `app/admin/(shell)/audit/audit-data.ts` -- `toAuditItem`, `formatValue`, `isShownChange`, `deletedEventChanges` (3.17). Keep `formatValue`/technical keys; replace the change list with result + changed fields; keep the deleted-session subject from `before`.
- `app/admin/(shell)/audit/actions.ts`, `page.tsx` -- `callRpc("admin_list_audit", …)`; pass `p_shown` from the map.
- `app/admin/(shell)/audit/audit-list.tsx` -- `AuditEntries` (phone list, desktop table), `Changes`.
- `lib/copy/admin.ts` -- `adminCopy.audit` (`actions`, `fields`, `values`, `anonymous`, `sessionLabel`, `deletedEvent`). 3.10 and 3.13 also edit it.
- `supabase/tests/audit-viewer.test.ts`, `supabase/tests/grants.test.ts:113` -- RPC tests and signature line.
- `app/admin/(shell)/audit/audit-data.test.ts`, `actions.test.ts`, `audit-screens.test.tsx` -- unit tests to update.

## Tasks & Acceptance

**Execution:**
- [x] `lib/copy/audit-actions.ts` (new) -- the map `SHOWN_AUDIT_ACTIONS` (action → primary entity, optional result builder; edits flagged) and `HIDDEN_AUDIT_ACTIONS`; `shownPairs()`. Labels and sentences from `adminCopy.audit` -- one place for rule 5.
- [x] `lib/copy/admin.ts` -- `audit.results` strings, "לקוחה שפרטיה הוסרו", session label "בראנץ׳ {קונספט} {DD.MM}", `changed: (field, after, before)`; drop labels only for hidden actions and the deleted-session field lines.
- [ ] `supabase/migrations/<new>_audit_concise.sql` -- **סשן ראשי**: drop + create `admin_list_audit(p_shown text[], …same params)`; return `related`, `subject`, derived customer; revoke/grant as before. User runs it in SQL Editor; verify objects, record in `schema_migrations`, `get_advisors`, regenerate `database.types.ts`.
- [x] `app/admin/(shell)/audit/audit-data.ts`, `actions.ts`, `page.tsx` -- pass pairs; build items (subject, result, changed fields) -- rows stay pure functions.
- [x] `app/admin/(shell)/audit/audit-list.tsx` -- start with the `frontend-design` skill within DESIGN.md/EXPERIENCE.md: phone item = when · who / action / subject / result / changed fields / reason; desktop columns "מתי", "מי", "פעולה", "על מה", "פרטים", "סיבה".
- [x] tests -- unit: every shown action has a label and a pair; every matrix row; no item renders a field list unless flagged edit; unchanged/empty fields dropped. db: whitelist, paging over hidden rows, related rows, derived customer and customer filter, `INVALID_INPUT`, grants line.
- [x] `AGENTS.md` -- under "מלכודות ידועות": "פעולה חדשה שנרשמת ביומן מקבלת שם, החלטה אם היא מוצגת, ומשפט תוצאה, ב-`lib/copy/audit-actions.ts`."
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- item, target 5.20: stop recording the hidden actions (~35 functions) once no story runs in parallel; user decision 2026-10-18.

**Acceptance Criteria:**
- Given 3.10 or 3.13 merged first, when merging main before the PR, then their new actions get a map entry and tests pass.
- Given the work sheet, notes, drafts or images changed, when opening the log, then none of it appears.

## Design Notes

"(במקום 12)" replaces "(הייתה 12)": the field names differ in gender and number ("מכסה", "מחיר", "כניסות"), and one form stays correct for all.

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` -- pass.
- `npx vitest run --project db supabase/tests/audit-viewer.test.ts supabase/tests/grants.test.ts` -- pass after the migration.

**Manual checks:** phone check per the request (no work sheet/notes/drafts/images; one approval; cancel shows session + "התקבל זיכוי לשני מפגשים"; edit shows only changes; delete is short; filters work).

## Implementation Notes

Additions agreed with the user at build start (2026-10-19):
- **Primary row selector.** A `p_shown` entry may have a third part, `"{action}/{entity_type}/insert"`: only rows whose `before` is null (a created row) are primary. Needed by 3.10, whose move writes two `bookings` rows.
- **Filters match the operation.** The session filter, like the customer filter, matches an operation when its primary or any related row has that session, so a move shows under both sessions. Each related row carries its own `event` label (same shape as the primary's).
- **3.10 (merged):** `move_booking`, `admin_move_booking` / `bookings/insert` (the new booking; subject = target session) → "הועברה מ{source session label}" from the related cancelled `bookings` row; source unknown → name only. Labels exist in `adminCopy.audit.actions` (`הזזת הרשמה`); keep them.
- **3.13 (merging now; per `.claude/worktrees/story-3-13/_bmad-output/implementation-artifacts/spec-3-13-entitlement-corrections.md`):** `admin_correct_entitlement` / `entitlements` (changed fields: expiry, weekdays, kind) and / `entitlement_movements` → "נוספו {n} כניסות" or "הופחתו {n} כניסות" (from the movement's delta); `admin_settle_parked_purchase` / `cancellation_credits` → "התקבל זיכוי, והלקוחה תבחר בין זיכוי להחזר"; `admin_set_correction_booking_handled` (name only). Labels: "תיקון זכות", "סגירת רכישה שנשארה בלי מקום", "סימון כטופל". After 3.13 merges, the main session checks the action, entity and key names against main and merges the labels it added.
- **Runtime limits:** do not run `npm run test:db` (shared dev DB in use by 3.13); write the db tests, they run later. Do not apply the migration (it has `drop`; the user runs it in the SQL Editor). Edit `lib/supabase/database.types.ts` by hand for the new `admin_list_audit` args/return so typecheck passes; it is regenerated after the migration. No git commit, push, `rm`, or `.env*` writes.
- **After the db run (2026-10-19):** a related row whose only change is a dropped key (the move's `moved_to_booking_id` update) came back with empty changes; links now leave out any row whose `private.audit_changes` is `[]`. Same signature; the user ran the `create or replace` in the SQL Editor, and the migration file carries the fixed body. Migration recorded in `schema_migrations`; advisors clean (approved WARNs only); generated types identical to the hand-edited file.

## Spec Change Log

## Review Triage Log

Pass 1 (quick, pinned by the user: one screen reviewer + one RPC reviewer, with review-accepted.md): high 0, medium 3, low 6, false 2.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | edge | Cancel of a credit-paid booking said "הכניסה חזרה לכרטיסייה"; the returned credit is not audited | medium | patch | RPC returns `private.booking_funding` for a bookings main row; credit → "הזיכוי חזר ללקוחה" |
| 2 | rpc | Filters through related rows rescanned links per main row (O(P×L)); related built for the whole range | medium | patch | `link_keys` arrays once per main row; `related` only for the page |
| 3 | rpc | Derived customer missed entitlements, credits, refund requests (filled later by bind) | medium | patch | added to the current-row lookup |
| 4 | rpc | Related row with null customer dropped when the main row has one | low | patch | also accept null |
| 5 | rpc | Empty related rows (move's second audit) returned | low | patch | excluded |
| 6 | rpc | `p_shown` not validated | low | patch | `INVALID_INPUT` field `shown` on null or malformed element |
| 7 | rpc | db tests: derived customer via payments/tokens unproven; no real move/cancel; no paging through a related-only filter; subjects/amount untested | low | patch | tests added (run after the migration) |

Rejected: system rows merging across operations (no system writer has secondary rows today); "לקוחה שפרטיה הוסרו" for a `?customer=` uuid matching no profile (pre-existing wording path, a hand-typed URL).
