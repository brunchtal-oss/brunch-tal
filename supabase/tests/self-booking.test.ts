// Story 3.2: self-booking with a card. book_session, preview_book_session,
// get_event_availability, private.plan_funding and private.occupied_places.
// One test per row of the spec's I/O matrix (the last place under
// concurrency is in booking-concurrency.test.ts, the admin edit in
// events-admin.test.ts, the bind in bind-purchase.test.ts). Everything runs
// in inRollback, with the settings set inside the transaction.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { formatDayMonth } from "@/lib/time"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const BOOK = "select public.book_session($1, $2) as r"
const PREVIEW = "select public.preview_book_session($1) as r"
const AVAILABILITY = "select public.get_event_availability($1::uuid[]) as r"

type Fixture = MoneyFixture & {
  concepts: Record<string, string>
  payment: string
  entitlement: string
  expiresOn: string
}

// As the owner: the money fixture, the settings this story reads, and a card
// (4 entries, Monday and Thursday, 49 days from today) approved for
// customer A.
async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         last_places_threshold = 4, registration_close_days_before = 1,
         registration_close_local_time = '20:00'`
  )
  const { rows: concepts } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    customerId: f.customerA,
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
  })
  await db.query("reset role")
  const { rows } = await db.query(
    "select id, expires_on::text as expires_on from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return {
    ...f,
    concepts: Object.fromEntries(concepts.map((c) => [c.theme_key, c.id])),
    payment: r.payment_id as string,
    entitlement: rows[0].id,
    expiresOn: rows[0].expires_on,
  }
}

// The first local date from today + `from` days whose weekday is `dow`
// (0 = Sunday).
async function localDay(db: Db, dow: number, from: number): Promise<string> {
  const { rows } = await db.query(
    `select d::date::text as d
     from generate_series(
       (now() at time zone 'Asia/Jerusalem')::date + $2::int,
       (now() at time zone 'Asia/Jerusalem')::date + $2::int + 6,
       interval '1 day'
     ) d
     where extract(dow from d) = $1
     limit 1`,
    [dow, from]
  )
  return rows[0].d
}

// A session 10:00-12:00 Jerusalem time, as the owner. closed: the close was
// set by hand a minute ago.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    day: string
    kind?: "regular" | "couple"
    capacity?: number
    status?: string
    closed?: boolean
  }
): Promise<string> {
  const kind = options.kind ?? "regular"
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     values (
       $1, $2,
       ($3::date + time '10:00') at time zone 'Asia/Jerusalem',
       ($3::date + time '12:00') at time zone 'Asia/Jerusalem',
       $4,
       case when $5::boolean then now() - interval '1 minute'
            else ($3::date + time '10:00') at time zone 'Asia/Jerusalem' end,
       $5::boolean, $6)
     returning id`,
    [
      kind === "couple" ? f.concepts.grandma : f.concepts.mothers,
      kind,
      options.day,
      options.capacity ?? 12,
      options.closed ?? false,
      options.status ?? "published",
    ]
  )
  return rows[0].id
}

