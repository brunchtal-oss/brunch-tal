// Story 5.20: the re-checks after a lock that only a real race reaches.
// Each RPC reads the customer (or the bookings) without a lock, locks, and
// raises CONCURRENT_CHANGE when the row changed in between:
//   admin_cancel_event, admin_reschedule_event (3.8): a booking of a new
//     customer appeared while the session was locked;
//   admin_complete_refund (3.9): the refund request was bound to a customer;
//   admin_correct_entitlement, admin_settle_parked_purchase (3.13): the
//     entitlement was bound to a customer.
// And private.job_complete_events (5.10): a credit that funds a booking is
// locked by another transaction, so the session is skipped (CREDIT_LOCKED,
// caught per session) and completed on the next run.
//
// A holder transaction takes the row lock and changes the row; the RPC runs
// in a second transaction until it waits on that lock (pg_stat_activity);
// then the holder commits. The fixtures are committed raw rows (named
// test_, story 5.20 fix 8) and removed in onCleanup; the RPC transactions
// always roll back.

import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  inRollback,
  onCleanup,
  sql,
  testName,
} from "./support/db"

const POLICY = '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'

// Every committed id, removed in foreign-key order after the file.
const made = {
  admins: [] as string[],
  customers: [] as string[],
  products: [] as string[],
  methods: [] as string[],
  events: [] as string[],
  payments: [] as string[],
  entitlements: [] as string[],
  credits: [] as string[],
}

