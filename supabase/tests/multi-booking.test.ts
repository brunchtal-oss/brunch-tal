// Story 3.3: multi-date booking and registration close. book_sessions,
// preview_book_sessions and the close of book_session against the server
// clock. One test per row of the spec's I/O matrix (waiting on a lock past
// the close and the last place with book_sessions are in
// booking-concurrency.test.ts). Everything runs in inRollback, with the
// settings set inside the transaction.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, queryError, type Db } from "./support/db"
import { seedMoney, type MoneyFixture } from "./support/money"

const BOOK_MANY = "select public.book_sessions($1::uuid[], $2) as r"
const PREVIEW_MANY = "select public.preview_book_sessions($1::uuid[]) as r"
const BOOK = "select public.book_session($1, $2) as r"
const PREVIEW = "select public.preview_book_session($1) as r"

type Fixture = MoneyFixture & { concepts: Record<string, string> }

type Result = {
  event_id: string
  ok: boolean
  code?: string
  booking_id?: string
}

// As the owner: the money fixture and the settings this story reads.
async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         last_places_threshold = 4, registration_close_days_before = 1,
         registration_close_local_time = '20:00'`
  )
  const { rows } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  return {
    ...f,
    concepts: Object.fromEntries(rows.map((c) => [c.theme_key, c.id])),
  }
}

// The local date today + `from` days.
async function localDay(db: Db, from: number): Promise<string> {
  const { rows } = await db.query(
    "select ((now() at time zone 'Asia/Jerusalem')::date + $1::int)::text as d",
    [from]
  )
  return rows[0].d
}

// A session 10:00-12:00 Jerusalem time, as the owner. closed: the close was
// set by hand a minute ago; computed: the trigger computes the close from
// the settings (AD-8).
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    day: string
    capacity?: number
    status?: string
    closed?: boolean
    computed?: boolean
  }
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     values (
       $1, 'regular',
       ($2::date + time '10:00') at time zone 'Asia/Jerusalem',
       ($2::date + time '12:00') at time zone 'Asia/Jerusalem',
       $3,
       case when $4::boolean then now() - interval '1 minute'
            else ($2::date + time '10:00') at time zone 'Asia/Jerusalem' end,
       not $5::boolean, $6)
     returning id`,
    [
      f.concepts.mothers,
      options.day,
      options.capacity ?? 12,
      options.closed ?? false,
      options.computed ?? false,
      options.status ?? "published",
    ]
  )
  return rows[0].id
}

// As the owner: a card for `customer` with its payment and grant, valid
// from today for `days` days, for any weekday.
async function insertCard(
  db: Db,
  f: Fixture,
  options: { customer: string; units?: number; days?: number; name?: string }
): Promise<string> {
  const { rows: payments } = await db.query(
    `insert into public.payments (
       customer_id, product_id, source, recorded_by, payment_method_id,
       amount_agorot, paid_on, product_snapshot)
     values ($1, $2, 'manual', $3, $4, 47200, $5::date,
       jsonb_build_object('name', $6::text))
     returning id`,
    [
      options.customer,
      f.card,
      f.admin,
      f.method,
      f.today,
      options.name ?? "multi_card",
    ]
  )
  const { rows } = await db.query(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       eligibility_snapshot, allowed_weekdays, eligible_event_kind)
     values ($1, $2, 'card', $3, $4::date, $4::date + $5::int,
       '{"validity_mode": "days"}'::jsonb, null, 'regular')
     returning id`,
    [
      options.customer,
      payments[0].id,
      options.units ?? 4,
      f.today,
      options.days ?? 49,
    ]
  )
  await db.query(
    `insert into public.entitlement_movements (entitlement_id, action, units)
     values ($1, 'grant', $2)`,
    [rows[0].id, options.units ?? 4]
  )
  return rows[0].id
}

// Places taken by bookings without a customer (AD-23), as the owner.
async function fill(db: Db, eventId: string, places: number): Promise<void> {
  const { rows } = await db.query(
    "select id from public.payments order by created_at limit 1"
  )
  await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     select $1, $2, 1, 'admin',
       '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb
     from generate_series(1, $3::int)`,
    [rows[0].id, eventId, places]
  )
}

