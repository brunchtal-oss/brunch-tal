// Story 4.2: the customers list and the customer card. admin_list_customers
// (search through private.customer_matches, the last-activity range filter,
// who is listed), admin_get_customer (the card, balances equal to
// entitlement_balances and to the customer's own /me), the internal notes
// (add and delete, idempotent, the body masked in the audit, never visible
// to the customer) and customer_id on the home's expiring cards. One test
// per row of the spec's I/O matrix. The dev database may hold other rows, so
// every check looks only at this test's ids. Everything runs in inRollback.

import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  insertAuthUser,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const LIST = "select public.admin_list_customers($1) as r"
const GET = "select public.admin_get_customer($1) as r"
const ADD = "select public.admin_add_customer_note($1, $2, $3) as r"
const DELETE = "select public.admin_delete_customer_note($1, $2) as r"
const HOME = "select public.admin_get_home() as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type ListRow = {
  id: string
  full_name: string
  phone_e164: string | null
  activated: boolean
  last_activity_on: string | null
}
type List = { customers: ListRow[]; has_more: boolean }

type Fixture = MoneyFixture & { concept: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows } = await db.query(
    "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  return { ...f, concept: rows[0].id }
}

// Seven digits without "555" (no 5 at all), so "555" never finds her.
function randomPhone(): { digits: string; local: string; e164: string } {
  const pool = "012346789"
  const digits = Array.from(
    { length: 7 },
    () => pool[randomInt(pool.length)]
  ).join("")
  return { digits, local: `054${digits}`, e164: `+97254${digits}` }
}

// As the owner: a customer profile (activated unless told otherwise).
async function insertCustomer(
  db: Db,
  label: string,
  options: { phone?: string; activated?: boolean; id?: string } = {}
): Promise<string> {
  const id = options.id ?? randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, phone_e164, activated_at)
     values ($1, $2, $3, case when $4 then now() end)`,
    [id, testName(label), options.phone ?? null, options.activated ?? true]
  )
  return id
}

// As the owner: a published session starting at `startsAt` (2 hours).
async function insertEvent(
  db: Db,
  f: Fixture,
  startsAt: string
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', $2::timestamptz, $2::timestamptz + interval '2 hours',
       12, $2::timestamptz - interval '1 day', 'published')
     returning id`,
    [f.concept, startsAt]
  )
  return rows[0].id
}

