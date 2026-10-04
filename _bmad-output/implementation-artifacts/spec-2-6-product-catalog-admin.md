---
title: '2.6 Product catalog admin — ניהול קטלוג מוצרים'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '66fec7d4a57b46db3affd0e1c0a6eb47233abd54'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** הקטלוג קיים רק כ-seed. טל לא יוצרת, עורכת, משנה מחיר או מסתירה מוצר (מקור §2, §7, CAP-3).

**Approach:** מיגרציה עם RPC לאדמין ומסכי `/admin/products` מ"עוד". מחיר בחלון הרגיש, שאר השדות ב-`value-change-row` החדש. כל שינוי ביומן, ישן וחדש.

## Boundaries & Constraints

**Always:** AD-5, AD-7, AD-9, AD-19. עריכה חלה רק על רכישות חדשות; זכות ותשלום קיימים לא משתנים. עברית רק ב-`lib/copy/*` וב-`sensitive-actions.ts`, מה-Design Notes.

**Decisions:**
- **`admin_create_product(p_product jsonb, p_idempotency_key)`:** כל השדות חוץ מ-`active` (חדש פעיל). תוקף בימים בלי מספר ← `default_validity_days`. מחזיר `{product_id}`.
- **`admin_update_product(p_product_id, p_changes jsonb, p_idempotency_key)`:** תת-קבוצה של `name, type, units, validity_mode, validity_days, allowed_weekdays, eligible_event_kind, party_size, intro_only, post_join_message, post_join_button_label, active`. מפתח אחר (גם `price_agorot`), ערך לא תקין או הפרת check ← `INVALID_INPUT`. נועל את השורה; יומן `product_update`.
- **מחיר (AD-7):** `private.plan_set_product_price(p_product_id, p_price_agorot)` ← `{product_id, name, old_price_agorot, new_price_agorot}`; זהה או שלילי ← `INVALID_INPUT`. `preview_admin_set_product_price`, ו-`admin_set_product_price(p_product_id, p_price_agorot, p_reason, p_confirmed, p_idempotency_key)`: בלי `p_confirmed` ← `CONFIRM_REQUIRED`. יומן `product_price_change` עם סיבה.
- **סוג קודם (המשתמשת, 2026-10-04):** בטופס היצירה בוחרים קודם סוג (בודד / היכרות / כרטיסייה / זוגי), והוא ממלא ברירות מחדל שאפשר לשנות: בודד ← מוצמד, כניסה 1, מבוגרת 1, מפגש רגיל; היכרות ← כמו בודד + להיכרות בלבד; כרטיסייה ← כמו בודד + תוקף בימים מההגדרות; זוגי ← מוצמד, כניסה 1, 2 מבוגרים, מפגש זוגי. המילוי רק בטופס; בעריכה הסוג הוא שדה רגיל. אין בדיקת התאמה בין הסוג לשדות.
- **הסתרה:** `active = false` ב-`admin_update_product`. כבר מסונן מ"הוספת תשלום" והליבה דוחה (`PRODUCT_NOT_AVAILABLE`); תשלומי עבר מה-snapshot.
- **ימי מימוש:** כל השבעה ← `null`; אף יום ← שגיאת שדה.
- **מסכים:** רשימה (שם, מחיר, תקציר, "מוסתר"); `/new` טופס אחד; `/[id]` שדה-שדה ב-`value-change-row` (תוקף: מצב וימים יחד), מחיר ב-`sensitive-confirm-dialog` עם `price_change`, הערה קבועה. "מוצרים" ב-`adminMoreNav`.
- **`value-change-row.tsx`:** השדה כילד, ישן ← חדש כשיש שינוי, הערת היקף, "לשמור" (busy), שגיאה ב-`inline-notice`, כשל משאיר את הישן. 2.7 ישתמש בו.

