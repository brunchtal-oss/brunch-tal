// Story 3.11: a pinned product (single, intro, couple) approved for a session
// Tal picks: admin_approve_payment, preview_admin_approve_payment and the
// approval core place the booking (private.place_pinned_booking ->
// private.book_core); bind_purchase moves it to the new customer; 'park'
// keeps the payment without a booking; admin_list_bookable_events feeds the
// session field. One test per row of the spec's I/O matrix (the conflicts of
// the bind are in bind-purchase.test.ts, a card's self-booking in
// self-booking.test.ts). Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  APPROVE,
  approve,
  approveParams,
  seedMoney,
  type ApproveInput,
  type MoneyFixture,
} from "./support/money"

const PREVIEW =
  // A new customer's payer name is required (2026-10-05).
  "select public.preview_admin_approve_payment($1, case when $1::uuid is null then 'Test payer' end, $2, $3, $4, $5::date, $6) as r"
const LIST = "select public.admin_list_bookable_events() as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  single: string
  intro: string
  couple: string
  concepts: Record<string, string>
}

// As the owner: a pinned product (validity_mode session, every weekday).
async function insertPinned(
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
  const { rows: concepts } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  return {
    ...f,
    single: await insertPinned(db, "single", "single"),
    intro: await insertPinned(db, "intro", "intro"),
    couple: await insertPinned(db, "couple", "couple"),
    concepts: Object.fromEntries(concepts.map((c) => [c.theme_key, c.id])),
  }
}

// As the owner: a session `days` from now (negative: in the past), 2 hours.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    kind?: "regular" | "couple"
    days?: number
    capacity?: number
    status?: string
  } = {}
): Promise<string> {
  const kind = options.kind ?? "regular"
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, $2, now() + make_interval(days => $3::int),
       now() + make_interval(days => $3::int) + interval '2 hours', $4,
       now() + make_interval(days => $3::int), $5)
     returning id`,
    [
      kind === "couple" ? f.concepts.grandma : f.concepts.mothers,
      kind,
      options.days ?? 7,
      options.capacity ?? (kind === "couple" ? 14 : 12),
      options.status ?? "published",
    ]
  )
  return rows[0].id
}

// As the owner: `places` seats taken by bookings without a customer on an
// unrelated card payment (AD-23).
async function fill(db: Db, f: Fixture, eventId: string, places: number) {
  await asAuthenticated(db, f.admin)
  const card = await approve(db, {
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
  })
  await db.query("reset role")
  await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     select $1, $2, 1, 'admin', ${SNAPSHOT}
     from generate_series(1, $3::int)`,
    [card.payment_id, eventId, places]
  )
}

function pinnedInput(
  f: Fixture,
  productId: string,
  eventId: string | null,
  extra: Partial<ApproveInput> = {}
): ApproveInput {
  return {
    productId,
    eventId,
    amount: productId === f.couple ? 25000 : 12800,
    paidOn: f.today,
    methodId: f.method,
    // Several approvals of one product in a test are not duplicates here.
    duplicateConfirmed: true,
    key: randomUUID(),
    ...extra,
  }
}

async function approveAs(db: Db, f: Fixture, input: ApproveInput) {
  await asAuthenticated(db, f.admin)
  try {
    return await approve(db, input)
  } finally {
    await db.query("reset role")
  }
}

async function approveError(db: Db, f: Fixture, input: ApproveInput) {
  await asAuthenticated(db, f.admin)
  try {
    return await queryError(db, APPROVE, approveParams(input))
  } finally {
    await db.query("reset role")
  }
}

