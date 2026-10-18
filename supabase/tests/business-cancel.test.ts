// Story 3.8: the business cancels or changes a session. admin_cancel_event
// and admin_reschedule_event with their plans and previews, the business
// mode of private.cancel_core, choose_credit_outcome, the 'moved' option,
// the bind of a business-cancelled held place, get_my_credits and "to
// handle". One test per row of the spec's I/O matrix (the concurrent row is
// in booking-concurrency.test.ts: it needs real commits). Everything runs in
// inRollback, with the settings set inside the transaction and every other
// published session moved to draft there, so the "next sessions" are only
// this test's.

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
const CANCEL_EVENT = "select public.admin_cancel_event($1, $2, $3, $4) as r"
const CANCEL_EVENT_PARKED =
  "select public.admin_cancel_event($1, $2, $3, $4, $5) as r"
const PREVIEW_CANCEL = "select public.preview_admin_cancel_event($1) as r"
const RESCHEDULE =
  "select public.admin_reschedule_event($1, $2, $3, $4, $5, $6) as r"
const PREVIEW_RESCHEDULE =
  "select public.preview_admin_reschedule_event($1, $2, $3) as r"
const CHOOSE = "select public.choose_credit_outcome($1, $2, $3) as r"
const MY_CREDITS = "select public.get_my_credits() as r"
const ATTENTION = "select public.admin_get_attention_items() as r"
const JOB_REMINDERS = "select private.job_reminders() as n"

const MESSAGE = "מצטערות, המפגש בוטל. כל הפרטים באזור האישי"

type Fixture = MoneyFixture & {
  anyDayCard: string
  single: string
  mothers: string
  mothersName: string
}

async function insertProduct(
  db: Db,
  label: string,
  type: "card" | "single"
): Promise<string> {
  const pinned = type !== "card"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, $3, $4, $5, $6, null, 'regular', 1)
     returning id`,
    [
      testName(label),
      type,
      pinned ? 12800 : 47200,
      pinned ? 1 : 4,
      pinned ? "session" : "days",
      pinned ? null : 49,
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
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query<{ id: string; name: string }>(
    "select id, name from public.concepts where theme_key = 'mothers' and archived_at is null limit 1"
  )
  return {
    ...f,
    anyDayCard: await insertProduct(db, "any_day_card", "card"),
    single: await insertProduct(db, "single", "single"),
    mothers: rows[0].id,
    mothersName: rows[0].name,
  }
}

// As the owner: a 2-hour regular session, open until it starts.
// inHours: starts now() + that interval; otherwise the local date today +
// dayOffset at `at` (default 10:00) Jerusalem time.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    inHours?: string
    dayOffset?: number
    at?: string
    capacity?: number
  }
): Promise<{ id: string; day: string; starts_at: Date }> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', $2, s.t, true, 'published'
     from (
       select case
         when $3::interval is not null then now() + $3::interval
         else (((now() at time zone 'Asia/Jerusalem')::date + $4::int)
               + $5::time) at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id, starts_at,
       ((starts_at at time zone 'Asia/Jerusalem')::date)::text as day`,
    [
      f.mothers,
      options.capacity ?? 12,
      options.inHours ?? null,
      options.dayOffset ?? null,
      options.at ?? "10:00",
    ]
  )
  return rows[0]
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    // An aborted transaction keeps fn's error, not this one.
    await db.query("reset role").catch(() => {})
  }
}

async function newCustomer(db: Db, label: string): Promise<string> {
  const id = randomUUID()
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [id, testName(label)]
  )
  return id
}

// As the admin: approves a product (a pinned one with its session).
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

