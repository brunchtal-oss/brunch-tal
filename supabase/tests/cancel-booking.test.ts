// Story 3.6: self-cancel within the window and cancellation by Tal.
// cancel_booking, preview_admin_cancel_booking, admin_cancel_booking,
// get_my_bookings, private.cancel_core and the booked state of
// preview_book_session. Since 3.7 a pinned booking becomes a credit (the
// credits themselves: cancellation-credits.test.ts) and a 3.6 returned
// entitlement cancels like a card. One test per row of the spec's I/O matrix; the
// session lock against a parallel booking of the last place is the last
// test (it needs real commits). Each test makes many round trips to the
// dev project, so the timeout is 30 seconds. Everything else runs in inRollback, with the
// settings set inside the transaction and every other published session
// moved to draft there, so the "next sessions" are only this test's.

import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  inRollback,
  onCleanup,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const CANCEL_CHOICE = "select public.cancel_booking($1, $2, $3) as r"
const ADMIN_CANCEL = "select public.admin_cancel_booking($1, $2, $3, $4) as r"
const ADMIN_PREVIEW = "select public.preview_admin_cancel_booking($1) as r"
const MY_BOOKINGS = "select public.get_my_bookings() as r"
const PREVIEW_BOOK = "select public.preview_book_session($1) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  anyDayCard: string
  single: string
  intro: string
  couple: string
  mothers: string
  grandma: string
}

// As the owner: a product of every weekday. A pinned one is validity_mode
// session (one entry).
async function insertProduct(
  db: Db,
  label: string,
  type: "card" | "single" | "intro" | "couple"
): Promise<string> {
  const pinned = type !== "card"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, intro_only)
     values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9)
     returning id`,
    [
      testName(label),
      type,
      pinned ? 12800 : 47200,
      pinned ? 1 : 4,
      pinned ? "session" : "days",
      pinned ? null : 49,
      type === "couple" ? "couple" : "regular",
      type === "couple" ? 2 : 1,
      type === "intro",
    ]
  )
  return rows[0].id
}

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
  const { rows } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  const concepts = Object.fromEntries(rows.map((c) => [c.theme_key, c.id]))
  return {
    ...f,
    anyDayCard: await insertProduct(db, "any_day_card", "card"),
    single: await insertProduct(db, "single", "single"),
    intro: await insertProduct(db, "intro", "intro"),
    couple: await insertProduct(db, "couple", "couple"),
    mothers: concepts.mothers,
    grandma: concepts.grandma,
  }
}

// As the owner: a session of 2 hours, open for booking until it starts.
// inHours: starts now() + that interval; otherwise dayOffset: the local date
// today + n at 10:00 Jerusalem time. Returns its id and local date.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    inHours?: string
    dayOffset?: number
    capacity?: number
    status?: string
    kind?: "regular" | "couple"
    // The registration closed a minute ago (set by hand).
    closed?: boolean
  }
): Promise<{ id: string; day: string }> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $6, s.t, s.t + interval '2 hours', $2,
       case when $7::boolean then now() - interval '1 minute' else s.t end,
       true, $3
     from (
       select case
         when $4::interval is not null then now() + $4::interval
         else (((now() at time zone 'Asia/Jerusalem')::date + $5::int)
               + time '10:00') at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id, ((starts_at at time zone 'Asia/Jerusalem')::date)::text as day`,
    [
      options.kind === "couple" ? f.grandma : f.mothers,
      options.capacity ?? 12,
      options.status ?? "published",
      options.inHours ?? null,
      options.dayOffset ?? null,
      options.kind ?? "regular",
      options.closed ?? false,
    ]
  )
  return rows[0]
}

// As the admin: approves a product (for a pinned one, with its session);
// returns the entitlement id. Leaves the role reset to the owner.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<string> {
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    customerId:
      options.customerId === undefined ? f.customerA : options.customerId,
    productId,
    eventId: options.eventId ?? null,
    amount: productId === f.anyDayCard ? 47200 : 12800,
    paidOn: f.today,
    methodId: f.method,
    duplicateConfirmed: true,
    key: randomUUID(),
  })
  await db.query("reset role")
  const { rows } = await db.query(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return rows[0].id
}

