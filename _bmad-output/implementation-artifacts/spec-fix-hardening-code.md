---
title: 'Fix: code hardening for login, reset and phone links'
type: 'bugfix'
created: '2026-11-04'
status: 'done'
baseline_commit: '8172ad9cb82c57c5d0eeb4f727ec9764e655862b'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/review-accepted.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Five gaps from the pre-6.1 audit: the public join action accepts unbounded fields and its email check can take very long on crafted input; repeated wrong logins block an account for everyone, including the admin; a reset form already used once can change the password again until the link expires; the business phone check rejects a number copied from WhatsApp and accepts "+972 0…", which builds dead wa.me/tel: links; and the join "back to form" loop was reported but never reproduced.

**Approach:** Length caps before the email regex and a regex with no overlapping parts; the per-account login key also carries the client IP; a repeated reset submit never touches the password; one `normalizePhone` helper for the content check and every wa.me/tel: link; reproduce the join loop in a browser before touching it.

## Boundaries & Constraints

**Decisions (user, via the work manager, 2026-11-04):** S2 keys the login account limit on email and client IP together; the per-IP limit stays; guessing from many IPs is closed by 6.9's CAPTCHA. R6: the business is Israeli, so a content phone is valid only when it normalizes to `^972(?:[57]\d{8}|[2-489]\d{7})$` (tightened in review, work manager's OK 2026-11-05); a foreign number, or one that cannot be normalized to 972, is refused in the editor. S1 covers every email regex and every unbounded email input the sweep found (Code Map), from one shared helper.

**Always:** `hitRateLimit` stays the first step of every login/token action and the only limiter (AGENTS.md); the per-IP limit stays as is. Caps mirror the DB limits of `join_complete`: email 254, full name 200, dietary notes 2000, baby name 100. Unicode direction marks appear in code only as `\uXXXX` escapes. No log carries a token, password, email or phone (AD-22). No "טל" in customer copy.

**Never:** no migration and no change to `rate_limit_hit` (if S2 turns out to need one: stop and ask, tab B owns the DB); no `test:db`, `demo:*` or `video:*`; no CAPTCHA or leaked-password protection (S4, story 6.9); no forced remount key for R5 on a guess; no audit-report text, quote or path in any repo file, commit or PR (describe the fix and the correct behavior only). Do not edit the DB normalizer `private.normalize_phone` (customer phones, AD-9); this helper is for content phones only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Long email | 255+ chars, or a crafted `a@` + 100k dots + `@` | Rejected at once, before the regex | field `email`, message `email` |
| Long text field | fullName 201 / dietaryNotes 2001 / babyName 101 chars | Rejected | `INVALID_INPUT` on that field (babyName with its index) |
| Login lockout | 9 wrong logins for an email from IP A | IP A is blocked for that email; the same email from IP B with the right password signs in | `TOO_MANY_ATTEMPTS` only on IP A |
| Reset retry | `reset_begin` answers `already_completed` | No `updateUserById`; success with `email: null` ("saved-login" screen, no auto sign-in); password unchanged | none |
| Used reset link | open again / submit with a new key | Still "used" / `LINK_USED`, as today | unchanged |
| Phone forms | `0544256456`, `054-425-6456`, `+972 54-425-6456`, `\u202A+972 54-425-6456\u202C`, `\u200E+972 54-425-6456`, `+972 054-425-6456`, `00972-054-425-6456`, `972544256456` | All → `972544256456`; `wa.me/972544256456`; `tel:+972544256456` | none |
| Israeli number without its 0 | `544256456` | null: editor refuses, no link | existing editor field error |
| Foreign number | `+44 20 7946 0958` | null: editor refuses, no link | existing editor field error |
| Wrong length or prefix | mobile with a digit missing `054425645` or extra `05442564567`; `1-800-123-456` | null: editor refuses, no link | existing editor field error |
| Landline and 07x | `02-1234567`, `077-1234567` | `97221234567`, `972771234567` | none |
| Bad phone | `abc`, `05`, `+0123456789`, 16 digits, `tel:()` | null: editor refuses, no link | existing editor field error |
| Long login email | 255+ chars | `INVALID_CREDENTIALS` after the rate limit, no call to Auth | same message as a wrong password |
| Admin email edit | 255+ chars, or the crafted email | `emailChange` returns null, length checked first | save stays disabled, as today |
| R5 | join link with details of an existing account → login prompt → "חזרה לטופס" → same details again | Login prompt shows again | fix only if the loop really happens |

