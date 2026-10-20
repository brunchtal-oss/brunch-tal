---
title: 'Fixes 9 and 11: customer card and profile layout, bigger admin section titles'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '37ad1d0ac13e5a9861950c9d2477378e72be3632'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-brunch-at-tals-2026-09-23/DESIGN.md'
  - '{project-root}/_bmad-output/implementation-artifacts/fixes-log.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin customer card is hard to scan (fix 9), the customer profile looks unorganised (fix 11), and admin section titles read smaller than the content under them (user decision 2026-10-19: fix in all of admin).

**Approach:** Reorder and box both screens, fold "חשבון" into "פרטים" with edit pencils, make the balance cards whole links, collapse the history, and apply one bigger section-title style through shared classes. Structure and layout only.

## Boundaries & Constraints

**Always:**
- Card order: (1) header: name only (+ the existing "not activated" chip; no phone). (2) "פרטים" in a cube, and right under it, side by side, "הפקת קישור איפוס" and "רישום למפגש" in button-primary (each shown under its current condition; the reset button always reads "הפקת קישור איפוס"; no line about the latest link; the issued-link box below the row) (phone check, user decision 2026-10-21). The cube: phone, email, joined, last activity, dietary, photo consents, babies (name, age; or `noBabies`). A pencil after the email (only when `canChangeEmail`) and after the phone opens the existing `ValueChangeRow` field under that row: same actions, keys and saved texts as 2.8; cancel closes it; stuck email change shows its notice and opens the email field. (3) "יתרות ותוקף" as today, without the "פרטים ותיקונים" link; each card plate is one link to `entitlementHref`. (4) "זיכויים והחזרים" exactly as 3.16 leaves it. (5) "היסטוריה" closed, chevron down; opens to the bookings and purchases rows. (6) "הערות".
- Profile order, each a cube (DESIGN › card): details (unchanged edit flow, phone/email read-only; the dietary row shown when empty too, with a hint to add it in edit: phone check, user decision 2026-10-21), babies in its own adjacent cube (recommended over inside details: it has its own add/edit/delete forms, and two edit buttons in one cube confuse on a phone), the photos link, then the links list (notifications, install, legal).
- All §7 card contents (profile, history, balances, validity, reset/activation links, internal notes apart) and the §5 profile stay; nothing removed.
- Copy unchanged except: remove `card.account.title` ("חשבון") and `card.entitlementLink`; new copy only in `lib/copy/admin.ts` (pencil labels "עריכת המייל", "עריכת הטלפון"). No "טל" in customer copy.
- A11y: a plate link has one clear name (`entitlementLinkFor(product)`); the history toggle is a `<button aria-expanded aria-controls>` inside the h2; every target ≥44px. Data-changing buttons that move stay `OnlineButton`; the pencil and history toggle only open UI, so plain buttons.
- Title style (user decision 2026-10-20): section titles Heebo 24px medium (500), cube titles Heebo 20px medium, in admin and the profile; departs from DESIGN's "all headings Heebo 300", recorded in the UX memlog.
- Story 4.6 ("הסרת פרטים") will add its action at the bottom of the "פרטים" cube, under a rule; note this in a code comment there.

**Never:** no change to data, RPCs, actions, loads, or what is shown; no migration; no `test:db`/`demo:*`; no customers list (5.13); no edits in `components/ui/`; no physical Tailwind directions.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Not activated | `activated_at` null | Chip under name; no button row; phone pencil only; no email pencil |
| Pending reset link | status pending | Button reads "הפקת קישור איפוס"; no status line |
| Card with entries | plate has entries | Whole plate links; the entries toggle still opens in place without navigating |
| Open single | `SinglePlate` | Unchanged, not a link |
| Pencil save | phone saved | Field stays open showing the saved text until cancel/close |
| No babies (card) | none | Babies row shows `noBabies` |

</frozen-after-approval>

## Code Map