// Places taken by bookings without a customer (a pinned purchase that is not
// bound yet, AD-23), as the owner.
async function fill(
  db: Db,
  f: Fixture,
  eventId: string,
  places: number
): Promise<void> {
  await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     select $1, $2, 1, 'admin',
       '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb
     from generate_series(1, $3::int)`,
    [f.payment, eventId, places]
  )
}

// Runs one query as `userId`, then returns to the owner role.
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

async function bookingsOf(db: Db, eventId: string) {
  const { rows } = await db.query(
    "select * from public.bookings where event_id = $1 order by id",
    [eventId]
  )
  return rows
}

async function movementsOf(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    `select action, units, booking_id from public.entitlement_movements
     where entitlement_id = $1
     -- One transaction gives grant and reserve the same created_at: a stable
     -- tiebreak by action ('grant' < 'reserve'), not by the random id.
     order by created_at, action, id`,
    [entitlementId]
  )
  return rows
}

describe("booking a session with a card", () => {
  it("a card with 4, a Monday in its validity: one booking, reserve -1, 3 available and 1 reserved, an audit row and one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const day = await localDay(db, 1, 2)
      const eventId = await insertEvent(db, f, { day })

      const preview = await as<Record<string, unknown>>(
        db,
        f.customerA,
        PREVIEW,
        [eventId]
      )
      expect(preview).toMatchObject({
        ok: true,
        booked: false,
        product_name: expect.stringContaining("card"),
        units: 1,
        available_after: 3,
        expires_on: f.expiresOn,
      })
      const { rows: deadline } = await db.query(
        "select $1::timestamptz = starts_at - interval '48 hours' as ok from public.events where id = $2",
        [preview.cancel_deadline, eventId]
      )
      expect(deadline[0].ok).toBe(true)

      const r = await as<{ booking_id: string }>(db, f.customerA, BOOK, [
        eventId,
        randomUUID(),
      ])
      expect(r).toEqual({ booking_id: expect.any(String) })

      const bookings = await bookingsOf(db, eventId)
      expect(bookings).toHaveLength(1)
      expect(bookings[0]).toMatchObject({
        id: r.booking_id,
        customer_id: f.customerA,
        payment_id: null,
        party_size: 1,
        status: "confirmed",
        booked_by: "customer",
        cancelled_at: null,
        policy_snapshot: { cancel_window_hours: 48, reminder_lead_hours: 24 },
      })

      const { rows: allocations } = await db.query(
        "select entitlement_id, credit_id, units from public.booking_allocations where booking_id = $1",
        [r.booking_id]
      )
      expect(allocations).toEqual([
        { entitlement_id: f.entitlement, credit_id: null, units: 1 },
      ])
      expect(await movementsOf(db, f.entitlement)).toEqual([
        { action: "grant", units: 4, booking_id: null },
        { action: "reserve", units: -1, booking_id: r.booking_id },
      ])
      expect(await balance(db, f.entitlement)).toEqual({
        available: 3,
        reserved: 1,
      })

      const { rows: audit } = await db.query(
        `select actor_id, actor_kind, action, entity_type, customer_id, event_id
         from public.audit_log where entity_id = $1`,
        [r.booking_id]
      )
      expect(audit).toEqual([
        {
          actor_id: f.customerA,
          actor_kind: "customer",
          action: "book_session",
          entity_type: "bookings",
          customer_id: f.customerA,
          event_id: eventId,
        },
      ])

      const { rows: concept } = await db.query(
        "select name from public.concepts where id = $1",
        [f.concepts.mothers]
      )
      const { rows: notifications } = await db.query(
        `select id, payload, target_path, dedupe_key from public.notifications
         where recipient_id = $1 and type = 'booking_confirmed'`,
        [f.customerA]
      )
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        target_path: `/me/sessions/${eventId}`,
        dedupe_key: `booking_confirmed:${f.customerA}:${r.booking_id}`,
      })
      expect(notifications[0].payload.body).toBe(
        `${formatDayMonth(day)} · 10:00 · בראנץ׳ ${concept[0].name}`
      )
      // booking_confirmed has no push.
      const { rows: jobs } = await db.query(
        "select 1 from public.notification_jobs where notification_id = $1",
        [notifications[0].id]
      )
      expect(jobs).toEqual([])

      // The sheet now shows the booking with its own deadline.
      expect(
        await as<Record<string, unknown>>(db, f.customerA, PREVIEW, [eventId])
      ).toMatchObject({
        ok: false,
        code: "ALREADY_BOOKED",
        booked: true,
        can_self_cancel: true,
      })
    })
  })
})

describe("refusals keep no place and take no entry", () => {
  it("a session after expires_on -> ENTITLEMENT_EXPIRED_ON_DATE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // The card ends 49 days from today; a Monday from day 50 on.
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 50),
      })

      expect(
        await errorAs(db, f.customerA, BOOK, [eventId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "ENTITLEMENT_EXPIRED_ON_DATE" })
      expect(
        await as<Record<string, unknown>>(db, f.customerA, PREVIEW, [eventId])
      ).toMatchObject({ ok: false, code: "ENTITLEMENT_EXPIRED_ON_DATE" })
      expect(await bookingsOf(db, eventId)).toEqual([])
      expect(await movementsOf(db, f.entitlement)).toHaveLength(1)
    })
  })

  it("a Sunday, a couple session, or no entitlement -> NO_MATCHING_ENTITLEMENT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const sunday = await insertEvent(db, f, { day: await localDay(db, 0, 2) })
      const couple = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
        kind: "couple",
        capacity: 14,
      })
      const monday = await insertEvent(db, f, { day: await localDay(db, 1, 2) })

      for (const [customer, eventId] of [
        [f.customerA, sunday],
        [f.customerA, couple],
        [f.customerB, monday],
      ]) {
        expect(
          await errorAs(db, customer, BOOK, [eventId, randomUUID()]),
          eventId
        ).toMatchObject({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
        expect(await bookingsOf(db, eventId)).toEqual([])
      }
      expect(await movementsOf(db, f.entitlement)).toHaveLength(1)
    })
  })

  it("a second booking for the same session with another key -> ALREADY_BOOKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      await as(db, f.customerA, BOOK, [eventId, randomUUID()])

      expect(
        await errorAs(db, f.customerA, BOOK, [eventId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "ALREADY_BOOKED" })
      expect(await bookingsOf(db, eventId)).toHaveLength(1)
      expect(await balance(db, f.entitlement)).toEqual({
        available: 3,
        reserved: 1,
      })
    })
  })

  it("closed or draft -> REGISTRATION_CLOSED / EVENT_NOT_BOOKABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const day = await localDay(db, 1, 2)
      const closed = await insertEvent(db, f, { day, closed: true })
      const draft = await insertEvent(db, f, { day, status: "draft" })

      expect(
        await errorAs(db, f.customerA, BOOK, [closed, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "REGISTRATION_CLOSED" })
      expect(
        await errorAs(db, f.customerA, BOOK, [draft, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_BOOKABLE" })
      expect(
        await errorAs(db, f.customerA, BOOK, [randomUUID(), randomUUID()])
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_BOOKABLE" })
      expect(
        await as<Record<string, unknown>>(db, f.customerA, PREVIEW, [closed])
      ).toMatchObject({ ok: false, code: "REGISTRATION_CLOSED", booked: false })
      expect(
        await as<Record<string, unknown>>(db, f.customerA, PREVIEW, [draft])
      ).toEqual({ ok: false, code: "EVENT_NOT_BOOKABLE", booked: false })
      expect(await movementsOf(db, f.entitlement)).toHaveLength(1)
    })
  })

  it("every place taken (bookings without a customer count) -> EVENT_FULL", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
        capacity: 3,
      })
      await fill(db, f, eventId, 3)

      expect(
        await errorAs(db, f.customerA, BOOK, [eventId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
      expect(await balance(db, f.entitlement)).toEqual({
        available: 4,
        reserved: 0,
      })
    })
  })
})

// As the owner: an entitlement for `customer` with its payment and grant,
// valid from today for `days` days, for any weekday. pinnedTo: a pinned
// entitlement (validity_mode session) for that session.
async function insertEntitlement(
  db: Db,
  f: Fixture,
  options: {
    customer: string
    kind?: string
    eligibleKind?: "regular" | "couple"
    units?: number
    days?: number
    pinnedTo?: string
  }
): Promise<{ id: string; expiresOn: string }> {
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
      `funding_${options.kind ?? "card"}`,
    ]
  )
  const { rows } = await db.query(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       pinned_event_id, eligibility_snapshot, allowed_weekdays,
       eligible_event_kind)
     values ($1, $2, $3, $4, $5::date, $5::date + $6::int, $7,
       jsonb_build_object('validity_mode', $8::text), null, $9)
     returning id, expires_on::text as expires_on`,
    [
      options.customer,
      payments[0].id,
      options.kind ?? "card",
      options.units ?? 4,
      f.today,
      options.days ?? 49,
      options.pinnedTo ?? null,
      options.pinnedTo ? "session" : "days",
      options.eligibleKind ?? "regular",
    ]
  )
  await db.query(
    `insert into public.entitlement_movements (entitlement_id, action, units)
     values ($1, 'grant', $2)`,
    [rows[0].id, options.units ?? 4]
  )
  return { id: rows[0].id, expiresOn: rows[0].expires_on }
}

