// Story 3.2: two customers try to take the last place at once (CAP-13,
// AD-6). A books inside an open transaction; B's book_session waits on the
// session's row lock (seen in pg_stat_activity); A commits; B gets
// EVENT_FULL and her entry is not taken. Story 3.3 adds the same race with
// book_sessions, and a request that waits on a lock past the registration
// close (the close is checked against clock_timestamp() after the locks).
// Story 3.4 adds Tal (admin_book_customer) and a customer on the last place.
// This needs real commits, so the fixtures are inserted directly as the
// owner and removed in onCleanup.

import { randomUUID } from "node:crypto"

import type { PoolClient, QueryResult } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  onCleanup,
  sql,
  testName,
} from "./support/db"

const BOOK = "select public.book_session($1, $2) as r"
const BOOK_MANY = "select public.book_sessions($1::uuid[], $2) as r"
const ADMIN_BOOK = "select public.admin_book_customer($1, $2, $3) as r"

type Race = {
  customerA: string
  customerB: string
  entitlementOf: Record<string, string>
}

// Committed fixtures: two customers, each with a card of 4 for any day
// (valid from today for 49 days), removed in onCleanup with every session
// of `eventIds` (insert them with insertEvent).
async function seedRace(label: string, eventIds: string[]): Promise<Race> {
  const customerA = randomUUID()
  const customerB = randomUUID()
  const recorder = randomUUID()
  const product = randomUUID()
  const method = randomUUID()
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
        "delete from public.audit_log where customer_id = any($1::uuid[]) or event_id = any($2::uuid[])",
        [customers, eventIds]
      )
      await client.query(
        "delete from private.idempotency_results where actor_scope = any($1::text[])",
        [customers]
      )
      await client.query(
        "delete from public.booking_allocations where booking_id in (select id from public.bookings where event_id = any($1::uuid[]))",
        [eventIds]
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
      await client.query(
        "delete from public.bookings where event_id = any($1::uuid[])",
        [eventIds]
      )
      await client.query(
        "delete from public.entitlements where customer_id = any($1::uuid[])",
        [customers]
      )
      await client.query(
        "delete from public.payments where customer_id = any($1::uuid[])",
        [customers]
      )
      await client.query(
        "delete from public.events where id = any($1::uuid[])",
        [eventIds]
      )
      await client.query("delete from public.products where id = $1", [product])
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

  await sql(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now())`,
    [customerA, testName(`${label}_a`), customerB, testName(`${label}_b`)]
  )
  await sql(
    `insert into public.products (
       id, name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
    [product, testName(`${label}_card`)]
  )
  await sql(
    "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 905)",
    [method, testName(`${label}_method`)]
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
  return { customerA, customerB, entitlementOf }
}

// A committed published session three days from now. closesIn: the close
// is set by hand that many seconds from now; otherwise open until it starts.
async function insertEvent(
  eventId: string,
  options: { capacity: number; closesIn?: number }
): Promise<void> {
  await sql(
    `insert into public.events (
       id, concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, c.id, 'regular',
       ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem',
       ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '12:00') at time zone 'Asia/Jerusalem',
       $2,
       coalesce(
         now() + make_interval(secs => $3::int),
         ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem'
       ),
       true, 'published'
     from public.concepts c
     where c.theme_key = 'mothers'
     limit 1`,
    [eventId, options.capacity, options.closesIn ?? null]
  )
}

// From `watcher`, as the owner (authenticated cannot see another backend in
// pg_stat_activity): waits until `pid` waits on a lock. The stats snapshot
// is cached per transaction, so it is cleared each try.
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

async function balances(race: Race) {
  const rows = await sql<{
    entitlement_id: string
    available: number
    reserved: number
  }>(
    `select entitlement_id, available, reserved from public.entitlement_balances
     where entitlement_id = any($1::uuid[])`,
    [Object.values(race.entitlementOf)]
  )
  return Object.fromEntries(rows.map((b) => [b.entitlement_id, b]))
}

// A holds the race (a booking, or a lock on the sessions) in an open
// transaction; B, as `customer`, runs `query` and must wait on a lock;
// `beforeRelease` runs while B waits; then A commits (or rolls back) and B's
// result is returned (a rejection as { error }).
async function race(options: {
  hold: (a: PoolClient) => Promise<void>
  customer: string
  query: string
  params: unknown[]
  // Runs in B's transaction before B sends `query`.
  beforeQuery?: (b: PoolClient) => Promise<void>
  beforeRelease?: (a: PoolClient) => Promise<void>
  release: "commit" | "rollback"
}): Promise<{ value?: QueryResult; error?: unknown }> {
  // Both pool connections (max: 2); while B waits only A queries.
  const a = await getPool().connect()
  const b = await getPool().connect()
  let released = false
  let second: Promise<QueryResult> | undefined
  try {
    await a.query("begin")
    await options.hold(a)

    await b.query("begin")
    await asAuthenticated(b, options.customer)
    await options.beforeQuery?.(b)
    const { rows: pidRows } = await b.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    )
    second = b.query(options.query, options.params)
    // Keep a rejection of B from going unhandled while it is not awaited.
    second.catch(() => {})

    await a.query("reset role")
    expect(await waitsOnLock(a, pidRows[0].pid)).toBe(true)
    await options.beforeRelease?.(a)

    await a.query(options.release)
    released = true

    return await second.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
  } finally {
    // A rollback of A releases B; B must finish before it goes back.
    if (!released) await a.query("rollback").catch(() => {})
    await second?.catch(() => {})
    await b.query("rollback").catch(() => {})
    a.release()
    b.release()
  }
}

