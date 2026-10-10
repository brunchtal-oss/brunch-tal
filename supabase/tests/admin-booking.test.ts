// Story 3.4: session details and manual booking. admin_get_event_details,
// admin_book_customer and preview_admin_book_customer. One test per row of
// the spec's I/O matrix (Tal and a customer on the last place is in
// booking-concurrency.test.ts). Everything runs in inRollback, with the
// settings set inside the transaction. The helpers are copied from
// self-booking.test.ts.

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

const BOOK = "select public.admin_book_customer($1, $2, $3) as r"
const PREVIEW = "select public.preview_admin_book_customer($1, $2) as r"
const DETAILS = "select public.admin_get_event_details($1) as r"
const UPDATE_EVENT = "select public.admin_update_event($1, $2, $3) as r"

type Fixture = MoneyFixture & {
  concepts: Record<string, string>
  payment: string
  entitlement: string
  expiresOn: string
}

// As the owner: the money fixture, the settings, and a card (4 entries, 49
// days from today) approved for customer A.
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

// A local date `from` days from today.
async function localDay(db: Db, from: number): Promise<string> {
  const { rows } = await db.query(
    "select ((now() at time zone 'Asia/Jerusalem')::date + $1::int)::text as d",
    [from]
  )
  return rows[0].d
}

// A session 10:00-12:00 Jerusalem time on `day`, as the owner. closed: the
// close was set by hand a minute ago. ended: it ran from 3 hours ago to an
// hour ago. running: it started an hour ago and ends in an hour (a walk-in on
// the morning).
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    day?: string
    kind?: "regular" | "couple"
    capacity?: number
    status?: string
    closed?: boolean
    ended?: boolean
    running?: boolean
  }
): Promise<string> {
  const kind = options.kind ?? "regular"
  const day = options.day ?? (await localDay(db, 3))
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.starts_at, s.ends_at, $4, s.closes, true, $6
     from (
       select
         case when $7::boolean then now() - interval '3 hours'
              when $8::boolean then now() - interval '1 hour'
              else ($3::date + time '10:00') at time zone 'Asia/Jerusalem' end as starts_at,
         case when $7::boolean then now() - interval '1 hour'
              when $8::boolean then now() + interval '1 hour'
              else ($3::date + time '12:00') at time zone 'Asia/Jerusalem' end as ends_at,
         case when $5::boolean or $7::boolean or $8::boolean
              then now() - interval '4 hours'
              else ($3::date + time '10:00') at time zone 'Asia/Jerusalem' end as closes
     ) s
     returning id`,
    [
      kind === "couple" ? f.concepts.grandma : f.concepts.mothers,
      kind,
      day,
      options.capacity ?? 12,
      options.closed ?? false,
      options.status ?? "published",
      options.ended ?? false,
      options.running ?? false,
    ]
  )
  return rows[0].id
}

// Places taken by bookings without a customer (AD-23), as the owner.
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

// As the owner: an entitlement for `customer` with its payment and grant,
// valid from today for 49 days, any weekday. pinnedTo: pinned to a session.
async function insertEntitlement(
  db: Db,
  f: Fixture,
  options: {
    customer: string
    kind?: string
    eligibleKind?: "regular" | "couple"
    units?: number
    pinnedTo?: string
  }
): Promise<{ id: string; expiresOn: string; product: string }> {
  const product = testName(`funding_${options.kind ?? "card"}`)
  const { rows: payments } = await db.query(
    `insert into public.payments (
       customer_id, product_id, source, recorded_by, payment_method_id,
       amount_agorot, paid_on, product_snapshot)
     values ($1, $2, 'manual', $3, $4, 47200, $5::date,
       jsonb_build_object('name', $6::text))
     returning id`,
    [options.customer, f.card, f.admin, f.method, f.today, product]
  )
  const { rows } = await db.query(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       pinned_event_id, eligibility_snapshot, allowed_weekdays,
       eligible_event_kind)
     values ($1, $2, $3, $4, $5::date, $5::date + 49, $6,
       jsonb_build_object('validity_mode', $7::text), null, $8)
     returning id, expires_on::text as expires_on`,
    [
      options.customer,
      payments[0].id,
      options.kind ?? "card",
      options.units ?? 4,
      f.today,
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
  return { id: rows[0].id, expiresOn: rows[0].expires_on, product }
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
    "select * from public.bookings where event_id = $1 and customer_id is not null order by id",
    [eventId]
  )
  return rows
}

async function movementsOf(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    `select action, units, booking_id from public.entitlement_movements
     where entitlement_id = $1
     order by created_at, action, id`,
    [entitlementId]
  )
  return rows
}

