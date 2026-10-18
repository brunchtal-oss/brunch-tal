// Story 4.3: admin_list_open_cards (CAP-42). Which cards are open, the
// three filters, the numbers equal to get_my_entitlements and
// admin_get_customer (after reserve, cancel and completion), entries equal
// to admin_get_customer's, "expiring" equal to the home's expiring_cards,
// and who may call it. One test per row of the spec's I/O matrix. The dev
// database may hold other cards, so most checks look only at this test's
// ids. Everything runs in inRollback; the completion job runs as the owner
// (pg_cron's role) and every other published session is moved to draft in
// the seed, so it completes only this test's sessions.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  approve,
  insertProduct,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const LIST = "select public.admin_list_open_cards($1) as r"
const GET = "select public.admin_get_customer($1) as r"
const MINE = "select public.get_my_entitlements() as r"
const HOME = "select public.admin_get_home() as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const JOB = "select private.job_complete_events() as n"

type Entry = {
  status: string
  starts_at: string
  concept_name: string
  event_id: string
}

type OpenCard = {
  entitlement_id: string
  customer_id: string | null
  customer_label: string | null
  product_name: string | null
  paid_on: string
  original_units: number
  available: number
  reserved: number
  used: number
  expires_on: string
  days_left: number
  is_expiring: boolean
  entries: Entry[]
}

type Fixture = MoneyFixture & {
  mothers: string
  oneEntryCard: string
  single: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set admin_expiring_days = 21, cancel_window_hours = 48`
  )
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null and theme_key = 'mothers'"
  )
  return {
    ...f,
    mothers: rows[0].id,
    oneEntryCard: await insertProduct(db, { label: "one_entry", units: 1 }),
    single: await insertProduct(db, {
      label: "single",
      type: "single",
      price: 12800,
      units: 1,
      validityMode: "session",
    }),
  }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// As the admin: approves a product; returns the entitlement. customerId
// null: a purchase not bound yet (a payer label).
async function grant(
  db: Db,
  f: Fixture,
  options: {
    customerId?: string | null
    productId?: string
    eventId?: string
    payerLabel?: string
  } = {}
): Promise<string> {
  const productId = options.productId ?? f.card
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId:
        options.customerId === undefined ? f.customerA : options.customerId,
      payerLabel: options.payerLabel ?? null,
      productId,
      eventId: options.eventId ?? null,
      amount: productId === f.single ? 12800 : 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return rows[0].id
}

// As the owner: a published session 5 local days from today at 10:00 plus
// `offset` minutes, 2 hours, open until it starts.
async function insertEvent(db: Db, f: Fixture, offset = 0): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + 5)
               + time '10:00') at time zone 'Asia/Jerusalem'
               + make_interval(mins => $2::int) as t
     ) s
     returning id`,
    [f.mothers, offset]
  )
  return rows[0].id
}

// As the owner: the session ended `hoursAgo` hours ago (after it was booked).
async function endSession(db: Db, eventId: string, hoursAgo: number) {
  await db.query(
    `update public.events
     set registration_closes_at = now() - make_interval(hours => $2::int + 3),
         starts_at = now() - make_interval(hours => $2::int + 2),
         ends_at = now() - make_interval(hours => $2::int)
     where id = $1`,
    [eventId, hoursAgo]
  )
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    expect(rows[0].r).toHaveProperty("booking_id")
    return rows[0].r.booking_id as string
  })
}

// As the owner: the entitlement now ends `days` local days from today.
async function endIn(db: Db, entitlement: string, days: number) {
  await db.query(
    `update public.entitlements
     set expires_on = (now() at time zone 'Asia/Jerusalem')::date + $2::int,
         valid_from = least(valid_from, (now() at time zone 'Asia/Jerusalem')::date + $2::int)
     where id = $1`,
    [entitlement, days]
  )
}

async function list(
  db: Db,
  f: Fixture,
  filter: string = "all"
): Promise<OpenCard[]> {
  return as(db, f.admin, async () => (await db.query(LIST, [filter])).rows[0].r)
}

async function listed(db: Db, f: Fixture, id: string, filter = "all") {
  return (await list(db, f, filter)).find((c) => c.entitlement_id === id)
}

