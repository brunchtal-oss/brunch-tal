---
title: '5.20 Unified refactor sweep after the demo'
type: 'refactor'
created: '2026-10-22'
status: 'done'
baseline_commit: 'da0f51f23c4276cd3d85fb723c9307f4860ac992'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-brunch-at-tals-2026-09-24/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After rounds 1–7 the code carries dead entries, missing tests, migration files whose names do not match their DB versions (6.1 must replay them from zero), audit rows nobody sees (fix 6), test data that leaks when a run is killed (fix 8), and the pre-5.20 audit findings plus four user decisions of 2026-10-22.

**Approach:** One spec, two PRs from one tab. **(A)** `story-5-20a-refactor-sweep`: no DB change — renames, dead code, tests, UI fixes, business name from content, docs, deferred-work closure. **(B)** `story-5-20b-refactor-sweep-db`, from origin/main after (A) merged: one migration (user runs it in SQL Editor) plus the code that goes with it.

**Decisions (user, 2026-10-22):** archived-concept duplicate blocked; reopening registration notifies the waitlist; changing the event kind of a product marked eligible is blocked; baby birth date from 2 years back to 9 months ahead (join, profile, `babies_guard`); anonymize blocked while a paid pinned purchase without a seat is unsettled; business name read from content; push endpoints only from known push services; 6.2 cancelled, so its anonymize/join/bind items are here.

**Decisions (this spec, user may override at approval):**
- CONCURRENT_CHANGE tests for 3.8, 3.9, 3.13 and the `CREDIT_LOCKED` path of 5.10: **add**.
- Flow 9 units/entitlement in the audit (4.5): **close** — needs changing `book_core`/`cancel_core`, high risk for a display gain.
- Move click test (3.10): **close** — no testing-library; server `can_move` and `moveTapAction` are tested.
- `days_left` Israel-time test (4.12): **close** — the code is correct; a deterministic test needs redefining `get_my_entitlements` for a test only.
- Notes renumbering test: **close** — one-time migration, already applied.
- `hide_unused_media` (3.17): **close** — a draft is never hidden; a published-not-yet-attached image can be hidden in a race, but attach then fails with `MEDIA_NOT_PUBLISHED` and re-publish works from the kept draft file.
- Anonymize "pending link keeps `payer_label`" (4.6): **close** — does not happen (`admin_approve_payment` creates no link when `p_customer_id` is set).
- `bind_purchase` counts `completed` (3.12): only the other-booking side was fixed in 3.5; the pinned side still uses `b.status = 'confirmed'` → **fix** in (B).

**Decisions (user, at spec review 2026-10-22):**
- Payment-void checks (deferred L92, L393): **out of scope, open user decision** (taken separately via the planning tab). Stay open in deferred-work; no 5.20 item depends on them.
- `/me/bookings` row for a booking cancelled with its session (L588): **close** — the pending-choice card already says the session was cancelled.
- Orphan photo drafts in Storage (5.4): **manual dev script now** (`scripts/dev-clean-media-drafts.mjs`); production decided in 6.1. Hidden images keep their draft files (re-publish uses them).

## Boundaries & Constraints

**Always:**
- (A) touches no DB object. Migration renames are `git mv` only, file content unchanged; afterwards every file prefix equals its `schema_migrations.version`.
- (B): every function redefined from live `pg_get_functiondef`, never from an old file. One migration file; the user runs it in SQL Editor (fresh empty query), then the main session records version+name in `supabase_migrations.schema_migrations`, runs `get_advisors`, regenerates `lib/supabase/database.types.ts`, and a full `test:db` after the planning tab ("מנהל העבודה 2") clears it.
- Security-definer rules (AGENTS.md): `search_path = ''`, caller check first, revoke + exactly one grant, idempotency key on writers, lock order session → entitlement.
- Every screen change starts with the `frontend-design` skill inside DESIGN.md/EXPERIENCE.md. Data-changing buttons use `OnlineButton`. New error code → `lib/errors.ts`; Hebrew copy written by the dev, no arrows, no "טל" in customer copy.
- `dev-clean-test-data.mjs` deletes only test data, prints the plan first, runs only with `--apply` and only against the dev project (`scripts/dev-guard.mjs`). Never run with `--apply` without the user's OK.
- Before (B) migration runs: tell the user what breaks on the live site between run and merge (Design Notes). Merge quickly after.

