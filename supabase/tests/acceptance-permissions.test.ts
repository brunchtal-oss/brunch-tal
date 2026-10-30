// Story 6.6: the acceptance suite, "permissions" (R2). Each test proves a
// claim the story-by-story tests left missing or weak (T8-T11 of the spec's
// coverage map): RLS on every public table with a policy for every table a
// signed-in user can read, booking_allocations isolation, the admin-only
// tables with real rows, and every admin RPC refusing a customer. Everything
// runs in inRollback.

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

const BOOK = "select public.book_session($1, $2) as r"

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// As the owner: a published regular session `days` from now, 2 hours.
async function insertEvent(db: Db, days: number): Promise<string> {
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
  return rows[0].id
}

// As the admin: a card of the fixture for `customerId`; its entitlement.
async function grantCard(
  db: Db,
  f: MoneyFixture,
  customerId: string
): Promise<string> {
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
  const { rows } = await db.query(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return rows[0].id
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

describe("R2: RLS and policies", () => {
  it("T8: RLS is on for every public table, and every table authenticated can read has a select policy for it", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query<{
        name: string
        rls: boolean
        readable: boolean
        has_policy: boolean
      }>(
        `select c.relname as name, c.relrowsecurity as rls,
           (has_table_privilege('authenticated', c.oid, 'SELECT')
            or has_any_column_privilege('authenticated', c.oid, 'SELECT')) as readable,
           exists (
             select 1 from pg_policy p
             where p.polrelid = c.oid
               and p.polcmd in ('r', '*')
               and (p.polroles = '{0}'::oid[]
                    or 'authenticated'::regrole::oid = any (p.polroles))
           ) as has_policy
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
         order by 1`
      )
      expect(rows.length).toBeGreaterThan(30)
      expect(rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([])
      expect(
        rows.filter((r) => r.readable && !r.has_policy).map((r) => r.name)
      ).toEqual([])
      // The check is not empty: most tables are readable by authenticated.
      expect(rows.filter((r) => r.readable).length).toBeGreaterThan(20)
    })
  })

  it("T9: booking_allocations: B sees only the rows of her own bookings, the admin sees both", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const cardA = await grantCard(db, f, f.customerA)
      const cardB = await grantCard(db, f, f.customerB)
      const eventId = await insertEvent(db, 7)
      const bookingA = await book(db, f.customerA, eventId)
      const bookingB = await book(db, f.customerB, eventId)
      // One allocation row per booking (added as the owner when the booking
      // made none).
      for (const [booking, card] of [
        [bookingA, cardA],
        [bookingB, cardB],
      ]) {
        await db.query(
          `insert into public.booking_allocations (booking_id, entitlement_id, units)
           select $1, $2, 1
           where not exists (
             select 1 from public.booking_allocations where booking_id = $1)`,
          [booking, card]
        )
      }

      const seen = (user: string) =>
        as(db, user, async () => {
          const { rows } = await db.query(
            // Every row she can read (a fresh customer: only her own).
            "select booking_id from public.booking_allocations"
          )
          return rows
        })

      const ofB = await seen(f.customerB)
      expect(ofB.length).toBeGreaterThan(0)
      expect(ofB.every((r) => r.booking_id === bookingB)).toBe(true)
      const ofA = await seen(f.customerA)
      expect(ofA.length).toBeGreaterThan(0)
      expect(ofA.every((r) => r.booking_id === bookingA)).toBe(true)
      const all = await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select distinct booking_id from public.booking_allocations where booking_id = any($1::uuid[]) order by 1",
          [[bookingA, bookingB]]
        )
        return rows.map((r) => r.booking_id)
      })
      expect(all).toEqual([bookingA, bookingB].sort())
    })
  })

  it("T10: entitlement_corrections, entitlement_correction_bookings and work_tasks with real rows: the admin sees them, a customer none", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const card = await grantCard(db, f, f.customerA)
      const eventId = await insertEvent(db, 7)
      const bookingId = await book(db, f.customerA, eventId)
      // Every weekday but the session's local day: the booking no longer
      // fits (a correction_bookings row).
      const { rows: days } = await db.query(
        `select array_agg(d order by d) as days from generate_series(0, 6) d
         where d <> (select extract(dow from (starts_at at time zone 'Asia/Jerusalem'))::int
                     from public.events where id = $1)`,
        [eventId]
      )
      await as(db, f.admin, () =>
        db.query(
          "select public.admin_correct_entitlement($1, 'allowed_weekdays', $2::jsonb, null, null, true, $3)",
          [card, JSON.stringify(days[0].days), randomUUID()]
        )
      )
      const { rows: concept } = await db.query(
        "select id from public.concepts where archived_at is null order by id limit 1"
      )
      const taskId = await as(db, f.admin, async () => {
        const { rows: created } = await db.query(
          "select public.admin_create_event($1::jsonb, $2) as r",
          [
            {
              concept_id: concept[0].id,
              date: "2099-06-10",
              start_time: "10:00",
              end_time: "12:00",
            },
            randomUUID(),
          ]
        )
        const { rows: dish } = await db.query(
          "select public.admin_add_work_dish($1, $2, $3) as r",
          [created[0].r.event_id, testName("dish"), randomUUID()]
        )
        const { rows: task } = await db.query(
          "select public.admin_add_work_task($1, $2, $3, $4) as r",
          [dish[0].r.dish_id, 0, testName("task"), randomUUID()]
        )
        return task[0].r.task_id as string
      })

      const counts = (user: string) =>
        as(db, user, async () => {
          const { rows } = await db.query(
            `select
               (select count(*)::int from public.entitlement_corrections where entitlement_id = $1) as corrections,
               (select count(*)::int from public.entitlement_correction_bookings where booking_id = $2) as correction_bookings,
               (select count(*)::int from public.work_tasks where id = $3) as work_tasks,
               (select count(*)::int from public.entitlement_corrections) +
               (select count(*)::int from public.entitlement_correction_bookings) +
               (select count(*)::int from public.work_tasks) as any_rows`,
            [card, bookingId, taskId]
          )
          return rows[0]
        })

      const admin = await counts(f.admin)
      expect(admin.corrections).toBeGreaterThanOrEqual(1)
      expect(admin.correction_bookings).toBeGreaterThanOrEqual(1)
      expect(admin.work_tasks).toBe(1)
      for (const customer of [f.customerA, f.customerB]) {
        expect(await counts(customer)).toEqual({
          corrections: 0,
          correction_bookings: 0,
          work_tasks: 0,
          any_rows: 0,
        })
      }
    })
  })
})