// As the owner: a booking of hers, created at `createdAt`.
async function insertBooking(
  db: Db,
  customerId: string,
  eventId: string,
  createdAt: string,
  status: "confirmed" | "completed" = "confirmed"
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, booked_by, policy_snapshot,
       status, created_at)
     values ($1, $2, 1, 'admin', ${SNAPSHOT}, $3, $4::timestamptz)
     returning id`,
    [customerId, eventId, status, createdAt]
  )
  return rows[0].id
}

// Like queryError, with the exception's DETAIL parsed (the field the list
// screen words), as in profile.test.ts.
async function raised(
  db: Db,
  text: string,
  params: unknown[] = []
): Promise<{ code: string; message: string; detail: unknown } | null> {
  await db.query("savepoint raised")
  try {
    await db.query(text, params)
  } catch (error) {
    await db.query("rollback to savepoint raised")
    const { code, message, detail } = error as {
      code: string
      message: string
      detail?: string
    }
    return { code, message, detail: detail ? JSON.parse(detail) : null }
  }
  await db.query("release savepoint raised")
  return null
}

async function asAdmin<T>(db: Db, f: Fixture, run: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function list(db: Db, f: Fixture, query: string | null): Promise<List> {
  return asAdmin(db, f, async () => (await db.query(LIST, [query])).rows[0].r)
}

async function ids(
  db: Db,
  f: Fixture,
  query: string | null
): Promise<string[]> {
  return (await list(db, f, query)).customers.map((c) => c.id)
}

async function card(db: Db, f: Fixture, customerId: string) {
  return asAdmin(
    db,
    f,
    async () => (await db.query(GET, [customerId])).rows[0].r
  )
}

// As the admin: a card for the customer, paid on `paidOn`.
async function grant(
  db: Db,
  f: Fixture,
  customerId: string,
  paidOn: string = f.today
): Promise<{ entitlement: string; payment: string }> {
  const r = await asAdmin(db, f, () =>
    approve(db, {
      customerId,
      productId: f.card,
      amount: 47200,
      paidOn,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return { entitlement: rows[0].id, payment: r.payment_id as string }
}

describe("admin_list_customers: search", () => {
  it("finds by part of the name; empty or one character is an empty list", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const roni = await insertCustomer(db, "רוני כהן")
      const ronit = await insertCustomer(db, "רונית לוי")
      const dana = await insertCustomer(db, "דנה")

      const part = await ids(db, f, testName("רונ"))
      expect(part).toEqual(expect.arrayContaining([roni, ronit]))
      expect(part).not.toContain(dana)
      expect(await ids(db, f, testName("רוני"))).toEqual(
        expect.arrayContaining([roni, ronit])
      )
      // Any case.
      expect(await ids(db, f, testName("רוני").toUpperCase())).toEqual(
        expect.arrayContaining([roni, ronit])
      )

      // Nothing until she types 2 characters (phone check, 2026-10-07).
      for (const query of ["ר", " ר ", "", "   ", null]) {
        expect(await list(db, f, query), String(query)).toEqual({
          customers: [],
          has_more: false,
        })
      }
    })
  })

  it("finds the phone in any format, and a run of its digits", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const phone = randomPhone()
      const roni = await insertCustomer(db, "roni_phone", { phone: phone.e164 })

      for (const query of [
        `${phone.local.slice(0, 3)}-${phone.local.slice(3, 6)}-${phone.local.slice(6)}`,
        phone.local,
        phone.e164,
        phone.digits,
        // A partial local-form prefix ("054…").
        phone.local.slice(0, 6),
      ]) {
        expect(await ids(db, f, query), query).toContain(roni)
      }
      expect(await ids(db, f, "555")).not.toContain(roni)
    })
  })

  it("over 100 characters -> INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await raised(db, LIST, ["x".repeat(101)])).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "query" },
      })
      expect(await queryError(db, LIST, [` ${"x".repeat(100)} `])).toBeNull()
    })
  })

  it("returns 200 rows and has_more when there are more", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        `insert into public.profiles (id, full_name, activated_at)
         select gen_random_uuid(), $1 || lpad(g::text, 3, '0'), now()
         from generate_series(1, 201) g`,
        [testName("bulk_")]
      )
      const many = await list(db, f, testName("bulk_"))
      expect(many.customers).toHaveLength(200)
      expect(many.has_more).toBe(true)
      // By name when no one has activity.
      expect(many.customers[0].full_name).toBe(`${testName("bulk_")}001`)

      const few = await list(db, f, testName("bulk_00"))
      expect(few.customers).toHaveLength(9)
      expect(few.has_more).toBe(false)
    })
  })
})

describe("admin_list_customers: order", () => {
  it("by last activity (latest first), no activity last, with the row's fields", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-10-20T10:00:00+03:00")
      const early = await insertCustomer(db, "order_early")
      const late = await insertCustomer(db, "order_late")
      const none = await insertCustomer(db, "order_none")
      await insertBooking(db, early, event, "2026-10-01T12:00:00+03:00")
      await insertBooking(db, late, event, "2026-10-05T12:00:00+03:00")
      const q = testName("order_")

      expect(await ids(db, f, q)).toEqual([late, early, none])
      const rows = (await list(db, f, q)).customers
      expect(rows.find((r) => r.id === late)).toEqual({
        id: late,
        full_name: testName("order_late"),
        phone_e164: null,
        activated: true,
        last_activity_on: "2026-10-05",
      })
      expect(rows.find((r) => r.id === none)?.last_activity_on).toBeNull()
    })
  })
})

describe("private.customer_last_activity_on", () => {
  it("the latest of participation, purchase and booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const customer = await insertCustomer(db, "activity")
      // Participation 20.09 (booked 01.09), purchase 01.10, a booking made
      // 03.10 for a later session.
      const past = await insertEvent(db, f, "2026-09-20T10:00:00+03:00")
      const later = await insertEvent(db, f, "2026-11-20T10:00:00+03:00")
      await insertBooking(
        db,
        customer,
        past,
        "2026-09-01T12:00:00+03:00",
        "completed"
      )
      const at = async () =>
        (
          await db.query(
            "select private.customer_last_activity_on($1)::text as d",
            [customer]
          )
        ).rows[0].d

      expect(await at()).toBe("2026-09-20")
      await grant(db, f, customer, "2026-10-01")
      expect(await at()).toBe("2026-10-01")
      await insertBooking(db, customer, later, "2026-10-03T10:00:00+03:00")
      expect(await at()).toBe("2026-10-03")
      expect((await card(db, f, customer)).profile.last_activity_on).toBe(
        "2026-10-03"
      )
    })
  })

  it("a booking's day in Asia/Jerusalem, and null without activity", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-20T10:00:00+03:00")
      const lateNight = await insertCustomer(db, "late_night")
      const afterMidnight = await insertCustomer(db, "after_midnight")
      const nothing = await insertCustomer(db, "nothing")
      // 23:30 on 02.10 in Israel; 00:30 on 03.10 in Israel is 02.10 in UTC.
      await insertBooking(db, lateNight, event, "2026-10-02T23:30:00+03:00")
      await insertBooking(db, afterMidnight, event, "2026-10-02T21:30:00Z")
      const { rows } = await db.query(
        `select private.customer_last_activity_on($1)::text as a,
                private.customer_last_activity_on($2)::text as b,
                private.customer_last_activity_on($3)::text as c`,
        [lateNight, afterMidnight, nothing]
      )
      expect(rows[0]).toEqual({ a: "2026-10-02", b: "2026-10-03", c: null })
    })
  })
})

describe("who is a customer", () => {
  it("lists a customer who is not activated, never an admin or an anonymized one", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const admin = await insertCustomer(db, "who_admin")
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        admin,
      ])
      const anonymized = await insertCustomer(db, "who_anonymized")
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [anonymized]
      )
      const pending = await insertCustomer(db, "who_pending", {
        activated: false,
      })

      const rows = (await list(db, f, testName("who_"))).customers
      expect(rows.map((r) => r.id)).toEqual([pending])
      expect(rows[0].activated).toBe(false)

      await asAuthenticated(db, f.admin)
      for (const id of [admin, anonymized, randomUUID()]) {
        expect(await queryError(db, GET, [id]), id).toMatchObject({
          code: "P0001",
          message: "NOT_FOUND",
        })
      }
      expect(await queryError(db, GET, [pending])).toBeNull()
    })
  })
})

describe("admin_get_customer", () => {
  it("returns the profile with the email, babies, bookings, payments and notes, without notifications", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const user = await insertAuthUser(db, "card_customer")
      const phone = randomPhone()
      const customer = await insertCustomer(db, "card_customer", {
        id: user.id,
        phone: phone.e164,
      })
      await db.query(
        `update public.profiles
         set dietary_notes = 'בלי גלוטן', photo_consent = true,
             photo_consent_at = now(), personal_photo_consent = false
         where id = $1`,
        [customer]
      )
      await db.query(
        `insert into public.babies (customer_id, name, birth_date)
         values ($1, 'נועה', '2026-06-01'), ($1, 'אורי', '2026-05-01')`,
        [customer]
      )
      const old = await insertEvent(db, f, "2026-09-20T10:00:00+03:00")
      const next = await insertEvent(db, f, "2026-11-20T10:00:00+03:00")
      const oldBooking = await insertBooking(
        db,
        customer,
        old,
        "2026-09-01T12:00:00+03:00",
        "completed"
      )
      const nextBooking = await insertBooking(
        db,
        customer,
        next,
        "2026-10-03T12:00:00+03:00"
      )
      const paid = await grant(db, f, customer, "2026-10-01")
      await db.query(
        "select private.enqueue_notification($1, 'purchase_new_card', $2, null, '/me', null)",
        [customer, testName("notif")]
      )
      await asAdmin(db, f, () =>
        db.query(ADD, [customer, "מעדיפה שולחן ליד החלון", randomUUID()])
      )

      const r = await card(db, f, customer)
      expect(r.profile).toMatchObject({
        id: customer,
        full_name: testName("card_customer"),
        phone_e164: phone.e164,
        email: user.email,
        activated_at: expect.any(String),
        created_at: expect.any(String),
        dietary_notes: "בלי גלוטן",
        photo_consent: true,
        photo_consent_at: expect.any(String),
        personal_photo_consent: false,
        personal_photo_consent_at: null,
        last_activity_on: "2026-10-03",
      })
      expect(r.babies).toEqual([
        { name: "אורי", birth_date: "2026-05-01" },
        { name: "נועה", birth_date: "2026-06-01" },
      ])
      expect(
        r.bookings.map((b: { booking_id: string }) => b.booking_id)
      ).toEqual([nextBooking, oldBooking])
      expect(r.bookings[0]).toEqual({
        booking_id: nextBooking,
        event_id: next,
        concept_name: expect.any(String),
        starts_at: expect.any(String),
        status: "confirmed",
        party_size: 1,
        created_at: expect.any(String),
      })
      expect(r.payments).toEqual([
        {
          payment_id: paid.payment,
          product_name: testName("card"),
          amount_agorot: 47200,
          paid_on: "2026-10-01",
          payment_method_name: testName("method"),
          status: "approved",
        },
      ])
      // Notifications left the card (phone check, 2026-10-07).
      expect(r).not.toHaveProperty("notifications")
      expect(Object.keys(r).sort()).toEqual([
        "babies",
        "bookings",
        "entitlements",
        "notes",
        "payments",
        "profile",
      ])
      expect(r.notes).toEqual([
        {
          id: expect.any(String),
          body: "מעדיפה שולחן ליד החלון",
          created_at: expect.any(String),
        },
      ])
    })
  })

  it("the balances are the rows of entitlement_balances and match the customer's own get_my_entitlements", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const customer = f.customerA
      const a = await grant(db, f, customer)
      // Three sessions booked by her; two of them used (the session ended).
      const bookings: string[] = []
      for (const days of [7, 8, 9]) {
        const { rows } = await db.query(
          "select (now() + make_interval(days => $1::int))::text as at",
          [days]
        )
        const event = await insertEvent(db, f, rows[0].at)
        await asAuthenticated(db, customer)
        const { rows: booked } = await db.query(
          "select public.book_session($1, $2) as r",
          [event, randomUUID()]
        )
        await db.query("reset role")
        bookings.push(booked[0].r.booking_id)
      }
      for (const booking of bookings.slice(0, 2)) {
        await db.query(
          `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
           values ($1, $2, 'use', 0)`,
          [a.entitlement, booking]
        )
      }
      // A second card that already expired.
      const expired = await grant(db, f, customer)
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date - 1,
             valid_from = (now() at time zone 'Asia/Jerusalem')::date - 30
         where id = $1`,
        [expired.entitlement]
      )

      const r = await card(db, f, customer)
      type Ent = Record<string, unknown> & { entitlement_id: string }
      const rows = r.entitlements as Ent[]
      const byId = (id: string) => rows.find((e) => e.entitlement_id === id)!
      expect(byId(a.entitlement)).toMatchObject({
        kind: "card",
        status: "active",
        product_name: testName("card"),
        original_units: 4,
        available: 1,
        reserved: 1,
        used: 2,
        is_expired: false,
        is_used_up: false,
        pinned_event_id: null,
      })
      expect(byId(expired.entitlement)).toMatchObject({
        is_expired: true,
        is_expiring: false,
      })

      const { rows: balances } = await db.query(
        `select entitlement_id, kind, status, original_units, available,
                reserved, used, expires_on::text as expires_on, is_expired
         from public.entitlement_balances
         where customer_id = $1
         order by expires_on, entitlement_id`,
        [customer]
      )
      expect(
        rows.map((e) => ({
          entitlement_id: e.entitlement_id,
          kind: e.kind,
          status: e.status,
          original_units: e.original_units,
          available: e.available,
          reserved: e.reserved,
          used: e.used,
          expires_on: e.expires_on,
          is_expired: e.is_expired,
        }))
      ).toEqual(balances)

      // The same balances as her own /me.
      await asAuthenticated(db, customer)
      const mine = (await db.query("select public.get_my_entitlements() as r"))
        .rows[0].r as Ent[]
      await db.query("reset role")
      const shared = [
        "entitlement_id",
        "kind",
        "status",
        "product_name",
        "original_units",
        "available",
        "reserved",
        "used",
        "expires_on",
        "is_expired",
        "days_left",
        "is_used_up",
        "pinned_event_id",
      ]
      const pick = (e: Ent) =>
        Object.fromEntries(shared.map((key) => [key, e[key]]))
      expect(rows.map(pick)).toEqual(mine.map(pick))
    })
  })

  it("each card lists its entries from booking_allocations by date, without a cancelled booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const customer = f.customerA
      const a = await grant(db, f, customer)
      const events: string[] = []
      const bookings: string[] = []
      for (const days of [9, 7, 8]) {
        const { rows } = await db.query(
          "select (now() + make_interval(days => $1::int))::text as at",
          [days]
        )
        const event = await insertEvent(db, f, rows[0].at)
        await asAuthenticated(db, customer)
        const { rows: booked } = await db.query(
          "select public.book_session($1, $2) as r",
          [event, randomUUID()]
        )
        await db.query("reset role")
        events.push(event)
        bookings.push(booked[0].r.booking_id)
      }
      // As the owner: day 7 completed, day 9 cancelled, day 8 confirmed.
      await db.query(
        "update public.bookings set status = 'completed' where id = $1",
        [bookings[1]]
      )
      await db.query(
        "update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1",
        [bookings[0]]
      )

      const r = await card(db, f, customer)
      const row = r.entitlements.find(
        (e: { entitlement_id: string }) => e.entitlement_id === a.entitlement
      )
      expect(row.entries).toEqual([
        {
          status: "completed",
          starts_at: expect.any(String),
          concept_name: expect.any(String),
          event_id: events[1],
        },
        {
          status: "confirmed",
          starts_at: expect.any(String),
          concept_name: expect.any(String),
          event_id: events[2],
        },
      ])
    })
  })

  it("is_expiring by admin_expiring_days", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.business_settings set admin_expiring_days = 5"
      )
      const a = await grant(db, f, f.customerA)
      const setEnd = (days: number) =>
        db.query(
          `update public.entitlements
           set expires_on = (now() at time zone 'Asia/Jerusalem')::date + $2::int
           where id = $1`,
          [a.entitlement, days]
        )
      await setEnd(5)
      expect((await card(db, f, f.customerA)).entitlements[0]).toMatchObject({
        days_left: 5,
        is_expiring: true,
      })
      await setEnd(6)
      expect((await card(db, f, f.customerA)).entitlements[0].is_expiring).toBe(
        false
      )
    })
  })
})

