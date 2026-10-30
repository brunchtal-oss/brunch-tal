// Story 6.6: the acceptance suite, "booking and quota" (B3, B5, B7, B8, B9,
// B10). Each test proves a claim the story-by-story tests left missing or
// weak (T13-T19 of the spec's coverage map). Time claims use fixed 2099
// dates. Everything runs in inRollback; the job tests check afterwards that
// nothing of theirs was kept.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import {
  APPROVE,
  approve,
  approveParams,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const BOOK = "select public.book_session($1, $2) as r"
const PREVIEW = "select public.preview_book_session($1) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const MINE = "select public.get_my_entitlements() as r"
const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const CREATE_EVENT = "select public.admin_create_event($1::jsonb, $2) as r"
const SETTINGS =
  "select public.admin_update_business_settings($1::jsonb, $2, $3) as r"
const JOB = "select private.job_auto_extend($1::date, $2::uuid[]) as n"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & { concepts: Record<string, string> }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         last_places_threshold = 4, registration_close_days_before = 1,
         registration_close_local_time = '20:00',
         default_capacity_regular = 12, default_capacity_couple = 14`
  )
  const { rows } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  return {
    ...f,
    concepts: Object.fromEntries(rows.map((c) => [c.theme_key, c.id])),
  }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

async function one(db: Db, user: string, text: string, params: unknown[]) {
  return as(db, user, async () => (await db.query(text, params)).rows[0].r)
}

async function errorAs(db: Db, user: string, text: string, params: unknown[]) {
  return as(db, user, () => queryError(db, text, params))
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

// As the admin: a card of the fixture (4 entries, any weekday) for the
// customer; its entitlement and payment.
async function grantCard(db: Db, f: Fixture, customerId: string) {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
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

// As the owner: a regular session `days` from now, 2 hours, open until it
// starts.
async function insertEventIn(
  db: Db,
  f: Fixture,
  days: number,
  capacity = 12
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     values ($1, 'regular', now() + make_interval(days => $2::int),
       now() + make_interval(days => $2::int) + interval '2 hours', $3,
       now() + make_interval(days => $2::int), true, 'published')
     returning id`,
    [f.concepts.mothers, days, capacity]
  )
  return rows[0].id
}

