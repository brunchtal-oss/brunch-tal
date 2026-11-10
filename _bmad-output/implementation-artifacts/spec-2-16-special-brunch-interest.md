---
title: 'Special-brunch interest question (2.16)'
type: 'feature'
created: '2026-11-09'
status: 'in-review'
baseline_commit: '4cc8318058aff5dbb000a093baa96347e7579a0f'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-brunch-at-tal/security-and-rpc-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tal wants to know which customers are interested in special brunches (couples, סבתוש, סבוש) and to reach them on WhatsApp (user decisions 2026-11-03 and 2026-11-09, SPEC memlog; adds to the source's join-form fields, line 351). There is no such field today.

**Approach:** One array column on `profiles` with a fixed set of codes; the question and option texts are an editable content block. The customer answers in the join form (both paths, incl. 2.15) and changes it in "פרטים". Tal sees it on the customer card, filters the customers list by it, and gets it as an export column. No push and no group message (5.12 stays cancelled).

## Boundaries & Constraints

**Always:**
- **Build order (user 2026-11-09, changed):** start on the work manager's go after 2.15 commits and pushes its branch (after its review). Before building: merge `origin/story-2-15-admin-assisted-join` into this branch, base every `create or replace` on the live `pg_get_functiondef` (after 2.15's migration), and update the Code Map and tasks to what 2.15 built (its admin-fill path must send the same field).
- **Column:** `profiles.special_brunch_interests text[] not null default '{}'`. Codes: `couples`, `grandma` (סבתוש), `grandpa` (סבוש). Check constraint (built-ins only): value `<@ array['couples','grandma','grandpa']` and each code appears at most once (`coalesce(cardinality(array_positions(v, '<code>')), 0) <= 1` per code). Existing customers get `{}` (= not answered). Empty is a valid answer.
- **Self-update (AD-1, AD-5):** `grant update (special_brunch_interests) on public.profiles to authenticated`, next to `full_name` and `dietary_notes`. `updateDetails` in `app/me/profile/actions.ts` checks shape (known codes, dedupe, stored in the fixed code order) and writes it with the other details in the same update. No audit row (like `full_name`). ARCHITECTURE-SPINE AD-1 and `security-and-rpc-rules.md` list the new column.
- **`join_complete`:** `create or replace`, same signature. Optional key `special_brunch_interests` in `p_profile`: missing or null → `{}`; otherwise a JSON array of strings, known codes only, no duplicates, else `INVALID_INPUT` with `{"field": "special_brunch_interests"}` (mapped to the form field like the other keys). Stored in code order. The 2.15 admin-fill path stores it the same way. `claim_join` unchanged.
- **Admin reads:** `admin_get_customer` returns `special_brunch_interests`. `admin_list_customers` and `admin_export_customers` get a new last parameter `p_interest text`: null = no filter, else one known code (`INVALID_INPUT` field `interest` otherwise); filter = `p_interest = any(special_brunch_interests)`, AND with activity and search. Export: new column key `special_brunch_interests` in the closed list; the cell is the labels joined with ", " in code order, empty when none. The export audit after-json keeps `interest`. The export follows the screen (5.13 rule): the sheet sends the current `interest`.
- **Signature change (work manager 2026-11-09):** the new list/export signatures are new functions; the migration (no drop, db push by the work manager) creates them with the usual revoke/grant. `p_interest` has no default, and the code always sends it explicitly (null = no filter), so old and new overloads coexist in dev without PostgREST ambiguity (PGRST203) until the drop runs. The two old overloads are dropped in a second, drop-only migration that the user runs in the SQL Editor; the work manager registers it in `schema_migrations`. Code switches to the new signatures in the same PR.
- **`admin_anonymize_customer`:** also sets `special_brunch_interests = '{}'`.
- **Screens** (start with the `frontend-design` skill, within DESIGN.md and EXPERIENCE.md, phone width, logical Tailwind only, no "טל" in copy):
  - Join form, step 1, after the allergies field: a `fieldset` with the question as legend and three checkboxes, none pre-checked, no "(חובה)". Each checkbox: the option title as its label, and the option's hint (when present) as a small line under it, linked with `aria-describedby`. `join-steps.ts` unchanged. Same in the 2.15 admin-fill form.
  - Profile "פרטים": the same fieldset in the details form, current answers checked, saved with the existing save button.
  - One shared component `components/shared/special-brunch-fieldset.tsx` (name, default value, error) for both forms.
  - Customer card: row "בראנצ'ים מיוחדים" with the labels joined by " · ", or "לא סומן" when empty.
  - Customers list: a second chip row under the activity chips ("כל הלקוחות" / "פעילות" / "לא פעילות"), same chip structure, with the row label "בראנצ'ים מיוחדים" and chips "הכול", then one per option label; URL param `?interest=<code>`, combined with `?activity=`. An invalid `interest` param = no filter.
  - Export sheet: checkbox "בראנצ'ים מיוחדים", checked by default like the others; header in `exportHeaders`. When a filter is on, under the existing "בחרת לייצא…" line: "רק מי שסימנה: {label}".
