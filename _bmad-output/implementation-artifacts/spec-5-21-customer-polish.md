---
title: 'Story 5.21: Customer polish (offline buttons, push offer, "booked" on /sessions, fix 7)'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '9cbdb08d4fd5899d4075eadfc5d9d1cba49951ed'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['edge-case-hunter', 'blind-hunter']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four leftovers from 5.7, 5.8 and 5.9 (user decision 2026-10-10) plus fix 7: a write tapped offline just fails; the push offer after the first booking and the profile's notifications row were never built; a signed-in customer sees no "booked" mark on public `/sessions`; the companion's dietary note sits under the card in `/me/bookings`, where it is missed, and `booking_confirmed_couple` sends her there.

**Approach:** One shared offline mechanism (a hook, a shell banner, a button wrapper) wired into every data-changing button, customer and admin; a once-per-device push offer at the booking climax and a "התראות" row in the profile; a per-row dynamic chip in its own `Suspense` on `/sessions`; the companion note moves to `/me/sessions/[id]`, and one small migration points the couple notification there.

## Boundaries & Constraints

**Always:**
- Source §8 (line 302): offline may show an explanation, never confirm a booking or cancel. No optimistic result, no queue.
- Offline mechanism (outside `components/ui/`):
  - `useOnline()`: `useSyncExternalStore` on `navigator.onLine` + `online`/`offline` events; server snapshot `true` (no flash of disabled buttons on load).
  - `OfflineBanner`: `role="status"`, `id="offline-hint"`, rendered only while offline, mounted once in each shell that has writes: `app/me/layout.tsx`, `app/admin/(shell)/layout.tsx`, `app/(auth)/layout.tsx` (not public, not `/offline`). Text `pwaCopy.offlineHint`: "אין חיבור כרגע. אפשר לצפות בעמוד, אבל לא לשמור, להירשם או לבטל עד שהחיבור יחזור".
  - `OnlineButton`: same props as `Button`; offline it sets `aria-disabled="true"`, `aria-describedby="offline-hint"` (merged with the caller's), and `preventDefault`s the click (blocks implicit form submit too). Online it adds nothing. A caller's own `aria-disabled` (busy) still applies.
  - `useOnlineGuard()` returns the same props for a native `<button>` / `buttonClass` element.
  - Shared admin pieces guard too: `useWorkAction().run` and `saveWithKey` return without calling when `!navigator.onLine`.
  - In scope: every button whose tap asks the server to change something (Server Action write, `/api` POST, push subscribe/unsubscribe, mark read, sign out, image upload). Out: opening/closing sheets, search, preview, export, navigation links.
  - When the network returns, the banner goes and buttons are live again without a reload.
- Push offer (source §8 line 286, EXPERIENCE "המקום שלך שמור"):
  - Shown under the climax of `BookingPanel` (`done`) and of the multi-date `Results` when every date was saved.
  - Only when the device state is `ask` (`pushStateOf`) and this device was never offered. Decision: "already offered" is per device, localStorage `push-offered` = `"1"`, written when the offer is shown (the push permission is per device too). `push-choice = "off"` ("לא עכשיו", or a denial) already keeps it from coming back.
  - It reuses `PushCard`'s ask view and copy (`shellCopy.notifications.push`), `surface="customer"`, `registerPush`/`unregisterPush` from `app/me/notifications/actions.ts`. Every storage read/write in try/catch; storage that throws = do not show.
  - Profile (`app/me/profile/page.tsx`): first row of the "עוד באזור האישי" list, "התראות" (`customerCopy.profile.notificationsRow`), link to `/me/notifications` (the card sits at the top there).
- `/sessions` chip:
  - The list itself is unchanged: `listUpcomingPublicSessions()` stays on `createPublicClient` (no cookies).
  - Each row gets `<Suspense fallback={null}><BookedChip eventId/></Suspense>` in `SessionRow`'s `status` slot. `BookedChip` (server) reads a React-`cache`d `myBookedEventIds()`: `getViewerRole()` is `customer`, else an empty set; then the server client's confirmed bookings (as `bookedEventIds()` in `app/me/sessions/load-sessions.ts`, reused). Read failure = no chip.
  - The chip is the one in `/me/sessions`: `<StatusChip tone="booked">{customerCopy.booked}</StatusChip>` ("נרשמת"). Guests and admins see nothing.
- Fix 7:
  - `CompanionNote` moves (component + test) to `app/me/sessions/[id]/companion-note.tsx`, same rules and copy: editable until registration closes, then read-only with "צרי קשר". Anchor id stays `booking-<id>`. `setGuestDetailsAction` stays in `app/me/bookings/actions.ts`.
  - Session page: when `preview.kind === "booked"`, `session.kind === "couple"` and `bookingId` is set, it calls `get_my_bookings` and renders the note from that row (`isCoupleBooking`, `guestDetails`, `guestDetailsEditable`) under `BookingPanel`. Decision: no `preview_book_session` change (5.6 builds on the 3.5 version, untouched here).
  - `/me/bookings` no longer renders the note; `needsContact` drops its couple condition.
  - Migration: `private.notify_booking_confirmed` re-based on the live `pg_get_functiondef` (matches `20261013161248_couple_and_intro.sql`); only the couple target changes to `'/me/sessions/' || event_id || '#booking-' || booking_id`. Template: `update ... set body = '{date} · {time} · בראנץ׳ {concept}. אפשר להוסיף בעמוד המפגש הגבלות תזונה או אלרגיות של המלווה' where type = 'booking_confirmed_couple' and body = <the 3.5 default>`. Additive, no `drop`, no new grant.
- AGENTS.md › "מוסכמות": a line that every new data-changing button uses `OnlineButton` / `useOnlineGuard` (offline mechanism, 5.21).
- Screens start with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md. No "טל" in customer copy.

**Never:**
- Touch `set_booking_guest_details`, `preview_book_session`, booking / cancel / funding / credit functions, or entitlement tables (3.14, 3.16).
- Offline queue, read-only mode, Hebrew error page, gallery without photos, push offer for Tal, offer on the join token route, availability chips on `/sessions`.
- `'use cache'` or cookies in the list read; a chip that waits on auth before the list renders.
- Rewrite notifications already sent with the old target.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offline | Airplane mode on `/me/sessions/[id]`, admin session page | Banner; write buttons `aria-disabled` + described by it; tap does nothing | No request sent |
| Back online | `online` event | Banner gone, buttons live | None |
| Busy and online | Saving | Busy `aria-disabled` as today | None |
| First booking, push `ask` | No `push-offered` | Offer under the climax; `push-offered` written | Storage throws: no offer |
| Second booking | `push-offered` set | No offer | None |
| Declined | `push-choice = off`, or permission denied / unsupported / iOS not installed / `on` | No offer | None |
| Customer on `/sessions` | Booked on session A | "נרשמת" on A only | Read fails: no chip |
| Guest / admin on `/sessions` | No session / admin role | No chip; list from the public client | None |
| Couple booked, before close | Session page | Note, "עריכה"/"הוספה" | `REGISTRATION_CLOSED`: read-only |
| Couple booked, after close | Session page | Read-only + "צרי קשר" | None |
| Regular booking | Session page | No note, no `get_my_bookings` call | None |
| Couple notification | Any booking path | `target_path` `/me/sessions/<event>#booking-<id>`; default template body says "בעמוד המפגש" | Edited template: body unchanged |

</frozen-after-approval>

## Code Map

- `lib/copy/pwa.ts` -- add `offlineHint`. Pattern for the hook: `components/shared/push-card.tsx` / `lib/push/client.ts` (`useSyncExternalStore`, `pushStateOf`, `readChoice`/`writeChoice`, `CHOICE_KEY`, `PUSH_CHANGE_EVENT`).
- New: `lib/use-online.ts`, `components/shared/offline-banner.tsx`, `components/shared/online-button.tsx` (`OnlineButton`, `useOnlineGuard`), `components/shared/push-offer.tsx`.
- Shared admin: `components/admin/sensitive-confirm-dialog.tsx` (confirm button; ~13 users), `use-work-action.ts`, `edit-kit.tsx`, `value-change-row.tsx` (`saveWithKey`), `image-upload-field.tsx`.
- Wiring (inventory, ~57 files): auth `join/[token]/join-form.tsx`, `claim-join.tsx`, `login/login-form.tsx`, `reset/[token]/reset-form.tsx`; `components/shared/sign-out-button.tsx` (server form: give it a small client submit button), `push-card.tsx`, `notification-list.tsx`, `notification-item.tsx`; `/me`: `bookings/{cancel-booking,move-booking,pending-choice}.tsx`, `profile/{babies-section,details-section,photo-consent-form}.tsx`, `sessions/select/session-selector.tsx`, `sessions/[id]/booking-panel.tsx`; admin: every file under `app/admin/(shell)` that calls a write (attention, audit-list, concepts, content, customers incl. `account-section`, `customer-notes`, `correction-row`, links, notes, payments, products, sessions incl. book/cancel/move/edit/reschedule/delete/work, settings, templates). Not: `customer-live-search`, `customer-search`, `audit-filters`, `export-sheet`.
- `app/(public)/sessions/page.tsx`, `components/public/public-sessions.tsx`, `components/shared/session-row.tsx` (`status` slot) -- chip; `lib/auth/viewer-role.ts` (`getViewerRole`), `app/me/sessions/load-sessions.ts` (`bookedEventIds`), `components/shared/status-chip.tsx`.
- `app/me/sessions/[id]/page.tsx`, `booking-panel.tsx` (`done` branch ~77-93), `select/session-selector.tsx` (`Results`), `app/me/bookings/{bookings-list,cancel-result,companion-note}.tsx`, `app/me/profile/page.tsx`, `lib/copy/customer.ts` (`profile`, `companion`).
- `supabase/migrations/<new>_couple_note_on_session.sql`; tests `supabase/tests/couple-and-intro.test.ts` (targets/body, 4 cases), `notifications.test.ts:179` (default body).

## Tasks & Acceptance

**Execution:**
- [x] `lib/use-online.ts`, `components/shared/{offline-banner,online-button}.tsx`, `lib/copy/pwa.ts` -- the mechanism (`frontend-design`: banner within DESIGN.md tokens) + unit tests with `renderToStaticMarkup` and a pure helper for the props merge.
- [x] Shells + every file in the Code Map wiring list -- swap to `OnlineButton`/`useOnlineGuard`; guard `useWorkAction`, `saveWithKey`.
- [x] `components/shared/push-offer.tsx`, `booking-panel.tsx`, `session-selector.tsx` -- offer (`frontend-design`) + pure `shouldOffer(state, storage)` test.
- [x] `app/me/profile/page.tsx`, `lib/copy/customer.ts` -- "התראות" row.
- [x] `components/public/public-sessions.tsx` + `BookedChip` -- chip; test: list read uses only `createPublicClient`, guest renders no chip.
- [x] Session main: `git mv` companion-note(.test).tsx to `app/me/sessions/[id]/`; then page + bookings-list + `needsContact` and their tests.
- [x] `npx supabase migration new couple_note_on_session` -- SQL above; session main: user runs it in SQL Editor, record in `schema_migrations`, `get_advisors`, `database.types.ts`, update db tests; `test:db` (couple-and-intro, notifications, settings-and-templates, grants) only after asking the user; `npm run demo:seed`.
- [ ] `AGENTS.md`, `fixes-log.md` row 7 "מצב", `deferred-work.md` (3 items closed), `tickets.toml` done -- docs.

**Acceptance Criteria:**
- Given any `/me`, `/admin` or auth screen offline, when she taps a write button, then no request leaves and the banner explains why; given the network returns, then the button works without reload.
- Given `npm run lint`, `typecheck`, `npm test`, `npm run build`, then all pass.

## Implementation Notes

- Extra `OnlineNativeButton` (native button in a server form: top-bar sign-out). `[data-offline]` dims the button in `globals.css` (aria-disabled alone shows nothing).
- `content-editor`'s preview is guarded (it saves the draft first); `InlineConfirm` got `writes`, so only the discard confirm is guarded.
- `SessionRow`: the status span is read by screen readers when no `statusText` is given; `empty:hidden` for guests.
- The note's heading is h2 on the session page (heading order). `needsContact(credits)`.
- Migration applied by the user in the SQL Editor (2026-10-20), recorded in `schema_migrations`; advisor clean (approved WARNs only); `database.types.ts` unchanged (no signature change). `test:db`: couple-and-intro passes; 5 count/list assertions fail only on 3.14/3.16 rows already in the shared dev DB (re-run after merging main). `demo:seed` skipped (user's decision: `.demo-data.local.json` missing, demo data already present).
- Phone check fix (user, 2026-10-20, fixes-log row 10): closed note wording "ההרשמה נסגרה וההכנות בעיצומן, לכן לא ניתן לעדכן כעת הגבלות תזונה. אם יש עדכון חשוב," + the "צרי קשר" link. Push offer checked on localhost (push needs a secure context; the LAN http address shows "unsupported").
- Main session added `lib/use-online.test.ts` (events both ways) and a `saveWithKey` offline test.

## Review Triage Log

Pass 1 (quick, pinned by the user: edge-case-hunter on the screens, blind-hunter on the DB part; both given `review-accepted.md`). Verdicts: medium 2, low 2, false 1, reject 11.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Note "done" checkbox (`note-item.tsx`) not wired | medium | patch | Only `useWorkAction`'s guard stops it; no aria-disabled/dim/description. Spread `useOnlineGuard()`. |
| 2 | Banner hidden under an open Sheet / AlertDialog | medium | patch | Booking, cancel, move, note and sensitive confirms are modal; the dimmed button had no visible reason. Banner becomes a fixed overlay above the modal layer. |
| 3 | Hash target `#booking-<id>` streams inside `Suspense` | low | patch | Native scroll can miss it; the note is below the fold. The note scrolls itself into view on mount when the hash matches. |
| 4 | `get_my_bookings` waits for the preview | low | patch | Started in the first `Promise.all` for a couple session; filtered after. |

Rejected: missing files in the DB diff (false: staging pathspec); `get_my_bookings` cost (spec decision); old notifications / edited template keep old text or target, no pointer on `/me/bookings` (spec Never + fix 7 decision); no test of the guarded template update (one-time migration; the old literal was checked live before writing, body checked after apply); no page-level render test (helper tested); spec-3-5 still names the old target (historical spec); picker opened online then offline (rare, extra guard); empty span gap while streaming (transient).

## Design Notes

`OnlineButton` composes, it does not fork `Button`: `<Button {...props} {...offlineProps(online, props)} />`, where `offlineProps` merges `aria-describedby` and wraps `onClick` (`if (!online) { e.preventDefault(); return }`). The per-row chip `Suspense` lets the list stream immediately; `myBookedEventIds` is `cache`d so all rows share one auth + one read.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: pass.
- `npm run test:db` (after the user's OK) -- expected: pass.

**Manual checks:** phone, airplane mode (customer + admin); offer once, not after "לא עכשיו"; profile row reaches the card; `/sessions` chip as customer, none as guest; couple note on the session page and the notification opens it.
