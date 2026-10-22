// Story 3.17: Tal deletes a session. admin_delete_event with its plan and
// preview: one test per row of the spec's I/O matrix. Everything but the
// race runs in inRollback, with every other published session moved to
// draft there, so a credit's alternatives are only this test's sessions.
// The race needs real commits: its fixtures are inserted as the owner and
// removed in onCleanup.

import { randomUUID } from "node:crypto"

import type { PoolClient, QueryResult } from "pg"
import { describe, expect, it, vi } from "vitest"

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

const DELETE = "select public.admin_delete_event($1, $2, $3) as r"
const PREVIEW = "select public.preview_admin_delete_event($1) as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const CANCEL_CHOICE = "select public.cancel_booking($1, $2, $3) as r"
const MY_CREDITS = "select public.get_my_credits() as r"

// Each case runs several RPCs on the shared pooler.
vi.setConfig({ testTimeout: 30_000 })
const CANCEL_EVENT = "select public.admin_cancel_event($1, $2, $3, $4) as r"
const CREATE_MEDIA = "select public.admin_create_media($1) as r"
const BEGIN_MEDIA =
  "select public.admin_begin_media_publish($1, $2, $3, $4) as r"
const FINISH_MEDIA = "select public.admin_finish_media_publish($1) as r"

type Fixture = MoneyFixture & {
  anyDayCard: string
  single: string
  mothers: string
}

async function insertProduct(
  db: Db,
  label: string,
  type: "card" | "single"
): Promise<string> {
  const pinned = type !== "card"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, $3, $4, $5, $6, null, 'regular', 1)
     returning id`,
    [
      testName(label),
      type,
      pinned ? 12800 : 47200,
      pinned ? 1 : 4,
      pinned ? "session" : "days",
      pinned ? null : 49,
    ]
  )
  return rows[0].id
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, credit_options_count = 2`
  )
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where theme_key = 'mothers' and archived_at is null limit 1"
  )
  return {
    ...f,
    anyDayCard: await insertProduct(db, "any_day_card", "card"),
    single: await insertProduct(db, "single", "single"),
    mothers: rows[0].id,
  }
}

// As the owner: a 2-hour regular session at 10:00 Jerusalem time, the
// local date today + dayOffset, open until it starts (or closed already).
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    dayOffset: number
    status?: "draft" | "published" | "cancelled" | "completed"
    closed?: boolean
    capacity?: number
    // Started 3 hours ago, so it has ended (not completed yet by the job).
    ended?: boolean
  }
): Promise<{ id: string; starts_at: Date }> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', $5,
       case when $4 then now() - interval '1 minute' else s.t end, true, $3
     from (
       select case
         when $6 then now() - interval '3 hours'
         else (((now() at time zone 'Asia/Jerusalem')::date + $2::int)
               + time '10:00') at time zone 'Asia/Jerusalem'
       end as t
     ) s
     returning id, starts_at`,
    [
      f.mothers,
      options.dayOffset,
      options.status ?? "published",
      options.closed ?? false,
      options.capacity ?? 12,
      options.ended ?? false,
    ]
  )
  return rows[0]
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<{ payment: string }> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId:
        options.customerId === undefined ? f.customerA : options.customerId,
      productId,
      eventId: options.eventId ?? null,
      amount: productId === f.anyDayCard ? 47200 : 12800,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  return { payment: r.payment_id as string }
}

// A pinned single on the session: its booking.
async function pinned(
  db: Db,
  f: Fixture,
  eventId: string,
  customerId: string | null = f.customerA
): Promise<string> {
  const g = await grant(db, f, f.single, { eventId, customerId })
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [g.payment]
  )
  return rows[0].id
}

async function preview(db: Db, f: Fixture, eventId: string) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(PREVIEW, [eventId])
    return rows[0].r
  })
}

async function deleteEvent(
  db: Db,
  f: Fixture,
  eventId: string,
  options: { confirmed?: boolean; key?: string } = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(DELETE, [
      eventId,
      options.confirmed ?? true,
      options.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

async function deleteError(
  db: Db,
  user: string,
  eventId: string,
  confirmed = true
) {
  return as(db, user, () =>
    queryError(db, DELETE, [eventId, confirmed, randomUUID()])
  )
}

async function exists(db: Db, eventId: string): Promise<boolean> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.events where id = $1",
    [eventId]
  )
  return rows[0].n === 1
}

async function auditOf(db: Db, eventId: string) {
  const { rows } = await db.query(
    `select action, entity_type, entity_id, event_id, before, after
     from public.audit_log
     where action = 'admin_delete_event' and entity_id = $1`,
    [eventId]
  )
  return rows
}

async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select o.event_id, o.state
     from public.credit_options o
     join public.events e on e.id = o.event_id
     where o.credit_id = $1
     order by e.starts_at, e.id`,
    [creditId]
  )
  return rows.map((r) => [r.event_id, r.state])
}

