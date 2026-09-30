# Reconcile review: ARCHITECTURE-SPINE vs. source inputs

- Spine: `../ARCHITECTURE-SPINE.md` (draft, 2026-09-24)
- Checked against: `brunch_at_tal_charecter.md` (source of truth, §4 to §10 in particular), SPEC.md and companions (security-and-rpc-rules, data-model, notification-matrix, cancellation-rules, admin-configurable-parameters, site-map), EXPERIENCE.md (Information Architecture, State Patterns, Interaction Primitives, admin-on-phone), AGENTS.md.
- Out of scope by instruction: business rules the spine delegates to the SPEC (unless contradicted), and the intentional `profiles.id = auth.users.id` deviation from data-model.md.

## Verdict

**Mostly reconciled, with gaps to fix before build.** The core rules landed well: RPC-per-action, lock order, idempotency contract, the join state machine, time math in SQL, money as agorot, pg_cron plus a queued push worker, snapshots (`policy_snapshot`, `options_count`, `eligibility_snapshot`), no personal data in the SW cache, and the fixed 48h link lifetime. The gaps are quiet requirements that would be built in different ways by different sessions (Auth sign-up lockdown, waitlist cycle rules, the PII inventory for anonymization, where admin tasks come from, dedupe keys for non-event notifications). There is also one direct contradiction with the source: the separate admin login route.

## Findings

### High

**H1. Public Auth sign-up is not locked down. RPCs gate on `auth.uid()` alone.**
- Source §10: "יצירת חשבונות תתאפשר רק דרך תהליך ההצטרפות המאושר; הרשמה עצמית ציבורית ללא קישור תקף תהיה חסומה". SPEC Constraints: "אין הרשמה ציבורית".
- Spine: AD-10 only says "משתמשת Auth בלי פרופיל לא נכנסת ל-`/me`". That is a layout convenience (AD-2 itself says layouts are not authorization). The publishable key is public, so anyone can call `supabase.auth.signUp()`, get an `authenticated` JWT, and call every RPC granted to `authenticated`.
- Related: AD-10 creates users with `email_confirm: false`. If the project's "Confirm email" setting is on, password sign-in for these users fails ("Email not confirmed"). The spine also doesn't pin the "no auto logout" requirement (source §4) to Auth session settings (no time-box, no inactivity timeout).
- Fix: add a rule, for example under AD-3 or AD-4: (a) disable "Allow new users to sign up" in Supabase Auth, per project, and list it in the pre-launch checklist for the production project; (b) every `authenticated` RPC resolves the caller through `private.current_customer()`, which requires an existing, non-anonymized `profiles` row and raises `NOT_AUTHORIZED` otherwise; (c) record the Auth settings the flow depends on: confirm-email off, or create users with `email_confirm: true` while the UI never shows the email as verified; session time-box and inactivity timeout off.

