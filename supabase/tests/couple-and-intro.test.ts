// Story 3.5: couple and intro bookings. set_booking_guest_details (the
// companion's dietary note), get_my_bookings' note fields, the
// booking_confirmed_couple notification from every path (pinned approval,
// bind, self-booking from a credit), the couple rules that already work
// (one place left, no card for a couple session in any mode), one intro
// booking, preview_book_session of a cancelled session and bind_purchase
// against a completed booking. One test per row of the spec's I/O matrix.
// Everything runs in inRollback, with the settings set inside the
// transaction and every other published session moved to draft there.

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

const SET_NOTE = "select public.set_booking_guest_details($1, $2, $3) as r"
const MY_BOOKINGS = "select public.get_my_bookings() as r"
const DETAILS = "select public.admin_get_event_details($1) as r"
const BOOK = "select public.book_session($1, $2) as r"
const PREVIEW = "select public.preview_book_session($1) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const ADMIN_BOOK = "select public.admin_book_customer($1, $2, $3) as r"
const ADMIN_PREVIEW = "select public.preview_admin_book_customer($1, $2) as r"
const AVAILABILITY = "select public.get_event_availability($1::uuid[]) as r"
// Story 3.8's business cancel (p_event_id, p_confirmed, p_message,
// p_idempotency_key, p_parked_acknowledged default false).
const ADMIN_CANCEL_EVENT =
  "select public.admin_cancel_event($1, $2, $3, $4) as r"
const APPROVE_NOTIFICATIONS = `select type from public.notifications
  where recipient_id = $1 order by type`
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  couple: string
  single: string
  intro: string
  mothers: string
  grandma: string
}

async function insertProduct(
  db: Db,
  label: string,
  type: "single" | "intro" | "couple"
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, intro_only)
     values ($1, $2, $3, 1, 'session', null, null, $4, $5, $6)
     returning id`,
    [
      testName(label),
      type,
      type === "couple" ? 25000 : 12800,
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
    couple: await insertProduct(db, "couple", "couple"),
    single: await insertProduct(db, "single", "single"),
    intro: await insertProduct(db, "intro", "intro"),
    mothers: concepts.mothers,
    grandma: concepts.grandma,
  }
}

// As the owner: a 2-hour session on the local date today + dayOffset at
// 10:00 Jerusalem time. closed: its registration closed a minute ago.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    dayOffset?: number
    kind?: "regular" | "couple"
    capacity?: number
    status?: string
    closed?: boolean
  } = {}
): Promise<string> {
  const kind = options.kind ?? "regular"
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '2 hours', $3,
       case when $6::boolean then now() - interval '1 minute' else s.t end,
       true, $4
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $5::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [
      kind === "couple" ? f.grandma : f.mothers,
      kind,
      options.capacity ?? (kind === "couple" ? 14 : 12),
      options.status ?? "published",
      options.dayOffset ?? 7,
      options.closed ?? false,
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

async function asRow<T = Record<string, unknown>>(
  db: Db,
  user: string,
  text: string,
  params: unknown[]
): Promise<T> {
  return as(db, user, async () => (await db.query(text, params)).rows[0].r)
}

// The error of a statement, with detail.field.
async function failure(
  db: Db,
  user: string,
  text: string,
  params: unknown[]
): Promise<{ message: string; field: string | null } | null> {
  return as(db, user, async () => {
    await db.query("savepoint failure")
    try {
      await db.query(text, params)
      await db.query("release savepoint failure")
      return null
    } catch (error) {
      await db.query("rollback to savepoint failure")
      const { message, detail } = error as { message: string; detail?: string }
      return {
        message,
        field: detail
          ? ((JSON.parse(detail) as { field?: string }).field ?? null)
          : null,
      }
    }
  })
}

// As the admin: approves a pinned product for a session (customer A unless
// given; null: a new customer). Returns the booking, payment and
// entitlement.
async function pinned(
  db: Db,
  f: Fixture,
  productId: string,
  eventId: string,
  customerId: string | null = f.customerA
) {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      eventId,
      amount: productId === f.couple ? 25000 : 12800,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  return {
    booking: r.booking_id as string,
    payment: r.payment_id as string,
    entitlement: r.entitlement_id as string,
  }
}

// As the owner: an entitlement of `customer` with its payment and grant,
// valid from today for 49 days, any weekday, not pinned.
async function insertEntitlement(
  db: Db,
  f: Fixture,
  customer: string,
  kind: "card" | "couple",
  eligibleKind: "regular" | "couple"
): Promise<string> {
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
       eligibility_snapshot, allowed_weekdays, eligible_event_kind)
     values ($1, $2, $3, 4, $4::date, $4::date + 49,
       jsonb_build_object('validity_mode', 'days'), null, $5)
     returning id`,
    [customer, payments[0].id, kind, f.today, eligibleKind]
  )
  await db.query(
    `insert into public.entitlement_movements (entitlement_id, action, units)
     values ($1, 'grant', 4)`,
    [rows[0].id]
  )
  return rows[0].id
}

