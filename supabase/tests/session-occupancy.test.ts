// The admin sessions list's occupancy (out-of-tree fix 2026-10-10):
// admin_list_session_occupancy returns private.occupied_places for the
// listed ids. One test per row of the spec's I/O matrix on the RPC. The dev
// database may hold other rows, so every check passes only this test's ids.
// Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, queryError, type Db } from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const OCCUPANCY = "select public.admin_list_session_occupancy($1::uuid[]) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & { concept: string }
type Entry = { event_id: string; occupied: number }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows } = await db.query(
    "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  return { ...f, concept: rows[0].id }
}

// As the owner: a session in `days` days.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    kind?: "regular" | "couple"
    capacity?: number
    days?: number
  } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, $2, now() + make_interval(days => $3::int),
       now() + make_interval(days => $3::int, hours => 2), $4,
       now() + make_interval(days => $3::int - 1), 'published')
     returning id`,
    [
      f.concept,
      options.kind ?? "regular",
      options.days ?? 7,
      options.capacity ?? 12,
    ]
  )
  return rows[0].id
}

// As the owner: a customer's booking.
async function book(
  db: Db,
  eventId: string,
  customerId: string,
  options: { partySize?: 1 | 2; cancelled?: boolean } = {}
) {
  await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, booked_by, policy_snapshot,
       status, cancelled_at)
     values ($1, $2, $3, 'customer', ${SNAPSHOT}, $4,
       case when $4 = 'cancelled' then now() end)`,
    [
      customerId,
      eventId,
      options.partySize ?? 1,
      options.cancelled ? "cancelled" : "confirmed",
    ]
  )
}

async function occupancy(
  db: Db,
  f: Fixture,
  ids: string[] | null
): Promise<Entry[]> {
  await asAuthenticated(db, f.admin)
  try {
    return (await db.query(OCCUPANCY, [ids])).rows[0].r
  } finally {
    await db.query("reset role")
  }
}

describe("admin_list_session_occupancy", () => {
  it("counts confirmed singles", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await book(db, eventId, f.customerA)
      await book(db, eventId, f.customerB)
      expect(await occupancy(db, f, [eventId])).toEqual([
        { event_id: eventId, occupied: 2 },
      ])
    })
  })

  it("a couple booking counts 2", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple", capacity: 14 })
      await book(db, eventId, f.customerA, { partySize: 2 })
      expect(await occupancy(db, f, [eventId])).toEqual([
        { event_id: eventId, occupied: 2 },
      ])
    })
  })

  it("a pinned booking with no customer yet counts", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await asAuthenticated(db, f.admin)
      const payment = await approve(db, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        duplicateConfirmed: true,
        key: randomUUID(),
      })
      await db.query("reset role")
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'admin', ${SNAPSHOT})`,
        [payment.payment_id, eventId]
      )
      expect(await occupancy(db, f, [eventId])).toEqual([
        { event_id: eventId, occupied: 1 },
      ])
    })
  })

  it("a cancelled booking does not count", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await book(db, eventId, f.customerA, { cancelled: true })
      expect(await occupancy(db, f, [eventId])).toEqual([
        { event_id: eventId, occupied: 0 },
      ])
    })
  })

  it("returns every listed session by date; an unknown id is omitted", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const later = await insertEvent(db, f, { days: 9 })
      const sooner = await insertEvent(db, f, { days: 8 })
      await book(db, later, f.customerA)
      expect(await occupancy(db, f, [later, randomUUID(), sooner])).toEqual([
        { event_id: sooner, occupied: 0 },
        { event_id: later, occupied: 1 },
      ])
      expect(await occupancy(db, f, [])).toEqual([])
    })
  })

  it("a customer gets NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await asAuthenticated(db, f.customerA)
      expect(await queryError(db, OCCUPANCY, [[eventId]])).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
      await db.query("reset role")
    })
  })

  it("null input is INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await queryError(db, OCCUPANCY, [null])).toMatchObject({
        code: "P0001",
        message: "INVALID_INPUT",
      })
      await db.query("reset role")
    })
  })
})
