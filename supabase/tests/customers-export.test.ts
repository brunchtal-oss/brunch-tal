// Story 4.4: admin_export_customers. Scope (all, search), who is exported,
// the order, the selected columns only, the audit row (scope, columns,
// row_count; never the query or a name), INVALID_INPUT without a log row,
// NOT_AUTHORIZED for a customer and 42501 for anon. The dev database may
// hold other rows, so every check looks only at this test's ids or names.
// Everything runs in inRollback.

import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  insertAuthUser,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { seedMoney, type MoneyFixture } from "./support/money"

const EXPORT = "select public.admin_export_customers($1, $2, $3, $4) as r"
const ALL_COLUMNS = ["full_name", "phone", "email"]

type Row = {
  full_name: string | null
  phone_e164: string | null
  email: string | null
}

// A unique fictitious Israeli mobile (phone_e164 is unique).
function randomPhone(): string {
  return `+97254${String(randomInt(10_000_000)).padStart(7, "0")}`
}

async function insertCustomer(
  db: Db,
  label: string,
  options: { phone?: string; activated?: boolean; id?: string } = {}
): Promise<string> {
  const id = options.id ?? randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, phone_e164, activated_at)
     values ($1, $2, $3, case when $4 then now() end)`,
    [id, testName(label), options.phone ?? null, options.activated ?? true]
  )
  return id
}

async function asAdmin<T>(
  db: Db,
  f: MoneyFixture,
  run: () => Promise<T>
): Promise<T> {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function exportRows(
  db: Db,
  f: MoneyFixture,
  scope: string,
  query: string | null,
  columns: string[],
  // Story 5.13: the category ("all" = active and inactive) for both scopes.
  activity: string = "all"
): Promise<Row[]> {
  return asAdmin(
    db,
    f,
    async () =>
      (await db.query(EXPORT, [scope, query, columns, activity])).rows[0].r.rows
  )
}

// This run's rows only (names start with the run's prefix).
function mine(rows: Row[]): Row[] {
  return rows.filter((r) => r.full_name?.startsWith(testName("")))
}

async function exportLogs(db: Db, actor: string) {
  const { rows } = await db.query(
    `select action, entity_type, entity_id, customer_id, event_id, before, after
     from public.audit_log
     where actor_id = $1 and action = 'admin_export_customers'
     order by created_at`,
    [actor]
  )
  return rows
}

describe("admin_export_customers: scope and columns", () => {
  it("all: every customer with the three columns, the email from auth.users", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const user = await insertAuthUser(db, "exp_full")
      const phone = randomPhone()
      await insertCustomer(db, "exp_full", { id: user.id, phone })
      await insertCustomer(db, "exp_no_email")

      const rows = mine(await exportRows(db, f, "all", null, ALL_COLUMNS))
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            full_name: testName("exp_full"),
            phone_e164: phone,
            email: user.email,
          },
          {
            full_name: testName("exp_no_email"),
            phone_e164: null,
            email: null,
          },
        ])
      )
      // The fixture's two customers are in the full export too.
      expect(rows.map((r) => r.full_name)).toEqual(
        expect.arrayContaining([testName("money_a"), testName("money_b")])
      )
    })
  })

  it("search: only the matching customers, only the chosen columns", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const user = await insertAuthUser(db, "ronit_auth")
      const phone = randomPhone()
      await insertCustomer(db, "רונית", { id: user.id, phone })
      await insertCustomer(db, "רוני")
      await insertCustomer(db, "דנה")

      const rows = await exportRows(db, f, "search", testName("רונ"), [
        "full_name",
        "phone",
      ])
      expect(rows.map((r) => r.full_name).sort()).toEqual(
        [testName("רוני"), testName("רונית")].sort()
      )
      for (const row of rows) expect(row.email).toBeNull()
      expect(rows.find((r) => r.full_name === testName("רונית"))).toEqual({
        full_name: testName("רונית"),
        phone_e164: phone,
        email: null,
      })

      const emailOnly = await exportRows(db, f, "search", testName("רונית"), [
        "email",
      ])
      expect(emailOnly).toEqual([
        { full_name: null, phone_e164: null, email: user.email },
      ])
    })
  })

  it("search with no match: no rows and a log row with row_count 0", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const rows = await exportRows(
        db,
        f,
        "search",
        testName("zzz_nobody"),
        ALL_COLUMNS
      )
      expect(rows).toEqual([])
      const logs = await exportLogs(db, f.admin)
      expect(logs).toHaveLength(1)
      expect(logs[0].after).toEqual({
        scope: "search",
        columns: ALL_COLUMNS,
        activity: "all",
        row_count: 0,
      })
    })
  })

  it("has no 200 cap", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await db.query(
        `insert into public.profiles (id, full_name, activated_at)
         select gen_random_uuid(), $1 || lpad(n::text, 3, '0'), now()
         from generate_series(1, 205) n`,
        [testName("bulk_")]
      )
      const rows = await exportRows(db, f, "search", testName("bulk_"), [
        "full_name",
      ])
      expect(rows).toHaveLength(205)
    })
  })
})

describe("admin_export_customers: who and order", () => {
  it("a customer who is not activated, never an admin or an anonymized one", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const admin = await insertCustomer(db, "who_admin")
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        admin,
      ])
      const anonymized = await insertCustomer(db, "who_anonymized")
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [anonymized]
      )
      await insertCustomer(db, "who_pending", { activated: false })

      const rows = await exportRows(db, f, "search", testName("who_"), [
        "full_name",
      ])
      expect(rows.map((r) => r.full_name)).toEqual([testName("who_pending")])
    })
  })

  it("by last activity (latest first), no activity last, then by name", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows: concepts } = await db.query(
        "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
      )
      const { rows: events } = await db.query(
        `insert into public.events (
           concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, status)
         values ($1, 'regular', now() + interval '10 days',
           now() + interval '10 days 2 hours', 12, now() + interval '9 days',
           'published')
         returning id`,
        [concepts[0].id]
      )
      const older = await insertCustomer(db, "ord_b_older")
      const newer = await insertCustomer(db, "ord_c_newer")
      await insertCustomer(db, "ord_z_none")
      await insertCustomer(db, "ord_a_none")
      for (const [id, at] of [
        [older, "2026-01-05T10:00:00Z"],
        [newer, "2026-03-05T10:00:00Z"],
      ]) {
        await db.query(
          `insert into public.bookings (
             customer_id, event_id, party_size, booked_by, policy_snapshot,
             status, created_at)
           values ($1, $2, 1, 'admin',
             '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb,
             'confirmed', $3::timestamptz)`,
          [id, events[0].id, at]
        )
      }

      const rows = await exportRows(db, f, "search", testName("ord_"), [
        "full_name",
      ])
      expect(rows.map((r) => r.full_name)).toEqual([
        testName("ord_c_newer"),
        testName("ord_b_older"),
        testName("ord_a_none"),
        testName("ord_z_none"),
      ])
    })
  })
})

describe("admin_export_customers: the audit row", () => {
  it("one row per export with scope, columns and row_count; no query, no names", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await insertCustomer(db, "log_one")
      await insertCustomer(db, "log_two")
      const query = testName("log_")

      await exportRows(db, f, "search", query, ["full_name", "phone"])
      const logs = await exportLogs(db, f.admin)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        action: "admin_export_customers",
        entity_type: "profiles",
        entity_id: null,
        customer_id: null,
        event_id: null,
        before: {},
        after: {
          scope: "search",
          columns: ["full_name", "phone"],
          activity: "all",
          row_count: 2,
        },
      })
      const text = JSON.stringify(logs)
      expect(text).not.toContain(query)
      expect(text).not.toContain(testName("log_one"))

      await exportRows(db, f, "all", null, ["email"])
      const both = await exportLogs(db, f.admin)
      expect(both).toHaveLength(2)
      // One transaction: created_at ties, so find the row by its scope.
      expect(both.find((r) => r.after.scope === "all")?.after).toEqual({
        scope: "all",
        columns: ["email"],
        activity: "all",
        row_count: expect.any(Number),
      })
    })
  })
})

describe("admin_export_customers: invalid input", () => {
  it("INVALID_INPUT and no log row", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const cases: Array<
        [string | null, string | null, string[] | null, string | null]
      > = [
        [null, null, ALL_COLUMNS, "all"],
        ["everything", null, ALL_COLUMNS, "all"],
        ["search", null, ALL_COLUMNS, "all"],
        ["search", " א ", ALL_COLUMNS, "all"],
        ["search", "א".repeat(101), ALL_COLUMNS, "all"],
        ["all", null, ALL_COLUMNS, null],
        ["all", null, ALL_COLUMNS, "bogus"],
        ["all", null, [], "all"],
        ["all", null, null, "all"],
        ["all", null, ["full_name", "dietary_notes"], "all"],
        ["all", null, ["full_name", "full_name"], "all"],
        ["all", null, ["id"], "all"],
        ["all", null, ["full_name", null as unknown as string], "all"],
      ]
      for (const params of cases) {
        expect(
          await queryError(db, EXPORT, params),
          JSON.stringify(params)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      await db.query("reset role")
      expect(await exportLogs(db, f.admin)).toHaveLength(0)
    })
  })
})

describe("admin_export_customers: who may call it", () => {
  it("a customer gets NOT_AUTHORIZED and no log row; anon gets 42501", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.customerA)
      expect(
        await queryError(db, EXPORT, ["all", null, ALL_COLUMNS, "all"])
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      await db.query("reset role")
      expect(await exportLogs(db, f.customerA)).toHaveLength(0)

      await db.query("set local role anon")
      expect(
        (await queryError(db, EXPORT, ["all", null, ALL_COLUMNS, "all"]))?.code
      ).toBe("42501")
    })
  })
})
