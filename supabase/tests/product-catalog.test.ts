// Story 2.6: the product catalog in the admin. admin_create_product,
// admin_update_product (fields, hide / show) and the sensitive price change
// (preview_admin_set_product_price, admin_set_product_price). One test per
// row of the spec's I/O matrix. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, insertProduct, seedMoney } from "./support/money"

const CREATE = "select public.admin_create_product($1::jsonb, $2) as r"
const UPDATE = "select public.admin_update_product($1, $2::jsonb, $3) as r"
const PRICE = "select public.admin_set_product_price($1, $2, $3, $4, $5) as r"
const PRICE_PREVIEW =
  "select public.preview_admin_set_product_price($1, $2) as r"
const APPROVE_PREVIEW =
  "select public.preview_admin_approve_payment(null, 'Test payer', $1, null, $2, $3::date, $4) as r"
const LIST = "select public.admin_list_payments() as r"

async function one(db: Db, text: string, params: unknown[]) {
  const { rows } = await db.query(text, params)
  return rows[0].r
}

async function productRow(db: Db, id: string) {
  const { rows } = await db.query(
    "select * from public.products where id = $1",
    [id]
  )
  return rows[0]
}

// As the owner (the role is reset and set back to the admin).
async function auditOf(db: Db, admin: string, productId: string) {
  await db.query("reset role")
  const { rows } = await db.query(
    `select action, before, after, reason from public.audit_log
     where entity_type = 'products' and entity_id = $1
     order by created_at, id`,
    [productId]
  )
  await asAuthenticated(db, admin)
  return rows
}

function newProduct(extra: Record<string, unknown> = {}) {
  return {
    name: testName("product"),
    type: "single",
    price_agorot: 12800,
    units: 1,
    validity_mode: "session",
    eligible_event_kind: "regular",
    party_size: 1,
    ...extra,
  }
}

describe("editing after a purchase", () => {
  it("leaves the entitlement and the payment as they were; the next preview has the new values", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const approved = await approve(db, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      })
      // The full rows are read as the owner (authenticated has column grants
      // on payments only).
      await db.query("reset role")
      const { rows: before } = await db.query(
        `select row_to_json(e) as e, row_to_json(p) as p
         from public.entitlements e join public.payments p on p.id = e.payment_id
         where p.id = $1`,
        [approved.payment_id]
      )
      await asAuthenticated(db, f.admin)

      await one(db, UPDATE, [
        f.card,
        { units: 5, validity_days: 60 },
        randomUUID(),
      ])
      await one(db, PRICE, [f.card, 50000, null, true, randomUUID()])

      await db.query("reset role")
      const { rows: after } = await db.query(
        `select row_to_json(e) as e, row_to_json(p) as p
         from public.entitlements e join public.payments p on p.id = e.payment_id
         where p.id = $1`,
        [approved.payment_id]
      )
      await asAuthenticated(db, f.admin)
      expect(after).toEqual(before)
      expect(before[0].e.original_units).toBe(4)
      expect(before[0].p.amount_agorot).toBe(47200)

      const plan = await one(db, APPROVE_PREVIEW, [
        f.card,
        50000,
        f.today,
        f.method,
      ])
      const { rows: day } = await db.query(
        "select ($1::date + 60)::text as d",
        [f.today]
      )
      expect(plan).toMatchObject({
        units: 5,
        expires_on: day[0].d,
        price_agorot: 50000,
        price_changed: false,
      })
    })
  })
})

describe("hiding a product", () => {
  it("drops it from add payment, the approval refuses it, past payments keep their name", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const approved = await approve(db, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      })
      const oldName = (await productRow(db, f.card)).name

      await one(db, UPDATE, [
        f.card,
        { active: false, name: testName("renamed") },
        randomUUID(),
      ])

      // The query of app/admin/(shell)/payments/new/form-data.ts.
      const { rows: offered } = await db.query(
        "select id from public.products where active and validity_mode = 'days'"
      )
      expect(offered.map((r) => r.id)).not.toContain(f.card)

      expect(
        await queryError(
          db,
          "select public.admin_approve_payment(null, 'Test payer', $1, null, 47200, null, $2::date, $3, null, null, null, null, $4)",
          [f.card, f.today, f.method, randomUUID()]
        )
      ).toMatchObject({ code: "P0001", message: "PRODUCT_NOT_AVAILABLE" })

      const list = (await one(db, LIST, [])) as Record<string, unknown>[]
      expect(
        list.find((row) => row.payment_id === approved.payment_id)
      ).toMatchObject({ product_name: oldName, amount_agorot: 47200 })

      // And it can be shown again.
      await one(db, UPDATE, [f.card, { active: true }, randomUUID()])
      expect((await productRow(db, f.card)).active).toBe(true)
    })
  })
})

