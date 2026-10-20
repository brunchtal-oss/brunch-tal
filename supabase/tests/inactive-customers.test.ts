// Story 5.13: inactive customers (source §7, CAP-28). private.customer_activity
// (one test per row of the spec's I/O matrix, the dates relative to the
// database's Jerusalem today), the categories of admin_list_customers (a
// search over everyone with each row's inactive; an empty query lists a whole
// category) and of admin_export_customers ('all' = the whole category,
// 'search' = the matches within it), INVALID_INPUT (activity) and
// NOT_AUTHORIZED. The dev database may hold other rows, so every check looks
// only at this test's ids or names. Everything runs in inRollback.

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

const ACTIVITY = "select private.customer_activity($1) as a"
const LIST = "select public.admin_list_customers($1, $2) as r"
const EXPORT = "select public.admin_export_customers($1, $2, $3, $4) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & { concept: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows } = await db.query(
    "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  // The default the matrix uses (the dev database may hold another value).
  await db.query("update public.business_settings set inactivity_months = 3")
  return { ...f, concept: rows[0].id }
}

// The Jerusalem day `months` months and `days` days from today (negative =
// back), as YYYY-MM-DD.
async function day(db: Db, months: number, days = 0): Promise<string> {
  const { rows } = await db.query(
    `select ((now() at time zone 'Asia/Jerusalem')::date
             + make_interval(months => $1::int) + make_interval(days => $2::int)
           )::date::text as d`,
    [months, days]
  )
  return rows[0].d
}

// The earliest anchor that is still active with inactivity_months = 3: the
// smallest day d with d + 3 months > today (Jerusalem). Not "3 months ago + 1
// day": at a month's end (May 30: Feb 28 + 3 months = May 28) that one is
// already inactive.
async function firstActiveDay(db: Db): Promise<string> {
  const { rows } = await db.query(
    `with t as (select (now() at time zone 'Asia/Jerusalem')::date as today)
     select min(g.d)::date::text as d
     from t
     cross join lateral generate_series(
       t.today - interval '4 months', t.today, interval '1 day'
     ) as g(d)
     where (g.d::date + make_interval(months => 3))::date > t.today`
  )
  return rows[0].d
}

// Noon of a Jerusalem day, as timestamptz text.
function noon(onDay: string): string {
  return `${onDay} 12:00:00 Asia/Jerusalem`
}

// As the owner: an activated customer whose account was created on `createdOn`.
async function insertCustomer(
  db: Db,
  label: string,
  createdOn: string
): Promise<string> {
  const id = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at, created_at)
     values ($1, $2, now(), $3::timestamptz)`,
    [id, testName(label), noon(createdOn)]
  )
  return id
}

// As the owner: a session at noon of `onDay`.
async function insertEvent(db: Db, f: Fixture, onDay: string): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', $2::timestamptz, $2::timestamptz + interval '2 hours',
       12, $2::timestamptz - interval '1 day', 'published')
     returning id`,
    [f.concept, noon(onDay)]
  )
  return rows[0].id
}