describe("funding rules (plan_funding)", () => {
  it("a card never funds a couple session in self mode, even one for couple sessions (CAP-11)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertEntitlement(db, f, {
        customer: f.customerB,
        eligibleKind: "couple",
      })
      const couple = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
        kind: "couple",
        capacity: 14,
      })

      expect(
        await errorAs(db, f.customerB, BOOK, [couple, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
      expect(
        await as<Record<string, unknown>>(db, f.customerB, PREVIEW, [couple])
      ).toMatchObject({ ok: false, code: "NO_MATCHING_ENTITLEMENT" })
      expect(await movementsOf(db, card.id)).toHaveLength(1)
    })
  })

  it("a pinned entitlement is never chosen in self mode, for its own session or another", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const day = await localDay(db, 1, 2)
      const pinnedEvent = await insertEvent(db, f, { day })
      const other = await insertEvent(db, f, { day })
      const pinned = await insertEntitlement(db, f, {
        customer: f.customerB,
        kind: "single",
        units: 1,
        pinnedTo: pinnedEvent,
      })

      for (const eventId of [pinnedEvent, other]) {
        expect(
          await errorAs(db, f.customerB, BOOK, [eventId, randomUUID()]),
          eventId
        ).toMatchObject({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
        expect(await bookingsOf(db, eventId)).toEqual([])
      }
      expect(await movementsOf(db, pinned.id)).toHaveLength(1)
    })
  })

  it("of two matching entitlements, the one that ends first is used", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const later = await insertEntitlement(db, f, {
        customer: f.customerB,
        days: 45,
      })
      const earlier = await insertEntitlement(db, f, {
        customer: f.customerB,
        days: 30,
      })
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })

      expect(
        await as<Record<string, unknown>>(db, f.customerB, PREVIEW, [eventId])
      ).toMatchObject({ ok: true, expires_on: earlier.expiresOn })
      await as(db, f.customerB, BOOK, [eventId, randomUUID()])

      expect(await balance(db, earlier.id)).toEqual({
        available: 3,
        reserved: 1,
      })
      expect(await balance(db, later.id)).toEqual({
        available: 4,
        reserved: 0,
      })
    })
  })
})

