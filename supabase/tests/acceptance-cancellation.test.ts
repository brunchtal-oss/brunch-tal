// Story 6.7: the acceptance suite, "cancellation, credit and refund" (CN3,
// CN5). Each test proves a claim the story-by-story tests left missing or
// weak (T1, T2 of the spec's coverage map). Everything runs in inRollback,
// with the settings set inside the transaction and every other published
// session moved to draft there, so the "next sessions" are only this test's.

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

const BOOK = "select public.book_session($1, $2) as r"
const PREVIEW = "select public.preview_book_session($1) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const REFUND = "select public.admin_refund_credit($1, $2, $3, $4) as r"

type Fixture = MoneyFixture & { single: string; mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2, last_places_threshold = 4`
  )
  // Only this test's sessions count as "the next sessions".
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  const { rows: concepts } = await db.query(
    "select id from public.concepts where theme_key = 'mothers' and archived_at is null"
  )
  return { ...f, single: rows[0].id, mothers: concepts[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// As the owner: a published regular session of 2 hours, open until it
// starts. inHours: starts now() + that interval; otherwise dayOffset: the
// local date today + n at 10:00 Jerusalem time.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: { inHours?: string; dayOffset?: number; capacity?: number }
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', $2, s.t, true,
       'published'
     from (
       select case
         when $3::interval is not null then now() + $3::interval
         else (((now() at time zone 'Asia/Jerusalem')::date + $4::int)
               + time '10:00') at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id`,
    [
      f.mothers,
      options.capacity ?? 12,
      options.inHours ?? null,
      options.dayOffset ?? null,
    ]
  )
  return rows[0].id
}

// As the admin: approves a product for the customer (a pinned single with
// its session). Returns the payment.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  customerId: string,
  eventId: string | null = null
): Promise<string> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      eventId,
      amount: productId === f.single ? 12800 : 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  return r.payment_id as string
}

// Customer A's pinned single on the session: its booking.
async function pinned(db: Db, f: Fixture, eventId: string): Promise<string> {
  const payment = await grant(db, f, f.single, f.customerA, eventId)
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [payment]
  )
  return rows[0].id
}

async function cancel(
  db: Db,
  customer: string,
  bookingId: string,
  choice: "refund" | "credit"
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(CANCEL, [bookingId, randomUUID(), choice])
    return rows[0].r
  })
}