// As the owner: a booking of hers, created on `createdOn`.
async function insertBooking(
  db: Db,
  customerId: string,
  eventId: string,
  createdOn: string,
  status: "confirmed" | "completed" | "cancelled"
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, booked_by, policy_snapshot,
       status, created_at, confirmed_at, cancelled_at)
     values ($1, $2, 1, 'admin', ${SNAPSHOT}, $3, $4::timestamptz,
       $4::timestamptz, case when $3 = 'cancelled' then $4::timestamptz end)
     returning id`,
    [customerId, eventId, status, noon(createdOn)]
  )
  return rows[0].id
}

// She took part in a session on `onDay` (booked the same day).
async function participated(
  db: Db,
  f: Fixture,
  customerId: string,
  onDay: string
): Promise<void> {
  const event = await insertEvent(db, f, onDay)
  await insertBooking(db, customerId, event, onDay, "completed")
}

// As the admin: a card for her paid on `paidOn` (approved today, then moved
// back as the owner), valid until `expiresOn`.
async function insertCard(
  db: Db,
  f: Fixture,
  customerId: string,
  paidOn: string,
  expiresOn: string
): Promise<{ entitlement: string; payment: string }> {
  await asAuthenticated(db, f.admin)
  let paymentId: string
  try {
    const r = await approve(db, {
      customerId,
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
    paymentId = r.payment_id as string
  } finally {
    await db.query("reset role")
  }
  await db.query("update public.payments set paid_on = $2 where id = $1", [
    paymentId,
    paidOn,
  ])
  const { rows } = await db.query(
    `update public.entitlements
     set valid_from = least($2::date, $3::date), expires_on = $3
     where payment_id = $1
     returning id`,
    [paymentId, paidOn, expiresOn]
  )
  return { entitlement: rows[0].id, payment: paymentId }
}

// An old customer (account a year ago, last session 4 months ago).
async function oldCustomer(db: Db, f: Fixture, label: string): Promise<string> {
  const id = await insertCustomer(db, label, await day(db, -12))
  await participated(db, f, id, await day(db, -4))
  return id
}

// A cancellation credit of hers in `status` (from a cancelled booking on an
// expired card of hers), and its refund request when `refund` is given.
async function insertCredit(
  db: Db,
  f: Fixture,
  customerId: string,
  status: "active" | "used" | "refund_requested" | "refunded",
  refund?: "requested" | "completed"
): Promise<void> {
  const old = await day(db, -6)
  const card = await insertCard(db, f, customerId, old, await day(db, -5))
  const event = await insertEvent(db, f, await day(db, -5))
  const booking = await insertBooking(db, customerId, event, old, "cancelled")
  const { rows } = await db.query(
    `insert into public.cancellation_credits (
       customer_id, origin_booking_id, source_entitlement_id, event_kind,
       party_size, options_count, origin_starts_at, original_cancelled_at,
       monetary_basis_agorot, status)
     values ($1, $2, $3, 'regular', 1, 2, $4::timestamptz, $4::timestamptz,
       12000, $5)
     returning id`,
    [customerId, booking, card.entitlement, noon(old), status]
  )
  if (refund) {
    await db.query(
      `insert into public.refund_requests (
         customer_id, credit_id, payment_id, booking_id, amount_agorot,
         status, completed_at, refunded_on)
       values ($1, $2, $3, $4, 12000, $5,
         case when $5 = 'completed' then now() end,
         case when $5 = 'completed' then (now() at time zone 'Asia/Jerusalem')::date end)`,
      [customerId, rows[0].id, card.payment, booking, refund]
    )
  }
}

async function activity(db: Db, customerId: string): Promise<string> {
  return (await db.query(ACTIVITY, [customerId])).rows[0].a
}

async function asAdmin<T>(db: Db, f: Fixture, run: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

type ListRow = { id: string; inactive: boolean }
type List = { customers: ListRow[]; has_more: boolean }

async function list(
  db: Db,
  f: Fixture,
  query: string,
  filter: string
): Promise<List> {
  return asAdmin(
    db,
    f,
    async () => (await db.query(LIST, [query, filter])).rows[0].r
  )
}

// Like queryError, with the exception's DETAIL parsed.
async function raised(
  db: Db,
  text: string,
  params: unknown[]
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

describe("private.customer_activity: the anchor", () => {
  it("last session exactly inactivity_months ago -> inactive; a day later -> active", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const year = await day(db, -12)
      const edge = await insertCustomer(db, "edge", year)
      await participated(db, f, edge, await day(db, -3))
      const after = await insertCustomer(db, "after", year)
      await participated(db, f, after, await firstActiveDay(db))

      expect(await activity(db, edge)).toBe("inactive")
      expect(await activity(db, after)).toBe("active")
    })
  })

  it("never participated: counts from the account's creation", async () => {
    await inRollback(async (db) => {
      await seed(db)
      const old = await insertCustomer(db, "never_old", await day(db, -4, -19))
      const edge = await insertCustomer(db, "never_edge", await day(db, -3))
      const recent = await insertCustomer(
        db,
        "never_new",
        await firstActiveDay(db)
      )

      expect(await activity(db, old)).toBe("inactive")
      expect(await activity(db, edge)).toBe("inactive")
      expect(await activity(db, recent)).toBe("active")
    })
  })

  it("an approved payment today makes an old customer active again", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await oldCustomer(db, f, "paid_today")
      expect(await activity(db, id)).toBe("inactive")
      // Paid today; the card itself already expired, so only the anchor counts.
      await insertCard(db, f, id, f.today, await day(db, 0, -1))
      expect(await activity(db, id)).toBe("active")
    })
  })

  it("inactivity_months changed to 6 -> active", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await insertCustomer(db, "six", await day(db, -12))
      await participated(db, f, id, await day(db, -3))
      expect(await activity(db, id)).toBe("inactive")
      await db.query(
        "update public.business_settings set inactivity_months = 6"
      )
      expect(await activity(db, id)).toBe("active")
    })
  })
})

describe("private.customer_activity: something open keeps her active", () => {
  it("a confirmed future booking", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await oldCustomer(db, f, "future")
      const event = await insertEvent(db, f, await day(db, 0, 10))
      await insertBooking(db, id, event, await day(db, -5), "confirmed")
      expect(await activity(db, id)).toBe("active")
    })
  })

  it("a card with available or reserved entries, not expired; expired or used up is inactive", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await day(db, -5)
      const open = await oldCustomer(db, f, "card_open")
      await insertCard(db, f, open, old, await day(db, 1))
      const expired = await oldCustomer(db, f, "card_expired")
      await insertCard(db, f, expired, old, await day(db, 0, -1))
      const usedUp = await oldCustomer(db, f, "card_used_up")
      const card = await insertCard(db, f, usedUp, old, await day(db, 1))
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         select e.id, 'adjust', -e.original_units
         from public.entitlements e where e.id = $1`,
        [card.entitlement]
      )

      // Active, not expired, available 0 and reserved 1: a reserve on a
      // booking (cancelled, so no confirmed booking counts) without its
      // release, the rest adjusted away.
      const reserved = await oldCustomer(db, f, "card_reserved")
      const held = await insertCard(db, f, reserved, old, await day(db, 1))
      const event = await insertEvent(db, f, await day(db, -5))
      const booking = await insertBooking(
        db,
        reserved,
        event,
        await day(db, -5),
        "cancelled"
      )
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
         values ($1, $2, 'reserve', -1)`,
        [held.entitlement, booking]
      )
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         select e.id, 'adjust', 1 - e.original_units
         from public.entitlements e
         where e.id = $1 and e.original_units > 1`,
        [held.entitlement]
      )
      const { rows: balance } = await db.query(
        `select available, reserved, is_expired, status
         from public.entitlement_balances where entitlement_id = $1`,
        [held.entitlement]
      )
      expect(balance[0]).toEqual({
        available: 0,
        reserved: 1,
        is_expired: false,
        status: "active",
      })

      expect(await activity(db, open)).toBe("active")
      expect(await activity(db, reserved)).toBe("active")
      expect(await activity(db, expired)).toBe("inactive")
      expect(await activity(db, usedUp)).toBe("inactive")
    })
  }, 30_000)

  it("a credit active or refund_requested, or a refund requested; a used credit or a completed refund is not", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const active = await oldCustomer(db, f, "credit_active")
      await insertCredit(db, f, active, "active")
      const asked = await oldCustomer(db, f, "credit_refund_requested")
      await insertCredit(db, f, asked, "refund_requested")
      const refund = await oldCustomer(db, f, "refund_requested")
      await insertCredit(db, f, refund, "refunded", "requested")
      const used = await oldCustomer(db, f, "credit_used")
      await insertCredit(db, f, used, "used")
      const done = await oldCustomer(db, f, "refund_done")
      await insertCredit(db, f, done, "refunded", "completed")

      expect(await activity(db, active)).toBe("active")
      expect(await activity(db, asked)).toBe("active")
      expect(await activity(db, refund)).toBe("active")
      expect(await activity(db, used)).toBe("inactive")
      expect(await activity(db, done)).toBe("inactive")
    })
  }, 30_000)
})

