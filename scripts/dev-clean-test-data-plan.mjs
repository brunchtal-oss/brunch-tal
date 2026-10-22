// Story 5.20 (fix 8): the pure part of scripts/dev-clean-test-data.mjs (no
// env, no pg), tested in test/dev-clean-test-data.test.ts. It says which
// rows are test data (the `test_` prefix that supabase/tests writes), in
// which foreign-key order they go, and what must never be touched.
//
// SQL text uses $NAME placeholders for an id set computed earlier (a uuid[]
// parameter); bind() turns them into $1, $2, ... with the values.

export const TEST_PREFIX = "test_"

// Never deleted or changed (spec 5.20, Boundaries › Never).
export const PROTECTED_EMAILS = [
  "dev-customer@example.com",
  "dev-admin@example.com",
  "maya.barak@demo.example.com",
]
export const PROTECTED_DOMAIN = "demo.example.com"
export const PROTECTED_NAMES = ["גלית ותיקה בדויה"]

/** True for a name or email the db tests wrote (`test_<run>_<label>`). */
export function isTestName(value) {
  return typeof value === "string" && value.startsWith(TEST_PREFIX)
}

/** True for a protected account's email (case-insensitive). */
export function isProtectedEmail(email) {
  if (typeof email !== "string") return false
  const lower = email.trim().toLowerCase()
  return (
    PROTECTED_EMAILS.includes(lower) || lower.endsWith(`@${PROTECTED_DOMAIN}`)
  )
}

// LIKE pattern of the prefix ("_" escaped).
const LIKE = `'test\\_%'`

// The protected ids: their Auth users and profiles.
export const PROTECTED_SQL = `
  select u.id from auth.users u
  where lower(u.email) = any($EMAILS::text[])
     or lower(u.email) like '%@' || $DOMAIN::text
  union
  select p.id from public.profiles p where p.full_name = any($NAMES::text[])`

// The id sets, in order: each may use the sets above it. Every query
// returns one uuid column, `id`.
export const SETS = [
  ["U", `select u.id from auth.users u where u.email like ${LIKE}`],
  [
    "P",
    `select p.id from public.profiles p
     where p.full_name like ${LIKE} or p.id = any($U)`,
  ],
  ["PU", `select x as id from unnest($U || $P) x`],
  ["PROD", `select p.id from public.products p where p.name like ${LIKE}`],
  ["PM", `select m.id from public.payment_methods m where m.name like ${LIKE}`],
  ["CON", `select c.id from public.concepts c where c.name like ${LIKE}`],
  [
    "E",
    `select e.id from public.events e
     where e.description like ${LIKE} or e.concept_id = any($CON)`,
  ],
  [
    "PAY",
    `select p.id from public.payments p
     where p.customer_id = any($P) or p.product_id = any($PROD)
        or p.payment_method_id = any($PM)
        or p.id in (
          select e.payment_id from public.entitlements e
          where e.pinned_event_id = any($E)
        )`,
  ],
  [
    "ENT",
    `select e.id from public.entitlements e
     where e.customer_id = any($P) or e.payment_id = any($PAY)
        or e.pinned_event_id = any($E)`,
  ],
  [
    "BOOK",
    `select b.id from public.bookings b
     where b.customer_id = any($P) or b.event_id = any($E)
        or b.payment_id = any($PAY)`,
  ],
  [
    "CRED",
    `select c.id from public.cancellation_credits c
     where c.customer_id = any($P) or c.source_entitlement_id = any($ENT)
        or c.origin_booking_id = any($BOOK)`,
  ],
  [
    "CORR",
    `select c.id from public.entitlement_corrections c
     where c.entitlement_id = any($ENT) or c.related_event_id = any($E)`,
  ],
  [
    "TOK",
    `select t.id from public.activation_tokens t
     where t.payment_id = any($PAY) or t.customer_id = any($P)
        or t.bound_user_id = any($PU) or t.pending_user_id = any($PU)`,
  ],
  [
    "SHEETS",
    `select s.id from public.work_sheets s where s.event_id = any($E)`,
  ],
  // Any id a notification's path or an audit row may name.
  [
    "ALL",
    `select x as id
     from unnest($PU || $PROD || $PM || $CON || $E || $PAY || $ENT || $BOOK
                 || $CRED || $CORR || $TOK || $SHEETS) x`,
  ],
  [
    "N",
    `select n.id from public.notifications n
     where n.recipient_id = any($PU)
        or (
          n.recipient_kind = 'admin'
          and exists (
            select 1 from unnest($ALL) x
            where strpos(n.target_path, x::text) > 0
          )
        )`,
  ],
  [
    "JOBS",
    `select j.id from public.notification_jobs j
     where j.notification_id = any($N)`,
  ],
  // An admin role of a test user, or one left without an Auth user and
  // without a profile.
  [
    "ADM",
    `select r.user_id as id from public.admin_roles r
     where r.user_id = any($U)
        or (
          not exists (select 1 from auth.users u where u.id = r.user_id)
          and not exists (select 1 from public.profiles p where p.id = r.user_id)
        )`,
  ],
]

