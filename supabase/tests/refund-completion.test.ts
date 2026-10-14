// Story 3.9: Tal completes a refund request. admin_complete_refund with its
// plan and preview, admin_list_refund_requests, admin_list_customer_credits,
// get_my_credits (refunded_on, the 14-day card), admin_get_home (by
// refunded_on) and the bind of a refunded credit. One test per row of the
// spec's I/O matrix. Everything runs in inRollback, except the concurrent
// row (two completions on one payment serialize on the payment row lock),
// which needs real commits: its fixtures are committed and removed in
// onCleanup.

import { randomUUID } from "node:crypto"

import type { PoolClient, QueryResult } from "pg"
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

const COMPLETE =
  "select public.admin_complete_refund($1, $2::date, $3, $4, $5, $6) as r"
const PREVIEW = "select public.preview_admin_complete_refund($1) as r"
const LIST = "select public.admin_list_refund_requests() as r"
const CUSTOMER_CREDITS = "select public.admin_list_customer_credits($1) as r"
const MY_CREDITS = "select public.get_my_credits() as r"
const MY_ENTITLEMENTS = "select public.get_my_entitlements() as r"
const HOME = "select public.admin_get_home() as r"
const ITEMS = "select public.admin_get_attention_items() as r"

type Fixture = MoneyFixture & { single: string }

