---
title: "Fix 24: the admin work windows stay above the phone keyboard"
status: done
date: 2026-11-01
---

# Fix 24: the admin work windows stay above the phone keyboard

## Problem

`fixes-log.md` row 24 (6.7 phone check, MU2): on the work sheet (`/admin/sessions/[id]/work`), "+ פריט" on a Samsung S26+ (Android Chrome). With the keyboard open the text box shows, but the confirm button "הוספה" is under the keyboard and Tal has to scroll to reach it.

## Cause

Since Chrome 108 Android's default is `interactive-widget=resizes-visual` (iOS Safari behaves the same): the keyboard shrinks only the visual viewport, while `position: fixed; bottom: 0` stays on the bottom of the layout viewport. `WorkPanel` (`components/admin/edit-kit.tsx`) is such a bottom sheet, so its lower part, the form's submit button, sits under the keyboard; Chrome only pans the focused field into view. The sheets that passed in MU2 (booking, "ביטול ההרשמה") have the same structure but no text field, so the keyboard never opens over them; login and profile edit are in-page forms, not fixed sheets.

## Fix (chosen)

Local, in `WorkPanel`, so every window built on it is covered: "+ פריט", the item window, "+ מנה" and the dish window, the task window, the prep-day windows, the notes windows (`/admin/notes`) and the export sheet (no field, unaffected).

- `components/shared/use-keyboard-inset.ts`: `keyboardInset()` (pure) measures the layout viewport's part below the visual one (`documentElement.clientHeight - visualViewport.height - offsetTop`); under 100px (a browser bar) or with a pinch zoom (`scale > 1.01`) it is not a keyboard. `useKeyboardInset(open)` listens to `visualViewport` resize and scroll while the window is open.
- `WorkPanel`: while the keyboard is open the sheet gets `bottom` = the keyboard's height and `maxHeight` = 90% of the visible area (DESIGN › bottom-sheet's 90vh, of what is left); it already scrolls inside. When the keyboard opens with a field in the sheet focused, the field's form submit button is scrolled into view (`block: "nearest"`, `scroll-mb-6` so the sheet's bottom padding shows). No copy, colour or type change.

## Alternatives rejected

- `viewport.interactiveWidget: "resizes-content"` in the root layout: one line, but global. It re-lays out every page whenever a keyboard opens (all `vh`/`svh`/`dvh` sizes shrink: the auth layout's `min-h-svh`, the admin shell's `100svh`, cookie notice `60svh`, image fields), and lifts every fixed bottom element (customer and admin `bottom-tab-bar`, cookie notice, offline banner) above the keyboard on any page with a field, which the 6.7 checks did not cover. It is also ignored by iOS Safari, where the local fix works too.
- Shrinking the 6-row text box with the keyboard open: not needed; at 430px and at 360px visible the field and the button both show.

## Files

- `components/shared/use-keyboard-inset.ts` (new)
- `components/admin/edit-kit.tsx` (`WorkPanel`, `keyboardStyle`, the panel class)
- `app/admin/(shell)/sessions/[id]/work/work-screens.test.tsx` (4 tests: no keyboard, a 414px keyboard and its style, a panned page, a browser bar and a pinch zoom)

## Verification

- Browser (playwright-core + installed Chrome, 390×844, mobile emulation, local dev server, dev admin; read-only, no confirm pressed). Android's keyboard simulated with a fake `visualViewport` (layout viewport kept at 844, visual shrunk). Keyboard 414px (430 visible): "+ פריט" sheet 67–430, field 176–320, "הוספה" 358–406; "+ מנה" field 298–346, button 358–406; item window field 162–210, button 222–270; "+ פתק" (notes) field 201–315, button 358–406. Keyboard 484px (360 visible): "+ פריט" field 105–249, button 288–336 (sheet scrolled inside). Without the keyboard the button sits at 772–820, i.e. under a 414px keyboard before the fix.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build`.
- Left open: a real phone check (S26+) after the merge. The inline "+ משימה" form in a dish card is in the page flow, not a `WorkPanel`, and was not reported; the customer `companion-note` sheet has a textarea in the same kind of fixed sheet and could reuse `useKeyboardInset` if it shows the same problem.