**Never:**
- Touch `scripts/demo-*.mjs`, `demo:seed`, `demo:clear` (5.22 rewrites them); never run them.
- Import customers / `prior_participation_override` (6.2 cancelled), video data (5.22), anything production (legal page copy, exposed schemas, `net`, admin instructions, `issue_reset_token` → 6.1).
- Edit `components/ui/`. Copy the audit report into the repo, or describe an unfixed weakness in repo docs.
- New customer capability beyond the decisions above.
- Delete or auto-touch: נועה בדויה (dev-customer@example.com), dev-admin@example.com, "גלית ותיקה בדויה", Maya Barak (`maya.barak@demo.example.com`) and her booking, any `@demo.example.com` customer.
- Subagents: no git push/PR/merge, no `git rm`/`rm`, no `.env*` writes (main session).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Duplicate archived | `admin_duplicate_event` on a session whose concept has `archived_at` | rejected, nothing written | `CONCEPT_ARCHIVED` |
| Reopen registration | `admin_update_event` moves `registration_closes_at` from ≤now to >now, published, not started, room for one | `notify_waitlist(id, 0)` once; capacity growth in the same call does not notify twice | — |
| Reopen, full | same, no room | no notification (notify_waitlist checks room) | — |
| Product kind | `admin_update_product` changes `eligible_event_kind` while in `event_products` of a non-cancelled session not started | rejected | `PRODUCT_IN_USE` |
| Product kind, past only | marked only on past/cancelled sessions | saved | — |
| Birth date | join/profile/direct insert with date < today−2y or > today+9m (Asia/Jerusalem) | rejected | `INVALID_INPUT` field `birth_date` |
| Birth date, old row | update of an existing baby's name only, date already out of range | saved (guard checks only on insert or date change) | — |
| Anonymize, parked | customer has active pinned entitlement, no booking for its payment (own or behind her join link) | blocked, plan lists `parked_purchases` | `ANONYMIZE_BLOCKED` |
| Anonymize, awaiting_login seat | confirmed future booking, `customer_id` null, payment behind her `awaiting_login` token | blocked under bookings | `ANONYMIZE_BLOCKED` |
| Anonymize, email change | `account_op_state = 'email_change_pending'` | rejected, nothing changed | `CONCURRENT_CHANGE` |
| Anonymize, claiming | her token in `claiming` with `pending_user_id` | token revoked, that Auth user deleted after the RPC | — |
| Push endpoint | `https://fcm.googleapis.com/...`, `https://web.push.apple.com/...`, `https://x.notify.windows.com/...`, `https://updates.push.services.mozilla.com/...` | saved | — |
| Push endpoint, other | other host, `@`, non-443 port, uppercase trick | rejected; worker also skips such a row | `INVALID_INPUT` field `endpoint` |
| Credit candidates | `credit_session_matches` / `plan_admin_cancel_event` for a session that does not accept the credit's / card's product | not offered / counted at risk | — |
| Bind after completion | pinned booking already `completed`, customer has another real booking in that session | `BIND_CONFLICT`, not raw 23505 | `BIND_CONFLICT` |
| Settings | `credit_expiring_days` 0 or 31 / 1..30 | rejected / saved, audited | `INVALID_INPUT` |
| Promo banner | 60-char word without spaces at 320px | wraps, no horizontal scroll | — |
| Short line | text ≤30 chars / 31–60 / >60 or with `\n` | centred / start on phone, centred from `sm` / start | — |
| Notes board | 0 active, ≥1 archived | "כל הפתקים בארכיון." (not the empty-board text) | — |

</frozen-after-approval>

## Code Map

