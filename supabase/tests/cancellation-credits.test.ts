// Story 3.7: cancellation credits, alternative sessions and refund requests.
// cancel_booking / admin_cancel_booking with the refund-or-credit choice,
// private.cancel_core, private.refresh_credit_options and its callers,
// plan_funding's credit first, book_core with a credit, get_my_credits and
// the completion of a credit-funded booking. One test per row of the spec's
// I/O matrix. Everything runs in inRollback, with the settings set inside
// the transaction and every other published session moved to draft there,
// so the "next sessions" are only this test's. Each test makes many round
// trips to the dev project, so the timeout is 30 seconds.

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
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const ADMIN_CANCEL =
  "select public.admin_cancel_booking($1, $2, $3, $4, $5) as r"
const ADMIN_PREVIEW = "select public.preview_admin_cancel_booking($1) as r"
const MY_CREDITS = "select public.get_my_credits() as r"
const MY_BOOKINGS = "select public.get_my_bookings() as r"
const MY_ENTITLEMENTS = "select public.get_my_entitlements() as r"
const PREVIEW_BOOK = "select public.preview_book_session($1) as r"
const PREVIEW_BOOKS = "select public.preview_book_sessions($1::uuid[]) as r"

type Fixture = MoneyFixture & {
  anyDayCard: string
  single: string
  couple: string
  mothers: string
  grandma: string
}

type Choice = "refund" | "credit" | null

async function insertProduct(
  db: Db,
  label: string,
  type: "card" | "single" | "couple"
): Promise<string> {
  const pinned = type !== "card"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, $3, $4, $5, $6, null, $7, $8)
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
    couple: await insertProduct(db, "couple", "couple"),
    mothers: concepts.mothers,
    grandma: concepts.grandma,
  }
}

// As the owner: a session of 2 hours, open for booking until it starts.
// inHours: starts now() + that interval; otherwise dayOffset: the local date
// today + n at 10:00 Jerusalem time.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    inHours?: string
    dayOffset?: number
    capacity?: number
    status?: string
    kind?: "regular" | "couple"
  }
): Promise<{ id: string; day: string }> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $6, s.t, s.t + interval '2 hours', $2, s.t, true, $3
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
    ]
  )
  return rows[0]
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// As the admin: approves a product (a pinned one with its session); returns
// the entitlement and payment ids.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<{ entitlement: string; payment: string }> {
  const r = await as(db, f.admin, () =>
    approve(db, {
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
  )
  const { rows } = await db.query(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return { entitlement: rows[0].id, payment: r.payment_id as string }
}

// A pinned single (or couple) of customer A on the session; returns its
// booking, entitlement and payment.
async function pinned(
  db: Db,
  f: Fixture,
  eventId: string,
  options: { product?: string; customerId?: string | null } = {}
) {
  const g = await grant(db, f, options.product ?? f.single, {
    eventId,
    customerId: options.customerId,
  })
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [g.payment]
  )
  return { booking: rows[0].id as string, ...g }
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

async function cancel(
  db: Db,
  customer: string,
  bookingId: string,
  choice: Choice,
  key = randomUUID()
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(CANCEL, [bookingId, key, choice])
    return rows[0].r
  })
}

async function cancelError(
  db: Db,
  customer: string,
  bookingId: string,
  choice: Choice
) {
  return as(db, customer, () =>
    queryError(db, CANCEL, [bookingId, randomUUID(), choice])
  )
}

async function adminCancel(
  db: Db,
  f: Fixture,
  bookingId: string,
  choice: Choice
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(ADMIN_CANCEL, [
      bookingId,
      true,
      randomUUID(),
      null,
      choice,
    ])
    return rows[0].r
  })
}

async function adminPlan(db: Db, f: Fixture, bookingId: string) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(ADMIN_PREVIEW, [bookingId])
    return rows[0].r
  })
}

