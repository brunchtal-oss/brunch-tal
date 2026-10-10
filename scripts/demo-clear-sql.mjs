// Story 5.19: the pure part of scripts/demo-clear.mjs (no env, no pg), tested
// in test/demo-clear.test.ts. It turns the ids demo-clear collected into the
// SQL file the user reviews and runs in the SQL Editor of the dev project.

import { isUuid } from "./demo-plan.mjs"

export const ADMIN_EMAIL = "dev-admin@example.com"

const literal = (ids) => {
  for (const id of ids) {
    if (!isUuid(id)) throw new Error("unexpected id")
  }
  return `'{${ids.join(",")}}'::uuid[]`
}

const del = (table, ids) =>
  ids.length === 0
    ? `-- ${table}: nothing`
    : `delete from ${table} where id = any(${literal(ids)});`

// Story 3.7, optional: refund_requests, credit_options, cancellation_credits.
const CREDIT_LISTS = ["refunds", "options", "credits"]

// The delete lists, by the key of ids (admins is not one of them).
const DELETE_LISTS = [
  "jobs",
  "notifications",
  "subscriptions",
  "movements",
  "allocations",
  "bookings",
  "entitlements",
  "tokens",
  "payments",
  "shopping",
  "tasks",
  "dishes",
  "sheets",
  "events",
  "notes",
  "babies",
  "audit",
  "customers",
  "users",
]

/**
 * The removal SQL: one transaction, a guard that stops unless the dev admin
 * exists, then deletes in foreign-key order. Throws (and no file is
 * written) when a list of DELETE_LISTS or admins is missing or not an
 * array, when an id of ids.admins is in any delete list, and "unexpected
 * id" for an id that is not a uuid.
 *
 * @param {Record<string, string[]>} ids every list of DELETE_LISTS, and admins
 * @param {"demo" | "dev-test-data"} mode only changes the header line
 * @param {string} now the ISO timestamp in the header
 * @returns {string}
 */
export function buildClearSql(ids, mode, now) {
  for (const name of [...DELETE_LISTS, "admins"]) {
    if (!Array.isArray(ids[name])) {
      throw new Error(`חסרה הרשימה ${name}. לא נכתב קובץ.`)
    }
  }
  const admins = new Set(ids.admins)
  for (const name of DELETE_LISTS) {
    if (ids[name].some((id) => admins.has(id))) {
      throw new Error("מזהה של אדמין ברשימת המחיקה. לא נכתב קובץ.")
    }
  }
  const list = (name) => ids[name]
  const jobs = list("jobs")
  const audit = list("audit")
  // Story 3.7: the credits, their options and the refund requests: refunds
  // and options before the allocations, the credits after them and before
  // the bookings, entitlements and payments they point at. Optional lists
  // (no lines without them), so a run against a database without these
  // tables writes the same SQL as before.
  for (const name of CREDIT_LISTS) {
    if (ids[name] !== undefined && !Array.isArray(ids[name])) {
      throw new Error(`הרשימה ${name} אינה רשימה. לא נכתב קובץ.`)
    }
    if ((ids[name] ?? []).some((id) => admins.has(id))) {
      throw new Error("מזהה של אדמין ברשימת המחיקה. לא נכתב קובץ.")
    }
  }
  const hasCredits = CREDIT_LISTS.every((name) => Array.isArray(ids[name]))

  return [
    `-- ${mode === "dev-test-data" ? "Dev test data" : "Demo data"} removal, prepared by scripts/demo-clear.mjs`,
    `-- on ${now}. Review it, then run it in the SQL Editor`,
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
    del("public.notifications", list("notifications")),
    del("public.push_subscriptions", list("subscriptions")),
    "",
    "-- entitlement_movements is append-only (a trigger); off for this delete only.",
    "set local session_replication_role = replica;",
    del("public.entitlement_movements", list("movements")),
    "set local session_replication_role = origin;",
    "",
    ...(hasCredits
      ? [
          del("public.refund_requests", list("refunds")),
          del("public.credit_options", list("options")),
        ]
      : []),
    del("public.booking_allocations", list("allocations")),
    ...(hasCredits
      ? [del("public.cancellation_credits", list("credits"))]
      : []),
    del("public.bookings", list("bookings")),
    del("public.entitlements", list("entitlements")),
    del("public.activation_tokens", list("tokens")),
    del("public.payments", list("payments")),
    del("public.shopping_items", list("shopping")),
    del("public.work_tasks", list("tasks")),
    del("public.work_dishes", list("dishes")),
    del("public.work_sheets", list("sheets")),
    del("public.events", list("events")),
    del("public.customer_notes", list("notes")),
    del("public.babies", list("babies")),
    "",
    "-- audit_log stays; its rows only stop pointing at the removed profiles.",
    audit.length === 0
      ? "-- public.audit_log: nothing"
      : `update public.audit_log set customer_id = null where id = any(${literal(audit)});`,
    del("public.profiles", list("customers")),
    del("auth.users", list("users")),
    "",
    "commit;",
    "",
  ].join("\n")
}
