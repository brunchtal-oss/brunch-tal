// Story 3.12: private.job_complete_events (session completion and use
// movements), private.occupied_places over the real bookings, the
// complete_events cron job, and preview_book_session for a completed
// session. One test per row of the spec's I/O matrix. The job is called
// directly inside inRollback, as the owner (pg_cron's role); it completes
// every ended published session of the dev project, but inside the rolled
// back transaction, so only this test's sessions are checked (every other
// published session is moved to draft in the seed). Sessions are booked
// while open and moved to the past afterwards. The locked-session test
// needs real commits and cleans up after itself.

import { randomUUID } from "node:crypto"

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

const JOB = "select private.job_complete_events() as n"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const PREVIEW_BOOK = "select public.preview_book_session($1) as r"
const MY_ENTITLEMENTS = "select public.get_my_entitlements() as r"
const DETAILS = "select public.admin_get_event_details($1) as r"
const HOME = "select public.admin_get_home() as r"

type Fixture = MoneyFixture & {
  anyDayCard: string
  oneEntryCard: string
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
  type: "card" | "single" | "intro" | "couple",
  units?: number
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
      units ?? (pinned ? 1 : 4),
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
  // Only this test's sessions are published (and so completed by the job).
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
    oneEntryCard: await insertProduct(db, "one_entry_card", "card", 1),
    single: await insertProduct(db, "single", "single"),
    intro: await insertProduct(db, "intro", "intro"),
    couple: await insertProduct(db, "couple", "couple"),
    mothers: concepts.mothers,
    grandma: concepts.grandma,
  }
}

// As the owner: a session of 2 hours, 5 local days from today at 10:00
// Jerusalem time, open for booking until it starts.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: { status?: string; kind?: "regular" | "couple" } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $3, s.t, s.t + interval '2 hours', 12, s.t, true, $2
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + 5)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [
      options.kind === "couple" ? f.grandma : f.mothers,
      options.status ?? "published",
      options.kind ?? "regular",
    ]
  )
  return rows[0].id
}

// As the owner: the session ends `endsIn` from now (a negative interval: it
// already ended), after it was booked.
async function moveEnd(db: Db, eventId: string, endsIn = "-1 hour") {
  await db.query(
    `update public.events
     set registration_closes_at = now() + $2::interval - interval '3 hours',
         starts_at = now() + $2::interval - interval '2 hours',
         ends_at = now() + $2::interval
     where id = $1`,
    [eventId, endsIn]
  )
}

// As the admin: approves a product (for a pinned one, with its session);
// returns the entitlement and payment ids. Leaves the role reset to the
// owner.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<{ entitlement: string; payment: string }> {
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    customerId:
      options.customerId === undefined ? f.customerA : options.customerId,
    productId,
    eventId: options.eventId ?? null,
    amount: [f.anyDayCard, f.oneEntryCard].includes(productId) ? 47200 : 12800,
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
  return { entitlement: rows[0].id, payment: r.payment_id as string }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// As `customer`: books the session; returns the booking id.
async function book(
  db: Db,
  customer: string,
  eventId: string
): Promise<string> {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    expect(rows[0].r).toHaveProperty("booking_id")
    return rows[0].r.booking_id as string
  })
}

async function runJob(db: Db): Promise<number> {
  const { rows } = await db.query(JOB)
  return rows[0].n as number
}

async function eventStatus(db: Db, eventId: string): Promise<string> {
  const { rows } = await db.query(
    "select status from public.events where id = $1",
    [eventId]
  )
  return rows[0].status
}

async function bookingOf(db: Db, bookingId: string) {
  const { rows } = await db.query(
    "select status, customer_id from public.bookings where id = $1",
    [bookingId]
  )
  return rows[0] as { status: string; customer_id: string | null }
}

// The booking of a payment (a pinned product), as the owner.
async function bookingOfPayment(db: Db, paymentId: string): Promise<string> {
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [paymentId]
  )
  return rows[0].id
}

async function uses(db: Db, bookingId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.entitlement_movements where booking_id = $1 and action = 'use'",
    [bookingId]
  )
  return rows[0].n
}

async function balance(db: Db, entitlement: string) {
  const { rows } = await db.query(
    "select available, reserved, used from public.entitlement_balances where entitlement_id = $1",
    [entitlement]
  )
  return rows[0] as { available: number; reserved: number; used: number }
}