let cleanupRegistered = false
function registerCleanup(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  onCleanup(async () => {
    const client = await getPool().connect()
    try {
      await client.query("begin")
      const q = (text: string, values: unknown[]) => client.query(text, values)
      const all = [
        ...made.customers,
        ...made.events,
        ...made.payments,
        ...made.entitlements,
        ...made.credits,
      ]
      await q(
        `delete from public.notifications
         where recipient_id = any($1::uuid[])`,
        [made.customers]
      )
      await q(
        `delete from public.audit_log
         where customer_id = any($1::uuid[]) or event_id = any($2::uuid[])
            or entity_id = any($3::uuid[])`,
        [made.customers, made.events, all]
      )
      await q(
        `delete from private.idempotency_results
         where actor_scope = any($1::text[])`,
        [[...made.admins, ...made.customers]]
      )
      await q(
        `delete from public.refund_requests
         where credit_id = any($1::uuid[]) or payment_id = any($2::uuid[])`,
        [made.credits, made.payments]
      )
      await q(
        `delete from public.credit_options where credit_id = any($1::uuid[])`,
        [made.credits]
      )
      await q(
        `delete from public.booking_allocations
         where credit_id = any($1::uuid[]) or entitlement_id = any($2::uuid[])
            or booking_id in (
              select b.id from public.bookings b where b.event_id = any($3::uuid[]))`,
        [made.credits, made.entitlements, made.events]
      )
      // entitlement_movements is append-only (a trigger raises on delete);
      // off only inside this cleanup transaction. Only a run of the real
      // job could have written one.
      await client.query(
        "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
      )
      await q(
        `delete from public.entitlement_movements
         where entitlement_id = any($1::uuid[])`,
        [made.entitlements]
      )
      await client.query(
        "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
      )
      await q(
        `delete from public.cancellation_credits where id = any($1::uuid[])`,
        [made.credits]
      )
      await q(
        `delete from public.bookings
         where event_id = any($1::uuid[]) or payment_id = any($2::uuid[])`,
        [made.events, made.payments]
      )
      await q(`delete from public.entitlements where id = any($1::uuid[])`, [
        made.entitlements,
      ])
      await q(
        `delete from public.activation_tokens where payment_id = any($1::uuid[])`,
        [made.payments]
      )
      await q(`delete from public.payments where id = any($1::uuid[])`, [
        made.payments,
      ])
      await q(`delete from public.events where id = any($1::uuid[])`, [
        made.events,
      ])
      await q(`delete from public.products where id = any($1::uuid[])`, [
        made.products,
      ])
      await q(`delete from public.payment_methods where id = any($1::uuid[])`, [
        made.methods,
      ])
      await q(`delete from public.profiles where id = any($1::uuid[])`, [
        made.customers,
      ])
      await q(
        `delete from public.admin_roles where user_id = any($1::uuid[])`,
        [made.admins]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })
}

// ---- Committed raw fixtures -------------------------------------------------

async function admin(): Promise<string> {
  registerCleanup()
  const id = randomUUID()
  made.admins.push(id)
  await sql("insert into public.admin_roles (user_id) values ($1)", [id])
  return id
}

async function customer(label: string): Promise<string> {
  registerCleanup()
  const id = randomUUID()
  made.customers.push(id)
  await sql(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [id, testName(label)]
  )
  return id
}

// A published session `days` local days from today at 10:00 (negative: in
// the past, already ended).
async function session(days: number): Promise<string> {
  registerCleanup()
  const id = randomUUID()
  made.events.push(id)
  await sql(
    `insert into public.events (
       id, description, concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, c.id, 'regular', s.t, s.t + interval '2 hours', 12, s.t,
       true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $3::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     cross join lateral (
       select c.id from public.concepts c where c.theme_key = 'mothers' limit 1
     ) c`,
    [id, testName("race_session"), days]
  )
  return id
}

// A payment and its entitlement, for `customerId` (null: not bound yet). A
// pinned one (validity_mode session) belongs to `pinnedEventId`.
async function purchase(
  adminId: string,
  customerId: string | null,
  pinnedEventId: string | null = null
): Promise<{ payment: string; entitlement: string }> {
  registerCleanup()
  const product = randomUUID()
  const method = randomUUID()
  made.products.push(product)
  made.methods.push(method)
  await sql(
    `insert into public.products (
       id, name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, $3, 12800, 1, $4, $5, null, 'regular', 1)`,
    pinnedEventId
      ? [product, testName("race_single"), "single", "session", null]
      : [product, testName("race_card"), "card", "days", 49]
  )
  await sql(
    "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 908)",
    [method, testName("race_method")]
  )
  const [payment] = await sql<{ id: string }>(
    `insert into public.payments (
       customer_id, product_id, source, recorded_by, payment_method_id,
       amount_agorot, paid_on, product_snapshot)
     values ($1, $2, 'manual', $3, $4, 12800,
       (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
     returning id`,
    [customerId, product, adminId, method]
  )
  made.payments.push(payment.id)
  const [entitlement] = await sql<{ id: string }>(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       eligibility_snapshot, allowed_weekdays, eligible_event_kind,
       pinned_event_id)
     values ($1, $2, $3, 1,
       (now() at time zone 'Asia/Jerusalem')::date,
       (now() at time zone 'Asia/Jerusalem')::date + 49,
       jsonb_build_object('validity_mode', $4::text, 'product_id', $5::uuid),
       null, 'regular', $6)
     returning id`,
    [
      customerId,
      payment.id,
      pinnedEventId ? "single" : "card",
      pinnedEventId ? "session" : "days",
      product,
      pinnedEventId,
    ]
  )
  made.entitlements.push(entitlement.id)
  return { payment: payment.id, entitlement: entitlement.id }
}

// A booking on `eventId` (cancelled: the origin of a credit).
async function booking(
  eventId: string,
  customerId: string | null,
  paymentId: string | null,
  status: "confirmed" | "cancelled"
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.bookings (
       customer_id, payment_id, event_id, party_size, status, booked_by,
       policy_snapshot, cancelled_at)
     values ($1, $2, $3, 1, $4, 'admin', $5::jsonb,
       case when $4 = 'cancelled' then now() end)
     returning id`,
    [customerId, paymentId, eventId, status, POLICY]
  )
  return row.id
}

// A cancellation credit of the booking `originId` (cancelled).
async function credit(
  customerId: string | null,
  originId: string,
  entitlementId: string,
  status: "active" | "refund_requested"
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.cancellation_credits (
       customer_id, origin_booking_id, source_entitlement_id, event_kind,
       party_size, options_count, origin_starts_at, original_cancelled_at,
       monetary_basis_agorot, status)
     values ($1, $2, $3, 'regular', 1, 2, now() + interval '5 days', now(),
       12800, $4)
     returning id`,
    [customerId, originId, entitlementId, status]
  )
  made.credits.push(row.id)
  return row.id
}

// ---- The race ---------------------------------------------------------------

// From `watcher`, as the owner: waits until `pid` waits on a lock (as
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

/**
 * The holder runs `hold` (takes the lock and changes the row) and keeps its
 * transaction open; the admin's RPC call runs until it waits on that lock;
 * the holder commits; the RPC's error (SQL message) is returned, or null.
 * The RPC's transaction always rolls back.
 */
async function raceError(
  adminId: string,
  hold: (holder: PoolClient) => Promise<unknown>,
  call: string,
  params: unknown[]
): Promise<string | null> {
  const holder = await getPool().connect()
  const caller = await getPool().connect()
  let pending: Promise<unknown> | undefined
  let committed = false
  try {
    await holder.query("begin")
    await hold(holder)

    await caller.query("begin")
    await asAuthenticated(caller, adminId)
    const { rows } = await caller.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    )
    pending = caller.query(call, params)
    pending.catch(() => {})

    expect(await waitsOnLock(holder, rows[0].pid)).toBe(true)
    await holder.query("commit")
    committed = true

    try {
      await pending
      return null
    } catch (error) {
      return (error as Error).message
    }
  } finally {
    if (!committed) await holder.query("rollback").catch(() => {})
    await pending?.catch(() => {})
    await caller.query("rollback").catch(() => {})
    holder.release()
    caller.release()
  }
}

describe(
  "CONCURRENT_CHANGE after the lock (story 5.20)",
  { timeout: 60_000 },
  () => {
    it("admin_cancel_event: a booking of a new customer appeared while the session was locked", async () => {
      const adminId = await admin()
      const newcomer = await customer("race_newcomer")
      const eventId = await session(5)

      const error = await raceError(
        adminId,
        async (holder) => {
          await holder.query(
            "select 1 from public.events where id = $1 for update",
            [eventId]
          )
          await holder.query(
            `insert into public.bookings (
             customer_id, event_id, party_size, status, booked_by, policy_snapshot)
           values ($1, $2, 1, 'confirmed', 'admin', $3::jsonb)`,
            [newcomer, eventId, POLICY]
          )
        },
        "select public.admin_cancel_event($1, true, $2, $3, true) as r",
        [eventId, "המפגש בוטל", randomUUID()]
      )
      expect(error).toBe("CONCURRENT_CHANGE")
      // Nothing was cancelled.
      const [event] = await sql<{ status: string }>(
        "select status from public.events where id = $1",
        [eventId]
      )
      expect(event.status).toBe("published")
    })

    it("admin_reschedule_event: a booking of a new customer appeared while the session was locked", async () => {
      const adminId = await admin()
      const newcomer = await customer("race_newcomer_r")
      const eventId = await session(5)
      const [times] = await sql<{ starts_at: string; ends_at: string }>(
        `select (starts_at + interval '1 day')::text as starts_at,
              (ends_at + interval '1 day')::text as ends_at
       from public.events where id = $1`,
        [eventId]
      )

      const error = await raceError(
        adminId,
        async (holder) => {
          await holder.query(
            "select 1 from public.events where id = $1 for update",
            [eventId]
          )
          await holder.query(
            `insert into public.bookings (
             customer_id, event_id, party_size, status, booked_by, policy_snapshot)
           values ($1, $2, 1, 'confirmed', 'admin', $3::jsonb)`,
            [newcomer, eventId, POLICY]
          )
        },
        "select public.admin_reschedule_event($1, $2, $3, true, $4, $5) as r",
        [eventId, times.starts_at, times.ends_at, "המפגש הוזז", randomUUID()]
      )
      expect(error).toBe("CONCURRENT_CHANGE")
    })

    it("admin_complete_refund: the request was bound to a customer after the unlocked read", async () => {
      const adminId = await admin()
      const bound = await customer("race_refund")
      const eventId = await session(5)
      // An unbound purchase whose place was cancelled with a refund request.
      const { payment, entitlement } = await purchase(adminId, null)
      const origin = await booking(eventId, null, payment, "cancelled")
      const creditId = await credit(
        null,
        origin,
        entitlement,
        "refund_requested"
      )
      const [request] = await sql<{ id: string }>(
        `insert into public.refund_requests (
         customer_id, credit_id, payment_id, booking_id, amount_agorot)
       values (null, $1, $2, $3, 12800)
       returning id`,
        [creditId, payment, origin]
      )

      const error = await raceError(
        adminId,
        // bind_purchase's step: the request gets her id.
        (holder) =>
          holder.query(
            "update public.refund_requests set customer_id = $2 where id = $1",
            [request.id, bound]
          ),
        `select public.admin_complete_refund(
         $1, (now() at time zone 'Asia/Jerusalem')::date, 12800, null, true, $2
       ) as r`,
        [request.id, randomUUID()]
      )
      expect(error).toBe("CONCURRENT_CHANGE")
      const [after] = await sql<{ status: string }>(
        "select status from public.refund_requests where id = $1",
        [request.id]
      )
      expect(after.status).toBe("requested")
    })

    it("admin_correct_entitlement: the entitlement was bound to a customer after the unlocked read", async () => {
      const adminId = await admin()
      const bound = await customer("race_correct")
      const { entitlement } = await purchase(adminId, null)

      const error = await raceError(
        adminId,
        (holder) =>
          holder.query(
            "update public.entitlements set customer_id = $2, bound_at = now() where id = $1",
            [entitlement, bound]
          ),
        "select public.admin_correct_entitlement($1, 'expires_on', $2::jsonb, null, null, true, $3) as r",
        [entitlement, JSON.stringify("2099-01-01"), randomUUID()]
      )
      expect(error).toBe("CONCURRENT_CHANGE")
      const [after] = await sql<{ expires_on: string }>(
        "select expires_on::text from public.entitlements where id = $1",
        [entitlement]
      )
      expect(after.expires_on).not.toBe("2099-01-01")
    })

    it("admin_settle_parked_purchase: the parked entitlement was bound to a customer after the unlocked read", async () => {
      const adminId = await admin()
      const bound = await customer("race_settle")
      const eventId = await session(5)
      // Paid without a place (3.11 'park'): pinned, no booking on its payment.
      const { entitlement } = await purchase(adminId, null, eventId)

      const error = await raceError(
        adminId,
        (holder) =>
          holder.query(
            "update public.entitlements set customer_id = $2, bound_at = now() where id = $1",
            [entitlement, bound]
          ),
        "select public.admin_settle_parked_purchase($1, null, true, $2) as r",
        [entitlement, randomUUID()]
      )
      expect(error).toBe("CONCURRENT_CHANGE")
      const [after] = await sql<{ n: number }>(
        "select count(*)::integer as n from public.cancellation_credits where source_entitlement_id = $1",
        [entitlement]
      )
      expect(after.n).toBe(0)
    })
  }
)

describe(
  "job_complete_events and a locked credit (story 5.10)",
  { timeout: 60_000 },
  () => {
    it("a session whose booking a locked credit funds is skipped (CREDIT_LOCKED), then completed on the next run", async () => {
      const adminId = await admin()
      const owner = await customer("race_credit")
      const originEvent = await session(5)
      const { payment, entitlement } = await purchase(adminId, owner)
      const origin = await booking(originEvent, owner, payment, "cancelled")
      const creditId = await credit(owner, origin, entitlement, "active")

      // The real complete_events cron also runs on the dev database and may
      // complete the ended session before the lock; then a new one is tried.
      let ended: string | null = null
      let bookingId = ""
      for (let attempt = 0; attempt < 3 && ended === null; attempt++) {
        // A cron run that completed an earlier attempt used the credit.
        await sql(
          "update public.cancellation_credits set status = 'active' where id = $1",
          [creditId]
        )
        const candidate = await session(-1)
        const candidateBooking = await booking(
          candidate,
          owner,
          null,
          "confirmed"
        )
        await sql(
          "insert into public.booking_allocations (booking_id, credit_id, units) values ($1, $2, 1)",
          [candidateBooking, creditId]
        )
        const holder = await getPool().connect()
        try {
          await holder.query("begin")
          // Another transaction holds the credit (e.g. a refund of it).
          await holder.query(
            "select 1 from public.cancellation_credits where id = $1 for update",
            [creditId]
          )
          const { rows } = await holder.query<{ status: string }>(
            "select status from public.events where id = $1",
            [candidate]
          )
          if (rows[0]?.status !== "published") continue
          ended = candidate
          bookingId = candidateBooking

          await inRollback(async (db) => {
            await db.query("select private.job_complete_events()")
            const { rows: state } = await db.query(
              `select e.status as event, b.status as booking, c.status as credit
             from public.events e, public.bookings b, public.cancellation_credits c
             where e.id = $1 and b.id = $2 and c.id = $3`,
              [candidate, candidateBooking, creditId]
            )
            expect(state).toEqual([
              { event: "published", booking: "confirmed", credit: "active" },
            ])
          })
        } finally {
          await holder.query("rollback").catch(() => {})
          holder.release()
        }
      }

      expect(ended).not.toBeNull()
      await inRollback(async (db) => {
        await db.query("select private.job_complete_events()")
        const { rows: state } = await db.query(
          `select e.status as event, b.status as booking, c.status as credit
         from public.events e, public.bookings b, public.cancellation_credits c
         where e.id = $1 and b.id = $2 and c.id = $3`,
          [ended, bookingId, creditId]
        )
        expect(state).toEqual([
          { event: "completed", booking: "completed", credit: "used" },
        ])
      })
    })
  }
)