// As the owner: `places` seats taken by bookings without a customer.
async function fill(db: Db, payment: string, eventId: string, places: number) {
  await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     select $1, $2, 1, 'admin', ${SNAPSHOT}
     from generate_series(1, $3::int)`,
    [payment, eventId, places]
  )
}

async function booking(db: Db, id: string) {
  const { rows } = await db.query(
    "select status, party_size, guest_details from public.bookings where id = $1",
    [id]
  )
  return rows[0]
}

async function noteAudit(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `select actor_kind, customer_id, before, after from public.audit_log
     where entity_id = $1 and action = 'set_booking_guest_details'`,
    [bookingId]
  )
  return rows
}

async function notificationsOf(db: Db, customer: string) {
  const { rows } = await db.query(
    `select n.type, n.target_path, n.dedupe_key, n.payload ->> 'body' as body,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.recipient_id = $1 and n.type like 'booking_confirmed%'
     order by n.type, n.id`,
    [customer]
  )
  return rows
}

async function bookingsIn(db: Db, eventId: string, customer: string) {
  const { rows } = await db.query(
    "select id from public.bookings where event_id = $1 and customer_id = $2",
    [eventId, customer]
  )
  return rows
}

describe("the companion's dietary note", { timeout: 30_000 }, () => {
  it("save: trimmed and saved, in her bookings and in Tal's session details; one audit row with the value masked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)

      const r = await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "צמחונית ",
        randomUUID(),
      ])
      expect(r).toEqual({ booking_id: p.booking, guest_details: "צמחונית" })
      expect(await booking(db, p.booking)).toMatchObject({
        guest_details: "צמחונית",
      })
      expect(await noteAudit(db, p.booking)).toEqual([
        {
          actor_kind: "customer",
          customer_id: f.customerA,
          before: { guest_details: "<changed>" },
          after: { guest_details: "<changed>" },
        },
      ])
      // No notification for a note.
      expect(await notificationsOf(db, f.customerA)).toHaveLength(1)

      const mine = await asRow<{ upcoming: Record<string, unknown>[] }>(
        db,
        f.customerA,
        MY_BOOKINGS,
        []
      )
      expect(mine.upcoming).toEqual([
        expect.objectContaining({
          booking_id: p.booking,
          party_size: 2,
          guest_details: "צמחונית",
          guest_details_editable: true,
          funding: "pinned",
        }),
      ])

      const details = await asRow<{ bookings: Record<string, unknown>[] }>(
        db,
        f.admin,
        DETAILS,
        [eventId]
      )
      expect(details.bookings).toEqual([
        expect.objectContaining({
          booking_id: p.booking,
          party_size: 2,
          guest_details: "צמחונית",
        }),
      ])
    })
  })

  it("clear: spaces only -> null", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)
      await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "טבעונית",
        randomUUID(),
      ])

      const r = await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "  ",
        randomUUID(),
      ])
      expect(r).toEqual({ booking_id: p.booking, guest_details: null })
      expect(await booking(db, p.booking)).toMatchObject({
        guest_details: null,
      })
      expect(await noteAudit(db, p.booking)).toHaveLength(2)
    })
  })

  it("after the registration close: REGISTRATION_CLOSED, nothing changes; not editable in her bookings", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [eventId]
      )

      expect(
        await failure(db, f.customerA, SET_NOTE, [
          p.booking,
          "צמחונית",
          randomUUID(),
        ])
      ).toEqual({ message: "REGISTRATION_CLOSED", field: null })
      expect(await booking(db, p.booking)).toMatchObject({
        guest_details: null,
      })
      expect(await noteAudit(db, p.booking)).toEqual([])
      const mine = await asRow<{ upcoming: Record<string, unknown>[] }>(
        db,
        f.customerA,
        MY_BOOKINGS,
        []
      )
      expect(mine.upcoming[0]).toMatchObject({
        guest_details: null,
        guest_details_editable: false,
      })
    })
  })

  it("not couple / not hers / cancelled: INVALID_INPUT (booking) / NOT_FOUND / INVALID_INPUT (booking), nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const regular = await insertEvent(db, f)
      const couple = await insertEvent(db, f, { kind: "couple" })
      const other = await insertEvent(db, f, { kind: "couple", dayOffset: 9 })
      const single = await pinned(db, f, f.single, regular)
      const hers = await pinned(db, f, f.couple, couple)
      const cancelled = await pinned(db, f, f.couple, other)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [cancelled.booking, randomUUID(), "credit"])
      )

      expect(
        await failure(db, f.customerA, SET_NOTE, [
          single.booking,
          "x",
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", field: "booking" })
      expect(
        await failure(db, f.customerB, SET_NOTE, [
          hers.booking,
          "x",
          randomUUID(),
        ])
      ).toEqual({ message: "NOT_FOUND", field: null })
      expect(
        await failure(db, f.customerA, SET_NOTE, [
          cancelled.booking,
          "x",
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", field: "booking" })
      expect(
        await failure(db, f.customerA, SET_NOTE, [
          randomUUID(),
          "x",
          randomUUID(),
        ])
      ).toEqual({ message: "NOT_FOUND", field: null })
      for (const id of [single.booking, hers.booking, cancelled.booking]) {
        expect((await booking(db, id)).guest_details).toBeNull()
        expect(await noteAudit(db, id)).toEqual([])
      }
    })
  })

  it("too long: 1001 characters -> INVALID_INPUT (guest_details); 1000 is saved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)

      expect(
        await failure(db, f.customerA, SET_NOTE, [
          p.booking,
          "א".repeat(1001),
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", field: "guest_details" })
      expect((await booking(db, p.booking)).guest_details).toBeNull()

      await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "א".repeat(1000),
        randomUUID(),
      ])
      expect((await booking(db, p.booking)).guest_details).toHaveLength(1000)
    })
  })

  it("idempotent: the same key twice returns the same result with one audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)
      const key = randomUUID()
      const first = await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "בלי גלוטן",
        key,
      ])
      const second = await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "בלי גלוטן",
        key,
      ])
      expect(second).toEqual(first)
      expect(await noteAudit(db, p.booking)).toHaveLength(1)
    })
  })

  it("an unchanged note (after trimming) with a new key writes no second audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)
      await asRow(db, f.customerA, SET_NOTE, [p.booking, "X", randomUUID()])
      const again = await asRow(db, f.customerA, SET_NOTE, [
        p.booking,
        "X ",
        randomUUID(),
      ])
      expect(again).toEqual({ booking_id: p.booking, guest_details: "X" })
      expect(await noteAudit(db, p.booking)).toHaveLength(1)
    })
  })

  it("a single confirmed booking is never editable in her bookings", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const p = await pinned(db, f, f.single, eventId)
      const mine = await asRow<{ upcoming: Record<string, unknown>[] }>(
        db,
        f.customerA,
        MY_BOOKINGS,
        []
      )
      expect(mine.upcoming).toEqual([
        expect.objectContaining({
          booking_id: p.booking,
          status: "confirmed",
          party_size: 1,
          guest_details_editable: false,
        }),
      ])
    })
  })

  it("a guest (no customer profile) -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await failure(db, f.admin, SET_NOTE, [randomUUID(), "x", randomUUID()])
      ).toEqual({ message: "NOT_AUTHORIZED", field: null })
    })
  })
})

describe("booking_confirmed_couple", { timeout: 30_000 }, () => {
  it("pinned couple approval for an existing customer: one booking_confirmed_couple to the note's section, with a push job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId)
      const { rows: concept } = await db.query(
        "select name from public.concepts where id = $1",
        [f.grandma]
      )

      const sent = await notificationsOf(db, f.customerA)
      expect(sent).toEqual([
        {
          type: "booking_confirmed_couple",
          target_path: `/me/bookings#booking-${p.booking}`,
          dedupe_key: `booking_confirmed_couple:${f.customerA}:${p.booking}`,
          body: expect.stringContaining(`בראנץ׳ ${concept[0].name}.`),
          jobs: 1,
        },
      ])
      expect(sent[0].body).toMatch(/^\d{2}\.\d{2} · 10:00 · /)
      expect(sent[0].body).toContain(
        "אפשר להוסיף בהרשמות שלך הגבלות תזונה או אלרגיות של המלווה"
      )
    })
  })

  // User decision 2026-10-13: a pinned product approved for an existing
  // customer sends only the booking notification, no purchase_repeat.
  it.each([
    ["single", "booking_confirmed"],
    ["intro", "booking_confirmed"],
    ["couple", "booking_confirmed_couple"],
  ] as const)(
    "a pinned %s approved for an existing customer: exactly one notification, %s",
    async (product, type) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const eventId = await insertEvent(db, f, {
          kind: product === "couple" ? "couple" : "regular",
        })
        const p = await pinned(db, f, f[product], eventId)
        const { rows } = await db.query(
          `select type, dedupe_key from public.notifications
           where recipient_id = $1`,
          [f.customerA]
        )
        expect(rows).toEqual([
          { type, dedupe_key: `${type}:${f.customerA}:${p.booking}` },
        ])
      })
    }
  )

  it("a card approved for an existing customer: purchase_repeat as before", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const { rows } = await db.query(APPROVE_NOTIFICATIONS, [f.customerA])
      expect(rows).toEqual([{ type: "purchase_repeat" }])
    })
  })

  it("Tal books a customer with a couple entitlement into a couple session: one booking_confirmed_couple to the note's section", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerB, "couple", "couple")
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const r = await asRow<{ booking_id: string }>(db, f.admin, ADMIN_BOOK, [
        f.customerB,
        eventId,
        randomUUID(),
      ])
      expect(await notificationsOf(db, f.customerB)).toEqual([
        expect.objectContaining({
          type: "booking_confirmed_couple",
          target_path: `/me/bookings#booking-${r.booking_id}`,
          dedupe_key: `booking_confirmed_couple:${f.customerB}:${r.booking_id}`,
        }),
      ])
    })
  })

  it("an unbound couple seat: the bind sends one booking_confirmed_couple", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const p = await pinned(db, f, f.couple, eventId, null)
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.notifications where dedupe_key like $1",
        [`%:${p.booking}`]
      )
      expect(before[0].n).toBe(0)

      await db.query("select private.bind_purchase($1, $2)", [
        p.payment,
        f.customerB,
      ])
      expect(await notificationsOf(db, f.customerB)).toEqual([
        expect.objectContaining({
          type: "booking_confirmed_couple",
          target_path: `/me/bookings#booking-${p.booking}`,
          jobs: 1,
        }),
      ])
      // Only the booking notification (unchanged by the 2026-10-13 rule).
      const { rows } = await db.query(APPROVE_NOTIFICATIONS, [f.customerB])
      expect(rows).toEqual([{ type: "booking_confirmed_couple" }])
    })
  })

  it("a single booking by card: booking_confirmed to the session page, no push", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA, "card", "regular")
      const eventId = await insertEvent(db, f)
      const r = await asRow<{ booking_id: string }>(db, f.customerA, BOOK, [
        eventId,
        randomUUID(),
      ])
      expect(await notificationsOf(db, f.customerA)).toEqual([
        expect.objectContaining({
          type: "booking_confirmed",
          target_path: `/me/sessions/${eventId}`,
          dedupe_key: `booking_confirmed:${f.customerA}:${r.booking_id}`,
          jobs: 0,
        }),
      ])
    })
  })

  it("a couple self-booking from a couple credit: party 2 and booking_confirmed_couple", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { kind: "couple", dayOffset: 5 })
      const option = await insertEvent(db, f, { kind: "couple", dayOffset: 8 })
      const p = await pinned(db, f, f.couple, origin)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [p.booking, randomUUID(), "credit"])
      )

      const r = await asRow<{ booking_id: string }>(db, f.customerA, BOOK, [
        option,
        randomUUID(),
      ])
      expect(await booking(db, r.booking_id)).toMatchObject({
        status: "confirmed",
        party_size: 2,
      })
      const sent = await notificationsOf(db, f.customerA)
      expect(
        sent.filter((n) => n.dedupe_key.endsWith(`:${r.booking_id}`))
      ).toEqual([
        expect.objectContaining({
          type: "booking_confirmed_couple",
          target_path: `/me/bookings#booking-${r.booking_id}`,
        }),
      ])
    })
  })
})

