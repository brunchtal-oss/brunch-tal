// Story 4.10: the work sheet's shopping list and the registrants' photo
// consent (CAP-38, CAP-40). The rows of the spec's I/O matrix that live in
// the database: adding an item, a replay, a stale order, the customer's
// access; plus no audit for a call that changes nothing, a blank quantity
// that becomes null, the cascade from the sheet, and photo_consent in
// admin_get_event_details. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { seedMoney, type MoneyFixture } from "./support/money"

const GET = "select public.admin_get_work_sheet($1) as r"
const DETAILS = "select public.admin_get_event_details($1) as r"
// Round 2: several items in one call, without a quantity (a quantity is
// set by an update and kept).
const ADD = "select public.admin_add_shopping_items($1, $2::text[], $3) as r"
const UPDATE = "select public.admin_update_shopping_item($1, $2, $3, $4) as r"
const DELETE = "select public.admin_delete_shopping_item($1, $2) as r"
const BOUGHT = "select public.admin_set_shopping_item_bought($1, $2) as r"
const ORDER = "select public.admin_set_shopping_item_order($1::uuid[]) as r"

type Item = {
  id: string
  body: string
  quantity: string | null
  bought: boolean
}

type Fixture = MoneyFixture & { concept: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    "update public.business_settings set default_prep_days = '{-1,0}'"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null order by id limit 1"
  )
  return { ...f, concept: rows[0].id }
}