**Never:** עמודה חדשה, שינוי בליבת האישור, כתיבה ל-`products` מהדפדפן, מחיקת מוצר, אישור מוצמד (E3), עריכת זכות קיימת (CAP-9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| עריכה אחרי רכישה | כרטיסייה אושרה; כניסות 4←5, תוקף 49←60, מחיר 472←500 | הזכות והתשלום בלי שינוי; preview חדש: 5, 60 יום, 500 |
| הסתרה | מוצר מוסתר | לא ב"הוספת תשלום"; אישור ← `PRODUCT_NOT_AVAILABLE`; `admin_list_payments` מציג את הישן בשמו |
| מחיר | בלי `p_confirmed` / עם, סיבה ריקה | `CONFIRM_REQUIRED`, לא זז / נשמר, ביומן 47200 ← 50000 |
| יצירה | בוחרים "זוגי" / "כרטיסייה" בלי מספר ימים | 2 מבוגרים, מפגש זוגי ממולאים / ימים מההגדרות |
| לא תקין | `price_agorot` ב-update, כניסות 0, מפתח לא מוכר | `INVALID_INPUT`, כלום לא נשמר |
| חוזר | אותו מפתח | אותה תוצאה, יומן אחד |
| לא אדמין | לקוחה / anon | `NOT_AUTHORIZED` / 42501 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261001162630_create_money_schema.sql` -- `products` (23), seed, policy ו-grant (382, 414), `default_validity_days` (248), `plan_approve_payment` (458).
- `supabase/migrations/20261003141504_link_lifecycle_and_recovery.sql:391` -- `admin_revoke_link`: דפוס RPC אדמין. `20260930191525_create_rpc_contract.sql` -- `idempotent_*`, `audit(..., p_reason)`.
- `app/admin/(shell)/payments/new/{form-data.ts,payment-form.tsx}` -- סינון מוצרים פעילים (לא לשנות); דפוס preview, מפתח ודיאלוג.
- `app/admin/(shell)/{links,more}/*`, `lib/rpc.ts` -- דפוס דף, actions ו-`callRpc`.
- `components/admin/{sensitive-confirm-dialog,radio-card}.tsx`, `components/shared/inline-notice.tsx`, `lib/admin/sensitive-actions.ts`.
- `lib/{nav,money,errors}.ts`, `lib/copy/admin.ts`; `supabase/tests/support/{db,money}.ts`, `grants.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_product_catalog_admin.sql` -- **סשן ראשי:** `migration new`, `apply_migration`, `get_advisors`, `generate_typescript_types`.
- [ ] `components/admin/value-change-row.tsx` + בדיקה -- מתחילים בסקיל `frontend-design`.
- [ ] `app/admin/(shell)/products/**` + בדיקות, `lib/nav.ts`, `lib/copy/admin.ts` -- מתחילים בסקיל `frontend-design`.
- [ ] `supabase/tests/product-catalog.test.ts`, `grants.test.ts` -- כל שורה במטריצה.

**Acceptance Criteria:**
- Given המיגרציה, then ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`.
- Given `DEV_DATABASE_URL`, when `npm run test:db`, then הכול עובר ואין שורות `test_%`.
- Given checkout בלי `.env*`, then lint, format:check, typecheck, `npm test` ו-build עוברים.
- Given טלפון, when טל משנה מחיר, then בלי צ׳קבוקס אין שמירה; when היא מסתירה מוצר, then הוא נעלם מ"הוספת תשלום" ומסומן "מוסתר".

## Implementation Notes

- קובץ המיגרציה נוצר בסשן הראשי: `supabase/migrations/20261004102035_product_catalog_admin.sql` (ריק). כותבים אליו בלבד, בלי `drop`; `apply_migration` ו-`migration new` לא עובדים אצל סוכן משנה. הסשן הראשי מחיל, מריץ advisor, יוצר טיפוסים ומריץ `npm run test:db`; עד אז מעדכנים את `database.types.ts` ידנית לפי החתימות. לסיים בדיווח מה נשאר לסשן הראשי.

- שמות הפעולות ביומן הם שמות ה-RPC (`admin_create_product`, `admin_update_product`, `admin_set_product_price`) לפי AD-19, שגובר על `product_update` ו-`product_price_change` שב-Decisions. תוקן לפני ההחלה.
- המיגרציה הוחלה מה-MCP (בלי drop). הטיפוסים שנוצרו זהים לעדכון הידני.
- תוצאות סופיות: `npm run test:db` 371/371, בדיקות יחידה 751 (בלי `.claude/worktrees` של סשן מקביל), lint, format:check, typecheck ו-build עוברים; ה-advisor רק עם 0029 ו-`auth_leaked_password_protection`; לא נשארו שורות `test_%`.
- בדיקה בטלפון (המשתמשת, 2026-10-04), תוקן אחרי ה-merge:
  - טופס התשלום שמר את הסכום הישן אחרי שינוי מחיר, כי Next שומר מצב של דף שנפתח (`cacheComponents`). עכשיו הטופס מתחיל מחדש כשהמוצרים או המחירים משתנים (`payment-form-host.tsx`).
  - נוסף "ביטול" (`button-link`) ב-`value-change-row`: מחזיר את השדה לערך השמור.
  - ההודעה "המוצר נוסף" הוסרה (החלטת המשתמשת): שם המוצר בכותרת מספיק.
  - טופס תשלום בלי מוצר זמין (רק כרטיסייה, והיא מוסתרת) נשאר כמו שהוא, בהחלטת המשתמשת: המוצרים המוצמדים נכנסים ב-E3.
  - הנוסחים "כניסה אחת", "כן" / "לא" ו"עבר שבוע" / "עברו N ימים" אושרו.

## Spec Change Log

## Review Triage Log

סבב 1 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). אין intent_gap ואין bad_spec. medium 1, low 5, false 4. patch 6, defer 1, השאר reject.

| # | ממצא | פסק | ראיה | ניתוב |
|---|------|-----|------|-------|
| 1 | היומן של `admin_update_product` (ישן ← חדש) ושינוי שלא משנה כלום לא נבדקים | medium | אף בדיקה לא קוראת before/after של עדכון שדה או הסתרה (verification, blind) | patch: בדיקה עם before/after ועם no-op |
| 2 | `confirmPrice` בלי try/finally: כשל רשת משאיר את החלון busy ואת שורת המחיר בהמתנה | low | ההבטחה של השורה לא נפתרת (blind, edge) | patch |
| 3 | טופס היצירה: כשל רשת משאיר `pending` או מגיע ל-error boundary | low | אין catch סביב `createProductAction` (blind, edge) | patch: ‏`SERVER_ERROR` |
| 4 | מפתח idempotency של היצירה נוצר בשרת לכל טעינה; חזרה אחרי שמירה מחזירה אותו למוצר אחר | low | ‏`randomUUID()` ב-`new/page.tsx` (blind) | patch: מפתח בדפדפן, חדש אחרי הצלחה |
| 5 | "המוצר נוסף" נשאר בכל שמירה בעורך | low | ‏`router.refresh` שומר את `?added=1` (blind, edge) | patch: מציגים פעם אחת ומסירים את הפרמטר |
| 6 | בתקציר "1 כניסות" במוצר בודד, היכרות וזוגי | low | ‏`copy.summary` תמיד ברבים (blind) | patch: "כניסה אחת" |
| 7 | הבדיקה של "מוסתר לא מוצע" מריצה עותק של השאילתה ולא את `form-data.ts` | low | הסינון קודם לסיפור ולא השתנה (verification) | defer |

Reject (14): שמות הפעולות ביומן שונים מה-spec (בכוונה: AD-19 קובע שם ה-RPC, תוקן לפני ההחלה); ההודעה והכפתור אחרי רכישה משתנים ב-`/me` גם לרכישות קיימות (החלטת UX: מוצג תמיד הנוסח הנוכחי של המוצר); תקרת סיבה 500 מול 2000 (false: הדיאלוג מגביל ל-500); ‏`detail.field` לא מסמן שדה (בדיקות הדפדפן קודמות לשרת); מחיר מעל טווח integer (מעל 21 מיליון ₪); ‏`1.0` ב-JSON (false: הדפדפן שולח מספר שלם); החלפת מפתח אחרי `IDEMPOTENCY_KEY_REUSED` ותשובה שאבדה (נדיר); טיוטה ישנה אחרי עריכה בלשונית אחרת (נדיר); רשימה ריקה (false: אין מחיקה, ה-seed קיים); ‏`toProductRow` בלי בדיקה (false: ה-checks של הטבלה); regex כפול (בלי נזק); בדיקות אינטראקציה בדפדפן (review-accepted); היסטוריה גלויה לטל (יומן הפעולות ב-4.5); מחיר ביצירה בלי חלון (אין מחיר קודם, ה-spec).

בנוסף, מ-deferred-work (2.4, יעד 2.6): ההסבר "תוקף הכרטיסיה פג" ב-`/me` מנוסח עכשיו לפי ימי התוקף: שבועות שלמים בשבועות ("עבר שבוע" / "עברו N שבועות"), אחרת בימים ("עבר יום" / "עברו N ימים").

## Design Notes

**נוסחים מאושרים (המשתמשת, 2026-10-04).** סכום ב-`formatAgorot`.

| מקום | נוסח |
|---|---|
| רשימה | מוצרים · הוספת מוצר · מוסתר |
| תקציר | {מחיר} · {N} כניסות · בתוקף {N} ימים / מוצמד למפגש |
| הערה קבועה | השינוי חל על רכישות חדשות בלבד. זכויות שכבר ניתנו לא משתנות |
| שדות | סוג: בודד / היכרות / כרטיסייה / זוגי · שם · מחיר · מספר כניסות · תוקף: בימים / מוצמד למפגש · מספר ימים · ימי מימוש · סוג מפגש: רגיל / זוגי · מספר מבוגרים · להיכרות בלבד · הודעה אחרי רכישה (לא חובה) · תווית הכפתור (לא חובה) |
| ימי מימוש | כל הימים (כשהכול מסומן) · ריק: צריך לבחור לפחות יום אחד |
| `value-change-row` | {שדה}: {ישן} ← {חדש} · לשמור את השינוי · השינוי נשמר |
| הסתרה | הסתרת המוצר / הצגת המוצר · מצב: מוצע ← מוסתר · מוסתר לא מוצע בהוספת תשלום, ותשלומי עבר לא משתנים |
| דיאלוג מחיר | האם לאשר שינוי מחיר? · מוצר: {שם} · מחיר: {ישן} ← {חדש} · סיבה (לא חובה) |
| צ׳קבוקס | אני מאשרת שהמחיר של {שם} משתנה ל-{חדש}, ושהשינוי יירשם ביומן הפעולות |
| יצירה | הוספת מוצר · שמירת המוצר · המוצר נוסף |

## Verification

**Commands:**
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` -- expected: הכול עובר.
- MCP `get_advisors` (security) -- expected: רק 0029 ו-`auth_leaked_password_protection`.