// As `customer`: books the session; returns the booking id. Resets the role.
async function book(
  db: Db,
  customer: string,
  eventId: string
): Promise<string> {
  await asAuthenticated(db, customer)
  const { rows } = await db.query(BOOK, [eventId, randomUUID()])
  await db.query("reset role")
  return rows[0].r.booking_id
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function cancel(
  db: Db,
  customer: string,
  bookingId: string,
  key = randomUUID()
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(CANCEL, [bookingId, key])
    return rows[0].r
  })
}

async function cancelError(db: Db, customer: string, bookingId: string) {
  return as(db, customer, () =>
    queryError(db, CANCEL, [bookingId, randomUUID()])
  )
}

async function bookingRow(db: Db, bookingId: string) {
  const { rows } = await db.query(
    "select status, cancelled_at is not null as has_cancelled_at from public.bookings where id = $1",
    [bookingId]
  )
  return rows[0]
}

async function balance(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    `select b.available, b.reserved, b.expires_on::text as expires_on,
       e.valid_from::text as valid_from, e.pinned_event_id,
       e.eligibility_snapshot
     from public.entitlement_balances b
     join public.entitlements e on e.id = b.entitlement_id
     where b.entitlement_id = $1`,
    [entitlementId]
  )
  return rows[0]
}

async function releases(db: Db, bookingId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.entitlement_movements where booking_id = $1 and action = 'release'",
    [bookingId]
  )
  return rows[0].n
}

async function cancelNotifications(db: Db, customer: string) {
  const { rows } = await db.query(
    `select type, payload ->> 'title' as title, payload ->> 'body' as body,
       target_path
     from public.notifications
     where recipient_id = $1 and type like 'booking_cancelled%'
     order by created_at, id`,
    [customer]
  )
  return rows
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

// How her booking was funded, as get_my_bookings and preview_book_session
// report it (both must agree).
async function fundingSeen(
  db: Db,
  customer: string,
  bookingId: string,
  eventId: string
): Promise<string[]> {
  return as(db, customer, async () => {
    const { rows: mine } = await db.query(MY_BOOKINGS)
    const { rows: preview } = await db.query(PREVIEW_BOOK, [eventId])
    const row = mine[0].r.upcoming.find(
      (b: { booking_id: string }) => b.booking_id === bookingId
    )
    return [row?.funding, preview[0].r.funding]
  })
}

function dayMonth(isoDay: string): string {
  const [, m, d] = isoDay.split("-")
  return `${d}.${m}`
}

describe("cancel_booking: the 48-hour boundary", { timeout: 30_000 }, () => {
  it("a session exactly at the deadline: cancelled, one release, one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { inHours: "48 hours" })
      const bookingId = await book(db, f.customerA, event.id)

      const r = await cancel(db, f.customerA, bookingId)
      expect(r).toEqual({
        booking_id: bookingId,
        outcome: "card",
        entitlement_id: entitlement,
      })
      expect(await bookingRow(db, bookingId)).toEqual({
        status: "cancelled",
        has_cancelled_at: true,
      })
      expect(await releases(db, bookingId)).toBe(1)
      expect(await cancelNotifications(db, f.customerA)).toEqual([
        {
          type: "booking_cancelled",
          title: `ההרשמה ל${dayMonth(event.day)} בוטלה`,
          body: "הכניסה חזרה ליתרה שלך",
          target_path: "/me/bookings",
        },
      ])
    })
  })

  it("one second after the deadline: SELF_CANCEL_CLOSED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, {
        inHours: "47 hours 59 minutes 59 seconds",
      })
      const bookingId = await book(db, f.customerA, event.id)

      expect(await cancelError(db, f.customerA, bookingId)).toEqual({
        code: "P0001",
        message: "SELF_CANCEL_CLOSED",
      })
      expect((await bookingRow(db, bookingId)).status).toBe("confirmed")
      expect(await releases(db, bookingId)).toBe(0)
      expect(await cancelNotifications(db, f.customerA)).toEqual([])
    })
  })

  it("the window from the booking's snapshot: 48 at booking, 72 now, 50 hours ahead -> cancelled", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { inHours: "50 hours" })
      const bookingId = await book(db, f.customerA, event.id)
      await db.query(
        "update public.business_settings set cancel_window_hours = 72"
      )

      const r = await cancel(db, f.customerA, bookingId)
      expect(r.outcome).toBe("card")
      expect((await bookingRow(db, bookingId)).status).toBe("cancelled")
    })
  })
})

