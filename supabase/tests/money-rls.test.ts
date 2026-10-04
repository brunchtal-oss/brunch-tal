// Story 2.1: who can read and write the money tables (AD-5, AD-14).
// Fictitious profiles and an admin without Auth users, all in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, queryError, type Db } from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

type Purchase = { payment: string; entitlement: string }

// Approves one card for each customer and binds it as the owner (the real
// binding, private.bind_purchase, arrives in story 2.2).
async function seedPurchases(
  db: Db
): Promise<{ f: MoneyFixture; a: Purchase; b: Purchase }> {
  const f = await seedMoney(db)
  await asAuthenticated(db, f.admin)
  const purchases: Purchase[] = []
  for (const customer of [f.customerA, f.customerB]) {
    const r = await approve(db, {
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      // The second approval is a similar payment (2.5).
      duplicateConfirmed: true,
      key: randomUUID(),
    })
    purchases.push({
      payment: r.payment_id as string,
      entitlement: r.entitlement_id as string,
    })
    await db.query("reset role")
    await db.query(
      "update public.payments set customer_id = $1 where id = $2",
      [customer, r.payment_id]
    )
    await db.query(
      "update public.entitlements set customer_id = $1 where id = $2",
      [customer, r.entitlement_id]
    )
    await asAuthenticated(db, f.admin)
  }
  await db.query("reset role")
  return { f, a: purchases[0], b: purchases[1] }
}

async function visible(db: Db, table: string, column: string, ids: string[]) {
  const { rows } = await db.query(
    `select ${column} as id from ${table} where ${column} = any($1::uuid[])`,
    [ids]
  )
  return rows.map((row) => row.id).sort()
}

const MONEY_TABLES = [
  "public.products",
  "public.payment_methods",
  "public.payments",
  "public.entitlements",
  "public.entitlement_movements",
  "public.entitlement_balances",
  "public.business_settings",
]

describe("money row level security", () => {
  it("a customer sees only her own payment, entitlement, movements and balance", async () => {
    await inRollback(async (db) => {
      const { f, a, b } = await seedPurchases(db)
      await asAuthenticated(db, f.customerA)

      expect(
        await visible(db, "public.payments", "id", [a.payment, b.payment])
      ).toEqual([a.payment])
      expect(
        await visible(db, "public.entitlements", "id", [
          a.entitlement,
          b.entitlement,
        ])
      ).toEqual([a.entitlement])
      expect(
        await visible(db, "public.entitlement_movements", "entitlement_id", [
          a.entitlement,
          b.entitlement,
        ])
      ).toEqual([a.entitlement])
      expect(
        await visible(db, "public.entitlement_balances", "entitlement_id", [
          a.entitlement,
          b.entitlement,
        ])
      ).toEqual([a.entitlement])
      // B's rows: none.
      expect(await visible(db, "public.payments", "id", [b.payment])).toEqual(
        []
      )
      expect(
        await visible(db, "public.entitlements", "id", [b.entitlement])
      ).toEqual([])
    })
  })

  it.each([
    "select note from public.payments",
    "select amount_override_reason from public.payments",
    "select reference from public.payments",
    "select recorded_by from public.payments",
    "select payment_method_id from public.payments",
    "select * from public.payments",
    "select reason from public.entitlement_movements",
    "select actor_id from public.entitlement_movements",
  ])("a signed-in user cannot read internal fields: %s", async (query) => {
    await inRollback(async (db) => {
      const { f } = await seedPurchases(db)
      await asAuthenticated(db, f.customerA)
      expect((await queryError(db, query))?.code).toBe("42501")
    })
  })

  it("a customer sees products but not payment methods or settings", async () => {
    await inRollback(async (db) => {
      const { f } = await seedPurchases(db)
      await asAuthenticated(db, f.customerA)

      expect(await visible(db, "public.products", "id", [f.card])).toEqual([
        f.card,
      ])
      expect(
        await visible(db, "public.payment_methods", "id", [f.method])
      ).toEqual([])
      const { rows } = await db.query(
        "select count(*)::int as n from public.business_settings"
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("an admin sees every row", async () => {
    await inRollback(async (db) => {
      const { f, a, b } = await seedPurchases(db)
      await asAuthenticated(db, f.admin)

      expect(
        await visible(db, "public.payments", "id", [a.payment, b.payment])
      ).toEqual([a.payment, b.payment].sort())
      expect(
        await visible(db, "public.payment_methods", "id", [f.method])
      ).toEqual([f.method])
      const { rows } = await db.query(
        "select count(*)::int as n from public.business_settings"
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("an unbound purchase is visible to no customer", async () => {
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
      await asAuthenticated(db, f.customerA)
      expect(
        await visible(db, "public.payments", "id", [r.payment_id as string])
      ).toEqual([])
    })
  })

  it("a customer cannot write to the money tables or admin_roles", async () => {
    await inRollback(async (db) => {
      const { f, a } = await seedPurchases(db)
      await asAuthenticated(db, f.customerA)

      const writes: Array<[string, unknown[]]> = [
        [
          `insert into public.payments (product_id, source, recorded_by, payment_method_id,
             amount_agorot, paid_on, product_snapshot)
           values ($1, 'manual', $2, $3, 0, current_date, '{}')`,
          [f.card, f.customerA, f.method],
        ],
        [
          `insert into public.entitlement_movements (entitlement_id, action, units)
           values ($1, 'adjust', 10)`,
          [a.entitlement],
        ],
        ["insert into public.admin_roles (user_id) values ($1)", [f.customerA]],
        [
          "update public.payments set amount_agorot = 0 where id = $1",
          [a.payment],
        ],
        [
          "update public.entitlements set expires_on = expires_on + 100 where id = $1",
          [a.entitlement],
        ],
        ["update public.products set price_agorot = 0 where id = $1", [f.card]],
        ["update public.business_settings set cancel_window_hours = 0", []],
      ]
      for (const [text, params] of writes) {
        expect((await queryError(db, text, params))?.code).toBe("42501")
      }
    })
  })

  it("anon cannot read any money table", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const table of MONEY_TABLES) {
        expect(
          (await queryError(db, `select 1 from ${table} limit 1`))?.code
        ).toBe("42501")
      }
    })
  })
})

describe("entitlement_movements is append-only", () => {
  it.each([
    [
      "update",
      "update public.entitlement_movements set units = 9 where entitlement_id = $1",
    ],
    [
      "delete",
      "delete from public.entitlement_movements where entitlement_id = $1",
    ],
  ])("refuses %s, also for the owner", async (_label, text) => {
    await inRollback(async (db) => {
      const { a } = await seedPurchases(db)
      expect(await queryError(db, text, [a.entitlement])).toMatchObject({
        code: "P0001",
        message: "entitlement_movements is append-only",
      })
    })
  })

  it("refuses truncate, also for the owner", async () => {
    await inRollback(async (db) => {
      await seedPurchases(db)
      expect(
        await queryError(db, "truncate public.entitlement_movements")
      ).toMatchObject({
        code: "P0001",
        message: "entitlement_movements is append-only",
      })
    })
  })

  it.each([
    ["grant", 0],
    ["reserve", 1],
    ["use", 1],
    ["release", -1],
    ["adjust", 0],
    ["opening_balance", -2],
  ])("rejects %s with units %i", async (action, units) => {
    await inRollback(async (db) => {
      const { a } = await seedPurchases(db)
      const error = await queryError(
        db,
        `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
         values ($1, $2, $3, $4)`,
        [a.entitlement, randomUUID(), action, units]
      )
      expect(error?.code).toBe("23514")
    })
  })
})