async function as<T>(
  db: Db,
  userId: string,
  text: string,
  params: unknown[]
): Promise<T> {
  await asAuthenticated(db, userId)
  try {
    const { rows } = await db.query(text, params)
    return rows[0].r as T
  } finally {
    await db.query("reset role")
  }
}

async function errorAs(
  db: Db,
  userId: string,
  text: string,
  params: unknown[]
) {
  await asAuthenticated(db, userId)
  try {
    return await queryError(db, text, params)
  } finally {
    await db.query("reset role")
  }
}

async function balance(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    "select available, reserved from public.entitlement_balances where entitlement_id = $1",
    [entitlementId]
  )
  return rows[0]
}

async function reservesOf(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    `select booking_id from public.entitlement_movements
     where entitlement_id = $1 and action = 'reserve'
     order by booking_id`,
    [entitlementId]
  )
  return rows.map((row) => row.booking_id as string)
}

async function bookingsOf(db: Db, customerId: string) {
  const { rows } = await db.query(
    "select id, event_id from public.bookings where customer_id = $1 order by id",
    [customerId]
  )
  return rows
}

describe("booking several dates with a card", () => {
  it("a card with 4, three dates, the second full: two booked, EVENT_FULL for the second, 2 available and 2 reserved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertCard(db, f, { customer: f.customerB })
      const first = await insertEvent(db, f, { day: await localDay(db, 3) })
      const second = await insertEvent(db, f, {
        day: await localDay(db, 5),
        capacity: 3,
      })
      const third = await insertEvent(db, f, { day: await localDay(db, 7) })
      await fill(db, second, 3)

      // Sent in another order: the result follows the session dates.
      const { results } = await as<{ results: Result[] }>(
        db,
        f.customerB,
        BOOK_MANY,
        [[third, second, first], randomUUID()]
      )
      expect(results).toEqual([
        { event_id: first, ok: true, booking_id: expect.any(String) },
        { event_id: second, ok: false, code: "EVENT_FULL" },
        { event_id: third, ok: true, booking_id: expect.any(String) },
      ])

      const booked = [results[0].booking_id, results[2].booking_id].sort()
      expect(await reservesOf(db, card)).toEqual(booked)
      expect(await balance(db, card)).toEqual({ available: 2, reserved: 2 })
      expect(
        (await bookingsOf(db, f.customerB)).map((b) => b.event_id).sort()
      ).toEqual([first, third].sort())

      const { rows: audit } = await db.query(
        `select action, actor_kind from public.audit_log
         where entity_id = any($1::uuid[])`,
        [booked]
      )
      expect(audit).toEqual([
        { action: "book_sessions", actor_kind: "customer" },
        { action: "book_sessions", actor_kind: "customer" },
      ])

      // One booking_confirmed per saved date, each to its own session.
      const { rows: notifications } = await db.query(
        `select target_path from public.notifications
         where recipient_id = $1 and type = 'booking_confirmed'
         order by target_path`,
        [f.customerB]
      )
      expect(notifications.map((n) => n.target_path)).toEqual(
        [`/me/sessions/${first}`, `/me/sessions/${third}`].sort()
      )
    })
  })

  it("a card with 2, three dates: the two earliest booked, NO_MATCHING_ENTITLEMENT for the third, 0 available", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertCard(db, f, { customer: f.customerB, units: 2 })
      const a = await insertEvent(db, f, { day: await localDay(db, 3) })
      const b = await insertEvent(db, f, { day: await localDay(db, 4) })
      const c = await insertEvent(db, f, { day: await localDay(db, 5) })

      const { results } = await as<{ results: Result[] }>(
        db,
        f.customerB,
        BOOK_MANY,
        [[c, b, a], randomUUID()]
      )
      expect(results).toEqual([
        { event_id: a, ok: true, booking_id: expect.any(String) },
        { event_id: b, ok: true, booking_id: expect.any(String) },
        { event_id: c, ok: false, code: "NO_MATCHING_ENTITLEMENT" },
      ])
      expect(await balance(db, card)).toEqual({ available: 0, reserved: 2 })
    })
  })

  it("closed, already booked, after expires_on, draft and a missing id: each its code, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertCard(db, f, { customer: f.customerB })
      const closed = await insertEvent(db, f, {
        day: await localDay(db, 3),
        closed: true,
      })
      const booked = await insertEvent(db, f, { day: await localDay(db, 4) })
      // The card ends 49 days from today.
      const late = await insertEvent(db, f, { day: await localDay(db, 52) })
      const draft = await insertEvent(db, f, {
        day: await localDay(db, 5),
        status: "draft",
      })
      const missing = randomUUID()
      await as(db, f.customerB, BOOK, [booked, randomUUID()])
      const before = await bookingsOf(db, f.customerB)

      const { results } = await as<{ results: Result[] }>(
        db,
        f.customerB,
        BOOK_MANY,
        [[missing, late, draft, booked, closed], randomUUID()]
      )
      expect(results).toEqual([
        { event_id: closed, ok: false, code: "REGISTRATION_CLOSED" },
        { event_id: booked, ok: false, code: "ALREADY_BOOKED" },
        { event_id: draft, ok: false, code: "EVENT_NOT_BOOKABLE" },
        { event_id: late, ok: false, code: "ENTITLEMENT_EXPIRED_ON_DATE" },
        { event_id: missing, ok: false, code: "EVENT_NOT_BOOKABLE" },
      ])
      expect(await bookingsOf(db, f.customerB)).toEqual(before)
      expect(await balance(db, card)).toEqual({ available: 3, reserved: 1 })
    })
  })

  it("two cards with different validity: each date is funded by expires_on, then id", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const later = await insertCard(db, f, { customer: f.customerB, days: 45 })
      const earlier = await insertCard(db, f, {
        customer: f.customerB,
        units: 1,
        days: 30,
      })
      const first = await insertEvent(db, f, { day: await localDay(db, 3) })
      const second = await insertEvent(db, f, { day: await localDay(db, 4) })

      const { results } = await as<{ results: Result[] }>(
        db,
        f.customerB,
        BOOK_MANY,
        [[first, second], randomUUID()]
      )
      expect(results.map((r) => r.ok)).toEqual([true, true])

      const { rows } = await db.query(
        `select b.event_id, a.entitlement_id
         from public.booking_allocations a
         join public.bookings b on b.id = a.booking_id
         where b.customer_id = $1`,
        [f.customerB]
      )
      const byEvent = Object.fromEntries(
        rows.map((row) => [row.event_id, row.entitlement_id])
      )
      expect(byEvent).toEqual({ [first]: earlier, [second]: later })
    })
  })
})