// A pinned single on the session; its booking, entitlement and payment.
async function pinned(
  db: Db,
  f: Fixture,
  eventId: string,
  customerId: string | null = f.customerA
) {
  const g = await grant(db, f, f.single, { eventId, customerId })
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

// A card of 4 for any day, booked on the session.
async function cardBooking(
  db: Db,
  f: Fixture,
  customer: string,
  eventId: string
) {
  const g = await grant(db, f, f.anyDayCard, { customerId: customer })
  return { booking: await book(db, customer, eventId), ...g }
}

async function cancelEvent(
  db: Db,
  f: Fixture,
  eventId: string,
  options: { confirmed?: boolean; message?: string; key?: string } = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(CANCEL_EVENT, [
      eventId,
      options.confirmed ?? true,
      options.message ?? MESSAGE,
      options.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

async function cancelPlan(db: Db, f: Fixture, eventId: string) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(PREVIEW_CANCEL, [eventId])
    return rows[0].r
  })
}

async function reschedule(
  db: Db,
  f: Fixture,
  eventId: string,
  startsAt: string,
  endsAt: string,
  message = "הבראנץ׳ זז בחצי שעה"
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(RESCHEDULE, [
      eventId,
      startsAt,
      endsAt,
      true,
      message,
      randomUUID(),
    ])
    return rows[0].r
  })
}

async function choose(
  db: Db,
  customer: string,
  creditId: string,
  choice: "refund" | "credit",
  key = randomUUID()
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(CHOOSE, [creditId, choice, key])
    return rows[0].r
  })
}

async function myCredits(db: Db, customer: string) {
  return as(db, customer, async () => (await db.query(MY_CREDITS)).rows[0].r)
}

async function attention(db: Db, f: Fixture) {
  return as(db, f.admin, async () => (await db.query(ATTENTION)).rows[0].r)
}

async function creditOf(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `select id, status, customer_id, choice_pending, monetary_basis_agorot
     from public.cancellation_credits where origin_booking_id = $1`,
    [bookingId]
  )
  return rows[0]
}

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

async function notificationsOf(db: Db, customer: string, type: string) {
  const { rows } = await db.query(
    `select payload ->> 'title' as title, payload ->> 'body' as body,
       dedupe_key, target_path
     from public.notifications
     where recipient_id = $1 and type = $2
     order by created_at, id`,
    [customer, type]
  )
  return rows
}

async function cancelNotices(db: Db, customer: string) {
  const { rows } = await db.query(
    "select type from public.notifications where recipient_id = $1 and type like 'booking_cancelled%'",
    [customer]
  )
  return rows
}

function dayMonth(isoDay: string): string {
  const [, m, d] = isoDay.split("-")
  return `${d}.${m}`
}

async function revision(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query(
    "select revision from public.events where id = $1",
    [eventId]
  )
  return rows[0].revision
}