async function notificationCount(db: Db) {
  const { rows } = await db.query(
    `select (select count(*)::int from public.notifications) as notifications,
            (select count(*)::int from public.notification_jobs) as jobs`
  )
  return rows[0] as { notifications: number; jobs: number }
}

async function audits(db: Db, eventId: string) {
  const { rows } = await db.query(
    `select actor_id, actor_kind, entity_type, entity_id, customer_id, before, after
     from public.audit_log
     where action = 'complete_event' and event_id = $1`,
    [eventId]
  )
  return rows
}

describe("job_complete_events", { timeout: 30_000 }, () => {
  it("use: a card of 4, one booking, the session ended -> session and booking completed, one use; available 3, reserved 0, used 1; one system audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      expect(await balance(db, card.entitlement)).toEqual({
        available: 3,
        reserved: 1,
        used: 0,
      })
      await moveEnd(db, eventId)
      const notificationsBefore = await notificationCount(db)

      expect(await runJob(db)).toBeGreaterThanOrEqual(1)

      expect(await eventStatus(db, eventId)).toBe("completed")
      expect((await bookingOf(db, bookingId)).status).toBe("completed")
      expect(await uses(db, bookingId)).toBe(1)
      expect(await balance(db, card.entitlement)).toEqual({
        available: 3,
        reserved: 0,
        used: 1,
      })
      // The reserve is never edited.
      const { rows: reserve } = await db.query(
        "select units from public.entitlement_movements where booking_id = $1 and action = 'reserve'",
        [bookingId]
      )
      expect(reserve).toEqual([{ units: -1 }])
      // No notification and no push job for the completion.
      expect(await notificationCount(db)).toEqual(notificationsBefore)
      expect(await audits(db, eventId)).toEqual([
        {
          actor_id: null,
          actor_kind: "system",
          entity_type: "events",
          entity_id: eventId,
          customer_id: null,
          before: { status: "published" },
          after: { status: "completed" },
        },
      ])
    })
  })

  it("used up: a card of 1 with its booking, the session ended -> is_used_up through get_my_entitlements", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.oneEntryCard)
      const eventId = await insertEvent(db, f)
      await book(db, f.customerA, eventId)
      await moveEnd(db, eventId)
      await runJob(db)

      const rows = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MY_ENTITLEMENTS)
        return rows[0].r as Array<Record<string, unknown>>
      })
      expect(
        rows.find((r) => r.entitlement_id === card.entitlement)
      ).toMatchObject({
        available: 0,
        reserved: 0,
        used: 1,
        is_expired: false,
        is_used_up: true,
      })
    })
  })

  it("a double run changes nothing: one use and one audit row; the unique index refuses a second use", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      await moveEnd(db, eventId)

      await runJob(db)
      expect(await runJob(db)).toBe(0)

      expect(await eventStatus(db, eventId)).toBe("completed")
      expect(await uses(db, bookingId)).toBe(1)
      expect(await audits(db, eventId)).toHaveLength(1)
      expect(await balance(db, card.entitlement)).toEqual({
        available: 3,
        reserved: 0,
        used: 1,
      })
      expect(
        await queryError(
          db,
          `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
           values ($1, $2, 'use', 0)`,
          [card.entitlement, bookingId]
        )
      ).toMatchObject({ code: "23505" })
    })
  })

  it("not ended yet (ends_at = now() + 1 minute): nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      await moveEnd(db, eventId, "1 minute")

      await runJob(db)

      expect(await eventStatus(db, eventId)).toBe("published")
      expect((await bookingOf(db, bookingId)).status).toBe("confirmed")
      expect(await uses(db, bookingId)).toBe(0)
      expect(await balance(db, card.entitlement)).toEqual({
        available: 3,
        reserved: 1,
        used: 0,
      })
      expect(await audits(db, eventId)).toEqual([])
    })
  })

  it("cancelled: a cancelled booking of an ended session stays cancelled, without use", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      await grant(db, f, f.anyDayCard, { customerId: f.customerB })
      const eventId = await insertEvent(db, f)
      const cancelled = await book(db, f.customerA, eventId)
      const kept = await book(db, f.customerB, eventId)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [cancelled, randomUUID()])
      )
      await moveEnd(db, eventId)

      await runJob(db)

      expect(await eventStatus(db, eventId)).toBe("completed")
      expect((await bookingOf(db, cancelled)).status).toBe("cancelled")
      expect(await uses(db, cancelled)).toBe(0)
      expect((await bookingOf(db, kept)).status).toBe("completed")
      expect(await balance(db, card.entitlement)).toEqual({
        available: 4,
        reserved: 0,
        used: 0,
      })
    })
  })

  it("intro no-show: confirmed, not cancelled -> completed; has_participated and intro_blocked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const intro = await grant(db, f, f.intro, { eventId })
      const bookingId = await bookingOfPayment(db, intro.payment)
      await moveEnd(db, eventId)

      await runJob(db)

      expect((await bookingOf(db, bookingId)).status).toBe("completed")
      expect(await uses(db, bookingId)).toBe(1)
      const { rows } = await db.query(
        "select private.has_participated($1) as p, private.intro_blocked($1, null) as b",
        [f.customerA]
      )
      expect(rows[0]).toEqual({ p: true, b: true })

      // A new intro purchase for her is refused.
      const next = await insertEvent(db, f)
      await asAuthenticated(db, f.admin)
      expect(
        await queryError(
          db,
          "select public.preview_admin_approve_payment($1, null, $2, $3, 12800, $4::date, $5) as r",
          [f.customerA, f.intro, next, f.today, f.method]
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      await db.query("reset role")
    })
  })

  it("couple: a booking of party_size 2 from a couple entitlement -> one use (one unit)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const couple = await grant(db, f, f.couple, { eventId })
      const bookingId = await bookingOfPayment(db, couple.payment)
      const { rows } = await db.query(
        "select party_size from public.bookings where id = $1",
        [bookingId]
      )
      expect(rows[0].party_size).toBe(2)
      await moveEnd(db, eventId)

      await runJob(db)

      expect(await uses(db, bookingId)).toBe(1)
      expect(await balance(db, couple.entitlement)).toEqual({
        available: 0,
        reserved: 0,
        used: 1,
      })
    })
  })

  it("draft or cancelled sessions that ended: nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const draft = await insertEvent(db, f, { status: "draft" })
      const cancelled = await insertEvent(db, f, { status: "cancelled" })
      await moveEnd(db, draft)
      await moveEnd(db, cancelled)

      await runJob(db)

      expect(await eventStatus(db, draft)).toBe("draft")
      expect(await eventStatus(db, cancelled)).toBe("cancelled")
      expect(await audits(db, draft)).toEqual([])
      expect(await audits(db, cancelled)).toEqual([])
    })
  })

  it("admin: occupied of an ended session = the places of the bookings that took place; not in the upcoming sessions of the admin home", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      await grant(db, f, f.anyDayCard, { customerId: f.customerB })
      const eventId = await insertEvent(db, f)
      await book(db, f.customerA, eventId)
      await book(db, f.customerB, eventId)
      await moveEnd(db, eventId)

      await runJob(db)

      const [details, home] = await as(db, f.admin, async () => [
        (await db.query(DETAILS, [eventId])).rows[0].r,
        (await db.query(HOME)).rows[0].r,
      ])
      expect(details.event).toMatchObject({
        status: "completed",
        occupied: 2,
      })
      expect(details.bookings).toHaveLength(2)
      expect(
        (home.upcoming_sessions as Array<{ event_id: string }>).map(
          (s) => s.event_id
        )
      ).not.toContain(eventId)
    })
  })

  it("pinned without a customer: completed with one use; bind_purchase later gives her the booking, without a booking_confirmed notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const pinned = await grant(db, f, f.single, {
        customerId: null,
        eventId,
      })
      const bookingId = await bookingOfPayment(db, pinned.payment)
      expect((await bookingOf(db, bookingId)).customer_id).toBeNull()
      await moveEnd(db, eventId)

      await runJob(db)

      expect(await bookingOf(db, bookingId)).toEqual({
        status: "completed",
        customer_id: null,
      })
      expect(await uses(db, bookingId)).toBe(1)

      await db.query("select private.bind_purchase($1, $2)", [
        pinned.payment,
        f.customerB,
      ])
      expect(await bookingOf(db, bookingId)).toEqual({
        status: "completed",
        customer_id: f.customerB,
      })
      const { rows } = await db.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'booking_confirmed'",
        [f.customerB]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("the boundary: a session with ends_at = now() is completed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      // now() is the transaction's time, so ends_at equals it exactly.
      await moveEnd(db, eventId, "0 seconds")
      const { rows } = await db.query(
        "select ends_at = now() as at_now from public.events where id = $1",
        [eventId]
      )
      expect(rows[0].at_now).toBe(true)

      await runJob(db)

      expect(await eventStatus(db, eventId)).toBe("completed")
      expect((await bookingOf(db, bookingId)).status).toBe("completed")
      expect(await uses(db, bookingId)).toBe(1)
    })
  })

  it("a session that fails is skipped; the other ended session is still completed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const failing = await insertEvent(db, f)
      const other = await insertEvent(db, f)
      const failingBooking = await book(db, f.customerA, failing)
      await moveEnd(db, failing)
      await moveEnd(db, other)
      // Rolled back with the test: completing `failing` raises.
      await db.query(
        `create function public.test_session_completion_fail()
         returns trigger language plpgsql set search_path = '' as $$
         begin
           raise exception 'forced failure';
         end;
         $$`
      )
      await db.query(
        `create trigger test_session_completion_fail
         before update of status on public.events
         for each row when (new.id = '${failing}'::uuid and new.status = 'completed')
         execute function public.test_session_completion_fail()`
      )

      expect(await runJob(db)).toBeGreaterThanOrEqual(1)

      expect(await eventStatus(db, other)).toBe("completed")
      expect(await audits(db, other)).toHaveLength(1)
      // The failing session is untouched, its booking and use rolled back.
      expect(await eventStatus(db, failing)).toBe("published")
      expect((await bookingOf(db, failingBooking)).status).toBe("confirmed")
      expect(await uses(db, failingBooking)).toBe(0)
      expect(await audits(db, failing)).toEqual([])
    })
  })

  it("a completed booking cannot be cancelled: cancel_booking and admin_cancel_booking -> BOOKING_NOT_CANCELLABLE, no release", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grant(db, f, f.anyDayCard)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      await moveEnd(db, eventId)
      await runJob(db)

      await asAuthenticated(db, f.customerA)
      expect(
        await queryError(db, CANCEL, [bookingId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "BOOKING_NOT_CANCELLABLE" })
      await db.query("reset role")

      await asAuthenticated(db, f.admin)
      expect(
        await queryError(
          db,
          "select public.admin_cancel_booking($1, $2, $3, $4) as r",
          [bookingId, true, randomUUID(), null]
        )
      ).toMatchObject({ code: "P0001", message: "BOOKING_NOT_CANCELLABLE" })
      await db.query("reset role")

      const { rows } = await db.query(
        "select count(*)::int as n from public.entitlement_movements where booking_id = $1 and action = 'release'",
        [bookingId]
      )
      expect(rows[0].n).toBe(0)
      expect((await bookingOf(db, bookingId)).status).toBe("completed")
      expect(await balance(db, card.entitlement)).toEqual({
        available: 3,
        reserved: 0,
        used: 1,
      })
    })
  })

  it("a pinned intro without a customer, completed: bind_purchase to a customer without other bookings succeeds (the same purchase does not block the intro)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const intro = await grant(db, f, f.intro, { customerId: null, eventId })
      const bookingId = await bookingOfPayment(db, intro.payment)
      await moveEnd(db, eventId)

      await runJob(db)
      expect(await bookingOf(db, bookingId)).toEqual({
        status: "completed",
        customer_id: null,
      })

      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          intro.payment,
          f.customerB,
        ])
      ).toBeNull()
      expect(await bookingOf(db, bookingId)).toEqual({
        status: "completed",
        customer_id: f.customerB,
      })
    })
  })

  it("the job has no grant: authenticated cannot run it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await queryError(db, JOB)).toMatchObject({ code: "42501" })
      await db.query("reset role")
    })
  })

  it("cron.job has complete_events every 5 minutes", async () => {
    const rows = await sql<{ schedule: string; command: string }>(
      "select schedule, command from cron.job where jobname = 'complete_events'"
    )
    expect(rows).toEqual([
      {
        schedule: "*/5 * * * *",
        command: "select private.job_complete_events()",
      },
    ])
  })
})