// The deletes, in foreign-key order (children first). `replica`: the
// append-only trigger of entitlement_movements is off for that delete only.
export const STEPS = [
  {
    table: "public.notification_deliveries",
    where: `job_id = any($JOBS) or subscription_id in (
      select s.id from public.push_subscriptions s where s.user_id = any($PU))`,
  },
  { table: "public.notification_jobs", where: "id = any($JOBS)" },
  { table: "public.notifications", where: "id = any($N)" },
  { table: "public.push_subscriptions", where: "user_id = any($PU)" },
  {
    table: "public.waitlist_entries",
    where: "customer_id = any($P) or event_id = any($E)",
  },
  {
    table: "public.refund_requests",
    where: `customer_id = any($P) or payment_id = any($PAY)
      or credit_id = any($CRED) or booking_id = any($BOOK)`,
  },
  {
    table: "public.credit_options",
    where: "credit_id = any($CRED) or event_id = any($E)",
  },
  {
    table: "public.entitlement_correction_bookings",
    where: "correction_id = any($CORR) or booking_id = any($BOOK)",
  },
  { table: "public.entitlement_corrections", where: "id = any($CORR)" },
  {
    table: "public.booking_allocations",
    where: `booking_id = any($BOOK) or entitlement_id = any($ENT)
      or credit_id = any($CRED)`,
  },
  {
    table: "public.entitlement_movements",
    where: "entitlement_id = any($ENT) or booking_id = any($BOOK)",
    replica: true,
  },
  { table: "public.cancellation_credits", where: "id = any($CRED)" },
  { table: "public.bookings", where: "id = any($BOOK)" },
  { table: "public.entitlements", where: "id = any($ENT)" },
  { table: "public.activation_tokens", where: "id = any($TOK)" },
  { table: "public.payments", where: "id = any($PAY)" },
  { table: "public.shopping_items", where: "sheet_id = any($SHEETS)" },
  {
    table: "public.work_tasks",
    where: `dish_id in (
      select d.id from public.work_dishes d where d.sheet_id = any($SHEETS))`,
  },
  { table: "public.work_dishes", where: "sheet_id = any($SHEETS)" },
  { table: "public.work_sheets", where: "id = any($SHEETS)" },
  {
    table: "public.event_products",
    where: "event_id = any($E) or product_id = any($PROD)",
  },
  { table: "public.events", where: "id = any($E)" },
  { table: "public.customer_notes", where: "customer_id = any($P)" },
  { table: "public.babies", where: "customer_id = any($P)" },
  {
    table: "public.audit_log",
    where: `customer_id = any($P) or event_id = any($E)
      or entity_id = any($ALL) or actor_id = any($PU)`,
  },
  {
    table: "private.idempotency_results",
    where: `actor_scope in (
      select x::text from unnest($PU) x
      union all
      select 'token:' || x::text from unnest($TOK) x)`,
  },
  { table: "public.profiles", where: "id = any($P)" },
  { table: "public.admin_roles", where: "user_id = any($ADM)" },
  { table: "auth.users", where: "id = any($U)" },
  { table: "public.products", where: "id = any($PROD)" },
  { table: "public.payment_methods", where: "id = any($PM)" },
  { table: "public.concepts", where: "id = any($CON)" },
]

// Each must count 0, or nothing is deleted. $PROT: the protected ids; a
// row of a customer who is not test data ($P) tied to a test_ session,
// product or payment method also stops the run (it would be deleted).
export const PROTECTION_CHECKS = [
  [
    "a protected account among the test users",
    "select count(*) from unnest($U) x where x = any($PROT)",
  ],
  [
    "a protected profile among the test profiles",
    "select count(*) from unnest($P) x where x = any($PROT)",
  ],
  [
    "a protected account among the admin roles",
    "select count(*) from unnest($ADM) x where x = any($PROT)",
  ],
  [
    "a booking of a protected customer",
    "select count(*) from public.bookings b where b.id = any($BOOK) and b.customer_id = any($PROT)",
  ],
  [
    "a payment of a protected customer",
    "select count(*) from public.payments p where p.id = any($PAY) and p.customer_id = any($PROT)",
  ],
  [
    "an entitlement of a protected customer",
    "select count(*) from public.entitlements e where e.id = any($ENT) and e.customer_id = any($PROT)",
  ],
  [
    "a booking of a customer who is not test data",
    "select count(*) from public.bookings b where b.id = any($BOOK) and b.customer_id is not null and not (b.customer_id = any($P))",
  ],
  [
    "an entitlement of a customer who is not test data",
    "select count(*) from public.entitlements e where e.id = any($ENT) and e.customer_id is not null and not (e.customer_id = any($P))",
  ],
  [
    "a credit of a customer who is not test data",
    "select count(*) from public.cancellation_credits c where c.id = any($CRED) and c.customer_id is not null and not (c.customer_id = any($P))",
  ],
  [
    "a payment of a customer who is not test data",
    "select count(*) from public.payments p where p.id = any($PAY) and p.customer_id is not null and not (p.customer_id = any($P))",
  ],
]

// Listed for a manual look only, never deleted: a profile without an Auth
// user that is not test data.
export const ORPHAN_PROFILES_SQL = `
  select p.id from public.profiles p
  where not exists (select 1 from auth.users u where u.id = p.id)
    and p.full_name not like ${LIKE}
    and p.anonymized_at is null
  order by p.id`

/**
 * Replaces $NAME placeholders with $1, $2, ... and returns the values (each
 * set as a uuid[], EMAILS/NAMES/DOMAIN as given). Throws on an unknown name.
 *
 * @param {string} sql
 * @param {Record<string, unknown>} values
 * @returns {{ text: string, values: unknown[] }}
 */
export function bind(sql, values) {
  const order = []
  const text = sql.replace(/\$([A-Z]+)/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`unknown set ${name}`)
    let index = order.indexOf(name)
    if (index < 0) {
      order.push(name)
      index = order.length - 1
    }
    const cast =
      Array.isArray(values[name]) && !["EMAILS", "NAMES"].includes(name)
        ? "::uuid[]"
        : ""
    return `$${index + 1}${cast}`
  })
  return { text, values: order.map((name) => values[name]) }
}

/** The set names a query reads ($NAME). */
export function namesIn(sql) {
  return [...new Set([...sql.matchAll(/\$([A-Z]+)/g)].map((m) => m[1]))]
}