describe("price change (sensitive)", () => {
  it("needs p_confirmed, then saves and logs old -> new with an empty reason as null", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)

      expect(await one(db, PRICE_PREVIEW, [f.card, 50000])).toEqual({
        product_id: f.card,
        name: (await productRow(db, f.card)).name,
        old_price_agorot: 47200,
        new_price_agorot: 50000,
      })

      expect(
        await queryError(db, PRICE, [f.card, 50000, null, false, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CONFIRM_REQUIRED" })
      expect(
        await queryError(db, PRICE, [f.card, 50000, null, null, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CONFIRM_REQUIRED" })
      expect((await productRow(db, f.card)).price_agorot).toBe(47200)
      expect(await auditOf(db, f.admin, f.card)).toEqual([])

      const result = await one(db, PRICE, [
        f.card,
        50000,
        "   ",
        true,
        randomUUID(),
      ])
      expect(result).toMatchObject({
        product_id: f.card,
        old_price_agorot: 47200,
        new_price_agorot: 50000,
      })
      expect((await productRow(db, f.card)).price_agorot).toBe(50000)
      expect(await auditOf(db, f.admin, f.card)).toEqual([
        {
          action: "admin_set_product_price",
          before: { price_agorot: 47200 },
          after: { price_agorot: 50000 },
          reason: null,
        },
      ])
    })
  })

  it("keeps a reason and refuses the same, a negative or a missing price", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      for (const price of [47200, -1, null]) {
        expect(
          await queryError(db, PRICE, [
            f.card,
            price,
            null,
            true,
            randomUUID(),
          ]),
          String(price)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
        expect(
          await queryError(db, PRICE_PREVIEW, [f.card, price]),
          String(price)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      expect(
        await queryError(db, PRICE, [
          randomUUID(),
          100,
          null,
          true,
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })

      await one(db, PRICE, [f.card, 0, " gift ", true, randomUUID()])
      const audit = await auditOf(db, f.admin, f.card)
      expect(audit).toHaveLength(1)
      expect(audit[0].reason).toBe("gift")
    })
  })
})

describe("admin_create_product", () => {
  it("creates a couple product with its fields and a log row", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const result = await one(db, CREATE, [
        newProduct({
          type: "couple",
          price_agorot: 25000,
          eligible_event_kind: "couple",
          party_size: 2,
          post_join_message: "  ",
          post_join_button_label: " label ",
        }),
        randomUUID(),
      ])
      expect(Object.keys(result)).toEqual(["product_id"])
      const row = await productRow(db, result.product_id)
      expect(row).toMatchObject({
        type: "couple",
        price_agorot: 25000,
        units: 1,
        validity_mode: "session",
        validity_days: null,
        allowed_weekdays: null,
        eligible_event_kind: "couple",
        party_size: 2,
        intro_only: false,
        post_join_message: null,
        post_join_button_label: "label",
        active: true,
      })
      const audit = await auditOf(db, f.admin, result.product_id)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        action: "admin_create_product",
        before: {},
        after: { price_agorot: 25000, party_size: 2 },
      })
    })
  })

  it("gives a days product without a number the default validity, and all seven days become null", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows } = await db.query(
        "select default_validity_days as d from public.business_settings"
      )
      await asAuthenticated(db, f.admin)
      const card = await one(db, CREATE, [
        newProduct({
          type: "card",
          validity_mode: "days",
          units: 4,
          allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
        }),
        randomUUID(),
      ])
      expect(await productRow(db, card.product_id)).toMatchObject({
        validity_mode: "days",
        validity_days: rows[0].d,
        allowed_weekdays: null,
      })

      const sorted = await one(db, CREATE, [
        newProduct({
          type: "card",
          validity_mode: "days",
          validity_days: null,
          allowed_weekdays: [4, 1, 4],
        }),
        randomUUID(),
      ])
      expect(await productRow(db, sorted.product_id)).toMatchObject({
        validity_days: rows[0].d,
        allowed_weekdays: [1, 4],
      })
    })
  })

  it("refuses active, an unknown key, a missing field and no weekday, saving nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.products"
      )
      const withoutType: Record<string, unknown> = newProduct()
      delete withoutType.type
      const withoutPrice: Record<string, unknown> = newProduct()
      delete withoutPrice.price_agorot
      for (const product of [
        newProduct({ active: false }),
        newProduct({ color: "red" }),
        withoutType,
        withoutPrice,
        newProduct({ price_agorot: -1 }),
        newProduct({ price_agorot: 1.5 }),
        newProduct({ units: 0 }),
        newProduct({ allowed_weekdays: [] }),
        newProduct({ allowed_weekdays: [7] }),
        newProduct({ validity_days: 30 }),
        newProduct({ name: "  " }),
        "[]",
      ]) {
        expect(
          await queryError(db, CREATE, [product, randomUUID()]),
          JSON.stringify(product)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.products"
      )
      expect(after[0].n).toBe(before[0].n)
    })
  })
})

