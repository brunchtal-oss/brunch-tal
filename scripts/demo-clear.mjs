// Dev only (story 5.18): prepares, and never runs, the SQL that removes data
// from the DEV Supabase project (user decision 2026-10-08). The user reviews
// the file and runs it in the SQL Editor of the dev project, as with a
// migration that drops.
//
//   npm run demo:clear                          # -> .demo-clear.local.sql
//   node scripts/demo-clear.mjs --dev-test-data # -> .dev-test-clear.local.sql
//
// The first removes the demo only: the customers on demo.example.com, the
// rows of .demo-data.local.json (sessions, payments) and everything derived
// from them, Auth users included. The second removes every customer that is
// not of the demo and not an admin, with their payments, entitlements,
// bookings, links, notifications and notes, and every session that is not
// of the demo with its work sheet; products, concepts, payment methods,
// content, photos, settings and the admins stay. Run it once, before the
// first demo:seed.
//
// The file is one transaction: it first stops unless dev-admin@example.com
// exists, turns off the append-only trigger of entitlement_movements only for
// that delete (set local session_replication_role), deletes in foreign-key
// order, and keeps audit_log and idempotency_results (audit_log rows of a
// removed customer lose only their customer_id, which points at the removed
// profile). Every id in it is a validated uuid literal.
//
// This script only reads: through DEV_DATABASE_URL (checked against the
// project ref of NEXT_PUBLIC_SUPABASE_URL first) in a read-only transaction.
// It prints the row count per table and the path of the file.

import { existsSync, readFileSync, writeFileSync } from "node:fs"

import pg from "pg"

import { DEMO_DOMAIN } from "./demo-cast.mjs"
import { devRef } from "./dev-guard.mjs"
import { isUuid } from "./demo-plan.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const STATE_FILE = ".demo-data.local.json"
const ADMIN_EMAIL = "dev-admin@example.com"
const devTestData = process.argv.includes("--dev-test-data")
const OUT_FILE = devTestData ? ".dev-test-clear.local.sql" : ".demo-clear.local.sql"

if (
  !devRef({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    databaseUrl: process.env.DEV_DATABASE_URL,
  })
) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL."
  )
  process.exit(1)
}

// SSL without certificate verification, as supabase/tests/support/db.ts
// (dev project, fictitious data only).
function connectionConfig(url) {
  const parsed = new URL(url)
  const sslKeys = ["sslmode", "sslcert", "sslkey", "sslrootcert"]
  parsed.search = new URLSearchParams(
    [...parsed.searchParams].filter(([key]) => !sslKeys.includes(key))
  ).toString()
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  }
}

// The ids the seed recorded (only valid uuids).
function stateIds() {
  const ids = { events: [], payments: [], customers: [] }
  if (!existsSync(STATE_FILE)) return { found: false, ...ids }
  let items
  try {
    items = JSON.parse(readFileSync(STATE_FILE, "utf8")).items ?? {}
  } catch {
    console.error(`${STATE_FILE} פגום.`)
    process.exit(1)
  }
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith("event:") && isUuid(value?.event_id)) {
      ids.events.push(value.event_id)
    }
    if (key.startsWith("payment:") && isUuid(value?.payment_id)) {
      ids.payments.push(value.payment_id)
    }
    if (key.startsWith("join:") && isUuid(value?.customer_id)) {
      ids.customers.push(value.customer_id)
    }
  }
  return { found: true, ...ids }
}

const uuids = (rows, column = "id") => {
  const ids = rows.map((row) => row[column])
  for (const id of ids) {
    if (!isUuid(id)) throw new Error("unexpected id")
  }
  return [...new Set(ids)]
}

const literal = (ids) => {
  for (const id of ids) {
    if (!isUuid(id)) throw new Error("unexpected id")
  }
  return `'{${ids.join(",")}}'::uuid[]`
}