- `app/admin/(shell)/home/home-section.tsx` -- `PageSection` (h2 22/300, no box) and `HomeSection` (h2 16/600 in a cube). Add a `boxed` prop to `PageSection` (cube surface). Titles from the shared classes.
- `components/shared/section-title.ts` (new) -- `sectionTitleClass`, `cubeTitleClass`; used by both sections, the profile, and the inline admin copies.
- Inline admin title copies (paths under `app/admin/(shell)/`) of `font-heading text-[22px] leading-[1.25] font-light`: settings/settings-editor.tsx:243,273; settings/templates/[type]/template-editor.tsx:216; sessions/[id]/attendee-list.tsx:27; sessions/[id]/book/page.tsx:87; sessions/book/multi-booking.tsx:446; work/shopping-list.tsx:67; work/work-sheet.tsx:116,222; sessions/[id]/work/attendee-sections.tsx:47; heading-like `<p>`s audit/audit-list.tsx:204, customers/open-cards/page.tsx:123, notes/notes-view.tsx:107,271. Cube-title copies (16/600 h2): payments/refunds-section.tsx:41, content/content-editor.tsx:906, payments/new/payment-form.tsx:797,955, sessions/[id]/edit/session-editor.tsx:493. Leave legends/labels (15/600), sub-labels (13px) and notes topic h2 (26/300) as they are.
- `app/admin/(shell)/customers/[id]/page.tsx` -- reorder; header without phone; `BalancePlate` becomes a stretched link (plate `relative`, link on the product name with `after:absolute after:inset-0`, entries `<details>` `relative z-10`); babies into details; history via the new disclosure.
- `customers/[id]/account-section.tsx` -- split into `ContactRows` (phone/email rows with pencils, stuck notice) and `HeaderActions` (reset button beside a `children` slot for the book link, then status and issued box). Keep `issueResetWithKey`, `ResetLinkView`, the actions and `ValueChangeRow` wiring.
- `customers/[id]/history-disclosure.tsx` (new, client) -- h2 > button, closed by default.
- `customers/[id]/card-items.ts` -- `detailRows` drops the email row (rendered by `ContactRows`); update the comment.
- `lib/copy/admin.ts` -- `customers.card` keys (~1655-1760).
- `app/me/profile/page.tsx`, `details-section.tsx`, `babies-section.tsx` -- wrap in cubes, title class; photos link as a cube row with chevron; links list in a cube.
- Tests: `account-section.test.tsx`, `card-items.test.ts`, `credits-section.test.tsx` (only if markup shifts), `app/me/profile/profile-sections.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] Main session, before building -- confirm 3.16 merged; merge `origin/main` into the branch.
- [x] Start with the `frontend-design` skill within DESIGN.md and EXPERIENCE.md, phone first.
- [x] `components/shared/section-title.ts`, `home-section.tsx` -- shared title classes, `boxed` prop.
- [x] Inline admin copies listed above -- switch to the shared classes.
- [x] `account-section.tsx`, `history-disclosure.tsx`, `page.tsx`, `card-items.ts`, `lib/copy/admin.ts` -- the card per Always.
- [x] Profile files -- the cubes per Always.
- [x] Tests -- update the four files; add: pencil opens/closes the field and has `aria-expanded`; not activated has no email pencil or button row; stuck opens the email field; history toggles `aria-expanded`; plate link name; `detailRows` has no email.
- [x] UX `.memlog.md` (ux-brunch-at-tals-2026-09-23) -- record the title-style decision (2026-10-20).
- [x] `fixes-log.md` -- "מצב" of rows 9 and 11.

**Acceptance Criteria:**
- Given any admin screen, when viewed on a phone, then each section title is visibly bigger than the rows under it.
- Given the card, when an admin changes the email or phone via the pencil, then the same RPC flow as 2.8 runs and the page refreshes.
- Given a balance plate, when tapped anywhere outside the entries toggle, then the entitlement page opens.

## Implementation Notes

- The plates moved from `page.tsx` to `balance-plates.tsx` (a page may not export them; the plate-link test needs them). New test file `balance-plates.test.tsx` covers the plate link and the history toggle.
- `HEADER_BUTTON` (the two header actions' class) lives in `card-items.ts`: a server page cannot read a string exported from a `"use client"` module.
- `DetailRow.ltr` dropped with the email row (no other row used it).
- Card sections, boxed or not, use the section title (24/500); the profile's cubes and admin home cubes use the cube title (20/500).

## Spec Change Log

- 2026-10-21, phone check (user, renegotiated the frozen block): the two card actions move from the header to right under the "פרטים" cube, in button-primary (green); the reset button always reads "הפקת קישור איפוס" (no "חלופי"); the latest link's status line is dropped (`AccountView.resetStatus`/`resetButton` and their copy removed). Profile: the dietary row shows when empty, with `dietaryNotesEmpty`. KEEP: everything else passed the phone check.

## Review Triage Log

Pass 1 (quick, one reviewer): 2 findings — medium 1, low 1, false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `home/session-tile.tsx:44-57`: the admin home's session tile keeps an 18/600 title (h2 or `<p>` under a 13px eyebrow), unlike the 20/500 cube titles | medium | patch | Missing from the Code Map; the intent covers every admin title. The session title now uses `cubeTitleClass`; the 13px eyebrow h2 stays |
| 2 | `PageSection.title` widened to `ReactNode`, and its comment claims the history control uses it | low | patch | No caller passes a non-string, and `HistoryDisclosure` has its own h2. Reverted to `string`, comment fixed |

Main session, before the review: added `babies-row.tsx` and its tests (matrix row "No babies"), and wrapped an over-long comment line in `home-section.tsx`. No test covers the matrix row "Pencil save" (static markup cannot click). The reviewer read the code and confirmed only cancel or the pencil closes the field; it is checked again on the phone.

## Verification

**Commands:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build` -- all pass.

**Manual checks:**
- Phone: card order; pencils change email/phone; reset link issues; plate opens the entitlement page; history opens/closes. All admin screens: titles bigger than content. Profile: order, editing details/babies/photos, the end links.