async function credit(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select status, customer_id, options_count, party_size, event_kind,
       monetary_basis_agorot, choice_pending
     from public.cancellation_credits where id = $1`,
    [creditId]
  )
  return rows[0]
}

async function creditsOf(db: Db, bookingId: string) {
  const { rows } = await db.query(
    "select id from public.cancellation_credits where origin_booking_id = $1",
    [bookingId]
  )
  return rows.map((r) => r.id as string)
}

// Every option of the credit in assigned order: [event_id, state, reason].
async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select o.event_id, o.state, o.replaced_reason
     from public.credit_options o
     join public.events e on e.id = o.event_id
     where o.credit_id = $1
     order by e.starts_at, e.id`,
    [creditId]
  )
  return rows.map((r) => [r.event_id, r.state, r.replaced_reason])
}

async function refreshAs(db: Db, customer: string) {
  return as(db, customer, async () => (await db.query(MY_CREDITS)).rows[0].r)
}

async function balance(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    "select available, reserved, used from public.entitlement_balances where entitlement_id = $1",
    [entitlementId]
  )
  return rows[0]
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

function dayMonth(isoDay: string): string {
  const [, m, d] = isoDay.split("-")
  return `${d}.${m}`
}

const PINNED_TITLE = (day: string) => `ההרשמה ל${dayMonth(day)} בוטלה`