describe("cancel_booking: a card", { timeout: 30_000 }, () => {
  it("a card of 4, booked and cancelled: available 4, reserved 0, expires_on unchanged", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await grant(db, f, f.anyDayCard)
      const before = await balance(db, entitlement)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const bookingId = await book(db, f.customerA, event.id)
      expect(await balance(db, entitlement)).toMatchObject({
        available: 3,
        reserved: 1,
      })

      await cancel(db, f.customerA, bookingId)
      expect(await balance(db, entitlement)).toMatchObject({
        available: 4,
        reserved: 0,
        expires_on: before.expires_on,
      })
    })
  })

  it("the same key twice: the same result and one release", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const bookingId = await book(db, f.customerA, event.id)
      const key = randomUUID()

      const first = await cancel(db, f.customerA, bookingId, key)
      const second = await cancel(db, f.customerA, bookingId, key)
      expect(second).toEqual(first)
      expect(await releases(db, bookingId)).toBe(1)
      expect(await cancelNotifications(db, f.customerA)).toHaveLength(1)
    })
  })

  it("a new key after the booking was cancelled: BOOKING_NOT_CANCELLABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const bookingId = await book(db, f.customerA, event.id)
      await cancel(db, f.customerA, bookingId)

      expect(await cancelError(db, f.customerA, bookingId)).toEqual({
        code: "P0001",
        message: "BOOKING_NOT_CANCELLABLE",
      })
      expect(await releases(db, bookingId)).toBe(1)
    })
  })

  it("another customer's booking, or one that does not exist: BOOKING_NOT_CANCELLABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const bookingId = await book(db, f.customerA, event.id)

      expect(await cancelError(db, f.customerB, bookingId)).toEqual({
        code: "P0001",
        message: "BOOKING_NOT_CANCELLABLE",
      })
      expect(await cancelError(db, f.customerB, randomUUID())).toEqual({
        code: "P0001",
        message: "BOOKING_NOT_CANCELLABLE",
      })
      expect((await bookingRow(db, bookingId)).status).toBe("confirmed")
    })
  })

  it("a choice on a card booking: INVALID_INPUT; an admin who is not a customer: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const bookingId = await book(db, f.customerA, event.id)

      expect(
        await as(db, f.customerA, () =>
          queryError(db, CANCEL_CHOICE, [bookingId, randomUUID(), "credit"])
        )
      ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      expect(await cancelError(db, f.admin, bookingId)).toEqual({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
    })
  })

  it("after a cancel the session can be booked again and the place is free", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5, capacity: 1 })
      const bookingId = await book(db, f.customerA, event.id)

      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW_BOOK, [event.id])
        return rows[0].r
      })
      expect(booked).toMatchObject({
        booked: true,
        booking_id: bookingId,
        funding: "card",
        can_self_cancel: true,
      })

      await cancel(db, f.customerA, bookingId)
      expect(await occupied(db, event.id)).toBe(0)
      const again = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW_BOOK, [event.id])
        return rows[0].r
      })
      expect(again).toMatchObject({ ok: true, booked: false })
      await book(db, f.customerA, event.id)
      expect(await occupied(db, event.id)).toBe(1)
    })
  })
})