// The same entitlement in admin_get_customer and in get_my_entitlements.
async function onCard(db: Db, f: Fixture, customer: string, id: string) {
  const card = await as(
    db,
    f.admin,
    async () => (await db.query(GET, [customer])).rows[0].r
  )
  return card.entitlements.find(
    (e: { entitlement_id: string }) => e.entitlement_id === id
  )
}

async function onMine(db: Db, customer: string, id: string) {
  const mine = await as(
    db,
    customer,
    async () => (await db.query(MINE)).rows[0].r
  )
  return mine.find((e: { entitlement_id: string }) => e.entitlement_id === id)
}

const NUMBERS = ["available", "reserved", "used", "expires_on", "days_left"]

function numbers(row: Record<string, unknown>) {
  return Object.fromEntries(NUMBERS.map((k) => [k, row[k]]))
}

// Numbers equal on all three, and the entries equal to the customer card's.
async function expectSameEverywhere(
  db: Db,
  f: Fixture,
  customer: string,
  id: string
) {
  const open = await listed(db, f, id)
  const card = await onCard(db, f, customer, id)
  const mine = await onMine(db, customer, id)
  expect(open).toBeDefined()
  expect(numbers(open as OpenCard)).toEqual(numbers(card))
  expect(numbers(open as OpenCard)).toEqual(numbers(mine))
  expect(open!.entries).toEqual(card.entries)
  return open as OpenCard
}

// A card of 4: three sessions completed, a fourth booked (open).
async function threeUsedOneReserved(db: Db, f: Fixture) {
  const id = await grant(db, f)
  const past = [
    await insertEvent(db, f, 0),
    await insertEvent(db, f, 60),
    await insertEvent(db, f, 120),
  ]
  for (const eventId of past) await book(db, f.customerA, eventId)
  await endSession(db, past[0], 72)
  await endSession(db, past[1], 48)
  await endSession(db, past[2], 24)
  await db.query(JOB)
  const next = await insertEvent(db, f, 180)
  const booking = await book(db, f.customerA, next)
  return { id, next, booking }
}