- **Editable content (user 2026-11-09):** the question and the option texts are a content block `join-form › special_brunch`, on the 2.13 `photo_consent` pattern. Flat fields: `question`, `couples_title`, `couples_hint`, `grandma_title`, `grandma_hint`, `grandpa_title`, `grandpa_hint`. A zod schema in `lib/content/schema.ts`: question and titles required (trim, 1–200), hints optional (trim, up to 200; empty = no line). Tal edits text only: the number of options and the codes are fixed; a fourth option needs a migration. Editor fields and preview in the content editor; section label "שאלת הבראנצ'ים המיוחדים" in `lib/copy/admin.ts`.
- **Seed, word for word (user 2026-11-09):** the migration inserts the block into `content_sections` with `draft_content` and `published_content_full` (never `published_content` alone; the trigger derives the public copy):
  - `question`: תרצי שאעדכן אותך על בראנצ'ים מיוחדים?
  - `couples_title`: בראנץ' זוגות; `couples_hint`: את מגיעה עם הבייבי ועם בן או בת הזוג
  - `grandma_title`: בראנץ' עם סבתוש; `grandma_hint`: את מגיעה עם הבייבי ועם סבתא
  - `grandpa_title`: בראנץ' עם סבוש; `grandpa_hint`: את מגיעה עם הבייבי ועם סבא
  - No version bump (not a consent).
- **One reader, one fallback:** a loader in `lib/content/join-form.ts` returns the published block, or a fallback constant identical to the seed when the block is missing or fails the schema. Join form, 2.15 form, profile, card, filter chips and export cells all read option titles through it. The database stores codes only, so editing the text never changes existing answers.
- **Admin copy:** "בראנצ'ים מיוחדים", "לא סומן", "הכול" and "רק מי שסימנה: {label}" in `lib/copy/admin.ts`.

**Never:** push or any group message; editing the answer from the admin customer card (the customer changes it in "פרטים"; work manager 2026-11-09); changes to the photo questions or their content block; changes to the 2.15 flow beyond adding the field; adding, removing or renaming option codes from the editor; a separate table; `drop` in the db-push migration; `demo:seed` / `demo:clear`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Join, two picks | `["grandpa","couples"]` | stored `{couples,grandpa}` | — |
| Join, none | key missing, null or `[]` | stored `{}`, account created | — |
| Join, bad value | `["aunt"]`, `["couples","couples"]`, `"couples"` | no account | `INVALID_INPUT` `special_brunch_interests`, shown on the field in step 1 |
| Profile change | `{}` → couples checked | column updated, other details unchanged | — |
| Direct write, other row | customer updates another profile | 0 rows (RLS) | — |
| Direct write, bad value | `{aunt}` or `{couples,couples}` | rejected | check violation 23514 |
| List filter | `?interest=grandma&activity=inactive` | inactive customers who chose grandma | bad code → `INVALID_INPUT` `interest` (UI sends null instead) |
| Export | `interest=couples`, column checked | only interested customers; cell "<couples label>, <grandpa label>" | — |
| Anonymize | customer with picks | `{}` after removal | — |
| Card, none | `{}` | "לא סומן" | — |
| Text edited | Tal publishes `couples_title` = "X" | form, profile, card, chip and export cell show "X"; stored codes unchanged | — |
| Block missing or invalid | no row, or empty `question` | every screen uses the fallback text | — |