describe("admin_cancel_booking", { timeout: 30_000 }, () => {
  it("inside the window, confirmed: cancelled, a release to the card, the reason in the audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { inHours: "24 hours" })
      const bookingId = await book(db, f.customerA, event.id)

      const plan = await as(db, f.admin, async () => {
        const { rows } = await db.query(ADMIN_PREVIEW, [bookingId])
        return rows[0].r
      })
      expect(plan).toMatchObject({
        ok: true,
        booking_id: bookingId,
        outcome: "card",
        funding: "card",
        within_window: true,
        pending_join: false,
      })

      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(ADMIN_CANCEL, [
          bookingId,
          true,
          randomUUID(),
          "  ביקשה בטלפון ",
        ])
        return rows[0].r
      })
      expect(r).toMatchObject({
        booking_id: bookingId,
        outcome: "card",
        entitlement_id: entitlement,
      })
      expect((await bookingRow(db, bookingId)).status).toBe("cancelled")
      expect(await balance(db, entitlement)).toMatchObject({
        available: 4,
        reserved: 0,
      })
      const { rows: audit } = await db.query(
        "select actor_kind, reason from public.audit_log where entity_id = $1 and action = 'admin_cancel_booking'",
        [bookingId]
      )
      expect(audit).toEqual([{ actor_kind: "admin", reason: "ביקשה בטלפון" }])
      expect(await cancelNotifications(db, f.customerA)).toHaveLength(1)
    })
  })

  it("without the confirmation: CONFIRM_REQUIRED, nothing changes; a customer: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { inHours: "24 hours" })
      const bookingId = await book(db, f.customerA, event.id)

      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [bookingId, false, randomUUID(), null])
        )
      ).toEqual({ code: "P0001", message: "CONFIRM_REQUIRED" })
      expect((await bookingRow(db, bookingId)).status).toBe("confirmed")
      expect(await releases(db, bookingId)).toBe(0)

      for (const query of [ADMIN_PREVIEW, ADMIN_CANCEL]) {
        const params =
          query === ADMIN_PREVIEW
            ? [bookingId]
            : [bookingId, true, randomUUID(), null]
        expect(
          await as(db, f.customerA, () => queryError(db, query, params))
        ).toEqual({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
    })
  })

  it("a stuck place (pinned, no customer): the place is freed, no notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { dayOffset: 3 })
      const entitlement = await grant(db, f, f.single, {
        customerId: null,
        eventId: event.id,
      })
      const { rows } = await db.query(
        "select id from public.bookings where event_id = $1 and customer_id is null",
        [event.id]
      )
      expect(await occupied(db, event.id)).toBe(1)
      const { rows: notesBefore } = await db.query(
        "select count(*)::int as n from public.notifications"
      )

      const plan = await as(db, f.admin, async () => {
        const { rows: p } = await db.query(ADMIN_PREVIEW, [rows[0].id])
        return p[0].r
      })
      // 3 days ahead: she could still cancel herself, so Tal chooses (3.7).
      expect(plan).toMatchObject({
        ok: true,
        pending_join: true,
        outcome: "credit",
        funding: "pinned",
        choice_required: true,
      })

      await as(db, f.admin, () =>
        db.query("select public.admin_cancel_booking($1, $2, $3, $4, $5)", [
          rows[0].id,
          true,
          randomUUID(),
          null,
          "credit",
        ])
      )
      expect(await occupied(db, event.id)).toBe(0)
      const { rows: notesAfter } = await db.query(
        "select count(*)::int as n from public.notifications"
      )
      expect(notesAfter[0].n).toBe(notesBefore[0].n)
      expect((await balance(db, entitlement)).pinned_event_id).toBe(event.id)
      const { rows: credits } = await db.query(
        "select customer_id, status from public.cancellation_credits where origin_booking_id = $1",
        [rows[0].id]
      )
      expect(credits).toEqual([{ customer_id: null, status: "active" }])
    })
  })

  it("a session that ended: EVENT_ENDED; two kinds of source: MANUAL_HANDLING_REQUIRED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      const ended = await insertEvent(db, f, { inHours: "-3 hours" })
      const { rows: endedBooking } = await db.query(
        `insert into public.bookings (customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'admin', ${SNAPSHOT}) returning id`,
        [f.customerA, ended.id]
      )
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [
            endedBooking[0].id,
            true,
            randomUUID(),
            null,
          ])
        )
      ).toEqual({ code: "P0001", message: "EVENT_ENDED" })

      // A couple booking offset from a card and a single (two kinds).
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const other = await insertEvent(db, f, { dayOffset: 6 })
      const single = await grant(db, f, f.single, { eventId: other.id })
      const { rows: mixed } = await db.query(
        `insert into public.bookings (customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 2, 'admin', ${SNAPSHOT}) returning id`,
        [f.customerB, event.id]
      )
      await db.query(
        `insert into public.booking_allocations (booking_id, entitlement_id, units)
         values ($1, $2, 1), ($1, $3, 1)`,
        [mixed[0].id, card, single]
      )
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [mixed[0].id, true, randomUUID(), null])
        )
      ).toEqual({ code: "P0001", message: "MANUAL_HANDLING_REQUIRED" })
      expect((await bookingRow(db, mixed[0].id)).status).toBe("confirmed")
    })
  })
})