// The customer cancels her pinned booking on `origin` for a credit.
async function creditFrom(db: Db, customer: string, booking: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(CANCEL_CHOICE, [
      booking,
      randomUUID(),
      "credit",
    ])
    return rows[0].r.credit_id as string
  })
}

// As the admin: a published image (create, a draft file row, begin, a
// public file row, finish); storage.objects rows stand in for the files.
async function publishedMedia(db: Db, admin: string): Promise<string> {
  const id = await as(db, admin, async () => {
    const { rows } = await db.query(CREATE_MEDIA, [randomUUID()])
    return rows[0].r.media_id as string
  })
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-drafts', $1)",
    [id]
  )
  await as(db, admin, () =>
    db.query(BEGIN_MEDIA, [id, testName("alt"), 50, 50])
  )
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-public', $1)",
    [`${id}.jpg`]
  )
  await as(db, admin, () => db.query(FINISH_MEDIA, [id]))
  return id
}

describe("admin_delete_event (story 3.17)", () => {
  it("a draft with a work sheet: deleted with its dishes, tasks and shopping; the counts in the audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, status: "draft" })
      const { rows: sheet } = await db.query(
        "select (private.ensure_work_sheet($1)).id as id",
        [ev.id]
      )
      const { rows: dishes } = await db.query(
        `insert into public.work_dishes (sheet_id, name, sort_order)
         values ($1, $2, 1), ($1, $3, 2) returning id`,
        [sheet[0].id, testName("dish_a"), testName("dish_b")]
      )
      await db.query(
        `insert into public.work_tasks (dish_id, day_offset, body, sort_order)
         values ($1, 0, $3, 1), ($1, -1, $3, 2), ($2, 0, $3, 1)`,
        [dishes[0].id, dishes[1].id, testName("task")]
      )
      await db.query(
        `insert into public.shopping_items (sheet_id, body, sort_order)
         values ($1, $2, 1)`,
        [sheet[0].id, testName("item")]
      )

      expect(await preview(db, f, ev.id)).toMatchObject({
        ok: true,
        event_id: ev.id,
        status: "draft",
        work_dishes_count: 2,
        work_tasks_count: 3,
        shopping_items_count: 1,
        credit_count: 0,
        credit_options: [],
      })

      const r = await deleteEvent(db, f, ev.id)
      // hidden_paths: every hidden image whose file is still there, so it
      // depends on the environment.
      expect(r.event_id).toBe(ev.id)
      expect(Array.isArray(r.hidden_paths)).toBe(true)
      expect(await exists(db, ev.id)).toBe(false)
      const { rows: left } = await db.query(
        `select
           (select count(*)::int from public.work_sheets where id = $1) as sheets,
           (select count(*)::int from public.work_dishes where sheet_id = $1) as dishes,
           (select count(*)::int from public.shopping_items where sheet_id = $1) as items`,
        [sheet[0].id]
      )
      expect(left[0]).toEqual({ sheets: 0, dishes: 0, items: 0 })

      const audit = await auditOf(db, ev.id)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        entity_type: "events",
        event_id: ev.id,
        after: {},
        before: {
          id: ev.id,
          status: "draft",
          concept_id: f.mothers,
          concept_name: expect.any(String),
          work_dishes_count: 2,
          work_tasks_count: 3,
          shopping_items_count: 1,
          credit_options: [],
        },
      })
    })
  })

  it("a published session without bookings: deleted, gone from the public list", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      expect(await preview(db, f, ev.id)).toMatchObject({
        ok: true,
        status: "published",
      })
      // The public read path (anon) sees it before, and not after.
      const anonCount = async () => {
        await db.query("set local role anon")
        try {
          const { rows } = await db.query(
            "select count(*)::int as n from public.events where id = $1 and status = 'published'",
            [ev.id]
          )
          return rows[0].n as number
        } finally {
          await db.query("reset role")
        }
      }
      expect(await anonCount()).toBe(1)
      expect(await deleteEvent(db, f, ev.id)).toMatchObject({
        event_id: ev.id,
      })
      expect(await exists(db, ev.id)).toBe(false)
      expect(await anonCount()).toBe(0)
    })
  })

  it("its own image, used nowhere else: hidden (no media_hidden audit row since 5.20), its public path returned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, status: "draft" })
      const media = await publishedMedia(db, f.admin)
      await db.query("update public.events set image_id = $2 where id = $1", [
        ev.id,
        media,
      ])

      const r = await deleteEvent(db, f, ev.id)
      expect(r.hidden_paths).toContain(`${media}.jpg`)
      const { rows } = await db.query(
        "select publish_state from public.media_assets where id = $1",
        [media]
      )
      expect(rows[0].publish_state).toBe("hidden")
      const { rows: hidden } = await db.query(
        `select count(*)::int as n from public.audit_log
         where action = 'media_hidden' and entity_id = $1`,
        [media]
      )
      expect(hidden[0].n).toBe(0)
    })
  })

  it("published and ended (before the job completes it), no bookings: EVENT_NOT_DELETABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 0, ended: true })
      expect(await preview(db, f, ev.id)).toEqual({
        ok: false,
        code: "EVENT_NOT_DELETABLE",
      })
      expect(await deleteError(db, f.admin, ev.id)).toMatchObject({
        message: "EVENT_NOT_DELETABLE",
      })
      expect(await exists(db, ev.id)).toBe(true)
    })
  })

  it("a credit alternative (active and passed options): the rows removed and listed in the audit; the customer's next view has another alternative she can book", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, { dayOffset: 5 })
      const a = await insertEvent(db, f, { dayOffset: 6 })
      const b = await insertEvent(db, f, { dayOffset: 7 })
      const c = await insertEvent(db, f, { dayOffset: 8 })
      const creditA = await creditFrom(
        db,
        f.customerA,
        await pinned(db, f, origin.id, f.customerA)
      )
      const creditB = await creditFrom(
        db,
        f.customerB,
        await pinned(db, f, origin.id, f.customerB)
      )
      expect(await options(db, creditA)).toEqual([
        [a.id, "active"],
        [b.id, "active"],
      ])
      // B's option on a passed (its registration closed unused).
      await db.query(
        "update public.credit_options set state = 'passed' where credit_id = $1 and event_id = $2",
        [creditB, a.id]
      )

      const plan = await preview(db, f, a.id)
      expect(plan).toMatchObject({ ok: true, credit_count: 2 })
      const expected = [
        { credit_id: creditA, state: "active" },
        { credit_id: creditB, state: "passed" },
      ].sort((x, y) => (x.credit_id < y.credit_id ? -1 : 1))
      expect(plan.credit_options).toEqual(expected)

      await deleteEvent(db, f, a.id)
      expect(await exists(db, a.id)).toBe(false)
      expect(await options(db, creditA)).toEqual([[b.id, "active"]])
      const audit = await auditOf(db, a.id)
      expect(audit[0].before.credit_options).toEqual(expected)

      // The owner's next path (her credits) fills it again.
      const mine = await as(
        db,
        f.customerA,
        async () => (await db.query(MY_CREDITS)).rows[0].r
      )
      expect(
        mine[0].options.map((o: { event_id: string }) => o.event_id)
      ).toEqual([b.id, c.id])
      expect(await options(db, creditA)).toEqual([
        [b.id, "active"],
        [c.id, "active"],
      ])
      const booking = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [c.id, randomUUID()])
        return rows[0].r.booking_id as string
      })
      const { rows: alloc } = await db.query(
        "select credit_id from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(alloc).toEqual([{ credit_id: creditA }])
    })
  })

  it("a cancelled booking: EVENT_HAS_BOOKINGS, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await grant(db, f, f.anyDayCard)
      const booking = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [ev.id, randomUUID()])
        return rows[0].r.booking_id as string
      })
      await as(db, f.customerA, () => db.query(CANCEL, [booking, randomUUID()]))

      expect(await preview(db, f, ev.id)).toEqual({
        ok: false,
        code: "EVENT_HAS_BOOKINGS",
      })
      expect(await deleteError(db, f.admin, ev.id)).toEqual({
        code: "P0001",
        message: "EVENT_HAS_BOOKINGS",
      })
      expect(await exists(db, ev.id)).toBe(true)
    })
  })

  it("a place held for a new customer (pinned, awaiting join): EVENT_HAS_BOOKINGS", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      await pinned(db, f, ev.id, null)
      expect(await preview(db, f, ev.id)).toMatchObject({
        code: "EVENT_HAS_BOOKINGS",
      })
      expect(await deleteError(db, f.admin, ev.id)).toMatchObject({
        message: "EVENT_HAS_BOOKINGS",
      })
      expect(await exists(db, ev.id)).toBe(true)
    })
  })

  it("a parked pinned purchase (paid, no booking): EVENT_HAS_PURCHASES", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // A full session parks customer B's online purchase without a place
      // (as in business-cancel.test.ts); the test then pins that parked
      // entitlement to an empty session, the state this case needs.
      const full = await insertEvent(db, f, { dayOffset: 4, capacity: 1 })
      await pinned(db, f, full.id)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      const { rows: pay } = await db.query(
        `select private.approve_payment_core(
           'online', null, 'system', $5, $1, $2, 12800, null, $3::date,
           null, null, null, 'test_provider', $4, 'park') as id`,
        [f.single, full.id, f.today, testName("tx"), f.customerB]
      )
      await db.query(
        "update public.entitlements set pinned_event_id = $2 where payment_id = $1",
        [pay[0].id, ev.id]
      )
      const { rows: booked } = await db.query(
        "select count(*)::int as n from public.bookings where event_id = $1",
        [ev.id]
      )
      expect(booked[0].n).toBe(0)

      expect(await preview(db, f, ev.id)).toEqual({
        ok: false,
        code: "EVENT_HAS_PURCHASES",
      })
      expect(await deleteError(db, f.admin, ev.id)).toMatchObject({
        message: "EVENT_HAS_PURCHASES",
      })
      expect(await exists(db, ev.id)).toBe(true)
    })
  })

  it("cancelled or completed: EVENT_NOT_DELETABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const cancelled = await insertEvent(db, f, { dayOffset: 5 })
      await as(db, f.admin, () =>
        db.query(CANCEL_EVENT, [
          cancelled.id,
          true,
          testName("message"),
          randomUUID(),
        ])
      )
      const completed = await insertEvent(db, f, {
        dayOffset: -3,
        status: "completed",
      })
      for (const id of [cancelled.id, completed.id]) {
        expect(await preview(db, f, id)).toEqual({
          ok: false,
          code: "EVENT_NOT_DELETABLE",
        })
        expect(await deleteError(db, f.admin, id)).toMatchObject({
          message: "EVENT_NOT_DELETABLE",
        })
        expect(await exists(db, id)).toBe(true)
      }
    })
  })

  it("no checkbox: CONFIRM_REQUIRED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, status: "draft" })
      expect(await deleteError(db, f.admin, ev.id, false)).toEqual({
        code: "P0001",
        message: "CONFIRM_REQUIRED",
      })
      expect(await exists(db, ev.id)).toBe(true)
      expect(await auditOf(db, ev.id)).toEqual([])
    })
  })

  it("the same idempotency key again: the same result, one audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, status: "draft" })
      const key = randomUUID()
      const first = await deleteEvent(db, f, ev.id, { key })
      const again = await deleteEvent(db, f, ev.id, { key })
      expect(again).toEqual(first)
      expect(await auditOf(db, ev.id)).toHaveLength(1)
    })
  })

  it("a customer calls the preview or the action: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5, status: "draft" })
      expect(
        await as(db, f.customerA, () => queryError(db, PREVIEW, [ev.id]))
      ).toEqual({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(await deleteError(db, f.customerA, ev.id)).toEqual({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
      expect(await exists(db, ev.id)).toBe(true)
    })
  })

  it("an unknown id: NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = randomUUID()
      expect(await preview(db, f, id)).toEqual({ ok: false, code: "NOT_FOUND" })
      expect(await deleteError(db, f.admin, id)).toEqual({
        code: "P0001",
        message: "NOT_FOUND",
      })
    })
  })
})