</frozen-after-approval>

## Code Map

Line numbers from origin/main 7da840e; join files moved in 2.15 (4cc8318, merged) — re-grep before editing.
- 2.15 (merged into this branch): it does not redefine `join_complete` (its migrations only add `admin_begin_join_fill` and redefine `token_view`), so the live `join_complete` is still refactor_sweep's. The admin fill renders the same shared `JoinForm` (`app/(auth)/join/[token]/join-form.tsx`) through `FillJoinForm` in `app/admin/(shell)/customers/[id]/entitlements/[entitlementId]/join/fill-outcome.tsx:270-300`; its `page.tsx:101-121` loads the photo block and passes it down — load the special-brunch block there too (and in `app/(auth)/join/[token]/page.tsx`). `submitJoinFillAction` (`.../join/actions.ts:29-59`) → `submitJoinFill` (`lib/server/privileged/join.ts:486`) shares `JoinInput` (:122) and the `p_profile` builder (:421) with `submitJoin`, so one field addition covers both paths. Tests: `.../join/actions.test.ts`, `lib/server/privileged/join.test.ts`, `supabase/tests/admin-join-fill.test.ts`.
- `supabase/migrations/20261022154256_refactor_sweep_db.sql:2776-3040` -- latest `join_complete` (key checks :2871-2892, profiles insert :2956-2968). `:4035-4257` latest `admin_get_customer` (profile json :4235+). `:3741-4027` `admin_anonymize_customer` (`dietary_notes = null` :3945).
- `supabase/migrations/20261020112623_inactive_customers_browse.sql:24-104,110-217` -- latest `admin_list_customers` / `admin_export_customers` (activity check :39, filter :76; columns whitelist :151-156, flags :160-162, output :186-187, grants :103-104,216-217).
- `supabase/migrations/20261001201839_create_join_flow.sql:43` -- the only profiles column grant.
- `app/(auth)/join/[token]/` -- `join-input.ts` (`JoinField` :21-32, `validateJoin` :63, dietary :72,90, output :142), `join-form.tsx` (step 1 :383, dietary :568-580), `actions.ts:59-64` (SQL→form field map). `lib/server/privileged/join.ts` (:127 input type, :400-414 payload). `lib/copy/join.ts` (:24-26, errors ~:92).
- `app/me/profile/` -- `actions.ts:81-105` `updateDetails` (update :98-99), `page.tsx:68` select, `details-section.tsx:116-155`; tests `profile-sections.test.tsx`, `actions.test.ts`. Copy `lib/copy/customer.ts:149-156`.
- `app/admin/(shell)/customers/` -- `[id]/card-items.ts` (`CardProfile` :33-38, `detailRows` :132), `[id]/page.tsx:109-118`; `actions.ts:22-40` `listCustomersAction`; `customer-items.ts` (`CUSTOMER_ACTIVITIES` :40, `parseActivity` :132, `categoryHref` :146); `page.tsx:44-60` params; `customer-live-search.tsx:149-175` chip row; `export-sheet.tsx:146-172` checkbox fieldset (pattern for the new fieldset).
- `lib/admin/customer-export.ts` (`ExportRow` :10, `EXPORT_COLUMNS` :24-31, `parseExportParams` :70, `customersCsv` :176), `app/api/admin/export/route.ts:46-59`, `lib/copy/admin.ts:8-12` `exportHeaders`, `customers.card` :1943.
- Content block pattern (2.13): `lib/content/schema.ts:28-62` (`photoConsentSchema`, `photoConsentQuestion`), `:399` section-key map; `lib/content/join-form.ts:19-23` (loader + `safeParse`); `app/admin/(shell)/content/section-fields.ts:113-120,376-383`; `app/admin/(shell)/content/[slug]/preview/page.tsx:223`; `lib/copy/admin.ts:248` section labels, `:446` editor field labels. Seed pattern and the content trigger: `supabase/migrations/20261007183144_two_photo_consents.sql`, `20261031201729_close_public_read_leaks.sql:8,69`. Tests: `supabase/tests/content.test.ts`, the schema and editor tests next to those files.
- Tests: `supabase/tests/{join,profile,customers,inactive-customers,customers-export,remove-personal-details,grants}.test.ts` (`grants.test.ts:100-101` profiles column grants); existing `join_complete` payloads need no change (key optional). `lib/admin/customer-export.test.ts`, `app/api/admin/export/route.test.ts`, `export-sheet.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_special_brunch_interest.sql` (`npx supabase migration new`) -- column + check, column grant, the content block seed, `join_complete`, `admin_get_customer`, `admin_anonymize_customer`, new `admin_list_customers` / `admin_export_customers` with grants. Applied by the work manager (db push); then `get_advisors`, `generate_typescript_types`.
- [ ] `supabase/migrations/<ts>_special_brunch_interest_drop_old.sql` -- drop the two old overloads only. Main session: the user runs it in the SQL Editor; the main session registers it.
- [ ] `supabase/tests/*` -- matrix rows (join, direct write, list, export, anonymize, card key) + `grants.test.ts` (new column grant, new signatures); a test that the list and export calls through `callRpc` (with explicit `p_interest`) work while the old overloads still exist.
- [ ] `lib/content/schema.ts`, `lib/content/join-form.ts`, `section-fields.ts`, preview, `lib/copy/admin.ts` (+tests) -- schema, loader with fallback (identical to the seed; a unit test compares the fallback to the migration text), editor fields and preview.
- [ ] `components/shared/special-brunch-fieldset.tsx` (+test) -- the shared fieldset, fed by the block (question, titles, hints).
- [ ] Join form files + `lib/server/privileged/join.ts` (+tests) -- field `specialBrunchInterests`, validation, payload, error mapping; also the 2.15 admin-fill form.
- [ ] `app/me/profile/*` (+tests) -- select, fieldset in details, `updateDetails`.
- [ ] Customer card, list (`customer-items.ts`, `actions.ts`, `page.tsx`, `customer-live-search.tsx`), export (`customer-export.ts`, route, `export-sheet.tsx`) (+tests).
- [ ] `ARCHITECTURE-SPINE.md` AD-1, `security-and-rpc-rules.md`, `data-model.md` -- the column and grant. `tickets.toml` E2 id 16 → done (in the PR).