**H2. Anonymization (CAP-30) has no PII inventory, and the Auth deletion step has no retry model.**
- Source §4 and CAP-30 success: "אחרי ההסרה לא נשאר מידע מזהה, וסיכומי התשלומים וההחזרים לא משתנים".
- Spine: AD-3 only removes the FK so the Auth user can be deleted. Nothing says which columns and tables are scrubbed. Several stores hold PII the spine itself creates: `audit_log.before/after` (phone and email changes, profile edits, names), `notifications.payload` (text rendered at enqueue per AD-12, which may include the name), `bookings.guest_details` (the companion's dietary data), `customer_notes`, `push_subscriptions`, `activation_tokens`, and import batch source rows or conflict reports. Deleting the Auth user is an HTTP call outside the transaction, the same class of problem as AD-10, but without intermediate states.
- Fix: add an AD (or extend AD-3) that (a) lists every PII-bearing column; (b) has `admin_anonymize_customer` null or redact them in one transaction, set `anonymized_at`, and keep `payments`, `refund_requests`, `bookings`, `entitlement_movements` and the `customer_id` link so totals don't change; (c) has `private.audit` store PII fields in a known shape, or have anonymization redact known PII keys inside `before/after`, recording this as a documented exception to "no silent deletion of history"; (d) runs Auth deletion after commit through `account-admin.ts`, with an "auth deletion pending" state and a retry path that shows up in "לטיפול".

**H3. Waitlist cycle rules are not specified. "Recheck at send time" is missing.**
- Source §5: notify all waiting customers with no priority; a pair needs 2 free seats; no duplicate notification for the same vacancy; a new cycle is allowed only after the event filled and freed again; "נבדקת הזמינות שוב גם בזמן שליחה וגם בזמן הרשמה"; no waitlist notifications after registration closes.
- Spine: AD-14 says only "`private.notify_waitlist(event_id)` ... עם מפתח סבב". AD-12's dedupe suffix includes `cycle`, but nothing defines what a cycle is, when it increments, or where it is stored. The push worker (AD-12) sends pre-rendered payloads and never rechecks availability. Nothing blocks notifications after `registration_closes_at`.
- Fix: define it in the spine: (a) cycle state lives on the event (for example `events.waitlist_cycle`, incremented inside the locking RPC when confirmed seats reach capacity) or through `waitlist_entries.last_notified_cycle`, and the rule picks one; (b) `notify_waitlist` runs only when `now() < registration_closes_at` and free seats >= the entry's `party_size`; (c) waitlist push jobs carry `event_id` and `party_size`, and `claim_push_jobs` or `finish_push_job` drops them (outcome `stale`) if the event is full for that party size or registration has closed; (d) `book_session` removes the customer's waitlist entry in the same transaction.

### Medium

**M1. The dedupe key composition collapses legitimate repeat notifications, and the revision bump rule is loose.**
- Source §8 / notification-matrix: the key is type + customer + event revision (or broadcast id).
- Spine AD-12: `<type>:<customer_id>:<entity_id>:<event_revision|broadcast_id|cycle>`. Non-event types have no suitable suffix. Two separate "הארכה או שינוי בזכות" corrections on the same entitlement produce the same key, so the second notification is silently dropped (`on conflict do nothing`). The same goes for a repeated purchase notification if `entity_id` is the customer.
- AD-13: "שינוי מועד מעלה את `events.revision`". If any session also bumps revision on a menu, concept or capacity edit, customers get a second reminder and a spurious "שינוי מהותי".
- Fix: define the suffix per type in one table in the spine. Use the originating action's id (the correction row, `payment_id`, `booking_id` or the audit row id) for non-event types. State that `revision` increments only when `starts_at`/`ends_at` change or the event is cancelled, inside `admin_update_event` / `admin_cancel_event`.

**M2. The admin "לטיפול" list has no defined source, and a join conflict has nowhere to be stored.**
- EXPERIENCE (admin home) and site-map list the sources: account conflicts, refund requests awaiting approval, expired links, customers who have not chosen refund or credit after a business cancellation (`choice_pending`, no deadline, source §6 / CAP-17), and an unpublished accessibility statement. The spine adds tokens stuck in `claiming`. The cancellation rules add manual handling for cancelling a pair booking that was funded by offsetting a punch card, and CAP-10 adds a changed intro eligibility that is referred to Tal.
- Spine: AD-10 says "`conflict`: עצירה ומשימת 'לטיפול'", but `activation_tokens` has no conflict state and nothing stores the entered email and phone, so Tal cannot act on it. `choice_pending` and the customer's choice RPC (for example `choose_cancellation_outcome`) are not mentioned anywhere in the spine.
- Fix: add an AD saying admin tasks are **derived**, consistent with AD-14: one view or RPC `admin_task_list` that unions the named sources. Persist the only non-derivable one, join conflicts, in a small `private` table (token id, entered phone/email, matched profile ids, `resolved_at`). Name the choice RPC and `cancellation_credits.choice_pending` in the capability map (CAP-17).

**M3. The admin login route contradicts the source.**
- Source §3: "נתיב כניסת אדמין נפרד באותו אתר, בקישור קטן בפוטר". site-map and EXPERIENCE: "כניסת מנהלת — נתיב נפרד".
- Spine AD-2: "`/login` משותף ללקוחה ולאדמין". No memlog decision is cited.
- Fix: either add `app/(auth)/admin/login` (or `/admin/login` outside the `admin` layout guard), reusing the same form component and posting to the same action, or have the footer link point to `/admin` (which redirects to `/login?next=/admin`) and record that interpretation with the user in a memlog. Until one of these is done, the source wins.

**M4. Export protections are not in the spine.**
- Source §7 and SPEC CAP-25: admin only, protection against formula injection in cells, no secrets, push identifiers or tokens, and a partial export limited to exactly the selected rows and columns.
- Spine: only "`app/api/admin/export/route.ts` # ייצוא CSV. אדמין בלבד".
- Fix: one serializer (`lib/admin/csv.ts`) that neutralizes cells starting with `= + - @`, tab or CR (prefix `'`), and writes a UTF-8 BOM for Hebrew in Excel. Columns come from an allowlist view (`admin_customer_export`) that cannot expose `push_subscriptions`, `activation_tokens` or `notes`. Route response headers: `Cache-Control: no-store` and `Content-Disposition: attachment`. The admin check runs in the route as well as through RLS.

**M5. Media publishing is described as atomic but crosses Storage. Upload validation and XSS rules are missing.**
- Spine AD-16: publishing "מעתיק אותה ל-`media-public` בתוך פעולת הפרסום". Copying a Storage object is a Storage API call, not SQL, so it cannot run inside the AD-1 RPC transaction. This contradicts AD-1 unless an order and a failure mode are defined.
- Source §10 / security rules: "בדיקת סוג וגודל קובץ וסינון תוכן עשיר למניעת XSS". This is absent from the spine.
- Fix: define the order. Publish = copy to `media-public` first, then the RPC flips `publication_status`; a later reconcile removes public objects with no published row. Hide = the RPC first, then delete the object. Bucket-level `allowed_mime_types` and `file_size_limit`. Content is stored as structured JSON and rendered as React text, with no `dangerouslySetInnerHTML`; any rich text is sanitized server-side on save.

**M6. The token `expired` state: stored or derived?**
- The spine's state diagram has `pending --> expired: 48 שעות`, but no job performs that transition. AD-14 says derived state is not stored. The admin link list ("פג תוקף") and "לטיפול" (expired links) depend on this.
- Fix: say that `expired` is derived (`state = 'pending' and expires_at <= now()`) in a view or helper that every reader and `join_begin`/`claim_join`/reset use, or add the transition to a job. Pick one.

**M7. Where the email lives (imports, uniqueness) is undefined.**
- The data model says the email lives in Auth only. Imported customers (CAP-31) have a profile but no Auth user until they claim, so their email must be stored somewhere, and `join_begin`'s duplicate check (source §4: phone **and** email) must see both Auth users and imported profiles that haven't claimed yet.
- Fix: in AD-3, name the canonical email store (for example `profiles.email`, a lowercase unique mirror kept in sync by `account-admin.ts` and `join_complete`) and the exact duplicate-check query `join_begin` uses.

**M8. Non-disclosure and rate limiting have no binding point.**
- Source §10: authentication and activation operations are rate limited "ומחזירות שגיאות שאינן חושפות אם טלפון קיים".
- The spine defers the mechanism to E2 (acceptable). But it doesn't say where the check sits (inside `join_begin`, `get_join_token_view`, reset, and the login Server Action), and it doesn't reconcile `existing_account` / `conflict` responses with non-disclosure. Those responses should reach only a holder of a valid pending token, with a per-token attempt limit. The access level of `get_join_token_view` (anon, or the service client) is also unstated.
- Fix: keep the deferral, but add one rule: every token-taking RPC calls `private.rate_limit(bucket, key)` first; `existing_account`/`conflict` come back only for a valid, unexpired token; login errors stay generic (this matches EXPERIENCE).

**M9. `enqueue_notification` cannot carry free text.**
- CAP-12 / notification-matrix: for a business cancellation or change, Tal edits the template-filled text before sending. CAP-32: a broadcast is Tal's free text.
- Spine AD-12: the only entry point renders from `notification_templates`.
- Fix: add an optional `p_body_override` (stored as-is in `payload`) and state that `admin_cancel_event`, `admin_update_event` and `admin_send_broadcast` are the only callers allowed to pass it.

### Low

- **L1. Morning-of-session view online only, and no personal data in any cache.** AD-16 covers the SW. Also require `Cache-Control: private, no-store` on `/me`, `/admin` and `/api` responses, so bfcache and the HTTP cache stay clean. The `/admin/sessions/[id]/day` view should hide the list and show "צריך חיבור..." when `navigator.onLine` is false, instead of showing stale router-cache data (EXPERIENCE › admin on phone).
- **L2. Consent version.** AD-10 step 3 records "הסכמה עם גרסת המדיניות". State that `join_complete`/claim read the current published privacy-policy version server-side (not from the client), where versions are stored (a publish creates a version, CAP-29), and that the claim flow (imports) records consent too.
- **L3. Filtering the audit log by session.** CAP-26 requires filtering by session and date. `private.audit(action, entity_type, entity_id, …)` has no `event_id`/`customer_id`, so actions on bookings or credits cannot be filtered by session. Add optional `event_id` and `customer_id` columns.
- **L4. Customer-inaccessible tables.** The source and the security rules say tokens, send queues, the audit log, internal notes and imports are never readable by a customer. The spine's RLS convention covers only write policies on money tables. State that these tables live in `private`, or in `public` with RLS and no customer policy.
- **L5. `activity_status` is stored, against AD-14.** A daily job alone leaves a re-purchasing customer "inactive" for up to 24 hours (source §7: a purchase or booking reactivates). Either derive the status in a view, or have `admin_approve_payment`/`book_session`/`admin_book_customer` set it back to active.
- **L6. Move and the policy snapshot.** Say whether `move_booking` copies the source booking's `policy_snapshot` or takes the current settings.
- **L7. `claim_join` after login.** It attaches the purchase to whoever logged in, not necessarily the account matched by `join_begin`. The source allows it (whoever holds the token can use it), but say this explicitly so sessions don't diverge.
- **L8. Housekeeping.** Add `idempotency_results` retention to `job_cleanup`. Define the order for changing email or phone (Auth update and profile/audit RPC are not atomic), for example the RPC first with a pending marker, then Auth, then finish.

## Confirmed as landed (no action)

- The link preview does not consume the token (`get_join_token_view` is read only; the token is consumed only in `join_complete`/`claim_join`).
- The 48h link lifetime is a SQL constant, not a setting (AD-10, AD-15).
- The token is stored only as a hash. The audit log never holds tokens or passwords.
- Auth ⇄ DB: intermediate states, idempotent `join_complete`, `claiming` resume, recovery of stuck tokens (AD-10). A replacement link revokes the previous one.
- `policy_snapshot` (cancel window, reminder lead), the `options_count` snapshot, and snapshot-over-current-setting (AD-15, AD-13).
- Reminder dedupe with `event_revision`. Cancellations drop out because reminders are derived from state (AD-13).
- Lock order, including a move locking both events by id; seats derived from confirmed `party_size` (AD-6, AD-14).
- Push via a queue, sent outside the transaction; a push failure never changes a booking; invalid subscriptions deleted; limited retries (AD-11, AD-12).
- The scheduler runs server-side with no browser (pg_cron). Cleanup: 90 days for read notifications, 30 days for finished jobs.
- Sensitive-action preview and server re-check; the value-change row versus the checkbox dialog split (AD-7).
- Time math in `Asia/Jerusalem` in SQL, including the exact-48h boundary via `private.cancel_deadline` (AD-8).
- The SW never caches personal data or `/me`/`/admin`; offline shows an explanation only (AD-16).
- Service-role boundary and `server-only` (AD-4). Dev and prod separation, and the upgrade before real data (Structural Seed).