describe("admin_update_product logs old and new", () => {
  it("logs a real change once, and a change to the current value writes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      await one(db, UPDATE, [f.card, { units: 5, active: false }, randomUUID()])
      const audit = await auditOf(db, f.admin, f.card)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        before: { units: 4, active: true },
        after: { units: 5, active: false },
        reason: null,
      })

      expect(
        await one(db, UPDATE, [f.card, { units: 5 }, randomUUID()])
      ).toEqual({ product_id: f.card })
      expect(await auditOf(db, f.admin, f.card)).toHaveLength(1)
    })
  })
})

describe("admin_update_product refuses invalid changes", () => {
  it("price_agorot, zero units, an unknown key, a wrong type, no change: INVALID_INPUT and nothing saved", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const before = await productRow(db, f.card)
      for (const changes of [
        { price_agorot: 50000 },
        { units: 0 },
        { units: 5, color: "red" },
        { units: "5" },
        { units: 2.5 },
        { allowed_weekdays: [] },
        { validity_mode: "session" },
        { party_size: 3 },
        { type: "gift" },
        { intro_only: "yes" },
        {},
      ]) {
        expect(
          await queryError(db, UPDATE, [f.card, changes, randomUUID()]),
          JSON.stringify(changes)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      expect(
        await queryError(db, UPDATE, [randomUUID(), { units: 5 }, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      expect(await productRow(db, f.card)).toEqual(before)
      expect(await auditOf(db, f.admin, f.card)).toEqual([])
    })
  })

  it("reports the refused field in detail", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      await db.query("savepoint s")
      const error = await db
        .query(UPDATE, [f.card, { allowed_weekdays: [] }, randomUUID()])
        .catch((e: { detail?: string }) => e)
      await db.query("rollback to savepoint s")
      expect(JSON.parse((error as { detail: string }).detail)).toEqual({
        field: "allowed_weekdays",
      })
    })
  })
})

describe("repeat with the same key", () => {
  it("returns the same result with one log row, for each RPC", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)

      const createKey = randomUUID()
      const product = newProduct()
      const first = await one(db, CREATE, [product, createKey])
      expect(await one(db, CREATE, [product, createKey])).toEqual(first)
      expect(await auditOf(db, f.admin, first.product_id)).toHaveLength(1)

      const updateKey = randomUUID()
      await db.query("reset role")
      const card = await insertProduct(db, { label: "repeat_card" })
      await asAuthenticated(db, f.admin)
      const updated = await one(db, UPDATE, [card, { units: 5 }, updateKey])
      expect(await one(db, UPDATE, [card, { units: 5 }, updateKey])).toEqual(
        updated
      )
      const priceKey = randomUUID()
      const priced = await one(db, PRICE, [card, 50000, null, true, priceKey])
      expect(await one(db, PRICE, [card, 50000, null, true, priceKey])).toEqual(
        priced
      )
      expect(
        // One transaction: both rows share created_at, so compare as a set.
        (await auditOf(db, f.admin, card)).map((row) => row.action).sort()
      ).toEqual(["admin_set_product_price", "admin_update_product"])
    })
  })
})

describe("permissions", () => {
  it("refuses a customer (NOT_AUTHORIZED) and anon (42501) on every new RPC", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const calls: [string, unknown[]][] = [
        [CREATE, [newProduct(), randomUUID()]],
        [UPDATE, [f.card, { units: 5 }, randomUUID()]],
        [PRICE, [f.card, 50000, null, true, randomUUID()]],
        [PRICE_PREVIEW, [f.card, 50000]],
      ]
      await asAuthenticated(db, f.customerA)
      for (const [query, params] of calls) {
        expect(await queryError(db, query, params), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query("reset role")
      await db.query("set local role anon")
      for (const [query, params] of calls) {
        expect((await queryError(db, query, params))?.code, query).toBe("42501")
      }
    })
  })

  it("leaves the private helpers without a grant", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      for (const fn of [
        "select private.plan_set_product_price(gen_random_uuid(), 1)",
        "select private.apply_product_changes(null::public.products, '{}', false)",
        "select private.save_product(null::public.products, true)",
      ]) {
        expect((await queryError(db, fn))?.code, fn).toBe("42501")
      }
    })
  })
})