// settings: false in a committed fixture (never change the dev settings).
async function seed(db: Db, settings = true): Promise<Fixture> {
  const f = await seedMoney(db)
  if (settings) {
    await db.query(
      "update public.business_settings set cancel_window_hours = 48, credit_options_count = 2"
    )
  }
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 18000, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  return { ...f, single: rows[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// A published session in 7 days at 10:00 Jerusalem time.
async function insertEvent(db: Db, dayOffset = 7): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select c.id, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, 'published'
     from (select id from public.concepts where archived_at is null limit 1) c,
     (select (((now() at time zone 'Asia/Jerusalem')::date + $1::int)
                + time '10:00') at time zone 'Asia/Jerusalem' as t) s
     returning id`,
    [dayOffset]
  )
  return rows[0].id
}

async function localDay(db: Db, offset: number): Promise<string> {
  const { rows } = await db.query(
    "select (((now() at time zone 'Asia/Jerusalem')::date + $1::int))::text as d",
    [offset]
  )
  return rows[0].d
}

type Opened = {
  refundId: string
  creditId: string
  paymentId: string
  bookingId: string
  eventId: string
  // The purchase's entitlement: refund_completed targets its page.
  entitlementId: string
}

// A pinned single of ₪180 on a session in 7 days, cancelled with a refund:
// by the customer herself, or (customerId null, a held place) by Tal.
async function openRefund(
  db: Db,
  f: Fixture,
  options: { customerId?: string | null; paidOn?: string } = {}
): Promise<Opened> {
  const customerId =
    options.customerId === undefined ? f.customerA : options.customerId
  const eventId = await insertEvent(db)
  const approved = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId: f.single,
      eventId,
      amount: 18000,
      paidOn: options.paidOn ?? f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const paymentId = approved.payment_id as string
  const { rows: booking } = await db.query(
    `select b.id, e.id as entitlement_id
     from public.bookings b
     join public.entitlements e on e.payment_id = b.payment_id
     where b.payment_id = $1`,
    [paymentId]
  )
  const bookingId = booking[0].id as string
  const result = customerId
    ? await as(db, customerId, async () => {
        const { rows } = await db.query(
          "select public.cancel_booking($1, $2, 'refund') as r",
          [bookingId, randomUUID()]
        )
        return rows[0].r
      })
    : await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select public.admin_cancel_booking($1, true, $2, null, 'refund') as r",
          [bookingId, randomUUID()]
        )
        return rows[0].r
      })
  return {
    refundId: result.refund_request_id as string,
    creditId: result.credit_id as string,
    paymentId,
    bookingId,
    eventId,
    entitlementId: booking[0].entitlement_id as string,
  }
}

type CompleteInput = {
  refundedOn?: string
  amount?: number
  reference?: string | null
  confirmed?: boolean
  key?: string
}

function completeParams(f: Fixture, refundId: string, input: CompleteInput) {
  return [
    refundId,
    input.refundedOn ?? f.today,
    input.amount ?? 18000,
    input.reference ?? null,
    input.confirmed ?? true,
    input.key ?? randomUUID(),
  ]
}

async function complete(
  db: Db,
  f: Fixture,
  refundId: string,
  input: CompleteInput = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(
      COMPLETE,
      completeParams(f, refundId, input)
    )
    return rows[0].r
  })
}

// The refusal's code and its detail.field (P0001), or null.
async function completeError(
  db: Db,
  f: Fixture,
  refundId: string,
  input: CompleteInput = {}
): Promise<{ message: string; field: string | null } | null> {
  await asAuthenticated(db, f.admin)
  await db.query("savepoint complete_error")
  try {
    await db.query(COMPLETE, completeParams(f, refundId, input))
    await db.query("release savepoint complete_error")
    return null
  } catch (error) {
    await db.query("rollback to savepoint complete_error")
    const e = error as { message: string; detail?: string }
    return {
      message: e.message,
      field: e.detail ? (JSON.parse(e.detail).field ?? null) : null,
    }
  } finally {
    await db.query("reset role")
  }
}

async function adminRead(db: Db, f: Fixture, query: string, params = []) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(query, params)
    return rows[0].r
  })
}

async function rowsOf(db: Db, refundId: string, creditId: string) {
  const { rows } = await db.query(
    `select r.status, r.amount_agorot, r.refunded_on::text as refunded_on,
       r.reference, r.completed_at, r.handled_by, c.status as credit_status
     from public.refund_requests r
     join public.cancellation_credits c on c.id = r.credit_id
     where r.id = $1 and c.id = $2`,
    [refundId, creditId]
  )
  return rows[0]
}

async function notices(db: Db, customer: string) {
  const { rows } = await db.query(
    `select n.payload ->> 'title' as title, n.payload ->> 'body' as body,
       n.dedupe_key, n.target_path,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.recipient_id = $1 and n.type = 'refund_completed'
     order by n.created_at, n.id`,
    [customer]
  )
  return rows
}

describe("admin_complete_refund", { timeout: 60_000 }, () => {
  it("full refund: completed, credit refunded, audited, home totals, lists drop it, customer notified", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      const before = (await adminRead(db, f, HOME)).totals

      const plan = await adminRead(db, f, PREVIEW, [o.refundId] as never)
      expect(plan).toMatchObject({
        ok: true,
        refund_request_id: o.refundId,
        customer_id: f.customerA,
        customer_label: testName("money_a"),
        requested_agorot: 18000,
        paid_agorot: 18000,
        refunded_before_agorot: 0,
        max_agorot: 18000,
        paid_on: f.today,
        today: f.today,
      })

      const result = await complete(db, f, o.refundId, { reference: " 1234 " })
      expect(result).toEqual({
        refund_request_id: o.refundId,
        amount_agorot: 18000,
      })

      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "completed",
        amount_agorot: 18000,
        refunded_on: f.today,
        reference: "1234",
        completed_at: expect.any(Date),
        handled_by: f.admin,
        credit_status: "refunded",
      })

      const { rows: audit } = await db.query(
        `select entity_type, before, after from public.audit_log
         where action = 'admin_complete_refund' and entity_id in ($1, $2)
         order by entity_type`,
        [o.creditId, o.refundId]
      )
      expect(audit.map((a) => a.entity_type)).toEqual([
        "cancellation_credits",
        "refund_requests",
      ])
      expect(audit[1].before).toMatchObject({ status: "requested" })
      expect(audit[1].after).toMatchObject({ status: "completed" })

      const after = await adminRead(db, f, HOME)
      expect(after.totals.refunded_count - before.refunded_count).toBe(1)
      expect(after.totals.refunded_agorot - before.refunded_agorot).toBe(18000)
      expect(after.totals.net_agorot).toBe(
        after.totals.approved_agorot - after.totals.refunded_agorot
      )
      expect(
        after.open_refunds.filter(
          (r: { refund_request_id: string }) =>
            r.refund_request_id === o.refundId
        )
      ).toEqual([])
      const items = (await adminRead(db, f, ITEMS)) as { id: string }[]
      expect(items.filter((i) => i.id === o.refundId)).toEqual([])

      expect(await notices(db, f.customerA)).toEqual([
        {
          title: "ההחזר בוצע",
          body: expect.stringMatching(
            /^החזר של 180 ₪ על הבראנץ׳ ב-\d\d\.\d\d הועבר אלייך$/
          ),
          dedupe_key: `refund_completed:${f.customerA}:${o.refundId}`,
          // Review round 1 (2026-10-14): the purchase page, where "הוחזר"
          // stays.
          target_path: `/me/purchases/${o.entitlementId}`,
          jobs: 1,
        },
      ])
    })
  })

  it("without the checkbox: CONFIRM_REQUIRED and nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      expect(
        await completeError(db, f, o.refundId, { confirmed: false })
      ).toMatchObject({ message: "CONFIRM_REQUIRED" })
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "requested",
        credit_status: "refund_requested",
      })
    })
  })

  it("above what was paid: REFUND_EXCEEDS_PAID and nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      expect(
        await completeError(db, f, o.refundId, { amount: 20000 })
      ).toMatchObject({ message: "REFUND_EXCEEDS_PAID" })
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "requested",
        amount_agorot: 18000,
      })
    })
  })

  it("two requests on one payment: the ceiling is per payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await openRefund(db, f)
      const second = await openRefund(db, f, { customerId: f.customerA })
      // A second cancelled entry of the same purchase (simulated: both
      // requests on the first payment).
      await db.query(
        "update public.refund_requests set payment_id = $1 where id = $2",
        [first.paymentId, second.refundId]
      )
      await complete(db, f, first.refundId, { amount: 10000 })

      const plan = await adminRead(db, f, PREVIEW, [second.refundId] as never)
      expect(plan).toMatchObject({
        paid_agorot: 18000,
        refunded_before_agorot: 10000,
        max_agorot: 8000,
      })
      expect(
        await completeError(db, f, second.refundId, { amount: 10000 })
      ).toMatchObject({ message: "REFUND_EXCEEDS_PAID" })
      expect(await rowsOf(db, second.refundId, second.creditId)).toMatchObject({
        status: "requested",
      })
      await complete(db, f, second.refundId, { amount: 8000 })
      expect(await rowsOf(db, second.refundId, second.creditId)).toMatchObject({
        status: "completed",
        amount_agorot: 8000,
      })
    })
  })

  it("twice with a new key: REFUND_ALREADY_COMPLETED; the preview says so too", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      await complete(db, f, o.refundId)
      expect(await completeError(db, f, o.refundId)).toMatchObject({
        message: "REFUND_ALREADY_COMPLETED",
      })
      expect(await adminRead(db, f, PREVIEW, [o.refundId] as never)).toEqual({
        ok: false,
        code: "REFUND_ALREADY_COMPLETED",
      })
      expect(await notices(db, f.customerA)).toHaveLength(1)
    })
  })

  it("the same key twice: the same result and one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      const key = randomUUID()
      const a = await complete(db, f, o.refundId, { key, amount: 15000 })
      const b = await complete(db, f, o.refundId, { key, amount: 15000 })
      expect(b).toEqual(a)
      expect(await notices(db, f.customerA)).toHaveLength(1)
    })
  })

  it("a future date, or a date before the payment: INVALID_INPUT refunded_on; a negative amount and a long reference are refused too", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      expect(
        await completeError(db, f, o.refundId, {
          refundedOn: await localDay(db, 1),
        })
      ).toEqual({ message: "INVALID_INPUT", field: "refunded_on" })
      expect(
        await completeError(db, f, o.refundId, {
          refundedOn: await localDay(db, -1),
        })
      ).toEqual({ message: "INVALID_INPUT", field: "refunded_on" })
      expect(await completeError(db, f, o.refundId, { amount: -1 })).toEqual({
        message: "INVALID_INPUT",
        field: "amount",
      })
      expect(
        await completeError(db, f, o.refundId, { reference: "x".repeat(201) })
      ).toEqual({ message: "INVALID_INPUT", field: "reference" })
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "requested",
      })
    })
  })

  it("an unbound seat: completed with no notification; the bind moves both and sends refund_completed; she sees it refunded", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f, { customerId: null })
      const plan = await adminRead(db, f, PREVIEW, [o.refundId] as never)
      expect(plan).toMatchObject({ ok: true, customer_id: null })
      await complete(db, f, o.refundId, { amount: 18000 })
      const { rows: none } = await db.query(
        "select count(*)::int as n from public.notifications where type = 'refund_completed' and dedupe_key like $1",
        [`%${o.refundId}%`]
      )
      expect(none[0].n).toBe(0)

      await db.query("select private.bind_purchase($1, $2)", [
        o.paymentId,
        f.customerB,
      ])
      const { rows: moved } = await db.query(
        `select r.customer_id as r, c.customer_id as c, c.status
         from public.refund_requests r
         join public.cancellation_credits c on c.id = r.credit_id
         where r.id = $1`,
        [o.refundId]
      )
      expect(moved[0]).toEqual({
        r: f.customerB,
        c: f.customerB,
        status: "refunded",
      })
      const sent = await notices(db, f.customerB)
      expect(sent).toEqual([
        expect.objectContaining({
          title: "ההחזר בוצע",
          dedupe_key: `refund_completed:${f.customerB}:bind:${o.creditId}`,
          target_path: `/me/purchases/${o.entitlementId}`,
        }),
      ])
      const { rows: other } = await db.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'booking_cancelled_refund'",
        [f.customerB]
      )
      expect(other[0].n).toBe(0)

      const credits = await as(db, f.customerB, async () => {
        const { rows } = await db.query(MY_CREDITS)
        return rows[0].r
      })
      expect(credits).toEqual([
        expect.objectContaining({
          credit_id: o.creditId,
          status: "refunded",
          refund: {
            amount_agorot: 18000,
            status: "completed",
            requested_at: expect.any(String),
            refunded_on: f.today,
          },
        }),
      ])
    })
  })

  it("partial: completed with the amount Tal entered; nothing stays open", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      await complete(db, f, o.refundId, { amount: 12000 })
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "completed",
        amount_agorot: 12000,
        credit_status: "refunded",
      })
      const list = (await adminRead(db, f, LIST)) as {
        refund_request_id: string
        status: string
      }[]
      expect(
        list.filter(
          (r) => r.refund_request_id === o.refundId && r.status === "requested"
        )
      ).toEqual([])
    })
  })

  it("a refund dated last month counts in last month's totals, not this month's", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows } = await db.query(
        `select (date_trunc('month', (now() at time zone 'Asia/Jerusalem')::date)
                 - interval '1 month')::date::text as d`
      )
      const lastMonth = rows[0].d as string
      const o = await openRefund(db, f, { paidOn: lastMonth })
      const before = (await adminRead(db, f, HOME)).totals
      await complete(db, f, o.refundId, { refundedOn: lastMonth })
      const after = (await adminRead(db, f, HOME)).totals
      expect(after.refunded_count).toBe(before.refunded_count)
      expect(after.refunded_agorot).toBe(before.refunded_agorot)
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        refunded_on: lastMonth,
      })
    })
  })

  it("the refunded card: shown 14 days after refunded_on, gone on the 15th; the purchase keeps credit_status refunded", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const paidOn = await localDay(db, -20)
      const o14 = await openRefund(db, f, { paidOn })
      const o15 = await openRefund(db, f, { paidOn })
      await complete(db, f, o14.refundId, {
        refundedOn: await localDay(db, -14),
      })
      await complete(db, f, o15.refundId, {
        refundedOn: await localDay(db, -15),
      })

      const [credits, entitlements] = await as(db, f.customerA, async () => {
        const c = await db.query(MY_CREDITS)
        const e = await db.query(MY_ENTITLEMENTS)
        return [c.rows[0].r, e.rows[0].r]
      })
      const ids = (credits as { credit_id: string }[]).map((c) => c.credit_id)
      expect(ids).toContain(o14.creditId)
      expect(ids).not.toContain(o15.creditId)
      const statuses = (
        entitlements as { payment_id: string; credit_status: string }[]
      )
        .filter((e) => [o14.paymentId, o15.paymentId].includes(e.payment_id))
        .map((e) => e.credit_status)
      expect(statuses).toEqual(["refunded", "refunded"])
    })
  })

  it("before Tal completes it: the customer sees a requested refund, never refunded_on", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      const credits = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MY_CREDITS)
        return rows[0].r
      })
      expect(credits).toEqual([
        expect.objectContaining({
          credit_id: o.creditId,
          status: "refund_requested",
          refund: {
            amount_agorot: 18000,
            status: "requested",
            requested_at: expect.any(String),
            refunded_on: null,
          },
        }),
      ])
    })
  })

  it("a missing request: NOT_FOUND from the preview (ok false) and from the action", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const missing = randomUUID()
      expect(await adminRead(db, f, PREVIEW, [missing] as never)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      })
      expect(await completeError(db, f, missing)).toEqual({
        message: "NOT_FOUND",
        field: null,
      })
    })
  })

  it("the completion check: a completed request needs refunded_on; a requested one cannot have it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      expect(
        await queryError(
          db,
          "update public.refund_requests set status = 'completed', completed_at = now() where id = $1",
          [o.refundId]
        )
      ).toMatchObject({ code: "23514" })
      expect(
        await queryError(
          db,
          "update public.refund_requests set refunded_on = current_date where id = $1",
          [o.refundId]
        )
      ).toMatchObject({ code: "23514" })
    })
  })

  it("a customer gets NOT_AUTHORIZED from every admin RPC of the story", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const o = await openRefund(db, f)
      await asAuthenticated(db, f.customerA)
      for (const [query, params] of [
        [COMPLETE, completeParams(f, o.refundId, {})],
        [PREVIEW, [o.refundId]],
        [LIST, []],
        [CUSTOMER_CREDITS, [f.customerA]],
      ] as const) {
        expect(await queryError(db, query, [...params]), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query("reset role")
      expect(await rowsOf(db, o.refundId, o.creditId)).toMatchObject({
        status: "requested",
      })
    })
  })
})

describe("admin lists", { timeout: 60_000 }, () => {
  it("admin_list_refund_requests: every open request (oldest first), then the completed ones of unbound purchases (newest first); a bound completed one is not listed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await openRefund(db, f)
      const b = await openRefund(db, f)
      const c = await openRefund(db, f, { customerId: f.customerB })
      const d = await openRefund(db, f, { customerId: null })
      const e = await openRefund(db, f, { customerId: null })
      // One transaction has one now(): the order is set explicitly.
      await db.query(
        `update public.refund_requests
         set requested_at = now() - make_interval(hours => 10 - x.n)
         from (values ($1::uuid, 1), ($2::uuid, 2), ($3::uuid, 3)) as x(id, n)
         where refund_requests.id = x.id`,
        [a.refundId, b.refundId, c.refundId]
      )
      await complete(db, f, b.refundId, { amount: 9000, reference: "77" })
      await complete(db, f, d.refundId, { amount: 9000, reference: "77" })
      await complete(db, f, e.refundId, { amount: 18000 })
      await db.query(
        `update public.refund_requests
         set completed_at = now() - interval '1 hour' where id = $1`,
        [d.refundId]
      )

      const list = (await adminRead(db, f, LIST)) as Record<string, unknown>[]
      const ids = [a, b, c, d, e].map((o) => o.refundId)
      const mine = list.filter((r) =>
        ids.includes(r.refund_request_id as string)
      )
      expect(mine.map((r) => r.refund_request_id)).toEqual([
        a.refundId,
        c.refundId,
        e.refundId,
        d.refundId,
      ])
      // Every open row comes before every completed one, and every
      // completed one is of a purchase not bound yet.
      const firstDone = list.findIndex((r) => r.status === "completed")
      const done = list.slice(firstDone)
      expect(done.every((r) => r.status === "completed")).toBe(true)
      expect(done.every((r) => r.customer_id === null)).toBe(true)
      expect(mine[3]).toEqual({
        refund_request_id: d.refundId,
        status: "completed",
        customer_id: null,
        customer_label: expect.any(String),
        amount_agorot: 9000,
        requested_at: expect.any(String),
        refunded_on: f.today,
        reference: "77",
        concept_name: expect.any(String),
        starts_at: expect.any(String),
        product_name: testName("single"),
        paid_agorot: 18000,
        max_agorot: 9000,
      })
      expect(mine[0]).toMatchObject({
        status: "requested",
        customer_id: f.customerA,
        amount_agorot: 18000,
        refunded_on: null,
        reference: null,
        max_agorot: 18000,
      })

      // Once bound, it leaves the list (the customer card shows it).
      await db.query("select private.bind_purchase($1, $2)", [
        d.paymentId,
        f.customerB,
      ])
      const after = (await adminRead(db, f, LIST)) as Record<string, unknown>[]
      expect(after.filter((r) => r.refund_request_id === d.refundId)).toEqual(
        []
      )
    })
  })

  it("admin_list_customer_credits: her credits with their refund, newest first; [] for another customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const refunded = await openRefund(db, f)
      const open = await openRefund(db, f)
      await db.query(
        "update public.cancellation_credits set created_at = now() - interval '1 hour' where id = $1",
        [refunded.creditId]
      )
      await complete(db, f, refunded.refundId, { amount: 18000 })

      const credits = (await adminRead(db, f, CUSTOMER_CREDITS, [
        f.customerA,
      ] as never)) as Record<string, unknown>[]
      expect(credits.map((c) => c.credit_id)).toEqual([
        open.creditId,
        refunded.creditId,
      ])
      expect(credits[1]).toEqual({
        credit_id: refunded.creditId,
        status: "refunded",
        choice_pending: false,
        party_size: 1,
        origin_starts_at: expect.any(String),
        concept_name: expect.any(String),
        monetary_basis_agorot: 18000,
        refund: {
          refund_request_id: refunded.refundId,
          status: "completed",
          amount_agorot: 18000,
          requested_at: expect.any(String),
          refunded_on: f.today,
          reference: null,
        },
      })
      expect(credits[0]).toMatchObject({
        status: "refund_requested",
        refund: { status: "requested", refunded_on: null },
      })
      expect(
        await adminRead(db, f, CUSTOMER_CREDITS, [f.customerB] as never)
      ).toEqual([])
    })
  })
})

// From `watcher`, as the owner: waits until `pid` waits on a lock (as in
// booking-concurrency.test.ts).
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

// Committed: the money fixture and two refund requests of ₪180 (customer
// A's and customer B's, so B's call takes its own profile lock and then
// waits on the payment), both on A's payment (a second cancelled entry of
// one purchase, simulated as in the in-rollback test). Removed in
// onCleanup.
async function seedCommitted() {
  const client = await getPool().connect()
  try {
    await client.query("begin")
    const f = await seed(client, false)
    const first = await openRefund(client, f)
    const second = await openRefund(client, f, { customerId: f.customerB })
    await client.query(
      "update public.refund_requests set payment_id = $1 where id = $2",
      [first.paymentId, second.refundId]
    )
    await client.query("commit")
    onCleanup(() => removeCommitted(f, [first, second]))
    return { f, first, second }
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function removeCommitted(f: Fixture, opened: Opened[]) {
  const people = [f.admin, f.customerA, f.customerB]
  const payments = opened.map((o) => o.paymentId)
  const events = opened.map((o) => o.eventId)
  const credits = opened.map((o) => o.creditId)
  const entitlements =
    "select id from public.entitlements where payment_id = any($1::uuid[])"
  const client = await getPool().connect()
  try {
    await client.query("begin")
    await client.query(
      "delete from public.notifications where recipient_id = any($1::uuid[])",
      [people]
    )
    await client.query(
      "delete from public.audit_log where customer_id = any($1::uuid[]) or actor_id = any($1::uuid[]) or event_id = any($2::uuid[])",
      [people, events]
    )
    await client.query(
      "delete from private.idempotency_results where actor_scope = any($1::text[])",
      [people]
    )
    await client.query(
      "delete from public.refund_requests where credit_id = any($1::uuid[])",
      [credits]
    )
    await client.query(
      "delete from public.credit_options where credit_id = any($1::uuid[])",
      [credits]
    )
    await client.query(
      "delete from public.booking_allocations where booking_id in (select id from public.bookings where payment_id = any($1::uuid[]))",
      [payments]
    )
    await client.query(
      "delete from public.cancellation_credits where id = any($1::uuid[])",
      [credits]
    )
    // entitlement_movements is append-only (a trigger raises on delete);
    // the trigger is off only inside this cleanup transaction.
    await client.query(
      "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
    )
    await client.query(
      `delete from public.entitlement_movements where entitlement_id in (${entitlements})`,
      [payments]
    )
    await client.query(
      "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
    )
    await client.query(
      "delete from public.bookings where payment_id = any($1::uuid[])",
      [payments]
    )
    await client.query(
      "delete from public.entitlements where payment_id = any($1::uuid[])",
      [payments]
    )
    await client.query(
      "delete from public.activation_tokens where payment_id = any($1::uuid[])",
      [payments]
    )
    await client.query(
      "delete from public.payments where id = any($1::uuid[])",
      [payments]
    )
    await client.query("delete from public.events where id = any($1::uuid[])", [
      events,
    ])
    await client.query(
      "delete from public.products where id = any($1::uuid[])",
      [[f.card, f.single]]
    )
    await client.query(
      "delete from public.payment_methods where id = any($1::uuid[])",
      [[f.method, f.hiddenMethod]]
    )
    await client.query(
      "delete from public.profiles where id = any($1::uuid[])",
      [[f.customerA, f.customerB]]
    )
    await client.query("delete from public.admin_roles where user_id = $1", [
      f.admin,
    ])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function completeArgs(refundId: string, today: string, amount: number) {
  return [refundId, today, amount, null, true, randomUUID()]
}

describe("concurrency (committed)", () => {
  it("two completions on one payment: B waits on the payment lock; after A commits, B gets REFUND_EXCEEDS_PAID and ₪80 then succeeds", async () => {
    const { f, first, second } = await seedCommitted()

    // Both pool connections (max: 2); while B waits only A queries.
    const a = await getPool().connect()
    const b = await getPool().connect()
    let released = false
    let pendingB: Promise<QueryResult> | undefined
    try {
      await a.query("begin")
      await asAuthenticated(a, f.admin)
      const done = await a.query(
        COMPLETE,
        completeArgs(first.refundId, f.today, 10000)
      )
      expect(done.rows[0].r).toEqual({
        refund_request_id: first.refundId,
        amount_agorot: 10000,
      })

      await b.query("begin")
      await asAuthenticated(b, f.admin)
      const { rows: pid } = await b.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      )
      pendingB = b.query(
        COMPLETE,
        completeArgs(second.refundId, f.today, 10000)
      )
      // Keep a rejection of B from going unhandled while it is not awaited.
      pendingB.catch(() => {})

      await a.query("reset role")
      expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
      await a.query("commit")
      released = true

      const outcome = await pendingB.then(
        () => null,
        (error: unknown) => error
      )
      expect(outcome).toMatchObject({
        code: "P0001",
        message: "REFUND_EXCEEDS_PAID",
      })
      await b.query("rollback")

      // What the payment can still refund: ₪80.
      await b.query("begin")
      await asAuthenticated(b, f.admin)
      const rest = await b.query(
        COMPLETE,
        completeArgs(second.refundId, f.today, 8000)
      )
      expect(rest.rows[0].r).toEqual({
        refund_request_id: second.refundId,
        amount_agorot: 8000,
      })
      await b.query("commit")
    } finally {
      if (!released) await a.query("rollback").catch(() => {})
      await pendingB?.catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }

    const rows = await sql<{
      id: string
      status: string
      amount_agorot: number
    }>(
      "select id, status, amount_agorot from public.refund_requests where id = any($1::uuid[]) order by amount_agorot desc",
      [[first.refundId, second.refundId]]
    )
    expect(rows).toEqual([
      { id: first.refundId, status: "completed", amount_agorot: 10000 },
      { id: second.refundId, status: "completed", amount_agorot: 8000 },
    ])
  }, 60_000)
})