**(A)**
- `supabase/migrations/` -- 53 renames (`old -> new`, name unchanged): 20260929154813->20260929154955 revoke_default_privileges; 20260929154816->20260929155035 create_identity_and_reset_tokens; 20260929155049->20260929155057 make_session_role_invoker; 20260930171231->20260930171358 create_time_and_phone_helpers; 20260930172341->20260930172419 fix_normalize_phone; 20260930191525->20260930191929 create_rpc_contract; 20260930193304->20260930193330 fix_reset_begin_and_audit; 20261001165149->20261001165205 fix_entitlement_expiry_without_grant; 20261001170905->20261001170937 restrict_customer_money_columns; 20261001184225->20261001184827 create_notification_core; 20261001195103->20261001201839 create_join_flow; 20261002041859->20261002044147 fix_content_sections_policy; 20261002051951->20261002052004 update_card_post_join_message; 20261002181416->20261002182800 existing_account_and_conflicts; 20261002194018->20261002194957 identity_retry_and_conflict_reasons; 20261002200634->20261002200824 token_view_bound_user; 20261003141504->20261003190437 link_lifecycle_and_recovery; 20261003192326->20261003192417 join_begin_discard_before_lock; 20261003220222->20261004065006 repeat_purchase_and_amount_override; 20261004070751->20261004071127 repeat_purchase_review_fixes; 20261004075337->20261004075417 payer_label_review_fixes; 20261004102035->20261004103954 product_catalog_admin; 20261004122702->20261004122904 content_publish; 20261004131740->20261004131751 public_pages; 20261004143612->20261004145805 concepts_and_events; 20261004160747->20261004160820 create_event_defaults_and_publish; 20261004183409->20261004185815 bookings_and_self_booking; 20261004191220->20261004191652 bookings_review_fixes; 20261004200534->20261004200544 card_every_weekday; 20261004212706->20261004215859 pinned_product_approval; 20261004221450->20261004221907 pinned_approval_review_fixes; 20261005075629->20261005080440 intro_only_without_bookings; 20261005111717->20261005112857 pinned_display_and_duplicates; 20261005160954->20261005162437 duplicate_warning_by_name; 20261005171826->20261005173142 multi_date_booking; 20261005193624->20261005195410 admin_session_details_and_manual_booking; 20261005193920->20261005194206 media_upload_and_publish; 20261005194705->20261005194737 get_my_entitlements; 20261005200619->20261005200639 get_my_entitlements_active_flags; 20261005203730->20261005203814 media_publish_review_fixes; 20261005225116->20261005225310 admin_home; 20261005232157->20261005232525 profile_babies_and_photo_consent; 20261005232647->20261005233144 cancel_booking; 20261005234204->20261005234223 cancel_booking_preview_key; 20261006000155->20261005235701 set_photo_consent_not_found_guard; 20261006001058->20261006001238 cancel_booking_review_fixes; 20261006104423->20261006111809 notification_centers; 20261006111121->20261006111238 session_completion_job; 20261006142736->20261006142810 session_completion_review_fixes; 20261006183915->20261006184305 business_settings_and_templates; 20261006194417->20261006194531 business_settings_review_fixes; 20261006220218->20261006220241 session_reminders; 20261010115255->20261010115547 concepts_admin. New file order = applied order (4 moves). Re-verify against a fresh SELECT before moving.
- `test/invisible-chars.test.ts:48` -- `EXEMPT` path must become `20260930171358_create_time_and_phone_helpers.sql` (functional). `:46` comment. `lib/content/photo-consent-seed.test.ts` and `lib/copy/audit-actions.test.ts` are unaffected (already matching / `readdirSync`). Old prefixes in 29 migration comments: leave (applied files stay byte-identical). Docs: update only README/AGENTS (none found); spec history files keep old names.
- `lib/copy/audit-actions.ts:405-457` -- `HIDDEN_AUDIT_ACTIONS` (46). (A) removes the 7 dead ones (4 `note_topic`, `admin_add_shopping_item`, `refresh_returned_entitlements`, `migrate_identity_match`). `audit-actions.test.ts:66-82` scans all migrations incl. old ones → add test-local `RETIRED_AUDIT_ACTIONS` counted as decided.
- `components/customer/balance-card.tsx` -- dead `BalanceCard` (22-97); keep `EntryMeter` (99-128), `METER_MAX` (11) → move to `components/customer/entry-meter.tsx`; imports in `app/me/purchases/[id]/page.tsx`, `customers/[id]/entitlements/[entitlementId]/page.tsx`, `customers/[id]/balance-plates.tsx`, `customers/[id]/card-items.ts`, `components/customer/home-card.tsx`. Keep the `customerCopy` tests from `balance-card.test.tsx`.
- `app/admin/(shell)/payments/new/form-data.ts:33,50-63` -- `.eq("active", true)` + mapping → pure `product-options.ts` `toProductOptions(rows)` (pattern: `event-options.ts`). Replace the stale copied query in `supabase/tests/product-catalog.test.ts:149-153`, keep its `PRODUCT_NOT_AVAILABLE` assertion.
- `app/admin/(shell)/sessions/[id]/day/page.tsx` -- redirect; test via `RedirectSignal` pattern of `app/(auth)/login/actions.test.ts:29-52`. Also link `sessions/[id]/page.tsx:89` and `app/admin/(shell)/work/page.tsx` (`WorkSessions`, export it; mock `../home/load-home`).
- `app/admin/(shell)/content/content-items.ts` -- receive `statementBlocked(page)` (now local in `[slug]/preview/page.tsx:139-142`) and `editorStatementBlock(section)` (from `editor-page.tsx:90-93`); unit test.
- `app/me/sessions/[id]/page.tsx:64-219` -- export `SessionContent`; test like `app/me/home.test.tsx` (mock server client `.from()` chain, `@/lib/rpc`, business details, navigation).
- `app/admin/(shell)/home/reminder-strip.tsx:31-41` -- inline query → `loadLatestReminder()` in `load-home.ts`; chain-mock test as `lib/content/business-details.test.ts:9-29`.
- `app/admin/(shell)/settings/marketing/texts-editor.tsx:186`, `schedule-editor.tsx:83` -- key replaced only after an answer; correct pattern `concepts/[id]/concept-editor.tsx:298-313`. Do NOT copy/change `components/admin/value-change-row.tsx` `saveWithKey` (opposite convention). Test via a pure helper, like `value-change-row.test.tsx:58-95`.
- `components/public/sections.tsx:86-89,131,135`, `sections.test.ts` -- `isShortLine` → tiered alignment helper (exported, tested incl. the class actually used).
- `components/public/promo-banner.tsx:18` -- add `[overflow-wrap:anywhere]` (as `notes/note-item.tsx:100`).
- `app/admin/(shell)/notes/notes-view.tsx:49`, `lib/copy/admin.ts:~2048` -- all-archived state; `notes-screens.test.tsx`.
- Business name: `lib/content/business-details.ts` `getBusinessDetails()` (`'use cache'`, tag `content:global`) → `business_name` (`lib/content/schema.ts:114-116`, edited in תוכן › קשר). Consumers: `app/layout.tsx:36-45` static `metadata` → `generateMetadata` (title default/template, `appleWebApp.title`); `components/shared/app-top-bar.tsx:43-46` via `app/me/layout.tsx:28`, `app/admin/(shell)/layout.tsx:32`; `app/(public)/install/page.tsx:7,30`; `app/manifest.ts` (async). `WORDMARK` (`lib/copy/shell.ts:7`) stays as fallback; `app/offline/page.tsx`, `public/sw.js:30` stay static. Already dynamic: `app/(public)/layout.tsx:45`.
- Admin capacity read: `app/admin/(shell)/sessions/load-session.ts:13` `SESSION_COLUMNS` selects `events.capacity_adults` (used by `sessions/page.tsx:85`, `sessions/[id]/edit/page.tsx:62`). (A) moves it to admin RPCs that already return capacity (`admin_list_session_occupancy`, `admin_get_event_details`), so (B)'s revoke breaks nothing. If no existing RPC covers a use, that piece moves to (B).
- `README.md:111` (7 → 8 cron jobs, add `marketing_reminders`, 5.11), `supabase/seed.sql:11-13`, `AGENTS.md:26` (trigger `private.guard_auth_user_change`: phone change always refused; email only when `email_change_pending` with matching hash; `set local app.allow_auth_identity_change = 'on'` bypasses for SQL Editor).