describe("idempotency and input", () => {
  it("the same key returns the same result, with no further booking or movement, also when every date failed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertCard(db, f, { customer: f.customerB })
      const open = await insertEvent(db, f, { day: await localDay(db, 3) })
      const closed = await insertEvent(db, f, {
        day: await localDay(db, 4),
        closed: true,
      })

      const key = randomUUID()
      const first = await as(db, f.customerB, BOOK_MANY, [[open, closed], key])
      // The ids in another order are the same request.
      const again = await as(db, f.customerB, BOOK_MANY, [[closed, open], key])
      expect(again).toEqual(first)
      expect(await reservesOf(db, card)).toHaveLength(1)
      expect(await bookingsOf(db, f.customerB)).toHaveLength(1)

      const failedKey = randomUUID()
      const failed = await as(db, f.customerB, BOOK_MANY, [[closed], failedKey])
      expect(failed).toEqual({
        results: [{ event_id: closed, ok: false, code: "REGISTRATION_CLOSED" }],
      })
      // Opened again by hand: the stored result still answers the key.
      await db.query(
        "update public.events set registration_closes_at = starts_at where id = $1",
        [closed]
      )
      expect(
        await as(db, f.customerB, BOOK_MANY, [[closed], failedKey])
      ).toEqual(failed)
      expect(await bookingsOf(db, f.customerB)).toHaveLength(1)
    })
  })

  it("an empty list, a null, a duplicate or 21 ids -> INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertCard(db, f, { customer: f.customerB })
      const id = randomUUID()
      for (const items of [
        [],
        [null],
        [id, null],
        [id, id],
        Array.from({ length: 21 }, () => randomUUID()),
      ]) {
        expect(
          await errorAs(db, f.customerB, BOOK_MANY, [items, randomUUID()]),
          JSON.stringify(items)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      expect(
        await errorAs(db, f.customerB, PREVIEW_MANY, [[id, null]])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
    })
  })
})