describe(
  "preview_book_session of an ended session",
  { timeout: 30_000 },
  () => {
    it("completed, her completed booking -> booked: true, can_self_cancel false, EVENT_COMPLETED", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const eventId = await insertEvent(db, f)
        const bookingId = await book(db, f.customerA, eventId)
        await moveEnd(db, eventId)
        await runJob(db)

        const r = await as(db, f.customerA, async () => {
          const { rows } = await db.query(PREVIEW_BOOK, [eventId])
          return rows[0].r
        })
        expect(r).toEqual({
          ok: false,
          code: "EVENT_COMPLETED",
          booked: true,
          booking_id: bookingId,
          can_self_cancel: false,
        })
      })
    })

    it("completed, no booking of hers -> booked: false, EVENT_NOT_BOOKABLE", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const eventId = await insertEvent(db, f)
        await book(db, f.customerA, eventId)
        await moveEnd(db, eventId)
        await runJob(db)

        const r = await as(db, f.customerB, async () => {
          const { rows } = await db.query(PREVIEW_BOOK, [eventId])
          return rows[0].r
        })
        expect(r).toEqual({
          ok: false,
          code: "EVENT_NOT_BOOKABLE",
          booked: false,
        })
      })
    })

    it("cancelled session with her booking -> as before: EVENT_NOT_BOOKABLE", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const eventId = await insertEvent(db, f)
        await book(db, f.customerA, eventId)
        await db.query(
          "update public.events set status = 'cancelled' where id = $1",
          [eventId]
        )

        const r = await as(db, f.customerA, async () => {
          const { rows } = await db.query(PREVIEW_BOOK, [eventId])
          return rows[0].r
        })
        expect(r).toEqual({
          ok: false,
          code: "EVENT_NOT_BOOKABLE",
          booked: false,
        })
      })
    })

    it("an open session with her confirmed booking -> the booked state as before", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const eventId = await insertEvent(db, f)
        const bookingId = await book(db, f.customerA, eventId)

        const r = await as(db, f.customerA, async () => {
          const { rows } = await db.query(PREVIEW_BOOK, [eventId])
          return rows[0].r
        })
        expect(r).toMatchObject({
          ok: false,
          code: "ALREADY_BOOKED",
          booked: true,
          booking_id: bookingId,
          funding: "card",
          can_self_cancel: true,
        })
      })
    })
  }
)