**(B) — latest defining migration (after renames)**
admin_duplicate_event, admin_update_event: `20261020200233_eligible_products` · admin_update_product: `20261004103954_product_catalog_admin` · babies_guard: `20261005232525_profile_babies_and_photo_consent` · join_complete: `20261007183144_two_photo_consents` · plan_admin_cancel_event: `20261013162639_business_cancel_event` · credit_session_matches: `20261019204039_credit_adjustments` · admin_anonymize_customer: `20261020203837_remove_personal_details_fixes` · plan_admin_anonymize_customer, admin_get_customer: `20261020200750_remove_personal_details` · bind_purchase, notify_waitlist: `20261019233604_waitlist` · admin_update_business_settings: `20261020194721_marketing_reminders` · register_push_subscription: `20261006184326_push_pipeline` · hide_unused_media: `20261005203814_media_publish_review_fixes` · admin_approve_payment: `20261013182941_pinned_single_notification`. For the other audit writers record the file in Implementation Notes when redefining.
- Fix 6 writers (remove only `perform private.audit(...)`; keep idempotency): work sheet (12), shopping (5), notes (7), `admin_set_content_draft`, `admin_create_media`, `admin_begin_media_publish`, `admin_finish_media_publish`, `private.hide_unused_media` (`media_hidden`), `admin_set_event_image`, `admin_set_concept_image`, `admin_approve_payment` (its own 2 rows; `approve_payment` from `approve_payment_core` stays), `admin_begin_email_change` (2), `admin_finish_anonymize_customer`, `join_begin` (2), `claim_join`, `set_booking_guest_details`. No logic reads these rows (only `admin_list_audit`, `preview_book_session` on `admin_cancel_event`, anonymize masking).
- DB tests asserting hidden rows → update: `work-sheet.test.ts:308,352,531,760`, `shopping-items.test.ts:146,252-279,308,368`, `notes.test.ts:339,371,380,481`, `media.test.ts:688`, `delete-event.test.ts:394`, `couple-and-intro.test.ts:264`, `existing-account.test.ts:639`, `account-admin.test.ts:239,284`, `approve-payment.test.ts:143,193`; re-check `join.test.ts:317`, `remove-personal-details.test.ts:320`.
- Anonymize UI: `app/admin/(shell)/customers/[id]/remove-details-items.ts:45-113`, `lib/server/privileged/anonymize.ts`, `deleteOrphanUser` in `lib/server/privileged/join.ts:281` (as `links/actions.ts:27-33`).
- Customer card: `customers/[id]/card-items.ts:~344-362` `toBookingItem`; copy `lib/copy/admin.ts:1935-1939`; audit `audit-data.ts` `formatValue` + `lib/copy/admin.ts:2347` `moved_to_booking_id`. Model: `get_my_bookings` moved join (`20261018075214_move_booking.sql:505`).
- Audit subject: `public.admin_list_audit` `'subject'` case; TS `audit/audit-data.ts:405-426` `subjectOf`; `audit-data.test.ts:518-530`.
- Settings: `settings/actions.ts:16-33`, `page.tsx:20`, `settings-draft.ts:11,33-48`, `settings-editor.tsx:207-210`, copy `lib/copy/admin.ts:~1459,~1476,~2374`. Column exists (int, default 5, check 1..30).
- Birth date TS: `app/me/profile/actions.ts:56-72`, `babies-section.tsx:323,333`, `lib/copy/customer.ts:181`; `app/(auth)/join/[token]/join-input.ts:84-96`, `join-form.tsx:501`, `lib/copy/join.ts:88`, `actions.ts:68`; `lib/errors.ts:138-139`; `lib/time.ts` (`localToday`, `isPlainDate`; no add-months helper). Future baby: `babyAge` returns null → no age text (acceptable).
- Push: `public.register_push_subscription` (regex only), `lib/server/privileged/push-worker.ts:~185`. Dev endpoints: `fcm.googleapis.com` ×2.
- Broadcast: template row, `notification_templates_type_check` (24 types incl. `broadcast`), `lib/copy/admin.ts:1561`, `push-worker.ts:23` comment, `settings/actions.test.ts:104`, `settings-screens.test.tsx:162`, `notifications.test.ts` SEED (~332, → 23) and constraint test (~384). 0 broadcast notifications in dev.
- Grants: `waitlist_entries` (`20261019233604_waitlist.sql:70-72`), policies `waitlist_entries_admin_select` + `_customer_select`; `supabase/tests/grants.test.ts:229-230,243-246`.
- Test data: `supabase/tests/support/db.ts` (`runId`, `testName`, `onCleanup`, `seedAdmin`, `setup.ts` afterAll); committed setups in booking-concurrency, cancel-booking, delete-event, auto-extend, move-booking, push, repeat-purchase, scheduled-jobs, session-completion, profile; `scripts/dev-guard.mjs` (`devRef`). `demo-clear.mjs` only as an FK-order reference (read, do not change). Dev today: 0 `test_` rows.

## Tasks & Acceptance