describe("registration close by the server clock", () => {
  it("a preview that showed the session open does not allow booking after the close", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertCard(db, f, { customer: f.customerB })
      const one = await insertEvent(db, f, { day: await localDay(db, 3) })
      const many = await insertEvent(db, f, { day: await localDay(db, 4) })

      expect(await as(db, f.customerB, PREVIEW, [one])).toMatchObject({
        ok: true,
      })
      const preview = await as<{ results: Result[] }>(
        db,
        f.customerB,
        PREVIEW_MANY,
        [[one, many]]
      )
      expect(preview.results.map((r) => r.ok)).toEqual([true, true])

      await db.query(
        `update public.events
         set registration_closes_at = now(), registration_close_overridden = true
         where id = any($1::uuid[])`,
        [[one, many]]
      )

      expect(
        await errorAs(db, f.customerB, BOOK, [one, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "REGISTRATION_CLOSED" })
      expect(
        await as(db, f.customerB, BOOK_MANY, [[many], randomUUID()])
      ).toEqual({
        results: [{ event_id: many, ok: false, code: "REGISTRATION_CLOSED" }],
      })
      expect(await reservesOf(db, card)).toEqual([])
    })
  })

  it("daylight saving: sessions on 26.10.2026 and 28.03.2027 at 10:00 close at 18:00Z on 25.10 and 17:00Z on 27.03, and are open until then", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Valid long enough for both dates (any weekday).
      const card = await insertCard(db, f, {
        customer: f.customerB,
        days: 400,
      })
      const winter = await insertEvent(db, f, {
        day: "2026-10-26",
        computed: true,
      })
      const summer = await insertEvent(db, f, {
        day: "2027-03-28",
        computed: true,
      })

      const { rows } = await db.query(
        `select id,
           to_char(registration_closes_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as closes
         from public.events where id = any($1::uuid[])`,
        [[winter, summer]]
      )
      expect(Object.fromEntries(rows.map((r) => [r.id, r.closes]))).toEqual({
        [winter]: "2026-10-25T18:00Z",
        [summer]: "2027-03-27T17:00Z",
      })

      // Open while the close is still after the server clock; once these
      // dates pass, REGISTRATION_CLOSED (the test stays valid over time).
      const { rows: open } = await db.query<{ id: string; open: boolean }>(
        `select id, registration_closes_at > now() as open
         from public.events where id = any($1::uuid[])`,
        [[winter, summer]]
      )
      const isOpen = Object.fromEntries(open.map((r) => [r.id, r.open]))
      const expected = (id: string) =>
        isOpen[id]
          ? { event_id: id, ok: true }
          : { event_id: id, ok: false, code: "REGISTRATION_CLOSED" }

      const preview = await as<{ results: Result[] }>(
        db,
        f.customerB,
        PREVIEW_MANY,
        [[winter, summer]]
      )
      expect(preview.results).toMatchObject([
        expected(winter),
        expected(summer),
      ])
      const { results } = await as<{ results: Result[] }>(
        db,
        f.customerB,
        BOOK_MANY,
        [[summer, winter], randomUUID()]
      )
      expect(results).toMatchObject([expected(winter), expected(summer)])
      const booked = [winter, summer].filter((id) => isOpen[id]).length
      expect(await balance(db, card)).toEqual({
        available: 4 - booked,
        reserved: booked,
      })
    })
  })
})

