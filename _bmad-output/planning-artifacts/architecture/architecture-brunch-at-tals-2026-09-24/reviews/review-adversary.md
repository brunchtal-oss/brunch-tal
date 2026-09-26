---
review: adversary
target: ../ARCHITECTURE-SPINE.md
date: '2026-09-24'
method: 'בניית זוגות של יחידות (סשנים נפרדים) שכל אחת מקיימת כל AD ככתבו, ובכל זאת נבנות באופן לא תואם. בנוסף, חורי אבטחה שה-ADs מתירים.'
verdict: 'לא מוכן לבנייה של E2. 4 ממצאים קריטיים (הרשאות, views, טוקנים, claim_join) חייבים AD מתוקן לפני המיגרציה הראשונה של RPC. השאר לפני E3/E5.'
---

# סקירה עוינת: Architecture Spine, בראנץ׳ אצל טל

## פסק דין

ה-spine טוב בכיוון (ליבה במסד, מתאם דק, מכונת מצבים לקישור, תור פוש), אבל הוא קובע **שמות** יותר מ**חוזים**. בכל מקום שבו שני סשנים צריכים להסכים על צורה (פורמט גיבוב, סימן של יחידות, מבנה before/after, מפתח dedupe, מי מחליט על מימון) ה-AD משאיר מספיק מרחב כדי ששניהם יצייתו לו ועדיין לא יתאימו. בנוסף יש סתירה ישירה בין AD-5 לבין מוסכמת ה-RLS (`private.is_admin()` בתוך policy), והנחה שגויה לגבי הרשאות ברירת המחדל של Supabase שהופכת RPC "של service_role בלבד" לנגיש לכל לקוחה מחוברת.

**לא מוכן כמו שהוא.** 4 קריטיים, 8 גבוהים, 9 בינוניים, 3 נמוכים. לכל ממצא מוצע נוסח כלל (באנגלית, מוכן להדבקה כ-AD או כתוספת ל-AD קיים).

| # | חומרה | נושא | AD שמתוקן |
| --- | --- | --- | --- |
| C1 | קריטי | הרשאות ברירת מחדל של Supabase, `private` ו-RLS, הרשאות עמודה | AD-5, מוסכמת RLS |
| C2 | קריטי | views עוקפים RLS (`entitlement_balances`, `event_availability`) | AD-14 |
| C3 | קריטי | יצירת טוקן, פורמט גיבוב, והטוקן הגולמי ב-`idempotency_results` | AD-10, AD-5 |
| C4 | קריטי | `claim_join` לא קשור למשתמשת ולמטרה | AD-10 |
| H1 | גבוה | סדר נעילה חלקי, נעילת הורה דרך ילד, סריאליזציה ללקוחה | AD-6 |
| H2 | גבוה | "זכות מתאימה": מי בוחר מימון, זיכוי מול שחרור לזכות | חדש AD-18 |
| H3 | גבוה | סמנטיקת idempotency (actor ריק, מפתח בין RPCs, בחירה מרובה, מקביליות) | AD-5 |
| H4 | גבוה | סימן היחידות ביומן התנועות, append-only, `entitlements.status` | AD-14 |
| H5 | גבוה | בעלות על התראות: `customer_id` ריק, מפתח dedupe, `revision`, סבב המתנה | AD-12, AD-13 |
| H6 | גבוה | צורת היומן (audit) ו-PII מול הסרת פרטים | AD-6, חדש AD-19 |
| H7 | גבוה | זיהוי כפילויות: מיילים של מיובאות, נרמול | AD-3, AD-10 |
| H8 | גבוה | `join_begin`: ענף "עדכון סיסמה", קשירת קלט, חשיפת קיום חשבון | AD-10 |
| M1 | בינוני | אוצר סטטוסים ובעלי מעברים | Conventions |
| M2 | בינוני | preview מול ביצוע, והרשאה ב-preview | AD-7 |
| M3 | בינוני | תוכן: תגיות מטמון משותפות, פרסום מדיה דו-שלבי, סכמת תוכן, גרסת מדיניות | AD-16 |
| M4 | בינוני | עובד הפוש: גרעיניות משימה, lease, VAPID, מכשיר משותף | AD-12 |
| M5 | בינוני | "השתתפה בעבר" ו"לא פעילה": שני כותבים | AD-14 |
| M6 | בינוני | תוצאת ביטול: מתי בוחרים, גבול 48 שעות, בסיס כספי | חדש AD-20 |
| M7 | בינוני | איך אדמין קוראת מייל מ-`auth.users` | AD-4 |
| M8 | בינוני | טוקן בכתובת: Referer, לוגים | AD-16 |
| M9 | בינוני | `CRON_SECRET` ו-deployments של preview | AD-11 |
| L1 | נמוך | סימון נקראה: RPC או UPDATE ישיר | AD-1 |
| L2 | נמוך | `registration_closes_at` אחרי שינוי שעה | AD-8 |
| L3 | נמוך | `detail` של שגיאה בלי סכמה | AD-5 |

---

## קריטיים

### C1. הרשאות: ה-revoke ב-AD-5 לא מספיק, ו-`private` סותר את ה-RLS

**הזוג:** סשן E2-join (בונה `join_complete(p_token, p_user_id, p_profile)`, ‏`revoke … from public, anon`, ‏`grant … to service_role`, בדיוק לפי AD-5) מול כל לקוחה מחוברת.

**מה קורה:** ב-Supabase יש `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role`. ה-revoke מ-`public, anon` לא מסיר את ה-grant המפורש ל-`authenticated`. התוצאה: `join_complete` עם `p_user_id` שרירותי, `claim_push_jobs` (מחזיר endpoint ומפתחות פוש של כל הלקוחות) ו-`finish_push_job` ניתנים להרצה מכל חשבון לקוחה דרך PostgREST. `join_complete` עם `p_user_id` של התוקפת ועם טוקן שהיא מחזיקה זה פחות חמור, אבל `claim_push_jobs` הוא דליפת נתונים מלאה.

**זוג שני, אותו שורש:** סשן migrations של E1 מקיים "ל-`private` אין grant ל-`authenticated`". סשן של E2 כותב policy ‏`bookings_admin_select using ((select private.is_admin()))` לפי מוסכמת ה-RLS. policy רצה בהרשאות התפקיד השואל, ולכן כל שאילתה של אדמין (ושל לקוחה, כי ה-policies מוערכות יחד ב-OR) נכשלת ב-`permission denied for schema private`. הסשן השני "יתקן" ב-`grant usage on schema private to authenticated`, ואז כל פונקציה ב-`private` שנוצרה עם ברירת המחדל של Postgres (`EXECUTE` ל-`PUBLIC`) נגישה מכל view או פונקציית invoker.

