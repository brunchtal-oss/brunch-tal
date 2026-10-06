// Story 4.12: get_my_entitlements, the customer's entitlements with the
// balances of entitlement_balances and the state derived in SQL (days_left,
// is_expiring, is_used_up, by the local date in Asia/Jerusalem). One test per
// database row of the spec's I/O matrix. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const MINE = "select public.get_my_entitlements() as r"

type Row = {
  entitlement_id: string
  kind: string
  status: string
  product_name: string
  amount_agorot: number
  paid_on: string
  original_units: number
  available: number
  reserved: number
  used: number
  expires_on: string
  is_expired: boolean
  expired_before_bound: boolean
  days_left: number
  is_expiring: boolean
  is_used_up: boolean
  validity_days: number | null
  pinned_event_id: string | null
  payment_id: string
}

type Fixture = MoneyFixture & { mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    "update public.business_settings set customer_expiring_days = 10"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null and theme_key = 'mothers'"
  )
  return { ...f, mothers: rows[0].id }
}

// As the admin: approves a product for the customer; returns the
// entitlement. Leaves the role reset to the owner.
async function grant(
  db: Db,
  f: Fixture,
  customerId: string,
  options: { productId?: string; eventId?: string; amount?: number } = {}
): Promise<{ entitlement: string; payment: string }> {
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    customerId,
    productId: options.productId ?? f.card,
    eventId: options.eventId ?? null,
    amount: options.amount ?? 47200,
    paidOn: f.today,
    methodId: f.method,
    // A second card for the same customer is a confirmed repeat purchase.
    duplicateConfirmed: true,
    key: randomUUID(),
  })
  await db.query("reset role")
  const { rows } = await db.query<{ id: string }>(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return { entitlement: rows[0].id, payment: r.payment_id as string }
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

// A published session `days` from now, 2 hours, as the owner.
async function insertEvent(db: Db, f: Fixture, days: number): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', now() + make_interval(days => $2::int),
       now() + make_interval(days => $2::int) + interval '2 hours', 12,
       now() + make_interval(days => $2::int) - interval '1 hour', 'published')
     returning id`,
    [f.mothers, days]
  )
  return rows[0].id
}

async function mine(db: Db, customerId: string): Promise<Row[]> {
  await asAuthenticated(db, customerId)
  const { rows } = await db.query(MINE)
  await db.query("reset role")
  return rows[0].r as Row[]
}

// The movements' own sums, as the owner: available = sum(units); reserved =
// the net reserve of the bookings not used yet; used = that of the bookings
// with a use movement.
async function fromMovements(db: Db, entitlement: string) {
  const { rows } = await db.query(
    `select
       coalesce(sum(units), 0)::int as available,
       coalesce((
         select sum(-net) filter (where not b.used)::int from (
           select booking_id, coalesce(sum(units) filter (where action in ('reserve', 'release')), 0) as net,
                  bool_or(action = 'use') as used
           from public.entitlement_movements
           where entitlement_id = $1 and booking_id is not null
           group by booking_id
         ) b
       ), 0)::int as reserved,
       coalesce((
         select sum(-net) filter (where b.used)::int from (
           select booking_id, coalesce(sum(units) filter (where action in ('reserve', 'release')), 0) as net,
                  bool_or(action = 'use') as used
           from public.entitlement_movements
           where entitlement_id = $1 and booking_id is not null
           group by booking_id
         ) b
       ), 0)::int as used
     from public.entitlement_movements where entitlement_id = $1`,
    [entitlement]
  )
  return rows[0] as { available: number; reserved: number; used: number }
}

describe("get_my_entitlements", () => {
  it("without a session -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      await db.query("set local role authenticated")
      await db.query(
        "select set_config('request.jwt.claims', '{}', true), set_config('request.jwt.claim.sub', '', true)"
      )
      expect(await queryError(db, MINE)).toEqual({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
    })
  })

  it("a signed-in user who is not an activated customer -> []", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await mine(db, f.admin)).toEqual([])
    })
  })

  it("returns only her own rows, with the snapshot name and the amount", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await grant(db, f, f.customerB)
      const rows = await mine(db, f.customerA)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        entitlement_id: a.entitlement,
        payment_id: a.payment,
        kind: "card",
        status: "active",
        product_name: testName("card"),
        amount_agorot: 47200,
        paid_on: f.today,
        original_units: 4,
        available: 4,
        reserved: 0,
        used: 0,
        is_expired: false,
        is_used_up: false,
        validity_days: 49,
        pinned_event_id: null,
      })
    })
  })

  it("days_left by the local date, and is_expiring at the threshold only with available entries", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await endIn(db, a.entitlement, 10)
      let [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({ days_left: 10, is_expiring: true })

      await endIn(db, a.entitlement, 11)
      ;[row] = await mine(db, f.customerA)
      expect(row).toMatchObject({ days_left: 11, is_expiring: false })

      // The last day: 0 days left, still valid until the local day's end.
      await endIn(db, a.entitlement, 0)
      ;[row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        days_left: 0,
        is_expired: false,
        is_expiring: true,
      })

      // Nothing available: never expiring.
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         values ($1, 'adjust', -4)`,
        [a.entitlement]
      )
      ;[row] = await mine(db, f.customerA)
      expect(row).toMatchObject({ available: 0, is_expiring: false })
    })
  })

  it("is_used_up: nothing available or reserved and not expired; an expired one is not used up", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         values ($1, 'adjust', -4)`,
        [a.entitlement]
      )
      let [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({ available: 0, reserved: 0, is_used_up: true })

      await endIn(db, a.entitlement, -1)
      ;[row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        is_expired: true,
        is_used_up: false,
        is_expiring: false,
        days_left: -1,
      })
    })
  })

  it("an expired card with remaining entries is expired, not expiring and not used up", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await endIn(db, a.entitlement, -1)
      const [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        available: 4,
        is_expired: true,
        is_expiring: false,
        is_used_up: false,
      })
    })
  })

  it("orders the rows by expires_on", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const later = await grant(db, f, f.customerA)
      await endIn(db, later.entitlement, 20)
      const sooner = await grant(db, f, f.customerA)
      await endIn(db, sooner.entitlement, 5)
      const rows = await mine(db, f.customerA)
      expect(rows.map((r) => r.entitlement_id)).toEqual([
        sooner.entitlement,
        later.entitlement,
      ])
    })
  })

  it("a revoked entitlement near expiry with remaining entries is neither expiring nor used up", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await endIn(db, a.entitlement, 3)
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [a.entitlement]
      )
      const [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        status: "revoked",
        available: 4,
        days_left: 3,
        is_expiring: false,
        is_used_up: false,
      })
    })
  })

  it("returns expired_before_bound for a card that expired before it was bound", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await grant(db, f, f.customerA)
      await endIn(db, a.entitlement, -1)
      await db.query(
        "update public.entitlements set bound_at = now() where id = $1",
        [a.entitlement]
      )
      const [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        is_expired: true,
        expired_before_bound: true,
      })
    })
  })

  it("a reservation and a pinned booking match the movements", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.customerA)
      // Any weekday, so the session's date always fits the card.
      await db.query(
        "update public.entitlements set allowed_weekdays = null where id = $1",
        [card.entitlement]
      )
      const event = await insertEvent(db, f, 7)
      await asAuthenticated(db, f.customerA)
      const { rows: booked } = await db.query(
        "select public.book_session($1, $2) as r",
        [event, randomUUID()]
      )
      expect(booked[0].r).toHaveProperty("booking_id")
      await db.query("reset role")

      const { rows: products } = await db.query<{ id: string }>(
        `insert into public.products (
           name, type, price_agorot, units, validity_mode, validity_days,
           allowed_weekdays, eligible_event_kind, party_size)
         values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
         returning id`,
        [testName("single")]
      )
      const pinnedEvent = await insertEvent(db, f, 9)
      const pinned = await grant(db, f, f.customerA, {
        productId: products[0].id,
        eventId: pinnedEvent,
        amount: 12800,
      })

      const rows = await mine(db, f.customerA)
      const cardRow = rows.find((r) => r.entitlement_id === card.entitlement)!
      const pinnedRow = rows.find(
        (r) => r.entitlement_id === pinned.entitlement
      )!
      expect(cardRow).toMatchObject({ available: 3, reserved: 1 })
      expect(cardRow).toMatchObject(await fromMovements(db, card.entitlement))
      expect(pinnedRow).toMatchObject({
        kind: "single",
        available: 0,
        reserved: 1,
        pinned_event_id: pinnedEvent,
        is_used_up: false,
      })
      expect(pinnedRow).toMatchObject(
        await fromMovements(db, pinned.entitlement)
      )
      expect(pinnedRow.validity_days).toBeNull()

      // The session ends: a use movement on the card's booking (as the
      // owner) turns the reserved entry into a used one.
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
         values ($1, $2, 'use', 0)`,
        [card.entitlement, booked[0].r.booking_id]
      )
      const usedRow = (await mine(db, f.customerA)).find(
        (r) => r.entitlement_id === card.entitlement
      )!
      expect(usedRow).toMatchObject({ available: 3, reserved: 0, used: 1 })
      expect(usedRow).toMatchObject(await fromMovements(db, card.entitlement))
    })
  })

  it("story 3.12: after the completion job the reserved entry is used, and a card used to the last entry is used up", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.customerA)
      // Any weekday; three entries already went (one left for the booking).
      await db.query(
        "update public.entitlements set allowed_weekdays = null where id = $1",
        [card.entitlement]
      )
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         values ($1, 'adjust', -3)`,
        [card.entitlement]
      )
      const event = await insertEvent(db, f, 7)
      await asAuthenticated(db, f.customerA)
      const { rows: booked } = await db.query(
        "select public.book_session($1, $2) as r",
        [event, randomUUID()]
      )
      expect(booked[0].r).toHaveProperty("booking_id")
      await db.query("reset role")

      let [row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        available: 0,
        reserved: 1,
        used: 0,
        is_used_up: false,
      })

      // The session ended; the job (as the owner, like pg_cron) completes it.
      await db.query(
        `update public.events
         set registration_closes_at = now() - interval '4 hours',
             starts_at = now() - interval '3 hours',
             ends_at = now() - interval '1 hour'
         where id = $1`,
        [event]
      )
      await db.query("select private.job_complete_events()")

      ;[row] = await mine(db, f.customerA)
      expect(row).toMatchObject({
        available: 0,
        reserved: 0,
        used: 1,
        is_expired: false,
        is_used_up: true,
      })
      expect(row).toMatchObject(await fromMovements(db, card.entitlement))
    })
  })
})