describe("the cancel outcome", { timeout: 30_000 }, () => {
  it("Sunday cancel of Thursday: the options start after the cancelled session, never before it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const before = await insertEvent(db, f, { dayOffset: 3 })
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const next1 = await insertEvent(db, f, { dayOffset: 7 })
      const next2 = await insertEvent(db, f, { dayOffset: 8 })
      const p = await pinned(db, f, origin.id)

      const r = await cancel(db, f.customerA, p.booking, "credit")
      expect(await options(db, r.credit_id)).toEqual([
        [next1.id, "active", null],
        [next2.id, "active", null],
      ])
      expect((await options(db, r.credit_id)).map((o) => o[0])).not.toContain(
        before.id
      )
    })
  })

  it("choice credit, 72 hours ahead: an active credit with 2 options, the entry used, the place freed, one booking_cancelled_pinned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { inHours: "72 hours" })
      await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const p = await pinned(db, f, origin.id)
      expect(await occupied(db, origin.id)).toBe(1)

      const r = await cancel(db, f.customerA, p.booking, "credit")
      expect(r).toEqual({
        booking_id: p.booking,
        outcome: "credit",
        entitlement_id: p.entitlement,
        credit_id: expect.any(String),
      })
      expect(await credit(db, r.credit_id)).toEqual({
        status: "active",
        customer_id: f.customerA,
        options_count: 2,
        party_size: 1,
        event_kind: "regular",
        monetary_basis_agorot: 12800,
        choice_pending: false,
      })
      expect(await options(db, r.credit_id)).toHaveLength(2)
      expect(await balance(db, p.entitlement)).toEqual({
        available: 0,
        reserved: 0,
        used: 1,
      })
      const { rows: moves } = await db.query(
        "select action, units from public.entitlement_movements where booking_id = $1 order by units",
        [p.booking]
      )
      expect(moves).toEqual([
        { action: "reserve", units: -1 },
        { action: "use", units: 0 },
      ])
      expect(await occupied(db, origin.id)).toBe(0)
      expect(await cancelNotifications(db, f.customerA)).toEqual([
        {
          type: "booking_cancelled_pinned",
          title: PINNED_TITLE(origin.day),
          body: "קיבלת זיכוי להרשמה לאחד המפגשים המתאימים הבאים. אפשר לבחור מפגש בהרשמות שלך",
          target_path: "/me/bookings",
        },
      ])
    })
  })

  it("choice refund: the credit is refund_requested with no options, a request of the amount paid, one booking_cancelled_refund", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { inHours: "72 hours" })
      await insertEvent(db, f, { dayOffset: 6 })
      const p = await pinned(db, f, origin.id)

      const r = await cancel(db, f.customerA, p.booking, "refund")
      expect(r).toMatchObject({
        outcome: "refund",
        credit_id: expect.any(String),
        refund_request_id: expect.any(String),
      })
      expect((await credit(db, r.credit_id)).status).toBe("refund_requested")
      expect(await options(db, r.credit_id)).toEqual([])
      const { rows } = await db.query(
        `select customer_id, credit_id, payment_id, booking_id, amount_agorot,
           status, completed_at, reference, handled_by
         from public.refund_requests where id = $1`,
        [r.refund_request_id]
      )
      expect(rows).toEqual([
        {
          customer_id: f.customerA,
          credit_id: r.credit_id,
          payment_id: p.payment,
          booking_id: p.booking,
          amount_agorot: 12800,
          status: "requested",
          completed_at: null,
          reference: null,
          handled_by: null,
        },
      ])
      expect(await cancelNotifications(db, f.customerA)).toEqual([
        {
          type: "booking_cancelled_refund",
          title: PINNED_TITLE(origin.day),
          body: "בקשת ההחזר התקבלה. נעדכן אותך כשההחזר יבוצע",
          target_path: "/me/bookings",
        },
      ])
      // Her view: the refund, no options, not waiting.
      const mine = await refreshAs(db, f.customerA)
      expect(mine).toEqual([
        expect.objectContaining({
          credit_id: r.credit_id,
          status: "refund_requested",
          options: [],
          waiting: false,
          reserved_booking: null,
          refund: {
            amount_agorot: 12800,
            status: "requested",
            requested_at: expect.any(String),
          },
        }),
      ])
    })
  })

  it("no choice on a pinned booking: INVALID_INPUT, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const p = await pinned(db, f, origin.id)
      expect(await cancelError(db, f.customerA, p.booking, null)).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
      })
      expect(
        await cancelError(db, f.customerA, p.booking, "other" as Choice)
      ).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
      })
      expect(await creditsOf(db, p.booking)).toEqual([])
      expect(await occupied(db, origin.id)).toBe(1)
      expect(await cancelNotifications(db, f.customerA)).toEqual([])
    })
  })

  it("a choice on a card booking: INVALID_INPUT, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const booking = await book(db, f.customerA, event.id)
      expect(await cancelError(db, f.customerA, booking, "credit")).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
      })
      expect(await balance(db, entitlement)).toMatchObject({
        available: 3,
        reserved: 1,
      })
    })
  })

  it("a card booking cancelled: a release to the same card, outcome card", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const booking = await book(db, f.customerA, event.id)
      const r = await cancel(db, f.customerA, booking, null)
      expect(r).toEqual({
        booking_id: booking,
        outcome: "card",
        entitlement_id: entitlement,
      })
      expect(await balance(db, entitlement)).toEqual({
        available: 4,
        reserved: 0,
        used: 0,
      })
      expect(await creditsOf(db, booking)).toEqual([])
      expect((await cancelNotifications(db, f.customerA))[0].type).toBe(
        "booking_cancelled"
      )
    })
  })

  it("the same key twice: the same result and one credit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 6 })
      const p = await pinned(db, f, origin.id)
      const key = randomUUID()
      const first = await cancel(db, f.customerA, p.booking, "credit", key)
      const second = await cancel(db, f.customerA, p.booking, "credit", key)
      expect(second).toEqual(first)
      expect(await creditsOf(db, p.booking)).toHaveLength(1)
      expect(await cancelNotifications(db, f.customerA)).toHaveLength(1)
    })
  })

  it("a couple pinned booking: a credit for two places of a couple session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5, kind: "couple" })
      await insertEvent(db, f, { dayOffset: 6 })
      const couple = await insertEvent(db, f, { dayOffset: 7, kind: "couple" })
      const p = await pinned(db, f, origin.id, { product: f.couple })
      const r = await cancel(db, f.customerA, p.booking, "credit")
      expect(await credit(db, r.credit_id)).toMatchObject({
        party_size: 2,
        event_kind: "couple",
      })
      expect(await options(db, r.credit_id)).toEqual([
        [couple.id, "active", null],
      ])
      // She books the couple session with it (self, 2 places).
      const again = await book(db, f.customerA, couple.id)
      expect(await occupied(db, couple.id)).toBe(2)
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [again]
      )
      expect(rows).toEqual([{ credit_id: r.credit_id, entitlement_id: null }])
    })
  })
})