describe("the booking's own cancel window (AD-15, AD-20)", () => {
  it("a later settings change does not move the deadline of a booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      await as(db, f.customerA, BOOK, [eventId, randomUUID()])
      await db.query(
        "update public.business_settings set cancel_window_hours = 24"
      )

      const preview = await as<Record<string, unknown>>(
        db,
        f.customerA,
        PREVIEW,
        [eventId]
      )
      expect(preview).toMatchObject({ booked: true, can_self_cancel: true })
      const { rows } = await db.query(
        "select $1::timestamptz = starts_at - interval '48 hours' as ok from public.events where id = $2",
        [preview.cancel_deadline, eventId]
      )
      expect(rows[0].ok).toBe(true)
    })
  })

  it("a booked session that starts in under 48 hours cannot be cancelled by herself", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, { customer: f.customerB })
      // Starts in 24 hours, open until it starts.
      const { rows } = await db.query(
        `insert into public.events (
           concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, registration_close_overridden, status)
         values ($1, 'regular', now() + interval '24 hours',
           now() + interval '26 hours', 12, now() + interval '24 hours', true,
           'published')
         returning id`,
        [f.concepts.mothers]
      )
      const eventId = rows[0].id
      await as(db, f.customerB, BOOK, [eventId, randomUUID()])

      expect(
        await as<Record<string, unknown>>(db, f.customerB, PREVIEW, [eventId])
      ).toMatchObject({ booked: true, can_self_cancel: false })
    })
  })
})

describe("book_core input", () => {
  it("a source without units or with a missing or malformed id -> INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      for (const sources of [
        [{ kind: "entitlement", id: f.entitlement }],
        [{ kind: "entitlement", units: 1 }],
        [{ kind: "entitlement", id: "x", units: 1 }],
        [{ kind: "entitlement", id: 5, units: 1 }],
      ]) {
        expect(
          await queryError(
            db,
            "select private.book_core($1, null, $2, 1, $3::jsonb, $1, 'customer', 'book_session')",
            [f.customerA, eventId, JSON.stringify(sources)]
          ),
          JSON.stringify(sources)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
    })
  })
})