describe("cancel a session", { timeout: 60_000 }, () => {
  it("mixed: card released, two credits choice_pending, the session cancelled, two event_cancelled with her body", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 7 })
      const card = await cardBooking(db, f, f.customerA, ev.id)
      const pin = await pinned(db, f, ev.id, f.customerB)
      const unbound = await pinned(db, f, ev.id, null)

      const plan = await cancelPlan(db, f, ev.id)
      expect(plan).toMatchObject({
        ok: true,
        event_id: ev.id,
        concept_name: f.mothersName,
        booking_count: 3,
        places: 3,
        card_count: 1,
        // The held place counts once, as unbound: 1 + 1 + 1 = 3.
        choice_count: 1,
        unbound_count: 1,
        at_risk: [],
        parked: [],
        title: `הבראנץ׳ של ${dayMonth(ev.day)} בוטל`,
        body: "אם נרשמת עם כרטיסייה, הכניסה חזרה אלייך. אם שילמת על המפגש בנפרד, ראי פרטים באזור האישי",
      })

      const r = await cancelEvent(db, f, ev.id, { message: `  ${MESSAGE}  ` })
      expect(r).toEqual({
        event_id: ev.id,
        cancelled: 3,
        card_count: 1,
        choice_count: 1,
        notified: 2,
      })

      const { rows: evRows } = await db.query(
        "select status, revision from public.events where id = $1",
        [ev.id]
      )
      expect(evRows[0]).toEqual({ status: "cancelled", revision: 2 })
      const { rows: bookings } = await db.query(
        "select status from public.bookings where event_id = $1",
        [ev.id]
      )
      expect(bookings.every((b) => b.status === "cancelled")).toBe(true)

      const { rows: bal } = await db.query(
        "select available, reserved from public.entitlement_balances where entitlement_id = $1",
        [card.entitlement]
      )
      expect(bal[0]).toEqual({ available: 4, reserved: 0 })

      for (const b of [pin.booking, unbound.booking]) {
        const c = await creditOf(db, b)
        expect(c).toMatchObject({
          status: "active",
          choice_pending: true,
          monetary_basis_agorot: 12800,
        })
        expect(await options(db, c.id)).toEqual([])
        const { rows: refunds } = await db.query(
          "select 1 from public.refund_requests where credit_id = $1",
          [c.id]
        )
        expect(refunds).toEqual([])
      }
      expect((await creditOf(db, unbound.booking)).customer_id).toBeNull()

      for (const customer of [f.customerA, f.customerB]) {
        expect(await notificationsOf(db, customer, "event_cancelled")).toEqual([
          {
            title: `הבראנץ׳ של ${dayMonth(ev.day)} בוטל`,
            body: MESSAGE,
            dedupe_key: `event_cancelled:${customer}:${ev.id}:2`,
            target_path: "/me/bookings",
          },
        ])
        expect(await cancelNotices(db, customer)).toEqual([])
      }

      const { rows: audit } = await db.query(
        "select action, entity_type from public.audit_log where event_id = $1 and entity_type = 'events'",
        [ev.id]
      )
      expect(audit).toEqual([
        { action: "admin_cancel_event", entity_type: "events" },
      ])

      // The pending choice shows to her and in "to handle".
      const mine = await myCredits(db, f.customerB)
      expect(mine).toEqual([
        expect.objectContaining({
          choice_pending: true,
          options: [],
          waiting: false,
          exhausted: false,
          cancelled_starts_at: expect.any(String),
        }),
      ])
      const items = await attention(db, f)
      // Only this session's: dev may hold other pending choices.
      const pending = items.filter(
        (i: { kind: string; event_id?: string }) =>
          i.kind === "choice_pending" && i.event_id === ev.id
      )
      expect(pending).toEqual([
        expect.objectContaining({
          kind: "choice_pending",
          id: (await creditOf(db, pin.booking)).id,
          customer_id: f.customerB,
          event_id: ev.id,
          concept_name: f.mothersName,
          amount_agorot: 12800,
        }),
      ])
    })
  })

  it("without the checkbox: CONFIRM_REQUIRED and nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      const pin = await pinned(db, f, ev.id)
      const err = await as(db, f.admin, () =>
        queryError(db, CANCEL_EVENT, [ev.id, false, MESSAGE, randomUUID()])
      )
      expect(err).toEqual({ code: "P0001", message: "CONFIRM_REQUIRED" })
      const { rows } = await db.query(
        "select e.status, b.status as booking from public.events e join public.bookings b on b.event_id = e.id where e.id = $1",
        [ev.id]
      )
      expect(rows).toEqual([{ status: "published", booking: "confirmed" }])
      expect(await creditOf(db, pin.booking)).toBeUndefined()
    })
  })

  it("a message empty or over 1000: INVALID_INPUT; a draft, cancelled or started session: EVENT_NOT_CANCELLABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      for (const message of ["   ", "א".repeat(1001)]) {
        expect(
          await as(db, f.admin, () =>
            queryError(db, CANCEL_EVENT, [ev.id, true, message, randomUUID()])
          )
        ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      }
      const started = await insertEvent(db, f, { inHours: "-1 hour" })
      expect(await cancelPlan(db, f, started.id)).toEqual({
        ok: false,
        code: "EVENT_NOT_CANCELLABLE",
      })
      await cancelEvent(db, f, ev.id)
      expect(
        await as(db, f.admin, () =>
          queryError(db, CANCEL_EVENT, [ev.id, true, MESSAGE, randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "EVENT_NOT_CANCELLABLE" })
    })
  })

  it("at risk: a card that expires before any other matching session is listed (no_session_before_expiry); an expired one (expired)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 9 })
      const soon = await cardBooking(db, f, f.customerA, ev.id)
      const fine = await cardBooking(db, f, f.customerB, ev.id)
      const c = await newCustomer(db, "expired_card")
      const old = await cardBooking(db, f, c, ev.id)
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 6
         where id = $1`,
        [soon.entitlement]
      )
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date - 1,
             valid_from = (now() at time zone 'Asia/Jerusalem')::date - 10
         where id = $1`,
        [old.entitlement]
      )

      // A's only other session before her expiry is one she is already in.
      const other = await insertEvent(db, f, { dayOffset: 6 })
      await book(db, f.customerA, other.id)

      const plan = await cancelPlan(db, f, ev.id)
      expect(plan.at_risk).toEqual([
        {
          customer_id: c,
          customer_label: testName("expired_card"),
          product_name: testName("any_day_card"),
          expires_on: expect.any(String),
          reason: "expired",
        },
        {
          customer_id: f.customerA,
          customer_label: testName("money_a"),
          product_name: testName("any_day_card"),
          expires_on: expect.any(String),
          reason: "no_session_before_expiry",
        },
      ])
      expect(
        plan.at_risk.map((r: { customer_id: string }) => r.customer_id)
      ).not.toContain(f.customerB)
      expect(fine.booking).toEqual(expect.any(String))
    })
  })

  it("a credit-funded booking: the same credit choice_pending, its option replaced (event_cancelled); choosing credit continues the same options", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const p = await pinned(db, f, origin.id)
      const first = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          p.booking,
          randomUUID(),
          "credit",
        ])
        return rows[0].r
      })
      const creditId = first.credit_id as string
      const booking = await book(db, f.customerA, a.id)
      expect(await options(db, creditId)).toEqual([
        [a.id, "used", null],
        [b.id, "active", null],
      ])

      const r = await cancelEvent(db, f, a.id)
      expect(r).toMatchObject({ cancelled: 1, choice_count: 1, card_count: 0 })
      const { rows } = await db.query(
        "select status, choice_pending from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(rows[0]).toEqual({ status: "active", choice_pending: true })
      const { rows: credits } = await db.query(
        "select count(*)::int as n from public.cancellation_credits where origin_booking_id = $1",
        [booking]
      )
      expect(credits[0].n).toBe(0)
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "event_cancelled"],
        [b.id, "active", null],
      ])
      const mine = await myCredits(db, f.customerA)
      expect(mine[0]).toMatchObject({ choice_pending: true, options: [] })
      expect(new Date(mine[0].cancelled_starts_at)).toEqual(
        new Date(a.starts_at)
      )

      await choose(db, f.customerA, creditId, "credit")
      expect(await options(db, creditId)).toEqual([
        [a.id, "replaced", "event_cancelled"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])
    })
  })

  it("a credit-funded booking cancelled by the business, then refund: the request points at the cancelled session's booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const p = await pinned(db, f, origin.id)
      const first = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          p.booking,
          randomUUID(),
          "credit",
        ])
        return rows[0].r
      })
      const booking = await book(db, f.customerA, a.id)
      await cancelEvent(db, f, a.id)
      await choose(db, f.customerA, first.credit_id, "refund")
      const { rows } = await db.query(
        "select booking_id, amount_agorot from public.refund_requests where credit_id = $1",
        [first.credit_id]
      )
      expect(rows).toEqual([{ booking_id: booking, amount_agorot: 12800 }])
    })
  })

  it("an option in the cancelled session (another customer's credit): replaced (event_cancelled), the next session on her next view", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const p = await pinned(db, f, origin.id)
      const first = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          p.booking,
          randomUUID(),
          "credit",
        ])
        return rows[0].r
      })
      await cardBooking(db, f, f.customerB, a.id)

      await cancelEvent(db, f, a.id)
      expect(await options(db, first.credit_id)).toEqual([
        [a.id, "replaced", "event_cancelled"],
        [b.id, "active", null],
      ])
      await myCredits(db, f.customerA)
      expect(await options(db, first.credit_id)).toEqual([
        [a.id, "replaced", "event_cancelled"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])
    })
  })

  it("a parked purchase (paid without a place): never blocks; without the second checkbox CONFIRM_REQUIRED, with it cancelled and the purchase unchanged; 'to handle' says the session was cancelled", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, capacity: 1 })
      // The only place is taken; customer B's online purchase is parked.
      await pinned(db, f, ev.id)
      const { rows: pay } = await db.query(
        `select private.approve_payment_core(
           'online', null, 'system', $5, $1, $2, 12800, null, $3::date,
           null, null, null, 'test_provider', $4, 'park') as id`,
        [f.single, ev.id, f.today, testName("tx"), f.customerB]
      )
      const paymentId = pay[0].id as string
      const entitlementOf = async () =>
        (
          await db.query(
            "select id, status, expires_on::text, customer_id from public.entitlements where payment_id = $1",
            [paymentId]
          )
        ).rows[0]
      const before = await entitlementOf()

      const plan = await cancelPlan(db, f, ev.id)
      expect(plan.parked).toEqual([
        {
          customer_id: f.customerB,
          customer_label: testName("money_b"),
          payment_id: paymentId,
        },
      ])

      for (const ack of [false, null]) {
        expect(
          await as(db, f.admin, () =>
            queryError(db, CANCEL_EVENT_PARKED, [
              ev.id,
              true,
              MESSAGE,
              randomUUID(),
              ack,
            ])
          )
        ).toEqual({ code: "P0001", message: "CONFIRM_REQUIRED" })
      }
      const { rows: still } = await db.query(
        "select status from public.events where id = $1",
        [ev.id]
      )
      expect(still[0].status).toBe("published")

      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(CANCEL_EVENT_PARKED, [
          ev.id,
          true,
          MESSAGE,
          randomUUID(),
          true,
        ])
        return rows[0].r
      })
      expect(r).toMatchObject({ cancelled: 1, choice_count: 1 })
      expect(await entitlementOf()).toEqual(before)

      const item = (await attention(db, f)).find(
        (i: { id: string }) => i.id === before.id
      )
      expect(item).toMatchObject({
        kind: "paid_without_place",
        event_status: "cancelled",
        event_id: ev.id,
      })
    })
  })

  it("inside 48h: a business cancel of a pinned booking 30h ahead still gives choice_pending, and she may choose refund", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { inHours: "30 hours" })
      const p = await pinned(db, f, ev.id)
      await cancelEvent(db, f, ev.id)
      const c = await creditOf(db, p.booking)
      expect(c).toMatchObject({ status: "active", choice_pending: true })
      const r = await choose(db, f.customerA, c.id, "refund")
      expect(r).toMatchObject({ outcome: "refund" })
      const { rows } = await db.query(
        "select amount_agorot, booking_id from public.refund_requests where credit_id = $1",
        [c.id]
      )
      expect(rows).toEqual([{ amount_agorot: 12800, booking_id: p.booking }])
    })
  })

  it("the same key twice: the same result, one notification each", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await pinned(db, f, ev.id)
      const key = randomUUID()
      const first = await cancelEvent(db, f, ev.id, { key })
      const second = await cancelEvent(db, f, ev.id, { key })
      expect(second).toEqual(first)
      expect(
        await notificationsOf(db, f.customerA, "event_cancelled")
      ).toHaveLength(1)
    })
  })

  it("a session cancelled before the reminder: no reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { inHours: "72 hours" })
      const p = await pinned(db, f, ev.id)
      await cancelEvent(db, f, ev.id)
      await db.query(
        "update public.events set starts_at = now() + interval '23 hours', ends_at = now() + interval '25 hours', registration_closes_at = now() + interval '23 hours' where id = $1",
        [ev.id]
      )
      await db.query(
        "update public.bookings set confirmed_at = now() - interval '3 days' where id = $1",
        [p.booking]
      )
      await db.query(JOB_REMINDERS)
      expect(await notificationsOf(db, f.customerA, "reminder")).toEqual([])
    })
  })

  it("a customer calling either preview or action: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      const later = new Date(Date.now() + 6 * 86_400_000).toISOString()
      const end = new Date(
        Date.now() + 6 * 86_400_000 + 7_200_000
      ).toISOString()
      for (const [query, params] of [
        [PREVIEW_CANCEL, [ev.id]],
        [CANCEL_EVENT, [ev.id, true, MESSAGE, randomUUID()]],
        [PREVIEW_RESCHEDULE, [ev.id, later, end]],
        [RESCHEDULE, [ev.id, later, end, true, MESSAGE, randomUUID()]],
      ] as const) {
        expect(
          await as(db, f.customerA, () => queryError(db, query, [...params]))
        ).toEqual({ code: "P0001", message: "NOT_AUTHORIZED" })
      }
    })
  })
})