describe("Tal books a customer", () => {
  it("after the registration close, before the end: ok, reserve -1, booked_by admin, one booking_confirmed, an audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { closed: true })

      expect(await as(db, f.admin, PREVIEW, [f.customerA, eventId])).toEqual({
        ok: true,
        product_name: expect.stringContaining("card"),
        expires_on: f.expiresOn,
        source: "entitlement",
        occupied: 0,
        capacity: 12,
      })

      const r = await as<{ booking_id: string }>(db, f.admin, BOOK, [
        f.customerA,
        eventId,
        randomUUID(),
      ])
      expect(r).toEqual({ booking_id: expect.any(String) })

      const bookings = await bookingsOf(db, eventId)
      expect(bookings).toHaveLength(1)
      expect(bookings[0]).toMatchObject({
        id: r.booking_id,
        customer_id: f.customerA,
        party_size: 1,
        status: "confirmed",
        booked_by: "admin",
      })
      expect(await movementsOf(db, f.entitlement)).toEqual([
        { action: "grant", units: 4, booking_id: null },
        { action: "reserve", units: -1, booking_id: r.booking_id },
      ])
      expect(await balance(db, f.entitlement)).toEqual({
        available: 3,
        reserved: 1,
      })

      const { rows: audit } = await db.query(
        `select actor_id, actor_kind, action, customer_id, event_id
         from public.audit_log where entity_id = $1`,
        [r.booking_id]
      )
      expect(audit).toEqual([
        {
          actor_id: f.admin,
          actor_kind: "admin",
          action: "admin_book_customer",
          customer_id: f.customerA,
          event_id: eventId,
        },
      ])
      const { rows: notifications } = await db.query(
        `select target_path from public.notifications
         where recipient_id = $1 and type = 'booking_confirmed'`,
        [f.customerA]
      )
      expect(notifications).toEqual([
        { target_path: `/me/sessions/${eventId}` },
      ])
    })
  })

  it("full: EVENT_FULL with no write; after the capacity goes up to 13, ok", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 12 })
      await fill(db, f, eventId, 12)

      expect(await as(db, f.admin, PREVIEW, [f.customerA, eventId])).toEqual({
        ok: false,
        code: "EVENT_FULL",
        occupied: 12,
        capacity: 12,
      })
      expect(
        await errorAs(db, f.admin, BOOK, [f.customerA, eventId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
      expect(await bookingsOf(db, eventId)).toEqual([])
      expect(await movementsOf(db, f.entitlement)).toHaveLength(1)

      await as(db, f.admin, UPDATE_EVENT, [
        eventId,
        { capacity_adults: 13 },
        randomUUID(),
      ])
      expect(
        await as(db, f.admin, PREVIEW, [f.customerA, eventId])
      ).toMatchObject({ ok: true, occupied: 12, capacity: 13 })
      await as(db, f.admin, BOOK, [f.customerA, eventId, randomUUID()])
      expect(await bookingsOf(db, eventId)).toHaveLength(1)
    })
  })

  it("a couple session: party size 2 and one entry taken; a card only -> NO_MATCHING_ENTITLEMENT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const couple = await insertEvent(db, f, { kind: "couple", capacity: 14 })
      const entitlement = await insertEntitlement(db, f, {
        customer: f.customerB,
        kind: "couple",
        eligibleKind: "couple",
        units: 1,
      })

      expect(await as(db, f.admin, PREVIEW, [f.customerB, couple])).toEqual({
        ok: true,
        product_name: entitlement.product,
        expires_on: entitlement.expiresOn,
        source: "entitlement",
        occupied: 0,
        capacity: 14,
      })
      const r = await as<{ booking_id: string }>(db, f.admin, BOOK, [
        f.customerB,
        couple,
        randomUUID(),
      ])
      expect(await bookingsOf(db, couple)).toMatchObject([
        { id: r.booking_id, party_size: 2 },
      ])
      expect(await balance(db, entitlement.id)).toEqual({
        available: 0,
        reserved: 1,
      })

      // Customer A has only her card (regular sessions).
      expect(await as(db, f.admin, PREVIEW, [f.customerA, couple])).toEqual({
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
        occupied: 2,
        capacity: 14,
      })
      expect(
        await errorAs(db, f.admin, BOOK, [f.customerA, couple, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
      expect(await movementsOf(db, f.entitlement)).toHaveLength(1)
    })
  })

  it("a pinned entitlement: ok for its own session, NO_MATCHING_ENTITLEMENT for another", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const own = await insertEvent(db, f, {})
      const other = await insertEvent(db, f, {})
      const pinned = await insertEntitlement(db, f, {
        customer: f.customerB,
        kind: "single",
        units: 1,
        pinnedTo: own,
      })

      expect(
        await errorAs(db, f.admin, BOOK, [f.customerB, other, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "NO_MATCHING_ENTITLEMENT" })
      expect(
        await as(db, f.admin, PREVIEW, [f.customerB, other])
      ).toMatchObject({ ok: false, code: "NO_MATCHING_ENTITLEMENT" })

      expect(await as(db, f.admin, PREVIEW, [f.customerB, own])).toMatchObject({
        ok: true,
        product_name: pinned.product,
      })
      await as(db, f.admin, BOOK, [f.customerB, own, randomUUID()])
      expect(await bookingsOf(db, own)).toHaveLength(1)
      expect(await balance(db, pinned.id)).toEqual({
        available: 0,
        reserved: 1,
      })
    })
  })

  it("already booked, not published, ended -> CUSTOMER_ALREADY_BOOKED / EVENT_NOT_BOOKABLE / EVENT_ENDED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const booked = await insertEvent(db, f, {})
      await as(db, f.admin, BOOK, [f.customerA, booked, randomUUID()])
      const draft = await insertEvent(db, f, { status: "draft" })
      const cancelled = await insertEvent(db, f, { status: "cancelled" })
      const ended = await insertEvent(db, f, { ended: true })

      for (const [eventId, code] of [
        [booked, "CUSTOMER_ALREADY_BOOKED"],
        [draft, "EVENT_NOT_BOOKABLE"],
        [cancelled, "EVENT_NOT_BOOKABLE"],
        [randomUUID(), "EVENT_NOT_BOOKABLE"],
        [ended, "EVENT_ENDED"],
      ]) {
        expect(
          await errorAs(db, f.admin, BOOK, [
            f.customerA,
            eventId,
            randomUUID(),
          ]),
          code
        ).toMatchObject({ code: "P0001", message: code })
        expect(
          await as(db, f.admin, PREVIEW, [f.customerA, eventId]),
          code
        ).toMatchObject({ ok: false, code })
      }
      expect(await movementsOf(db, f.entitlement)).toHaveLength(2)
    })
  }, 30_000)

  it("a session that started and has not ended (a walk-in): ok, and the preview is ok", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { running: true })
      // Valid from yesterday, so the session's local day is inside the
      // validity even right after midnight.
      const card = await insertEntitlement(db, f, { customer: f.customerB })
      await db.query(
        "update public.entitlements set valid_from = valid_from - 1 where id = $1",
        [card.id]
      )

      expect(
        await as(db, f.admin, PREVIEW, [f.customerB, eventId])
      ).toMatchObject({ ok: true, product_name: card.product })
      const r = await as<{ booking_id: string }>(db, f.admin, BOOK, [
        f.customerB,
        eventId,
        randomUUID(),
      ])
      expect(r).toEqual({ booking_id: expect.any(String) })
      expect(await bookingsOf(db, eventId)).toMatchObject([
        { id: r.booking_id, booked_by: "admin" },
      ])
    })
  })

  it("a customer who was not activated or was removed -> CUSTOMER_NOT_AVAILABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {})
      const pending = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name) values ($1, $2)",
        [pending, testName("not_activated")]
      )
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerA]
      )

      for (const customer of [pending, f.customerA, randomUUID()]) {
        expect(
          await errorAs(db, f.admin, BOOK, [customer, eventId, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "CUSTOMER_NOT_AVAILABLE" })
        expect(await as(db, f.admin, PREVIEW, [customer, eventId])).toEqual({
          ok: false,
          code: "CUSTOMER_NOT_AVAILABLE",
          occupied: 0,
          capacity: 12,
        })
      }
      expect(await bookingsOf(db, eventId)).toEqual([])
    })
  })

  it("the same key again returns the same result, with no second booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {})
      const key = randomUUID()
      const first = await as(db, f.admin, BOOK, [f.customerA, eventId, key])
      const again = await as(db, f.admin, BOOK, [f.customerA, eventId, key])
      expect(again).toEqual(first)
      expect(await bookingsOf(db, eventId)).toHaveLength(1)
      expect(await movementsOf(db, f.entitlement)).toHaveLength(2)
    })
  })
})

