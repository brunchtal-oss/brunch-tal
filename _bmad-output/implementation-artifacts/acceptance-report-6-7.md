# Acceptance report 6.7: cancellation, notifications, content, screens, accessibility

- **Date:** 2026-10-30
- **Base commit:** `3cf485d` (branch `story-6-7-acceptance-suite-rest`; the runs were made on the story's changes before a commit)
- **Full `npm run test:db` (including `grants.test.ts`):** 77/77 files, 1412/1412 tests pass (2026-10-30, planning session). Cleanup dry run before and after: "אין נתוני בדיקה במסד". Per-file runs of the new files (`npx vitest run --project db <file>`, one at a time, 2026-10-30): all pass, see the table below.
- **`npm test`:** 231 files, 3107 tests, all pass (2026-10-30, after the review patches; 3062 before them: T22 +1, T23 +43, T21 +1).
- **`test_` leftovers:** `node scripts/dev-clean-test-data.mjs` (dry run) after the per-file runs: "אין נתוני בדיקה במסד".
- **Other checks:** `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` pass.
- Source of the clauses: the SPEC's `acceptance-criteria.md`. The full coverage map (claim → test) is in `spec-6-7-acceptance-suite-rest.md`, section Coverage map.
- No new test failed, so no product code was changed and no migration was written. No test counts a whole table (T4 and the job tests count only the rows of their own transaction or their own ids).

## Results per file

| File | Tests | Result |
|---|---|---|
| [acceptance-cancellation.test.ts](../../supabase/tests/acceptance-cancellation.test.ts) | 3 (T1, T2a, T2b) | pass |
| [acceptance-notifications.test.ts](../../supabase/tests/acceptance-notifications.test.ts) | 9 (T3a, T3b, T4–T9, and the queue check's positive control) | pass |
| [acceptance-content-values.test.ts](../../supabase/tests/acceptance-content-values.test.ts) | 8 (T10, T12–T14, T15 ×2, T16, T17) | pass |
| [empty-content.test.tsx](../../components/public/empty-content.test.tsx) | 4 (T19: home, how it works, gallery, contact) | pass |
| [no-hardcoded-contact.test.ts](../../test/no-hardcoded-contact.test.ts) | 3 (T20 and two checks of the scan itself) | pass |
| [push-permission-on-click.test.ts](../../test/push-permission-on-click.test.ts) | 3 (T21) | pass |
| [app/me/sessions/[id]/page.test.tsx](<../../app/me/sessions/[id]/page.test.tsx>) | 9 (5 existing + T22 ×4) | pass |
| [app/globals.test.ts](../../app/globals.test.ts) | 105 (35 existing + T23 ×70) | pass |

T11 and T18 are not written here: they ship with the `fix-public-read-leaks` PR (spec-gate decision 1, deferred-work item of spec 6.7).

Notes on the new tests:

- **T2a** (a self-cancel with "refund") gives a credit with no options at all, so it proves only the end state (nothing is bookable with it; its options are asserted `[]`). The proof that a `refund_requested` status blocks a credit that still has active options is **T2b** (Tal's `admin_refund_credit` leaves the options listed).
- **The pg_net queue check** (every job test: T3–T9): each test marks the highest `net.http_request_queue` id at its start. Inside the transaction it counts the rows above the mark whose writer is still in progress, so a row written in a subtransaction (a plpgsql exception block, a savepoint) counts too, and a row the minute's cron commits meanwhile does not. After the rollback it checks that no committed row above the mark wakes the push worker (url `/api/jobs/push`; the worker's body is always `{}`) or names the test's ids. A positive control calls the real `private.invoke_push_worker()` (the dev Vault has `app_url` and `cron_secret`) inside a rollback, once directly and once in an exception block: the check sees both, and nothing is committed. Risk: if a real push job is ready in dev while a job test runs, the cron's own wake-up could show up in the after-rollback check.
- **T3** runs twice: a direct move of the session, and Tal's `admin_reschedule_event`. In both the revision rises at each move, no reminder is sent while the session is 72 hours out, and one reminder with the new revision's key is sent when it is back at 23 hours.
- **T4** uses the reminder (a push type; `booking_confirmed` has no push) of a customer with a real subscription. The job is claimed and finished `HTTP_500` on its 5th attempt (`failed`). The booking (status, event, party, cancel time), its allocation, the card's balance, the occupancy and the notification row are equal before and after. Nothing in the transaction wrote to `net.http_request_queue` (the queue check above).
- **T5**: with 10 days left both thresholds are reached: after the first run exactly one `card_expiring` for her and one `admin_card_expiring` for this admin; the second run returns 0 and both are still one.
- **T7** alerts at 3 days left, then extends by 7 days with `admin_correct_entitlement` to 10 days left (the spec's "alerts at 10 days, then ≤10 days on the new date" cannot move the clock; this reaches the same state). New `card_expiring` and `admin_card_expiring` keyed by the new date; the old keys stay once each; a third run adds nothing.
- **T9** reads the defaults from `pg_attrdef` (2 and 24), sets the live row to 3 and 6, resets both with `= default`, and gets 2 and 24 back; a pinned booking made then has `reminder_lead_hours` 24 in its snapshot, and its credit gets `options_count` 2 and exactly the next two sessions.
- **T10** also asserts that no column of a public table or view is `numeric`, `real`, `double precision` or `money` (none today).
- **T14** runs with `set local timezone = 'UTC'`, so the audit's timestamptz text does not depend on the connection.
- **T12**: the audit row of the approval is `approve_payment` on `payments` (written by `private.approve_payment_core`), with `amount_agorot` 44000 and `product_snapshot.price_agorot` 47200. The next preview of the same product shows 47200, and 44000 is again a changed price (`price_changed`). The preview needs an amount (null is `INVALID_INPUT`).
- **T20** scans every line, comments included, for an Israeli phone (also `(054)`), a 1-700/1-800 number, `wa.me/<number>`, `api.whatsapp.com/send?…phone=` and `whatsapp://send?…phone=`; each pattern has its own self-test cases. Allowed exceptions, exact text per file, checked by eye: `lib/copy/admin.ts` (the legal editor's hint shows a link example `[054-0000000](tel:+972540000000)`, a made-up number); `lib/phone.ts` (made-up examples in the formatter's doc comment); `components/public/legal-views.tsx` (`054-425-6456`, the display format in the comment of `displayPhone`, which looks like the business number). That last one is a comment (not shown, not linked); worth a look by the user since the repo is public until launch. No product code changed.
- **T21** also guards `pushManager.subscribe` (it can prompt too): it appears only in `lib/push/client.ts`, inside `ensureSubscription`; that is called outside the tests only from `enable()` of the push card and from `push-sync.tsx` after its `currentPushState() !== "on"` return ("on" needs the permission granted: `lib/push/client.test.ts:33`). Every identifier use of `enable` in the card is its declaration or `onEnable={enable}`.
- **T22** renders a couple session in four states, including booked with her couple booking (the companion note shows). None shows "זוגי", "זוגית", "זוגיים", "רגיל" or "לשני מבוגרים".
- **T23** reads every colour from `app/globals.css` itself. Text tokens on background, card, muted, secondary, accent and popover; primary-, popover-, secondary- and accent-foreground on their surfaces; each status colour on its tint. There is no `--destructive-foreground` token. Lowest ratios: warning on its tint 4.64:1, warning on muted 4.79:1, muted-foreground on muted 5.01:1; the rest are higher. brand-accent is excluded (graphics only); its on-screen use is MA3.

## How the existing coverage was checked

Every C row of the coverage map was reopened row by row: a script printed the line each reference points at (199 references), and the it() at that line, or the one around it, was read to confirm its assertions prove the claim and do not only check that nothing was thrown. 189 references point at the it() line itself. The other 10 point near it, with no effect on the result:

- NT5 `business-settings.test.ts:40` is the comment above the it() at line 41.
- PC5 `sensitive-confirm-dialog.test.tsx:38` is inside the it() at line 37.
- SC1 `self-booking.test.ts:767` is the end of the previous describe; the anon refusal is the it() at line 772.
- SC1 `couple-and-intro.test.ts:722` is inside the it() at line 718.
- SC6 `join.test.ts:208` is the describe; the it() is at line 209.
- SC7 `concepts-admin.test.ts:455` is inside the it.each at line 451.
- SC10 `eslint-rules.test.ts:263` is the describe "RTL classes"; its it.each starts at line 265.
- SC10 `lib/site-lock.test.ts:256` is inside the it() at line 249 (the lock page). The site's root layout (`app/layout.tsx`, `lang="he"` with `dir="rtl"`) has no unit test; MA1 checks `<html dir="rtl">` on every page.
- SN1 `lib/push/client.test.ts:30` is the describe; the it.each is at line 31.
- SN4 `audit-viewer.test.ts:186` is inside the helper `expectNoHiddenKey` (line 179), used by the its at lines 467, 1119, 1138.

## Results per clause

Legend (the number after the colon is the it() line; T1–T23 are the new tests, in the files of "Results per file"). All files are in `supabase/tests/` unless a path is given.

| Short | File |
|---|---|
| CB | [cancel-booking.test.ts](../../supabase/tests/cancel-booking.test.ts) |
| CC | [cancellation-credits.test.ts](../../supabase/tests/cancellation-credits.test.ts) |
| BUS | [business-cancel.test.ts](../../supabase/tests/business-cancel.test.ts) |
| RC | [refund-completion.test.ts](../../supabase/tests/refund-completion.test.ts) |
| MV | [move-booking.test.ts](../../supabase/tests/move-booking.test.ts) |
| CA | [credit-adjustments.test.ts](../../supabase/tests/credit-adjustments.test.ts) |
| MBF | [manual-booking-funding.test.ts](../../supabase/tests/manual-booking-funding.test.ts) |
| EP | [eligible-products.test.ts](../../supabase/tests/eligible-products.test.ts) |
| TP | [time-and-phone-helpers.test.ts](../../supabase/tests/time-and-phone-helpers.test.ts) |
| BS | [business-settings.test.ts](../../supabase/tests/business-settings.test.ts) |
| ST | [settings-and-templates.test.ts](../../supabase/tests/settings-and-templates.test.ts) |
| SR | [session-reminders.test.ts](../../supabase/tests/session-reminders.test.ts) |
| SJ | [scheduled-jobs.test.ts](../../supabase/tests/scheduled-jobs.test.ts) |
| MK | [marketing-reminders.test.ts](../../supabase/tests/marketing-reminders.test.ts) |
| NC | [notification-centers.test.ts](../../supabase/tests/notification-centers.test.ts) |
| NO | [notifications.test.ts](../../supabase/tests/notifications.test.ts) |
| IC | [inactive-customers.test.ts](../../supabase/tests/inactive-customers.test.ts) |
| RPD | [remove-personal-details.test.ts](../../supabase/tests/remove-personal-details.test.ts) |
| PR | [profile.test.ts](../../supabase/tests/profile.test.ts) |
| PCAT | [product-catalog.test.ts](../../supabase/tests/product-catalog.test.ts) |
| RP | [repeat-purchase.test.ts](../../supabase/tests/repeat-purchase.test.ts) |
| CE | [customers-export.test.ts](../../supabase/tests/customers-export.test.ts) |
| CP | [content-publish.test.ts](../../supabase/tests/content-publish.test.ts) |
| CT | [content.test.ts](../../supabase/tests/content.test.ts) |
| MD | [media.test.ts](../../supabase/tests/media.test.ts) |
| EC | [entitlement-corrections.test.ts](../../supabase/tests/entitlement-corrections.test.ts) |
| EVA | [events-admin.test.ts](../../supabase/tests/events-admin.test.ts) |
| PS | [public-sessions.test.ts](../../supabase/tests/public-sessions.test.ts) |
| SB | [self-booking.test.ts](../../supabase/tests/self-booking.test.ts) |
| CI | [couple-and-intro.test.ts](../../supabase/tests/couple-and-intro.test.ts) |
| G | [grants.test.ts](../../supabase/tests/grants.test.ts) |
| WS | [work-sheet.test.ts](../../supabase/tests/work-sheet.test.ts) |
| SH | [shopping-items.test.ts](../../supabase/tests/shopping-items.test.ts) |
| NOTE | [notes.test.ts](../../supabase/tests/notes.test.ts) |
| CON | [concepts-admin.test.ts](../../supabase/tests/concepts-admin.test.ts) |
| J | [join.test.ts](../../supabase/tests/join.test.ts) |
| OC | [open-cards.test.ts](../../supabase/tests/open-cards.test.ts) |
| CU | [customers.test.ts](../../supabase/tests/customers.test.ts) |
| AUD | [audit-viewer.test.ts](../../supabase/tests/audit-viewer.test.ts) |
| LL | [link-lifecycle.test.ts](../../supabase/tests/link-lifecycle.test.ts) |
| RS | [reset.test.ts](../../supabase/tests/reset.test.ts) |
| TM | [lib/time.test.ts](../../lib/time.test.ts) |
| MO | [lib/money.test.ts](../../lib/money.test.ts) |
| PSEC | [app/me/profile/profile-sections.test.tsx](../../app/me/profile/profile-sections.test.tsx) |
| SCD | [components/admin/sensitive-confirm-dialog.test.tsx](../../components/admin/sensitive-confirm-dialog.test.tsx) |
| CX | [lib/admin/customer-export.test.ts](../../lib/admin/customer-export.test.ts) |
| RT | [app/api/admin/export/route.test.ts](../../app/api/admin/export/route.test.ts) |
| PV | [components/public/page-views.test.tsx](../../components/public/page-views.test.tsx) |
| OF | [components/public/optional-fields.test.tsx](../../components/public/optional-fields.test.tsx) |
| HH | [components/public/home-hero.test.tsx](../../components/public/home-hero.test.tsx) |
| LP | [lib/content/pages.test.ts](../../lib/content/pages.test.ts) |
| CACT | [app/admin/(shell)/content/actions.test.ts](<../../app/admin/(shell)/content/actions.test.ts>) |
| BD | [lib/content/business-details.test.ts](../../lib/content/business-details.test.ts) |
| PSH | [components/public/public-shell.test.tsx](../../components/public/public-shell.test.tsx) |
| VCR | [components/admin/value-change-row.test.tsx](../../components/admin/value-change-row.test.tsx) |
| SD | [app/admin/(shell)/sessions/session-draft.test.ts](<../../app/admin/(shell)/sessions/session-draft.test.ts>) |
| SET | [app/admin/(shell)/settings/settings-draft.test.ts](<../../app/admin/(shell)/settings/settings-draft.test.ts>) |
| PUBS / PSX | [components/public/public-sessions.test.tsx](../../components/public/public-sessions.test.tsx) |
| SF | [app/admin/(shell)/content/section-fields.test.ts](<../../app/admin/(shell)/content/section-fields.test.ts>) |
| CS | [app/admin/(shell)/content/content-screens.test.tsx](<../../app/admin/(shell)/content/content-screens.test.tsx>) |
| SST | [app/me/sessions/session-status.test.ts](../../app/me/sessions/session-status.test.ts) |
| WSX | [app/admin/(shell)/sessions/[id]/work/work-screens.test.tsx](<../../app/admin/(shell)/sessions/[id]/work/work-screens.test.tsx>) |
| SM | [app/admin/(shell)/sessions/[id]/work/shopping-message.test.ts](<../../app/admin/(shell)/sessions/[id]/work/shopping-message.test.ts>) |
| NS | [app/admin/(shell)/notes/notes-screens.test.tsx](<../../app/admin/(shell)/notes/notes-screens.test.tsx>) |
| PC | [components/shared/push-card.test.tsx](../../components/shared/push-card.test.tsx) |
| PCL | [lib/push/client.test.ts](../../lib/push/client.test.ts) |
| OB | [components/shared/online-button.test.tsx](../../components/shared/online-button.test.tsx) |
| SW | [test/sw.test.ts](../../test/sw.test.ts) |
| HI | [app/admin/(shell)/home-items.test.ts](<../../app/admin/(shell)/home-items.test.ts>) |
| RSU | [lib/server/privileged/reset.test.ts](../../lib/server/privileged/reset.test.ts) |
| LV | [components/public/legal-views.test.tsx](../../components/public/legal-views.test.tsx) |
| ESL | [test/eslint-rules.test.ts](../../test/eslint-rules.test.ts) |
| SL | [lib/site-lock.test.ts](../../lib/site-lock.test.ts) |

### ביטול, זיכוי והחזר

| Clause | Result | Proof |
|---|---|---|
| CN1 ביטול עצמי עד 48 שעות; אדמין יכולה לבטל גם בתוך החלון | עובר | CB:286, CB:315, TP:28, CB:475, CC:556 |
| CN2 ביטול ביום א׳ של מפגש ביום ה׳; ביטול עצמי של מוצמד ≥48h יכול לבחור החזר | עובר | CC:317, CC:707, CC:388. Counted from the cancelled session (see wording notes) |
| CN3 רק מפגשים מתאימים, עם מקום פנוי במועד יצירת הזיכוי; N מההגדרות, ברירת מחדל 2 | עובר | CC:528, EP:425, EP:971, CC:745, CC:826, CC:1252, MBF:259, CC:900; T1, T9 |
| CN4 היא ממלאת את המקום האחרון; ביטול של העסק מחליף אפשרות | עובר | CC:776, BUS:624, CC:880 |
| CN5 בקשת החזר מבטלת את מימוש הזכות; לא שולם לפני אישור טל; לא מעל הסכום המקורי | עובר | CC:388, RC:580, RC:344, RC:358, RC:934; T2a, T2b |
| CN6 הזזה שנכשלה בגלל תפוסה משאירה את ההרשמה המקורית. ביטול משחזר בדיוק את מקור הזכאות ולא מעניק כניסה נוספת | עובר | MV:479, CB:352, CC:489, CC:826, CC:1167, MV:652, CB:373, CB:389, CC:337 |

### התראות ומשימות

| Clause | Result | Proof |
|---|---|---|
| NT1 התזכורת (ברירת מחדל 24 שעות לפני) נשלחת פעם אחת בלבד... שינוי זמן התזכורת בהגדרות לא משנה תזכורות של הרשמות קיימות | עובר | SR:241, SR:269, SR:445, SR:252, SR:385, SR:456, BUS:763, SR:334, SR:358, SR:304, ST:313; T3a, T3b, T9 |
| NT2 כשל פוש לא מבטל הרשמה | עובר | T4 |
| NT3 הודעה כללית מגיעה פעם אחת לכל נמענת | הוחלף בהחלטה | SPEC memlog:310 (user decision 2026-10-20, 5.12 cancelled: no broadcast). NO:352 (the template seed has no broadcast type) |
| NT4 טל 21 ימים לפני, הלקוחה 10 ימים לפני, כל אחת פעם אחת; שוריינו או נוצלו: אין התראה; אחרי הארכה שוב לפי התפוגה החדשה | עובר | SJ:235, SJ:262, SJ:329; T5, T6, T7 |
| NT5 תזכורת שיווק בימים א׳, ג׳, ד׳ ב-09:00 ובימים ב׳, ה׳ ב-20:00... פעם אחת בכל מועד, עם נוסח אחר; לקוחה לא רואה, גם ב-API | עובר | BS:41, MK:283, MK:166, MK:194, MK:466, NC:137; T8. Days and times are editable; the clause's schedule is the default (memlog:312) |

### פרופיל, פעילות ותוכן

| Clause | Result | Proof |
|---|---|---|
| PC1 כמה תינוקות, גיל 0, וחיסור חודשים בסוף חודש; בלי כתיבה יומית | עובר | PSEC:28, PR:305, TM:29 (fixed dates). The age is the pure `babyAge`; `babies` stores only `birth_date` |
| PC2 אין סימון "לא פעילה" עם הרשמה, זכות או החזר פתוחים; ממועד יצירת החשבון; לא מוחק | עובר | IC:325, IC:335, IC:396, IC:282, IC:445 |
| PC3 אחרי הסרת פרטים לא נשאר מידע מזהה, וסיכומי הכסף לא משתנים | עובר | RPD:221, lib/server/privileged/anonymize.test.ts:99 |
| PC4 יבוא | הוחלף בהחלטה | completion-plan:44 (user decision 2026-10-22, 6.2 cancelled) |
| PC5 פעולה רגישה לא מתבצעת בלי סימון הצ׳קבוקס. שדה סיבה ריק לא חוסם אותה | עובר | SCD:24, SCD:37, PCAT:180, EC:325, RPD:758, RP:302 |
| PC6 ייצוא חלקי: רק השורות המסוננות; רק אדמין מייצאת | עובר | CE:127, IC:543, CE:346, RT:90, CX:112 |
| PC6 "ואת העמודות שנבחרו" | הוחלף בהחלטה | completion-plan:22 (user decision 2026-10-13): fixed columns name, phone, email; CX:112 proves only those are written |
| PC7 סכומים מוצגים בשקלים (₪), ונשמרים באגורות בלי עיגול שגוי | עובר | MO:6, RP:618, MO:19, MO:32; T10 |
| PC8 עריכת תוכן נשארת טיוטה עד הפרסום; סקשן או פריט מוסתר לא מוצג בעמודים | עובר | CP:148, CT:92, PV:20, LP:87, MD:527 |
| PC8 "תוכן מוסתר לא דולף לנתיב ציבורי" (פריט מוסתר דרך ה-API) | לא עובר: תיקון מתוזמן | Spec-gate decision 1: a hidden item inside a published section is readable by anon through the API. Fix and T11 in `fix-public-read-leaks`, after 6.7 and before 6.1 (deferred-work, item of spec 6.7) |

### ערכים ותוכן שנערכים באדמין

| Clause | Result | Proof |
|---|---|---|
| AV1 אין תוכן שיווקי מקודד... שינוי שפורסם מופיע בלי פריסה. בלוק בלי תוכן שפורסם לא מוצג | עובר (+ MA11 עובר) | CACT:322, CACT:339, LP:44, CT:116, OF:53, HH:15, PV:106; T19. MA11 compares the live pages with the published content |
| AV2 שינוי מספר הוואטסאפ או הכתובת בפרטי העסק משנה כל קישור ותצוגה; שינוי תבנית משנה רק התראות חדשות | עובר | BD:71, PSH:125, ST:533; T20 |
| AV3 שינוי ברירת מחדל לא משנה זכות, הרשמה או מפגש שכבר קיימים | עובר | PCAT:70, ST:247, ST:313 |
| AV4 שינוי למקרה מסוים... נרשם ביומן עם ערך קודם וחדש, חל רק על אותו מקרה | עובר | EC:209, EVA:257; T12 (amount), T13 (balance, weekdays), T14 (close time, display price). Balance: the audit log records the movement (−2, "הורדו 2 כניסות"); the old and new value are kept in `entitlement_corrections` and shown to Tal in "היסטוריית תיקונים" on the card's page (3.13 design, spec-3-13:39). All the information exists and Tal sees it; no code change (planning session decision 2026-10-30) |
| AV4 "סוג מפגש בזכות", "סימון השתתפות בעבר" | הוחלף בהחלטה | spec-3-13:108 (user decision 2026-10-19: a card's kind never changes); completion-plan:8, :44 (no past-participation mark) |
| AV5 תיקון בזכות לא מתבצע בלי צ׳קבוקס; הרשמה אחרי תיקון לפי הערכים המתוקנים; הלקוחה מקבלת התראה | עובר | EC:325, EC:518, EC:302, EC:209, EC:387 |
| AV6 חלון האישור מציג את רשימתן לפני האישור, ואחרי האישור הן נשארות בדיוק כפי שהיו | עובר (+ MA12 עובר) | EC:518, EC:618 (the preview's `affected`); T15 ×2. The dialog itself: MA12 |
| AV7 שינוי מכסה, מועד סגירה או מחיר תצוגה, ושינוי בהגדרות הכלליות: ישן ← חדש, בלי צ׳קבוקס, ונרשמים ביומן | עובר | VCR:33, SD:265, SD:279, SD:286, SET:74, SET:83, EVA:257, ST:247; T14 |
| AV8 ההודעה והכפתור אחרי הצטרפות או רכישה | הוחלף בהחלטה | UX memlog:143 (user decision 2026-10-06: no messages on her home). The fields still editable in the product editor: deferred-work, target before 6.4 |
| AV9 מחיר תצוגה במפגש מוצג בעמוד המפגש ולא משנה סכום בתשלום או בזכות | עובר | PUBS:161, PUBS:174; T16 |
| AV10 תמונה לא מתפרסמת בלי טקסט חלופי, ותמונה מזוהה לא בלי סימון הסכמה | הוחלף בהחלטה | UX memlog:140 (user decision 2026-10-05) |
| AV11 המלצה נוספת כטקסט או כתמונה, ונערכת, נמחקת, מסודרת ומוסתרת | עובר | SF:257, CS:384, SF:172, SF:149, PV:20. The alt-text part as AV10 |

### מסכים חדשים ותצוגה

| Clause | Result | Proof |
|---|---|---|
| SC1 באתר הציבורי אין שום נתון תפוסה, גם לא ב-API; "יש מקום", "מקומות אחרונים" או "מלא"; זוגי עם מקום אחד: "מלא" | עובר (+ MA5 עובר) | PS:115, PS:155, G:426, SB:772, PSX:63, PSX:86, PSX:161, SB:725, CI:718, SST:36 |
| SC2 אין תפריט במפגש, לא באתר ולא באזור האישי | עובר (+ MA4 עובר) | EVA:933 (no `events.menu`); MA4 |
| SC3 יום ה׳: עמודות ד׳ וה׳; יום ב׳: א׳ וב׳; "+ יום הכנה" רק למפגש הזה; עמודה ריקה לא מודפסת | עובר | WS:127, WS:151 (fixed dates), WS:182, WSX:522 |
| SC4 הדפסת דף העבודה כוללת...; ייצוא רשימת הקניות פותח וואטסאפ עם הפריטים שעוד לא נקנו | עובר (+ MA9 עובר) | WSX:522, WSX:548, WSX:153, SM:41, SM:63, WSX:269. The browser's print preview: MA9 |
| SC5 לקוחה לא יכולה לקרוא דף עבודה, פתקים | עובר | WS:584, WS:671, SH:373, NOTE:488 |
| SC5 "או קונספטים בארכיון, גם בפנייה ישירה ל-API" | לא עובר: תיקון מתוזמן | Spec-gate decision 1: `concepts_public_select using (true)` (20261004145805_concepts_and_events.sql:163). Fix and T18 in `fix-public-read-leaks` (deferred-work, item of spec 6.7) |
| SC6 אפשר להצטרף בלי אישור תמונות; נשמר עם מועד וגרסה; משתנה בפרופיל | עובר | J:209, PR:358, PR:455, PSEC:181, app/me/profile/actions.test.ts:285 |
| SC7 "עם סבתוש" זוגי עם מכסה 14; שינוי שדה במפגש לא משנה את הקונספט; קונספט עם מפגשים לארכיון | עובר | EVA:134, EVA:944, CON:451, CON:380; T17 |
| SC7 "וערכת העיצוב של הקונספט" | הוחלף בהחלטה | UX memlog:131 (user decision 2026-10-04: concept colours dropped) |
| SC8 מסך הכרטיסיות הפתוחות... תואם את מסך היתרה; 3+1 מופיעה; יורדת אחרי הרביעי ובתפוגה; לקוחה לא ניגשת | עובר | OC:260, OC:305, OC:288, OC:324, CU:535, OC:450 |
| SC9 כל פריט חדש ניתן להוספה, עריכה ומחיקה או ארכיון | עובר | WS:436, WS:182, WS:221, WS:287, SH:125, SH:236, SH:297, NOTE:182, NOTE:394, NOTE:258, NOTE:285, CON:172, CON:310, CON:380, CON:425, SF:257, SF:149 |
| SC9 "נושא" | הוחלף בהחלטה | SPEC memlog:313 (user decision 2026-10-21) |
| SC10 נבדקים: תצוגת טלפון, RTL, מקלדת, ניגודיות וקורא מסך | עובר בקוד (+ MA1, MA2, MA3 עוברים; MU1, MU2 ממתינים) | ESL:265, SL:249; T23. The phone, keyboard and screen-reader parts are manual only |

### השלמות › התראות, PWA ואדמין

| Clause | Result | Proof |
|---|---|---|
| SN1 בקשת הרשאת פוש מופיעה רק אחרי הסבר ולחיצה של הלקוחה. מי שסירבה לא נשאלת שוב | עובר (+ MA10 עובר) | PC:30, PCL:31, PCL:98, PCL:130, PC:58, PC:65; T21 |
| SN2 בלי חיבור אי אפשר להירשם או לבטל. אין מידע אישי במטמון ציבורי | עובר (+ MA6 עובר) | OB:15, OB:22, app/me/bookings/bookings-list.test.tsx:196, SW:293, SW:223 |
| SN3 הסכום בבית האדמין לא נקרא "רווח" או "הכנסה" | עובר | HI:502 |
| SN4 יומן הפעולות לא מכיל סיסמה או קישור מלא, ואפשר לסנן לפי מפגש ותאריך | עובר (+ MA7 עובר) | LL:321, RS:64, RSU:83, AUD:179 (helper, used at :467, :1119, :1138), AUD:194, AUD:261 |
| SN5 עמוד הצהרת הנגישות מציג רק פרטי קשר קיימים | עובר (+ MA8 עובר) | LV:90, LV:104 |
| SN6 פתק שנמחק לא חוזר. ארכיון הפתקים מוסתר כברירת מחדל וניתן לשחזור | עובר | NOTE:285, NS:113, NOTE:258 |
| SN7 תווית סוג המפגש לא מוצגת לאורחת וללקוחה | עובר (+ MA5 עובר) | PSX `expectNoPlacesOrKind` (:50, used at :103, :144, :171); T22 |
| SN7 "הטקסט על צבע כל קונספט עומד בניגודיות 4.5:1" | הוחלף בהחלטה + עובר על הצבעים שנשארו | UX memlog:131 (no concept colours); the palette's text tokens: T23 |

**Summary:** of the 47 clauses, every one is marked עובר or הוחלף בהחלטה, except two parts: PC8 (a hidden item through the API) and SC5 (an archived concept through the API), marked "לא עובר: תיקון מתוזמן" with the fix in `fix-public-read-leaks`. Fully superseded: NT3, PC4, AV8, AV10. All 12 M-auto checks pass (2026-10-30, planning session). Still pending: MU1 and MU2 (SC10: phone feel and screen reader), MU3 optional.

## Known risks

- If the after-rollback queue check fails in the full run, run that file again on its own before looking for a bug (a real push job that is ready in dev can make the minute's cron wake the worker while a job test runs).

## Manual checks

### M-auto (planning session; automated browser, width 390 and desktop; local dev or https://brunch-at-tals.vercel.app)

Run 2026-10-30 by the planning session on the live site (same code, dev database), Chrome at 390×844 and 1280, as dev-customer, dev-admin and a test customer "בדיקה 6.7 לקוחה" (check-6-7@example.com) created through the screens. Test data: the test customer's purchase is voided through "ביטול הרכישה" with the reason "בדיקה ידנית של 6.7"; she is left with no active purchase (בוטלה).

| # | Clause | Steps | Result |
|---|---|---|---|
| MA1 | SC10 | `/`, `/sessions`, `/sessions/<id>`, `/me`, `/me/sessions`, `/me/purchases`, `/me/profile`, `/admin`, `/admin/sessions`, `/admin/sessions/<id>/work`: no horizontal scroll, text starts on the right, `<html dir="rtl">` | עובר. Every listed route as guest, customer and admin, plus `/` and `/sessions` at 1280: 200, `dir=rtl`, `lang=he`, no horizontal scroll, 0 left-aligned headings or paragraphs |
| MA2 | SC10 | Keyboard only on `/login`, the booking sheet in `/me/sessions/<id>`, the cancel sheet in `/me/bookings`, the old ← new dialog in `/admin/settings`, a sensitive dialog in `/admin/customers/<id>`: Tab reaches every control with visible focus, Enter acts, Escape closes and focus returns to the trigger. Stop before any confirm | עובר. `/login`: Tab order skip link, email, password, show password, sign in, forgot password, links, each with a 2px outline; Enter signs in. Booking sheet and the "ביטול ההרשמה" sheet (the cancel button is on `/me/sessions/<id>`, not `/me/bookings`, decision 2026-10-18): Enter opens, focus moves in, Tab cycles close and confirm, Escape closes and focus returns, no request. Sensitive dialog "ביטול הרכישה": Enter opens, focus on the title, Tab through reason, checkbox, confirm (aria-disabled=true) and cancel; Escape closes, focus returns. "הסרת פרטים אישיים" for a customer with a future booking shows a notice, not a dialog. Settings: old ← new is an inline row ("לקוחה לא פעילה: 4 חודשים ← 3 חודשים", "חל רק על מה שייווצר מעכשיו", "לשמור את השינוי", "ביטול"); Tab reaches save and Enter saves. Incident: during the check Enter saved a real change (inactivity 3 → 4); it was set back to 3 on the same screen, and both rows are in the audit log |
| MA3 | SC10, SN7 | Computed styles on `/sessions` and `/me/sessions`: every text colour on its background ≥4.5:1; brand-accent only on icons | עובר. Computed styles on `/sessions` (guest) and `/me/sessions` (customer): no text below 4.5:1 |
| MA4 | SC2 | `/sessions/<id>`, `/me/sessions/<id>`: no menu section or "תפריט" | עובר. No "תפריט" on `/sessions/<id>` or `/me/sessions/<id>` |
| MA5 | SN7, SC1 | As dev-customer, `/sessions`, `/me/sessions`, `/me/sessions/<couple id>`: no "רגיל", "זוגי", "לשני מבוגרים"; availability is a word, no place number | עובר. `/sessions`: no "רגיל", "זוגי", "לשני מבוגרים", "/12", "/14" or "מקומות"; `/me/sessions`: only "יש מקום", "מקומות אחרונים", "מלא"; couple session `/me/sessions/0b6ab16c…`: no kind word, no number |
| MA6 | SN2 | As dev-customer, booking sheet open, network offline: confirm `aria-disabled`, `offline-hint` banner, no request sent; same for "כן, לבטל" in `/me/bookings` | עובר. Offline: the booking sheet's confirm and "כן, לבטל" are aria-disabled=true, the banner "אין חיבור כרגע. אפשר לצפות בעמוד, אבל לא לשמור, להירשם או לבטל עד שהחיבור יחזור" shows, and a forced click sent no request |
| MA7 | SN4 | `/admin/audit`: rows show no password and no `/join/` or `/reset/` URL or token; the session and date filters narrow the rows (existing link/reset rows in dev) | עובר. Text and HTML of `/admin/audit`: no `/join/` or `/reset/` with a token, no password; filters by session (select) and dates (from/to) present |
| MA8 | SN5 | `/accessibility` signed out: 200, only existing contact details, links work | עובר. `/accessibility` signed out: 200, noindex; only existing contact details (`tel:0544256456` and the business mailto) |
| MA9 | SC4 | `/admin/sessions/<id>/work` print preview: dishes and tasks, registrants with diet and allergies (companion too), photo consent, shopping list; a prep day with no items not printed. Data: created by the planning session through the screens ("בדיקה 6.7" customers, see the spec) and removed after | עובר. Print media of `/admin/sessions/3c3cdf28…/work`: dishes and tasks in columns א׳ 01.11 and ב׳ 02.11; 9 registrants with ambience and personal photo consent (✓/✗) and diet and allergies ("בלי מוצרי חלב", "צליאקית, בלי גלוטן", "אלרגיה לשומשום"); shopping list with bought items marked. Checked on existing data, no new data; companion and the empty prep day are covered by `work-screens.test.tsx:200` and WSX:522 |
| MA10 | SN1 | As dev-customer `/me/notifications`: explanation card shown, no browser prompt on load; "לא עכשיו", reload: still no prompt | עובר. `/me/notifications` shows "רוצה שנזכיר לך לפני הבראנץ׳?"; `Notification.requestPermission` called 0 times on load; after "לא עכשיו" and reload: "התראות כבויות · להפעיל", still 0 calls |
| MA11 | AV1 | `/`, `/how-it-works`, `/gallery`, `/contact`: every marketing text matches the published content in `/admin/content`. View only. There is no `/about` route: "about" is a section of the home page | עובר. Every published content string of home, about, how-it-works, gallery and contact is on the pages (FAQ answers in textContent inside collapsed items; gallery image ids are ids, not text). Only exception: `payment_instructions`, not shown by design (user decision 2026-10-04, deferred-work:246, :374) |
| MA12 | AV6 | A "בדיקה 6.7" customer with a 4-entry card and a confirmed booking on a Tuesday 2–3 weeks ahead (created through the screens, removed after). In `/admin/customers/<id>/entitlements/<entitlementId>`, change the expiry to before the booking (and, separately, the weekdays to Sunday only): the dialog lists that session above the checkbox. Stop before confirming | עובר. Test customer "בדיקה 6.7 לקוחה": card from 30.10, booking on 23.11. Expiry to 20.11: "המשך" (preview only) opens "האם לשנות את התוקף?" with before 18.12.26, after 20.11.26, and "הרשמות שכבר לא יתאימו (הן יישארו כפי שהן) בראנץ׳ אמהות בחל״ד יום שני 23.11"; "עדכון התוקף" aria-disabled=true until the box is checked. Weekdays Sunday only: "האם לשנות את תנאי הכרטיסייה?", before "כל הימים", after "ראשון", same booking listed. Nothing confirmed; DB afterwards: expires_on 2026-12-18, allowed_weekdays null, 0 corrections |

### M-user (המשתמשת, בטלפון, https://brunch-at-tals.vercel.app)

לפני שמתחילות: לרשום את דגם הטלפון, מערכת ההפעלה והדפדפן (למשל "Pixel 7, Android 15, Chrome"). הם נכנסים לדוח.

**MU1: קורא מסך** (TalkBack באנדרואיד, VoiceOver באייפון)

1. להפעיל את קורא המסך בהגדרות הנגישות של הטלפון.
2. לפתוח את דף הבית ולהעביר אצבע ימינה, פריט אחרי פריט, עד סוף העמוד.
   - מה אמור לקרות: כל כפתור וכל קישור נקראים בשם ברור (למשל "יצירת קשר", "תפריט"), ולא "כפתור" בלי שם.
3. לפתוח מפגש מהלו״ז ולעבור על העמוד באותה דרך.
   - מה אמור לקרות: שם הקונספט, התאריך, השעה והכפתור נקראים בשם ברור.
4. להתחבר כלקוחה הבדויה, לפתוח מפגש וללחוץ על ההרשמה כדי לפתוח את חלון ההרשמה. לא לאשר.
   - מה אמור לקרות: הכותרת של החלון והכפתורים נקראים בשם ברור, וקורא המסך נשאר בתוך החלון.
5. לסגור את החלון בלי לאשר. לפתוח את האזור האישי (`/me`) ולעבור עליו.
   - מה אמור לקרות: הכרטיסים והכפתורים נקראים בשם ברור.
6. להתחבר כאדמין הבדויה ולפתוח את בית האדמין (`/admin`).
   - מה אמור לקרות: הכפתורים, הקישורים והשדות נקראים בשם ברור.
7. לכבות את קורא המסך.

**MU2: תחושה בטלפון**

1. לגלול את לו״ז הבראנצ׳ים מלמעלה עד למטה.
   - מה אמור לקרות: הגלילה חלקה, ושום דבר לא זז לצדדים.
2. לפתוח את חלון ההרשמה של מפגש ולסגור אותו. לפתוח את חלון הביטול ב"ההרשמות שלי" ולסגור אותו. לא לאשר באף אחד מהם.
   - מה אמור לקרות: החלון נפתח ונסגר בקלות, וכפתור האישור נראה בלי לגלול הרבה.
3. במסך ההתחברות, להקליד בשדות.
   - מה אמור לקרות: השדה שמקלידות בו נשאר גלוי מעל המקלדת.
4. בפרופיל, לפתוח עריכה ולהקליד בשדה. לא לשמור.
   - מה אמור לקרות: השדה נשאר גלוי מעל המקלדת, וכפתור השמירה אפשר להגיע אליו.
5. כאדמין, בדף העבודה של מפגש, ללחוץ "+ פריט" ולהקליד. לא לשמור.
   - מה אמור לקרות: השדה גלוי מעל המקלדת, וכפתור האישור אפשר להגיע אליו.

**MU3 (רשות, רק עם אייפון)**

1. בספארי, להוסיף את האתר למסך הבית.
2. לפתוח אותו ממסך הבית, להתחבר כלקוחה הבדויה, ובכרטיס ההתראות ללחוץ "כן, להפעיל התראות" ולאשר.
3. לסגור את האפליקציה ולבקש מסשן התכנון לשלוח התראת בדיקה.
   - מה אמור לקרות: ההתראה מגיעה תוך דקה, ולחיצה עליה פותחת את העמוד הנכון.

לא כלול כאן: התקנה ופוש באנדרואיד (סיפור 6.8).

| # | Device and browser | Result |
|---|---|---|
| MU1 | | ממתין |
| MU2 | | ממתין |
| MU3 | | ממתין (רשות) |

## Wording notes

- CN2: counted from the cancelled session, not "מועד פעולת הביטול" (source §6:238): SPEC memlog:206, :287 (user decision 2026-10-06), cancellation-rules:21. 3.7 (memlog:295, 2026-10-10): a credit also funds its own cancelled session outside N (CC:1252). 3.18 (memlog:311): matching includes eligible products.
- CN6: after a move, a cancel returns the same credit, never money (memlog:303, 2026-10-18; MV:652).
- NT1: a real time change creates a reminder per session revision (source :298); a move into the window sends none (memlog:305; MV:923).
- NT4: alerts fire when the days left are at or under the threshold, at most once per card per expiry date (CAP-35, memlog:204).
- NT5: the days and times are editable; the clause's schedule is the default (memlog:312).
- SC2, SN7: source lines 64, 66 (menu, kind) overridden by SPEC memlog:218 and UX memlog:87, :94 (2026-09-26).