**זוג שלישי:** סשן הפרופיל (CAP-8) כותב `grant update (full_name, dietary_notes) on profiles to authenticated` כפי ש-AD-1 אומר ("RLS עם הרשאות עמודה"). אבל ל-`authenticated` כבר יש `UPDATE` על כל הטבלה מברירת המחדל של Supabase, ו-grant לעמודה לא מצמצם grant לטבלה. הלקוחה מעדכנת `prior_participation = false` (ומקבלת מחיר היכרות שוב), או `phone_e164`, או `activity_status`.

**כלל מוצע (מחליף את סעיף "הרשאות" ב-AD-5, ומוסיף ל-Conventions › Migrations):**

> **AD-5 › Grants (tightened).** Migration `0001` runs, once: `alter default privileges in schema public revoke execute on functions from public, anon, authenticated;` `alter default privileges in schema public revoke all on tables from anon, authenticated;` and the same for `schema private` plus `revoke all on schema private from public; grant usage on schema private to authenticated;`. Every function migration then ends with `revoke execute on function <sig> from public, anon, authenticated, service_role;` followed by exactly one explicit `grant execute … to authenticated` **or** `… to service_role` (never both, never anon, except the one allow-listed anon RPC in C4/M8). In `private`, only functions referenced by an RLS policy or a view (`private.is_admin()`, `private.current_customer_id()`) get `grant execute … to authenticated`; they are `security definer`, `stable`, `set search_path = ''`, and take no arguments. Every table migration does `revoke all on <table> from anon, authenticated;` and then grants only what a policy uses: `select` table-wide, and `insert`/`update` **only by column list**. Service-role-only RPCs additionally assert `(select auth.role()) = 'service_role'` in their first line. A test in `supabase/tests/grants.test.ts` queries `information_schema.routine_privileges` / `role_table_grants` and fails on any function in `public` executable by both `authenticated` and `service_role`, any `anon` grant outside the allow-list, and any table-wide `update`/`insert` to `authenticated`.

### C2. views עוקפים RLS, ו-`event_availability` לא יכול להיות גם בטוח וגם נכון

**הזוג:** סשן E3 בונה `create view entitlement_balances as select … from entitlement_movements group by entitlement_id` ב-`public` (AD-14: "view"). סשן E4 (אזור אישי) קורא ממנו דרך הלקוח הרגיל. ב-Postgres view רץ בהרשאות הבעלים (`postgres`) אם אין `security_invoker = true`, ולכן כל לקוחה רואה יתרות של כל הלקוחות, ו-anon (אם נשאר grant) גם כן.

**זוג הפוך:** סשן E5 (אתר ציבורי) בונה `event_availability` עם `security_invoker = true` "כי ככה ה-advisor אוהב". אורחת (anon) לא רואה שום `bookings` בגלל RLS, ולכן כל מפגש מוצג "נותרו 12" גם כשהוא מלא. סשן E3 בנה אותו כ-definer והוא מחזיר גם `customer_id`. שניהם מקיימים את AD-14.

**כלל מוצע (תוספת ל-AD-14):**

> **AD-14 › Derived views (tightened).** Every view in `public` is created `with (security_invoker = true)` and is therefore subject to the caller's RLS; `entitlement_balances` is such a view and exposes rows only through `entitlements`/`entitlement_movements` policies. Aggregates that anon or a customer must see across other customers' rows (occupancy, "full", "n left") are **never** views: they are `security definer` functions `public.get_event_availability(p_event_ids uuid[])` returning only `event_id, capacity_adults, confirmed_adults, seats_left, is_full, registration_open, registration_closes_at` for events with `status = 'published'`. No derived function or view ever returns `customer_id`, names, or booking ids to a non-admin. The advisor's `security_definer_view` lint must be clean.

### C3. טוקן הקישור: מי יוצר, איך מגבבים, ואיפה הגולמי נשמר

**הזוג א:** סשן E2-payments (`admin_approve_payment`) יוצר את הטוקן ב-SQL: `encode(extensions.gen_random_bytes(32),'base64')` ומגבב `extensions.digest(token,'sha256')` כ-`bytea`. סשן E2-join מקבל את הטוקן מה-URL ב-TS, מגבב ב-`crypto.createHash('sha256').digest('hex')` ומעביר את הגיבוב ל-`join_begin`. שניהם "שומרים רק גיבוב" (AD-10). אף טוקן לא נמצא. ‏base64 רגיל גם שובר את ה-URL (`/`, `+`).

**הזוג ב (חמור):** AD-5 אומר ש-`idempotency_results` שומר את תוצאת ה-RPC כדי להחזיר אותה בקריאה חוזרת. התוצאה של `admin_approve_payment` חייבת לכלול את הטוקן הגולמי (טל מעתיקה קישור). לכן הטוקן הגולמי נשמר לצמיתות בטבלה במסד, בניגוד מפורש ל-"במסד נשמר רק הגיבוב" (security-and-rpc-rules, AD-10). כל מי שקוראת את הטבלה (אדמין עתידית, גיבוי, service role) מחזיקה קישורים פעילים.

**הזוג ג:** מסך `admin/links` (CAP-31: "סטטוס לכל קישור, אפשר להפיק מחדש") מול מסך תשלום. מסך אחד מניח שאפשר "להעתיק שוב" קישור קיים, והשני לא יכול לשחזר אותו מגיבוב.

**כלל מוצע (תוספת ל-AD-10):**

> **AD-10 › Token format (new).** Raw tokens are generated only in SQL by `private.issue_token(p_purpose, p_payment_id, p_customer_id) returns table(token_id uuid, raw_token text)`: 32 bytes from `extensions.gen_random_bytes`, encoded base64url without padding (43 chars). Stored: `token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')`. Lookup is only through `private.find_token(p_raw_token text)`; no RPC or TS code ever hashes a token itself and no RPC accepts a hash as input. The raw token is returned exactly once, in the response of the RPC that issued it. `private.idempotent_finish` stores the result with `raw_token` removed (`result - 'raw_token'`); a replay returns `{token_id, raw_token: null, reissue_required: true}` and the UI offers "הפקת קישור חלופי" (which revokes the old one, AD-10). A link can never be shown again after the first response; `admin/links` shows status and a reissue button only. Audit and logs store `token_id` only.

