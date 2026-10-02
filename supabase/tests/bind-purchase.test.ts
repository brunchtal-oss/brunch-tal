// Story 2.2: private.bind_purchase is the only binder of a purchase (AD-10).
// Every table in public with a customer_id column is either filled by it
// (BOUND) or never has a row before the purchase is bound (NOT_BEFORE_BIND).
// A new table with customer_id fails here until it is classified: bound in
// private.bind_purchase (E3: bookings, cancellation_credits,
// refund_requests) or listed with the reason.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, sql, type Db } from "./support/db"
import { approve, seedMoney } from "./support/money"

// Filled by private.bind_purchase from the payment.
const BOUND = ["entitlements", "payments"]

// Created only for a customer who already exists, never for an unbound
// purchase.
const NOT_BEFORE_BIND = [
  // Rows of the customer's own profile (join_complete, then self-service).
  "babies",
  // Filled when the link is consumed, in the same transaction as the bind.
  "activation_tokens",
  // Each row records the customer it was written for at that time.
  "audit_log",
]

const CUSTOMER_TABLES = `
  select c.table_name as name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name = 'customer_id'
    and t.table_type = 'BASE TABLE'
  order by 1`

async function customerTables(db?: Db): Promise<string[]> {
  const rows = db
    ? (await db.query(CUSTOMER_TABLES)).rows
    : await sql(CUSTOMER_TABLES)
  return rows.map((row) => row.name as string)
}

function unclassified(tables: string[]): string[] {
  return tables.filter(
    (name) => !BOUND.includes(name) && !NOT_BEFORE_BIND.includes(name)
  )
}

describe("bind_purchase coverage", () => {
  it("classifies every public table with customer_id", async () => {
    const tables = await customerTables()
    expect(unclassified(tables)).toEqual([])
    // The lists name only tables that exist.
    expect([...BOUND, ...NOT_BEFORE_BIND].sort()).toEqual(tables)
  })

  it("fails for a new table with customer_id", async () => {
    await inRollback(async (db) => {
      await db.query(
        "create table public.bind_check_new (id uuid primary key, customer_id uuid)"
      )
      expect(unclassified(await customerTables(db))).toEqual(["bind_check_new"])
    })
  })

  it("fills customer_id on every BOUND row of the payment", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      })
      await db.query("reset role")

      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerA,
      ])

      const lookup: Record<string, string> = {
        payments: "id = $1",
        entitlements: "payment_id = $1",
      }
      for (const table of BOUND) {
        const { rows } = await db.query(
          `select customer_id from public.${table} where ${lookup[table]}`,
          [r.payment_id]
        )
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((row) => row.customer_id === f.customerA)).toBe(true)
      }
    })
  })
})