**Acceptance Criteria:**
- Given a customer who chose couples in the join form, when she opens "פרטים", then couples is checked, and after unchecking and saving, Tal's card shows "לא סומן".
- Given Tal filters the list by סבתוש and exports with the filter, then the file has only those customers and the new column.

## Spec Change Log

- 2026-11-09 (user, via the work manager; small change to the frozen spec with her approval): `couples_hint` is "את מגיעה עם הבייבי ועם בן או בת הזוג" (was empty), not "אמא" / "אבא", since couples may be two women. Seed, fallback and the test that compares them follow. Tal can edit it later.
- 2026-11-09 (user, via the work manager): no wait for 2.15's merge. Build after the work manager's go, once 2.15's branch is pushed; merge it into this branch. 2.15's migration is already on dev. The main migration is applied by the work manager; the drop file is run by the user later, and both overloads coexist until then. `test:db` only with the work manager's go and never in parallel with 2.15. Commit and push to this branch with his go; the PR opens only after 2.15 is merged.
- 2026-11-10 (main session, typography only): the seed, the fallback and every new copy string use the Hebrew geresh ׳ ("בראנץ׳", "בראנצ׳ים"), as the rest of the site does, instead of the ASCII apostrophe in the frozen text. No word changes.
- 2026-11-10 (work manager approved, build decisions): (1) "פרטים" in view mode shows a read-only row "בראנצ׳ים מיוחדים" with the chosen titles, or "לא סומן. אפשר לבחור בלחיצה על עריכה" when empty, so the customer sees her answer without opening edit. (2) On the customers list a search of 2+ characters ignores the interest filter, as it already ignores the activity category; the RPCs still AND the filter with the search, but the screen never sends both.