async function previewError(
  db: Db,
  f: Fixture,
  customerId: string | null,
  productId: string,
  eventId: string | null
) {
  await asAuthenticated(db, f.admin)
  try {
    return await queryError(db, PREVIEW, [
      customerId,
      productId,
      eventId,
      productId === f.couple ? 25000 : 12800,
      f.today,
      f.method,
    ])
  } finally {
    await db.query("reset role")
  }
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

async function createdFor(db: Db, productId: string) {
  return {
    payments: await count(
      db,
      "select 1 from public.payments where product_id = $1",
      [productId]
    ),
    bookings: await count(
      db,
      `select 1 from public.bookings b
       join public.payments p on p.id = b.payment_id
       where p.product_id = $1`,
      [productId]
    ),
  }
}

async function movements(db: Db, entitlementId: string) {
  const { rows } = await db.query(
    `select action, units, booking_id from public.entitlement_movements
     where entitlement_id = $1
     order by created_at, action, id`,
    [entitlementId]
  )
  return rows
}

describe("approving a pinned product places the booking", () => {
  it("a single for a new customer: payment, entitlement to the session's day, a booking without a customer, reserve -1 and a link; the place counts", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)

      await asAuthenticated(db, f.admin)
      const { rows: preview } = await db.query(PREVIEW, [
        null,
        f.single,
        eventId,
        12800,
        f.today,
        f.method,
      ])
      await db.query("reset role")
      expect(preview[0].r).toMatchObject({
        event_id: eventId,
        concept_name: expect.any(String),
        units: 1,
      })

      const r = await approveAs(db, f, pinnedInput(f, f.single, eventId))
      expect(r).toMatchObject({
        payment_id: expect.any(String),
        token: expect.any(String),
        event_id: eventId,
        booking_id: expect.any(String),
        reissue_required: false,
      })

      const { rows: entitlements } = await db.query(
        `select e.id, e.customer_id, e.pinned_event_id, e.expires_on::text as expires_on,
           ((ev.starts_at at time zone 'Asia/Jerusalem')::date)::text as event_day
         from public.entitlements e
         join public.events ev on ev.id = e.pinned_event_id
         where e.payment_id = $1`,
        [r.payment_id]
      )
      expect(entitlements).toHaveLength(1)
      expect(entitlements[0].customer_id).toBeNull()
      expect(entitlements[0].pinned_event_id).toBe(eventId)
      expect(entitlements[0].expires_on).toBe(entitlements[0].event_day)
      expect((preview[0].r as { expires_on: string }).expires_on).toBe(
        entitlements[0].event_day
      )

      const { rows: bookings } = await db.query(
        "select id, customer_id, payment_id, party_size, status, booked_by from public.bookings where event_id = $1",
        [eventId]
      )
      expect(bookings).toEqual([
        {
          id: r.booking_id,
          customer_id: null,
          payment_id: r.payment_id,
          party_size: 1,
          status: "confirmed",
          booked_by: "admin",
        },
      ])
      expect(await movements(db, entitlements[0].id)).toEqual([
        { action: "grant", units: 1, booking_id: null },
        { action: "reserve", units: -1, booking_id: r.booking_id },
      ])
      expect(await occupied(db, eventId)).toBe(1)
      // No customer yet: no booking_confirmed (AD-23).
      expect(
        await count(
          db,
          "select 1 from public.notifications where dedupe_key like $1",
          [`booking_confirmed:%:${r.booking_id}`]
        )
      ).toBe(0)
    })
  })

  it("a couple for an existing customer in a couple session at 12/14: party 2, one entry, 14/14, purchase_repeat and booking_confirmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      await fill(db, f, eventId, 12)

      const r = await approveAs(
        db,
        f,
        pinnedInput(f, f.couple, eventId, { customerId: f.customerA })
      )
      expect(r).toMatchObject({
        customer_id: f.customerA,
        event_id: eventId,
        booking_id: expect.any(String),
      })

      const { rows: booking } = await db.query(
        "select customer_id, party_size from public.bookings where id = $1",
        [r.booking_id]
      )
      expect(booking).toEqual([{ customer_id: f.customerA, party_size: 2 }])
      expect(await movements(db, r.entitlement_id as string)).toEqual([
        { action: "grant", units: 1, booking_id: null },
        { action: "reserve", units: -1, booking_id: r.booking_id },
      ])
      expect(await occupied(db, eventId)).toBe(14)

      const { rows: notifications } = await db.query(
        "select type, dedupe_key from public.notifications where recipient_id = $1 order by type",
        [f.customerA]
      )
      expect(notifications).toEqual([
        {
          type: "booking_confirmed",
          dedupe_key: `booking_confirmed:${f.customerA}:${r.booking_id}`,
        },
        {
          type: "purchase_repeat",
          dedupe_key: `purchase_repeat:${f.customerA}:${r.payment_id}`,
        },
      ])
    })
  })

  it("the same key twice returns the same result with one booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const input = pinnedInput(f, f.single, eventId, {
        customerId: f.customerA,
      })
      const first = await approveAs(db, f, input)
      const second = await approveAs(db, f, input)
      expect(second).toEqual(first)
      expect(await createdFor(db, f.single)).toEqual({
        payments: 1,
        bookings: 1,
      })
    })
  })
})