async function main() {
  const file = stateIds()
  const client = new pg.Client(connectionConfig(process.env.DEV_DATABASE_URL))
  await client.connect()
  try {
    await client.query("begin read only")
    const q = async (sql, params = []) => (await client.query(sql, params)).rows

    const admin = await q("select id from auth.users where lower(email) = $1", [
      ADMIN_EMAIL,
    ])
    if (admin.length === 0) {
      console.error(
        `אין אדמין פיתוח (${ADMIN_EMAIL}) במסד, ולכן זה כנראה לא פרויקט הפיתוח. לא נכתב קובץ.`
      )
      process.exitCode = 1
      return
    }
    const admins = uuids(await q("select user_id from public.admin_roles"), "user_id")
    const demoUsers = uuids(
      await q("select id from auth.users where lower(email) like $1", [
        `%@${DEMO_DOMAIN}`,
      ])
    )
    const demoCustomers = [...new Set([...demoUsers, ...file.customers])]

    let users
    let customers
    let payments
    let events
    if (devTestData) {
      const keep = [...new Set([...demoCustomers, ...admins])]
      users = uuids(await q("select id from auth.users where id <> all($1::uuid[])", [keep]))
      customers = uuids(
        await q("select id from public.profiles where id <> all($1::uuid[])", [keep])
      )
      payments = uuids(
        await q(
          `select id from public.payments
           where (customer_id is null or customer_id <> all($1::uuid[]))
             and id <> all($2::uuid[])`,
          [demoCustomers, file.payments]
        )
      )
      events = uuids(
        await q("select id from public.events where id <> all($1::uuid[])", [
          file.events,
        ])
      )
    } else {
      if (!file.found && demoUsers.length === 0) {
        console.log("אין מה למחוק: אין קובץ מזהים ואין לקוחות הדגמה במסד.")
        return
      }
      if (!file.found) {
        console.log(
          `אזהרה: הקובץ ${STATE_FILE} חסר. נמחקות רק לקוחות ההדגמה שהצטרפו (@${DEMO_DOMAIN}) וכל מה ששייך להן. לא יימחקו מפגשי ההדגמה, ולא רכישות שעוד לא שויכו ללקוחה (למשל רכישה שממתינה להצטרפות, או קישור שנשאר בהתנגשות), יחד עם ההרשמות והקישורים שלהן. אותם צריך למחוק ידנית, או להחזיר את הקובץ ולהריץ שוב.`
        )
      }
      users = uuids(
        await q("select id from auth.users where id = any($1::uuid[])", [demoCustomers])
      )
      customers = uuids(
        await q("select id from public.profiles where id = any($1::uuid[])", [
          demoCustomers,
        ])
      )
      payments = uuids(
        await q(
          `select id from public.payments
           where customer_id = any($1::uuid[]) or id = any($2::uuid[])`,
          [customers, file.payments]
        )
      )
      events = uuids(
        await q("select id from public.events where id = any($1::uuid[])", [
          file.events,
        ])
      )
    }
    // Every Auth user and profile id of the removed customers.
    const people = [...new Set([...users, ...customers])]

    // The bookings and entitlements of the removed customers, payments and
    // sessions. A row on a demo session bought by another customer brings
    // its payment (and so its link) along; repeated until nothing is added.
    let bookings = []
    let entitlements = []
    for (;;) {
      bookings = uuids(
        await q(
          `select id from public.bookings
           where customer_id = any($1::uuid[]) or event_id = any($2::uuid[])
              or payment_id = any($3::uuid[])`,
          [customers, events, payments]
        )
      )
      entitlements = uuids(
        await q(
          `select id from public.entitlements
           where customer_id = any($1::uuid[]) or payment_id = any($2::uuid[])
              or pinned_event_id = any($3::uuid[])`,
          [customers, payments, events]
        )
      )
      const linked = uuids(
        await q(
          `select payment_id from public.bookings
           where id = any($1::uuid[]) and payment_id is not null
           union
           select payment_id from public.entitlements
           where id = any($2::uuid[]) and payment_id is not null`,
          [bookings, entitlements]
        ),
        "payment_id"
      )
      const added = linked.filter((id) => !payments.includes(id))
      if (added.length === 0) break
      payments = [...payments, ...added]
    }
    const allocations = uuids(
      await q(
        `select id from public.booking_allocations
         where booking_id = any($1::uuid[]) or entitlement_id = any($2::uuid[])`,
        [bookings, entitlements]
      )
    )
    const movements = uuids(
      await q(
        `select id from public.entitlement_movements
         where entitlement_id = any($1::uuid[]) or booking_id = any($2::uuid[])`,
        [entitlements, bookings]
      )
    )
    const tokens = uuids(
      await q(
        `select id from public.activation_tokens
         where payment_id = any($1::uuid[]) or customer_id = any($2::uuid[])
            or bound_user_id = any($2::uuid[]) or pending_user_id = any($2::uuid[])`,
        [payments, people]
      )
    )
    // A customer's notifications, and an admin notification whose key names
    // a removed row (e.g. admin_card_expiring: entitlement_id:expires_on).
    const refs = [
      ...people,
      ...payments,
      ...entitlements,
      ...bookings,
      ...events,
      ...tokens,
    ]
    const notifications = uuids(
      await q(
        `select n.id from public.notifications n
         where n.recipient_id = any($1::uuid[])
            or (n.recipient_kind = 'admin' and exists (
                  select 1 from unnest($2::text[]) r
                  where position(r in n.dedupe_key) > 0))`,
        [people, refs]
      )
    )
    const jobs = uuids(
      await q(
        "select id from public.notification_jobs where notification_id = any($1::uuid[])",
        [notifications]
      )
    )
    const deliveries = Number(
      (
        await q(
          "select count(*) as n from public.notification_deliveries where job_id = any($1::uuid[])",
          [jobs]
        )
      )[0].n
    )
    const subscriptions = uuids(
      await q("select id from public.push_subscriptions where user_id = any($1::uuid[])", [
        people,
      ])
    )
    const sheets = uuids(
      await q("select id from public.work_sheets where event_id = any($1::uuid[])", [
        events,
      ])
    )
    const dishes = uuids(
      await q("select id from public.work_dishes where sheet_id = any($1::uuid[])", [
        sheets,
      ])
    )
    const tasks = uuids(
      await q("select id from public.work_tasks where dish_id = any($1::uuid[])", [dishes])
    )
    const shopping = uuids(
      await q("select id from public.shopping_items where sheet_id = any($1::uuid[])", [
        sheets,
      ])
    )
    const notes = uuids(
      await q("select id from public.customer_notes where customer_id = any($1::uuid[])", [
        customers,
      ])
    )
    const babies = uuids(
      await q("select id from public.babies where customer_id = any($1::uuid[])", [
        customers,
      ])
    )
    const audit = uuids(
      await q("select id from public.audit_log where customer_id = any($1::uuid[])", [
        customers,
      ])
    )
    await client.query("rollback")

    const counts = [
      ["notification_deliveries", deliveries],
      ["notification_jobs", jobs.length],
      ["notifications", notifications.length],
      ["push_subscriptions", subscriptions.length],
      ["entitlement_movements", movements.length],
      ["booking_allocations", allocations.length],
      ["bookings", bookings.length],
      ["entitlements", entitlements.length],
      ["activation_tokens", tokens.length],
      ["payments", payments.length],
      ["shopping_items", shopping.length],
      ["work_tasks", tasks.length],
      ["work_dishes", dishes.length],
      ["work_sheets", sheets.length],
      ["events", events.length],
      ["customer_notes", notes.length],
      ["babies", babies.length],
      ["profiles", customers.length],
      ["auth.users", users.length],
    ]

    const del = (table, ids) =>
      ids.length === 0
        ? `-- ${table}: nothing`
        : `delete from ${table} where id = any(${literal(ids)});`

    const sql = [
      `-- ${devTestData ? "Dev test data" : "Demo data"} removal, prepared by scripts/demo-clear.mjs`,
      `-- on ${new Date().toISOString()}. Review it, then run it in the SQL Editor`,
      "-- of the DEV project (a new, empty query). One transaction.",
      "",
      "begin;",
      "",
      "-- Guard: only the dev project has the dev admin.",
      "do $guard$",
      "begin",
      "  if not exists (",
      `    select 1 from auth.users where lower(email) = '${ADMIN_EMAIL}'`,
      "  ) then",
      `    raise exception 'not the dev project: ${ADMIN_EMAIL} is missing';`,
      "  end if;",
      "end",
      "$guard$;",
      "",
      jobs.length === 0
        ? "-- public.notification_deliveries: nothing"
        : `delete from public.notification_deliveries where job_id = any(${literal(jobs)});`,
      del("public.notification_jobs", jobs),
      del("public.notifications", notifications),
      del("public.push_subscriptions", subscriptions),
      "",
      "-- entitlement_movements is append-only (a trigger); off for this delete only.",
      "set local session_replication_role = replica;",
      del("public.entitlement_movements", movements),
      "set local session_replication_role = origin;",
      "",
      del("public.booking_allocations", allocations),
      del("public.bookings", bookings),
      del("public.entitlements", entitlements),
      del("public.activation_tokens", tokens),
      del("public.payments", payments),
      del("public.shopping_items", shopping),
      del("public.work_tasks", tasks),
      del("public.work_dishes", dishes),
      del("public.work_sheets", sheets),
      del("public.events", events),
      del("public.customer_notes", notes),
      del("public.babies", babies),
      "",
      "-- audit_log stays; its rows only stop pointing at the removed profiles.",
      audit.length === 0
        ? "-- public.audit_log: nothing"
        : `update public.audit_log set customer_id = null where id = any(${literal(audit)});`,
      del("public.profiles", customers),
      del("auth.users", users),
      "",
      "commit;",
      "",
    ].join("\n")

    writeFileSync(OUT_FILE, sql)

    console.log(devTestData ? "ניקוי נתוני הבדיקה:" : "מחיקת ההדגמה:")
    for (const [table, n] of counts) console.log(`  ${table}: ${n}`)
    console.log(`  audit_log (רק customer_id מתאפס): ${audit.length}`)
    console.log("")
    console.log(`הקובץ: ${OUT_FILE}`)
    console.log(
      "לא נמחק כלום. בודקים את הקובץ ומריצים אותו ב-SQL Editor של פרויקט הפיתוח (שאילתה חדשה וריקה)."
    )
    if (!devTestData) {
      console.log(`אחרי ההרצה אפשר למחוק את ${STATE_FILE}, או להשאיר אותו: הרצה הבאה של demo:seed תתחיל מחדש.`)
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