describe("a locked session", { timeout: 30_000 }, () => {
  // An ended published session (committed). The real complete_events cron
  // also runs on the dev database, so it may complete the session between the
  // insert and the lock; then the attempt is repeated with a new session.
  async function insertEndedSession(): Promise<string> {
    const eventId = randomUUID()
    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        await client.query("delete from public.audit_log where event_id = $1", [
          eventId,
        ])
        await client.query("delete from public.events where id = $1", [eventId])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })

    await sql(
      `insert into public.events (
         id, concept_id, kind, starts_at, ends_at, capacity_adults,
         registration_closes_at, registration_close_overridden, status)
       select $1, c.id, 'regular', now() - interval '3 hours',
         now() - interval '1 hour', 12, now() - interval '4 hours', true,
         'published'
       from public.concepts c
       where c.theme_key = 'mothers'
       limit 1`,
      [eventId]
    )
    return eventId
  }

  it("a session held by another transaction is skipped on this run and completed on the next", async () => {
    let eventId: string | null = null

    for (let attempt = 0; attempt < 3 && eventId === null; attempt++) {
      const candidate = await insertEndedSession()
      const holder = await getPool().connect()
      try {
        // A manual booking holds the session.
        await holder.query("begin")
        const { rows } = await holder.query<{ status: string }>(
          "select status from public.events where id = $1 for update",
          [candidate]
        )
        if (rows[0]?.status !== "published") {
          continue
        }
        eventId = candidate

        await inRollback(async (db) => {
          await runJob(db)
          expect(await eventStatus(db, candidate)).toBe("published")
          expect(await audits(db, candidate)).toEqual([])
        })
      } finally {
        await holder.query("rollback").catch(() => {})
        holder.release()
      }
    }

    expect(eventId).not.toBeNull()
    await inRollback(async (db) => {
      await runJob(db)
      expect(await eventStatus(db, eventId!)).toBe("completed")
      expect(await audits(db, eventId!)).toHaveLength(1)
    })
  })
})
