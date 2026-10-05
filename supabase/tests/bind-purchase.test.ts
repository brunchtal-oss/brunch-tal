// Story 2.2: private.bind_purchase is the only binder of a purchase (AD-10).
// Every table in public with a customer_id column is either filled by it
// (BOUND) or never has a row before the purchase is bound (NOT_BEFORE_BIND).
// A new table with customer_id fails here until it is classified: bound in
// private.bind_purchase (E3: bookings, cancellation_credits,
// refund_requests) or listed with the reason.

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
import { approve, seedMoney, type MoneyFixture } from "./support/money"

// As the owner: a published session in a week and a booking without a
// customer on the payment (a pinned purchase that is not bound yet, AD-23;
// placed by 3.11).
async function unboundBooking(
  db: Db,
  paymentId: string
): Promise<{ eventId: string; bookingId: string }> {
  const { rows: events } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     select c.id, 'regular', now() + interval '7 days',
       now() + interval '7 days 2 hours', 12, now() + interval '6 days',
       'published'
     from public.concepts c where c.theme_key = 'mothers' limit 1
     returning id`
  )
  const { rows: bookings } = await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     values ($1, $2, 1, 'admin',
       '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)
     returning id`,
    [paymentId, events[0].id]
  )
  return { eventId: events[0].id, bookingId: bookings[0].id }
}

async function approveCard(db: Db, f: MoneyFixture): Promise<string> {
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
  })
  await db.query("reset role")
  return r.payment_id as string
}

// Filled by private.bind_purchase from the payment.
const BOUND = ["bookings", "entitlements", "payments"]

// Created only for a customer who already exists, never for an unbound
// purchase.
const NOT_BEFORE_BIND = [
  // Rows of the customer's own profile (join_complete, then self-service).
  "babies",
  // Filled when the link is consumed, in the same transaction as the bind.
  "activation_tokens",
  // Each row records the customer it was written for at that time.
  "audit_log",
]

const CUSTOMER_TABLES = `
  select c.table_name as name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name = 'customer_id'
    and t.table_type = 'BASE TABLE'
  order by 1`

async function customerTables(db?: Db): Promise<string[]> {
  const rows = db
    ? (await db.query(CUSTOMER_TABLES)).rows
    : await sql(CUSTOMER_TABLES)
  return rows.map((row) => row.name as string)
}

function unclassified(tables: string[]): string[] {
  return tables.filter(
    (name) => !BOUND.includes(name) && !NOT_BEFORE_BIND.includes(name)
  )
}

describe("bind_purchase coverage", () => {
  it("classifies every public table with customer_id", async () => {
    const tables = await customerTables()
    expect(unclassified(tables)).toEqual([])
    // The lists name only tables that exist.
    expect([...BOUND, ...NOT_BEFORE_BIND].sort()).toEqual(tables)
  })

  it("fails for a new table with customer_id", async () => {
    await inRollback(async (db) => {
      await db.query(
        "create table public.bind_check_new (id uuid primary key, customer_id uuid)"
      )
      expect(unclassified(await customerTables(db))).toEqual(["bind_check_new"])
    })
  })

  it("fills customer_id on every BOUND row of the payment", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const paymentId = await approveCard(db, f)
      const { bookingId } = await unboundBooking(db, paymentId)

      await db.query("select private.bind_purchase($1, $2)", [
        paymentId,
        f.customerA,
      ])

      const lookup: Record<string, string> = {
        payments: "id = $1",
        entitlements: "payment_id = $1",
        bookings: "payment_id = $1",
      }
      for (const table of BOUND) {
        const { rows } = await db.query(
          `select customer_id from public.${table} where ${lookup[table]}`,
          [paymentId]
        )
        expect(rows.length, table).toBeGreaterThan(0)
        expect(rows.every((row) => row.customer_id === f.customerA)).toBe(true)
      }

      // The booking's audit row and the booking_confirmed skipped while there
      // was no customer (AD-23).
      const { rows: audit } = await db.query(
        "select action, customer_id from public.audit_log where entity_id = $1",
        [bookingId]
      )
      expect(audit).toEqual([
        { action: "bind_purchase", customer_id: f.customerA },
      ])
      const { rows: notifications } = await db.query(
        "select dedupe_key from public.notifications where recipient_id = $1 and type = 'booking_confirmed'",
        [f.customerA]
      )
      expect(notifications).toEqual([
        { dedupe_key: `booking_confirmed:${f.customerA}:${bookingId}` },
      ])
    })
  })

  it("a customer already booked to that session -> BIND_CONFLICT, nothing bound", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const paymentId = await approveCard(db, f)
      const { eventId } = await unboundBooking(db, paymentId)
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)`,
        [f.customerA, eventId]
      )

      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          paymentId,
          f.customerA,
        ])
      ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })

      for (const [table, column] of [
        ["payments", "id"],
        ["entitlements", "payment_id"],
        ["bookings", "payment_id"],
      ]) {
        const { rows } = await db.query(
          `select customer_id from public.${table} where ${column} = $1`,
          [paymentId]
        )
        expect(rows, table).toEqual([{ customer_id: null }])
      }
    })
  })

  // Story 3.11: the intro is checked again at the bind.
  it("an intro for a customer who took part or has another active intro -> BIND_CONFLICT, nothing bound", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows: products } = await db.query(
        `insert into public.products (
           name, type, price_agorot, units, validity_mode, validity_days,
           allowed_weekdays, eligible_event_kind, party_size, intro_only)
         values ($1, 'intro', 11800, 1, 'session', null, null, 'regular', 1, true)
         returning id`,
        [testName("intro")]
      )
      const intro = products[0].id
      const session = async (days: number) => {
        const { rows } = await db.query(
          `insert into public.events (
             concept_id, kind, starts_at, ends_at, capacity_adults,
             registration_closes_at, status)
           select c.id, 'regular', now() + make_interval(days => $1::int),
             now() + make_interval(days => $1::int) + interval '2 hours', 12,
             now() + make_interval(days => $1::int), 'published'
           from public.concepts c where c.theme_key = 'mothers' limit 1
           returning id`,
          [days]
        )
        return rows[0].id as string
      }
      const approveIntro = async (
        eventId: string,
        customerId: string | null
      ) => {
        await asAuthenticated(db, f.admin)
        const r = await approve(db, {
          customerId,
          productId: intro,
          eventId,
          amount: 11800,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
        await db.query("reset role")
        return r.payment_id as string
      }

      // Customer A took part (a confirmed booking for a session that ended).
      const past = await session(-3)
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)`,
        [f.customerA, past]
      )
      // Customer B has an active intro.
      await approveIntro(await session(10), f.customerB)

      for (const customerId of [f.customerA, f.customerB]) {
        const paymentId = await approveIntro(await session(7), null)
        expect(
          await queryError(db, "select private.bind_purchase($1, $2)", [
            paymentId,
            customerId,
          ]),
          customerId
        ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })
        for (const [table, column] of [
          ["payments", "id"],
          ["entitlements", "payment_id"],
          ["bookings", "payment_id"],
        ]) {
          const { rows } = await db.query(
            `select customer_id from public.${table} where ${column} = $1`,
            [paymentId]
          )
          expect(rows, table).toEqual([{ customer_id: null }])
        }
      }
    })
  })
})