describe("idempotency", () => {
  it("the same key returns the same result with one booking and one movement", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      const key = randomUUID()
      const first = await as(db, f.customerA, BOOK, [eventId, key])
      const second = await as(db, f.customerA, BOOK, [eventId, key])

      expect(second).toEqual(first)
      expect(await bookingsOf(db, eventId)).toHaveLength(1)
      expect(
        (await movementsOf(db, f.entitlement)).filter(
          (m) => m.action === "reserve"
        )
      ).toHaveLength(1)
    })
  })
})

describe("availability labels", () => {
  it("5 / 4 / 0 free -> available / last_places / full; a couple session with 1 free -> full; never a number", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const day = await localDay(db, 1, 2)
      const five = await insertEvent(db, f, { day })
      const four = await insertEvent(db, f, { day })
      const none = await insertEvent(db, f, { day })
      const couple = await insertEvent(db, f, {
        day,
        kind: "couple",
        capacity: 14,
      })
      const closed = await insertEvent(db, f, { day, closed: true })
      const draft = await insertEvent(db, f, { day, status: "draft" })
      await fill(db, f, five, 7)
      await fill(db, f, four, 8)
      await fill(db, f, none, 12)
      await fill(db, f, couple, 13)

      const result = await as<
        Array<{ event_id: string; label: string; registration_open: boolean }>
      >(db, f.customerA, AVAILABILITY, [
        [five, four, none, couple, closed, draft],
      ])
      const byId = Object.fromEntries(result.map((row) => [row.event_id, row]))

      expect(Object.keys(byId).sort()).toEqual(
        [five, four, none, couple, closed].sort()
      )
      expect(byId[five].label).toBe("available")
      expect(byId[four].label).toBe("last_places")
      expect(byId[none].label).toBe("full")
      expect(byId[couple].label).toBe("full")
      expect(byId[five].registration_open).toBe(true)
      expect(byId[closed].registration_open).toBe(false)
      for (const row of result) {
        expect(Object.keys(row).sort()).toEqual([
          "event_id",
          "label",
          "registration_open",
        ])
      }
    })
  })
})

describe("permissions", () => {
  it("anon gets 42501 on every new RPC", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const [query, params] of [
        [AVAILABILITY, [[randomUUID()]]],
        [PREVIEW, [randomUUID()]],
        [BOOK, [randomUUID(), randomUUID()]],
      ] as const) {
        expect((await queryError(db, query, [...params]))?.code, query).toBe(
          "42501"
        )
      }
    })
  })

  it("an admin or a user without an active profile cannot book or preview", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      for (const user of [f.admin, randomUUID()]) {
        expect(
          await errorAs(db, user, BOOK, [eventId, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        expect(await errorAs(db, user, PREVIEW, [eventId])).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
    })
  })

  it("a customer reads only her own bookings", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {
        day: await localDay(db, 1, 2),
      })
      await as(db, f.customerA, BOOK, [eventId, randomUUID()])
      await fill(db, f, eventId, 1)

      await asAuthenticated(db, f.customerB)
      const { rows: other } = await db.query("select id from public.bookings")
      expect(other).toEqual([])
      await db.query("reset role")
      await asAuthenticated(db, f.customerA)
      const { rows: own } = await db.query(
        "select customer_id from public.bookings where event_id = $1",
        [eventId]
      )
      expect(own).toEqual([{ customer_id: f.customerA }])
      await db.query("reset role")
    })
  })
})

describe("pg_proc and views", () => {
  it("only private.occupied_places sums party_size", async () => {
    const functions = await sql<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.oid not in (select objid from pg_depend where deptype = 'e')
         and p.prosrc ~* 'sum[[:space:]]*[(][^)]*party_size'
       order by 1`
    )
    expect(functions.map((row) => row.name)).toEqual([
      "private.occupied_places",
    ])
    const views = await sql<{ name: string }>(
      `select schemaname || '.' || viewname as name
       from pg_views
       where schemaname in ('public', 'private')
         and definition ~* 'party_size'
       order by 1`
    )
    expect(views).toEqual([])
  })

  it("only private.book_core inserts bookings", async () => {
    const rows = await sql<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]bookings[[:space:]]'
       order by 1`
    )
    expect(rows.map((row) => row.name)).toEqual(["private.book_core"])
  })
})