describe("permissions", () => {
  it("anon gets 42501 on both new RPCs", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const [query, params] of [
        [BOOK_MANY, [[randomUUID()], randomUUID()]],
        [PREVIEW_MANY, [[randomUUID()]]],
      ] as const) {
        expect((await queryError(db, query, [...params]))?.code, query).toBe(
          "42501"
        )
      }
    })
  })

  it("an admin or a user without an active profile -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { day: await localDay(db, 3) })
      for (const user of [f.admin, randomUUID()]) {
        expect(
          await errorAs(db, user, BOOK_MANY, [[eventId], randomUUID()])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        expect(
          await errorAs(db, user, PREVIEW_MANY, [[eventId]])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      }
    })
  })
})

describe("preview_book_sessions", () => {
  it("eligible and ineligible dates: ok or the code for each, the available entries, nothing written", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertCard(db, f, { customer: f.customerB, units: 3, name: "A" })
      // Ends first, so it funds every date.
      await insertCard(db, f, {
        customer: f.customerB,
        units: 2,
        days: 45,
        name: "B",
      })
      // Expired and pinned entitlements are not counted.
      const expired = await insertCard(db, f, {
        customer: f.customerB,
        units: 5,
      })
      await db.query(
        "update public.entitlements set valid_from = valid_from - 60, expires_on = expires_on - 50 where id = $1",
        [expired]
      )
      const pinnedEvent = await insertEvent(db, f, {
        day: await localDay(db, 6),
      })
      const pinned = await insertCard(db, f, {
        customer: f.customerB,
        units: 1,
      })
      await db.query(
        `update public.entitlements
         set pinned_event_id = $2,
             eligibility_snapshot = '{"validity_mode": "session"}'::jsonb
         where id = $1`,
        [pinned, pinnedEvent]
      )

      const open = await insertEvent(db, f, { day: await localDay(db, 3) })
      const full = await insertEvent(db, f, {
        day: await localDay(db, 4),
        capacity: 1,
      })
      const closed = await insertEvent(db, f, {
        day: await localDay(db, 5),
        closed: true,
      })
      const booked = await insertEvent(db, f, { day: await localDay(db, 7) })
      await fill(db, full, 1)
      await as(db, f.customerB, BOOK, [booked, randomUUID()])
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.entitlement_movements"
      )

      const preview = await as<{
        available: number
        results: Array<Record<string, unknown>>
      }>(db, f.customerB, PREVIEW_MANY, [[booked, closed, full, open]])

      // 3 + 2, less the entry reserved for `booked`.
      expect(preview.available).toBe(4)
      expect(preview.results).toEqual([
        {
          event_id: open,
          ok: true,
          product_name: "B",
          cancel_deadline: expect.any(String),
        },
        {
          event_id: full,
          ok: false,
          code: "EVENT_FULL",
          cancel_deadline: expect.any(String),
        },
        {
          event_id: closed,
          ok: false,
          code: "REGISTRATION_CLOSED",
          cancel_deadline: expect.any(String),
        },
        {
          event_id: booked,
          ok: false,
          code: "ALREADY_BOOKED",
          cancel_deadline: expect.any(String),
        },
      ])
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.entitlement_movements"
      )
      expect(after).toEqual(before)
    })
  })
})
