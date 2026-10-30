// Story 6.6: the acceptance suite, "intro, sessions and waiting list" (SI1,
// SI4). Each test proves a claim the story-by-story tests left missing or
// weak (T25, T26 of the spec's coverage map). Everything runs in
// inRollback; the job test checks afterwards that nothing of it was kept.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
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

const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const PREVIEW =
  "select public.preview_admin_approve_payment($1, $2, $3, $4, $5, $6::date, $7) as r"
const ITEMS = "select public.admin_get_attention_items() as r"
const CHOOSE = "select public.choose_credit_outcome($1, $2, $3) as r"
const MY_CREDITS = "select public.get_my_credits() as r"

type Fixture = MoneyFixture & { mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2, last_places_threshold = 4`
  )
  // Only this test's sessions are "the next sessions".
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where theme_key = 'mothers' and archived_at is null limit 1"
  )
  return { ...f, mothers: rows[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// As the owner: a pinned product (validity_mode session, every weekday).
async function insertPinned(db: Db, type: "single" | "intro"): Promise<string> {
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, intro_only)
     values ($1, $2, 12800, 1, 'session', null, null, 'regular', 1, $3)
     returning id`,
    [testName(type), type, type === "intro"]
  )
  return rows[0].id
}

// As the owner: a published regular session at 10:00 local, `dayOffset`
// local days from today, open until it starts.
async function insertEvent(
  db: Db,
  f: Fixture,
  dayOffset: number
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $2::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [f.mothers, dayOffset]
  )
  return rows[0].id
}

function pinnedInput(
  f: Fixture,
  productId: string,
  eventId: string,
  customerId: string | null
) {
  return {
    customerId,
    productId,
    eventId,
    amount: 12800,
    paidOn: f.today,
    methodId: f.method,
    duplicateConfirmed: true,
    key: randomUUID(),
  }
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

describe("SI1: one intro at a time", () => {
  it("T25: an intro booked and cancelled to a credit still blocks a second intro: INTRO_NOT_ELIGIBLE at approval and preview, no payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const intro = await insertPinned(db, "intro")
      const first = await insertEvent(db, f, 7)
      const second = await insertEvent(db, f, 9)

      const r = await as(db, f.admin, () =>
        approve(db, pinnedInput(f, intro, first, f.customerA))
      )
      const cancelled = await as(
        db,
        f.customerA,
        async () =>
          (await db.query(CANCEL, [r.booking_id, randomUUID(), "credit"]))
            .rows[0].r
      )
      expect(cancelled).toBeTruthy()
      const { rows: credits } = await db.query(
        "select status from public.cancellation_credits where origin_booking_id = $1",
        [r.booking_id]
      )
      expect(credits).toEqual([{ status: "active" }])
      const { rows: booking } = await db.query(
        "select status from public.bookings where id = $1",
        [r.booking_id]
      )
      expect(booking).toEqual([{ status: "cancelled" }])

      expect(
        await as(db, f.admin, () =>
          queryError(
            db,
            APPROVE,
            approveParams(pinnedInput(f, intro, second, f.customerA))
          )
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      expect(
        await as(db, f.admin, () =>
          queryError(db, PREVIEW, [
            f.customerA,
            null,
            intro,
            second,
            12800,
            f.today,
            f.method,
          ])
        )
      ).toMatchObject({ code: "P0001", message: "INTRO_NOT_ELIGIBLE" })
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          intro,
        ])
      ).toBe(1)
      expect(
        await count(
          db,
          "select 1 from public.bookings where customer_id = $1 and event_id = $2",
          [f.customerA, second]
        )
      ).toBe(0)
    })
  })
})

