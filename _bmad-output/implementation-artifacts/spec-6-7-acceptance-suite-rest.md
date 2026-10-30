---
title: '6.7 Acceptance suite: cancellation, notifications, content, screens, accessibility'
type: 'chore'
created: '2026-10-30'
status: 'done'
baseline_commit: '3cf485de848f22166878683960a4bb5f68b86b76'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment', 'mutation']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/acceptance-criteria.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-6-acceptance-suite-core.md'
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
  - '{project-root}/supabase/tests/support/db.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 47 clauses of "ביטול, זיכוי והחזר" (CN1–CN6), "התראות ומשימות" (NT1–NT5), "פרופיל, פעילות ותוכן" (PC1–PC8), "ערכים ותוכן שנערכים באדמין" (AV1–AV11), "מסכים חדשים ותצוגה" (SC1–SC10) and "השלמות › התראות, PWA ואדמין" (SN1–SN7) were tested story by story; nobody has shown that every claim is proven. Today 24 clauses are fully proven (5 of them with a pending browser part), 19 have a missing or weak claim, 4 are superseded.

**Approach:** As in 6.6: map every claim to the it() that proves it (verified by reading its assertions), add DB/unit tests for every missing or weak claim (T1–T23 without T11, T18; see spec-gate decisions), list the browser-only claims in two manual lists (M-auto for the planning session, M-user for the user's phone), and publish `acceptance-report-6-7.md` from a full run. No product code change unless a test exposes a bug and the planning session approves the fix.

## Boundaries & Constraints

**Always:** same rules as 6.6: `inRollback`, `asAuthenticated`, `testName`, `onCleanup`; time claims on fixed 2099 dates or pure `private` helpers, never a `now()`-dependent branch (now()+interval inside one transaction is deterministic and allowed); every assertion checks an outcome (identity, error code, state); "once" proven by running the job twice; `job_*` and push-queue calls inside `inRollback`, then assert nothing of theirs is left in `notification_jobs` and `net.http_request_queue`. New DB tests in new `acceptance-*.test.ts` files by topic; new unit its next to their module or in `test/`. A test that counts a whole table is sensitive to another tab writing at the same time — none planned; if added, say so in the report.

**Never:** change, weaken or delete an existing test (adding an it to an existing file is allowed); fix code before reporting a failing test (clause, actual, source doc, recommendation); add Playwright or any dependency; build a feature, screen or copy change; write a migration without approval (`drop` never); cover 6.6 chapters; touch `.env*`, `demo:*`, `video:*`, `*@video.example.com`, dev-customer, dev-admin or the "בדיקה 6.6" customers; run `test:db` without the planning session's go; create dev data outside tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New test passes | claim enforced | report: עובר | — |
| New test fails | code breaks the claim | stop, report to the planning session | no fix, no test change before approval |
| Known leak (PC8 hidden item, SC5 archived concept via API) | decided at the spec gate | report: "לא עובר: תיקון מתוזמן" + deferred-work item | T11, T18 not written here; they ship with the fix PR |
| Claim superseded | later decision (memlog, completion-plan, fixes-log) | report: "הוחלף בהחלטה" + source + date | no code change |
| Browser-only claim | logic only in the screen | M-auto (planning session) or M-user (her phone) row, "ממתין" until done | — |

## Spec-gate decisions (planning session 4, 2026-10-30, under the authority the user delegated)

1. **PC8 hidden item readable through the API, and SC5 archived concept readable (the API part):** fixed, but not in this story: one short PR after 6.7, before 6.1 (`fix-public-read-leaks`), which also writes T11 and T18. Here: no T11/T18; one deferred-work item (done at the gate); the report marks PC8 and SC5 (API part) "לא עובר: תיקון מתוזמן" with a pointer to it. Evidence: `content_sections_public_select` filters only the section-level `hidden`; dev `home` banner `{"text": "בקרוב! בראנץ' 60+", "hidden": true}` readable by anon; `concepts_public_select using (true)` (20261004145805_concepts_and_events.sql:163).
2. **AV8 post-join message and button:** S (UX memlog:143, USER 2026-10-06). The two still-editable fields go to deferred-work, target "לפני 6.4" (done at the gate), not fixes-log.

</frozen-after-approval>

## Code Map

- `supabase/tests/support/db.ts`, `support/money.ts` (`seedMoney`, `approve`, `approveParams`:115,134, `insertProduct`) -- reuse.
- Patterns to copy (not exported): `cancellation-credits.test.ts` (`insertEvent`:99, `grant`:146, `pinned`:174, `options`:266, `creditFor`:700); `credit-adjustments.test.ts:732` (`admin_refund_credit` call); `session-reminders.test.ts` (`moveStart`:133, `dueBooking`~158, `runJob`, `reminders`); `push.test.ts` (`addSub`:84, `isolate`:126, `claim`:141, `finish`:148); `scheduled-jobs.test.ts` (`card`~146, `setDaysLeft`, `ALERTS`, `alerts`, `job_auto_extend`:667); `session-completion.test.ts:258` (`moveEnd` + job); `marketing-reminders.test.ts` (`runAt`, `SUNDAY`/`MONDAY`, :283 DST); `business-settings.test.ts:40` (`pg_attrdef` read); `entitlement-corrections.test.ts` (`grantCard`:69, `correct`:103, :518, :618); `events-admin.test.ts` (`UPDATE`:22, `create`/`one`:120-130); `pinned-approval.test.ts:45` (`insertPinned`); `content.test.ts:92`, `content-publish.test.ts:148` (`inCleanHome`); `concepts-admin.test.ts:380-410` (archive flow).
- Signatures (latest migration): `cancel_booking(uuid,uuid,text)`, `book_session(uuid,uuid)` 20261010141240_cancellation_credits.sql; `admin_refund_credit(uuid,text,boolean,uuid)` 20261019204039_credit_adjustments.sql; `private.plan_funding` 20261020200233_eligible_products.sql; `admin_reschedule_event(uuid,timestamptz,timestamptz,boolean,text,uuid)` 20261029204903_reschedule_skip_revoked_pinned.sql; `private.job_reminders()`, `private.job_expiry_alerts()` 20261020200750_remove_personal_details.sql; `claim_push_jobs(integer)` 20261019233604_waitlist.sql, `finish_push_job(uuid,uuid[],uuid[],text)` 20261006184326_push_pipeline.sql (service_role only); `admin_approve_payment`, `admin_update_event(uuid,jsonb,uuid)` 20261022154256_refactor_sweep_db.sql; `admin_correct_entitlement(uuid,text,jsonb,uuid,text,boolean,uuid)` 20261018084612_entitlement_corrections.sql.
- Unit targets: `components/public/page-views.test.tsx` (`renderToStaticMarkup` pattern), `app/me/sessions/[id]/page.test.tsx:56-90` (setup), `app/globals.test.ts:14-24` (`block`/`value`), `components/shared/push-card.tsx` (`enable()`), `test/invisible-chars.test.ts` (source-scan pattern), `lib/content/whatsapp.ts` (the one allowed number source).
- Do not change: any existing test body, product code.

## Coverage map

C = covered (file:line, it). N = new test (T#). MA/MU = manual (M-auto / M-user). S = superseded. Short names (all `supabase/tests/` unless a path is given): CB cancel-booking, CC cancellation-credits, BUS business-cancel, RC refund-completion, MV move-booking, CA credit-adjustments, MBF manual-booking-funding, EP eligible-products, TP time-and-phone-helpers, BS business-settings, ST settings-and-templates, SR session-reminders, SJ scheduled-jobs, PU push, MK marketing-reminders, NC notification-centers, NO notifications, IC inactive-customers, RPD remove-personal-details, PR profile, PCAT product-catalog, RP repeat-purchase, CE customers-export, CP content-publish, CT content, MD media, EC entitlement-corrections, EVA events-admin, PS public-sessions, SB self-booking, CI couple-and-intro, G grants, WS work-sheet, SH shopping-items, NOTE notes, CON concepts-admin, J join, OC open-cards, CU customers, AUD audit-viewer, LL link-lifecycle, RS reset. Unit: TM lib/time, MO lib/money, BA components/admin/baby-age, PSEC app/me/profile/profile-sections, SCD components/admin/sensitive-confirm-dialog, CX lib/admin/customer-export, RT app/api/admin/export/route, PV components/public/page-views, OF components/public/optional-fields, HH components/public/home-hero, LP lib/content/pages, CACT app/admin/(shell)/content/actions, BD lib/content/business-details, PSH components/public/public-shell, VCR components/admin/value-change-row, SD sessions/session-draft, SET settings/settings-draft, PUBS components/public/public-sessions, SF content/section-fields, CS content/content-screens, SST app/me/sessions/session-status, WSX sessions/[id]/work/work-screens, SM work/shopping-message, NS notes/notes-screens, PC components/shared/push-card, PCL lib/push/client, OB components/shared/online-button, SW test/sw, HI app/admin/(shell)/home-items, RSU lib/server/privileged/reset, LV components/public/legal-views, ESL test/eslint-rules, SL lib/site-lock.

| Cl | Claim | St | Proof |
|---|---|---|---|
| CN1 | self-cancel exactly at 48h allowed; refused one second after | C | CB:286 "exactly at the deadline: cancelled"; CB:315 SELF_CANCEL_CLOSED; TP:28 (fixed date, +1µs refused) |
| CN1 | admin cancel still possible inside the window | C | CB:475; CC:556 |
| CN2 | Sunday cancel of Thursday: Monday not offered; options = next N after it | C | CC:317 `not.toContain(before.id)`; CC:707 |
| CN2 | self-cancel ≥48h of pinned may choose refund | C | CC:388 |
| CN3 | only matching sessions | C | CC:528; EP:425, EP:971 |
| CN3 | a session full at credit creation not counted | N | T1 |
| CN3 | no future sessions → waits; second cancel no new options | C | CC:745; CC:826, CC:1252 |
| CN3 | N from settings at creation, default 2, settings change keeps existing | C / N | MBF:259; CC:900; default: T9 (BS:9 reads the live row) |
| CN4 | she fills the last place → no extension; business cancel replaces an option | C | CC:776; BUS:624, CC:880 |
| CN5 | refund request voids the use of the right | N | T2 (CC:388 checks status only; CA:732 leaves options active) |
| CN5 | not paid before Tal's approval; never above the original | C | CC:388, RC:580; RC:344, RC:358, RC:934 |
| CN6 | failed move on capacity keeps the original | C | MV:479 (whole-state snapshot equal) |
| CN6 | cancel restores the exact source, no extra entry | C | CB:352, CC:489, CC:826, CC:1167, MV:652; CB:373, CB:389, CC:337 |
| NT1 | 24h default | N | T9 |
| NT1 | once (double run); late booking, cancel, session cancel → none; time change follows; setting change keeps snapshot | C | SR:241; SR:269, SR:445; SR:252, SR:385, SR:456, BUS:763; SR:334, SR:358; SR:304, ST:313 |
| NT1 | time change out of the window → no reminder now, new one later | N | T3 |
| NT2 | push failure leaves the booking intact | N | T4 (PU:351 checks the job row only) |
| NT3 | broadcast once per recipient | S | SPEC memlog:310 (USER 2026-10-20, 5.12 cancelled); NO:352 |
| NT4 | Tal at 21 days once; customer at 10 (not 11) | C | SJ:235 (rerun 0); SJ:262 |
| NT4 | customer once (rerun) | N | T5 |
| NT4 | all reserved → none | C | SJ:329 |
| NT4 | all used / used+reserved → none | N | T6 |
| NT4 | after a real extension it fires again | N | T7 (SJ:299 sets the date by hand) |
| NT5 | default slots; DST at 09:00; once per slot; text rotates; customer cannot see, even by API | C | BS:40; MK:283; MK:166; MK:194; MK:466, NC:137 |
| NT5 | a 20:00 slot across DST | N | T8 |
| PC1 | several babies, age 0, month end, no daily write | C | PSEC:28, PR:305; TM:29 (fixed dates, 31.01→28.02, 29.02); age is pure `babyAge`, `babies` stores only `birth_date` |
| PC2 | not inactive with booking, entitlement, credit or refund; never participated → from creation; mark deletes no one | C | IC:325, IC:335, IC:396; IC:282; IC:445 |
| PC3 | nothing identifying left; money totals unchanged | C | RPD:221; lib/server/privileged/anonymize.test.ts:99 |
| PC4 | import | S | completion-plan:44 (USER 2026-10-22, 6.2 cancelled) |
| PC5 | no checkbox → nothing; empty reason does not block | C | SCD:24, PCAT:180, EC:325, RPD:758; PCAT:180, RP:302, SCD:38 |
| PC6 | only filtered rows; only admin | C | CE:127, IC:543; CE:346, RT:90 |
| PC6 | "העמודות שנבחרו" | C + S | CX:112; columns fixed to name, phone, email (completion-plan:22, USER 2026-10-13) |
| PC7 | shown in ₪; no wrong rounding | C | MO:6, RP:618; MO:19, MO:32 |
| PC7 | stored in agorot (integer columns) | N | T10 |
| PC8 | draft until publish; hidden section/item absent from the pages | C | CP:148; CT:92, PV:20, LP:87, MD:527 |
| PC8 | hidden item not readable through the public API | לא עובר: תיקון מתוזמן | T11 in fix-public-read-leaks (deferred-work, spec 6.7) |
| AV1 | marketing text and images only from published content | N + MA | T19; MA11 |
| AV1 | published change shows with no deploy; empty block hidden | C | CACT:322, CACT:339, LP:44; CT:116, OF:53, HH:15, PV:106 |
| AV2 | WhatsApp and address from business details; template change only new | C | BD:71, PSH:125; ST:533 |
| AV2 | no hard-coded number anywhere | N | T20 |
| AV3 | default change leaves entitlement, payment, session, booking | C | PCAT:70 (row_to_json equal); ST:247; ST:313 |
| AV4 | per-case change logged old/new, only that case: amount; balance, weekdays; close time, display price | N | T12; T13; T14. Balance: the audit log records the movement (−2, "הורדו 2 כניסות"); the old and new value are kept in `entitlement_corrections` and shown to Tal in "היסטוריית תיקונים" on the card's page (3.13 design, spec-3-13:39). All the information exists and Tal sees it; no code change (planning session decision 2026-10-30) |
| AV4 | expiry, capacity logged old/new | C | EC:209; EVA:257 |
| AV4 | "סוג מפגש בזכות" / "סימון השתתפות בעבר" | S | spec-3-13:108 (USER 2026-10-19); completion-plan:8, :44 |
| AV5 | checkbox; later booking by corrected values; notification | C | EC:325; EC:518, EC:302; EC:209, EC:387, EC:518 |
| AV6 | dialog lists future bookings that no longer fit | C + MA | EC:518, EC:618 (preview `affected`); MA12 |
| AV6 | after approval they stay exactly (status, event, movements, balance) | N | T15 |
| AV7 | old ← new without checkbox | C | VCR:33, SD:265, SD:279, SD:286, SET:74, SET:83 |
| AV7 | logged (capacity, settings / close, price) | C / N | EVA:257, ST:247 / T14 |
| AV8 | post-join message and button | S | UX memlog:143 (USER 2026-10-06); dead editor fields in deferred-work (before 6.4) |
| AV9 | display price shown on the session page | C | PUBS:161, PUBS:174 |
| AV9 | display price does not change payment or entitlement | N | T16 |
| AV10 | alt required; consent mark | S | UX memlog:140 (USER 2026-10-05) |
| AV11 | text / image testimonial; edit, delete, order, hide | C | SF:257, CS:384, SF:172, SF:149, PV:20 (alt part S as AV10) |
| SC1 | no occupancy in the public selection; capacity refused; customer labels only, couple with 1 free = full | C | PS:115; PS:155; G:426, SB:767; PSX components/public/public-sessions.test.tsx:63/86/161; SB:725, CI:722; SST:36 |
| SC2 | no menu field; none rendered | C + MA | EVA:933; MA4 |
| SC3 | Thu → Wed+Thu, Mon → Sun+Mon; "+ יום הכנה" this session only; empty column not printed | C | WS:127, WS:151 (fixed dates); WS:182; WSX:522 |
| SC4 | print markup complete; WhatsApp only not-bought items | C + MA | WSX:522, WSX:548, WSX:153; SM:41, SM:63, WSX:269; MA9 |
| SC5 | customer cannot read work sheet, shopping, notes | C | WS:584, WS:671, SH:373; NOTE:488 |
| SC5 | archived concepts unreadable (API) | לא עובר: תיקון מתוזמן | T18 in fix-public-read-leaks (deferred-work, spec 6.7) |
| SC6 | join without photo consent; time and version; change in profile | C | J:208; PR:358, PR:455; PSEC:181, app/me/profile/actions.test.ts:285 |
| SC7 | "עם סבתוש" couple 14; concept with sessions archived | C | EVA:134, EVA:944; CON:455, CON:380 |
| SC7 | session field change leaves the concept | N | T17 |
| SC7 | concept design theme | S | UX memlog:131 (USER 2026-10-04, concept colours dropped) |
| SC8 | open cards equal balance; 3+1 listed; drops after 4th and on expiry; stays on card; customer no access | C | OC:260, OC:305; OC:288; OC:324, CU:535; OC:450 |
| SC9 | every item add/edit/delete or archive | C | WS:436, WS:182/221/287, SH:125/236/297, NOTE:182/394/258/285, CON:172/310/380/425, SF:257/149 |
| SC9 | topic | S | SPEC memlog:313 (USER 2026-10-21) |
| SC10 | RTL rules | C | ESL:263, SL:256 |
| SC10 | contrast of text tokens ≥4.5:1 | N + MA | T23; MA3 |
| SC10 | phone, keyboard, screen reader | MA + MU | MA1, MA2; MU1, MU2 |
| SN1 | explanation before asking; refused not asked again | C | PC:30; PCL:30, PCL:98, PCL:130, PC:58/65 |
| SN1 | permission requested only on click | N + MA | T21; MA10 |
| SN2 | offline write buttons disabled; no personal data cached | C + MA | OB:15, OB:22, app/me/bookings/bookings-list.test.tsx:196; SW:293, SW:223; MA6 |
| SN3 | admin home never "רווח"/"הכנסה" | C | HI:502 |
| SN4 | no link token or password in audit; filter by session and date | C + MA | LL:321, RS:64, RSU:83, AUD:186; AUD:194, AUD:261; MA7 |
| SN5 | statement shows only existing contact details | C + MA | LV:90, LV:104; MA8 |
| SN6 | deleted note gone; archive hidden, restorable | C | NOTE:285; NS:113, NOTE:258 |
| SN7 | no kind label for a guest | C | PSX `expectNoPlacesOrKind` |
| SN7 | no kind label for a customer | N + MA | T22; MA5 |
| SN7 | 4.5:1 on concept colour | S + N | UX memlog:131 (no concept colours); token contrast T23 |

**C rows opened by this session before the gate (assertions read):** CB:286, CB:315, TP:28, CC:317, RC:344 (CN); SR:241, SJ:329, MK:166, MK:194 (NT); TM:29, IC:325 (PC); ST:533, EC:325, PCAT:70 (AV); PS:115, SB:725, OC:288 (SC); AUD:194, NOTE:285, HI:502 (SN). The rest were read by mapping subagents; all are reopened row by row while writing the report.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/tests/acceptance-cancellation.test.ts` -- T1 sessions a (capacity 1), b, c after the origin; customer B books a; A cancels her pinned booking with "credit" → options exactly [b, c]. T2 credit from a ≥48h self-cancel with "refund", and an active credit turned refund by `admin_refund_credit`: `book_session` on an option → NO_MATCHING_ENTITLEMENT, preview not credit-funded, occupancy 0, no `booking_allocations` row with that credit.
- [x] `supabase/tests/acceptance-notifications.test.ts` -- T3 due booking, session moved 72h out → `job_reminders` 0 and no reminder; moved back to 23h → one reminder with the new revision; same through `admin_reschedule_event`. T4 notification with push, subscription, job claimed and finished failed (HTTP_500, attempt 5): booking confirmed, allocations, balance and occupancy unchanged, notification row kept; no `invoke_push_worker`. T5 card 10 days left, `job_expiry_alerts` twice → one `card_expiring`. T6 one-entry card used (session completed by `job_complete_events`), and a 2-entry card used+reserved, 10 days left → no alert of either type. T7 alerts at 10 days, real extension (`job_auto_extend` or `admin_correct_entitlement`), then ≤10 days on the new date → new alerts keyed by the new expiry, old ones not repeated. T8 Monday 20:00 slot fires at 17:00Z in summer and 18:00Z in winter (fixed 2099 dates). T9 column defaults via `pg_attrdef`: `credit_options_count` 2, `reminder_lead_hours` 24; it must not pass by chance: inside the rollback set the live row to other values (e.g. 3 and 6), then reset the columns with `= default` and assert 2 and 24 come back, and a credit created afterwards gets 2 options. All job and push calls inside `inRollback`; then no rows of the test in `notification_jobs` and `net.http_request_queue`.
- [x] `supabase/tests/acceptance-content-values.test.ts` -- T10 every `public.*_agorot` column is integer or bigint. (T11 not written here: fix-public-read-leaks.) T12 approval at 44000 on a 47200 product with confirm: audit has old `product_snapshot.price_agorot` 47200 and `amount_agorot` 44000; `products.price_agorot` still 47200; next preview 47200. T13 `admin_correct_entitlement` units 4→2 and weekdays null→[0]: correction row and audit old/new; product row, `business_settings` and another customer's card unchanged. T14 `admin_update_event` close time and display price: one audit row each with before/after; `business_settings` and concept unchanged. T15 correction (expiry, weekdays) with a future booking that no longer fits: bookings (id, status, event, party, cancelled_at), movements and balance equal before/after. T16 session display price 9900, pinned product 12800: preview and payment 12800; display price changed after → payment and entitlement rows equal. T17 session from "עם סבתוש" edited (description, capacity, display price) → concept row equal. (T18 not written here: fix-public-read-leaks.)
- [x] `components/public/empty-content.test.tsx` -- T19 home, about, how-it-works, gallery, contact views with empty sections: visible text is only system copy (`shellCopy`, nav labels).
- [x] `test/no-hardcoded-contact.test.ts` -- T20 source scan of `app/`, `components/`, `lib/`, excluding only test files and fixtures: no Israeli phone number, no `wa.me/<digit>`; number-less `wa.me/?text=` allowed. On failure it prints every place found. A made-up number used as microcopy (placeholder) is checked by eye and listed by path in the test as an allowed exception, and in the report.
- [x] `test/push-permission-on-click.test.ts` -- T21 `Notification.requestPermission` appears once outside tests, in `push-card.tsx` inside `enable()`.
- [x] `app/me/sessions/[id]/page.test.tsx` -- T22 new it: a couple session renders no "זוגי", "רגיל" or "לשני מבוגרים".
- [x] `app/globals.test.ts` -- T23 new it: values parsed from `app/globals.css` itself (never copied into the test); WCAG ratio ≥4.5:1 for text tokens (foreground, muted-foreground, primary, status colours) on background and card, primary-foreground on primary; brand-accent excluded (icons only, 3:1) and its non-text use checked in MA3.
- [x] `_bmad-output/implementation-artifacts/acceptance-report-6-7.md` -- structure of `acceptance-report-6-6.md`: date, commit, counts from the full runs; per clause עובר / לא עובר / הוחלף בהחלטה with relative links; every C row reopened row by row (stated); M-auto and M-user sections marked "ממתין".
- [x] `_bmad-output/initiative-brunch-at-tal-v1/epic-launch/story-acceptance-suite-rest.md` -- new story file for tickets.toml id 7 with `status: done` (in the PR, as 6.6's `story-acceptance-suite-core.md`).

**M-auto (planning session; automated browser, width 390 and desktop; local dev or https://brunch-at-tals.vercel.app):**
- MA1 (SC10) `/`, `/sessions`, `/sessions/<id>`, `/me`, `/me/sessions`, `/me/purchases`, `/me/profile`, `/admin`, `/admin/sessions`, `/admin/sessions/<id>/work`: no horizontal scroll, text starts on the right, `<html dir="rtl">`.
- MA2 (SC10) keyboard only on `/login`, the booking sheet in `/me/sessions/<id>`, the cancel sheet in `/me/bookings`, the old ← new dialog in `/admin/settings`, a sensitive dialog in `/admin/customers/<id>`: Tab reaches every control with visible focus, Enter acts, Escape closes and focus returns to the trigger. Stop before any confirm.
- MA3 (SC10, SN7) computed styles on `/sessions` and `/me/sessions`: every text colour on its background ≥4.5:1; brand-accent appears only on icons.
- MA4 (SC2) `/sessions/<id>`, `/me/sessions/<id>`: no menu section or "תפריט".
- MA5 (SN7, SC1) as dev-customer, `/sessions`, `/me/sessions`, `/me/sessions/<couple id>`: no "רגיל", "זוגי", "לשני מבוגרים"; availability is a word, no place number.
- MA6 (SN2) as dev-customer, booking sheet open, network offline: confirm `aria-disabled`, `offline-hint` banner, no request sent; same for "כן, לבטל" in `/me/bookings`.
- MA7 (SN4) `/admin/audit`: rows show no password and no `/join/` or `/reset/` URL or token; session filter and date filter narrow the rows. Data: existing link/reset rows in dev.
- MA8 (SN5) `/accessibility` signed out: 200, only existing contact details, links work.
- MA9 (SC4) `/admin/sessions/<id>/work` print preview: dishes and tasks, registrants with diet and allergies (companion too), photo consent, shopping list; a prep day with no items not printed. Data (the planning session creates it through the screens and removes it after): one published future regular session with two "בדיקה 6.7" customers booked, one with a diet note and an allergy and photo consent "no"; one published future couple session with a "בדיקה 6.7" couple booking whose companion has an allergy; on each, one dish, one task, two shopping items (one marked bought) and one added prep day with no items.
- MA10 (SN1) as dev-customer `/me/notifications`: explanation card shown, no browser prompt on load; "לא עכשיו", reload → still no prompt.
- MA11 (AV1) `/` (including its about section), `/how-it-works`, `/gallery`, `/contact`: every marketing text matches the published content in `/admin/content`. View only; the content is real, nothing is edited.
- MA12 (AV6) data (planning session, through the screens, removed after): a "בדיקה 6.7" customer with a 4-entry card approved today (expires in 49 days) and a confirmed booking on a published regular session on a Tuesday 2–3 weeks ahead. Then `/admin/customers/<id>/entitlements/<entitlementId>`, change expiry to before the booking (and, separately, weekdays to Sunday only) → the dialog lists that session above the checkbox. Stop before confirming (T15 proves the after-state).

**M-user (the user, on her phone, https://brunch-at-tals.vercel.app; Hebrew step list in the report):**
- MU1 TalkBack (or VoiceOver) on the home page, a session page, the booking sheet (opened, not confirmed), `/me`, and `/admin` as dev-admin: every button and field is read with a clear name.
- MU2 phone feel: scrolling the session list, opening and closing the booking and cancel sheets, typing in the login form, the profile edit and the work sheet "+ פריט" sheet: the field stays visible above the keyboard, the confirm button is reachable.
- MU3 optional, only with an iPhone (deferred-work, 5.8 iPhone item): install to the home screen, enable push from the notifications card, receive a push within a minute with the app closed, tap opens the right page.
- Not included: install and Android push (6.8).

**Acceptance Criteria:**
- Given the full `npm run test:db` and `npm test`, when they finish, then every new test passes and the report marks each of the 47 clauses עובר or הוחלף בהחלטה, except PC8 and SC5 (API part) marked "לא עובר: תיקון מתוזמן", with no `test_` rows left (`node scripts/dev-clean-test-data.mjs` dry run).
- Given any new test fails, when first seen, then work stops and the planning session gets clause, actual, source text and a recommendation.

## Superseded / wording notes

- CN2: counted from the cancelled session, not "מועד פעולת הביטול" (source §6:238): SPEC memlog:206, :287 (USER 2026-10-06), cancellation-rules:21. 3.7 (memlog:295, 2026-10-10): a credit also funds its own cancelled session outside N (CC:1252). 3.18 (memlog:311): matching includes eligible products.
- CN6: after a move, cancel returns the same credit, never money (memlog:303, 2026-10-18; MV:652).
- NT1: a real time change creates a reminder per session revision (source :298); a move into the window sends none (memlog:305; MV:923).
- NT4: alerts fire when days left ≤ threshold, at most once per card per expiry date (CAP-35, memlog:204).
- NT5: days and times are editable; the clause's schedule is the default (memlog:312).
- SC2, SN7: source lines 64, 66 (menu, kind) overridden by SPEC memlog:218 and UX memlog:87, :94 (2026-09-26).

## Implementation Notes

- Planning session go (2026-10-30): single-file runs `npx vitest run --project db <new or changed file>` are allowed now, one at a time (never two db runs at once; no other tab is running). The full `npm run test:db` is run by the planning session: write the report with the per-file results and leave the full-run count pending. Work only in the worktree `C:\Users\ligal\Desktop\Projects\brunch-at-tals-6-7`. No git operations, no file deletion (`rm`, `git rm`), no writes to `.env*`, no `demo:*`/`video:*`, no `execute_sql` writes or `apply_migration`. If a cleanup takes close to 30 s, report it.
- The report (`acceptance-report-6-7.md`) has the structure of `acceptance-report-6-6.md` but is written in English (story prompt); clause quotes stay in Hebrew verbatim, and the M-user section is a plain-Hebrew step list (she follows it on her phone) with "מה אמור לקרות" after each step.

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-10-30): blind-hunter, edge-case-hunter, verification-gap, intent-alignment, mutation

Verdicts: high 0, medium 3, low 8, false 4, rejected 14 (#11 moved from defer to reject by the planning session, 2026-10-30). Mutation lens: 7 rolled-back mutations (48h deadline 47h; no REFUND_EXCEEDS_PAID; reminder dedupe broken; capacity_adults granted to anon; work_dishes policy `true`; plan_funding accepts refund_requested credits; expiry alerts without `available > 0`) all caught (CB, RC, SR + T3/T4, PS, WS, T2b, T6); every function, policy and grant md5 identical before/after; `support/db.ts` restored (git diff empty); no `test_` rows.

| # | Source | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|---|
| 1 | VG, EC, BH | queue check filters by body text (worker posts `{}`), `xmin` misses subtransactions, NT4/T9 tests skip it | medium | patch | start-mark comparison, positive control with a real `invoke_push_worker()` (dev Vault has both secrets), used in T5–T7, T9 |
| 2 | VG, EC, BH | T21 misses `pushManager.subscribe` (PushSync on mount) and passed `enable` references | medium | patch | "on" requires permission granted (lib/push/client.test.ts:33); source checks on subscribe/ensureSubscription callers and the guard order; count every `enable` |
| 3 | VG, EC, BH | T23 omits muted/secondary/accent/popover surfaces | medium | patch | surfaces added, values from globals.css |
| 4 | VG, EC | T22 never renders the booked couple state; word inflections missing | low | patch | booked case + "זוגית", "זוגיים" |
| 5 | VG, EC, mutation | T2a passes without exercising the status check | low | patch | explicit `options = []`; T2b is the proof (mutation 6a) |
| 6 | BH | T5 never asserts the admin alert / first-run count | low | patch | asserted |
| 7 | BH, EC | T14 timestamp text depends on TimeZone; `in` on null `after` | low | patch | `set local timezone = 'UTC'`, guard |
| 8 | BH | T10 checks only `*_agorot` names | low | patch | no numeric/real/double/money column in public (none today) |
| 9 | BH, EC | T20 skips comments, misses api.whatsapp.com / whatsapp:// / 1-700 / `(054)` formats | low | patch | patterns + self-tests; comments scanned; legal-views.tsx:35 comment listed as explicit exception |
| 10 | EC | MA11 lists `/about`, which does not exist | low | patch | spec and report: about section of `/` |

Rejected: EC T13 units audit holds only the movement (#11, was defer: the audit log records the movement (−2, "הורדו 2 כניסות"); the old and new value are kept in `entitlement_corrections` and shown to Tal in "היסטוריית תיקונים" on the card's page (3.13 design, spec-3-13:39). All the information exists and Tal sees it; no code change (planning session decision 2026-10-30)); BH T20 migration seed number (`20261001201839:175` seeds business details data, not display code; AV2 is proven by BD/PSH); BH empty-content other pages (legal pages are content-driven, LV:90/104; `/sessions` has no marketing copy) and `shellCopy` oracle (system copy by AGENTS.md rule); BH raw `couple` value in HTML (no claim about markup; MA5); BH/VG T4 claim window (parking pattern from PU, rollback; flake risk negligible); BH helper duplication and `as()` catch (style); BH T1 dead checks / filled-after-creation case (CC:707); EC `mothers` concept lookup (seeded concept, failure would be loud); EC BookingPanel mocked (MA5 covers the rendered panel); VG `value()` unanchored regex (existing helper, false today: `:root` order resolves correctly); BH AV7 header without test (false: T14 is AV7's close/price logging); IA surface readings (descriptive; browser/phone surfaces are MA/MU by design, full run by the planning session).

## Known risks

- If the after-rollback queue check fails in the full run, run that file again on its own before looking for a bug (a real push job that is ready in dev can make the minute's cron wake the worker while a job test runs).

## Verification

**Commands:**
- `npx vitest run --project db <new file>` -- after the planning session's go; one at a time; passes.
- `npm run test:db` (full) -- run by the planning session; passes.
- `node scripts/dev-clean-test-data.mjs` (dry run) -- no `test_` rows.
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` -- pass (invisible-chars check is inside `npm test`).