// Every option of the credit in date order: [event_id, state].
async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select o.event_id, o.state
     from public.credit_options o
     join public.events e on e.id = o.event_id
     where o.credit_id = $1
     order by e.starts_at, e.id`,
    [creditId]
  )
  return rows.map((r) => [r.event_id, r.state])
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

async function allocationsOf(db: Db, creditId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.booking_allocations where credit_id = $1",
    [creditId]
  )
  return rows[0].n
}

describe(
  "CN3: only sessions with a free place at the credit's creation",
  { timeout: 30_000 },
  () => {
    it("T1: a session full when the credit is created is not one of its options; the next two after it are", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const origin = await insertEvent(db, f, { dayOffset: 5 })
        const a = await insertEvent(db, f, { dayOffset: 6, capacity: 1 })
        const b = await insertEvent(db, f, { dayOffset: 7 })
        const c = await insertEvent(db, f, { dayOffset: 8 })
        const d = await insertEvent(db, f, { dayOffset: 9 })
        const booking = await pinned(db, f, origin)

        // Customer B takes the only place of a before the cancel.
        await grant(db, f, f.card, f.customerB)
        await as(db, f.customerB, () => db.query(BOOK, [a, randomUUID()]))
        expect(await occupied(db, a)).toBe(1)

        const r = await cancel(db, f.customerA, booking, "credit")
        expect(r).toMatchObject({ credit_id: expect.any(String) })
        expect(await options(db, r.credit_id)).toEqual([
          [b, "active"],
          [c, "active"],
        ])
        expect((await options(db, r.credit_id)).map((o) => o[0])).not.toContain(
          a
        )
        expect((await options(db, r.credit_id)).map((o) => o[0])).not.toContain(
          d
        )
      })
    })
  }
)

describe(
  "CN5: a refund request voids the use of the credit",
  { timeout: 30_000 },
  () => {
    // The refusal, as customer A, to book `eventId` with nothing but the
    // refunded credit: the preview, the booking, the place and the
    // allocations.
    async function expectNotFundable(
      db: Db,
      f: Fixture,
      creditId: string,
      eventId: string
    ) {
      const preview = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW, [eventId])
        return rows[0].r
      })
      expect(preview).toMatchObject({
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
      })
      expect(preview.source).toBeUndefined()
      expect(preview.credit_id).toBeUndefined()
      expect(
        await as(db, f.customerA, () =>
          queryError(db, BOOK, [eventId, randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
      expect(await occupied(db, eventId)).toBe(0)
      expect(await allocationsOf(db, creditId)).toBe(0)
      const { rows } = await db.query(
        "select count(*)::int as n from public.bookings where customer_id = $1 and event_id = $2",
        [f.customerA, eventId]
      )
      expect(rows[0].n).toBe(0)
    }

    it("T2a: a self-cancel 48 hours or more ahead with 'refund': the next sessions cannot be booked with that credit", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const origin = await insertEvent(db, f, { inHours: "72 hours" })
        const a = await insertEvent(db, f, { dayOffset: 6 })
        const b = await insertEvent(db, f, { dayOffset: 7 })
        const booking = await pinned(db, f, origin)

        const r = await cancel(db, f.customerA, booking, "refund")
        expect(r).toMatchObject({
          outcome: "refund",
          credit_id: expect.any(String),
          refund_request_id: expect.any(String),
        })
        const { rows } = await db.query(
          "select status from public.cancellation_credits where id = $1",
          [r.credit_id]
        )
        expect(rows[0].status).toBe("refund_requested")
        // The refund path gives the credit no options at all, so this case
        // proves only the end state (nothing bookable with it). The proof
        // that a refund_requested status blocks a credit that still has
        // active options is T2b.
        expect(await options(db, r.credit_id)).toEqual([])

        for (const eventId of [a, b]) {
          await expectNotFundable(db, f, r.credit_id, eventId)
        }
      })
    })

    it("T2b: an active credit Tal turns into a refund (admin_refund_credit): its options stay listed, but none of them can be booked with it", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const origin = await insertEvent(db, f, { dayOffset: 5 })
        const a = await insertEvent(db, f, { dayOffset: 6 })
        const b = await insertEvent(db, f, { dayOffset: 7 })
        const booking = await pinned(db, f, origin)
        const r = await cancel(db, f.customerA, booking, "credit")
        const creditId = r.credit_id as string
        expect(await options(db, creditId)).toEqual([
          [a, "active"],
          [b, "active"],
        ])
        // Before the refund the option is funded by the credit.
        const before = await as(db, f.customerA, async () => {
          const { rows } = await db.query(PREVIEW, [a])
          return rows[0].r
        })
        expect(before).toMatchObject({
          ok: true,
          source: "credit",
          credit_id: creditId,
        })

        const refunded = await as(db, f.admin, async () => {
          const { rows } = await db.query(REFUND, [
            creditId,
            testName("refund"),
            true,
            randomUUID(),
          ])
          return rows[0].r
        })
        expect(refunded).toMatchObject({
          credit_id: creditId,
          refund_request_id: expect.any(String),
        })
        const { rows } = await db.query(
          "select status from public.cancellation_credits where id = $1",
          [creditId]
        )
        expect(rows[0].status).toBe("refund_requested")
        // Its options are left as they were (credit-adjustments.test.ts:732).
        expect(await options(db, creditId)).toEqual([
          [a, "active"],
          [b, "active"],
        ])

        for (const eventId of [a, b]) {
          await expectNotFundable(db, f, creditId, eventId)
        }
      })
    })
  }
)
