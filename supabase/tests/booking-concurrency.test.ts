// Story 3.2: two customers try to take the last place at once (CAP-13,
// AD-6). A books inside an open transaction; B's book_session waits on the
// session's row lock (seen in pg_stat_activity); A commits; B gets
// EVENT_FULL and her entry is not taken. This needs real commits, so the
// fixtures are inserted directly as the owner and removed in onCleanup.

import { randomUUID } from "node:crypto"

import type { QueryResult } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  onCleanup,
  sql,
  testName,
} from "./support/db"

const BOOK = "select public.book_session($1, $2) as r"

describe("the last place under concurrency", () => {
  it("one customer is confirmed, the other gets EVENT_FULL and keeps her entry", async () => {
    const customerA = randomUUID()
    const customerB = randomUUID()
    const recorder = randomUUID()
    const product = randomUUID()
    const method = randomUUID()
    const eventId = randomUUID()
    const customers = [customerA, customerB]

    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        const entitlements =
          "select id from public.entitlements where customer_id = any($1::uuid[])"
        await client.query(
          "delete from public.notifications where recipient_id = any($1::uuid[])",
          [customers]
        )
        await client.query(
          "delete from public.audit_log where customer_id = any($1::uuid[]) or event_id = $2",
          [customers, eventId]
        )
        await client.query(
          "delete from private.idempotency_results where actor_scope = any($1::text[])",
          [customers]
        )
        await client.query(
          "delete from public.booking_allocations where booking_id in (select id from public.bookings where event_id = $1)",
          [eventId]
        )
        // entitlement_movements is append-only (a trigger raises on delete);
        // the trigger is off only inside this cleanup transaction.
        await client.query(
          "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          `delete from public.entitlement_movements where entitlement_id in (${entitlements})`,
          [customers]
        )
        await client.query(
          "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
        )
        await client.query("delete from public.bookings where event_id = $1", [
          eventId,
        ])
        await client.query(
          "delete from public.entitlements where customer_id = any($1::uuid[])",
          [customers]
        )
        await client.query(
          "delete from public.payments where customer_id = any($1::uuid[])",
          [customers]
        )
        await client.query("delete from public.events where id = $1", [eventId])
        await client.query("delete from public.products where id = $1", [
          product,
        ])
        await client.query("delete from public.payment_methods where id = $1", [
          method,
        ])
        await client.query(
          "delete from public.profiles where id = any($1::uuid[])",
          [customers]
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })

    // Committed fixtures: two customers, each with a card of 4 for any day
    // (valid from today for 49 days), and a published session with one
    // place, three days from now, open until it starts.
    await sql(
      `insert into public.profiles (id, full_name, activated_at)
       values ($1, $2, now()), ($3, $4, now())`,
      [customerA, testName("race_a"), customerB, testName("race_b")]
    )
    await sql(
      `insert into public.products (
         id, name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
      [product, testName("race_card")]
    )
    await sql(
      "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 905)",
      [method, testName("race_method")]
    )
    const entitlementOf: Record<string, string> = {}
    for (const customer of customers) {
      const [payment] = await sql<{ id: string }>(
        `insert into public.payments (
           customer_id, product_id, source, recorded_by, payment_method_id,
           amount_agorot, paid_on, product_snapshot)
         values ($1, $2, 'manual', $3, $4, 47200,
           (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
         returning id`,
        [customer, product, recorder, method]
      )
      const [entitlement] = await sql<{ id: string }>(
        `insert into public.entitlements (
           customer_id, payment_id, kind, original_units, valid_from,
           expires_on, eligibility_snapshot, allowed_weekdays,
           eligible_event_kind)
         values ($1, $2, 'card', 4,
           (now() at time zone 'Asia/Jerusalem')::date,
           (now() at time zone 'Asia/Jerusalem')::date + 49,
           '{"validity_mode": "days"}'::jsonb, null, 'regular')
         returning id`,
        [customer, payment.id]
      )
      await sql(
        `insert into public.entitlement_movements (entitlement_id, action, units)
         values ($1, 'grant', 4)`,
        [entitlement.id]
      )
      entitlementOf[customer] = entitlement.id
    }
    await sql(
      `insert into public.events (
         id, concept_id, kind, starts_at, ends_at, capacity_adults,
         registration_closes_at, registration_close_overridden, status)
       select $1, c.id, 'regular',
         ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem',
         ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '12:00') at time zone 'Asia/Jerusalem',
         1,
         ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem',
         true, 'published'
       from public.concepts c
       where c.theme_key = 'mothers'
       limit 1`,
      [eventId]
    )

    // Both pool connections (max: 2); while B waits only A queries.
    const a = await getPool().connect()
    const b = await getPool().connect()
    let committed = false
    let second: Promise<QueryResult> | undefined
    try {
      await a.query("begin")
      await asAuthenticated(a, customerA)
      const first = await a.query(BOOK, [eventId, randomUUID()])
      expect(first.rows[0].r).toEqual({ booking_id: expect.any(String) })

      await b.query("begin")
      await asAuthenticated(b, customerB)
      const { rows: pidRows } = await b.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      )
      const bPid = pidRows[0].pid

      second = b.query(BOOK, [eventId, randomUUID()])
      // Keep a rejection of B from going unhandled while it is not awaited.
      second.catch(() => {})

      // From A, as the owner (authenticated cannot see another backend in
      // pg_stat_activity): B must be waiting on a lock. The stats snapshot
      // is cached per transaction, so clear it each try.
      await a.query("reset role")
      let waitsOnLock = false
      for (let tries = 0; tries < 50 && !waitsOnLock; tries++) {
        await a.query("select pg_stat_clear_snapshot()")
        const { rows } = await a.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid = $1",
          [bPid]
        )
        waitsOnLock = rows[0]?.wait_event_type === "Lock"
        if (!waitsOnLock) await new Promise((r) => setTimeout(r, 100))
      }
      expect(waitsOnLock).toBe(true)

      await a.query("commit")
      committed = true

      await expect(second).rejects.toMatchObject({
        code: "P0001",
        message: "EVENT_FULL",
      })
    } finally {
      // A rollback of A releases B; B must finish before it goes back.
      if (!committed) await a.query("rollback").catch(() => {})
      await second?.catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }

    const bookings = await sql<{ customer_id: string; status: string }>(
      "select customer_id, status from public.bookings where event_id = $1",
      [eventId]
    )
    expect(bookings).toEqual([{ customer_id: customerA, status: "confirmed" }])
    const balances = await sql<{
      entitlement_id: string
      available: number
      reserved: number
    }>(
      `select entitlement_id, available, reserved from public.entitlement_balances
       where entitlement_id = any($1::uuid[])`,
      [Object.values(entitlementOf)]
    )
    const byId = Object.fromEntries(balances.map((b) => [b.entitlement_id, b]))
    expect(byId[entitlementOf[customerA]]).toMatchObject({
      available: 3,
      reserved: 1,
    })
    expect(byId[entitlementOf[customerB]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 30_000)
})