describe("couple and intro rules", { timeout: 30_000 }, () => {
  it("a couple session with one free place: label full; preview and book EVENT_FULL, nothing created", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEntitlement(db, f, f.customerA, "couple", "couple")
      const eventId = await insertEvent(db, f, { kind: "couple" })
      const filler = await pinned(db, f, f.single, await insertEvent(db, f))
      await fill(db, filler.payment, eventId, 13)

      const availability = await asRow<{ event_id: string; label: string }[]>(
        db,
        f.customerA,
        AVAILABILITY,
        [[eventId]]
      )
      expect(availability).toEqual([
        expect.objectContaining({ event_id: eventId, label: "full" }),
      ])
      expect(await asRow(db, f.customerA, PREVIEW, [eventId])).toMatchObject({
        ok: false,
        code: "EVENT_FULL",
        booked: false,
      })
      expect(
        await failure(db, f.customerA, BOOK, [eventId, randomUUID()])
      ).toMatchObject({ message: "EVENT_FULL" })
      expect(await bookingsIn(db, eventId, f.customerA)).toEqual([])
    })
  })

  it("a card for couple sessions is never offered or funded for a couple session, by her or by Tal", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await insertEntitlement(db, f, f.customerA, "card", "couple")
      const eventId = await insertEvent(db, f, { kind: "couple" })

      expect(await asRow(db, f.customerA, PREVIEW, [eventId])).toMatchObject({
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
      })
      expect(
        await failure(db, f.customerA, BOOK, [eventId, randomUUID()])
      ).toMatchObject({ message: "NO_MATCHING_ENTITLEMENT" })
      expect(
        await asRow(db, f.admin, ADMIN_PREVIEW, [f.customerA, eventId])
      ).toMatchObject({ ok: false, code: "NO_MATCHING_ENTITLEMENT" })
      expect(
        await failure(db, f.admin, ADMIN_BOOK, [
          f.customerA,
          eventId,
          randomUUID(),
        ])
      ).toMatchObject({ message: "NO_MATCHING_ENTITLEMENT" })
      expect(await bookingsIn(db, eventId, f.customerA)).toEqual([])
      const { rows } = await db.query(
        "select count(*)::int as n from public.entitlement_movements where entitlement_id = $1",
        [card]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("a second intro booking: Tal books her intro customer into another session -> NO_MATCHING_ENTITLEMENT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await insertEvent(db, f)
      const second = await insertEvent(db, f, { dayOffset: 9 })
      await pinned(db, f, f.intro, first)

      expect(
        await failure(db, f.admin, ADMIN_BOOK, [
          f.customerA,
          second,
          randomUUID(),
        ])
      ).toMatchObject({ message: "NO_MATCHING_ENTITLEMENT" })
      expect(await bookingsIn(db, second, f.customerA)).toEqual([])
    })
  })
})