// As the owner: a session at the local `day` and `time`, 1 hour.
// computed: the close comes from the settings (the trigger, AD-8);
// otherwise it is open until the start.
async function insertEventAt(
  db: Db,
  f: Fixture,
  day: string,
  options: {
    time?: string
    kind?: "regular" | "couple"
    status?: string
    computed?: boolean
  } = {}
): Promise<string> {
  const kind = options.kind ?? "regular"
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '1 hour', 12, s.t, not $5::boolean, $6
     from (select ($3::date + $4::time) at time zone 'Asia/Jerusalem' as t) s
     returning id`,
    [
      kind === "couple" ? f.concepts.grandma : f.concepts.mothers,
      kind,
      day,
      options.time ?? "10:00",
      options.computed ?? false,
      options.status ?? "published",
    ]
  )
  return rows[0].id
}

// The movements' own sums (as in my-entitlements.test.ts).
async function fromMovements(db: Db, entitlement: string) {
  const { rows } = await db.query(
    `with b as (
       select booking_id,
         coalesce(sum(units) filter (where action in ('reserve', 'release')), 0) as net,
         bool_or(action = 'use') as used
       from public.entitlement_movements
       where entitlement_id = $1 and booking_id is not null
       group by booking_id
     )
     select
       (select coalesce(sum(units), 0)::int from public.entitlement_movements where entitlement_id = $1) as available,
       coalesce((select sum(-net) filter (where not used) from b), 0)::int as reserved,
       coalesce((select sum(-net) filter (where used) from b), 0)::int as used`,
    [entitlement]
  )
  return rows[0] as { available: number; reserved: number; used: number }
}

async function mineRow(db: Db, customer: string, entitlement: string) {
  const rows = (await one(db, customer, MINE, [])) as {
    entitlement_id: string
  }[]
  return rows.find((r) => r.entitlement_id === entitlement)
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

// As the owner: a pinned single (validity_mode session, every weekday).
async function insertSingle(db: Db): Promise<string> {
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  return rows[0].id
}

describe("B3: a card of 4 through reserve, cancel and attend", () => {
  it("T13: reserve E1 and E2, cancel E2, complete E1: get_my_entitlements matches the movements at every step", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grantCard(db, f, f.customerA)
      const e1 = await insertEventIn(db, f, 7)
      const e2 = await insertEventIn(db, f, 9)

      const step = async (expected: {
        available: number
        reserved: number
        used: number
      }) => {
        const row = await mineRow(db, f.customerA, entitlement)
        expect(row).toMatchObject(expected)
        expect(await fromMovements(db, entitlement)).toEqual(expected)
      }

      await step({ available: 4, reserved: 0, used: 0 })
      await one(db, f.customerA, BOOK, [e1, randomUUID()])
      const b2 = (await one(db, f.customerA, BOOK, [e2, randomUUID()]))
        .booking_id as string
      await step({ available: 2, reserved: 2, used: 0 })

      await one(db, f.customerA, CANCEL, [b2, randomUUID()])
      await step({ available: 3, reserved: 1, used: 0 })

      // E1 ended; the completion job (as the owner, like pg_cron).
      await db.query(
        `update public.events
         set registration_closes_at = now() - interval '4 hours',
             starts_at = now() - interval '3 hours',
             ends_at = now() - interval '1 hour'
         where id = $1`,
        [e1]
      )
      await db.query("select private.job_complete_events()")
      await step({ available: 3, reserved: 0, used: 1 })
    })
  })
})

describe("B5: valid to the end of the local day 49", () => {
  it("T14: valid to 2099-02-19 (day 49 of 2099-01-01): a session at 23:30 that day is bookable, one at 00:30 the next day is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grantCard(db, f, f.customerA)
      // The booking side only; expires_on = paid_on + 49 at approval is
      // proven by approve-payment.test.ts:62.
      await db.query(
        `update public.entitlements
         set valid_from = '2099-01-01', expires_on = '2099-01-01'::date + 49
         where id = $1`,
        [entitlement]
      )
      const { rows } = await db.query(
        "select expires_on::text as d from public.entitlements where id = $1",
        [entitlement]
      )
      expect(rows[0].d).toBe("2099-02-19")
      const lastDay = await insertEventAt(db, f, "2099-02-19", {
        time: "23:30",
      })
      const nextDay = await insertEventAt(db, f, "2099-02-20", {
        time: "00:30",
      })

      expect(await one(db, f.customerA, PREVIEW, [lastDay])).toMatchObject({
        ok: true,
      })
      expect(await one(db, f.customerA, PREVIEW, [nextDay])).toMatchObject({
        ok: false,
        code: "ENTITLEMENT_EXPIRED_ON_DATE",
      })
      expect(await one(db, f.customerA, BOOK, [lastDay, randomUUID()])).toEqual(
        { booking_id: expect.any(String) }
      )
      expect(
        await errorAs(db, f.customerA, BOOK, [nextDay, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "ENTITLEMENT_EXPIRED_ON_DATE" })
      expect(
        await count(
          db,
          "select 1 from public.bookings where customer_id = $1 and event_id = $2",
          [f.customerA, nextDay]
        )
      ).toBe(0)
    })
  })
})

describe("B7: a pinned product", () => {
  it("T15: a full regular session refuses a pinned single with EVENT_FULL and creates nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const single = await insertSingle(db)
      const eventId = await insertEventIn(db, f, 7, 2)
      // Two places taken by unbound seats of an unrelated card (AD-23).
      const card = await as(db, f.admin, () =>
        approve(db, {
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          key: randomUUID(),
        })
      )
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot)
         select $1, $2, 1, 'admin', ${SNAPSHOT} from generate_series(1, 2)`,
        [card.payment_id, eventId]
      )
      expect(await occupied(db, eventId)).toBe(2)

      for (const customerId of [null, f.customerA]) {
        expect(
          await errorAs(
            db,
            f.admin,
            APPROVE,
            approveParams({
              customerId,
              productId: single,
              eventId,
              amount: 12800,
              paidOn: f.today,
              methodId: f.method,
              duplicateConfirmed: true,
              key: randomUUID(),
            })
          )
        ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
      }
      const byProduct = (from: string) =>
        count(
          db,
          `select 1 from ${from} join public.payments p on p.id = x.payment_id where p.product_id = $1`,
          [single]
        )
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          single,
        ])
      ).toBe(0)
      expect(await byProduct("public.entitlements x")).toBe(0)
      expect(await byProduct("public.bookings x")).toBe(0)
      expect(await byProduct("public.activation_tokens x")).toBe(0)
      expect(await occupied(db, eventId)).toBe(2)
    })
  })

  it("T16: a pinned single for a new customer moves to her through the real join_begin / join_complete; the place is counted once and the replay binds nothing again", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const single = await insertSingle(db)
      const eventId = await insertEventIn(db, f, 7)
      const r = await as(db, f.admin, () =>
        approve(db, {
          productId: single,
          eventId,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          key: randomUUID(),
        })
      )
      const bookingId = r.booking_id as string
      expect(await occupied(db, eventId)).toBe(1)

      const label = "t16_joiner"
      const email = `${testName(label)}@example.test`.toLowerCase()
      const phone = `058${(parseInt(testName("").slice(5, 11), 16) + 7001)
        .toString()
        .padStart(7, "0")
        .slice(-7)}`
      const key = randomUUID()
      const service = async (text: string, params: unknown[]) => {
        await asServiceRole(db)
        const { rows } = await db.query(text, params)
        await db.query("reset role")
        return rows[0].r as Record<string, unknown>
      }
      const begun = await service(BEGIN, [r.token, email, phone, key])
      expect(begun.outcome).toBe("claiming")
      const userId = begun.pending_user_id as string
      await insertAuthUser(db, label, { id: userId })
      const body = JSON.stringify({
        email,
        phone,
        full_name: testName("joiner"),
        dietary_notes: null,
        privacy_consent: true,
        photo_consent: false,
        personal_photo_consent: false,
        babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
      })
      const done = await service(COMPLETE, [r.token, body, key])
      expect(done).toMatchObject({ outcome: "joined", customer_id: userId })

      const state = async () => {
        const { rows } = await db.query(
          `select b.id, b.customer_id, b.status,
             (select customer_id from public.payments where id = $1) as payment,
             (select customer_id from public.entitlements where payment_id = $1) as entitlement
           from public.bookings b where b.payment_id = $1`,
          [r.payment_id]
        )
        return rows
      }
      const confirmed = () =>
        count(
          db,
          "select 1 from public.notifications where recipient_id = $1 and type = 'booking_confirmed'",
          [userId]
        )
      const expected = [
        {
          id: bookingId,
          customer_id: userId,
          status: "confirmed",
          payment: userId,
          entitlement: userId,
        },
      ]
      expect(await state()).toEqual(expected)
      expect(await occupied(db, eventId)).toBe(1)
      expect(await confirmed()).toBe(1)

      // The replay: the stored result, no second bind or notification.
      expect(await service(COMPLETE, [r.token, body, key])).toEqual(done)
      expect(await state()).toEqual(expected)
      expect(await occupied(db, eventId)).toBe(1)
      expect(await confirmed()).toBe(1)
    })
  })
})

