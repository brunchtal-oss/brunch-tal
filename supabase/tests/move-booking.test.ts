// Story 3.10: moving a booking. move_booking, admin_move_booking, their
// previews, private.plan_move and the move path through private.cancel_core
// and private.book_core. One test per row of the spec's I/O matrix, plus the
// previews, a later cancel of a moved pinned booking, the reminder of the
// new booking, the edited booking_moved template in a real move, a customer
// on the admin RPCs, and (last, with real commits) a move against a
// parallel admin_cancel_booking. Everything else runs in inRollback, with
// the settings set inside the transaction and every other published session
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
const MOVE = "select public.move_booking($1, $2, $3) as r"
const ADMIN_MOVE = "select public.admin_move_booking($1, $2, $3, $4, $5) as r"
const PREVIEW = "select public.preview_move_booking($1) as r"
const ADMIN_PREVIEW = "select public.preview_admin_move_booking($1) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const ADMIN_CANCEL = "select public.admin_cancel_booking($1, $2, $3) as r"
const MY_BOOKINGS = "select public.get_my_bookings() as r"
const MINE = "select public.get_my_entitlements() as r"
const OPEN_CARDS = "select public.admin_list_open_cards('all') as r"
const TEMPLATE =
  "select public.admin_update_notification_template($1, $2, $3, $4, $5) as r"
const JOB = "select private.job_reminders() as n"

type Fixture = MoneyFixture & {
  anyDayCard: string
  single: string
  couple: string
  mothers: string
  mothersName: string
  grandma: string
}

// As the owner: a product of every weekday. A pinned one is validity_mode
// session (one entry).
async function insertProduct(
  db: Db,
  label: string,
  type: "card" | "single" | "couple"
): Promise<string> {
  const pinned = type !== "card"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, intro_only)
     values ($1, $2, $3, $4, $5, $6, null, $7, $8, false)
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
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query<{
    id: string
    theme_key: string
    name: string
  }>(
    "select id, theme_key, name from public.concepts where archived_at is null"
  )
  const concepts = Object.fromEntries(rows.map((c) => [c.theme_key, c]))
  return {
    ...f,
    anyDayCard: await insertProduct(db, "any_day_card", "card"),
    single: await insertProduct(db, "single", "single"),
    couple: await insertProduct(db, "couple", "couple"),
    mothers: concepts.mothers.id,
    mothersName: concepts.mothers.name,
    grandma: concepts.grandma.id,
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
    kind?: "regular" | "couple"
  }
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $5, s.t, s.t + interval '2 hours', $2, s.t, true, 'published'
     from (
       select case
         when $3::interval is not null then now() + $3::interval
         else (((now() at time zone 'Asia/Jerusalem')::date + $4::int)
               + time '10:00') at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id`,
    [
      options.kind === "couple" ? f.grandma : f.mothers,
      options.capacity ?? 12,
      options.inHours ?? null,
      options.dayOffset ?? null,
      options.kind ?? "regular",
    ]
  )
  return rows[0].id
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// As the admin: approves a product (a pinned one with its session). Returns
// the entitlement and, for a pinned one, its booking.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<{ entitlement: string; booking: string | null; payment: string }> {
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
  return {
    entitlement: rows[0].id,
    booking: (r.booking_id as string | undefined) ?? null,
    payment: r.payment_id as string,
  }
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    expect(rows[0].r).toHaveProperty("booking_id")
    return rows[0].r.booking_id as string
  })
}

async function move(
  db: Db,
  customer: string,
  bookingId: string,
  target: string,
  key = randomUUID()
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(MOVE, [bookingId, target, key])
    return rows[0].r as { booking_id: string; from_booking_id: string }
  })
}

async function moveError(
  db: Db,
  customer: string,
  bookingId: string,
  target: string
) {
  return as(db, customer, () =>
    queryError(db, MOVE, [bookingId, target, randomUUID()])
  )
}

async function adminMove(
  db: Db,
  f: Fixture,
  bookingId: string,
  target: string,
  reason: string | null = null
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(ADMIN_MOVE, [
      bookingId,
      target,
      true,
      randomUUID(),
      reason,
    ])
    return rows[0].r as { booking_id: string; from_booking_id: string }
  })
}

async function adminMoveError(
  db: Db,
  f: Fixture,
  bookingId: string,
  target: string
) {
  return as(db, f.admin, () =>
    queryError(db, ADMIN_MOVE, [bookingId, target, true, randomUUID(), null])
  )
}

async function bookingRow(db: Db, id: string) {
  const { rows } = await db.query(
    `select status, event_id, party_size, guest_details, policy_snapshot,
       moved_to_booking_id, customer_id
     from public.bookings where id = $1`,
    [id]
  )
  return rows[0]
}

async function allocations(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `select entitlement_id, credit_id, units from public.booking_allocations
     where booking_id = $1 order by id`,
    [bookingId]
  )
  return rows
}

async function available(db: Db, entitlementId: string): Promise<number> {
  const { rows } = await db.query(
    "select available from public.entitlement_balances where entitlement_id = $1",
    [entitlementId]
  )
  return rows[0].available
}

async function notificationsOf(db: Db, customer: string) {
  const { rows } = await db.query(
    `select type, dedupe_key, target_path, payload ->> 'title' as title,
       payload ->> 'body' as body
     from public.notifications where recipient_id = $1
     order by created_at, id`,
    [customer]
  )
  return rows
}

async function creditOf(db: Db, originBookingId: string) {
  const { rows } = await db.query(
    "select id, status, choice_pending from public.cancellation_credits where origin_booking_id = $1",
    [originBookingId]
  )
  return rows[0]
}

// Every option of the credit by session: [event_id, state].
async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select o.event_id, o.state from public.credit_options o
     join public.events e on e.id = o.event_id
     where o.credit_id = $1 order by e.starts_at, e.id`,
    [creditId]
  )
  return rows.map((r) => [r.event_id, r.state])
}