describe("R2: every admin RPC refuses a customer", () => {
  it("T11: every public admin_% and preview_admin_% called by a customer with null arguments -> NOT_AUTHORIZED (or 42501 without a grant), and nothing is written", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows: functions } = await db.query<{
        name: string
        call: string
      }>(
        `select p.oid::regprocedure::text as name,
             format('select public.%I(%s)', p.proname, coalesce((
               select string_agg('null::' || format_type(t.type, null), ', ' order by t.ord)
               from unnest(p.proargtypes::oid[]) with ordinality t(type, ord)
             ), '')) as call
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'admin\\_%' or p.proname like 'preview\\_admin\\_%')
           order by 1`
      )
      expect(functions.length).toBeGreaterThan(80)

      const totals = async () => {
        const { rows } = await db.query(
          `select
               (select count(*)::int from public.audit_log) as audit_log,
               (select count(*)::int from public.payments) as payments,
               (select count(*)::int from public.entitlement_movements) as movements`
        )
        return rows[0]
      }
      const before = await totals()

      const unexpected: string[] = []
      await asAuthenticated(db, f.customerA)
      for (const fn of functions) {
        const error = await queryError(db, fn.call)
        const refused =
          (error?.code === "P0001" && error.message === "NOT_AUTHORIZED") ||
          error?.code === "42501"
        if (!refused) {
          unexpected.push(
            `${fn.name}: ${error ? `${error.code} ${error.message}` : "no error"}`
          )
        }
      }
      await db.query("reset role")

      expect(unexpected).toEqual([])
      expect(await totals()).toEqual(before)
    })
  }, 180_000)
})