describe("SI4: no deadline to choose after a business cancel", () => {
  it("T26: 30 days and every job later, the credit is still choice_pending and to handle, and she can still ask for a refund; nothing kept after the rollback", async () => {
    const ids = await inRollback(async (db) => {
      const f = await seed(db)
      const single = await insertPinned(db, "single")
      const ev = await insertEvent(db, f, 5)
      const sessions = [
        ev,
        await insertEvent(db, f, 6),
        await insertEvent(db, f, 7),
        await insertEvent(db, f, 3),
      ]
      const r = await as(db, f.admin, () =>
        approve(db, pinnedInput(f, single, ev, f.customerA))
      )
      await as(db, f.admin, () =>
        db.query("select public.admin_cancel_event($1, true, $2, $3)", [
          ev,
          testName("message"),
          randomUUID(),
        ])
      )
      const { rows: credits } = await db.query(
        "select id, choice_pending from public.cancellation_credits where origin_booking_id = $1",
        [r.booking_id]
      )
      expect(credits).toEqual([
        { id: expect.any(String), choice_pending: true },
      ])
      const creditId = credits[0].id as string

      // Every session of the test moves 30 days back; the jobs run (as the
      // owner, like pg_cron).
      await db.query(
        `update public.events
         set starts_at = starts_at - interval '30 days',
             ends_at = ends_at - interval '30 days',
             registration_closes_at = registration_closes_at - interval '30 days'
         where id = any($1::uuid[])`,
        [sessions]
      )
      // The credit and its notices age too, so a deadline keyed on the
      // credit's own dates would show.
      await db.query(
        `update public.cancellation_credits
         set created_at = created_at - interval '30 days',
             original_cancelled_at = original_cancelled_at - interval '30 days',
             origin_starts_at = origin_starts_at - interval '30 days'
         where id = $1`,
        [creditId]
      )
      await db.query(
        "update public.notifications set created_at = created_at - interval '30 days' where recipient_id = $1",
        [f.customerA]
      )
      for (const job of [
        "job_complete_events",
        "job_refresh_credit_options",
        "job_expiry_alerts",
        "job_cleanup",
      ]) {
        await db.query(`select private.${job}()`)
      }

      const { rows: after } = await db.query(
        "select status, choice_pending from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(after).toEqual([{ status: "active", choice_pending: true }])
      const items = await as(
        db,
        f.admin,
        async () => (await db.query(ITEMS)).rows[0].r
      )
      expect(
        items
          .filter((i: { id: string }) => i.id === creditId)
          .map((i: { kind: string }) => i.kind)
      ).toEqual(["choice_pending"])
      const mine = await as(
        db,
        f.customerA,
        async () => (await db.query(MY_CREDITS)).rows[0].r
      )
      expect(mine).toEqual([
        expect.objectContaining({ credit_id: creditId, choice_pending: true }),
      ])

      const chosen = await as(
        db,
        f.customerA,
        async () =>
          (await db.query(CHOOSE, [creditId, "refund", randomUUID()])).rows[0].r
      )
      expect(chosen).toMatchObject({ credit_id: creditId, outcome: "refund" })
      const { rows: refunded } = await db.query(
        "select status, choice_pending from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(refunded).toEqual([
        { status: "refund_requested", choice_pending: false },
      ])
      expect(r.entitlement_id).toEqual(expect.any(String))
      return { customer: f.customerA, entitlement: r.entitlement_id as string }
    })

    // Nothing of the rolled-back jobs was kept.
    const [kept] = await sql<Record<string, number>>(
      `select
         (select count(*)::int from public.notifications where recipient_id = $1) as notifications,
         (select count(*)::int from public.notification_jobs j
            join public.notifications n on n.id = j.notification_id
            where n.recipient_id = $1) as jobs,
         (select count(*)::int from public.entitlements where id = $2) as entitlements,
         (select count(*)::int from public.audit_log where customer_id = $1) as audit`,
      [ids.customer, ids.entitlement]
    )
    expect(kept).toEqual({
      notifications: 0,
      jobs: 0,
      entitlements: 0,
      audit: 0,
    })
    const [queue] = await sql<{ exists: boolean }>(
      "select to_regclass('net.http_request_queue') is not null as exists"
    )
    if (queue.exists) {
      const [pending] = await sql<{ n: number }>(
        "select count(*)::int as n from net.http_request_queue where body::text like '%' || $1 || '%' or body::text like '%' || $2 || '%'",
        [ids.customer, ids.entitlement]
      )
      expect(pending.n).toBe(0)
    }
  }, 60_000)
})