describe(
  "story 3.7: a pinned booking becomes a credit; a 3.6 returned entry cancels like a card",
  { timeout: 30_000 },
  () => {
    it("an intro cancelled before its session (credit): has_participated stays false", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const event = await insertEvent(db, f, { dayOffset: 5 })
        await grant(db, f, f.intro, { eventId: event.id })
        const { rows } = await db.query(
          "select id from public.bookings where event_id = $1 and customer_id = $2",
          [event.id, f.customerA]
        )
        const r = await as(db, f.customerA, async () => {
          const { rows: c } = await db.query(CANCEL_CHOICE, [
            rows[0].id,
            randomUUID(),
            "credit",
          ])
          return c[0].r
        })
        expect(r.outcome).toBe("credit")
        const { rows: p } = await db.query(
          "select private.has_participated($1) as v",
          [f.customerA]
        )
        expect(p[0].v).toBe(false)
      })
    })

    it("a pinned booking is funded 'pinned' on both screens; cancelled with a credit, the entitlement stays pinned and used", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const event = await insertEvent(db, f, { dayOffset: 5 })
        const entitlement = await grant(db, f, f.single, { eventId: event.id })
        const { rows } = await db.query(
          "select id from public.bookings where event_id = $1 and customer_id = $2",
          [event.id, f.customerA]
        )
        expect(
          await fundingSeen(db, f.customerA, rows[0].id, event.id)
        ).toEqual(["pinned", "pinned"])
        await as(db, f.customerA, () =>
          db.query(CANCEL_CHOICE, [rows[0].id, randomUUID(), "credit"])
        )
        expect(await balance(db, entitlement)).toMatchObject({
          available: 0,
          reserved: 0,
          pinned_event_id: event.id,
        })
        expect(await releases(db, rows[0].id)).toBe(0)
        // The cancelled session again, funded by the credit (user decision
        // 2026-10-10, overrides source section 6), never by the entitlement.
        expect(
          await as(db, f.customerA, () =>
            queryError(db, BOOK, [event.id, randomUUID()])
          )
        ).toBeNull()
        const funding = await db.query<{ credit_id: string | null }>(
          `select a.credit_id
           from public.booking_allocations a
           join public.bookings b on b.id = a.booking_id
           where b.event_id = $1 and b.customer_id = $2 and b.status = 'confirmed'`,
          [event.id, f.customerA]
        )
        expect(funding.rows).toHaveLength(1)
        expect(funding.rows[0].credit_id).not.toBeNull()
      })
    })

    it("a 3.6 returned entitlement (pinned_event_id null) funds a booking as 'card' and cancels with a release, no choice", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const gone = await insertEvent(db, f, { dayOffset: 2 })
        const event = await insertEvent(db, f, { dayOffset: 5 })
        const entitlement = await grant(db, f, f.single, { eventId: gone.id })
        // As 3.6 left it: a regular entitlement after the cancel.
        await db.query(
          "update public.bookings set status = 'cancelled', cancelled_at = now() where event_id = $1",
          [gone.id]
        )
        await db.query(
          `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
           select $1, b.id, 'release', 1 from public.bookings b where b.event_id = $2`,
          [entitlement, gone.id]
        )
        await db.query(
          `update public.entitlements
           set pinned_event_id = null, valid_from = $2::date + 1,
               expires_on = $2::date + 30,
               eligibility_snapshot = eligibility_snapshot || jsonb_build_object(
                 'validity_mode', 'days', 'awaiting_sessions', false,
                 'returned_from_event_id', $3::uuid, 'returned_after', $2::date,
                 'options_count', 2)
           where id = $1`,
          [entitlement, gone.day, gone.id]
        )
        const bookingId = await book(db, f.customerA, event.id)
        expect(await fundingSeen(db, f.customerA, bookingId, event.id)).toEqual(
          ["card", "card"]
        )
        expect(
          await as(db, f.customerA, () =>
            queryError(db, CANCEL_CHOICE, [bookingId, randomUUID(), "credit"])
          )
        ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
        const r = await cancel(db, f.customerA, bookingId)
        expect(r).toEqual({
          booking_id: bookingId,
          outcome: "card",
          entitlement_id: entitlement,
        })
        expect(await balance(db, entitlement)).toMatchObject({
          available: 1,
          reserved: 0,
        })
        const { rows: credits } = await db.query(
          "select id from public.cancellation_credits where origin_booking_id = $1",
          [bookingId]
        )
        expect(credits).toEqual([])
        expect(
          (await cancelNotifications(db, f.customerA)).map((n) => n.type)
        ).toEqual(["booking_cancelled"])
      })
    })

    it("a couple pinned booking cancelled with a credit: two places freed", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const event = await insertEvent(db, f, { dayOffset: 5, kind: "couple" })
        await grant(db, f, f.couple, { eventId: event.id })
        const { rows } = await db.query(
          "select id, party_size from public.bookings where event_id = $1 and customer_id = $2",
          [event.id, f.customerA]
        )
        expect(rows[0].party_size).toBe(2)
        expect(await occupied(db, event.id)).toBe(2)
        await as(db, f.customerA, () =>
          db.query(CANCEL_CHOICE, [rows[0].id, randomUUID(), "credit"])
        )
        expect(await occupied(db, event.id)).toBe(0)
        const { rows: credits } = await db.query(
          "select party_size, event_kind from public.cancellation_credits where origin_booking_id = $1",
          [rows[0].id]
        )
        expect(credits).toEqual([{ party_size: 2, event_kind: "couple" }])
      })
    })

    it("preview_book_sessions gives no product_name for a date she is booked to", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const booked = await insertEvent(db, f, { dayOffset: 5 })
        const open = await insertEvent(db, f, { dayOffset: 6 })
        await book(db, f.customerA, booked.id)
        const results = await as(db, f.customerA, async () => {
          const { rows } = await db.query(
            "select public.preview_book_sessions($1::uuid[]) as r",
            [[booked.id, open.id]]
          )
          return rows[0].r.results
        })
        expect(results[0]).toMatchObject({
          event_id: booked.id,
          code: "ALREADY_BOOKED",
        })
        expect(results[0]).not.toHaveProperty("product_name")
        expect(results[1]).toMatchObject({ event_id: open.id, ok: true })
        expect(results[1]).toHaveProperty("product_name")
      })
    })
  }
)