**Execution — Part A** (worktree `story-5-20a-refactor-sweep`)
- [x] `supabase/migrations/*` -- SELECT `schema_migrations`, confirm the 53 pairs, `git mv` each; script check: every prefix ↔ version, 116 ↔ 116 -- 6.1 replay.
- [x] `test/invisible-chars.test.ts` -- new exempt path -- functional reference.
- [x] `lib/copy/audit-actions.ts`, `audit-actions.test.ts` -- drop 7 dead actions; `RETIRED_AUDIT_ACTIONS` in test -- dead entries.
- [x] `components/customer/entry-meter.tsx` (+ test), 5 imports, `balance-card.*` -- move EntryMeter/METER_MAX; rewrite plate test with `renderToStaticMarkup`; move copy tests; deleting `balance-card.*` = main session -- 3.7.
- [x] `payments/new/product-options.ts` (+ test), `form-data.ts`, `product-catalog.test.ts` -- hidden products filtered by the tested function -- 2.6.
- [x] tests: `/day` redirect + link + `/admin/work` (≤3 links, empty); `content-items.ts` statement block helpers; `SessionContent` waitlist (`?from=waitlist`, active entry, full); `loadLatestReminder` -- 4.9, 5.5, 5.6, 5.11.
- [x] marketing editors -- key only after an answer (pure helper + test: ok → new key, refusal → new key, throw → same key) -- audit 4 #6/#7.
- [x] `frontend-design` first; `sections.tsx` tiered alignment + test catching an inverted condition; check 360px -- fix 18.
- [x] `frontend-design`; `promo-banner.tsx` wrap; check 320px.
- [x] `frontend-design`; `notes-view.tsx` + copy `allArchived: "כל הפתקים בארכיון."` + test.
- [x] `frontend-design`; business name: root `generateMetadata`, top bar (both shells), `/install` caption, async `app/manifest.ts`; fallback `WORDMARK`; tests for fallback and override.
- [x] `sessions/load-session.ts` and its pages -- stop selecting `capacity_adults`; read capacity from existing admin RPCs -- prepares (B) revoke.
- [x] `README.md`, `supabase/seed.sql`, `AGENTS.md` -- cron 8 jobs; seed comment "seed is intentionally empty; dev data comes from scripts"; 2.8 line per Code Map -- docs.
- [x] `deferred-work.md` -- mark closed with evidence: L8, L13, L18, L33, L51, L62, L67, L72, L77, L82, L87, L98, L108, L119, L124, L145, L168, L197, L202, L213, L236, L241, L264, L285, L376, L433 (other side; pinned side fixed in B), L472, L477, L505 (note for 5.22), L583, L723, L573, L635, L388, L639 (with this spec's close reasons); L588 (user decision); retarget L318→5.20, L3/L269→6.1, L371→6.9, L568→5.20; L92/L393 stay open; items fixed by (A) closed at (A).

**Execution — Part B** (worktree `story-5-20b-refactor-sweep-db`, after A merged)
- [x] `npx supabase migration new refactor_sweep_db` -- one file, contents:
  - `create extension if not exists pgcrypto with schema extensions;`
  - fix 6: redefine the writers listed in Code Map without the audit call.
  - `admin_duplicate_event`: archived concept → `CONCEPT_ARCHIVED`.
  - `admin_update_event`: reopen → `notify_waitlist(id, 0)`, merged with the capacity call (one call max).
  - `admin_update_product`: kind change while in `event_products` of a non-cancelled future session → `PRODUCT_IN_USE`.
  - `babies_guard` (insert or date change) and `join_complete`: `date < today − 2 years or > today + 9 months`, today in Asia/Jerusalem.
  - `credit_session_matches`, `plan_admin_cancel_event`: `private.event_accepts_product(session, (eligibility_snapshot->>'product_id')::uuid)` of the credit's source entitlement / the card.
  - `bind_purchase`: `private.is_real_booking(b.status)` on the pinned side.
  - anonymize: `plan_admin_anonymize_customer` + `parked_purchases` list and awaiting_login seats in bookings; `admin_anonymize_customer` checks `email_change_pending` → `CONCURRENT_CHANGE`, returns `orphan_user_ids` from revoked `claiming` tokens; same in `preview_admin_anonymize_customer`.
  - `admin_list_audit`: subject for `marketing_reminder_texts` = body (TS cuts to 40 chars + "…").
  - `admin_update_business_settings`: `credit_expiring_days` in key list, range 1..30, assignment, update list.
  - `admin_get_customer`: bookings add `moved_to_starts_at`.
  - `admin_list_session_occupancy`: return `capacity` with `occupied`; `sessions/page.tsx` reads it from there and `SESSIONS_LIST_COLUMNS` goes (no direct read of `capacity_adults` left; grep before the revoke).
  - grants: `revoke select on public.events from anon, authenticated` + column grant of all other columns; `revoke all on public.waitlist_entries from service_role`; replace the two SELECT policies with one `waitlist_entries_select` (`(select private.is_admin()) or customer_id = (select private.current_customer_id())`).
  - `register_push_subscription`: host allowlist (exact `fcm.googleapis.com`, `updates.push.services.mozilla.com`; suffix `.push.apple.com`, `.notify.windows.com`), lowercase, no userinfo, port absent or 443.
  - broadcast: delete the row, drop + re-add `notification_templates_type_check` without it (from live definition).
- [x] `lib/errors.ts` -- `CONCEPT_ARCHIVED`: "הקונספט של המפגש בארכיון, ולכן אי אפשר לשכפל אותו. אפשר להחזיר את הקונספט מהארכיון ואז לשכפל."; `PRODUCT_IN_USE`: "המוצר מסומן כתקף במפגשים קרובים, ולכן אי אפשר לשנות את סוג המפגש שלו. קודם צריך להוריד אותו מהמפגשים האלה."
- [x] `lib/copy/audit-actions.ts` -- remove all remaining hidden actions (list becomes empty → remove constant and its uses); test `RETIRED_AUDIT_ACTIONS` grows; new `supabase/tests/audit-retired-actions.test.ts`: no live function body calls `private.audit` with a retired action -- fix 6.
- [x] `frontend-design`; birth date in join + profile: `min`/`max`, shape check, copy in `lib/copy/customer.ts` and `lib/copy/join.ts` becomes "תאריך הלידה יכול להיות עד שנתיים אחורה ועד 9 חודשים קדימה."; `lib/time.ts` add-months/years helper + test.
- [x] `frontend-design`; settings field "זיכוי עומד לפוג" (labels in the pattern of `customerExpiring`: `'"זיכוי עומד לפוג" אצל הלקוחה (ימים לפני התפוגה)'`, show name `'"זיכוי עומד לפוג" אצל הלקוחה'`, audit `'"זיכוי עומד לפוג" אצל הלקוחה (ימים)'`) -- 5.10.
- [x] `frontend-design`; customer card: moved booking "הועברה ל-{DD.MM}"; audit hides `moved_to_booking_id` value (technical) -- 3.10.
- [x] anonymize TS: `parked_purchases` blocker group "תשלום על מפגש בלי מקום, שעוד לא סודר" linking to "לטיפול"; delete `orphan_user_ids` via `deleteOrphanUser`; tests.
- [x] `push-worker.ts` -- same allowlist before sending (shared pure helper + unit test); remove broadcast comment; `lib/copy/admin.ts:1561` broadcast key; broadcast tests.
- [x] `audit-data.ts` -- `marketing_reminder_texts` subject.
- [x] `supabase/tests/support/db.ts` -- SIGINT/SIGTERM/`beforeExit` run pending `onCleanup`s once; committed test events get `description = testName(...)` -- fix 8(ג).
- [x] `scripts/dev-clean-test-data.mjs` (+ unit test of the selection/protection logic) -- dev-guard; roots: `test\_%` in profiles.full_name, products/payment_methods/concepts.name, events.description, auth.users.email; admin_roles without auth user and without profile; dependents in FK order (Code Map/agent order incl. `entitlement_corrections*`, `entitlement_movements` trigger disabled locally, `audit_log`, `private.idempotency_results`); profiles without Auth user that are NOT `test_` are only listed for manual review; protected list asserted untouched; default dry-run prints counts per table.
- [x] `scripts/dev-clean-media-drafts.mjs` -- dev-guard; candidates: `media_assets` in `draft`, not in any `content_sections.draft_content`/published content/`events.image_id`/`concepts.default_image_id`, older than 7 days; dry-run lists, `--apply` removes the `media-drafts` object via Storage API then the row; never hidden/published rows; run only with the user's OK -- 5.4.
- [x] DB tests: every matrix row of (B), grants test updates, CONCURRENT_CHANGE for `admin_cancel_event`/`admin_reschedule_event`, `admin_complete_refund`, `admin_correct_entitlement`/`admin_settle_parked_purchase`, `CREDIT_LOCKED` in `job_complete_events`; anonymize audit test asserts `payment_note` present before and `<removed>` after.
- [ ] `fixes-log.md` (fixes 6, 8 → תוקן), `deferred-work.md` (#79 and B items closed), `tickets.toml` done (`tickets.py pull`, `mark done`).

**Acceptance Criteria:**
- Given (A) merged, when listing `supabase/migrations`, then 116 files each named `<schema_migrations.version>_<name>.sql` and content diff is empty (renames only).
- Given the site with business name changed in תוכן › קשר and published, when loading any page, then tab title, top bars (/me, /admin) and `/install` caption show the new name; manifest serves it to new installs.
- Given (B) applied, when running `get_advisors`, then only the approved WARNs; `grants.test.ts` passes; `notifications.test.ts` seed test passes with 23 templates.
- Given a full `test:db` after (B), then all pass and 0 `test_` rows remain in dev (dry-run of the cleanup script shows nothing).
- Given anon or a customer, when selecting `events.capacity_adults` via REST, then permission denied; admin session pages still show capacity.

## Implementation Notes

- (A) migrations: the 53 pairs were re-derived from a fresh `schema_migrations` SELECT (matched by name) and equal the Code Map list; after `git mv` all 116 files are `<version>_<name>.sql` and the diff is 53 × R100.
- (A) capacity: `admin_get_event_details` covers the edit page (`toSessionRow(row, details.capacity)`, `SESSION_COLUMNS` no longer has `capacity_adults`). No existing admin RPC returns capacity for the sessions list (`admin_list_session_occupancy` returns only `occupied`), so the list keeps `SESSIONS_LIST_COLUMNS` (`capacity_adults` included) and that piece moves to (B): `admin_list_session_occupancy` adds `capacity`, the list reads it from there, then the revoke.
- (A) `balance-card.tsx` / `balance-card.test.tsx` are no longer imported; deleting them is a main-session task (`git rm`).
- (A) business name: `getBusinessName()` / `businessNameOf()` in `lib/content/business-details.ts`; root metadata built by `lib/root-metadata.ts` (a layout file may not export helpers); `shellCopy.titleTemplate` removed (unused), `titleTemplateOf(name)` instead. `/me` and `/admin/(shell)` layouts are async and await the cached read.
- (A) marketing editors: `sendWithKey` in `marketing-draft.ts` (answer → new key, throw → `SERVER_ERROR` and the same key).
- (A) `supabase/tests/product-catalog.test.ts` changed (runs `toProductOptions`) but `test:db` was not run in (A) (needs the planning tab's OK).

- (A) done 2026-10-22: review pass 1 patched (see Triage Log); `balance-card.*` deleted (main session, `git rm`); `product-catalog.test.ts` ran with the planning tab's OK (13/13); lint, typecheck, format:check, `npm test` (215 files, 2581 tests) and `npm run build` pass. Status stays `in-progress` until (B) is built and reviewed.

- (A) merged 2026-10-22 as #120 (`95458270fabb741e7965124196326a103ad1cfb0`); prod check passed (no login, customer, admin). Part B baseline: `95458270fabb741e7965124196326a103ad1cfb0`, worktree `brunch-wt-5-20b`, branch `story-5-20b-refactor-sweep-db`.
- (B) built and reviewed 2026-10-22: migration `20261022154256_refactor_sweep_db.sql` (55 functions; each body compared to live — only planned lines change); review pass 1 patched; lint, typecheck, format:check, `npm test` (218 files, 2607 tests), build pass. Waiting for the user to run the migration in SQL Editor; then record it, `get_advisors`, regenerate types, full `test:db`.

- (B) migration `20261022154256_refactor_sweep_db.sql`: 53 functions, each from its live `pg_get_functiondef` (the defining file is named above each one in the migration), plus two pure helpers `private.birth_date_allowed(date, date)` and `private.push_endpoint_allowed(text)` (no grant). Not applied (user runs it in SQL Editor). The SQL and plpgsql bodies were parsed with libpg-query (all pass, except `admin_duplicate_event` and `admin_update_business_settings`, whose unchanged live definitions fail the same way: a parser bug).
- (B) fix 6 writers and their defining files: `private.hide_unused_media` 20261005203814_media_publish_review_fixes · `admin_add_note`, `admin_update_note`, `admin_delete_note`, `admin_set_note_archived`, `admin_set_note_done`, `admin_set_note_order`, `admin_set_note_pinned` 20261021064354_notes_without_topics · `admin_add_prep_day`, `admin_add_work_dish`, `admin_add_work_task`, `admin_delete_work_task`, `admin_set_work_task_done` 20261006184223_work_sheet · `admin_add_shopping_items`, `admin_move_prep_day`, `admin_remove_prep_day` 20261007154028_work_sheet_phone_check · `admin_delete_work_dish`, `admin_set_work_dish_order`, `admin_set_work_task_order`, `admin_update_work_dish`, `admin_update_work_task` 20261006191118_work_sheet_review_fixes · `admin_delete_shopping_item`, `admin_set_shopping_item_bought`, `admin_set_shopping_item_order`, `admin_update_shopping_item` 20261006215720_work_sheet_shopping · `admin_approve_payment` 20261013182941_pinned_single_notification · `admin_begin_email_change` 20261013203359_account_admin_and_rate_limit · `admin_create_media`, `admin_begin_media_publish`, `admin_finish_media_publish`, `admin_set_event_image` 20261005194206_media_upload_and_publish · `admin_finish_anonymize_customer` 20261020200750_remove_personal_details · `admin_set_concept_image` 20261010115547_concepts_admin · `admin_set_content_draft` 20261004122904_content_publish · `claim_join` 20261002182800_existing_account_and_conflicts · `join_begin` 20261003192417_join_begin_discard_before_lock · `set_booking_guest_details` 20261013161248_couple_and_intro. Only the `perform private.audit(...)` calls went; the empty `if` left in `admin_begin_media_publish` went with it, and two comments that said "audited/logged" were reworded.
- (B) `RETIRED_AUDIT_ACTIONS` lives in `lib/copy/retired-audit-actions.ts` (test-only module) so the unit test and the new DB test share it.
- (B) reopening: `v_old.registration_closes_at <= now()` and the saved one `> now()`, published, not started → `notify_waitlist(id, 0)`; otherwise a capacity raise as before (`elsif`, one call max).
- (B) anonymize: parked purchases are the attention list's "paid without a place" (active pinned entitlement, no booking on its payment), hers or behind any of her join tokens (customer, bound or pending user); awaiting_login seats are confirmed future bookings with no customer behind her `awaiting_login` join token. `orphan_user_ids` excludes her own id (a claim token's pending user is her profile id).
- (B) push: a disallowed subscription row is skipped by the worker (neither delivered nor gone), so the job is not failed for it.
- (B) not done here (main session, after the migration runs): `get_advisors`, `database.types.ts`, full `test:db`, `tickets.py mark done` (only after merge). `node scripts/dev-clean-test-data.mjs` (dry run) and `node scripts/dev-clean-media-drafts.mjs` (dry run) ran against dev: no test data; one non-test profile without an Auth user listed; 4 unused drafts older than 7 days listed. Neither ran with `--apply`.

## Spec Change Log

## Review Triage Log

**Pass 1 — Part A** (blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 2, low 7, false 0, maybe-false 0; rejected 10.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `sendWithKey` replaces the key on a returned `SERVER_ERROR` (edge, blind) | medium | patch | `lib/rpc.ts:52-54` returns `SERVER_ERROR` from its catch, i.e. possibly after commit; keep the key on `SERVER_ERROR` too, plus test. |
| 2 | Sessions list still reads `capacity_adults`; (B) had no task for it (edge) | medium | patch (spec task) | Added the `admin_list_session_occupancy` + `capacity` bullet to Part B; Design Notes breakage list updated. |
| 3 | Edit page capacity path untested (verification-gap, blind) | low | patch | Add `edit/page.test.tsx`: capacity from RPC `capacity`, `NOT_FOUND` → `notFound()`. |
| 4 | Hero and content preview still `details?.business_name ?? wordmark` (blind) | low | patch | `app/(public)/page.tsx:34`, `preview/page.tsx:171` → `businessNameOf`. |
| 5 | `customerCopy.toBook` dead after BalanceCard removal (edge) | low | patch | Only BalanceCard used it; delete. |
| 6 | AGENTS.md names the function as the trigger (blind) | low | patch | Trigger is `guard_identity_change` (`20261013203359_…:662`); this story owns the line (prompt item 11). |
| 7 | deferred-work: bind_purchase entry marked closed while (B) half open (blind) | low | patch | Keep open, target 5.20 (B). |
| 8 | deferred-work: BalanceCard status says "main session"; retargets without reason; old filename in hide_unused_media evidence (intent, blind) | low | patch | Status, reasons and filename fixed. |

Rejected: edit page throws on a non-NOT_FOUND RPC error (same as its existing read-error throw); `%s` inside the business name (unlikely, adds a guard); `short_name` length (same 13-char name as before, OS truncation); edit page reads attendee data server-side only (never sent to the browser, admin-only); screens' use of `sendWithKey` untested (spec: no testing-library, helper tested); no editor hint/length limit on business name and cached null after a failed read (today the name equals WORDMARK; adds UI/complexity); layout wiring untested (accepted: browser flow not automated, prod check covers); old filenames in ticket history files (history); `RETIRED_AUDIT_ACTIONS` trusted until (B) (B adds the live-body DB test); renames not replay-tested (6.1 owns the replay).

**Pass 1 — Part B** (blind-hunter, edge-case-hunter, verification-gap, intent-alignment; function bodies compared to live with a normalized diff — only the planned lines change): high 0, medium 3, low 14, false 0, maybe-false 1; rejected 7.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Duplicating a past session whose product later changed kind fails in `save_event_products` (blind) | medium | patch | `PRODUCT_IN_USE` guards future sessions only (matrix "past only → saved"); the duplicate copies only products matching the session kind, plus DB test. |
| 2 | Sessions list: missing capacity → 0 → "full"; page wiring untested (edge, blind, verification) | medium | patch | Throw like missing occupancy; row building moved to a tested helper. |
| 3 | README demo-data step 1 still runs `demo-clear.mjs --dev-test-data` (intent) | medium | patch | Fixes-log 8(ב): that route deletes real dev customers; step now points to `dev-clean-test-data.mjs`. |
| 4 | `CONCEPT_ARCHIVED` `exists … for share` locks no row (edge, blind) | low | patch | Lock the concept row first, then test `archived_at`. |
| 5 | Disallowed push rows skipped forever, job reads as sent (edge, blind, verification) | low | patch | Worker reports them as gone (deleted). |
| 6 | Server action pre-check still accepts any https host (intent) | low | patch | `lib/push/server.ts` uses `isAllowedPushEndpoint`. |
| 7 | anonymize.ts: throw after step 1 leaves no ActionResult; customer id logged as tokenId (edge, blind) | low | patch | try/catch + log; no misleading tokenId. |
| 8 | Whitespace-only marketing subject renders "" (edge) | low | patch | null when empty. |
| 9 | Exit cleanup can hang on locks; signal path untested (edge, verification) | low | patch | Timeout race; test invokes the SIGINT handler. |
| 10 | `credit_expiring_days` save allowlist / column read untested (verification) | low | patch | actions.test loops all editor columns. |
| 11 | Cleanup plan could delete a non-test customer's rows tied to a test_ event/product (edge) | low | patch | New protection check refuses. |
| 12 | Media-drafts script removes the file before the row (edge, blind) | low | patch | Row first, commit, then file. |
| 13 | events column grant: a future column becomes silently unreadable (blind) | low | patch | grants test compares granted columns with all columns minus `capacity_adults`. |
| 14 | Stale `EMAIL_TAKEN` comment says "logged" (blind) | low | patch | Comment fixed. |
| 15 | deferred-work says "נבדק" for DB tests not yet run (blind) | low | patch | "נכתבה בדיקה…; תורץ אחרי הרצת המיגרציה". |

**Full `test:db` after the migration (2026-10-22):** 1316 passed, 6 failed (5 files of 67) — all stale expectations, no code defect: 24 → 23 templates (broadcast removed, 2 tests); `moved_to_starts_at: null` in `admin_get_customer` (customers); the push seed's host moved to `fcm.googleapis.com` (push); the new birth-date test moved a date onto the allowed boundary (now: one day further out refused, the boundary itself accepted); and `content-publish` "home page with its hero section" lacked `promo_banner` — **failing since #114 (fixes 15, 17), not caused by (B)**. Fixed in the test files only; the 5 files plus `notifications.test.ts` re-ran: 6 files, 197 tests passed. Item 29 ("hold the approved seed", 23 templates) passed in the full run and the re-run.

Rejected: concurrent kind change vs `save_event_products` (rare race, needs locks in another function); failed orphan Auth deletion not retried (rare; before 5.20 orphans were never deleted; adds RPC state); held places behind her `claiming`/`pending` links (maybe-false: such links carry no profile before join; settle by finding a held booking whose token's `pending_user_id` has a profile); unborn baby shows no age (spec: acceptable); existing `audit_log` rows of retired actions kept (spec: stop writing only; viewer hides them); UI does not pre-empt `CONCEPT_ARCHIVED`/name the sessions for `PRODUCT_IN_USE` (server message is clear, adds UI); fix-8 test does not simulate a killed worker (SIGKILL cannot be caught; manual script covers).

## Design Notes

**Business name, what stays static (explain to the user plainly):** icons and favicon are image files (no name inside, a rebrand replaces them in code); the offline page and the push fallback title (`sw.js`, used only when a push has no title) keep `WORDMARK`; an app already installed on a phone keeps its old name — iPhone until it is removed and added again, Android when the browser refreshes the manifest on its own schedule.

**Live-site breakage between running (B) and merging** (prod uses the dev DB): hidden actions stop being written (never shown, no visible change); push registration from an unknown host fails (real browsers use the allowed hosts); the old settings code still lists "הודעה כללית" until merge but the row is gone, so it just disappears; the old anonymize screen shows a generic blocked message for a parked purchase; the old card still shows "בוטלה" for moved bookings. `capacity_adults` revoke: the edit page already reads it via RPC since (A); the admin sessions list errors until (B) is merged (its new read needs the migration's `capacity` field), so merge right after the run.

**Tiered short line:**
```ts
export function lineAlignClass(text: string) {
  const t = text.trim();
  if (t.includes("\n") || t.length > 60) return "text-start";
  return t.length <= 30 ? "text-center" : "text-start sm:text-center";
}
```

## Verification

**Commands:**
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` -- all pass, each part.
- `npm run test:db` (B, after planning-tab OK) -- all pass.
- `node scripts/dev-clean-test-data.mjs` (dry-run) -- lists only `test_` data; protected records absent.

**Manual checks:**
- (A) phone: text blocks on home/about at 360px; banner with a long word at 320px; notes board all archived; business name in title and top bar.
- (B) phone: credit-expiring field; birth date out of range rejected in join and profile; duplicate of archived-concept session blocked; moved booking on the customer card; audit shows no new hidden actions; anonymize blocked with an unsettled parked purchase.