describe("refusals create nothing", () => {
  it("a pinned product without a session -> PINNED_EVENT_REQUIRED; a session for a card -> EVENT_NOT_ALLOWED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      expect(
        await approveError(db, f, pinnedInput(f, f.single, null))
      ).toMatchObject({ code: "P0001", message: "PINNED_EVENT_REQUIRED" })
      expect(await previewError(db, f, null, f.single, null)).toMatchObject({
        message: "PINNED_EVENT_REQUIRED",
      })
      expect(
        await approveError(db, f, {
          ...pinnedInput(f, f.card, eventId),
          amount: 47200,
        })
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_ALLOWED" })
      expect(await createdFor(db, f.single)).toEqual({
        payments: 0,
        bookings: 0,
      })
      expect(await createdFor(db, f.card)).toEqual({ payments: 0, bookings: 0 })
    })
  })

  it.each([
    ["a couple for a regular session", "couple", "regular", "EVENT_NOT_FIT"],
    ["a draft", "single", "draft", "EVENT_NOT_BOOKABLE"],
    ["a session that started", "single", "started", "EVENT_NOT_BOOKABLE"],
    ["an unknown session", "single", "unknown", "EVENT_NOT_BOOKABLE"],
  ] as const)("%s -> %s", async (_label, product, session, code) => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const productId = product === "couple" ? f.couple : f.single
      const eventId =
        session === "unknown"
          ? randomUUID()
          : await insertEvent(
              db,
              f,
              session === "draft"
                ? { status: "draft" }
                : // now() is the transaction's start: this one starts "now".
                  session === "started"
                  ? { days: 0 }
                  : {}
            )
      {
        expect(
          await approveError(db, f, pinnedInput(f, productId, eventId)),
          `${code} ${eventId}`
        ).toMatchObject({ code: "P0001", message: code })
        expect(
          await previewError(db, f, null, productId, eventId)
        ).toMatchObject({ code: "P0001", message: code })
      }
      expect(await createdFor(db, f.single)).toEqual({
        payments: 0,
        bookings: 0,
      })
      expect(await createdFor(db, f.couple)).toEqual({
        payments: 0,
        bookings: 0,
      })
    })
  })

  it("a couple with one free place -> EVENT_FULL", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { kind: "couple" })
      await fill(db, f, eventId, 13)
      expect(
        await approveError(db, f, pinnedInput(f, f.couple, eventId))
      ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
      expect(await previewError(db, f, null, f.couple, eventId)).toMatchObject({
        message: "EVENT_FULL",
      })
      expect(await createdFor(db, f.couple)).toEqual({
        payments: 0,
        bookings: 0,
      })
      expect(await occupied(db, eventId)).toBe(13)
    })
  })

  it("an existing customer already booked to the session -> CUSTOMER_ALREADY_BOOKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer', ${SNAPSHOT})`,
        [f.customerA, eventId]
      )
      expect(
        await approveError(
          db,
          f,
          pinnedInput(f, f.single, eventId, { customerId: f.customerA })
        )
      ).toMatchObject({ code: "P0001", message: "CUSTOMER_ALREADY_BOOKED" })
      expect(
        await previewError(db, f, f.customerA, f.single, eventId)
      ).toMatchObject({ message: "CUSTOMER_ALREADY_BOOKED" })
      expect(await createdFor(db, f.single)).toEqual({
        payments: 0,
        bookings: 0,
      })
    })
  })

  it("an intro for a customer who took part, or who has an active intro -> INTRO_NOT_ELIGIBLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const other = await insertEvent(db, f, { days: 14 })

      // Customer A took part: a confirmed booking for a session that ended
      // (a no-show counts).
      const past = await insertEvent(db, f, { days: -3 })
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer', ${SNAPSHOT})`,
        [f.customerA, past]
      )
      // Customer B has an active intro (approved for another session).
      await approveAs(
        db,
        f,
        pinnedInput(f, f.intro, other, { customerId: f.customerB })
      )

      for (const customerId of [f.customerA, f.customerB]) {
        expect(
          await approveError(
            db,
            f,
            pinnedInput(f, f.intro, eventId, { customerId })
          ),
          customerId
        ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
        expect(
          await previewError(db, f, customerId, f.intro, eventId)
        ).toMatchObject({ message: "INTRO_NOT_ELIGIBLE" })
      }
      expect(await createdFor(db, f.intro)).toEqual({
        payments: 1,
        bookings: 1,
      })
    })
  })

  it("a cancelled booking does not count as taking part", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const past = await insertEvent(db, f, { days: -3 })
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, status, cancelled_at, booked_by,
           policy_snapshot)
         values ($1, $2, 1, 'cancelled', now(), 'customer', ${SNAPSHOT})`,
        [f.customerA, past]
      )
      const r = await approveAs(
        db,
        f,
        pinnedInput(f, f.intro, eventId, { customerId: f.customerA })
      )
      expect(r.booking_id).toEqual(expect.any(String))
    })
  })
})

describe("joining", () => {
  it("the new customer gets the booking, the entitlement and the payment, with one booking_confirmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const r = await approveAs(db, f, pinnedInput(f, f.single, eventId))

      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerA,
      ])

      for (const [table, column] of [
        ["payments", "id"],
        ["entitlements", "payment_id"],
        ["bookings", "payment_id"],
      ]) {
        const { rows } = await db.query(
          `select customer_id from public.${table} where ${column} = $1`,
          [r.payment_id]
        )
        expect(rows, table).toEqual([{ customer_id: f.customerA }])
      }
      const { rows: notifications } = await db.query(
        "select dedupe_key from public.notifications where recipient_id = $1 and type = 'booking_confirmed'",
        [f.customerA]
      )
      expect(notifications).toEqual([
        { dedupe_key: `booking_confirmed:${f.customerA}:${r.booking_id}` },
      ])
      expect(await occupied(db, eventId)).toBe(1)
    })
  })
})

describe("park (the core called as an online purchase)", () => {
  it("a full session keeps the payment and the entitlement without a booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 2 })
      await fill(db, f, eventId, 2)

      const { rows } = await db.query(
        `select private.approve_payment_core(
           'online', null, 'system', null, $1, $2, 12800, null, $3::date,
           null, null, null, 'test_provider', $4, 'park') as id`,
        [f.single, eventId, f.today, testName("tx")]
      )
      const paymentId = rows[0].id
      expect(paymentId).toEqual(expect.any(String))

      const { rows: entitlements } = await db.query(
        "select id, pinned_event_id from public.entitlements where payment_id = $1",
        [paymentId]
      )
      expect(entitlements).toEqual([
        { id: expect.any(String), pinned_event_id: eventId },
      ])
      expect(
        await count(db, "select 1 from public.bookings where payment_id = $1", [
          paymentId,
        ])
      ).toBe(0)
      expect(await movements(db, entitlements[0].id)).toEqual([
        { action: "grant", units: 1, booking_id: null },
      ])
      expect(await occupied(db, eventId)).toBe(2)
    })
  })

  it("'raise' through the same core throws EVENT_FULL", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      await fill(db, f, eventId, 1)
      expect(
        await queryError(
          db,
          `select private.approve_payment_core(
             'online', null, 'system', null, $1, $2, 12800, null, $3::date,
             null, null, null, 'test_provider', $4, 'raise')`,
          [f.single, eventId, f.today, testName("tx")]
        )
      ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
    })
  })
})

describe("admin_list_bookable_events", () => {
  it("lists published sessions that have not started, with places taken and capacity", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const open = await insertEvent(db, f, { capacity: 12 })
      const draft = await insertEvent(db, f, { status: "draft" })
      const past = await insertEvent(db, f, { days: -3 })
      await fill(db, f, open, 3)

      await asAuthenticated(db, f.admin)
      const { rows } = await db.query(LIST)
      await db.query("reset role")
      const list = rows[0].r as Array<Record<string, unknown>>
      const ids = list.map((e) => e.id)
      expect(ids).toContain(open)
      expect(ids).not.toContain(draft)
      expect(ids).not.toContain(past)
      expect(list.find((e) => e.id === open)).toMatchObject({
        kind: "regular",
        occupied: 3,
        capacity: 12,
        concept_name: expect.any(String),
        weekday: expect.any(Number),
        starts_at: expect.any(String),
      })
    })
  })

  it("a customer gets NOT_AUTHORIZED and anon 42501", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customerA)
      expect(await queryError(db, LIST)).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
      await db.query("reset role")
      await db.query("set local role anon")
      expect((await queryError(db, LIST))?.code).toBe("42501")
    })
  })
})

// Review of 3.11.
describe("weekdays, the session list's weekday and the intro rule", () => {
  // The local weekday (0 = Sunday) of a session.
  async function weekdayOf(db: Db, eventId: string): Promise<number> {
    const { rows } = await db.query(
      `select extract(dow from (starts_at at time zone 'Asia/Jerusalem'))::int as d
       from public.events where id = $1`,
      [eventId]
    )
    return rows[0].d
  }

  async function pinnedOn(db: Db, label: string, weekdays: number[]) {
    const { rows } = await db.query(
      `insert into public.products (
         name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, 'single', 12800, 1, 'session', null, $2::smallint[],
         'regular', 1)
       returning id`,
      [testName(label), weekdays]
    )
    return rows[0].id as string
  }

  async function tookPart(
    db: Db,
    f: Fixture,
    customerId: string,
    status: "confirmed" | "completed"
  ) {
    const past = await insertEvent(db, f, { days: -3 })
    await db.query(
      `insert into public.bookings (
         customer_id, event_id, party_size, status, booked_by, policy_snapshot)
       values ($1, $2, 1, $3, 'customer', ${SNAPSHOT})`,
      [customerId, past, status]
    )
  }

  it("a session on a weekday the product does not allow -> EVENT_NOT_FIT, nothing created; an allowed one is placed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const day = await weekdayOf(db, eventId)
      const other = await pinnedOn(db, "other_day", [(day + 1) % 7])
      const same = await pinnedOn(db, "same_day", [day])

      expect(
        await approveError(db, f, pinnedInput(f, other, eventId))
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_FIT" })
      expect(await previewError(db, f, null, other, eventId)).toMatchObject({
        code: "P0001",
        message: "EVENT_NOT_FIT",
      })
      expect(await createdFor(db, other)).toEqual({ payments: 0, bookings: 0 })

      const r = await approveAs(db, f, pinnedInput(f, same, eventId))
      expect(r.booking_id).toEqual(expect.any(String))
      expect(await createdFor(db, same)).toEqual({ payments: 1, bookings: 1 })
    })
  })

  it("admin_list_bookable_events gives the session's local weekday", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { days: 9 })
      await asAuthenticated(db, f.admin)
      const { rows } = await db.query(LIST)
      await db.query("reset role")
      const row = (rows[0].r as Array<Record<string, unknown>>).find(
        (e) => e.id === eventId
      )
      expect(row?.weekday).toBe(await weekdayOf(db, eventId))
    })
  })

  it("a customer whose only booking is completed took part: INTRO_NOT_ELIGIBLE at approval and preview, BIND_CONFLICT at the bind", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      await tookPart(db, f, f.customerA, "completed")

      expect(
        await approveError(
          db,
          f,
          pinnedInput(f, f.intro, eventId, { customerId: f.customerA })
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      expect(
        await previewError(db, f, f.customerA, f.intro, eventId)
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })

      const r = await approveAs(db, f, pinnedInput(f, f.intro, eventId))
      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          r.payment_id,
          f.customerA,
        ])
      ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })
      const { rows } = await db.query(
        "select customer_id from public.bookings where payment_id = $1",
        [r.payment_id]
      )
      expect(rows).toEqual([{ customer_id: null }])
    })
  })

  it("an intro_only product of days for a customer who took part -> INTRO_NOT_ELIGIBLE, nothing created", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows } = await db.query(
        `insert into public.products (
           name, type, price_agorot, units, validity_mode, validity_days,
           allowed_weekdays, eligible_event_kind, party_size, intro_only)
         values ($1, 'single', 11800, 1, 'days', 30, null, 'regular', 1, true)
         returning id`,
        [testName("intro_days")]
      )
      const introDays = rows[0].id as string
      await tookPart(db, f, f.customerA, "confirmed")

      expect(
        await approveError(
          db,
          f,
          pinnedInput(f, introDays, null, {
            customerId: f.customerA,
            amount: 11800,
          })
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      await asAuthenticated(db, f.admin)
      const error = await queryError(db, PREVIEW, [
        f.customerA,
        introDays,
        null,
        11800,
        f.today,
        f.method,
      ])
      await db.query("reset role")
      expect(error).toMatchObject({
        code: "P0001",
        message: "INTRO_NOT_ELIGIBLE",
      })
      expect(await createdFor(db, introDays)).toEqual({
        payments: 0,
        bookings: 0,
      })
    })
  })
})

// An intro only for a customer without bookings (user decision 2026-10-05).
describe("an intro needs a customer without bookings", () => {
  it("a customer with only a future confirmed booking -> INTRO_NOT_ELIGIBLE at approval and preview, nothing created; joining with an intro link -> BIND_CONFLICT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const future = await insertEvent(db, f, { days: 14 })
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer', ${SNAPSHOT})`,
        [f.customerA, future]
      )

      expect(
        await approveError(
          db,
          f,
          pinnedInput(f, f.intro, eventId, { customerId: f.customerA })
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      expect(
        await previewError(db, f, f.customerA, f.intro, eventId)
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      expect(await createdFor(db, f.intro)).toEqual({
        payments: 0,
        bookings: 0,
      })

      const r = await approveAs(db, f, pinnedInput(f, f.intro, eventId))
      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          r.payment_id,
          f.customerA,
        ])
      ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })
      const { rows } = await db.query(
        "select customer_id from public.bookings where payment_id = $1",
        [r.payment_id]
      )
      expect(rows).toEqual([{ customer_id: null }])
    })
  })

  it("a customer whose only booking was cancelled gets the intro, at approval and by joining", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const future = await insertEvent(db, f, { days: 14 })
      for (const customerId of [f.customerA, f.customerB]) {
        await db.query(
          `insert into public.bookings (
             customer_id, event_id, party_size, status, cancelled_at,
             booked_by, policy_snapshot)
           values ($1, $2, 1, 'cancelled', now(), 'customer', ${SNAPSHOT})`,
          [customerId, future]
        )
      }

      const existing = await approveAs(
        db,
        f,
        pinnedInput(f, f.intro, await insertEvent(db, f), {
          customerId: f.customerA,
        })
      )
      expect(existing.booking_id).toEqual(expect.any(String))

      const link = await approveAs(
        db,
        f,
        pinnedInput(f, f.intro, await insertEvent(db, f, { days: 9 }))
      )
      await db.query("select private.bind_purchase($1, $2)", [
        link.payment_id,
        f.customerB,
      ])
      const { rows } = await db.query(
        "select customer_id from public.bookings where payment_id = $1",
        [link.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.customerB }])
    })
  })

  it("a new customer joins with her intro: her own pinned booking does not block the bind", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await approveAs(
        db,
        f,
        pinnedInput(f, f.intro, await insertEvent(db, f))
      )
      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerA,
      ])
      const { rows } = await db.query(
        "select customer_id from public.entitlements where payment_id = $1",
        [r.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.customerA }])
    })
  })

  it("an intro for a couple session -> EVENT_NOT_FIT, nothing created", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const couple = await insertEvent(db, f, { kind: "couple" })
      expect(
        await approveError(db, f, pinnedInput(f, f.intro, couple))
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_FIT" })
      expect(await previewError(db, f, null, f.intro, couple)).toMatchObject({
        code: "P0001",
        message: "EVENT_NOT_FIT",
      })
      expect(await createdFor(db, f.intro)).toEqual({
        payments: 0,
        bookings: 0,
      })
    })
  })
})

// The join page names a pinned purchase by its session (user decision
// 2026-10-05).
describe("token_view of a pinned purchase", () => {
  it("returns the session's start and concept; a card's link returns none", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const pinned = await approveAs(db, f, pinnedInput(f, f.single, eventId))
      const card = await approveAs(db, f, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        duplicateConfirmed: true,
        key: randomUUID(),
      })
      const { rows: event } = await db.query(
        `select e.starts_at, c.name from public.events e
         join public.concepts c on c.id = e.concept_id where e.id = $1`,
        [eventId]
      )

      await asServiceRole(db)
      const view = async (token: unknown) =>
        (await db.query("select public.token_view($1) as r", [token])).rows[0].r
      const ofPinned = await view(pinned.token)
      const ofCard = await view(card.token)
      await db.query("reset role")

      expect(ofPinned).toMatchObject({
        state_public: "active",
        concept_name: event[0].name,
        amount_agorot: 12800,
      })
      expect(new Date(ofPinned.session_starts_at).getTime()).toBe(
        new Date(event[0].starts_at).getTime()
      )
      expect(ofCard).toMatchObject({
        session_starts_at: null,
        concept_name: null,
      })
    })
  })
})