describe("get_my_bookings", { timeout: 30_000 }, () => {
  it("upcoming with can_self_cancel and the funding, past with the cancelled ones", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const far = await insertEvent(db, f, { dayOffset: 5 })
      const near = await insertEvent(db, f, { inHours: "24 hours" })
      const gone = await insertEvent(db, f, { dayOffset: 6 })
      const farBooking = await book(db, f.customerA, far.id)
      const nearBooking = await book(db, f.customerA, near.id)
      const goneBooking = await book(db, f.customerA, gone.id)
      await cancel(db, f.customerA, goneBooking)

      const r = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MY_BOOKINGS)
        return rows[0].r
      })
      expect(r.options_count).toBe(2)
      expect(
        r.upcoming.map((b: Record<string, unknown>) => [
          b.booking_id,
          b.can_self_cancel,
          b.funding,
        ])
      ).toEqual([
        [nearBooking, false, "card"],
        [farBooking, true, "card"],
      ])
      expect(r.past).toEqual([
        expect.objectContaining({
          booking_id: goneBooking,
          status: "cancelled",
          can_self_cancel: false,
        }),
      ])
      // Customer B sees none of them.
      const other = await as(db, f.customerB, async () => {
        const { rows } = await db.query(MY_BOOKINGS)
        return rows[0].r
      })
      expect(other).toMatchObject({ upcoming: [], past: [] })
    })
  })
})