describe("permissions", () => {
  it("anon gets 42501 on the three functions", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const [query, params] of [
        [BOOK, [randomUUID(), randomUUID(), randomUUID()]],
        [PREVIEW, [randomUUID(), randomUUID()]],
        [DETAILS, [randomUUID()]],
      ] as const) {
        expect((await queryError(db, query, [...params]))?.code, query).toBe(
          "42501"
        )
      }
    })
  })

  it("a customer gets NOT_AUTHORIZED on the three functions", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, {})
      for (const [query, params] of [
        [BOOK, [f.customerA, eventId, randomUUID()]],
        [PREVIEW, [f.customerA, eventId]],
        [DETAILS, [eventId]],
      ] as const) {
        expect(
          await errorAs(db, f.customerA, query, [...params]),
          query
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      }
      expect(await bookingsOf(db, eventId)).toEqual([])
    })
  })
})

describe("the session's details", () => {
  it("a couple booking, a pending one, a removed customer and a cancelled booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple", capacity: 14 })
      // A fictitious phone no other profile has (phone_e164 is unique).
      const phone = `+97259${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`
      await db.query(
        "update public.profiles set phone_e164 = $2, dietary_notes = $3 where id = $1",
        [f.customerB, phone, "gluten free"]
      )
      await db.query(
        `insert into public.babies (customer_id, name, birth_date)
         values ($1, 'Ori', $2::date - 90), ($1, 'Maya', $2::date - 30)`,
        [f.customerB, f.today]
      )
      await insertEntitlement(db, f, {
        customer: f.customerB,
        kind: "couple",
        eligibleKind: "couple",
        units: 1,
      })
      const couple = await as<{ booking_id: string }>(db, f.admin, BOOK, [
        f.customerB,
        eventId,
        randomUUID(),
      ])
      await db.query(
        "update public.bookings set guest_details = 'vegan' where id = $1",
        [couple.booking_id]
      )

      // A pinned purchase not bound yet (AD-23), with its payer label.
      const { rows: pendingPayment } = await db.query(
        `insert into public.payments (
           product_id, source, recorded_by, payment_method_id,
           amount_agorot, paid_on, product_snapshot, payer_label)
         values ($1, 'manual', $2, $3, 47200, $4::date, '{}'::jsonb, 'Noa')
         returning id`,
        [f.card, f.admin, f.method, f.today]
      )
      const { rows: pending } = await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot,
           confirmed_at)
         values ($1, $2, 2, 'admin',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb,
           now() + interval '1 second')
         returning id`,
        [pendingPayment[0].id, eventId]
      )

      // Customer A booked and removed; a cancelled booking is not returned.
      const { rows: removed } = await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot,
           confirmed_at)
         values ($1, $2, 2, 'customer',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb,
           now() + interval '2 seconds')
         returning id`,
        [f.customerA, eventId]
      )
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerA]
      )
      const third = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [third, testName("cancelled")]
      )
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot,
           status, cancelled_at)
         values ($1, $2, 2, 'customer',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb,
           'cancelled', now())`,
        [third, eventId]
      )

      const r = await as<{
        event: Record<string, unknown>
        bookings: Record<string, unknown>[]
      }>(db, f.admin, DETAILS, [eventId])

      const { rows: concept } = await db.query(
        "select name from public.concepts where id = $1",
        [f.concepts.grandma]
      )
      expect(r.event).toMatchObject({
        id: eventId,
        concept_name: concept[0].name,
        kind: "couple",
        status: "published",
        capacity_adults: 14,
        // The pending booking counts.
        occupied: 6,
      })
      expect(Object.keys(r.event).sort()).toEqual([
        "capacity_adults",
        "concept_name",
        "ends_at",
        "id",
        "kind",
        "occupied",
        "registration_closes_at",
        "starts_at",
        "status",
      ])

      const babyDate = (days: number) =>
        db
          .query("select ($1::date - $2::int)::text as d", [f.today, days])
          .then((q) => q.rows[0].d as string)
      expect(r.bookings).toEqual([
        {
          booking_id: couple.booking_id,
          party_size: 2,
          booked_by: "admin",
          guest_details: "vegan",
          customer_id: f.customerB,
          pending_join: false,
          full_name: testName("money_b"),
          phone_e164: phone,
          dietary_notes: "gluten free",
          // Story 4.10: only for an active customer.
          photo_consent: false,
          personal_photo_consent: false,
          babies: [
            { name: "Ori", birth_date: await babyDate(90) },
            { name: "Maya", birth_date: await babyDate(30) },
          ],
        },
        {
          booking_id: pending[0].id,
          party_size: 2,
          booked_by: "admin",
          pending_join: true,
          payer_label: "Noa",
        },
        {
          booking_id: removed[0].id,
          party_size: 2,
          booked_by: "customer",
          customer_id: f.customerA,
          pending_join: false,
        },
      ])
    })
  })

  it("an unknown session -> NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await errorAs(db, f.admin, DETAILS, [randomUUID()])).toMatchObject(
        { code: "P0001", message: "NOT_FOUND" }
      )
    })
  })
})