// ---------------------------------------------------------------------------
// A booking and the delete at once (two connections, real commits)
// ---------------------------------------------------------------------------

type Race = { admin: string; customer: string; eventId: string }

// Committed: an admin, a customer with a card of 4 for any day and a
// published session three days from now; all removed in onCleanup.
async function seedRace(label: string): Promise<Race> {
  const admin = randomUUID()
  const customer = randomUUID()
  const product = randomUUID()
  const method = randomUUID()
  const eventId = randomUUID()

  onCleanup(async () => {
    const client = await getPool().connect()
    try {
      await client.query("begin")
      await client.query(
        "delete from public.notifications where recipient_id = $1",
        [customer]
      )
      await client.query(
        "delete from public.audit_log where customer_id = $1 or event_id = $2 or actor_id = $3",
        [customer, eventId, admin]
      )
      await client.query(
        "delete from private.idempotency_results where actor_scope = any($1::text[])",
        [[customer, admin]]
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
        "delete from public.entitlement_movements where entitlement_id in (select id from public.entitlements where customer_id = $1)",
        [customer]
      )
      await client.query(
        "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
      )
      await client.query("delete from public.bookings where event_id = $1", [
        eventId,
      ])
      await client.query(
        "delete from public.entitlements where customer_id = $1",
        [customer]
      )
      await client.query("delete from public.payments where customer_id = $1", [
        customer,
      ])
      await client.query("delete from public.events where id = $1", [eventId])
      await client.query("delete from public.products where id = $1", [product])
      await client.query("delete from public.payment_methods where id = $1", [
        method,
      ])
      await client.query("delete from public.profiles where id = $1", [
        customer,
      ])
      await client.query("delete from public.admin_roles where user_id = $1", [
        admin,
      ])
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })

  await sql("insert into public.admin_roles (user_id) values ($1)", [admin])
  await sql(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName(`${label}_customer`)]
  )
  await sql(
    `insert into public.products (
       id, name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
    [product, testName(`${label}_card`)]
  )
  await sql(
    "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 906)",
    [method, testName(`${label}_method`)]
  )
  const [payment] = await sql<{ id: string }>(
    `insert into public.payments (
       customer_id, product_id, source, recorded_by, payment_method_id,
       amount_agorot, paid_on, product_snapshot)
     values ($1, $2, 'manual', $3, $4, 47200,
       (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
     returning id`,
    [customer, product, admin, method]
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
  await sql(
    `insert into public.events (
       id, description, concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, c.id, 'regular',
       ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem',
       ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '12:00') at time zone 'Asia/Jerusalem',
       4,
       ((now() at time zone 'Asia/Jerusalem')::date + 3 + time '10:00') at time zone 'Asia/Jerusalem',
       true, 'published'
     from public.concepts c
     where c.theme_key = 'mothers'
     limit 1`,
    // Named test_ (story 5.20, fix 8).
    [eventId, testName("committed_session")]
  )
  return { admin, customer, eventId }
}

// From `watcher`, as the owner: waits until `pid` waits on a lock.
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

// A runs `first` as `firstUser` in an open transaction; B runs `second` as
// `secondUser` and must wait on a lock; A commits; B's result is returned
// (a rejection as { error }).
async function race(options: {
  firstUser: string
  first: [string, unknown[]]
  secondUser: string
  second: [string, unknown[]]
}): Promise<{ value?: QueryResult; error?: unknown }> {
  const a = await getPool().connect()
  const b = await getPool().connect()
  let released = false
  let pending: Promise<QueryResult> | undefined
  try {
    await a.query("begin")
    await asAuthenticated(a, options.firstUser)
    await a.query(...options.first)

    await b.query("begin")
    await asAuthenticated(b, options.secondUser)
    const { rows } = await b.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    )
    pending = b.query(...options.second)
    pending.catch(() => {})

    await a.query("reset role")
    expect(await waitsOnLock(a, rows[0].pid)).toBe(true)
    await a.query("commit")
    released = true

    const result = await pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await b.query("commit").catch(() => {})
    return result
  } finally {
    if (!released) await a.query("rollback").catch(() => {})
    await pending?.catch(() => {})
    await b.query("rollback").catch(() => {})
    a.release()
    b.release()
  }
}

describe("a booking races the delete (story 3.17)", () => {
  it("the booking first: it is confirmed, the delete gets EVENT_HAS_BOOKINGS", async () => {
    const r = await seedRace("delete_race_book")
    const second = await race({
      firstUser: r.customer,
      first: [BOOK, [r.eventId, randomUUID()]],
      secondUser: r.admin,
      second: [DELETE, [r.eventId, true, randomUUID()]],
    })
    expect(second.error).toMatchObject({
      code: "P0001",
      message: "EVENT_HAS_BOOKINGS",
    })
    const bookings = await sql<{ status: string }>(
      "select status from public.bookings where event_id = $1",
      [r.eventId]
    )
    expect(bookings).toEqual([{ status: "confirmed" }])
  }, 30_000)

  it("the delete first: the session is gone, the booking fails with EVENT_NOT_BOOKABLE and leaves no row", async () => {
    const r = await seedRace("delete_race_delete")
    const second = await race({
      firstUser: r.admin,
      first: [DELETE, [r.eventId, true, randomUUID()]],
      secondUser: r.customer,
      second: [BOOK, [r.eventId, randomUUID()]],
    })
    expect(second.error).toMatchObject({
      code: "P0001",
      message: "EVENT_NOT_BOOKABLE",
    })
    const [left] = await sql<{ events: number; bookings: number }>(
      `select
         (select count(*)::int from public.events where id = $1) as events,
         (select count(*)::int from public.bookings where event_id = $1) as bookings`,
      [r.eventId]
    )
    expect(left).toEqual({ events: 0, bookings: 0 })
  }, 30_000)
})