describe("Tal's cancel", { timeout: 30_000 }, () => {
  it("inside the window: no choice, a credit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { inHours: "24 hours" })
      await insertEvent(db, f, { dayOffset: 4 })
      const p = await pinned(db, f, origin.id)
      expect(await adminPlan(db, f, p.booking)).toMatchObject({
        ok: true,
        outcome: "credit",
        funding: "pinned",
        within_window: true,
        choice_required: false,
        options_count: 2,
        amount_agorot: 12800,
      })
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [
            p.booking,
            true,
            randomUUID(),
            null,
            "refund",
          ])
        )
      ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      const r = await adminCancel(db, f, p.booking, null)
      expect(r.outcome).toBe("credit")
      expect((await credit(db, r.credit_id)).status).toBe("active")
      expect((await cancelNotifications(db, f.customerA))[0].type).toBe(
        "booking_cancelled_pinned"
      )
    })
  })

  it("outside the window: Tal chooses refund; without a choice INVALID_INPUT and nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { inHours: "72 hours" })
      const p = await pinned(db, f, origin.id)
      expect(await adminPlan(db, f, p.booking)).toMatchObject({
        within_window: false,
        choice_required: true,
      })
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [
            p.booking,
            true,
            randomUUID(),
            null,
            null,
          ])
        )
      ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      expect(await creditsOf(db, p.booking)).toEqual([])

      const r = await adminCancel(db, f, p.booking, "refund")
      expect(r.outcome).toBe("refund")
      const { rows } = await db.query(
        "select status, amount_agorot from public.refund_requests where id = $1",
        [r.refund_request_id]
      )
      expect(rows).toEqual([{ status: "requested", amount_agorot: 12800 }])
    })
  })

  it("a card booking: outcome card, no choice; a choice is INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const booking = await book(db, f.customerA, event.id)
      expect(await adminPlan(db, f, booking)).toMatchObject({
        outcome: "card",
        funding: "card",
        choice_required: false,
      })
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_CANCEL, [
            booking,
            true,
            randomUUID(),
            null,
            "credit",
          ])
        )
      ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      expect((await adminCancel(db, f, booking, null)).outcome).toBe("card")
    })
  })

  it("an unbound seat: a credit without a notification; the bind moves it and sends booking_cancelled_pinned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 6 })
      const p = await pinned(db, f, origin.id, { customerId: null })
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.notifications"
      )
      expect(await adminPlan(db, f, p.booking)).toMatchObject({
        pending_join: true,
        choice_required: true,
      })
      const r = await adminCancel(db, f, p.booking, "credit")
      expect(await credit(db, r.credit_id)).toMatchObject({
        status: "active",
        customer_id: null,
      })
      expect(await options(db, r.credit_id)).toHaveLength(1)
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.notifications"
      )
      expect(after[0].n).toBe(before[0].n)

      await db.query("select private.bind_purchase($1, $2)", [
        p.payment,
        f.customerB,
      ])
      expect((await credit(db, r.credit_id)).customer_id).toBe(f.customerB)
      const { rows: sent } = await db.query(
        "select type, dedupe_key, payload ->> 'title' as title from public.notifications where recipient_id = $1 and type like 'booking_cancelled%'",
        [f.customerB]
      )
      expect(sent).toEqual([
        {
          type: "booking_cancelled_pinned",
          dedupe_key: `booking_cancelled_pinned:${f.customerB}:bind:${r.credit_id}`,
          title: PINNED_TITLE(origin.day),
        },
      ])
      // Hers now: she sees it and its option.
      const mine = await refreshAs(db, f.customerB)
      expect(mine).toHaveLength(1)
      expect(mine[0].options).toHaveLength(1)
    })
  })
})