describe("a cancelled session", { timeout: 30_000 }, () => {
  it("her booking there (confirmed, or cancelled together with the session): EVENT_CANCELLED with booked true", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const p = await pinned(db, f, f.single, eventId)
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [eventId]
      )

      // The session's status changed directly: her booking is still
      // confirmed.
      expect(await asRow(db, f.customerA, PREVIEW, [eventId])).toEqual({
        ok: false,
        code: "EVENT_CANCELLED",
        booked: true,
        booking_id: p.booking,
      })
    })
  })

  it("Tal cancels the session (admin_cancel_event, 3.8): her booking is cancelled with it and still shown, booked true", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await insertEvent(db, f, { dayOffset: 9 })
      const p = await pinned(db, f, f.single, eventId)

      await asRow(db, f.admin, ADMIN_CANCEL_EVENT, [
        eventId,
        true,
        testName("cancel message"),
        randomUUID(),
      ])
      expect(await booking(db, p.booking)).toMatchObject({
        status: "cancelled",
      })
      expect(await asRow(db, f.customerA, PREVIEW, [eventId])).toEqual({
        ok: false,
        code: "EVENT_CANCELLED",
        booked: true,
        booking_id: p.booking,
      })
    })
  })

  it("a booking she cancelled herself before the session was cancelled: EVENT_CANCELLED with booked false", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await insertEvent(db, f, { dayOffset: 9 })
      const p = await pinned(db, f, f.single, eventId)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [p.booking, randomUUID(), "credit"])
      )
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [eventId]
      )

      expect(await asRow(db, f.customerA, PREVIEW, [eventId])).toEqual({
        ok: false,
        code: "EVENT_CANCELLED",
        booked: false,
      })
      // Another customer, no booking at all.
      expect(await asRow(db, f.customerB, PREVIEW, [eventId])).toEqual({
        ok: false,
        code: "EVENT_CANCELLED",
        booked: false,
      })
    })
  })
})

describe("bind after completion", { timeout: 30_000 }, () => {
  it("an unbound pinned seat in a session where she has a completed booking -> BIND_CONFLICT, nothing bound", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const p = await pinned(db, f, f.single, eventId, null)
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, status, booked_by, policy_snapshot)
         values ($1, $2, 1, 'completed', 'customer', ${SNAPSHOT})`,
        [f.customerA, eventId]
      )

      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          p.payment,
          f.customerA,
        ])
      ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })
      const { rows } = await db.query(
        "select customer_id from public.bookings where payment_id = $1",
        [p.payment]
      )
      expect(rows).toEqual([{ customer_id: null }])
    })
  })
})