### C4. `claim_join` לא קשור למשתמשת שזוהתה ולא למטרה

**הזוג:** סשן join מממש `claim_join(p_token)` (‏`grant to authenticated`) שמשייך את הרכישה ל-`auth.uid()` אם הטוקן `pending`. סשן claim (יבוא) משתמש באותה טבלה ובאותם מצבים (AD-10: "אותה טבלה, אותם מצבים, אותו מתזמר").

**מה קורה:**
- כל לקוחה מחוברת קוראת ישירות ל-`claim_join` על טוקן `pending`, ומדלגת על `join_begin` ועל בדיקת הכפילויות/התנגשות (CAP-5). מספיק לקבל קישור שהועבר.
- בענף `existing_account`, ‏`join_begin` מצא חשבון X לפי המייל. אחרי ההפניה ל-`/login`, מי שמתחברת היא Y (או X שהתחברה בחשבון אחר), ו-`claim_join` משייך ל-Y. ה-AD לא מחייב `auth.uid() = X`.
- טוקן `purpose = claim` (פרופיל מיובא עם יתרות) או `reset` מועבר ל-`claim_join` ומשויך לחשבון של הקוראת. יתרות של מיובאת עוברות לחשבון זר.

**כלל מוצע:**

> **AD-10 › claim_join (tightened).** `join_begin` returning `existing_account` moves the token to `state = 'awaiting_login'` and stores `bound_user_id` (the matched account). `claim_join(p_token)` succeeds only when `purpose = 'join'`, `state = 'awaiting_login'`, `bound_user_id = (select auth.uid())`, and the token is not expired; otherwise `NOT_AUTHORIZED` (same code for every failure, no detail). `claim` and `reset` tokens are consumed only by the privileged orchestrator (`join.ts`/`reset.ts`) through service-role RPCs, never by an `authenticated` RPC. No `authenticated` RPC takes a token of another purpose.

---

## גבוהים

### H1. סדר הנעילה חלקי, ויש דרך "חוקית" לנעול ילד לפני הורה

**הזוג:** `cancel_booking(p_booking_id)` (E3) מול `admin_cancel_event(p_event_id)` (E4). AD-6 קובע `events ← entitlements ← cancellation_credits`, ולא אומר כלום על `bookings`. ‏`cancel_booking` עושה `select … from bookings where id = p_booking_id for update` כדי לדעת איזה מפגש, ואז נועל את `events`. ‏`admin_cancel_event` נועל את `events` ואז `for update` על כל ההרשמות. deadlock, ושני הסשנים מקיימים את AD-6.

**עוד זוגות באותו חור:**
- `join_complete` נועל `activation_tokens` ← `payments` ← `entitlements`. ‏`admin_refund_*` נועל `payments` ← `refund_requests` ← `activation_tokens` (ביטול קישור). ‏`payments`, ‏`refund_requests`, ‏`activation_tokens`, ‏`waitlist_entries`, ‏`credit_options`, ‏`profiles` לא בסדר בכלל.
- CAP-10: "אי אפשר להחזיק שתי הרשמות היכרות במקביל". שתי קריאות `book_session` של אותה לקוחה לשני מפגשים שונים נועלות שני מפגשים שונים ואת אותה זכות? לא בהכרח: אם יש לה שתי זכויות היכרות (בדיוק מה שאסור) או אם הבדיקה היא על `bookings` של הלקוחה, שתי העסקאות רואות "אין" ושתיהן מצליחות. אין שום נקודת סריאליזציה ללקוחה.
- `private.job_complete_events` מעדכן הרבה מפגשים בבת אחת בלי סדר מוגדר, מול `move_booking` שנועל שניים לפי `id`.

**כלל מוצע (מחליף את AD-6 › סדר נעילה):**