describe("internal notes", () => {
  it("one row and one audit entry for the same key, without the body", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const body = "  הערה פנימית  "
      const first = await asAdmin(
        db,
        f,
        async () => (await db.query(ADD, [f.customerA, body, key])).rows[0].r
      )
      const again = await asAdmin(
        db,
        f,
        async () => (await db.query(ADD, [f.customerA, body, key])).rows[0].r
      )
      expect(first).toEqual({ note_id: expect.any(String) })
      expect(again).toEqual(first)

      const { rows: notes } = await db.query(
        "select body, created_by from public.customer_notes where customer_id = $1",
        [f.customerA]
      )
      expect(notes).toEqual([{ body: "הערה פנימית", created_by: f.admin }])

      const { rows: audit } = await db.query(
        `select action, entity_type, customer_id, after from public.audit_log
         where entity_id = $1`,
        [first.note_id]
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        action: "admin_add_customer_note",
        entity_type: "customer_notes",
        customer_id: f.customerA,
      })
      expect(audit[0].after.body).toBe("<changed>")
      expect(JSON.stringify(audit[0])).not.toContain("הערה פנימית")
    })
  })

  it("empty or over 1000 characters -> INVALID_INPUT; not a customer -> NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const body of ["", "   ", null, "x".repeat(1001)]) {
        expect(
          await queryError(db, ADD, [f.customerA, body, randomUUID()]),
          String(body).slice(0, 10)
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      expect(
        await queryError(db, ADD, [f.customerA, "x".repeat(1000), randomUUID()])
      ).toBeNull()
      for (const id of [randomUUID(), f.admin]) {
        expect(
          await queryError(db, ADD, [id, "הערה", randomUUID()])
        ).toMatchObject({ code: "P0001", message: "NOT_FOUND" })
      }
    })
  })

  it("deletes once; the same key returns the same result, a new key NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { note_id: noteId } = await asAdmin(
        db,
        f,
        async () =>
          (await db.query(ADD, [f.customerA, "למחיקה", randomUUID()])).rows[0].r
      )
      const key = randomUUID()
      const deleted = await asAdmin(
        db,
        f,
        async () => (await db.query(DELETE, [noteId, key])).rows[0].r
      )
      expect(deleted).toEqual({ note_id: noteId })
      expect(
        await asAdmin(
          db,
          f,
          async () => (await db.query(DELETE, [noteId, key])).rows[0].r
        )
      ).toEqual(deleted)
      await asAuthenticated(db, f.admin)
      expect(
        await queryError(db, DELETE, [noteId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "NOT_FOUND" })
      await db.query("reset role")

      const { rows } = await db.query(
        "select count(*)::int as n from public.customer_notes where id = $1",
        [noteId]
      )
      expect(rows[0].n).toBe(0)
      const { rows: audit } = await db.query(
        `select before, after from public.audit_log
         where entity_id = $1 and action = 'admin_delete_customer_note'`,
        [noteId]
      )
      expect(audit).toHaveLength(1)
      expect(audit[0].before.body).toBe("<changed>")
    })
  })
})