// Runs as the admin, then returns to the owner role.
async function asAdmin<T>(db: Db, f: Fixture, fn: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function call(db: Db, f: Fixture, text: string, params: unknown[]) {
  return asAdmin(db, f, async () => (await db.query(text, params)).rows[0].r)
}

async function fails(db: Db, f: Fixture, text: string, params: unknown[]) {
  return asAdmin(
    db,
    f,
    async () => (await queryError(db, text, params))?.message
  )
}

// A session on a local date at 10:00, created by the admin.
async function session(db: Db, f: Fixture, date: string): Promise<string> {
  const result = await call(
    db,
    f,
    "select public.admin_create_event($1::jsonb, $2) as r",
    [
      {
        concept_id: f.concept,
        date,
        start_time: "10:00",
        end_time: "12:00",
      },
      randomUUID(),
    ]
  )
  return result.event_id
}

async function items(db: Db, f: Fixture, eventId: string): Promise<Item[]> {
  return (await call(db, f, GET, [eventId])).shopping
}

async function add(
  db: Db,
  f: Fixture,
  eventId: string,
  body: string,
  quantity: string | null = null
): Promise<string> {
  const [id] = (await call(db, f, ADD, [eventId, [body], randomUUID()]))
    .item_ids as string[]
  // A quantity can no longer be added (round 2); an existing one is set as
  // seed data, without an audit row the tests would count.
  if (quantity !== null) {
    await db.query(
      "update public.shopping_items set quantity = $2 where id = $1",
      [id, quantity]
    )
  }
  return id
}

async function auditCount(db: Db, eventId: string, action: string) {
  const { rows } = await db.query(
    "select count(*)::int as n from public.audit_log where event_id = $1 and action = $2",
    [eventId, action]
  )
  return rows[0].n as number
}

describe("shopping items", { timeout: 30_000 }, () => {
  it("adds several lines at the end in their order; the sheet returns them in order", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      expect(await items(db, f, id)).toEqual([])
      const first = await add(db, f, id, "לימונים")
      const r = await call(db, f, ADD, [
        id,
        ["פטה כבשים", " עגבניות ", "לחם"],
        randomUUID(),
      ])
      expect(r.item_ids).toHaveLength(3)
      const list = await items(db, f, id)
      expect(list.map((i) => i.body)).toEqual([
        "לימונים",
        "פטה כבשים",
        "עגבניות",
        "לחם",
      ])
      expect(list.map((i) => i.id)).toEqual([first, ...r.item_ids])
      expect(list.every((i) => i.quantity === null && !i.bought)).toBe(true)
      expect(await auditCount(db, id, "admin_add_shopping_items")).toBe(4)
    })
  })

  it("a quantity set by an update is kept and returned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const feta = await add(db, f, id, "פטה כבשים", "1 ק״ג")
      expect(await items(db, f, id)).toEqual([
        { id: feta, body: "פטה כבשים", quantity: "1 ק״ג", bought: false },
      ])
    })
  })

  it("an empty or too long line, no lines or more than 100 -> INVALID_INPUT, none added", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const bad: unknown[] = [
        ["a", " \t"],
        ["a", "x".repeat(201)],
        ["a", null],
        [],
        null,
        Array.from({ length: 101 }, (_, i) => `item ${i}`),
      ]
      for (const bodies of bad) {
        expect(await fails(db, f, ADD, [id, bodies, randomUUID()])).toBe(
          "INVALID_INPUT"
        )
      }
      expect(await items(db, f, id)).toEqual([])
      // Exactly 100 lines are accepted.
      await call(db, f, ADD, [
        id,
        Array.from({ length: 100 }, (_, i) => `item ${i}`),
        randomUUID(),
      ])
      expect(await items(db, f, id)).toHaveLength(100)
    })
  })

  it("a too long quantity in an update -> INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await add(db, f, id, "a")
      expect(
        await fails(db, f, UPDATE, [a, "a", "y".repeat(51), randomUUID()])
      ).toBe("INVALID_INPUT")
    })
  })

  it("a quantity of only whitespace becomes null; edges are trimmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      // The quantity goes through the update RPC (the only one that takes it).
      const first = await add(db, f, id, " לימונים ")
      await call(db, f, UPDATE, [first, "לימונים", "  \u00A0", randomUUID()])
      const lemons = await add(db, f, id, "לימונים")
      await call(db, f, UPDATE, [lemons, "לימונים", " 8 ", randomUUID()])
      expect((await items(db, f, id)).map((i) => [i.body, i.quantity])).toEqual(
        [
          ["לימונים", null],
          ["לימונים", "8"],
        ]
      )
      await call(db, f, UPDATE, [lemons, "לימונים", "\t", randomUUID()])
      expect((await items(db, f, id))[1].quantity).toBeNull()
    })
  })

  it("a replay with the same key returns the same result: three items, not six", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const key = randomUUID()
      const lines = ["פטה כבשים", "עגבניות", "לחם"]
      const first = await call(db, f, ADD, [id, lines, key])
      expect(await call(db, f, ADD, [id, lines, key])).toEqual(first)
      expect(await items(db, f, id)).toHaveLength(3)
      expect(await fails(db, f, ADD, [id, ["לחם"], key])).toBe(
        "IDEMPOTENCY_KEY_REUSED"
      )
    })
  })

  it("marks bought in place; the same value and an unchanged update write no audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await add(db, f, id, "a")
      const b = await add(db, f, id, "b", "2")
      await add(db, f, id, "c")
      expect(await call(db, f, BOUGHT, [b, true])).toEqual({
        item_id: b,
        bought: true,
      })
      await call(db, f, BOUGHT, [b, true])
      expect((await items(db, f, id)).map((i) => [i.body, i.bought])).toEqual([
        ["a", false],
        ["b", true],
        ["c", false],
      ])
      expect(await auditCount(db, id, "admin_set_shopping_item_bought")).toBe(1)

      await call(db, f, UPDATE, [b, "b", " 2 ", randomUUID()])
      expect(await auditCount(db, id, "admin_update_shopping_item")).toBe(0)
      await call(db, f, UPDATE, [a, "א", null, randomUUID()])
      expect(await auditCount(db, id, "admin_update_shopping_item")).toBe(1)
      // The edit keeps the place and the mark.
      expect((await items(db, f, id)).map((i) => i.body)).toEqual([
        "א",
        "b",
        "c",
      ])
      expect((await items(db, f, id))[1].bought).toBe(true)
      expect(await fails(db, f, BOUGHT, [b, null])).toBe("INVALID_INPUT")
    })
  })

  it("orders the list; a stale list -> CONCURRENT_CHANGE; the same order writes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await add(db, f, id, "a")
      const b = await add(db, f, id, "b")
      await call(db, f, ORDER, [[b, a]])
      expect((await items(db, f, id)).map((i) => i.id)).toEqual([b, a])
      expect(await auditCount(db, id, "admin_set_shopping_item_order")).toBe(1)
      await call(db, f, ORDER, [[b, a]])
      expect(await auditCount(db, id, "admin_set_shopping_item_order")).toBe(1)

      const c = await add(db, f, id, "c")
      expect(await fails(db, f, ORDER, [[a, b]])).toBe("CONCURRENT_CHANGE")
      expect(await fails(db, f, ORDER, [[a, b, a]])).toBe("CONCURRENT_CHANGE")
      expect(await fails(db, f, ORDER, [[randomUUID()]])).toBe(
        "CONCURRENT_CHANGE"
      )
      // An item of another sheet.
      const other = await session(db, f, "2026-10-29")
      const theirs = await add(db, f, other, "x")
      expect(await fails(db, f, ORDER, [[theirs, a, b, c]])).toBe(
        "CONCURRENT_CHANGE"
      )
      expect((await items(db, f, id)).map((i) => i.id)).toEqual([b, a, c])
    })
  })

  it("deletes an item with its row in the audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await add(db, f, id, "a", "3")
      await add(db, f, id, "b")
      const key = randomUUID()
      expect(await call(db, f, DELETE, [a, key])).toEqual({ item_id: a })
      expect(await call(db, f, DELETE, [a, key])).toEqual({ item_id: a })
      expect((await items(db, f, id)).map((i) => i.body)).toEqual(["b"])
      const { rows } = await db.query(
        `select before from public.audit_log
         where event_id = $1 and action = 'admin_delete_shopping_item'`,
        [id]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].before).toMatchObject({ id: a, body: "a", quantity: "3" })
      expect(await fails(db, f, DELETE, [a, randomUUID()])).toBe("NOT_FOUND")
    })
  })

  it("deleting the sheet (and its session) deletes its items", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      await add(db, f, id, "a")
      await db.query("delete from public.work_sheets where event_id = $1", [id])
      const { rows } = await db.query(
        `select count(*)::int as n from public.shopping_items i
         where not exists (select 1 from public.work_sheets s where s.id = i.sheet_id)`
      )
      expect(rows[0].n).toBe(0)

      const second = await session(db, f, "2026-10-29")
      const kept = await add(db, f, second, "b")
      await db.query("delete from public.events where id = $1", [second])
      const { rows: left } = await db.query(
        "select count(*)::int as n from public.shopping_items where id = $1",
        [kept]
      )
      expect(left[0].n).toBe(0)
    })
  })

  it("an unknown item or session -> NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await fails(db, f, UPDATE, [randomUUID(), "x", null, randomUUID()])
      ).toBe("NOT_FOUND")
      expect(await fails(db, f, BOUGHT, [randomUUID(), true])).toBe("NOT_FOUND")
      expect(await fails(db, f, ADD, [randomUUID(), ["x"], randomUUID()])).toBe(
        "NOT_FOUND"
      )
    })
  })

  it("the audit holds before and after of bought, update and order", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await add(db, f, id, "a", "1")
      const b = await add(db, f, id, "b")
      await call(db, f, BOUGHT, [a, true])
      await call(db, f, UPDATE, [a, "א", "2", randomUUID()])
      await call(db, f, ORDER, [[b, a]])
      const { rows } = await db.query<{
        action: string
        before: Record<string, unknown>
        after: Record<string, unknown>
      }>(
        `select action, before, after from public.audit_log
         where event_id = $1 and action in ('admin_set_shopping_item_bought',
           'admin_update_shopping_item', 'admin_set_shopping_item_order')
         order by action`,
        [id]
      )
      expect(rows.map((r) => r.action)).toEqual([
        "admin_set_shopping_item_bought",
        "admin_set_shopping_item_order",
        "admin_update_shopping_item",
      ])
      expect(rows[0].before).toMatchObject({ bought: false })
      expect(rows[0].after).toMatchObject({ bought: true })
      expect(rows[1].before).toEqual({ shopping_order: [a, b] })
      expect(rows[1].after).toEqual({ shopping_order: [b, a] })
      expect(rows[2].before).toMatchObject({ body: "a", quantity: "1" })
      expect(rows[2].after).toMatchObject({ body: "א", quantity: "2" })
    })
  })

  it("a customer sees no row and gets NOT_AUTHORIZED from every RPC", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const item = await add(db, f, id, "a")
      const calls: [string, unknown[]][] = [
        [ADD, [id, ["x"], randomUUID()]],
        [UPDATE, [item, "x", null, randomUUID()]],
        [DELETE, [item, randomUUID()]],
        [BOUGHT, [item, true]],
        [ORDER, [[item]]],
      ]
      await asAuthenticated(db, f.customerA)
      const { rows } = await db.query("select * from public.shopping_items")
      expect(rows).toHaveLength(0)
      for (const [text, params] of calls) {
        expect((await queryError(db, text, params))?.message, text).toBe(
          "NOT_AUTHORIZED"
        )
      }
      await db.query("reset role")
    })
  })
})