describe("the customer's choice", { timeout: 60_000 }, () => {
  async function pendingCredit(db: Db, f: Fixture) {
    const ev = await insertEvent(db, f, { dayOffset: 5 })
    const next1 = await insertEvent(db, f, { dayOffset: 6 })
    const next2 = await insertEvent(db, f, { dayOffset: 7 })
    const before = await insertEvent(db, f, { dayOffset: 3 })
    const p = await pinned(db, f, ev.id)
    await cancelEvent(db, f, ev.id)
    const c = await creditOf(db, p.booking)
    return { ev, next1, next2, before, p, creditId: c.id as string }
  }

  it("refund: refund_requested with a request of the basis; the attention item is gone", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { p, creditId } = await pendingCredit(db, f)
      const r = await choose(db, f.customerA, creditId, "refund")
      expect(r).toEqual({
        credit_id: creditId,
        outcome: "refund",
        refund_request_id: expect.any(String),
      })
      const { rows } = await db.query(
        "select status, choice_pending from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(rows[0]).toEqual({
        status: "refund_requested",
        choice_pending: false,
      })
      const { rows: refunds } = await db.query(
        "select customer_id, payment_id, booking_id, amount_agorot, status from public.refund_requests where credit_id = $1",
        [creditId]
      )
      expect(refunds).toEqual([
        {
          customer_id: f.customerA,
          payment_id: p.payment,
          booking_id: p.booking,
          amount_agorot: 12800,
          status: "requested",
        },
      ])
      const kinds = (await attention(db, f))
        .filter((i: { id: string }) => i.id === creditId)
        .map((i: { kind: string }) => i.kind)
      expect(kinds).toEqual([])
      const { rows: audit } = await db.query(
        "select entity_type from public.audit_log where action = 'choose_credit_outcome' and customer_id = $1 order by entity_type",
        [f.customerA]
      )
      expect(audit.map((a) => a.entity_type)).toEqual([
        "cancellation_credits",
        "refund_requests",
      ])
    })
  })

  it("credit: the options are counted from the cancelled session (never before it)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { next1, next2, creditId } = await pendingCredit(db, f)
      expect(await choose(db, f.customerA, creditId, "credit")).toEqual({
        credit_id: creditId,
        outcome: "credit",
      })
      expect(await options(db, creditId)).toEqual([
        [next1.id, "active", null],
        [next2.id, "active", null],
      ])
      const mine = await myCredits(db, f.customerA)
      expect(mine[0]).toMatchObject({
        choice_pending: false,
        options: [
          expect.objectContaining({ event_id: next1.id }),
          expect.objectContaining({ event_id: next2.id }),
        ],
      })
    })
  })

  it("choosing twice, or another customer's credit: CHOICE_NOT_PENDING and nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { creditId } = await pendingCredit(db, f)
      expect(
        await as(db, f.customerB, () =>
          queryError(db, CHOOSE, [creditId, "refund", randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "CHOICE_NOT_PENDING" })
      await choose(db, f.customerA, creditId, "credit")
      expect(
        await as(db, f.customerA, () =>
          queryError(db, CHOOSE, [creditId, "refund", randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "CHOICE_NOT_PENDING" })
      const { rows } = await db.query(
        "select status from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(rows[0].status).toBe("active")
      expect(
        await as(db, f.customerA, () =>
          queryError(db, CHOOSE, [creditId, "other", randomUUID()])
        )
      ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
    })
  })

  it("the same key twice: the same result", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { creditId } = await pendingCredit(db, f)
      const key = randomUUID()
      const first = await choose(db, f.customerA, creditId, "refund", key)
      expect(await choose(db, f.customerA, creditId, "refund", key)).toEqual(
        first
      )
    })
  })

  it("an unbound seat cancelled, then bound: the credit moves, one event_cancelled with the template body, the pending card shows", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 6 })
      const p = await pinned(db, f, ev.id, null)
      const r = await cancelEvent(db, f, ev.id)
      expect(r.notified).toBe(0)
      await db.query("select private.bind_purchase($1, $2)", [
        p.payment,
        f.customerB,
      ])
      const c = await creditOf(db, p.booking)
      expect(c).toMatchObject({
        customer_id: f.customerB,
        choice_pending: true,
      })
      expect(await notificationsOf(db, f.customerB, "event_cancelled")).toEqual(
        [
          {
            title: `הבראנץ׳ של ${dayMonth(ev.day)} בוטל`,
            body: "אם נרשמת עם כרטיסייה, הכניסה חזרה אלייך. אם שילמת על המפגש בנפרד, ראי פרטים באזור האישי",
            dedupe_key: `event_cancelled:${f.customerB}:${ev.id}:${await revision(db, ev.id)}`,
            target_path: "/me/bookings",
          },
        ]
      )
      expect(await cancelNotices(db, f.customerB)).toEqual([])
      const mine = await myCredits(db, f.customerB)
      expect(mine).toEqual([
        expect.objectContaining({ credit_id: c.id, choice_pending: true }),
      ])
      expect(
        (await attention(db, f)).filter((i: { id: string }) => i.id === c.id)
      ).toHaveLength(1)
    })
  })
})