describe("the last place under concurrency", () => {
  it("one customer is confirmed, the other gets EVENT_FULL and keeps her entry", async () => {
    const eventId = randomUUID()
    const fixture = await seedRace("race", [eventId])
    await insertEvent(eventId, { capacity: 1 })

    const second = await race({
      hold: async (a) => {
        await asAuthenticated(a, fixture.customerA)
        const first = await a.query(BOOK, [eventId, randomUUID()])
        expect(first.rows[0].r).toEqual({ booking_id: expect.any(String) })
      },
      customer: fixture.customerB,
      query: BOOK,
      params: [eventId, randomUUID()],
      release: "commit",
    })
    expect(second.error).toMatchObject({
      code: "P0001",
      message: "EVENT_FULL",
    })

    const bookings = await sql<{ customer_id: string; status: string }>(
      "select customer_id, status from public.bookings where event_id = $1",
      [eventId]
    )
    expect(bookings).toEqual([
      { customer_id: fixture.customerA, status: "confirmed" },
    ])
    const byId = await balances(fixture)
    expect(byId[fixture.entitlementOf[fixture.customerA]]).toMatchObject({
      available: 3,
      reserved: 1,
    })
    expect(byId[fixture.entitlementOf[fixture.customerB]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 30_000)

  it("story 3.3: B books the last place with book_sessions: EVENT_FULL for that date, no entry taken", async () => {
    const eventId = randomUUID()
    const fixture = await seedRace("race_many", [eventId])
    await insertEvent(eventId, { capacity: 1 })

    const second = await race({
      hold: async (a) => {
        await asAuthenticated(a, fixture.customerA)
        await a.query(BOOK, [eventId, randomUUID()])
      },
      customer: fixture.customerB,
      query: BOOK_MANY,
      params: [[eventId], randomUUID()],
      release: "commit",
    })
    expect(second.error).toBeUndefined()
    expect(second.value?.rows[0].r).toEqual({
      results: [{ event_id: eventId, ok: false, code: "EVENT_FULL" }],
    })

    const bookings = await sql<{ customer_id: string }>(
      "select customer_id from public.bookings where event_id = $1",
      [eventId]
    )
    expect(bookings).toEqual([{ customer_id: fixture.customerA }])
    const byId = await balances(fixture)
    expect(byId[fixture.entitlementOf[fixture.customerB]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 30_000)
})

describe("waiting on a lock past the registration close (story 3.3)", () => {
  it("B starts before the close, waits on the session until after it: REGISTRATION_CLOSED in book_session and book_sessions", async () => {
    const one = randomUUID()
    const many = randomUUID()
    const fixture = await seedRace("close_wait", [one, many])

    for (const [eventId, query, params] of [
      [one, BOOK, [one, randomUUID()]],
      [many, BOOK_MANY, [[many], randomUUID()]],
    ] as const) {
      // Closes 6 seconds from now; B's transaction starts before.
      await insertEvent(eventId, { capacity: 12, closesIn: 6 })
      // Read now: while the race runs both pool connections are taken.
      const [{ closes }] = await sql<{ closes: string }>(
        "select registration_closes_at::text as closes from public.events where id = $1",
        [eventId]
      )

      const second = await race({
        hold: async (a) => {
          await a.query(
            "select 1 from public.events where id = $1 for update",
            [eventId]
          )
        },
        customer: fixture.customerB,
        query,
        params: [...params],
        // B's transaction started before the close, so a check against
        // now() (the transaction start) would let it book.
        beforeQuery: async (b) => {
          const { rows } = await b.query<{ before: boolean }>(
            `select transaction_timestamp() < $1::timestamptz as before`,
            [closes]
          )
          expect(rows[0].before).toBe(true)
        },
        // Hold the lock until the server clock is past the close.
        beforeRelease: async (a) => {
          for (let tries = 0; tries < 150; tries++) {
            const { rows } = await a.query<{ past: boolean }>(
              "select clock_timestamp() > registration_closes_at as past from public.events where id = $1",
              [eventId]
            )
            if (rows[0].past) return
            await new Promise((r) => setTimeout(r, 100))
          }
          throw new Error("the close never passed")
        },
        release: "rollback",
      })

      if (query === BOOK) {
        expect(second.error, query).toMatchObject({
          code: "P0001",
          message: "REGISTRATION_CLOSED",
        })
      } else {
        expect(second.value?.rows[0].r, query).toEqual({
          results: [
            { event_id: eventId, ok: false, code: "REGISTRATION_CLOSED" },
          ],
        })
      }
    }

    const bookings = await sql(
      "select 1 from public.bookings where event_id = any($1::uuid[])",
      [[one, many]]
    )
    expect(bookings).toEqual([])
    const byId = await balances(fixture)
    expect(byId[fixture.entitlementOf[fixture.customerB]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 60_000)
})

// A committed admin (admin_roles), removed in onCleanup with her idempotency
// rows.
async function seedAdmin(): Promise<string> {
  const admin = randomUUID()
  onCleanup(async () => {
    await sql(
      "delete from private.idempotency_results where actor_scope = $1",
      [admin]
    )
    await sql("delete from public.admin_roles where user_id = $1", [admin])
  })
  await sql("insert into public.admin_roles (user_id) values ($1)", [admin])
  return admin
}

describe("Tal and a customer on the last place (story 3.4)", () => {
  it("Tal books first: the customer gets EVENT_FULL and keeps her entry", async () => {
    const eventId = randomUUID()
    const fixture = await seedRace("race_admin_first", [eventId])
    const admin = await seedAdmin()
    await insertEvent(eventId, { capacity: 1 })

    const second = await race({
      hold: async (a) => {
        await asAuthenticated(a, admin)
        const first = await a.query(ADMIN_BOOK, [
          fixture.customerA,
          eventId,
          randomUUID(),
        ])
        expect(first.rows[0].r).toEqual({ booking_id: expect.any(String) })
      },
      customer: fixture.customerB,
      query: BOOK,
      params: [eventId, randomUUID()],
      release: "commit",
    })
    expect(second.error).toMatchObject({ code: "P0001", message: "EVENT_FULL" })

    const bookings = await sql<{ customer_id: string; booked_by: string }>(
      "select customer_id, booked_by from public.bookings where event_id = $1",
      [eventId]
    )
    expect(bookings).toEqual([
      { customer_id: fixture.customerA, booked_by: "admin" },
    ])
    const byId = await balances(fixture)
    expect(byId[fixture.entitlementOf[fixture.customerB]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 30_000)

  it("the customer books first: Tal gets EVENT_FULL and no entry is taken", async () => {
    const eventId = randomUUID()
    const fixture = await seedRace("race_admin_second", [eventId])
    const admin = await seedAdmin()
    await insertEvent(eventId, { capacity: 1 })

    const second = await race({
      hold: async (a) => {
        await asAuthenticated(a, fixture.customerB)
        await a.query(BOOK, [eventId, randomUUID()])
      },
      customer: admin,
      query: ADMIN_BOOK,
      params: [fixture.customerA, eventId, randomUUID()],
      release: "commit",
    })
    expect(second.error).toMatchObject({ code: "P0001", message: "EVENT_FULL" })

    const bookings = await sql<{ customer_id: string }>(
      "select customer_id from public.bookings where event_id = $1",
      [eventId]
    )
    expect(bookings).toEqual([{ customer_id: fixture.customerB }])
    const byId = await balances(fixture)
    expect(byId[fixture.entitlementOf[fixture.customerA]]).toMatchObject({
      available: 4,
      reserved: 0,
    })
  }, 30_000)
})