describe("the alternative sessions", { timeout: 30_000 }, () => {
  // Customer A's pinned single on a session 5 days ahead, cancelled with a
  // credit. Returns the credit id.
  async function creditFor(db: Db, f: Fixture): Promise<string> {
    const origin = await insertEvent(db, f, { dayOffset: 5 })
    const p = await pinned(db, f, origin.id)
    const r = await cancel(db, f.customerA, p.booking, "credit")
    return r.credit_id
  }

  it("an option that fills after another customer books is replaced by the next session; a later free place does not bring it back", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6, capacity: 1 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)
      expect(await options(db, creditId)).toEqual([
        [a.id, "active", null],
        [b.id, "active", null],
      ])

      await grant(db, f, f.anyDayCard, { customerId: f.customerB })
      const other = await book(db, f.customerB, a.id)
      // Another customer's booking only changes the states (it never adds
      // an option, AD-6); her next view fills the slot.
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "full"],
        [b.id, "active", null],
      ])
      await refreshAs(db, f.customerA)
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "full"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])

      // Backward change: the place frees again, A stays replaced.
      await cancel(db, f.customerB, other, null)
      await refreshAs(db, f.customerA)
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "full"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])
    })
  })

  it("no future sessions: the credit waits with no options; after a session is published, her next view shows it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const creditId = await creditFor(db, f)
      expect(await options(db, creditId)).toEqual([])
      const waiting = await refreshAs(db, f.customerA)
      expect(waiting).toEqual([
        expect.objectContaining({
          credit_id: creditId,
          status: "active",
          options: [],
          waiting: true,
          reserved_booking: null,
          refund: null,
        }),
      ])

      const later = await insertEvent(db, f, { dayOffset: 9 })
      const mine = await refreshAs(db, f.customerA)
      expect(mine[0]).toMatchObject({ waiting: false })
      expect(mine[0].options).toEqual([
        {
          event_id: later.id,
          starts_at: expect.any(String),
          concept_name: expect.any(String),
          state: "active",
        },
      ])
    })
  })

  it("she fills the last place with the credit: the option is used, no new option, no extension", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6, capacity: 1 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)

      // The sheet says it uses the credit.
      const preview = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW_BOOK, [a.id])
        return rows[0].r
      })
      expect(preview).toMatchObject({
        ok: true,
        source: "credit",
        credit_id: creditId,
        units: 1,
        origin_starts_at: expect.any(String),
      })

      const booking = await book(db, f.customerA, a.id)
      expect(await occupied(db, a.id)).toBe(1)
      expect(await options(db, creditId)).toEqual([
        [a.id, "used", null],
        [b.id, "active", null],
      ])
      const mine = await refreshAs(db, f.customerA)
      expect(mine[0].reserved_booking).toEqual({
        booking_id: booking,
        event_id: a.id,
        starts_at: expect.any(String),
      })
      expect(await options(db, creditId)).toHaveLength(2)

      // How it was funded, on both screens.
      const funding = await as(db, f.customerA, async () => {
        const { rows: list } = await db.query(MY_BOOKINGS)
        const { rows: one } = await db.query(PREVIEW_BOOK, [a.id])
        return [
          list[0].r.upcoming.find(
            (x: { booking_id: string }) => x.booking_id === booking
          )?.funding,
          one[0].r.funding,
        ]
      })
      expect(funding).toEqual(["credit", "credit"])
    })
  })

  it("a second cancel of the credit-funded booking: the same credit and options, no new cycle; a choice is INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)
      const booking = await book(db, f.customerA, a.id)

      expect(await cancelError(db, f.customerA, booking, "credit")).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
      })
      const r = await cancel(db, f.customerA, booking, null)
      expect(r).toEqual({
        booking_id: booking,
        outcome: "credit",
        credit_id: creditId,
      })
      expect(await creditsOf(db, booking)).toEqual([])
      expect((await credit(db, creditId)).status).toBe("active")
      expect(await options(db, creditId)).toEqual([
        [a.id, "active", null],
        [b.id, "active", null],
      ])
      const types = (await cancelNotifications(db, f.customerA)).map(
        (n) => n.type
      )
      expect(types).toEqual([
        "booking_cancelled_pinned",
        "booking_cancelled_pinned",
      ])
    })
  })

  it("an option whose registration closed unused is passed and still counts; no third option", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [a.id]
      )
      await refreshAs(db, f.customerA)
      expect(await options(db, creditId)).toEqual([
        [a.id, "passed", null],
        [b.id, "active", null],
      ])
    })
  })

  it("an option cancelled by the business is replaced (event_cancelled) by the next session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [a.id]
      )
      await refreshAs(db, f.customerA)
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "event_cancelled"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])
    })
  })

  it("a settings change after the credit exists: it keeps its N", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      await insertEvent(db, f, { dayOffset: 8 })
      const creditId = await creditFor(db, f)
      await db.query(
        "update public.business_settings set credit_options_count = 3"
      )
      await refreshAs(db, f.customerA)
      expect((await credit(db, creditId)).options_count).toBe(2)
      expect(await options(db, creditId)).toHaveLength(2)
    })
  })

  it("a capacity change refreshes the session's credits", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6, capacity: 2 })
      await insertEvent(db, f, { dayOffset: 7 })
      const creditId = await creditFor(db, f)
      await grant(db, f, f.anyDayCard, { customerId: f.customerB })
      await book(db, f.customerB, a.id)
      expect((await options(db, creditId))[0]).toEqual([a.id, "active", null])
      await as(db, f.admin, () =>
        db.query("select public.admin_update_event($1, $2, $3)", [
          a.id,
          { capacity_adults: 1 },
          randomUUID(),
        ])
      )
      expect((await options(db, creditId))[0]).toEqual([
        a.id,
        "replaced",
        "full",
      ])
    })
  })

  it("plan_funding takes the credit before a card; preview_book_sessions counts it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const creditId = await creditFor(db, f)
      const { entitlement } = await grant(db, f, f.anyDayCard)
      // Not one of its options: another kind.
      const other = await insertEvent(db, f, { dayOffset: 20, kind: "couple" })
      const availableFor = async (ids: string[]) =>
        as(db, f.customerA, async () => {
          const { rows } = await db.query(PREVIEW_BOOKS, [ids])
          return rows[0].r.available as number
        })
      // Counted only when one of the dates is one of its active options.
      expect(await availableFor([a.id])).toBe(5)
      expect(await availableFor([other.id])).toBe(4)
      const booking = await book(db, f.customerA, a.id)
      const { rows } = await db.query(
        "select credit_id from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(rows).toEqual([{ credit_id: creditId }])
      expect(await balance(db, entitlement)).toMatchObject({ available: 4 })
    })
  })

  it("get_my_entitlements: the pinned entry carries its credit's status; no awaiting or returned fields", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const p = await pinned(db, f, origin.id)
      await cancel(db, f.customerA, p.booking, "refund")
      const mine = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MY_ENTITLEMENTS)
        return rows[0].r
      })
      const entry = mine.find(
        (e: { entitlement_id: string }) => e.entitlement_id === p.entitlement
      )
      expect(entry).toMatchObject({ credit_status: "refund_requested" })
      expect(entry).not.toHaveProperty("awaiting_sessions")
      expect(entry).not.toHaveProperty("returned")
    })
  })

  it("a completed credit-funded booking: the booking is completed and the credit used", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const creditId = await creditFor(db, f)
      const booking = await book(db, f.customerA, a.id)
      await db.query(
        `update public.events
         set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour',
           registration_closes_at = now() - interval '3 hours'
         where id = $1`,
        [a.id]
      )
      await db.query("select private.job_complete_events()")
      const { rows } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(rows[0].status).toBe("completed")
      expect((await credit(db, creditId)).status).toBe("used")
      expect(await refreshAs(db, f.customerA)).toEqual([])
    })
  })

  it("another customer's credits, options and refund requests are not visible; the admin sees them", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, { dayOffset: 6 })
      const creditId = await creditFor(db, f)
      const second = await insertEvent(db, f, { dayOffset: 9 })
      const p = await pinned(db, f, second.id)
      const refund = await cancel(db, f.customerA, p.booking, "refund")
      for (const [user, n] of [
        [f.customerB, 0],
        [f.customerA, 1],
        [f.admin, 1],
      ] as const) {
        const seen = await as(db, user, async () => {
          const { rows: c } = await db.query(
            "select id from public.cancellation_credits where id = $1",
            [creditId]
          )
          const { rows: o } = await db.query(
            "select id from public.credit_options where credit_id = $1",
            [creditId]
          )
          const { rows: r } = await db.query(
            "select id from public.refund_requests where id = $1",
            [refund.refund_request_id]
          )
          return [c.length, Math.min(o.length, 1), r.length]
        })
        expect(seen, user).toEqual([n, n, n])
      }
      expect(await refreshAs(db, f.customerB)).toEqual([])
    })
  })
})