</frozen-after-approval>

## Code Map

- New `lib/email.ts` (pure) -- export `MAX_EMAIL_LENGTH = 254` and `isEmailShape(value)`: length first, then `/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/`.
- `app/(auth)/join/[token]/join-input.ts` -- `EMAIL` (:12), `validateJoin`: use `isEmailShape`; caps for the other fields before any check. `PHONE` is already bounded ({9,20}); keep it.
- Email sweep (email regexes and email inputs in app/components/lib): `app/admin/(shell)/customers/[id]/card-items.ts:449` `EMAIL_SHAPE` (same overlapping regex; `emailChange` :460 checks length only after it) moves to `isEmailShape`. `app/(auth)/login/actions.ts` has no regex but no cap: after the rate limit, an email over 254 answers `INVALID_CREDENTIALS` without calling Auth. Clean, no change: `legal-text.tsx:62` mailto (`@` excluded on both sides, linear), `lib/content/schema.ts:332` (`max(254)` before `z.email()`), `push-worker.ts:46` (server config, not input), reset (no email input).
- `app/(auth)/join/[token]/actions.ts` -- rate limit then `validateJoin` (:96-104); no change expected. `rpcFieldError` shows the server's field mapping to mirror.
- `app/(auth)/login/actions.ts` -- `hitRateLimit("login", { ip, id: email })` (:52-58): id becomes IP + email, IP first (the key is cut at 512 chars, so a long email can never drop the IP).
- `lib/server/privileged/rate-limit.ts` -- header comment (:8-15): the login account key is "email from this IP"; note why and that 6.9's CAPTCHA covers guessing from many IPs.
- `lib/server/privileged/reset.ts` -- `completeReset` (:57-82): on `already_completed`, skip `updateUserById` and `reset_complete`, return `{ ok: true, data: { email: null } }`; update the file comment (:12-17).
- `app/(auth)/reset/[token]/actions.ts` -- `email: null` already means "saved, log in yourself" (`reset-view.ts:15` → "saved-login"). No change.
- `lib/phone.ts` -- add `normalizePhone(raw): string | null` (international digits, no "+"); update the "display only" comment.
- `lib/content/whatsapp.ts` -- `whatsappHref` uses `normalizePhone`.
- `lib/content/schema.ts` -- `phone` refine (:20-25) uses `normalizePhone`.
- wa.me/tel: sweep: every link built from a number comes from content (`whatsapp.ts`; `telHref` in `contact-details.tsx`, used by `site-footer.tsx` and `legal-views.tsx`; `legal-text.tsx`). `components/admin/link-share.tsx:43` and `shopping-list.tsx:401` are wa.me without a number. No link is built from a customer phone today (record in Implementation Notes).
- `components/public/contact-details.tsx` -- `telHref` (:20) → `tel:+<digits>`; used by `site-footer.tsx` and `legal-views.tsx`.
- `components/public/legal-text.tsx` -- `safeHref` tel branch (:55-60) through `normalizePhone`, null when invalid.
- `components/public/legal-views.tsx` -- `displayPhone` (:37) through `normalizePhone` + `formatLocalPhone`.
- `app/(auth)/join/[token]/claim-join.tsx`, `join-form.tsx` (:114 `useActionState`), `page.tsx` (:87-106) -- R5 path; read only unless the loop reproduces.
- Tests to extend: `lib/content/whatsapp.test.ts`, `lib/server/privileged/reset.test.ts` (:187 asserts the old retry update; flip it), `app/(auth)/login/actions.test.ts` (:86 key shape), `app/(auth)/join/[token]/actions.test.ts` or a new `join-input.test.ts`, `components/public/public-shell.test.tsx` (:131, :304, :367), `legal-views.test.tsx` (:77, :96), `legal-text.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `app/(auth)/join/[token]/join-input.ts` -- caps + new email regex -- S1.
- [x] `app/(auth)/login/actions.ts`, `lib/server/privileged/rate-limit.ts` -- account key per IP + email; comment -- S2.
- [x] `lib/server/privileged/reset.ts` -- skip the password update on `already_completed` -- S3.
- [x] `lib/phone.ts`, `lib/content/whatsapp.ts`, `lib/content/schema.ts`, `components/public/contact-details.tsx`, `legal-text.tsx`, `legal-views.tsx` -- one `normalizePhone` for check, wa.me, tel: and display -- R6.
- [x] Tests above -- every matrix row except R5; a timing-bounded test for the crafted email (e.g. 100k chars returns in well under a second); reset retry asserts `updateUserById` not called.
- [x] `lib/email.ts`, `app/admin/(shell)/customers/[id]/card-items.ts`, `app/(auth)/login/actions.ts` -- shared email check; login cap -- S1 sweep.
- [ ] Main session (not an implementation subagent): R5 browser check, local dev server + dev DB: create a fake payment in the admin with a join link, open it, submit the details of `dev-customer@example.com`, tap "חזרה לטופס", submit the same details again, report what shows. Afterwards void the fake purchase through the admin screen. Any script that only reads never clicks an action button without the user's OK.
- [ ] Main session: commit, push, PR (the user merges on GitHub), prod check, branch/worktree cleanup, each after the work manager's OK.
- [ ] Main session: phone-width check by the work manager against this worktree's local dev server: send "מוכן לבדיקה" with the port, what to check, and the R5 result.

**Acceptance Criteria:**
- Given the content editor, when Tal pastes a number copied from WhatsApp, then it saves and "צרי קשר" opens WhatsApp to 972544256456.
- Given the saved value `0544256456`, when the site renders, then every wa.me link is unchanged and tel: links dial `+972544256456`.
- Given a reset link used once, when it is opened again, then it shows as used and no submit can change the password.
- `npm run build`, `lint`, `format:check`, `typecheck` and `npm test` pass; no screen layout or copy changes.

## Implementation Notes

- wa.me/tel: sweep: no link is built from a customer phone today; every number link comes from content (`whatsapp.ts`, `telHref`, `legal-text.tsx` `safeHref`). `link-share.tsx` and `shopping-list.tsx` build number-less wa.me links (unchanged).
- `telHref` keeps a fallback (digits and "+") for a value that does not normalize; the content schema makes it unreachable for parsed content.
- `displayPhone` keeps the typed text for any number `normalizePhone` refuses (now including 1-800), as before.
- R5 (2026-11-05, local dev server, headless Chrome at 390 px): a fake payment with a join link; the form sent with the existing dev customer's details shows "הפרטים קיימים במערכת. יש להתחבר לחשבון" with "להתחברות" and "חזרה לטופס"; "חזרה לטופס" shows the form (empty fields); the same details sent again show the login prompt again. No loop, so no code change. The fake purchase was voided through the purchase page afterwards (its held place and link released).
- Review patches: phone regex tightened by prefix and length (work manager's OK); Unicode dashes and U+061C stripped; schema tests for foreign / no-0 / short numbers; babyName 100 and dietaryNotes-only boundary tests; one 1000 ms bound on all timing tests; ARCHITECTURE-SPINE rate-limit line updated (8 per account from one IP); two 6.9 entries in `deferred-work.md` (CAPTCHA, IPv6 /64).
- `legal-text.tsx` `safeHref`: a tel: link that is not an Israeli number is now plain text (was a link with its digits).
- `lib/phone.ts` doc comment describes the accepted forms in words: `test/no-hardcoded-contact.test.ts` refuses phone-number examples outside its exception list.
- Join caps answer `INVALID_INPUT` on fullName / dietaryNotes / babyName (with index); the email cap answers `email` through `isEmailShape`.
- Login: the email cap (`INVALID_CREDENTIALS`, no Auth call) runs after `hitRateLimit`, so the attempt still counts.
- Reset: on `already_completed` neither `updateUserById` nor `reset_complete` is called.

## Spec Change Log

- 2026-11-05, review pass 1: finding "a 9-digit mobile passes `^972[1-9]\d{7,8}$` and builds a dead link". Amended the R6 decision (frozen, with the work manager's OK), the matrix (wrong length or prefix; landline and 07x) and Design Notes to `^972(?:[57]\d{8}|[2-489]\d{7})$`. Avoids an editor that accepts a wrong number. KEEP: one `normalizePhone` for check, wa.me, tel: and display; `tel:+972…`.

## Review Triage Log

Pass 1 (blind, edge-case, verification-gap, intent): high 0, medium 2, low 5, false 6.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `ISRAELI` accepts a mobile with a digit missing, and prefixes 1/6 | medium | patch | Tightened by prefix and length after the work manager's OK; tests added |
| 2 | Schema has no test refusing foreign / no-0 numbers | medium | patch | Cases added to `schema.test.ts` (business details and accessibility) |
| 3 | Unicode dashes and U+061C not stripped | low | patch | Added to `SEPARATORS` / `INVISIBLE`; tests with escapes |
| 4 | `card-items.test.ts` timing bound 200 ms flaky under load | low | patch | One 1000 ms bound everywhere |
| 5 | Missing babyName 100 / dietaryNotes-only boundary tests | low | patch | Added |
| 6 | ARCHITECTURE-SPINE still says "8 per account" | low | patch | Line 491 updated with the 2026-11-04 decision |
| 7 | Many-IP guessing relies on an untracked 6.9 CAPTCHA; IPv6 /64 buckets | medium | defer | Two 6.9 entries in `deferred-work.md` |

Rejected: published content would vanish under the stricter schema (false: dev values `0544256456`, `054-4256456` pass; prod copies dev content in 6.1); reset retry with a different retyped password shows "saved" (low: needs a lost response plus a different password; any fix needs new copy, against the approved "saved-login" decision); password max 72 / email bidi marks (pre-existing, not the regex risk; Auth answers); raw business phone text in the accessibility "soon" view (display, no screen change in scope); intent audit notes on password caps and R5 evidence (password out of S1's caps; R5 is a main-session browser check).

## Design Notes

`normalizePhone`: strip `[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]` and `[\s().-]`; `+X`→X, `00X`→X, `0X`→`972X`, bare digits stay; then `9720…`→`972…`; valid only as `/^972(?:[57]\d{8}|[2-489]\d{7})$/` (mobile and 07x: 9 national digits; landline 02/03/04/08/09: 8). Unicode dashes and the Arabic letter mark are stripped too. So `544256456` (bare digits, no 0) and every foreign number are null; a 1-800 number is refused too (the business number is a mobile). This is the content-phone counterpart of `private.normalize_phone` and does not replace it. tel: links move from the local form (`tel:0544256456`) to `tel:+972544256456`: same number, dials from abroad too.

Login key: `id: \`${ip} ${normalizedEmail}\`` keeps the `id:` key slot of `rate_limit_hit`, so the SQL thresholds (8 per key, 20 per IP) apply unchanged. This reverses the accepted risk in spec 2.8 line 30.

## Verification

**Commands:**
- `npx vitest run --project unit lib app components` -- all pass
- `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` -- all pass

**Manual checks (work manager, phone width, local dev server):**
- "צרי קשר" opens WhatsApp to the right number; admin reset link works; a used reset link is blocked.
