// Story 3.19: the manual booking screen lists only the sessions a customer
// can be booked for. admin_list_customer_bookable_events: the open sessions
// private.plan_funding(..., 'admin') funds plus those she is booked for, and
// how many were hidden. One test per row of the spec's I/O matrix.
// Everything runs in inRollback, with the settings set inside the
// transaction and every other published session moved to draft there, so
// the open sessions are only this test's. Each test makes many round trips
// to the dev project, so the timeout is 30 seconds.

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

const LIST = "select public.admin_list_customer_bookable_events($1) as r"
const ADMIN_BOOK = "select public.admin_book_customer($1, $2, $3) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const CORRECT =
  "select public.admin_correct_entitlement($1, $2, $3::jsonb, $4, $5, $6, $7) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  couple: string
  mothers: string
  grandma: string
}

type Listed = {
  events: {
    id: string
    starts_at: string
    kind: string
    local_date: string
    weekday: number
    concept_name: string
    occupied: number
    capacity: number
  }[]
  hidden: number
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 1, last_places_threshold = 4`
  )
  // Only this test's sessions are open.
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows: concepts } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  const byTheme = Object.fromEntries(concepts.map((c) => [c.theme_key, c.id]))
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'couple', 25000, 1, 'session', null, null, 'couple', 2)
     returning id`,
    [testName("couple")]
  )
  return {
    ...f,
    couple: rows[0].id,
    mothers: byTheme.mothers,
    grandma: byTheme.grandma,
  }
}