describe("review fixes", { timeout: 30_000 }, () => {
  async function creditOn(db: Db, f: Fixture, dayOffset: number) {
    const origin = await insertEvent(db, f, { dayOffset })
    const p = await pinned(db, f, origin.id)
    const r = await cancel(db, f.customerA, p.booking, "credit")
    return r.credit_id as string
  }

  it("Tal books her into an option: preview and booking fund from the credit (credit_id, option used)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const creditId = await creditOn(db, f, 5)
      const preview = await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select public.preview_admin_book_customer($1, $2) as r",
          [f.customerA, a.id]
        )
        return rows[0].r
      })
      expect(preview).toMatchObject({ ok: true, source: "credit" })
      expect(preview).not.toHaveProperty("expires_on")
      const booked = await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select public.admin_book_customer($1, $2, $3) as r",
          [f.customerA, a.id, randomUUID()]
        )
        return rows[0].r
      })
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [booked.booking_id]
      )
      expect(rows).toEqual([{ credit_id: creditId, entitlement_id: null }])
      expect((await options(db, creditId))[0]).toEqual([a.id, "used", null])
    })
  })

  it("two credits share option X: booked with one, the other's X is replaced (booked) and it gets the next session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const x = await insertEvent(db, f, { dayOffset: 6 })
      const y = await insertEvent(db, f, { dayOffset: 7 })
      const z = await insertEvent(db, f, { dayOffset: 8 })
      const first = await creditOn(db, f, 4)
      const second = await creditOn(db, f, 5)
      expect((await options(db, second)).map((o) => o[0])).toEqual([x.id, y.id])

      await book(db, f.customerA, x.id)
      const { rows } = await db.query(
        "select a.credit_id from public.booking_allocations a join public.bookings b on b.id = a.booking_id where b.event_id = $1 and b.status = 'confirmed'",
        [x.id]
      )
      // Both credits were made in one transaction (the same created_at), so
      // either may fund X; the other one's X is replaced.
      expect([first, second]).toContain(rows[0].credit_id)
      const other = rows[0].credit_id === first ? second : first
      await refreshAs(db, f.customerA)
      expect(await options(db, other)).toEqual([
        [x.id, "replaced", "booked"],
        [y.id, "active", null],
        [z.id, "active", null],
      ])
    })
  })

  it("the fill skips a session she is already booked to (with a card)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const x = await insertEvent(db, f, { dayOffset: 6 })
      const y = await insertEvent(db, f, { dayOffset: 7 })
      const z = await insertEvent(db, f, { dayOffset: 8 })
      await book(db, f.customerA, x.id)
      const creditId = await creditOn(db, f, 5)
      expect((await options(db, creditId)).map((o) => o[0])).toEqual([
        y.id,
        z.id,
      ])
    })
  })

  it("a credit already funding a booking on A does not fund B: no card -> NO_MATCHING_ENTITLEMENT; with a card the entitlement funds it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const creditId = await creditOn(db, f, 5)
      await book(db, f.customerA, a.id)
      expect(
        await as(db, f.customerA, () =>
          queryError(db, BOOK, [b.id, randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
      expect((await options(db, creditId))[1]).toEqual([b.id, "active", null])

      const { entitlement } = await grant(db, f, f.anyDayCard)
      const booking = await book(db, f.customerA, b.id)
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(rows).toEqual([{ credit_id: null, entitlement_id: entitlement }])
    })
  })

  it("Tal cancels a credit-funded booking: no choice, the same credit is active again", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const creditId = await creditOn(db, f, 5)
      const booking = await book(db, f.customerA, a.id)
      expect(await adminPlan(db, f, booking)).toMatchObject({
        ok: true,
        funding: "credit",
        outcome: "credit",
        choice_required: false,
        options_count: 2,
      })
      const r = await adminCancel(db, f, booking, null)
      expect(r).toEqual({
        booking_id: booking,
        outcome: "credit",
        credit_id: creditId,
      })
      expect((await credit(db, creditId)).status).toBe("active")
      expect((await options(db, creditId))[0]).toEqual([a.id, "active", null])
    })
  })

  it("an exhausted credit: both options passed -> exhausted, not waiting", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const creditId = await creditOn(db, f, 5)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = any($1::uuid[])",
        [[a.id, b.id]]
      )
      const mine = await refreshAs(db, f.customerA)
      expect(mine).toEqual([
        expect.objectContaining({
          credit_id: creditId,
          waiting: false,
          exhausted: true,
        }),
      ])
    })
  })

  it("a waiting credit is not exhausted", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await creditOn(db, f, 5)
      const [mine] = await refreshAs(db, f.customerA)
      expect(mine).toMatchObject({ waiting: true, exhausted: false })
    })
  })

  it("an unbound seat cancelled with a refund: the bind sends booking_cancelled_refund", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const p = await pinned(db, f, origin.id, { customerId: null })
      const r = await adminCancel(db, f, p.booking, "refund")
      await db.query("select private.bind_purchase($1, $2)", [
        p.payment,
        f.customerB,
      ])
      const { rows } = await db.query(
        "select type, dedupe_key, target_path, payload ->> 'title' as title from public.notifications where recipient_id = $1 and type like 'booking_cancelled%'",
        [f.customerB]
      )
      expect(rows).toEqual([
        {
          type: "booking_cancelled_refund",
          dedupe_key: `booking_cancelled_refund:${f.customerB}:bind:${r.credit_id}`,
          target_path: "/me/bookings",
          title: PINNED_TITLE(origin.day),
        },
      ])
    })
  })
})