describe("photo consent in the session's details", { timeout: 30_000 }, () => {
  it("true, false, no dietary notes for one who wrote none, nothing for a pending booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const ruth = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [ruth, testName("ruth")]
      )
      await db.query(
        "update public.profiles set photo_consent = true, personal_photo_consent = false, dietary_notes = 'ללא גלוטן' where id = $1",
        [f.customerA]
      )
      const policy = '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot,
           guest_details, confirmed_at)
         values
           ($1, $4, 1, 'admin', $5::jsonb, null, now()),
           ($2, $4, 2, 'admin', $5::jsonb, 'צמחונית', now() + interval '1 second'),
           ($3, $4, 1, 'admin', $5::jsonb, null, now() + interval '2 seconds')`,
        [f.customerA, f.customerB, ruth, id, policy]
      )
      const { rows: payment } = await db.query(
        `insert into public.payments (
           product_id, source, recorded_by, payment_method_id,
           amount_agorot, paid_on, product_snapshot, payer_label)
         values ($1, 'manual', $2, $3, 47200, $4::date, '{}'::jsonb, 'Noa')
         returning id`,
        [f.card, f.admin, f.method, f.today]
      )
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot,
           confirmed_at)
         values ($1, $2, 1, 'admin', $3::jsonb, now() + interval '3 seconds')`,
        [payment[0].id, id, policy]
      )

      const r = await call(db, f, DETAILS, [id])
      const bookings = r.bookings as Record<string, unknown>[]
      expect(bookings).toHaveLength(4)
      expect(bookings[0]).toMatchObject({
        customer_id: f.customerA,
        photo_consent: true,
        personal_photo_consent: false,
        dietary_notes: "ללא גלוטן",
      })
      expect(bookings[1]).toMatchObject({
        customer_id: f.customerB,
        photo_consent: false,
        guest_details: "צמחונית",
      })
      expect(bookings[1]).not.toHaveProperty("dietary_notes")
      expect(bookings[2]).toMatchObject({
        customer_id: ruth,
        photo_consent: false,
      })
      expect(bookings[2]).not.toHaveProperty("dietary_notes")
      expect(bookings[2]).not.toHaveProperty("guest_details")
      expect(bookings[3]).toMatchObject({ pending_join: true })
      expect(bookings[3]).not.toHaveProperty("photo_consent")
      expect(bookings[3]).not.toHaveProperty("personal_photo_consent")

      // A customer whose details were removed has no photo_consent either.
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerA]
      )
      const after = (await call(db, f, DETAILS, [id])).bookings
      expect(after[0]).not.toHaveProperty("photo_consent")
      expect(after[0]).not.toHaveProperty("personal_photo_consent")
    })
  })
})