// ---------------------------------------------------------------------------
// The session lock against a parallel booking of the last place (commits)
// ---------------------------------------------------------------------------

async function waitsOnLock(watcher: PoolClient, pid: number): Promise<boolean> {
  for (let tries = 0; tries < 50; tries++) {
    await watcher.query("select pg_stat_clear_snapshot()")
    const { rows } = await watcher.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid]
    )
    if (rows[0]?.wait_event_type === "Lock") return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

describe(
  "cancel against a parallel booking of the last place",
  { timeout: 30_000 },
  () => {
    it("B waits on the session lock while A cancels; after A commits B gets the place", async () => {
      const customerA = randomUUID()
      const customerB = randomUUID()
      const customers = [customerA, customerB]
      const product = randomUUID()
      const method = randomUUID()
      const eventId = randomUUID()

      onCleanup(async () => {
        const client = await getPool().connect()
        try {
          await client.query("begin")
          const entitlements =
            "select id from public.entitlements where customer_id = any($1::uuid[])"
          await client.query(
            "delete from public.notifications where recipient_id = any($1::uuid[])",
            [customers]
          )
          await client.query(
            "delete from public.audit_log where customer_id = any($1::uuid[]) or event_id = $2",
            [customers, eventId]
          )
          await client.query(
            "delete from private.idempotency_results where actor_scope = any($1::text[])",
            [customers]
          )
          await client.query(
            "delete from public.booking_allocations where booking_id in (select id from public.bookings where event_id = $1)",
            [eventId]
          )
          await client.query(
            "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
          )
          await client.query(
            `delete from public.entitlement_movements where entitlement_id in (${entitlements})`,
            [customers]
          )
          await client.query(
            "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
          )
          await client.query(
            "delete from public.bookings where event_id = $1",
            [eventId]
          )
          await client.query(
            "delete from public.entitlements where customer_id = any($1::uuid[])",
            [customers]
          )
          await client.query(
            "delete from public.payments where customer_id = any($1::uuid[])",
            [customers]
          )
          await client.query("delete from public.events where id = $1", [
            eventId,
          ])
          await client.query("delete from public.products where id = $1", [
            product,
          ])
          await client.query(
            "delete from public.payment_methods where id = $1",
            [method]
          )
          await client.query(
            "delete from public.profiles where id = any($1::uuid[])",
            [customers]
          )
          await client.query("commit")
        } catch (error) {
          await client.query("rollback").catch(() => {})
          throw error
        } finally {
          client.release()
        }
      })

      await sql(
        `insert into public.profiles (id, full_name, activated_at)
       values ($1, $2, now()), ($3, $4, now())`,
        [
          customerA,
          testName("cancel_race_a"),
          customerB,
          testName("cancel_race_b"),
        ]
      )
      await sql(
        `insert into public.products (
         id, name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
        [product, testName("cancel_race_card")]
      )
      await sql(
        "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 906)",
        [method, testName("cancel_race_method")]
      )
      for (const customer of customers) {
        const [payment] = await sql<{ id: string }>(
          `insert into public.payments (
           customer_id, product_id, source, recorded_by, payment_method_id,
           amount_agorot, paid_on, product_snapshot)
         values ($1, $2, 'manual', $1, $3, 47200,
           (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
         returning id`,
          [customer, product, method]
        )
        const [entitlement] = await sql<{ id: string }>(
          `insert into public.entitlements (
           customer_id, payment_id, kind, original_units, valid_from,
           expires_on, eligibility_snapshot, allowed_weekdays, eligible_event_kind)
         values ($1, $2, 'card', 4,
           (now() at time zone 'Asia/Jerusalem')::date,
           (now() at time zone 'Asia/Jerusalem')::date + 49,
           '{"validity_mode": "days"}'::jsonb, null, 'regular')
         returning id`,
          [customer, payment.id]
        )
        await sql(
          "insert into public.entitlement_movements (entitlement_id, action, units) values ($1, 'grant', 4)",
          [entitlement.id]
        )
      }
      await sql(
        `insert into public.events (
         id, concept_id, kind, starts_at, ends_at, capacity_adults,
         registration_closes_at, registration_close_overridden, status)
       select $1, c.id, 'regular',
         ((now() at time zone 'Asia/Jerusalem')::date + 5 + time '10:00') at time zone 'Asia/Jerusalem',
         ((now() at time zone 'Asia/Jerusalem')::date + 5 + time '12:00') at time zone 'Asia/Jerusalem',
         1,
         ((now() at time zone 'Asia/Jerusalem')::date + 5 + time '10:00') at time zone 'Asia/Jerusalem',
         true, 'published'
       from public.concepts c
       where c.theme_key = 'mothers'
       limit 1`,
        [eventId]
      )

      // A holds the only place (committed).
      const setup = await getPool().connect()
      let bookingA: string
      try {
        await setup.query("begin")
        await asAuthenticated(setup, customerA)
        const { rows } = await setup.query(BOOK, [eventId, randomUUID()])
        bookingA = rows[0].r.booking_id
        await setup.query("commit")
      } finally {
        setup.release()
      }

      const a = await getPool().connect()
      const b = await getPool().connect()
      let second: Promise<{ rows: { r: { booking_id: string } }[] }> | undefined
      let released = false
      try {
        await a.query("begin")
        await asAuthenticated(a, customerA)
        await a.query(CANCEL, [bookingA, randomUUID()])

        await b.query("begin")
        await asAuthenticated(b, customerB)
        const { rows: pid } = await b.query<{ pid: number }>(
          "select pg_backend_pid() as pid"
        )
        second = b.query(BOOK, [eventId, randomUUID()])
        second.catch(() => {})

        await a.query("reset role")
        expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
        await a.query("commit")
        released = true

        const result = await second
        expect(result.rows[0].r).toEqual({ booking_id: expect.any(String) })
        await b.query("commit")
      } finally {
        if (!released) await a.query("rollback").catch(() => {})
        await second?.catch(() => {})
        await b.query("rollback").catch(() => {})
        a.release()
        b.release()
      }

      const bookings = await sql<{ customer_id: string; status: string }>(
        "select customer_id, status from public.bookings where event_id = $1 order by created_at",
        [eventId]
      )
      expect(bookings).toEqual([
        { customer_id: customerA, status: "cancelled" },
        { customer_id: customerB, status: "confirmed" },
      ])
    }, 30_000)
  }
)