// Everything a move could touch for this customer, to compare before and
// after a refused move (byte-identical).
async function state(db: Db, customer: string) {
  const { rows } = await db.query(
    `select jsonb_build_object(
       'bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]')
         from public.bookings b where b.customer_id = $1),
       'allocations', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]')
         from public.booking_allocations a
         join public.bookings b on b.id = a.booking_id where b.customer_id = $1),
       'movements', (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]')
         from public.entitlement_movements m
         join public.entitlements e on e.id = m.entitlement_id where e.customer_id = $1),
       'credits', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]')
         from public.cancellation_credits c where c.customer_id = $1),
       'options', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]')
         from public.credit_options o
         join public.cancellation_credits c on c.id = o.credit_id where c.customer_id = $1),
       'refunds', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]')
         from public.refund_requests r where r.customer_id = $1),
       'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]')
         from public.notifications n where n.recipient_id = $1)
     ) as s`,
    [customer]
  )
  return rows[0].s
}

// The same numbers in get_my_entitlements and admin_list_open_cards.
async function balancesAgree(db: Db, f: Fixture, entitlementId: string) {
  const mine = await as(db, f.customerA, async () =>
    (await db.query(MINE)).rows[0].r.find(
      (e: { entitlement_id: string }) => e.entitlement_id === entitlementId
    )
  )
  const open = await as(db, f.admin, async () =>
    (await db.query(OPEN_CARDS)).rows[0].r.find(
      (e: { entitlement_id: string }) => e.entitlement_id === entitlementId
    )
  )
  const pick = (r: Record<string, unknown>) => ({
    available: r.available,
    reserved: r.reserved,
    used: r.used,
    expires_on: r.expires_on,
  })
  expect(pick(open)).toEqual(pick(mine))
  return pick(mine)
}

async function cardCount(db: Db, customer: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.entitlements where customer_id = $1",
    [customer]
  )
  return rows[0].n
}

function dayMonth(rows: { d: string }[]): string {
  return rows[0].d
}

async function localDayMonth(db: Db, eventId: string): Promise<string> {
  const { rows } = await db.query(
    "select to_char(starts_at at time zone 'Asia/Jerusalem', 'DD.MM') as d from public.events where id = $1",
    [eventId]
  )
  return dayMonth(rows)
}

async function localTime(db: Db, eventId: string): Promise<string> {
  const { rows } = await db.query(
    "select to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as d from public.events where id = $1",
    [eventId]
  )
  return dayMonth(rows)
}