## Review Triage Log

**Pass 1 (blind, edge-case, verification-gap, intent-alignment).**

| # | Finding | Verdict | Route | Evidence and action |
|---|---|---|---|---|
| 1 | Export route reads the wording after the RPC wrote its audit row, and always; a throw = unhandled 500 + logged export with no file (blind, edge) | medium | patch | Read before the RPC, only when the column is chosen; failure → `{code:"SERVER_ERROR"}` 500, no RPC; route tests |
| 2 | Audit history shows raw `special_brunch_interests`, `interest` and codes (blind) | medium | patch | Field and value labels in `lib/copy/admin.ts`; `audit-data.test.ts` |
| 3 | No test that the "פרטים" save sends the checked codes or that edit mode shows saved codes (VG) | medium | patch | Pure `detailsInput(formData)` + tests; edit-mode render test |
| 4 | No test for the content loader fallback (VG) | medium | patch | `lib/content/join-form.test.ts`: valid, missing, invalid, read error |
| 5 | List filter wiring in `CustomerLiveSearch` untested (VG) | medium | patch | `customer-live-search.test.tsx`: hrefs keep `interest`, `aria-current`, labels from content |
| 6 | 2.15 `submitJoinFill` payload not tested (blind, intent) | medium | patch | `join.test.ts` case, codes in order |
| 7 | Overload-coexistence test calls only as anon (edge) | medium | patch | Admin signed in over PostgREST calls both RPCs with null and a code, expects success |
| 8 | Profile view joins with ", ", card with " · " (blind) | low | patch | " · " on screens |
| 9 | Error id only on the `<fieldset>` (blind) | low | patch | Also on each checkbox's `aria-describedby`, with `aria-invalid` |
| 10 | `lib/errors.ts` field comment misses the new fields (blind) | low | patch | Comment updated |

Rejected (8): publishing the join-form page bumps `published_version`, so editing this block gives later joiners a new photo-consent text version (blind, edge) — the version identifies the page snapshot, the consent wording per version stays recoverable from the audit log, no customer- or Tal-facing harm; raised to the work manager. Loader throws on a read error and breaks the pages (blind, edge) — the same pages already read the same database and fail on it anyway. `grants.test.ts` fails until the drop runs (blind, edge, VG) — planned; rerun after the user's drop. 2-D array passes the check (blind) — only by a customer's deliberate API write to her own row, display-only effect; fix is a new constraint. Duplicated `null as unknown as string` cast (blind) — two call sites, no harm. Editor shows the block after the photo questions (blind) — cosmetic, editor only; needs a data migration. `validateJoin` dedupes instead of rejecting duplicates (edge) — checkboxes cannot send duplicates; `join_complete` rejects them (db test). Ticket "done" vs spec status (blind) — both set at closing.

## Design Notes

**Array + check, not a table:** three fixed options, read as one value per customer; a column is filterable with `= any(...)`, fits the existing column-grant self-update, and needs no new RLS. A new option later = a migration that widens the check, plus a schema field and seed text.

**Publishing this block bumps the join-form `published_version` (work manager 2026-11-10, kept):** the version identifies the page snapshot, which the photo consents record; every snapshot's wording is kept in the audit log, so a new version with unchanged photo wording harms nothing.

**Title + hint, not one line:** the source line "בראנץ' עם סבתוש - את מגיעה עם הבייבי ועם סבתא" is split at the dash into a checkbox label and a small line under it (work manager's proposal, accepted); no word changes. Short titles fit the filter chips and export cells.

## Verification

**Commands:**
- `npm run test:db` (with the work manager's go) -- green, incl. `grants.test.ts`.
- `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` -- green.
- `get_advisors` (security) -- only the approved WARNs.

**Manual checks:**
- Phone: pick in the join form (customer and 2.15 admin path), change in "פרטים", card row, list filter, export column in the downloaded file.