describe("admin_list_customers: search and categories", () => {
  // An old inactive pair, one old customer kept active by a future booking
  // and one by an open credit.
  async function mixed(db: Db, f: Fixture) {
    const gone = await oldCustomer(db, f, "flt_gone")
    const gone2 = await oldCustomer(db, f, "flt_gone2")
    const booked = await oldCustomer(db, f, "flt_booked")
    const event = await insertEvent(db, f, await day(db, 0, 10))
    await insertBooking(db, booked, event, await day(db, -5), "confirmed")
    const credited = await oldCustomer(db, f, "flt_credit")
    await insertCredit(db, f, credited, "active")
    return { gone, gone2, booked, credited }
  }

  // This test's rows of a list, as [id, inactive], sorted.
  function mine(result: List, ids: string[]): Array<[string, boolean]> {
    return result.customers
      .filter((c) => ids.includes(c.id))
      .map((c): [string, boolean] => [c.id, c.inactive])
      .sort(([a], [b]) => a.localeCompare(b))
  }

  function flagged(entries: Array<[string, boolean]>) {
    return [...entries].sort(([a], [b]) => a.localeCompare(b))
  }

  it("a search (2+ characters) under all shows active and inactive, the inactive flagged", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await mixed(db, f)
      const all = Object.values(c)
      const result = await list(db, f, testName("flt_"), "all")

      expect(result.customers.map((r) => r.id).sort()).toEqual([...all].sort())
      expect(mine(result, all)).toEqual(
        flagged([
          [c.gone, true],
          [c.gone2, true],
          [c.booked, false],
          [c.credited, false],
        ])
      )
      // A search within a category.
      expect(
        (await list(db, f, testName("flt_"), "inactive")).customers
          .map((r) => r.id)
          .sort()
      ).toEqual([c.gone, c.gone2].sort())
      expect(
        (await list(db, f, testName("flt_"), "active")).customers
          .map((r) => r.id)
          .sort()
      ).toEqual([c.booked, c.credited].sort())
    })
  }, 30_000)

  it("an empty query lists the whole category; one character is an empty list", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await mixed(db, f)
      const all = Object.values(c)

      // The dev database may hold more than 200 in a category: then only the
      // cap is checked (the export, uncapped, checks every row below).
      const browse = async (
        activity: string,
        expected: Array<[string, boolean]>
      ) => {
        const result = await list(db, f, "", activity)
        if (result.has_more) {
          expect(result.customers, activity).toHaveLength(200)
        } else {
          expect(mine(result, all), activity).toEqual(flagged(expected))
        }
        for (const row of result.customers) {
          if (activity === "inactive") expect(row.inactive).toBe(true)
          if (activity === "active") expect(row.inactive).toBe(false)
        }
      }
      await browse("inactive", [
        [c.gone, true],
        [c.gone2, true],
      ])
      await browse("active", [
        [c.booked, false],
        [c.credited, false],
      ])
      await browse("all", [
        [c.gone, true],
        [c.gone2, true],
        [c.booked, false],
        [c.credited, false],
      ])

      for (const activity of ["all", "active", "inactive"]) {
        expect(await list(db, f, " ר ", activity), activity).toEqual({
          customers: [],
          has_more: false,
        })
      }
    })
  }, 30_000)

  it("an unknown or missing category -> INVALID_INPUT (activity)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const filter of ["bogus", "", null]) {
        for (const query of [testName("x"), ""]) {
          expect(
            await raised(db, LIST, [query, filter]),
            `${query}:${filter}`
          ).toEqual({
            code: "P0001",
            message: "INVALID_INPUT",
            detail: { field: "activity" },
          })
        }
      }
    })
  })
})