// As the owner: a 2-hour session on the local date today + dayOffset at
// 10:00 Jerusalem time. started: it started an hour ago.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    dayOffset?: number
    kind?: "regular" | "couple"
    capacity?: number
    status?: string
    started?: boolean
  } = {}
): Promise<string> {
  const kind = options.kind ?? "regular"
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '2 hours', $3, s.t, true, $4
     from (
       select case
         when $6::boolean then now() - interval '1 hour'
         else (((now() at time zone 'Asia/Jerusalem')::date + $5::int)
               + time '10:00') at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id`,
    [
      kind === "couple" ? f.grandma : f.mothers,
      kind,
      options.capacity ?? (kind === "couple" ? 14 : 12),
      options.status ?? "published",
      options.dayOffset ?? 7,
      options.started ?? false,
    ]
  )
  return rows[0].id
}

// As the owner: an entitlement of `customer` with its payment and grant,
// valid from today for 49 days, any weekday. pinnedTo: pinned to a session.
async function insertEntitlement(
  db: Db,
  f: Fixture,
  customer: string,
  options: {
    kind?: "card" | "couple" | "single"
    eligibleKind?: "regular" | "couple"
    units?: number
    pinnedTo?: string
  } = {}
): Promise<{ id: string; payment: string }> {
  const kind = options.kind ?? "card"
  const units = options.units ?? 4
  const { rows: payments } = await db.query(
    `insert into public.payments (
       customer_id, product_id, source, recorded_by, payment_method_id,
       amount_agorot, paid_on, product_snapshot)
     values ($1, $2, 'manual', $3, $4, 47200, $5::date,
       jsonb_build_object('name', $6::text))
     returning id`,
    [customer, f.card, f.admin, f.method, f.today, testName(`ent_${kind}`)]
  )
  const { rows } = await db.query(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       pinned_event_id, eligibility_snapshot, allowed_weekdays,
       eligible_event_kind)
     values ($1, $2, $3, $4, $5::date, $5::date + 49, $7,
       jsonb_build_object('validity_mode', $8::text), null, $6)
     returning id`,
    [
      customer,
      payments[0].id,
      kind,
      units,
      f.today,
      options.eligibleKind ?? "regular",
      options.pinnedTo ?? null,
      options.pinnedTo ? "session" : "days",
    ]
  )
  await db.query(
    `insert into public.entitlement_movements (entitlement_id, action, units)
     values ($1, 'grant', $2)`,
    [rows[0].id, units]
  )
  return { id: rows[0].id, payment: payments[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function list(db: Db, f: Fixture, customer: string): Promise<Listed> {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(LIST, [customer])
    return rows[0].r as Listed
  })
}

async function ids(db: Db, f: Fixture, customer: string) {
  const r = await list(db, f, customer)
  return { ids: r.events.map((e) => e.id), hidden: r.hidden }
}

async function listError(db: Db, user: string, customer: string) {
  return as(db, user, () => queryError(db, LIST, [customer]))
}

describe("admin_list_customer_bookable_events", { timeout: 30_000 }, () => {
  it("card only: the regular session is listed, the couple session hidden (hidden = 1); the row has the bookable-events shape", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA)
      const regular = await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4, kind: "couple" })

      const r = await list(db, f, f.customerA)
      expect(r.hidden).toBe(1)
      expect(r.events).toEqual([
        {
          id: regular,
          starts_at: expect.any(String),
          kind: "regular",
          local_date: expect.any(String),
          weekday: expect.any(Number),
          concept_name: expect.any(String),
          occupied: 0,
          capacity: 12,
        },
      ])
    })
  })

  it("a full fundable session stays listed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ent = await insertEntitlement(db, f, f.customerA)
      const full = await insertEvent(db, f, { dayOffset: 3, capacity: 2 })
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot)
         select $1, $2, 1, 'admin', ${SNAPSHOT}
         from generate_series(1, 2)`,
        [ent.payment, full]
      )

      const r = await list(db, f, f.customerA)
      expect(r.events.map((e) => [e.id, e.occupied, e.capacity])).toEqual([
        [full, 2, 2],
      ])
      expect(r.hidden).toBe(0)
    })
  })

  it("couple entitlement: the couple session is listed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerB, {
        kind: "couple",
        eligibleKind: "couple",
      })
      await insertEvent(db, f, { dayOffset: 3 })
      const couple = await insertEvent(db, f, { dayOffset: 4, kind: "couple" })

      expect(await ids(db, f, f.customerB)).toEqual({
        ids: [couple],
        hidden: 1,
      })
    })
  })

  it("couple credit: its active option is listed, another couple session hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5, kind: "couple" })
      const option = await insertEvent(db, f, { dayOffset: 7, kind: "couple" })
      const other = await insertEvent(db, f, { dayOffset: 9, kind: "couple" })
      // A pinned couple on the origin session, cancelled for a credit
      // (credit_options_count = 1: the next couple session is its option).
      const r = await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.couple,
          eventId: origin,
          amount: 25000,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const cancelled = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          r.booking_id,
          randomUUID(),
          "credit",
        ])
        return rows[0].r
      })
      const { rows: options } = await db.query(
        "select event_id from public.credit_options where credit_id = $1 and state = 'active'",
        [cancelled.credit_id]
      )
      expect(options).toEqual([{ event_id: option }])

      const listed = await ids(db, f, f.customerA)
      // plan_funding also funds the credit's origin session (unchanged).
      expect(listed.ids).toContain(option)
      expect(listed.ids).not.toContain(other)
      expect(listed.hidden).toBe(1)
    })
  })

  it("already booked with no entry left: that session is listed, the others hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA, { units: 1 })
      const booked = await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4 })
      await as(db, f.admin, () =>
        db.query(ADMIN_BOOK, [f.customerA, booked, randomUUID()])
      )

      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [booked],
        hidden: 1,
      })
    })
  })

  it("a pinned entitlement (admin mode): its session is listed, another regular session hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pinnedEvent = await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4 })
      await insertEntitlement(db, f, f.customerA, {
        kind: "single",
        units: 1,
        pinnedTo: pinnedEvent,
      })

      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [pinnedEvent],
        hidden: 1,
      })
    })
  })

  it("only a cancelled booking there and nothing to fund: hidden and counted", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA, { units: 1 })
      const cancelled = await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4 })
      const booked = await as(db, f.admin, async () => {
        const { rows } = await db.query(ADMIN_BOOK, [
          f.customerA,
          cancelled,
          randomUUID(),
        ])
        return rows[0].r.booking_id as string
      })
      // Cancelled with no entry back (as the owner): nothing funds her.
      await db.query(
        "update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1",
        [booked]
      )

      expect(await list(db, f, f.customerA)).toEqual({ events: [], hidden: 2 })
    })
  })

  it("the order is by start time", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA)
      const d5 = await insertEvent(db, f, { dayOffset: 5 })
      const d3 = await insertEvent(db, f, { dayOffset: 3 })
      const d4 = await insertEvent(db, f, { dayOffset: 4 })

      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [d3, d4, d5],
        hidden: 0,
      })
    })
  })

  it("expired on the session's date: hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA)
      const inside = await insertEvent(db, f, { dayOffset: 3 })
      // The card expires today + 49.
      await insertEvent(db, f, { dayOffset: 60 })

      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [inside],
        hidden: 1,
      })
    })
  })

  it("a weekday the entitlement does not allow: hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ent = await insertEntitlement(db, f, f.customerA)
      const allowed = await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4 })
      await db.query(
        `update public.entitlements
         set allowed_weekdays = array[
           extract(dow from (now() at time zone 'Asia/Jerusalem')::date + 3)
         ]::smallint[]
         where id = $1`,
        [ent.id]
      )

      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [allowed],
        hidden: 1,
      })
    })
  })

  it("no entitlements: nothing listed, every open session hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, { dayOffset: 3 })
      await insertEvent(db, f, { dayOffset: 4, kind: "couple" })

      expect(await list(db, f, f.customerB)).toEqual({ events: [], hidden: 2 })
    })
  })

  it("no open sessions: nothing listed, nothing hidden", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA)

      expect(await list(db, f, f.customerA)).toEqual({ events: [], hidden: 0 })
    })
  })

  it("draft and started sessions: never listed, never counted", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA)
      await insertEvent(db, f, { dayOffset: 3, status: "draft" })
      await insertEvent(db, f, { started: true })
      const open = await insertEvent(db, f, { dayOffset: 4 })

      expect(await ids(db, f, f.customerA)).toEqual({ ids: [open], hidden: 0 })
      // Nothing funds customer B: still only the open session is counted.
      expect(await ids(db, f, f.customerB)).toEqual({ ids: [], hidden: 1 })
    })
  })

  it("after an entitlement correction (3.13): the list follows the new expiry", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertEntitlement(db, f, f.customerA)
      // The card expires today + 49: a session on day 52 is hidden.
      const later = await insertEvent(db, f, { dayOffset: 52 })
      expect(await ids(db, f, f.customerA)).toEqual({ ids: [], hidden: 1 })

      const { rows } = await db.query("select ($1::date + 56)::text as d", [
        f.today,
      ])
      await as(db, f.admin, () =>
        db.query(CORRECT, [
          card.id,
          "expires_on",
          JSON.stringify(rows[0].d),
          null,
          null,
          true,
          randomUUID(),
        ])
      )
      expect(await ids(db, f, f.customerA)).toEqual({
        ids: [later],
        hidden: 0,
      })
    })
  })

  it("a customer caller: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await listError(db, f.customerA, f.customerA)).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
    })
  })

  it("an unknown, not activated or anonymized customer: CUSTOMER_NOT_AVAILABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pending = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, null)",
        [pending, testName("pending")]
      )
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerB]
      )
      for (const customer of [randomUUID(), pending, f.customerB]) {
        expect(await listError(db, f.admin, customer)).toMatchObject({
          code: "P0001",
          message: "CUSTOMER_NOT_AVAILABLE",
        })
      }
    })
  })
})