describe("admin_list_open_cards", { timeout: 60_000 }, () => {
  it("3 used + 1 reserved: listed with 3 'used' and 1 'booked' entries, no free one; numbers equal get_my_entitlements and admin_get_customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { id, next } = await threeUsedOneReserved(db, f)
      const open = await expectSameEverywhere(db, f, f.customerA, id)
      expect(open).toMatchObject({
        customer_id: f.customerA,
        customer_label: testName("money_a"),
        product_name: testName("card"),
        paid_on: f.today,
        original_units: 4,
        available: 0,
        reserved: 1,
        used: 3,
        is_expiring: false,
        // Story 3.13: never corrected.
        is_extended: false,
      })
      expect(open.entries.map((e) => e.status)).toEqual([
        "completed",
        "completed",
        "completed",
        "confirmed",
      ])
      expect(open.entries[3].event_id).toBe(next)
    })
  })

  it("the last session completes: the card drops from the list and stays on the customer card", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { id, next } = await threeUsedOneReserved(db, f)
      const before = await onCard(db, f, f.customerA, id)
      await endSession(db, next, 1)
      await db.query(JOB)
      expect(await listed(db, f, id)).toBeUndefined()
      const after = await onCard(db, f, f.customerA, id)
      expect(after).toMatchObject({ available: 0, reserved: 0, used: 4 })
      expect(after.entries).toHaveLength(before.entries.length)
      expect(after.entries.every((e: Entry) => e.status === "completed")).toBe(
        true
      )
    })
  })

  it("a booking on the card cancelled: its entry is gone, one more free; numbers still equal on all three", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await grant(db, f)
      const first = await insertEvent(db, f, 0)
      const second = await insertEvent(db, f, 60)
      await book(db, f.customerA, first)
      const booking = await book(db, f.customerA, second)
      let open = await expectSameEverywhere(db, f, f.customerA, id)
      expect(open).toMatchObject({ available: 2, reserved: 2, used: 0 })
      expect(open.entries).toHaveLength(2)

      await as(db, f.customerA, () => db.query(CANCEL, [booking, randomUUID()]))
      open = await expectSameEverywhere(db, f, f.customerA, id)
      expect(open).toMatchObject({ available: 3, reserved: 1, used: 0 })
      expect(open.entries.map((e) => e.event_id)).toEqual([first])
    })
  })

  it("expired, revoked, refunded and pinned entitlements are never listed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const expired = await grant(db, f)
      await endIn(db, expired, -1)
      const revoked = await grant(db, f)
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [revoked]
      )
      const refunded = await grant(db, f)
      await db.query(
        "update public.entitlements set status = 'refunded' where id = $1",
        [refunded]
      )
      const pinned = await grant(db, f, {
        productId: f.single,
        eventId: await insertEvent(db, f),
      })
      // A pinned card (kind card): only pinned_event_id keeps it out.
      const pinnedCard = await grant(db, f, {
        productId: await insertProduct(db, {
          label: "pinned_card",
          type: "card",
          units: 4,
          validityMode: "session",
        }),
        eventId: await insertEvent(db, f, 60),
      })
      const open = await grant(db, f)
      for (const filter of ["all", "available", "expiring"]) {
        const ids = (await list(db, f, filter)).map((c) => c.entitlement_id)
        for (const id of [expired, revoked, refunded, pinned, pinnedCard]) {
          expect(ids, `${filter}:${id}`).not.toContain(id)
        }
      }
      expect(await listed(db, f, open)).toBeDefined()
    })
  })

  it("reserved only (available 0): excluded from 'available' and 'expiring', included in 'all'", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await grant(db, f, { productId: f.oneEntryCard })
      await endIn(db, id, 5)
      await book(db, f.customerA, await insertEvent(db, f))
      expect(await listed(db, f, id, "all")).toMatchObject({
        available: 0,
        reserved: 1,
        is_expiring: false,
      })
      expect(await listed(db, f, id, "available")).toBeUndefined()
      expect(await listed(db, f, id, "expiring")).toBeUndefined()
    })
  })

  it("5 days left, threshold 21, 1 free: 'expiring' with the chip; the same ids as the home's expiring_cards", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await grant(db, f, { productId: f.oneEntryCard })
      await endIn(db, id, 5)
      const later = await grant(db, f, { customerId: f.customerB })
      const unbound = await grant(db, f, {
        customerId: null,
        payerLabel: testName("payer_open"),
      })
      await endIn(db, unbound, 3)

      const expiring = await list(db, f, "expiring")
      expect(expiring.find((c) => c.entitlement_id === id)).toMatchObject({
        available: 1,
        days_left: 5,
        is_expiring: true,
      })
      expect(expiring.map((c) => c.entitlement_id)).not.toContain(later)
      expect(await listed(db, f, later, "available")).toMatchObject({
        is_expiring: false,
      })
      // An unbound purchase: no customer, the payer's label.
      expect(expiring.find((c) => c.entitlement_id === unbound)).toMatchObject({
        customer_id: null,
        customer_label: testName("payer_open"),
      })

      const home = await as(
        db,
        f.admin,
        async () => (await db.query(HOME)).rows[0].r
      )
      const homeIds = (home.expiring_cards as { entitlement_id: string }[]).map(
        (c) => c.entitlement_id
      )
      expect([...expiring.map((c) => c.entitlement_id)].sort()).toEqual(
        [...homeIds].sort()
      )
    })
  })

  it("ordered by expiry, then the customer's label, then the id", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const b = await grant(db, f, { customerId: f.customerB })
      const a = await grant(db, f, { customerId: f.customerA })
      const first = await grant(db, f, { customerId: f.customerB })
      for (const id of [a, b]) await endIn(db, id, 30)
      await endIn(db, first, 20)
      const ids = (await list(db, f))
        .map((c) => c.entitlement_id)
        .filter((id) => [a, b, first].includes(id))
      expect(ids).toEqual([first, a, b])
    })
  })

  it("a bad filter: INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const filter of ["x", "", null]) {
        expect(await queryError(db, LIST, [filter])).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
    })
  })

  it("a customer gets NOT_AUTHORIZED; anon gets 42501", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customerA)
      expect(await queryError(db, LIST, ["all"])).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
      await db.query("reset role")
      await db.query("set local role anon")
      expect(await queryError(db, LIST, ["all"])).toMatchObject({
        code: "42501",
      })
    })
  })
})