describe("admin_export_customers: categories", () => {
  it("all exports the whole category; search the matches within it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await oldCustomer(db, f, "exp_gone")
      await insertCustomer(db, "exp_new", f.today)
      const q = testName("exp_")
      const names = async (
        scope: string,
        query: string | null,
        activity: string
      ) =>
        asAdmin(db, f, async () =>
          (
            await db.query(EXPORT, [scope, query, ["full_name"], activity])
          ).rows[0].r.rows
            .map((r: { full_name: string }) => r.full_name)
            .filter((n: string) => n.startsWith(q))
            .sort()
        )

      const gone = [testName("exp_gone")]
      const fresh = [testName("exp_new")]
      const both = [...gone, ...fresh].sort()
      expect(await names("all", null, "inactive")).toEqual(gone)
      expect(await names("all", null, "active")).toEqual(fresh)
      expect(await names("all", null, "all")).toEqual(both)
      expect(await names("search", q, "all")).toEqual(both)
      expect(await names("search", q, "inactive")).toEqual(gone)

      const { rows } = await db.query(
        `select after from public.audit_log
         where actor_id = $1 and action = 'admin_export_customers'`,
        [f.admin]
      )
      // One transaction: created_at ties, so compare without the order.
      expect(
        rows.map((r) => `${r.after.scope}:${r.after.activity}`).sort()
      ).toEqual([
        "all:active",
        "all:all",
        "all:inactive",
        "search:all",
        "search:inactive",
      ])
    })
  })

  it("a missing or unknown category -> INVALID_INPUT (activity), for both scopes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const params of [
        ["all", null, ["full_name"], null],
        ["all", null, ["full_name"], "bogus"],
        ["search", testName("x"), ["full_name"], null],
        ["search", testName("x"), ["full_name"], "bogus"],
      ]) {
        expect(
          await raised(db, EXPORT, params),
          JSON.stringify(params)
        ).toEqual({
          code: "P0001",
          message: "INVALID_INPUT",
          detail: { field: "activity" },
        })
      }
    })
  })
})

describe("who may call them", () => {
  it("a customer gets NOT_AUTHORIZED on both", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customerA)
      for (const [query, params] of [
        [LIST, [testName("x"), "inactive"]],
        [EXPORT, ["search", testName("x"), ["full_name"], "inactive"]],
      ] as const) {
        expect(await queryError(db, query, [...params]), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      // The helper itself is not callable from the API.
      expect((await queryError(db, ACTIVITY, [f.customerA]))?.code).toBe(
        "42501"
      )
    })
  })
})