// User decision 2026-10-10 (20261010184900): a credit also funds a booking
// of its origin session, besides its options and without counting toward
// them.
describe("the origin session", { timeout: 30_000 }, () => {
  it("cancel with a credit, book the same session again with it, cancel again: the same credit and options", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const p = await pinned(db, f, origin.id)
      const r = await cancel(db, f.customerA, p.booking, "credit")
      const creditId = r.credit_id as string
      const before = await options(db, creditId)
      expect(before).toEqual([
        [a.id, "active", null],
        [b.id, "active", null],
      ])

      // The sheet: funded by the credit.
      const preview = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW_BOOK, [origin.id])
        return rows[0].r
      })
      expect(preview).toMatchObject({
        ok: true,
        source: "credit",
        credit_id: creditId,
      })
      const many = await as(db, f.customerA, async () => {
        const { rows } = await db.query(PREVIEW_BOOKS, [[origin.id]])
        return rows[0].r
      })
      expect(many.available).toBe(1)

      const again = await book(db, f.customerA, origin.id)
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [again]
      )
      expect(rows).toEqual([{ credit_id: creditId, entitlement_id: null }])
      expect(await options(db, creditId)).toEqual(before)
      const mine = await refreshAs(db, f.customerA)
      expect(mine[0].reserved_booking).toMatchObject({
        booking_id: again,
        event_id: origin.id,
      })

      const second = await cancel(db, f.customerA, again, null)
      expect(second).toEqual({
        booking_id: again,
        outcome: "credit",
        credit_id: creditId,
      })
      expect(await creditsOf(db, again)).toEqual([])
      expect((await credit(db, creditId)).status).toBe("active")
      expect(await options(db, creditId)).toEqual(before)
    })
  })
})