describe("B8: the couple capacity setting", () => {
  it("T17: a new default_capacity_couple applies to couple sessions created after it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const create = (date: string) =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(CREATE_EVENT, [
            {
              concept_id: f.concepts.grandma,
              date,
              start_time: "10:00",
              end_time: "12:00",
            },
            randomUUID(),
          ])
          return rows[0].r.event_id as string
        })
      const before = await create("2099-05-05")
      const { rows: version } = await db.query(
        "select version from public.business_settings"
      )
      const updated = await one(db, f.admin, SETTINGS, [
        JSON.stringify({ default_capacity_couple: 16 }),
        version[0].version,
        randomUUID(),
      ])
      expect(updated).toMatchObject({ default_capacity_couple: 16 })
      const after = await create("2099-05-06")

      const { rows } = await db.query(
        "select id, kind, capacity_adults from public.events where id = any($1::uuid[])",
        [[before, after]]
      )
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
      expect(byId[before]).toMatchObject({
        kind: "couple",
        capacity_adults: 14,
      })
      expect(byId[after]).toMatchObject({ kind: "couple", capacity_adults: 16 })
    })
  })
})

describe("B9: the automatic extension", () => {
  it.each([
    ["only a couple session", { kind: "couple" as const }],
    ["the only session cancelled", { status: "cancelled" }],
  ])(
    "T18: %s that week: expires_on +7 and one entitlement_auto_extended; nothing kept after the rollback",
    async (_label, event) => {
      const ids = await inRollback(async (db) => {
        const f = await seed(db)
        const { entitlement } = await grantCard(db, f, f.customerA)
        await db.query(
          "update public.entitlements set valid_from = '2099-03-01', expires_on = '2099-03-05' where id = $1",
          [entitlement]
        )
        await insertEventAt(db, f, "2099-03-03", event)

        const { rows } = await db.query(JOB, ["2099-03-08", [entitlement]])
        expect(rows[0].n).toBe(1)
        const { rows: expires } = await db.query(
          "select expires_on::text as d from public.entitlements where id = $1",
          [entitlement]
        )
        expect(expires[0].d).toBe("2099-03-12")
        const { rows: sent } = await db.query(
          `select n.id,
             (select count(*)::int from public.notification_jobs j where j.notification_id = n.id) as jobs
           from public.notifications n
           where n.recipient_id = $1 and n.type = 'entitlement_auto_extended'`,
          [f.customerA]
        )
        expect(sent).toEqual([{ id: expect.any(String), jobs: 1 }])
        return { customer: f.customerA, entitlement }
      })
      await expectNothingKept(ids.customer, ids.entitlement)
    }
  )
})