describe("move_booking: a card", { timeout: 60_000 }, () => {
  it("card move: A cancelled with moved_to_booking_id, B confirmed on the same card, balance unchanged, one booking_moved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      await book(db, f.customerA, await insertEvent(db, f, { dayOffset: 7 }))
      const original = await book(db, f.customerA, a)
      expect(await available(db, entitlement)).toBe(2)
      const before = await balancesAgree(db, f, entitlement)
      const cards = await cardCount(db, f.customerA)

      const r = await move(db, f.customerA, original, b)
      expect(r.from_booking_id).toBe(original)
      const from = await bookingRow(db, original)
      const to = await bookingRow(db, r.booking_id)
      expect(from).toMatchObject({
        status: "cancelled",
        moved_to_booking_id: r.booking_id,
      })
      expect(to).toMatchObject({ status: "confirmed", event_id: b })
      expect(to.policy_snapshot).toEqual(from.policy_snapshot)
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: entitlement, credit_id: null, units: 1 },
      ])
      expect(await available(db, entitlement)).toBe(2)
      expect(await balancesAgree(db, f, entitlement)).toEqual(before)
      expect(await cardCount(db, f.customerA)).toBe(cards)

      // The move sends booking_moved only: no cancel and no new confirmation
      // (the two confirmations are of the two bookings made above).
      const sent = await notificationsOf(db, f.customerA)
      expect(
        sent.filter((n) => n.type.startsWith("booking_cancelled"))
      ).toEqual([])
      expect(sent.filter((n) => n.type === "booking_confirmed")).toHaveLength(2)
      expect(sent.filter((n) => n.type === "booking_moved")).toEqual([
        {
          type: "booking_moved",
          dedupe_key: `booking_moved:${f.customerA}:${r.booking_id}`,
          target_path: `/me/sessions/${b}`,
          title: "ההרשמה הועברה",
          body: `מ-${await localDayMonth(db, a)} ל-${await localDayMonth(db, b)} · ${await localTime(db, b)} · בראנץ׳ ${f.mothersName}`,
        },
      ])

      // Audit: cancel_core's and book_core's rows carry the action, and one
      // more row for the original (before/after moved_to_booking_id).
      const { rows: audit } = await db.query(
        `select entity_id, count(*)::int as n,
           bool_and(before <> '{}'::jsonb) as has_before,
           bool_and(actor_kind = 'customer') as by_customer
         from public.audit_log
         where action = 'move_booking' and entity_type = 'bookings'
           and entity_id = any($1::uuid[])
         group by entity_id`,
        [[original, r.booking_id]]
      )
      expect(
        Object.fromEntries(audit.map((row) => [row.entity_id, row]))
      ).toEqual({
        [original]: {
          entity_id: original,
          n: 2,
          has_before: true,
          by_customer: true,
        },
        // book_core's insert, then the audited copy of the snapshot.
        [r.booking_id]: {
          entity_id: r.booking_id,
          n: 2,
          has_before: false,
          by_customer: true,
        },
      })

      // Her history: the moved booking with the session it went to.
      const mine = await as(
        db,
        f.customerA,
        async () => (await db.query(MY_BOOKINGS)).rows[0].r
      )
      const past = mine.past.find(
        (p: { booking_id: string }) => p.booking_id === original
      )
      const { rows: bStart } = await db.query(
        "select starts_at from public.events where id = $1",
        [b]
      )
      expect(new Date(past.moved_to_starts_at).getTime()).toBe(
        new Date(bStart[0].starts_at).getTime()
      )
    })
  })

  it("target full: EVENT_FULL, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      await grant(db, f, f.anyDayCard, { customerId: f.customerB })
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6, capacity: 1 })
      await book(db, f.customerB, b)
      const original = await book(db, f.customerA, a)
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, original, b)).toEqual({
        code: "P0001",
        message: "EVENT_FULL",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("card outside validity: ENTITLEMENT_EXPIRED_ON_DATE, nothing changes; not in the preview", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const inside = await insertEvent(db, f, { dayOffset: 6 })
      const late = await insertEvent(db, f, { dayOffset: 60 })
      const original = await book(db, f.customerA, a)

      const preview = await as(
        db,
        f.customerA,
        async () => (await db.query(PREVIEW, [original])).rows[0].r
      )
      expect(preview).toMatchObject({
        ok: true,
        funding: "card",
        can_move: true,
      })
      expect(
        preview.targets.map((t: { event_id: string }) => t.event_id)
      ).toEqual([inside])

      const before = await state(db, f.customerA)
      expect(await moveError(db, f.customerA, original, late)).toEqual({
        code: "P0001",
        message: "ENTITLEMENT_EXPIRED_ON_DATE",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("inside 48h: SELF_CANCEL_CLOSED for her, nothing changes; Tal moves it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { inHours: "24 hours" })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, original, b)).toEqual({
        code: "P0001",
        message: "SELF_CANCEL_CLOSED",
      })
      expect(await state(db, f.customerA)).toEqual(before)

      const plan = await as(
        db,
        f.admin,
        async () => (await db.query(ADMIN_PREVIEW, [original])).rows[0].r
      )
      expect(plan).toMatchObject({
        ok: true,
        within_window: true,
        customer_name: testName("money_a"),
      })
      const r = await adminMove(db, f, original, b, " ביקשה בטלפון ")
      expect((await bookingRow(db, r.booking_id)).status).toBe("confirmed")
      const { rows: audit } = await db.query(
        "select reason from public.audit_log where action = 'admin_move_booking' and entity_id = $1",
        [original]
      )
      expect(audit.every((row) => row.reason === "ביקשה בטלפון")).toBe(true)
      expect(audit.length).toBeGreaterThan(0)
    })
  })

  it("same session: MOVE_TARGET_NOT_ALLOWED; already booked there: ALREADY_BOOKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      await book(db, f.customerA, b)
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, original, a)).toEqual({
        code: "P0001",
        message: "MOVE_TARGET_NOT_ALLOWED",
      })
      expect(await moveError(db, f.customerA, original, b)).toEqual({
        code: "P0001",
        message: "ALREADY_BOOKED",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("repeat key: the previous result, one move and one booking_moved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      const key = randomUUID()

      const first = await move(db, f.customerA, original, b, key)
      const second = await move(db, f.customerA, original, b, key)
      expect(second).toEqual(first)
      const moved = (await notificationsOf(db, f.customerA)).filter(
        (n) => n.type === "booking_moved"
      )
      expect(moved).toHaveLength(1)
      const { rows } = await db.query(
        "select count(*)::int as n from public.bookings where event_id = $1 and customer_id = $2",
        [b, f.customerA]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("another customer's booking: BOOKING_NOT_MOVABLE; a customer on the admin RPCs: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)

      expect(await moveError(db, f.customerB, original, b)).toEqual({
        code: "P0001",
        message: "BOOKING_NOT_MOVABLE",
      })
      expect(
        await as(db, f.customerA, () =>
          queryError(db, ADMIN_PREVIEW, [original])
        )
      ).toEqual({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(
        await as(db, f.customerA, () =>
          queryError(db, ADMIN_MOVE, [original, b, true, randomUUID(), null])
        )
      ).toEqual({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(
        await as(db, f.customerA, async () =>
          queryError(db, ADMIN_MOVE, [original, b, false, randomUUID(), null])
        )
      ).toEqual({ code: "P0001", message: "NOT_AUTHORIZED" })
      // Tal without the confirmation: CONFIRM_REQUIRED, nothing changes.
      const before = await state(db, f.customerA)
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_MOVE, [original, b, false, randomUUID(), null])
        )
      ).toEqual({ code: "P0001", message: "CONFIRM_REQUIRED" })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })
})

describe("move_booking: pinned and credit-funded", { timeout: 60_000 }, () => {
  it("pinned, customer: to one of the first N after A; A cancelled, credit active, B funded by it, option used, no refund", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const c = await insertEvent(db, f, { dayOffset: 7 })
      await insertEvent(db, f, { dayOffset: 8 })
      const p = await grant(db, f, f.single, { eventId: a })
      const original = p.booking!

      const preview = await as(
        db,
        f.customerA,
        async () => (await db.query(PREVIEW, [original])).rows[0].r
      )
      expect(preview).toMatchObject({ ok: true, funding: "pinned" })
      expect(
        preview.targets.map((t: { event_id: string }) => t.event_id)
      ).toEqual([b, c])

      const r = await move(db, f.customerA, original, c)
      const credit = await creditOf(db, original)
      expect(credit).toMatchObject({ status: "active", choice_pending: false })
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: null, credit_id: credit.id, units: 1 },
      ])
      expect(await options(db, credit.id)).toEqual([
        [b, "active"],
        [c, "used"],
      ])
      const { rows: refunds } = await db.query(
        "select count(*)::int as n from public.refund_requests where customer_id = $1",
        [f.customerA]
      )
      expect(refunds[0].n).toBe(0)
      const types = (await notificationsOf(db, f.customerA)).map((n) => n.type)
      expect(types.filter((t) => t.startsWith("booking_cancelled"))).toEqual([])
      expect(types.filter((t) => t === "booking_moved")).toHaveLength(1)

      // A later cancel returns the same credit, never money.
      const cancelled = await as(
        db,
        f.customerA,
        async () =>
          (await db.query(CANCEL, [r.booking_id, randomUUID()])).rows[0].r
      )
      expect(cancelled).toMatchObject({
        outcome: "credit",
        credit_id: credit.id,
      })
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.refund_requests where customer_id = $1",
        [f.customerA]
      )
      expect(after[0].n).toBe(0)
      expect((await creditOf(db, original)).status).toBe("active")
    })
  })

  it("pinned, not an option: MOVE_TARGET_NOT_ALLOWED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const d = await insertEvent(db, f, { dayOffset: 8 })
      const p = await grant(db, f, f.single, { eventId: a })
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, p.booking!, d)).toEqual({
        code: "P0001",
        message: "MOVE_TARGET_NOT_ALLOWED",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("pinned, Tal: to a session outside the options; the option is added and used", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const c = await insertEvent(db, f, { dayOffset: 7 })
      const d = await insertEvent(db, f, { dayOffset: 8 })
      const p = await grant(db, f, f.single, { eventId: a })

      const plan = await as(
        db,
        f.admin,
        async () => (await db.query(ADMIN_PREVIEW, [p.booking])).rows[0].r
      )
      expect(
        plan.targets.map(
          (t: { event_id: string; outside_options: boolean }) => [
            t.event_id,
            t.outside_options,
          ]
        )
      ).toEqual([
        [b, false],
        [c, false],
        [d, true],
      ])

      const r = await adminMove(db, f, p.booking!, d)
      const credit = await creditOf(db, p.booking!)
      expect(credit.status).toBe("active")
      expect(await options(db, credit.id)).toEqual([
        [b, "active"],
        [c, "active"],
        [d, "used"],
      ])
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: null, credit_id: credit.id, units: 1 },
      ])
      // Scoped to this credit: the dev DB keeps real moves from phone checks.
      const { rows: audit } = await db.query(
        `select count(*)::int as n from public.audit_log
         where action = 'admin_move_booking' and entity_type = 'credit_options'
           and entity_id in (select o.id from public.credit_options o where o.credit_id = $1)`,
        [credit.id]
      )
      expect(audit[0].n).toBe(1)
    })
  })

  it("credit-funded: moves on the same credit to another of its options", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const c = await insertEvent(db, f, { dayOffset: 7 })
      const p = await grant(db, f, f.single, { eventId: a })
      await as(db, f.customerA, () =>
        db.query("select public.cancel_booking($1, $2, 'credit')", [
          p.booking,
          randomUUID(),
        ])
      )
      const credit = await creditOf(db, p.booking!)
      const onB = await book(db, f.customerA, b)
      expect(await allocations(db, onB)).toEqual([
        { entitlement_id: null, credit_id: credit.id, units: 1 },
      ])

      const r = await move(db, f.customerA, onB, c)
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: null, credit_id: credit.id, units: 1 },
      ])
      expect(await options(db, credit.id)).toEqual([
        [b, "active"],
        [c, "used"],
      ])
    })
  })

  it("couple: a target with one place is full; with two places party_size 2 and guest_details are copied", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5, kind: "couple" })
      const small = await insertEvent(db, f, {
        dayOffset: 6,
        kind: "couple",
        capacity: 1,
      })
      const roomy = await insertEvent(db, f, {
        dayOffset: 7,
        kind: "couple",
        capacity: 2,
      })
      const p = await grant(db, f, f.couple, { eventId: a })
      await db.query(
        "update public.bookings set guest_details = $2 where id = $1",
        [p.booking, "צמחונית"]
      )
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, p.booking!, small)).toEqual({
        code: "P0001",
        message: "EVENT_FULL",
      })
      expect(await state(db, f.customerA)).toEqual(before)

      const r = await move(db, f.customerA, p.booking!, roomy)
      expect(await bookingRow(db, r.booking_id)).toMatchObject({
        status: "confirmed",
        party_size: 2,
        guest_details: "צמחונית",
      })
    })
  })

  it("not movable: a booking without a customer (BOOKING_NOT_MOVABLE); an offset couple (MANUAL_HANDLING_REQUIRED)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const held = await grant(db, f, f.single, {
        eventId: a,
        customerId: null,
      })
      expect(await adminMoveError(db, f, held.booking!, b)).toEqual({
        code: "P0001",
        message: "BOOKING_NOT_MOVABLE",
      })

      // A couple booking funded from a card and another kind (by hand).
      const coupleA = await insertEvent(db, f, { dayOffset: 5, kind: "couple" })
      const coupleB = await insertEvent(db, f, { dayOffset: 6, kind: "couple" })
      const card = await grant(db, f, f.anyDayCard)
      const single = await grant(db, f, f.single, { eventId: b })
      const { rows } = await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 2, 'admin',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)
         returning id`,
        [f.customerA, coupleA]
      )
      await db.query(
        `insert into public.booking_allocations (booking_id, entitlement_id, units)
         values ($1, $2, 1), ($1, $3, 1)`,
        [rows[0].id, card.entitlement, single.entitlement]
      )
      expect(await adminMoveError(db, f, rows[0].id, coupleB)).toEqual({
        code: "P0001",
        message: "MANUAL_HANDLING_REQUIRED",
      })
    })
  })
})

describe(
  "move_booking: the reminder and the template",
  { timeout: 60_000 },
  () => {
    it("the reminder goes to the new booking's session, not the old one", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const a = await insertEvent(db, f, { dayOffset: 5 })
        const b = await insertEvent(db, f, { dayOffset: 6 })
        const original = await book(db, f.customerA, a)
        const r = await move(db, f.customerA, original, b)
        // Both sessions now inside the lead; the new booking confirmed days ago.
        for (const id of [a, b]) {
          await db.query(
            `update public.events
           set registration_closes_at = now() + interval '22 hours',
               starts_at = now() + interval '23 hours',
               ends_at = now() + interval '25 hours'
           where id = $1`,
            [id]
          )
        }
        await db.query(
          "update public.bookings set confirmed_at = now() - interval '3 days' where id = any($1::uuid[])",
          [[original, r.booking_id]]
        )
        await db.query(JOB)
        const { rows } = await db.query(
          `select dedupe_key, target_path from public.notifications
         where recipient_id = $1 and type = 'reminder'`,
          [f.customerA]
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].dedupe_key).toContain(r.booking_id)
        expect(rows[0].dedupe_key).not.toContain(original)
      })
    })

    it("a move into the lead window sends no reminder (booking_moved carries the date and time)", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await grant(db, f, f.anyDayCard)
        const a = await insertEvent(db, f, { dayOffset: 5 })
        const b = await insertEvent(db, f, { inHours: "23 hours" })
        const original = await book(db, f.customerA, a)
        await move(db, f.customerA, original, b)
        await db.query(JOB)
        const types = (await notificationsOf(db, f.customerA)).map(
          (n) => n.type
        )
        expect(types).not.toContain("reminder")
        expect(types).toContain("booking_moved")
      })
    })

    it("the edited booking_moved template renders all four fields in a real move", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const { rows } = await db.query(
          "select version, allowed_vars from public.notification_templates where type = 'booking_moved'"
        )
        expect(rows[0].allowed_vars).toEqual([
          "from_date",
          "date",
          "time",
          "concept",
        ])
        await as(db, f.admin, () =>
          db.query(TEMPLATE, [
            "booking_moved",
            "T {from_date}|{date}|{time}|{concept}",
            "B {concept}|{time}|{date}|{from_date}",
            rows[0].version,
            randomUUID(),
          ])
        )
        await grant(db, f, f.anyDayCard)
        const a = await insertEvent(db, f, { dayOffset: 5 })
        const b = await insertEvent(db, f, { dayOffset: 6 })
        const original = await book(db, f.customerA, a)
        await move(db, f.customerA, original, b)

        const from = await localDayMonth(db, a)
        const date = await localDayMonth(db, b)
        const time = await localTime(db, b)
        const moved = (await notificationsOf(db, f.customerA)).filter(
          (n) => n.type === "booking_moved"
        )
        expect(moved).toMatchObject([
          {
            title: `T ${from}|${date}|${time}|${f.mothersName}`,
            body: `B ${f.mothersName}|${time}|${date}|${from}`,
          },
        ])
      })
    })
  }
)

// As the customer: her pinned single on `origin` cancelled into a credit,
// then booked on `on` with that credit. Returns the credit and the booking.
async function creditFunded(db: Db, f: Fixture, origin: string, on: string) {
  const p = await grant(db, f, f.single, { eventId: origin })
  await as(db, f.customerA, () =>
    db.query("select public.cancel_booking($1, $2, 'credit')", [
      p.booking,
      randomUUID(),
    ])
  )
  const credit = await creditOf(db, p.booking!)
  const booking = await book(db, f.customerA, on)
  expect(await allocations(db, booking)).toEqual([
    { entitlement_id: null, credit_id: credit.id, units: 1 },
  ])
  return { creditId: credit.id as string, booking, origin: p.booking! }
}

async function previewTargets(
  db: Db,
  user: string,
  sqlText: string,
  id: string
) {
  const plan = await as(
    db,
    user,
    async () => (await db.query(sqlText, [id])).rows[0].r
  )
  return plan.targets as { event_id: string; outside_options: boolean }[]
}

// As the owner: the option of `eventId` was replaced (full) before she used
// the credit.
async function replaceOption(db: Db, creditId: string, eventId: string) {
  await db.query(
    `update public.credit_options
     set state = 'replaced', replaced_at = now(), replaced_reason = 'full'
     where credit_id = $1 and event_id = $2`,
    [creditId, eventId]
  )
}

describe("move_booking: review cases", { timeout: 60_000 }, () => {
  it("a card of one weekday: another weekday is NO_MATCHING_ENTITLEMENT, nothing changes, and it is not in the preview", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows: product } = await db.query(
        `insert into public.products (
           name, type, price_agorot, units, validity_mode, validity_days,
           allowed_weekdays, eligible_event_kind, party_size)
         values ($1, 'card', 47200, 4, 'days', 49,
           array[extract(dow from (now() at time zone 'Asia/Jerusalem')::date + 5)::smallint],
           'regular', 1)
         returning id`,
        [testName("one_day_card")]
      )
      await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: product[0].id,
          eventId: null,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const otherDay = await insertEvent(db, f, { dayOffset: 6 })
      const sameDay = await insertEvent(db, f, { dayOffset: 12 })
      const original = await book(db, f.customerA, a)

      const targets = await previewTargets(db, f.customerA, PREVIEW, original)
      expect(targets.map((t) => t.event_id)).toEqual([sameDay])

      const before = await state(db, f.customerA)
      expect(await moveError(db, f.customerA, original, otherDay)).toEqual({
        code: "P0001",
        message: "NO_MATCHING_ENTITLEMENT",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("registration closed, not started: not in her preview and REGISTRATION_CLOSED; Tal lists it and moves there", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const closed = await insertEvent(db, f, { dayOffset: 6 })
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [closed]
      )
      const original = await book(db, f.customerA, a)

      expect(
        (await previewTargets(db, f.customerA, PREVIEW, original)).map(
          (t) => t.event_id
        )
      ).toEqual([])
      expect(await moveError(db, f.customerA, original, closed)).toEqual({
        code: "P0001",
        message: "REGISTRATION_CLOSED",
      })

      expect(
        (await previewTargets(db, f.admin, ADMIN_PREVIEW, original)).map(
          (t) => t.event_id
        )
      ).toEqual([closed])
      const r = await adminMove(db, f, original, closed)
      expect(await bookingRow(db, r.booking_id)).toMatchObject({
        status: "confirmed",
        event_id: closed,
      })
    })
  })

  it("the original session ended: EVENT_ENDED for Tal, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      await db.query(
        `update public.events
         set registration_closes_at = now() - interval '4 hours',
             starts_at = now() - interval '3 hours',
             ends_at = now() - interval '1 hour'
         where id = $1`,
        [a]
      )
      const before = await state(db, f.customerA)
      expect(await adminMoveError(db, f, original, b)).toEqual({
        code: "P0001",
        message: "EVENT_ENDED",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("credit-funded, customer to a session that is not an option: MOVE_TARGET_NOT_ALLOWED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const d = await insertEvent(db, f, { dayOffset: 8 })
      const { booking } = await creditFunded(db, f, a, b)
      const before = await state(db, f.customerA)

      expect(await moveError(db, f.customerA, booking, d)).toEqual({
        code: "P0001",
        message: "MOVE_TARGET_NOT_ALLOWED",
      })
      expect(await state(db, f.customerA)).toEqual(before)
    })
  })

  it("credit-funded, Tal to a replaced option: active and used, audited from the replaced row; after a cancel it stays active (decision z)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const x = await insertEvent(db, f, { dayOffset: 7 })
      const { creditId, booking } = await creditFunded(db, f, a, b)
      await replaceOption(db, creditId, x)

      const r = await adminMove(db, f, booking, x)
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: null, credit_id: creditId, units: 1 },
      ])
      expect(await options(db, creditId)).toEqual([
        [b, "active"],
        [x, "used"],
      ])
      const { rows: audit } = await db.query(
        `select before ->> 'state' as before_state, after ->> 'state' as after_state
         from public.audit_log
         where action = 'admin_move_booking' and entity_type = 'credit_options'
           and customer_id = $1`,
        [f.customerA]
      )
      expect(audit).toEqual([
        { before_state: "replaced", after_state: "active" },
      ])

      await as(db, f.customerA, () =>
        db.query(CANCEL, [r.booking_id, randomUUID()])
      )
      expect(await options(db, creditId)).toEqual([
        [b, "active"],
        [x, "active"],
      ])
    })
  })

  it("credit-funded with one option replaced: the preview lists the next session (rule 2) and she moves to it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const c = await insertEvent(db, f, { dayOffset: 7 })
      const d = await insertEvent(db, f, { dayOffset: 8 })
      const { creditId, booking } = await creditFunded(db, f, a, b)
      await replaceOption(db, creditId, c)

      const targets = (
        await previewTargets(db, f.customerA, PREVIEW, booking)
      ).map((t) => t.event_id)
      expect(targets).toContain(d)
      expect(targets).not.toContain(c)

      const r = await move(db, f.customerA, booking, d)
      expect(await bookingRow(db, r.booking_id)).toMatchObject({
        status: "confirmed",
        event_id: d,
      })
      expect(await options(db, creditId)).toEqual([
        [b, "active"],
        [c, "replaced"],
        [d, "used"],
      ])
    })
  })

  it("credit-funded, customer moves back to the credit's origin session (decision h)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      await insertEvent(db, f, { dayOffset: 7 })
      const { creditId, booking } = await creditFunded(db, f, a, b)

      const targets = await previewTargets(db, f.customerA, PREVIEW, booking)
      expect(targets.map((t) => t.event_id)).toContain(a)
      const admin = await previewTargets(db, f.admin, ADMIN_PREVIEW, booking)
      expect(admin.find((t) => t.event_id === a)).toMatchObject({
        outside_options: false,
      })

      const r = await move(db, f.customerA, booking, a)
      expect(await bookingRow(db, r.booking_id)).toMatchObject({
        status: "confirmed",
        event_id: a,
      })
      expect(await allocations(db, r.booking_id)).toEqual([
        { entitlement_id: null, credit_id: creditId, units: 1 },
      ])
      expect((await options(db, creditId)).map(([e]) => e)).not.toContain(a)
    })
  })

  it("admin_move_booking with the same key twice: the previous result, one move", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      const key = randomUUID()
      const run = () =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(ADMIN_MOVE, [
            original,
            b,
            true,
            key,
            null,
          ])
          return rows[0].r
        })

      const first = await run()
      expect(await run()).toEqual(first)
      const { rows } = await db.query(
        "select count(*)::int as n from public.bookings where event_id = $1 and customer_id = $2",
        [b, f.customerA]
      )
      expect(rows[0].n).toBe(1)
      const moved = (await notificationsOf(db, f.customerA)).filter(
        (n) => n.type === "booking_moved"
      )
      expect(moved).toHaveLength(1)
    })
  })

  it("the new booking's copied policy_snapshot is audited (an update row)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.anyDayCard)
      const a = await insertEvent(db, f, { dayOffset: 5 })
      const b = await insertEvent(db, f, { dayOffset: 6 })
      const original = await book(db, f.customerA, a)
      // The settings changed after her booking: book_core snapshots 72, the
      // move copies her 48 back.
      await db.query(
        "update public.business_settings set cancel_window_hours = 72"
      )
      const r = await move(db, f.customerA, original, b)

      expect(
        (await bookingRow(db, r.booking_id)).policy_snapshot
      ).toMatchObject({ cancel_window_hours: 48 })
      const { rows } = await db.query(
        `select before -> 'policy_snapshot' as before,
           after -> 'policy_snapshot' as after
         from public.audit_log
         where action = 'move_booking' and entity_type = 'bookings'
           and entity_id = $1 and before <> '{}'::jsonb`,
        [r.booking_id]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].before).toMatchObject({ cancel_window_hours: 72 })
      expect(rows[0].after).toMatchObject({ cancel_window_hours: 48 })
    })
  })
})

// ---------------------------------------------------------------------------
// A move against a parallel admin_cancel_booking (commits)
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

describe("a move against a parallel cancel", { timeout: 60_000 }, () => {
  it("Tal's cancel waits on the customer's lock while she moves; after the commit it is refused, no deadlock", async () => {
    const customer = randomUUID()
    const admin = randomUUID()
    const product = randomUUID()
    const method = randomUUID()
    const eventA = randomUUID()
    const eventB = randomUUID()
    const events = [eventA, eventB]

    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        await client.query(
          "delete from public.notification_jobs where notification_id in (select id from public.notifications where recipient_id = $1)",
          [customer]
        )
        await client.query(
          "delete from public.notifications where recipient_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.audit_log where customer_id = $1 or event_id = any($2::uuid[])",
          [customer, events]
        )
        await client.query(
          "delete from private.idempotency_results where actor_scope = any($1::text[])",
          [[customer, admin]]
        )
        await client.query(
          "update public.bookings set moved_to_booking_id = null where customer_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.booking_allocations where booking_id in (select id from public.bookings where customer_id = $1)",
          [customer]
        )
        await client.query(
          "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          "delete from public.entitlement_movements where entitlement_id in (select id from public.entitlements where customer_id = $1)",
          [customer]
        )
        await client.query(
          "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          "delete from public.bookings where customer_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.entitlements where customer_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.payments where customer_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.events where id = any($1::uuid[])",
          [events]
        )
        await client.query("delete from public.products where id = $1", [
          product,
        ])
        await client.query("delete from public.payment_methods where id = $1", [
          method,
        ])
        await client.query("delete from public.profiles where id = $1", [
          customer,
        ])
        await client.query(
          "delete from public.admin_roles where user_id = $1",
          [admin]
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })

    await sql("insert into public.admin_roles (user_id) values ($1)", [admin])
    await sql(
      "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
      [customer, testName("move_race")]
    )
    await sql(
      `insert into public.products (
         id, name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
      [product, testName("move_race_card")]
    )
    await sql(
      "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 907)",
      [method, testName("move_race_method")]
    )
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
    for (const [id, days] of [
      [eventA, 5],
      [eventB, 6],
    ] as const) {
      await sql(
        `insert into public.events (
           id, concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, registration_close_overridden, status)
         select $1, c.id, 'regular',
           ((now() at time zone 'Asia/Jerusalem')::date + $2::int + time '10:00') at time zone 'Asia/Jerusalem',
           ((now() at time zone 'Asia/Jerusalem')::date + $2::int + time '12:00') at time zone 'Asia/Jerusalem',
           12,
           ((now() at time zone 'Asia/Jerusalem')::date + $2::int + time '10:00') at time zone 'Asia/Jerusalem',
           true, 'published'
         from public.concepts c
         where c.theme_key = 'mothers'
         limit 1`,
        [id, days]
      )
    }

    const setup = await getPool().connect()
    let original: string
    try {
      await setup.query("begin")
      await asAuthenticated(setup, customer)
      const { rows } = await setup.query(BOOK, [eventA, randomUUID()])
      original = rows[0].r.booking_id
      await setup.query("commit")
    } finally {
      setup.release()
    }

    const a = await getPool().connect()
    const b = await getPool().connect()
    let second: Promise<unknown> | undefined
    let released = false
    try {
      await a.query("begin")
      await asAuthenticated(a, customer)
      await a.query(MOVE, [original, eventB, randomUUID()])

      await b.query("begin")
      await asAuthenticated(b, admin)
      const { rows: pid } = await b.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      )
      second = b.query(ADMIN_CANCEL, [original, true, randomUUID()])
      second.catch(() => {})

      await a.query("reset role")
      expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
      await a.query("commit")
      released = true

      await expect(second).rejects.toMatchObject({
        message: "BOOKING_NOT_CANCELLABLE",
      })
      await b.query("rollback")
    } finally {
      if (!released) await a.query("rollback").catch(() => {})
      await second?.catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }

    const bookings = await sql<{ event_id: string; status: string }>(
      "select event_id, status from public.bookings where customer_id = $1 order by created_at",
      [customer]
    )
    expect(bookings).toEqual([
      { event_id: eventA, status: "cancelled" },
      { event_id: eventB, status: "confirmed" },
    ])
  })
})