describe("change a session's time", { timeout: 60_000 }, () => {
  async function localInstant(db: Db, dayOffset: number, at: string) {
    const { rows } = await db.query(
      `select ((((now() at time zone 'Asia/Jerusalem')::date + $1::int) + $2::time)
         at time zone 'Asia/Jerusalem') as t`,
      [dayOffset, at]
    )
    return (rows[0].t as Date).toISOString()
  }

  it("10 bookings, 10:30 -> 11:00: 10 event_changed with her body (the reminder: session-reminders.test.ts)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 1, at: "10:30" })
      const customers: string[] = []
      for (let i = 0; i < 10; i++) {
        const c = await newCustomer(db, `move_${i}`)
        customers.push(c)
        await pinned(db, f, ev.id, c)
      }
      const start = await localInstant(db, 1, "11:00")
      const end = await localInstant(db, 1, "13:00")

      const plan = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW_RESCHEDULE, [ev.id, start, end])
        return rows[0].r
      })
      expect(plan).toMatchObject({
        ok: true,
        booking_count: 10,
        at_risk: [],
        title: `שינוי בבראנץ׳ של ${dayMonth(ev.day)}`,
        body: `לידיעתך! מועד הבראנץ׳ שונה ל-${dayMonth(ev.day)} בשעה 11:00`,
      })

      const r = await reschedule(db, f, ev.id, start, end, "  זז לאחת עשרה  ")
      expect(r).toMatchObject({
        event_id: ev.id,
        booking_count: 10,
        notified: 10,
      })
      expect(await revision(db, ev.id)).toBe(2)
      for (const c of customers) {
        expect(await notificationsOf(db, c, "event_changed")).toEqual([
          {
            title: `שינוי בבראנץ׳ של ${dayMonth(ev.day)}`,
            body: "זז לאחת עשרה",
            dedupe_key: `event_changed:${c}:${ev.id}:2`,
            target_path: "/me/bookings",
          },
        ])
      }
    })
  })

  it("a new day: the pinned entitlements' expires_on follows; a card not valid on the new day is at risk, never blocks", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 3 })
      const p = await pinned(db, f, ev.id)
      const card = await cardBooking(db, f, f.customerB, ev.id)
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 3
         where id = $1`,
        [card.entitlement]
      )
      const start = await localInstant(db, 5, "10:00")
      const end = await localInstant(db, 5, "12:00")
      const plan = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW_RESCHEDULE, [ev.id, start, end])
        return rows[0].r
      })
      expect(plan.at_risk).toEqual([
        expect.objectContaining({
          customer_id: f.customerB,
          reason: "not_valid_on_new_day",
        }),
      ])
      await reschedule(db, f, ev.id, start, end)
      const { rows } = await db.query(
        `select expires_on::text as d,
           ((now() at time zone 'Asia/Jerusalem')::date + 5)::text as want
         from public.entitlements where id = $1`,
        [p.entitlement]
      )
      expect(rows[0].d).toBe(rows[0].want)
      const { rows: bookings } = await db.query(
        "select status from public.bookings where event_id = $1",
        [ev.id]
      )
      expect(bookings.map((b) => b.status)).toEqual(["confirmed", "confirmed"])
    })
  })

  it("an option moved to before its credit's origin: replaced (moved)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const p = await pinned(db, f, origin.id)
      const first = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          p.booking,
          randomUUID(),
          "credit",
        ])
        return rows[0].r
      })
      // Its close was set by hand at its start; before the new start.
      await db.query(
        "update public.events set registration_closes_at = now() + interval '1 day' where id = $1",
        [a.id]
      )
      await reschedule(
        db,
        f,
        a.id,
        await localInstant(db, 4, "10:00"),
        await localInstant(db, 4, "12:00")
      )
      // Right after the time change (refresh_credits_for_event, no fill).
      expect(await options(db, first.credit_id)).toEqual([
        [a.id, "replaced", "moved"],
        [b.id, "active", null],
      ])
      // Her next view fills the next session.
      await myCredits(db, f.customerA)
      expect(await options(db, first.credit_id)).toEqual([
        [a.id, "replaced", "moved"],
        [b.id, "active", null],
        [c.id, "active", null],
      ])
    })
  })

  it("refusals: nothing changed, a start in the past, an end before the start, no checkbox", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 3 })
      const { rows } = await db.query(
        "select starts_at, ends_at from public.events where id = $1",
        [ev.id]
      )
      const same = [rows[0].starts_at, rows[0].ends_at]
      const past = [
        new Date(Date.now() - 3_600_000).toISOString(),
        new Date(Date.now() + 3_600_000).toISOString(),
      ]
      const inverted = [rows[0].ends_at, rows[0].starts_at]
      for (const [s, e] of [same, past, inverted]) {
        expect(
          await as(db, f.admin, () =>
            queryError(db, RESCHEDULE, [
              ev.id,
              s,
              e,
              true,
              MESSAGE,
              randomUUID(),
            ])
          )
        ).toEqual({ code: "P0001", message: "INVALID_INPUT" })
      }
      const start = await localInstant(db, 4, "10:00")
      const end = await localInstant(db, 4, "12:00")
      expect(
        await as(db, f.admin, () =>
          queryError(db, RESCHEDULE, [
            ev.id,
            start,
            end,
            false,
            MESSAGE,
            randomUUID(),
          ])
        )
      ).toEqual({ code: "P0001", message: "CONFIRM_REQUIRED" })
      expect(await revision(db, ev.id)).toBe(1)

      // A close Tal set by hand that is after an earlier new start.
      const earlyStart = await localInstant(db, 2, "10:00")
      const earlyEnd = await localInstant(db, 2, "12:00")
      const plan = await as(db, f.admin, async () => {
        const { rows: r } = await db.query(PREVIEW_RESCHEDULE, [
          ev.id,
          earlyStart,
          earlyEnd,
        ])
        return r[0].r
      })
      expect(plan).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        field: "registration_closes_local",
      })
    })
  })

  it("the action's local literal ('YYYY-MM-DD HH:MM:00 Asia/Jerusalem') reaches Postgres as the correct instant, summer and winter", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 3 })
      const { rows: y } = await db.query(
        "select extract(year from now())::int + 1 as y"
      )
      const year = y[0].y as number
      for (const [day, utcStart] of [
        // Summer (UTC+3) and winter (UTC+2) in Jerusalem.
        [`${year}-07-15`, `${year}-07-15T08:00:00.000Z`],
        [`${year}-01-15`, `${year}-01-15T09:00:00.000Z`],
      ]) {
        const plan = await as(db, f.admin, async () => {
          const { rows } = await db.query(PREVIEW_RESCHEDULE, [
            ev.id,
            `${day} 11:00:00 Asia/Jerusalem`,
            `${day} 13:00:00 Asia/Jerusalem`,
          ])
          return rows[0].r
        })
        expect(plan.ok).toBe(true)
        expect(new Date(plan.new_starts_at).toISOString()).toBe(utcStart)
      }
    })
  })
})