// After a rolled-back job test: no notification, job, correction, audit row
// or pg_net request of its customer or entitlement was committed.
async function expectNothingKept(customer: string, entitlement: string) {
  const [kept] = await sql<Record<string, number>>(
    `select
       (select count(*)::int from public.notifications where recipient_id = $1) as notifications,
       (select count(*)::int from public.notification_jobs j
          join public.notifications n on n.id = j.notification_id
          where n.recipient_id = $1) as jobs,
       (select count(*)::int from public.entitlements where id = $2) as entitlements,
       (select count(*)::int from public.audit_log where customer_id = $1) as audit`,
    [customer, entitlement]
  )
  expect(kept).toEqual({ notifications: 0, jobs: 0, entitlements: 0, audit: 0 })
  const [queue] = await sql<{ exists: boolean }>(
    "select to_regclass('net.http_request_queue') is not null as exists"
  )
  if (queue.exists) {
    const [pending] = await sql<{ n: number }>(
      "select count(*)::int as n from net.http_request_queue where body::text like '%' || $1 || '%' or body::text like '%' || $2 || '%'",
      [customer, entitlement]
    )
    expect(pending.n).toBe(0)
  }
}

describe("B10: the registration close on DST edges", () => {
  it("T19: sessions on both sides of the 2099 clock changes (DST ends Sunday 25.10, starts Friday 27.03) close at 20:00 local the day before, and are bookable now (the open branch)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { entitlement } = await grantCard(db, f, f.customerA)
      await db.query(
        "update public.entitlements set expires_on = '2099-12-31' where id = $1",
        [entitlement]
      )
      const winter = await insertEventAt(db, f, "2099-10-26", {
        computed: true,
      })
      const summer = await insertEventAt(db, f, "2099-03-28", {
        computed: true,
      })
      // The session's day and the day before on different UTC offsets.
      const dstEndDay = await insertEventAt(db, f, "2099-10-25", {
        computed: true,
      })
      const dstStartDay = await insertEventAt(db, f, "2099-03-27", {
        computed: true,
      })
      const sessions = [winter, summer, dstEndDay, dstStartDay]
      const { rows } = await db.query(
        `select id,
           to_char(registration_closes_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as closes,
           registration_closes_at > now() as open
         from public.events where id = any($1::uuid[])`,
        [sessions]
      )
      expect(
        Object.fromEntries(rows.map((r) => [r.id, [r.closes, r.open]]))
      ).toEqual({
        [winter]: ["2099-10-25T18:00Z", true],
        [summer]: ["2099-03-27T17:00Z", true],
        [dstEndDay]: ["2099-10-24T17:00Z", true],
        [dstStartDay]: ["2099-03-26T18:00Z", true],
      })

      for (const eventId of sessions) {
        expect(await one(db, f.customerA, PREVIEW, [eventId])).toMatchObject({
          ok: true,
        })
        expect(
          await one(db, f.customerA, BOOK, [eventId, randomUUID()])
        ).toEqual({ booking_id: expect.any(String) })
      }
      expect(await fromMovements(db, entitlement)).toEqual({
        available: 0,
        reserved: 4,
        used: 0,
      })
    })
  })
})