describe("a customer never reads them", () => {
  it("NOT_AUTHORIZED on every new RPC, no notes by select, nothing in her own RPCs", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const body = testName("secret_note")
      const { note_id: noteId } = await asAdmin(
        db,
        f,
        async () =>
          (await db.query(ADD, [f.customerA, body, randomUUID()])).rows[0].r
      )

      await asAuthenticated(db, f.customerA)
      for (const [query, params] of [
        [LIST, [testName("x")]],
        [GET, [f.customerA]],
        [ADD, [f.customerA, "x", randomUUID()]],
        [DELETE, [noteId, randomUUID()]],
      ] as const) {
        expect(await queryError(db, query, [...params]), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      const { rows } = await db.query(
        "select count(*)::int as n from public.customer_notes"
      )
      expect(rows[0].n).toBe(0)

      const seen = JSON.stringify([
        (await db.query("select public.get_my_entitlements() as r")).rows,
        (await db.query("select public.get_my_bookings() as r")).rows,
        (await db.query("select * from public.notifications")).rows,
        (await db.query("select * from public.profiles")).rows,
      ])
      expect(seen).not.toContain(body)
    })
  })

  it("anon gets 42501 on every new RPC", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const [query, params] of [
        [LIST, [testName("x")]],
        [GET, [randomUUID()]],
        [ADD, [randomUUID(), "x", randomUUID()]],
        [DELETE, [randomUUID(), randomUUID()]],
      ] as const) {
        expect((await queryError(db, query, [...params]))?.code, query).toBe(
          "42501"
        )
      }
      expect(
        (await queryError(db, "select * from public.customer_notes"))?.code
      ).toBe("42501")
    })
  })
})

describe("admin_get_home", () => {
  it("an expiring card carries its customer_id", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.business_settings set admin_expiring_days = 10"
      )
      const a = await grant(db, f, f.customerA)
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 3
         where id = $1`,
        [a.entitlement]
      )
      const home = await asAdmin(
        db,
        f,
        async () => (await db.query(HOME)).rows[0].r
      )
      const row = home.expiring_cards.find(
        (c: { entitlement_id: string }) => c.entitlement_id === a.entitlement
      )
      expect(row).toEqual({
        entitlement_id: a.entitlement,
        customer_id: f.customerA,
        customer_label: testName("money_a"),
        product_name: testName("card"),
        available: 4,
        expires_on: expect.any(String),
        days_left: 3,
      })
    })
  })
})