> **AD-6 › Lock order (total).** All row locks are taken in this global order, and within a table by ascending `id`: `activation_tokens` → `profiles` (the customer row: `select 1 from profiles where id = v_customer for update` is the per-customer mutex, taken by every RPC that reads-then-writes a customer's bookings, entitlements, credits, waitlist or refunds) → `events` → `bookings` → `entitlements` → `cancellation_credits` → `credit_options` → `payments` → `refund_requests` → `waitlist_entries` → `push_subscriptions`/`notification_jobs`. A child row is never locked to discover its parent: read the parent id without a lock, lock the parent, then lock the child and re-check that the relation still holds (else `CONCURRENT_CHANGE`). Batch jobs lock with `order by id … for update skip locked` in the same table order. Business invariants that span rows ("one active intro entitlement/booking", "one active booking or waitlist entry per customer per event", refunds ≤ basis) are also backed by a partial unique index or check where expressible; the lock is the fallback, not the only guard.

### H2. "זכות מתאימה" מחושבת בכמה מקומות, וזיכוי לא מופיע במודל המימון

**הזוג א:** `book_session` (E3, לקוחה) בוחר זכות לפי `expires_on` הקרוב ביותר. ‏`admin_book_customer` (E4) בוחר לפי `created_at`. ‏`preview` בגיליון ההרשמה (CAP-13: "לפני האישור מוצגים מה ינוצל") כתוב בסשן UI ומשתמש בשאילתה משלו. ‏`move_booking` בוחר עוד אחרת. כל אחד "קורא את היתרה מ-`entitlement_balances`" (AD-14), ובכל זאת ממשים כרטיסייה אחרת. הלקוחה רואה "ינוצל: כרטיסייה A" ובפועל נגרעה B.

**הזוג ב:** סשן הביטול (E3, CAP-17/18) מבטל כניסה בודדת ויוצר `cancellation_credits`. האם הוא גם כותב תנועת `release` לזכות? אם כן, הכניסה חוזרת ליתרה הכללית, וסשן ההרשמה יאפשר לממש אותה בכל מפגש, בלי מגבלת החלופות. אם לא, סשן ההרשמה צריך לממן הרשמה מתוך `credit_options`, אבל `booking_allocations` מכיל רק `entitlement_id`, ואין איפה לרשום שההרשמה מומנה מזיכוי. כל סשן יוסיף עמודה אחרת (`booking_allocations.credit_id` מול `credit_options.booking_id` מול `bookings.credit_id`).

**כלל מוצע (AD חדש):**

> **AD-18: Funding is decided by one function.** `private.plan_funding(p_customer_id, p_event_id, p_party_size, p_mode text /* 'self' | 'admin' | 'move' */) returns jsonb` is the only code that decides how a booking is funded; `book_session`, `admin_book_customer`, `move_booking`, `get_booking_sheet` (the read RPC that shows "what will be used") and every `preview_*` call it. Order of preference: (1) an `available` cancellation credit whose active `credit_options` include the event; (2) entitlements matching kind/weekday/intro, valid on the event's local date, ordered by `expires_on asc, id asc`. Punch cards are never offered for paired events in `'self'` mode. Result shape: `{ok, code?, sources: [{kind: 'credit'|'entitlement', id, units}]}`. Cancelling a single/paired entry that yields a credit writes **no** `release` movement: the entitlement unit stays `use`d and value moves to the credit. Cancelling a punch-card entry writes `release`. `booking_allocations` gets a nullable `credit_id` with `check (num_nonnulls(entitlement_id, credit_id) = 1)`; a credit-funded booking sets `credit_options.state = 'used'` and `cancellation_credits.status = 'used'` in the same transaction.

### H3. idempotency: ארבעה פערים שבהם שני סשנים יממשו שונה

1. **actor ריק.** ייחודיות על `(key, actor)`. ב-RPC של service role (`join_*`, ‏`claim_push_jobs`) וב-`private.job_*` ‏`auth.uid()` הוא `null`, ו-`null` לא מתנגש ב-unique. סשן join יניח שה-retry מוגן, ובפועל `join_complete` רץ פעמיים (ויוצר שתי שורות `babies`, שתי הסכמות). AD-10 מוסיף "קריאה חוזרת עם אותה משתמשת מחזירה אותה תוצאה", מנגנון שלישי שונה.
2. **אותו מפתח לשני RPC.** ה-unique לא כולל `rpc`. גיליון "בחירה מרובה" (`/me/sessions`, EXPERIENCE) פותח גיליון אחד = מפתח אחד (Conventions), וה-Server Action קורא ל-`book_session` לכל מפגש עם אותו מפתח. הקריאה השנייה מחזירה את תוצאת הראשונה, ו-UI מציג "נרשמת לשלושה" כשנרשמה לאחד. לחלופין סשן אחר בונה `book_sessions(p_event_ids[])`. אין הכרעה.
3. **מקביליות.** שתי קריאות עם אותו מפתח בו זמנית: האם השנייה ממתינה, מקבלת `IN_PROGRESS`, או רצה? ה-AD לא אומר. `insert … on conflict do nothing` בתחילת העסקה ממתין לראשונה, וזה נכון, אבל רק אם ה-begin קורה **לפני** כל נעילה אחרת.
4. **מפתח זהה עם קלט שונה.** מחזיר את התוצאה הישנה בשקט. ובנוסף, `payments.idempotency_key` (data-model) הוא מנגנון מקביל שסשן payments יממש במקום `idempotency_results`.

**כלל מוצע (מחליף את AD-5 › Idempotency):**

> **AD-5 › Idempotency (tightened).** `idempotency_results(key uuid, actor_scope text, rpc text, request_hash text, result jsonb, created_at)` with `primary key (actor_scope, rpc, key)`. `actor_scope` is `auth.uid()::text` for `authenticated`, and for `service_role`/cron it is an explicit subject passed by the caller (`'token:' || token_id`, `'job:' || job_name`), never null. `private.idempotent_begin(p_key, p_rpc, p_request jsonb)` is the **first statement** after the auth check, before any lock: it inserts the row (`result = null`) with `on conflict do nothing`, which blocks behind a concurrent in-flight twin; if a row exists with a result it returns that result; if `request_hash` differs it raises `IDEMPOTENCY_KEY_REUSED`. One key = one RPC call: a multi-select sheet generates one key per selected item (or calls a single batch RPC `book_sessions(p_items jsonb, p_idempotency_key)` that is all-or-nothing; pick the batch RPC). No table other than `idempotency_results` carries an `idempotency_key` column; `payments.idempotency_key` is dropped from the data model. Results are pruned by `private.job_cleanup` after 7 days.

### H4. יומן התנועות: סימן, "use במקום reserve", ו-`entitlements.status`

**הזוג:** סשן E3-booking כותב `reserve` עם `units = 1`, וה-view עושה `case action when 'reserve' then -units`. סשן E4-correction כותב `adjust` עם `units = -2` ומצפה שה-view יסכם. סשן הג׳וב (AD-11: "תנועת `use` במקום `reserve`") מבצע `update entitlement_movements set action = 'use'`, כלומר עורך היסטוריה, בעוד שסשן אחר כותב `use` חדש ו-`release` הפוך עם `reverses_id`. שלושתם "גוזרים יתרה מ-view".

**זוג שני:** `entitlements.status` קיים ב-data-model. סשן אחד מסמן `expired` בג׳וב, סשן אחר מסמן `exhausted` כשהיתרה 0, וסשן שלישי גוזר הכול מ-`expires_on` ומה-view. AD-14 אוסר מצב נגזר שמור, אבל העמודה קיימת.

**כלל מוצע (תוספת ל-AD-14):**

> **AD-14 › Movements (tightened).** `entitlement_movements` is append-only: `revoke update, delete` from every role and a trigger raising on update/delete. `units` is a signed integer with fixed sign per action, enforced by check: `grant`, `opening_balance`, `release` > 0; `reserve` < 0; `use` = 0 **and** requires `reverses_id` null (it marks the reserve as consumed, it does not move balance); `adjust` ≠ 0. The view defines exactly: `reserved = -sum(units) filter (reserve) - sum(units) filter (release where reverses a reserve)`, `available = sum(units) - reserved_outstanding` — spelled out once in the migration and nowhere else. Completion appends `use` rows referencing the booking; it never edits a `reserve`. `entitlements.status` holds only admin-set states (`active`, `revoked`, `refunded`); "expired" and "exhausted" are derived in `entitlement_balances` (`is_expired = now() > private.local_day_end(expires_on)`), never stored.

### H5. התראות: מי יוצר, איך נבנה המפתח, ומה זה "סבב"

1. **התראה על רכישה ללקוחה חדשה.** סשן payments קורא ל-`enqueue_notification` בתוך `admin_approve_payment` (AD-1: "הכנסת התראה לתור באותה עסקה"), אבל `customer_id` הוא `null` בשלב הזה. סשן join יוצר את אותה התראה ב-`join_complete`. תוצאה: שגיאת NOT NULL, או התראה יתומה, או שתיים.
2. **מפתח בלי מבחין.** ‏`<type>:<customer>:<entity>:<event_revision|broadcast_id|cycle>`. לתיקון זכות (CAP-9) אין revision. טל מאריכה זכות פעמיים, והשנייה נבלעת כ-no-op כי המפתח זהה. אותו דבר ב"ההרשמה אושרה" אחרי הזזה חזרה לאותו מפגש.
3. **מי מעלה `events.revision`.** סשן עריכת מפגש מעלה על כל שמירה (גם תיקון תפריט). התזכורת (AD-13) נשלחת שוב כי המפתח השתנה. סשן אחר מעלה רק בשינוי שעה, ולא בביטול.
4. **"סבב" בהמתנה.** `notify_waitlist` נקרא "עם מפתח סבב", אבל לא מוגדר מתי נפתח סבב. אם כל קריאה = סבב, שני ביטולים ברצף שולחים שתי התראות על אותו פינוי (נוגד notification-matrix). אם הסבב הוא `revision`, "התמלא והתפנה שוב" לא שולח. ובזוגי צריך שני מקומות, כך שסבב ליחיד וסבב לזוג שונים.
5. **שמות הסוגים.** `reminder` מול `booking_reminder` מול `session_reminder` בין `notification_templates.type`, המפתח, והקוד שבוחר ערוץ פוש.

**כלל מוצע (מחליף את חלק המפתח ב-AD-12, ומוסיף ל-AD-13):**

> **AD-12 › Types and keys (tightened).** Notification types are a closed `check` list defined once in the migration that creates `notification_templates`, one per row of `notification-matrix.md`: `purchase_new_card, purchase_repeat, booking_confirmed, reminder, waitlist_spot, booking_cancelled, event_changed, event_cancelled, entitlement_changed, broadcast`. `dedupe_key = type || ':' || customer_id || ':' || discriminator`, where the discriminator is fixed per type: `reminder` → `booking_id:revision`; `event_changed`/`event_cancelled` → `event_id:revision`; `waitlist_spot` → `event_id:<seat_class>:<cycle>`; `broadcast` → `broadcast_id`; every other type → the id of the row the RPC just inserted (`booking_id`, `payment_id`, `entitlement_corrections.id`, cancellation `audit_log.id`). `enqueue_notification` requires non-null `customer_id`; purchase notifications for a new customer are enqueued by `join_complete`/`claim_join`, never by `admin_approve_payment`.
>
> **AD-13 › Revision.** `events.revision` is incremented only by a trigger, only when `starts_at`, `ends_at`, `kind` or `status → 'cancelled'` changes. No RPC writes `revision`.
>
> **AD-14 › Waitlist cycle.** `events.waitlist_cycle_single` / `waitlist_cycle_pair` (integers) are incremented by `private.notify_waitlist` only on a transition from `seats_left < n` to `seats_left >= n` (n = 1 or 2), computed inside the same locked transaction before and after the change; `notify_waitlist` sends only on such a transition and only while `now() < registration_closes_at`.

### H6. היומן: צורת before/after, actor, סינון, ו-PII שנשאר אחרי הסרת פרטים

**הזוג:** סשן E3 כותב `private.audit('cancel_booking','booking',id,to_jsonb(old_row),to_jsonb(new_row))`, שורה מלאה. סשן E4 כותב `('booking.cancel','bookings',id,'{"status":"confirmed"}','{"status":"cancelled"}')`, רק שדות שהשתנו. מסך היומן (CAP-26) צריך לסנן "לפי מפגש", ואין לשורת הרשמה עמודת `event_id`. אחד שם אותו ב-`after`, השני לא. ‏`actor_id` בג׳וב ובעסקה של service role הוא `null`, ובמסך מופיע "לא ידוע".

**הבעיה הכבדה:** היומן עם שורות מלאות של `profiles` מכיל טלפון ושם. `notifications.payload`, ‏`idempotency_results.result` ו-`bookings.guest_details` מכילים גם הם פרטים. CAP-30: "אחרי ההסרה לא נשאר מידע מזהה". סשן הסרת הפרטים ינקה את `profiles` ו-`babies` בלבד, והיומן ימשיך להחזיק את הכול.

**כלל מוצע (AD חדש):**

> **AD-19: Audit shape.** `audit_log(id, created_at, actor_id uuid null, actor_kind text check in ('admin','customer','system'), action text, entity_type text, entity_id uuid, customer_id uuid null, event_id uuid null, before jsonb, after jsonb, reason text)`. `action` = the public RPC name (`cancel_booking`, `admin_correct_entitlement`) or `job_<name>`; `entity_type` = the table name (`bookings`). `before`/`after` contain only the changed columns, built by `private.audit_diff(old jsonb, new jsonb, p_table text)`, which drops columns listed in `private.pii_columns` (`profiles.full_name, phone_e164, dietary_notes, babies.*, bookings.guest_details`) and replaces them with `"<changed>"`. `customer_id`/`event_id` are always filled when the entity relates to them (for filtering, CAP-26). `admin_anonymize_customer` also: nulls `payload` of that customer's notifications to a generic text, deletes their `push_subscriptions`, deletes `idempotency_results` where `actor_scope` is theirs, and clears `guest_details`. Nothing in `audit_log` needs rewriting because it never held PII.

### H7. זיהוי כפילויות לא רואה מיובאות שעוד לא הופעלו

**הזוג:** סשן יבוא (E6) יוצר `profiles` בלי משתמשת Auth (AD-3). המייל של המיובאת נשמר... איפה? ב-data-model אין עמודת מייל ב-`profiles` ("המייל נשמר ב-Auth"). סשן היבוא יוסיף `profiles.email`. סשן join (E2) בודק כפילות מול `auth.users.email` ומול `profiles.phone_e164`. לקוחה מיובאת שקיבלה גם קישור רכישה חדש מצטרפת עם אותו מייל: `join_begin` לא מוצא (אין Auth), יוצר חשבון שני. ואז הפעלת קישור ה-claim שלה נכשלת ב-`createUser` (מייל קיים), והטוקן נתקע ב-`claiming`. גם נרמול מייל: Auth מוריד אותיות גדולות, השוואת SQL לא.

**כלל מוצע (תוספת ל-AD-3):**

> **AD-3 › Identity lookup.** There is exactly one lookup, `private.find_identity(p_email text, p_phone text) returns table(profile_id uuid, matched_on text[], has_auth boolean)`, used by `join_begin`, `admin_import_*`, `admin_change_email`, `admin_change_phone` and `admin_approve_payment` (existing-customer search). It normalizes email as `lower(trim(email))` and phone via `private.normalize_phone`, and matches against `auth.users.email`, `profiles.phone_e164` and `profiles.pending_email` (the email of an imported profile not yet activated; cleared when the Auth user is created). Outcomes: none → `claiming`; one profile matched on email (with or without phone) → `existing_account` (or, if `has_auth = false`, `CONFLICT` routed to Tal: the imported customer must activate through her claim link); phone-only match → `existing_account` without revealing which field matched; email and phone matching two different profiles → `conflict`.

### H8. `join_begin` ו-createUser: ענף "עדכון סיסמה" פתוח מדי

**הזוג:** מתזמר join (AD-10 צעד 2: "אם המשתמשת כבר קיימת עם אותו `id`, ממשיכים ומעדכנים סיסמה") מול מתזמר claim (אותו מתזמר, `id = profiles.id`). מיובאת שכבר הפעלה את החשבון מקבלת מטל קישור claim חלופי (CAP-31: "אפשר להפיק מחדש"). מי שמחזיקה את הקישור מגיעה לצעד 2, המשתמשת קיימת עם אותו `id`, והסיסמה שלה מוחלפת. זה איפוס סיסמה שעוקף את תהליך האיפוס. בנוסף, בזמן `claiming` שולחת שנייה (הקישור הועבר) משנה מייל/טלפון/סיסמה של החשבון שנוצר זה עתה, וה-AD אומר ש"כניסה חוזרת ממשיכה מצעד 2" בלי לומר עם איזה קלט.

**כלל מוצע:**

> **AD-10 › Step 2 guard.** The "user already exists, update password" branch applies only when `activation_tokens.state = 'claiming'`, `pending_user_id` = that user, and no `profiles` row with that id has `activated_at` set. Otherwise the orchestrator calls nothing on Auth and returns `ALREADY_ACTIVATED`. `admin_issue_link(purpose => 'claim')` refuses for an activated profile (`ALREADY_ACTIVATED`; Tal uses `reset`). `join_begin` stores `input_hash = sha256(lower(email) || '|' || phone_e164)` on the token when moving to `claiming`; a re-entry with a different `input_hash` while `claiming` is rejected with `LINK_IN_USE` (Tal reissues). `join_begin` returns the same response shape and timing class for `existing_account` and `conflict` toward the browser: the page says "יש כבר חשבון, התחברי" only when the email matched, and never says which field matched.

---

## בינוניים

### M1. אוצר סטטוסים ובעלי מעברים

**הזוג:** `data-model.md › מצבים` מגדיר `activation_token: pending, consumed, expired, revoked`. ה-spine מוסיף `claiming` (ו-C4 מוסיף `awaiting_login`), ו"לטיפול" של `conflict` לא מופיע בשום טבלה. אין ג׳וב שמעביר ל-`expired` (AD-11). מסך `admin/links` קורא את `state` ומציג "ממתין" לקישור שפג. `credit_options.state`, ‏`waitlist_entries.status`, ‏`payments.status`, ‏`refund_requests.status`, ‏`notification_jobs.status` בלי רשימה בכלל. `choice_pending` הוא בוליאני ב-data-model ובמקביל נשמע כמו סטטוס.

> **Conventions › Status vocabulary (new).** The spine lists every status column with its closed value set and the only functions allowed to set each transition: `activation_tokens.state: pending, awaiting_login, claiming, consumed, revoked, conflict` (expired is **derived**: `now() > expires_at and state in ('pending','awaiting_login')`, never stored; a started `claiming` may finish past expiry); `bookings.status: confirmed, cancelled, completed`; `events.status: draft, published, cancelled, completed`; `waitlist_entries.status: active, left, booked, closed`; `cancellation_credits.status: awaiting_options, available, used, refund_pending, refunded, expired` with `choice_pending boolean` orthogonal; `credit_options.state: active, used, lapsed, replaced`; `payments.status: approved, voided`; `refund_requests.status: requested, completed, rejected`; `notification_jobs.status: queued, sending, sent, failed`. Admin "לטיפול" is a read RPC `admin_get_attention_items()` deriving from these states (`conflict`, `claiming` older than 15 minutes, `choice_pending`, open refunds) — no separate task table.

### M2. preview מול ביצוע, והרשאה ב-preview

**הזוג:** `preview_admin_correct_entitlement` (סשן UI של חלון האישור) ו-`admin_correct_entitlement` (סשן RPC) מחשבים את "ההרשמות העתידיות שכבר לא עומדות בערך החדש" בשתי שאילתות. AD-7 אומר שהמבצע "מחשב הכול מחדש", אבל לא אומר עם אותו קוד. בנוסף, סשן שכותב preview כ-`stable` "רק קורא" ישכח את `assert_admin`, ו-preview שמחזיר רשימת נרשמות ותינוקות (`preview_admin_cancel_event`) נגיש ללקוחה.

> **AD-7 › Parity (tightened).** Each sensitive action has one `private.plan_<name>(args) returns jsonb` that computes everything shown and everything applied. `preview_<name>` = auth check + `return private.plan_<name>(…)`. `<name>` = auth check + idempotency + locks + `v_plan := private.plan_<name>(…)` + apply `v_plan`. `preview_<name>` has byte-identical auth checks and the same single grant as `<name>`; a test asserts that a customer calling any `preview_admin_*` gets `NOT_AUTHORIZED`.

### M3. תוכן: מטמון, מדיה, סכמה וגרסת מדיניות

- **תגיות מטמון.** `business_details` מוצג בפוטר ובסרגל הוואטסאפ של כל עמוד. סשן עורך התוכן קורא `updateTag('content:contact')`, והפוטר נשאר ישן בכל שאר העמודים. עמוד הבית משלב תוכן במטמון עם מפגשים דינמיים.
- **פרסום מדיה.** AD-16: "מעתיק ל-`media-public` בתוך פעולת הפרסום". העתקה ב-Storage היא קריאת רשת ולא יכולה להיות בתוך ה-RPC (AD-6). סשן אחד מעתיק ואז קורא RPC, סשן אחר קורא RPC ואז מעתיק. ברצף השני, כשל העתקה משאיר תוכן שפורסם שמצביע על קובץ חסר.
- **סכמת התוכן.** `draft_content`/`published_content` הם jsonb. העורך כותב `{items:[{q,a}]}` לשאלות, והאתר קורא `{faq:[{question,answer}]}`.
- **גרסת מדיניות.** `join_complete` שומר "הסכמה עם גרסת המדיניות" (CAP-29). ל-`content_pages` אין עמודת גרסה. סשן אחד שומר `published_at`, השני מספר בתוך ה-jsonb.

> **AD-16 › Content (tightened).** Cache tags: every cached read uses `cacheTag('content:<page>')` **and** `cacheTag('content:global')`; `business_details`, footer and privacy/accessibility links are tagged `content:global` only, and publishing them calls `updateTag('content:global')`. Section content shapes are defined once as zod schemas in `lib/content/schema.ts` keyed by `content_sections.kind`; the editor validates before save, `admin_publish_content` stores only what passes, the public renderer parses with the same schema and hides a section that fails. Media publish order: (1) privileged copy `media-drafts/<asset_id>` → `media-public/<asset_id>.<ext>` (idempotent, overwrite), (2) `admin_publish_content` checks `exists (select 1 from storage.objects where bucket_id = 'media-public' and name = …)` else `MEDIA_NOT_COPIED`. Hide order: RPC first, then delete object. `content_pages.published_version integer` increments on each publish; `profiles.privacy_policy_version` stores it.

### M4. עובד הפוש מול מרכז ההתראות

- **גרעיניות.** סשן enqueue יוצר `notification_jobs` אחד להתראה. סשן העובד מניח משימה למנוי. ללקוחה עם שלושה מכשירים, כשל באחד גורם ל-retry שמשגר שוב לשניים שכבר קיבלו.
- **תקוע ב-`sending`.** `claim_push_jobs` מעביר ל-`sending`. אם העובד נופל (timeout של פונקציה ב-Vercel), המשימה נשארת `sending` לנצח, ו-`job_cleanup` לא נוגע בה.
- **VAPID.** production ו-preview מחוברים לאותו מסד (Structural Seed). אם מפתחות VAPID שונים בין הסביבות, העובד של preview מקבל 403 על מנויים של production. AD-12 מגדיר רק 404/410. סשן שיוסיף "403 = מנוי לא תקף" ימחק את כל המנויים.
- **מכשיר משותף.** לקוחה A מתנתקת ו-B מתחברת באותו דפדפן. ה-endpoint זהה ורשום ל-A, ו-B לא יכולה לעדכן את השורה (RLS). ההתראות של A (עם פרטי המפגש שלה) ממשיכות להגיע למכשיר.
- **`target_path`.** ה-SW פותח `target_path` מהמטען. ערך שלא מתחיל ב-`/` הוא open redirect.

> **AD-12 › Worker (tightened).** One `notification_jobs` row per notification; the worker fans out to the customer's enabled subscriptions and records `notification_deliveries(job_id, subscription_id) unique`; a retry skips delivered pairs. `claim_push_jobs` sets `status = 'sending', lease_until = now() + interval '2 minutes'` and also reclaims `sending` rows whose `lease_until < now()`. `push_subscriptions` stores `vapid_public_key`; the worker only sends to rows whose key equals its own `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and never deletes on 401/403 (only 404/410). VAPID keys are one pair per Supabase project, identical in every Vercel environment wired to it. Subscriptions are written only via `register_push_subscription(p_endpoint, p_keys, p_platform)` (security definer, authenticated), which deletes the same endpoint from any other customer; logout calls `unregister_push_subscription(p_endpoint)`. `target_path` is validated by `check (target_path ~ '^/(me|admin)(/|$)')`.

### M5. "השתתפה בעבר" ו"לא פעילה": שני כותבים לאותה עמודה

**הזוג:** זכאות להיכרות (CAP-10) נבדקת ב-`book_session` מול `profiles.prior_participation`. ‏`job_complete_events` מעדכן `prior_participation = true` כשהרשמה הושלמה. טל מתקנת ל-`false` (CAP-10), והג׳וב לא דורס, אבל סשן ההרשמה השני גוזר מ-`exists (bookings completed)` ומתעלם מהתיקון. אותו דבר ב-`activity_status`: הג׳וב מסמן `inactive`, ו"רכישה או הרשמה מחזירות לפעילה" נכתב בשני RPC שונים (או לא נכתב באחד מהם).

> **AD-14 › Participation and activity.** `profiles.prior_participation_override boolean null` is written only by import and `admin_correct_prior_participation`. Eligibility is `private.has_participated(customer) = coalesce(override, exists(bookings where status in ('completed') or (status = 'confirmed' and intro)))`, used by `plan_funding` and every preview. No job writes it. `activity_status` is not stored: `private.customer_activity(customer)` derives it at read time (last completed booking / account creation vs `inactivity_months` snapshot rules of CAP-28); `private.job_mark_inactive` is removed from AD-11, or, if a stored column is kept for list performance, it is written only by that job and recomputed by the same function, never by business RPCs.

### M6. תוצאת ביטול: מתי הלקוחה בוחרת, והגבול המדויק

**הזוג:** סשן `cancel_booking` מקבל `p_choice text` (החזר/זיכוי) בזמן הביטול. סשן `/me/bookings` בונה מסך "הזיכויים שלי" שבו בוחרים אחר כך, כמו בביטול מצד העסק (`choice_pending`). ‏preview מציג מועד ביטול אחרון ומשווה `now() < deadline`, וה-RPC `now() <= deadline` ("בדיוק 48 מותר"). ‏`monetary_basis` מחושב פעם ממחיר המוצר, פעם מ-`payments.amount_agorot`, ופעם מחולק ביחידות.

> **AD-20: Cancellation outcomes.** `private.can_self_cancel(booking_id) returns boolean` = `now() <= private.cancel_deadline(booking)` is the only boundary check, returned by read RPCs as `can_self_cancel` and re-evaluated inside `cancel_booking`/`move_booking`. Self-cancel of a single/paired entry requires `p_choice in ('refund','credit')` in the same call (no pending state). Admin cancel inside the window creates a credit with no choice. Business cancel creates a credit with `choice_pending = true`, resolved later by `choose_credit_outcome(p_credit_id, p_choice)`. `monetary_basis_agorot` is computed once at credit creation by `private.monetary_basis(booking_id)` = sum over `booking_allocations` of `payments.amount_agorot * units / entitlements.original_units` (integer, remainder to the last allocation), and is never recomputed; bookings funded by a punch-card offset return `MANUAL_HANDLING_REQUIRED`. `move_booking` calls the same `private.cancel_core` and `private.book_core` as the single actions.

### M7. אדמין צריכה מייל, והוא נמצא ב-`auth.users`

**הזוג:** מסך `admin/customers` (CAP-25) מציג מייל. RLS לא נותן ל-`authenticated` לקרוא `auth.users`. סשן אחד פותר ב-`listUsers` של Admin API ב-`lib/server/privileged/account-admin.ts` (AD-4 מתיר "Auth Admin API"), סשן הייצוא (`app/api/admin/export`) פותר ב-RPC definer, וסשן שלישי מוסיף `profiles.email` כמראה. שלוש אמיתות, ושתיים לא יתעדכנו בשינוי מייל או בהסרת פרטים.

> **AD-4 › Reading Auth data (tightened).** Admin reads of email go only through `admin_list_customers(p_filter jsonb)` / `admin_get_customer(p_id)` (security definer, `private.is_admin()` check, joins `auth.users` by id). No mirror column of email in `public` (except `pending_email`, H7). The Auth Admin API in `lib/server/privileged` is used only for writes (create, password, email change, delete), never for listing or reading customers.

### M8. טוקן בכתובת: דליפה דרך Referer ולוגים

**הזוג:** עמוד `/join/[token]` (סשן E2) מול ה-layout הציבורי (סשן E5) שטוען Google Fonts, תמונות מ-Storage וקישור וואטסאפ. כל בקשה חיצונית נושאת `Referer` עם הטוקן המלא. בנוסף `get_join_token_view` צריך להיות נגיש לאורחת, ו-AD-5 אוסר grant ל-anon. סשן אחד יעשה grant ל-anon (הפרה), סשן אחר יקרא דרך service client (לא ברשימת AD-4).

> **AD-16 › Token routes.** `app/(auth)/join/[token]` and `reset/[token]` send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, load no third-party resources (fonts self-hosted via `next/font`), and do not log the path (strip `[token]` in any logging). The page reads through the privileged orchestrator (`join.ts#getTokenView`) calling the service-role RPC `join_view(p_token)`, which returns only `{state_public: 'valid'|'used'|'expired'|'revoked', product_name, amount_agorot, expires_on_preview, purpose}` and, for `claim`, a masked email (`t***@g***.com`). No `anon` grant exists on any token RPC. Rate limiting for `join_*`/`reset_*` (currently deferred) is a precondition for exposing the route in production, keyed by IP + token id.

### M9. `CRON_SECRET` ו-preview deployments

**הזוג:** AD-11 שולח `CRON_SECRET` מ-Vault לכתובת אחת. כל deployment של preview מקבל את אותו env (Vercel), כך שכל preview חושף עובד חי מול אותו תור. סשן אחד משווה `header === secret` (לא בזמן קבוע) ומקבל גם `GET`. סשן אחר בודק `Authorization: Bearer`, והג׳וב שולח `x-cron-secret`.

> **AD-11 › Worker auth (tightened).** `job_invoke_push_worker` sends `POST` with header `Authorization: Bearer <cron_secret>` and body `{}`; the route accepts only `POST`, compares with `crypto.timingSafeEqual` on equal-length buffers, returns 401 otherwise, and is `export const dynamic = 'force-dynamic'`. `CRON_SECRET` is set only in the Vercel environment that the Vault `app_url` points to; other environments leave it unset and the route returns 503 when it is missing. Rotating the secret = update Vault and env together.

---

## נמוכים

### L1. סימון נקראה

AD-1 מתיר UPDATE ישיר ל"סימון התראה כנקראה". סשן אחד מאפשר `update(read_at)` וסשן אחר בונה `mark_notifications_read`. הלקוחה יכולה לשים `read_at` בעבר ולהפעיל ניקוי מוקדם של ההתראות שלה (לא מזיק מאוד, אבל שובר את 90 הימים).

> Mark-as-read is only `mark_notifications_read(p_ids uuid[] default null)` (null = all), which sets `read_at = now()` where `read_at is null`. No column grant on `notifications` to `authenticated`. Admin reading a customer's notifications never sets `read_at`. Push `notificationclick` does not mark read.

### L2. `registration_closes_at` אחרי שינוי שעת מפגש

ה-data-model שומר את הערך על המפגש, ו-AD-8 מחשב אותו בפונקציה. סשן עריכת מפגש לא מחשב מחדש כשמשנים שעה, או מחשב מחדש ודורס ערך שטל קבעה ידנית.

> `events.registration_closes_at` is stored; `events.registration_close_overridden boolean`. On `starts_at` change, a trigger recomputes it via `private.registration_closes_at(starts_at, business_settings rule snapshot on the event)` unless overridden.

### L3. `detail` של שגיאה

`detail` הוא "JSON" בלי סכמה. `lib/errors.ts` יצפה ל-`{seats_left}` וה-RPC ישלח `{remaining}`.

> Each error code that carries detail declares its keys next to the code in `lib/errors.ts` (single table), and the SQL raises with exactly those keys; unknown keys are ignored.

---

## ממה ה-spine כבר מגן היטב

- תזכורות נגזרות מהמצב (AD-13) במקום משימות שמורות. זה סוגר מחלקה שלמה של באגים.
- `private.enqueue_notification` כנקודת כניסה אחת, ורינדור בזמן ההכנסה.
- הפרדה בין תזמור Auth (TS) לבין שינויים עסקיים (SQL), עם מצב ביניים מפורש.
- AD-8: החלטה על זמינות רק מהשרת.

## סדר מומלץ לתיקון

1. **לפני המיגרציה הראשונה של RPC (E1/E2):** C1, C2, C3, C4, H3, H1 (החלק של `profiles` ו-`bookings`), H6, M1 (אוצר הסטטוסים של טוקנים).
2. **לפני E3:** H2, H4, H5 (סוגים ומפתחות), M2, M5, M6.
3. **לפני E5:** M3, M4, M8, M9, L1.
4. **לפני E6:** H7, H8 (ענף claim).
