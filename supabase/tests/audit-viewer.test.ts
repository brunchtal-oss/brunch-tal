// Story 4.5 and spec-audit-log-concise: admin_list_audit, the audit log
// viewer's read RPC. Filters, paging, the whitelist (p_shown), one item per
// operation with its related rows, the derived customer and subject, and
// the keys that are never returned. The dev database holds other audit
// rows, so every check filters by this test's session or customer. Rows are
// inserted as the owner (the table's only writer is private.audit, which
// cannot set created_at). Everything runs in inRollback, where now() is the
// same for every row: rows of one test share created_at unless given one.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { shownPairs } from "@/lib/copy/audit-actions"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  approve,
  insertProduct,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const LIST = "select public.admin_list_audit($1, $2, $3, $4, $5, $6, $7) as r"
const SHOWN = shownPairs()

type Change = { key: string; before: unknown; after: unknown }
type EventRef = { id: string; title: string; local_date: string }
type Row = {
  id: string
  created_at: string
  actor_kind: string
  action: string
  entity_type: string
  customer: { id: string; name: string | null } | null
  event: EventRef | null
  subject: string | null
  amount_agorot: number | null
  funding: string | null
  changes: Change[]
  related: { entity_type: string; changes: Change[]; event: EventRef | null }[]
  reason: string | null
}
type Page = { rows: Row[]; has_more: boolean }

type Filters = {
  shown?: (string | null)[] | null
  event?: string | null
  customer?: string | null
  from?: string | null
  to?: string | null
  before?: { createdAt: string; id: string } | null
}

type Fixture = MoneyFixture & { concept: string; conceptName: string }

const HIDDEN = /^(id|created_at|updated_at|sort_order)$|_id$|_hash$/

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows } = await db.query(
    "select id, name from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  return { ...f, concept: rows[0].id, conceptName: rows[0].name }
}

async function insertEvent(
  db: Db,
  f: Fixture,
  startsAt: string
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', $2::timestamptz, $2::timestamptz + interval '2 hours',
       12, $2::timestamptz - interval '1 day', 'published')
     returning id`,
    [f.concept, startsAt]
  )
  return rows[0].id
}

// As the owner: one audit row.
async function insertAudit(
  db: Db,
  f: Fixture,
  values: {
    createdAt?: string
    actorKind?: "admin" | "customer" | "system"
    actorId?: string | null
    action?: string
    entityType?: string
    entityId?: string | null
    customerId?: string | null
    eventId?: string | null
    before?: object
    after?: object
    reason?: string | null
  }
): Promise<string> {
  const actorKind = values.actorKind ?? "admin"
  const { rows } = await db.query(
    `insert into public.audit_log (
       created_at, actor_id, actor_kind, action, entity_type, entity_id,
       customer_id, event_id, before, after, reason)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11)
     returning id`,
    [
      values.createdAt ?? null,
      values.actorId !== undefined
        ? values.actorId
        : actorKind === "system"
          ? null
          : f.admin,
      actorKind,
      values.action ?? "admin_update_event",
      values.entityType ?? "events",
      values.entityId !== undefined ? values.entityId : randomUUID(),
      values.customerId ?? null,
      values.eventId ?? null,
      JSON.stringify(values.before ?? {}),
      JSON.stringify(values.after ?? {}),
      values.reason ?? null,
    ]
  )
  return rows[0].id
}

function params(filters: Filters): unknown[] {
  return [
    filters.shown === undefined ? SHOWN : filters.shown,
    filters.event ?? null,
    filters.customer ?? null,
    filters.from ?? null,
    filters.to ?? null,
    filters.before?.createdAt ?? null,
    filters.before?.id ?? null,
  ]
}

async function list(db: Db, f: Fixture, filters: Filters): Promise<Page> {
  await asAuthenticated(db, f.admin)
  try {
    return (await db.query(LIST, params(filters))).rows[0].r
  } finally {
    await db.query("reset role")
  }
}

async function raised(
  db: Db,
  text: string,
  values: unknown[]
): Promise<{ code: string; message: string; detail: unknown } | null> {
  await db.query("savepoint raised")
  try {
    await db.query(text, values)
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

function expectNoHiddenKey(page: Page) {
  for (const row of page.rows) {
    for (const change of [
      ...row.changes,
      ...row.related.flatMap((r) => r.changes),
    ]) {
      expect(change.key, row.action).not.toMatch(HIDDEN)
      expect(change.key).not.toMatch(/token|password|url/)
    }
    expect(row).not.toHaveProperty("before")
    expect(row).not.toHaveProperty("after")
  }
}

describe("admin_list_audit: filters", () => {
  it("session filter: only rows with that event_id; the row shape and changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const one = await insertEvent(db, f, "2026-11-02 10:00+02")
      const two = await insertEvent(db, f, "2026-11-03 10:00+02")
      const mine = await insertAudit(db, f, {
        eventId: one,
        before: { capacity_adults: 12 },
        after: { capacity_adults: 14 },
        reason: testName("more room"),
      })
      await insertAudit(db, f, { eventId: two })

      const page = await list(db, f, { event: one })
      expect(page.has_more).toBe(false)
      expect(page.rows).toHaveLength(1)
      expect(page.rows[0]).toMatchObject({
        id: mine,
        actor_kind: "admin",
        action: "admin_update_event",
        entity_type: "events",
        customer: null,
        event: { id: one, title: f.conceptName, local_date: "2026-11-02" },
        subject: null,
        changes: [{ key: "capacity_adults", before: 12, after: 14 }],
        related: [],
        reason: testName("more room"),
      })
    })
  })

  it("customer filter and combined filters (AND)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-04 10:00+02")
      const both = await insertAudit(db, f, {
        customerId: f.customerA,
        eventId: event,
        actorKind: "customer",
        action: "book_session",
        entityType: "bookings",
      })
      const onlyCustomer = await insertAudit(db, f, {
        customerId: f.customerA,
        action: "set_photo_consent",
        actorKind: "customer",
        entityType: "profiles",
      })
      await insertAudit(db, f, { customerId: f.customerB, eventId: event })

      const forA = await list(db, f, { customer: f.customerA })
      expect(forA.rows.map((r) => r.id).sort()).toEqual(
        [both, onlyCustomer].sort()
      )
      expect(forA.rows.every((r) => r.customer?.id === f.customerA)).toBe(true)
      expect(forA.rows[0].customer?.name).toBe(testName("money_a"))

      const combined = await list(db, f, {
        customer: f.customerA,
        event,
        from: f.today,
        to: f.today,
      })
      expect(combined.rows.map((r) => r.id)).toEqual([both])
    })
  })

  it("date range: Jerusalem days, both ends included", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-05 10:00+02")
      await insertAudit(db, f, {
        eventId: event,
        createdAt: "2026-10-09 23:30+03",
      })
      const late = await insertAudit(db, f, {
        eventId: event,
        createdAt: "2026-10-10 00:30+03",
      })
      const page = await list(db, f, {
        event,
        from: "2026-10-10",
        to: "2026-10-10",
      })
      expect(page.rows.map((r) => r.id)).toEqual([late])
      const both = await list(db, f, {
        event,
        from: "2026-10-09",
        to: "2026-10-10",
      })
      expect(both.rows).toHaveLength(2)
    })
  })

  it("bad input: from after to, over 366 days, a half cursor, no whitelist", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(
        await raised(db, LIST, params({ from: "2026-10-12", to: "2026-10-10" }))
      ).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "to" },
      })
      expect(
        await raised(db, LIST, params({ from: "2025-10-09", to: "2026-10-10" }))
      ).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "from" },
      })
      // Exactly 366 days, both ends included.
      expect(
        await queryError(
          db,
          LIST,
          params({ from: "2025-10-10", to: "2026-10-10" })
        )
      ).toBeNull()
      // A cursor needs both parts.
      expect(
        await raised(db, LIST, [
          SHOWN,
          null,
          null,
          null,
          null,
          null,
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", detail: { field: "cursor" } })
      // The whitelist is required.
      for (const shown of [
        null,
        [],
        [null],
        ["approve_payment"],
        ["approve_payment/payments/update"],
        ["Approve_payment/payments"],
        ["approve_payment/payments", "x/y/z/w"],
      ]) {
        expect(await raised(db, LIST, params({ shown }))).toEqual({
          code: "P0001",
          message: "INVALID_INPUT",
          detail: { field: "shown" },
        })
      }
    })
  })
})

describe("admin_list_audit: the whitelist", () => {
  it("hidden actions are never listed; only hidden rows is an empty page", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-07 10:00+02")
      for (const [action, entityType] of [
        ["admin_add_work_task", "work_tasks"],
        ["admin_set_content_draft", "content_sections"],
        ["admin_set_event_image", "events"],
        ["admin_approve_payment", "payments"],
        // A shown action on another entity than its main one.
        ["admin_update_event", "work_sheets"],
      ]) {
        await insertAudit(db, f, { eventId: event, action, entityType })
      }
      const page = await list(db, f, { event })
      expect(page).toEqual({ rows: [], has_more: false })
    })
  })

  it("an insert-only pair: only a created row is the main row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-08 10:00+02")
      const at = "2026-10-10 10:00+03"
      const created = await insertAudit(db, f, {
        createdAt: at,
        eventId: event,
        action: "admin_move_booking",
        entityType: "bookings",
        before: {},
        after: { status: "confirmed", party_size: 1 },
      })
      await insertAudit(db, f, {
        createdAt: at,
        eventId: event,
        action: "admin_move_booking",
        entityType: "bookings",
        before: { status: "confirmed" },
        after: { status: "cancelled" },
      })
      const page = await list(db, f, {
        event,
        shown: ["admin_move_booking/bookings/insert"],
      })
      expect(page.rows.map((r) => r.id)).toEqual([created])
      expect(page.rows[0].related).toHaveLength(1)
    })
  })

  it("51 shown rows among 200 hidden: 50 and has_more; the next page is the 51st", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-06 10:00+02")
      // Same created_at for some rows: the id breaks the tie. Distinct
      // actors keep each shown row its own operation.
      await db.query(
        `insert into public.audit_log (
           created_at, actor_id, actor_kind, action, entity_type, event_id)
         select now() - make_interval(secs => g / 2), gen_random_uuid(), 'admin',
           'admin_update_event', 'events', $1
         from generate_series(1, 51) g`,
        [event]
      )
      await db.query(
        `insert into public.audit_log (
           created_at, actor_id, actor_kind, action, entity_type, event_id)
         select now() - make_interval(secs => g / 8), $1, 'admin',
           'admin_add_work_task', 'work_tasks', $2
         from generate_series(1, 200) g`,
        [f.admin, event]
      )
      const first = await list(db, f, { event })
      expect(first.rows).toHaveLength(50)
      expect(first.has_more).toBe(true)
      const last = first.rows[49]
      const second = await list(db, f, {
        event,
        before: { createdAt: last.created_at, id: last.id },
      })
      expect(second.rows).toHaveLength(1)
      expect(second.has_more).toBe(false)
      const all = [...first.rows, ...second.rows].map((r) => r.id)
      expect(new Set(all).size).toBe(51)

      const { rows } = await db.query(
        `select id from public.audit_log
         where event_id = $1 and action = 'admin_update_event'
         order by created_at desc, id desc`,
        [event]
      )
      expect(all).toEqual(rows.map((r: { id: string }) => r.id))
    })
  })
})

describe("admin_list_audit: one operation, one item", () => {
  it("a real approval: one item (admin_approve_payment hidden), the entitlement related", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      await approve(db, {
        customerId: f.customerA,
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      })
      await db.query("reset role")
      const page = await list(db, f, { customer: f.customerA })
      expect(page.rows.map((r) => r.action)).toEqual(["approve_payment"])
      const item = page.rows[0]
      expect(item.entity_type).toBe("payments")
      expect(item.customer?.id).toBe(f.customerA)
      expect(item.changes).toEqual(
        expect.arrayContaining([
          { key: "amount_agorot", before: null, after: 47200 },
        ])
      )
      expect(item.related.map((r) => r.entity_type)).toContain("entitlements")
      expectNoHiddenKey(page)
    })
  })

  it("related rows: same time, action and actor; another actor or customer stays apart", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-09 10:00+02")
      const at = "2026-10-10 11:00+03"
      const cancel = await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        actorId: f.customerA,
        customerId: f.customerA,
        eventId: event,
        action: "cancel_booking",
        entityType: "bookings",
        before: { status: "confirmed" },
        after: { status: "cancelled" },
      })
      await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        actorId: f.customerA,
        eventId: event,
        action: "cancel_booking",
        entityType: "cancellation_credits",
        before: {},
        after: { customer_id: f.customerA, options_count: 2 },
      })
      // Another customer's row at the same instant (same actor): apart.
      await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        actorId: f.customerA,
        customerId: f.customerB,
        action: "cancel_booking",
        entityType: "refund_requests",
        before: {},
        after: { amount_agorot: 100 },
      })
      // Another actor at the same instant: apart.
      await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        actorId: f.customerB,
        customerId: f.customerA,
        action: "cancel_booking",
        entityType: "refund_requests",
        before: {},
        after: { amount_agorot: 100 },
      })
      const page = await list(db, f, { event })
      expect(page.rows.map((r) => r.id)).toEqual([cancel])
      expect(page.rows[0].related).toEqual([
        {
          entity_type: "cancellation_credits",
          changes: [{ key: "options_count", before: null, after: 2 }],
          event: { id: event, title: f.conceptName, local_date: "2026-11-09" },
        },
      ])
    })
  })

  it("a session cancel: listed under each customer of its related bookings, and under each session of a move", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-10 10:00+02")
      const other = await insertEvent(db, f, "2026-11-11 10:00+02")
      const at = "2026-10-10 12:00+03"
      const cancel = await insertAudit(db, f, {
        createdAt: at,
        eventId: event,
        action: "admin_cancel_event",
        entityType: "events",
        before: { status: "published" },
        after: { status: "cancelled" },
      })
      for (const customer of [f.customerA, f.customerB]) {
        // The bookings rows carry no customer_id: derived from bookings.
        const { rows } = await db.query(
          `insert into public.bookings (customer_id, event_id, party_size,
             status, cancelled_at, booked_by, policy_snapshot)
           values ($1, $2, 1, 'cancelled', now(), 'admin',
             '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)
           returning id`,
          [customer, event]
        )
        await insertAudit(db, f, {
          createdAt: at,
          eventId: event,
          action: "admin_cancel_event",
          entityType: "bookings",
          entityId: rows[0].id,
          before: { status: "confirmed" },
          after: { status: "cancelled" },
        })
      }
      for (const customer of [f.customerA, f.customerB]) {
        const page = await list(db, f, { customer })
        expect(
          page.rows.map((r) => r.id),
          customer
        ).toEqual([cancel])
        expect(page.rows[0].customer).toBeNull()
        expect(page.rows[0].related.map((r) => r.entity_type)).toEqual([
          "bookings",
          "bookings",
        ])
      }

      // A move: listed under the target and the source session.
      const moveAt = "2026-10-10 13:00+03"
      const moved = await insertAudit(db, f, {
        createdAt: moveAt,
        customerId: f.customerA,
        eventId: other,
        action: "admin_move_booking",
        entityType: "bookings",
        before: {},
        after: { status: "confirmed" },
      })
      await insertAudit(db, f, {
        createdAt: moveAt,
        customerId: f.customerA,
        eventId: event,
        action: "admin_move_booking",
        entityType: "bookings",
        before: { status: "confirmed" },
        after: { status: "cancelled" },
      })
      for (const session of [event, other]) {
        const page = await list(db, f, { event: session })
        expect(
          page.rows.map((r) => r.id),
          session
        ).toContain(moved)
      }
      const page = await list(db, f, { event: other })
      expect(page.rows[0].related[0].event?.id).toBe(event)
    })
  })

  it("the derived customer: the profile itself, a payment's current customer, before/after", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const profile = await insertAudit(db, f, {
        createdAt: "2026-10-10 14:00+03",
        action: "admin_change_phone",
        entityType: "profiles",
        entityId: f.customerA,
        after: { result: "taken" },
      })
      const { rows } = await db.query(
        `insert into public.payments (customer_id, product_id, amount_agorot,
           paid_on, payment_method_id, source, status, product_snapshot,
           recorded_by)
         values ($1, $2, 100, current_date, $3, 'manual', 'approved',
           '{}'::jsonb, $4)
         returning id`,
        [f.customerA, f.card, f.method, f.admin]
      )
      const payment = await insertAudit(db, f, {
        createdAt: "2026-10-10 14:01+03",
        actorKind: "customer",
        actorId: f.customerA,
        action: "bind_purchase",
        entityType: "payments",
        entityId: rows[0].id,
        before: { customer_id: null },
        after: { customer_id: f.customerA },
      })
      const fromJson = await insertAudit(db, f, {
        createdAt: "2026-10-10 14:02+03",
        action: "choose_credit_outcome",
        entityType: "cancellation_credits",
        before: {},
        after: { customer_id: f.customerA, choice_pending: false },
      })
      const page = await list(db, f, { customer: f.customerA })
      expect(page.rows.map((r) => r.id)).toEqual(
        expect.arrayContaining([profile, payment, fromJson])
      )
      for (const row of page.rows) {
        expect(row.customer?.id, row.action).toBe(f.customerA)
      }
    })
  })

  it("subjects: a product's and a concept's name (a deleted concept from before); a refund's amount", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const at = "2026-10-10 15:00+03"
      await insertAudit(db, f, {
        createdAt: at,
        action: "admin_set_product_price",
        entityType: "products",
        entityId: f.card,
        customerId: f.customerA,
        before: { price_agorot: 47200 },
        after: { price_agorot: 50000 },
      })
      await insertAudit(db, f, {
        createdAt: at,
        action: "admin_delete_concept",
        entityType: "concepts",
        customerId: f.customerA,
        before: { name: testName("gone") },
        after: {},
      })
      const page = await list(db, f, { customer: f.customerA })
      const byAction = Object.fromEntries(page.rows.map((r) => [r.action, r]))
      expect(byAction.admin_set_product_price.subject).toBe(testName("card"))
      expect(byAction.admin_delete_concept.subject).toBe(testName("gone"))
      expect(byAction.admin_set_product_price.amount_agorot).toBeNull()
    })
  })
})

// As the owner: a published session today + days at 10:00 Jerusalem, open
// for booking until it starts.
async function insertEventInDays(
  db: Db,
  f: Fixture,
  days: number
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true,
       'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $2::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [f.concept, days]
  )

  return rows[0].id
}

// Settings for real bookings, and only this test's sessions published.
async function bookable(db: Db) {
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2`
  )

  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
}

async function asUser<T>(db: Db, user: string, fn: () => Promise<T>) {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

describe("admin_list_audit: real operations", () => {
  it("a real move_booking: one item on the new booking, the old one related, listed under both sessions, no empty related row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)

      await bookable(db)

      const a = await insertEventInDays(db, f, 5)

      const b = await insertEventInDays(db, f, 6)

      await asUser(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          key: randomUUID(),
        })
      )

      const original = await asUser(db, f.customerA, async () => {
        const { rows } = await db.query(
          "select public.book_session($1, $2) as r",
          [a, randomUUID()]
        )

        return rows[0].r.booking_id as string
      })

      const moved = await asUser(db, f.customerA, async () => {
        const { rows } = await db.query(
          "select public.move_booking($1, $2, $3) as r",
          [original, b, randomUUID()]
        )

        return rows[0].r.booking_id as string
      })

      for (const event of [a, b]) {
        const page = await list(db, f, { event })

        const moves = page.rows.filter((r) => r.action === "move_booking")

        expect(moves, event).toHaveLength(1)
      }

      const page = await list(db, f, { event: b })

      const item = page.rows.find((r) => r.action === "move_booking")!
      expect(item.entity_type).toBe("bookings")

      expect(item.event?.id).toBe(b)

      expect(item.customer?.id).toBe(f.customerA)

      expect(item.funding).toBe("card")

      for (const related of item.related) {
        expect(related.changes.length, related.entity_type).toBeGreaterThan(0)
      }

      expect(
        item.related.some(
          (r) => r.entity_type === "bookings" && r.event?.id === a
        )
      ).toBe(true)

      const { rows } = await db.query(
        `select count(*)::int as n from public.audit_log
         where action = 'move_booking' and entity_type = 'bookings'
           and entity_id = $1 and before = '{}'::jsonb
           and after <> '{}'::jsonb`,
        [moved]
      )

      expect(rows[0].n).toBe(1)
    })
  })

  it("a real cancel_booking of a pinned single with a credit: one item, the created credit related, funding pinned; a refund's current amount", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)

      await bookable(db)

      const a = await insertEventInDays(db, f, 5)

      await insertEventInDays(db, f, 6)

      await insertEventInDays(db, f, 7)

      const single = await insertProduct(db, {
        label: "audit_single",
        type: "single",
        price: 12800,
        units: 1,
        validityMode: "session",
      })

      const approved = await asUser(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: single,
          eventId: a,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          key: randomUUID(),
        })
      )

      const booking = approved.booking_id as string
      await asUser(db, f.customerA, () =>
        db.query("select public.cancel_booking($1, $2, $3) as r", [
          booking,
          randomUUID(),
          "credit",
        ])
      )

      const page = await list(db, f, { event: a })

      const cancels = page.rows.filter((r) => r.action === "cancel_booking")

      expect(cancels).toHaveLength(1)

      const item = cancels[0]
      expect(item.entity_type).toBe("bookings")

      expect(item.customer?.id).toBe(f.customerA)

      expect(item.funding).toBe("pinned")

      const credit = item.related.find(
        (r) => r.entity_type === "cancellation_credits"
      )!
      expect(credit.changes).toEqual(
        expect.arrayContaining([
          { key: "options_count", before: null, after: 2 },
        ])
      )

      // A refund request on that credit, completed: its current amount.
      const { rows: credits } = await db.query(
        "select id from public.cancellation_credits where origin_booking_id = $1",
        [booking]
      )

      const { rows: refunds } = await db.query(
        `insert into public.refund_requests (
           customer_id, credit_id, payment_id, booking_id, amount_agorot)
         values ($1, $2, $3, $4, 12800)
         returning id`,
        [f.customerA, credits[0].id, approved.payment_id, booking]
      )

      await insertAudit(db, f, {
        createdAt: "2026-10-10 17:00+03",
        action: "admin_complete_refund",
        entityType: "refund_requests",
        entityId: refunds[0].id,
        eventId: a,
        before: { status: "requested" },
        after: { status: "completed" },
      })

      const refundPage = await list(db, f, { customer: f.customerA })

      const refund = refundPage.rows.find(
        (r) => r.action === "admin_complete_refund"
      )!
      expect(refund.amount_agorot).toBe(12800)

      expect(refund.customer?.id).toBe(f.customerA)
    })
  })
})

describe("admin_list_audit: derived customer and paging by customer", () => {
  it("a payment and a link with no customer_id in the row or the diff: the current row's customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)

      const { rows: payments } = await db.query(
        `insert into public.payments (customer_id, product_id, amount_agorot,
           paid_on, payment_method_id, source, status, product_snapshot,
           recorded_by)
         values ($1, $2, 100, current_date, $3, 'manual', 'approved',
           '{}'::jsonb, $4)
         returning id`,
        [f.customerA, f.card, f.method, f.admin]
      )

      const payment = await insertAudit(db, f, {
        createdAt: "2026-10-10 18:00+03",
        action: "approve_payment",
        entityType: "payments",
        entityId: payments[0].id,
        before: {},
        after: { amount_agorot: 100, status: "approved" },
      })

      const { rows: tokens } = await db.query(
        `insert into public.activation_tokens (
           customer_id, purpose, token_hash, expires_at)
         values ($1, 'claim', $2, now() + interval '1 day')
         returning id`,
        [f.customerA, "c".repeat(64)]
      )

      const token = await insertAudit(db, f, {
        createdAt: "2026-10-10 18:01+03",
        action: "revoke_link",
        entityType: "activation_tokens",
        entityId: tokens[0].id,
        before: { state: "pending" },
        after: { state: "revoked" },
      })

      const page = await list(db, f, { customer: f.customerA })

      const ids = page.rows.map((r) => r.id)

      expect(ids).toEqual(expect.arrayContaining([payment, token]))

      for (const row of page.rows) {
        expect(row.customer?.id, row.action).toBe(f.customerA)
      }
    })
  })

  it("customer filter paging: items that match only through related rows page with the direct ones, no duplicates or gaps", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)

      const tag = testName("paging")

      // 30 session cancels with no customer, each with a related credit of
      // customer A (its own actor and second).
      await db.query(
        `with ops as (
           select g, gen_random_uuid() as actor,
             now() - make_interval(secs => g) as t
           from generate_series(1, 30) g
         )
         insert into public.audit_log (
           created_at, actor_id, actor_kind, action, entity_type, before,
           after, reason)
         select t, actor, 'admin', 'admin_cancel_event', 'events',
           '{"status": "published"}'::jsonb, '{"status": "cancelled"}'::jsonb,
           $2
         from ops
         union all
         select t, actor, 'admin', 'admin_cancel_event',
           'cancellation_credits', '{}'::jsonb,
           jsonb_build_object('customer_id', $1::text, 'options_count', 2),
           null
         from ops`,
        [f.customerA, tag]
      )

      // 25 of her own consents, between them.
      await db.query(
        `insert into public.audit_log (
           created_at, actor_id, actor_kind, action, entity_type,
           customer_id, before, after, reason)
         select now() - make_interval(secs => g * 1.2), $1, 'customer',
           'set_photo_consent', 'profiles', $1,
           '{"photo_consent": false}'::jsonb, '{"photo_consent": true}'::jsonb,
           $2
         from generate_series(1, 25) g`,
        [f.customerA, tag]
      )

      const first = await list(db, f, { customer: f.customerA })

      expect(first.rows).toHaveLength(50)

      expect(first.has_more).toBe(true)

      const last = first.rows[49]
      const second = await list(db, f, {
        customer: f.customerA,
        before: { createdAt: last.created_at, id: last.id },
      })

      expect(second.has_more).toBe(false)

      const all = [...first.rows, ...second.rows].map((r) => r.id)

      expect(new Set(all).size).toBe(all.length)

      const { rows } = await db.query(
        `select id from public.audit_log
         where reason = $1
         order by created_at desc, id desc`,
        [tag]
      )

      expect(all).toEqual(rows.map((r: { id: string }) => r.id))

      expect(rows).toHaveLength(55)
    })
  })

  it("subject of a content section: its page and key", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)

      const { rows } = await db.query(
        "select id, page_slug || '/' || key as subject from public.content_sections order by page_slug, key limit 1"
      )

      await insertAudit(db, f, {
        action: "admin_publish_content",
        entityType: "content_sections",
        entityId: rows[0].id,
        customerId: f.customerA,
        before: { published_at: null },
        after: { published_at: "2026-10-10T10:00:00+00:00" },
      })

      const page = await list(db, f, { customer: f.customerA })

      expect(page.rows[0].subject).toBe(rows[0].subject)
    })
  })
})

describe("admin_list_audit: what a row shows", () => {
  it("a masked value stays <changed>", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertAudit(db, f, {
        customerId: f.customerA,
        entityType: "profiles",
        action: "join_complete",
        before: { full_name: "<changed>" },
        after: { full_name: "<changed>" },
      })
      const page = await list(db, f, { customer: f.customerA })
      expect(page.rows[0].changes).toEqual([
        { key: "full_name", before: "<changed>", after: "<changed>" },
      ])
    })
  })

  it("hidden keys (id, *_id, *_hash, created_at, sort_order) never come back, related rows too; a key on one side is null on the other", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertAudit(db, f, {
        customerId: f.customerA,
        entityType: "activation_tokens",
        action: "admin_issue_link",
        before: {},
        after: {
          id: randomUUID(),
          customer_id: f.customerA,
          token_hash: "a".repeat(64),
          input_hash: "b".repeat(64),
          created_at: "2026-10-10T10:00:00+03:00",
          updated_at: "2026-10-10T10:00:00+03:00",
          sort_order: 3,
          state: "pending",
        },
      })
      const at = "2026-10-10 16:00+03"
      await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        customerId: f.customerA,
        entityType: "profiles",
        action: "join_complete",
        after: { full_name: "<changed>" },
      })
      await insertAudit(db, f, {
        createdAt: at,
        actorKind: "customer",
        customerId: f.customerA,
        entityType: "babies",
        action: "join_complete",
        before: { name: "<changed>", id: randomUUID() },
        after: {},
      })
      const page = await list(db, f, { customer: f.customerA })
      expectNoHiddenKey(page)
      const token = page.rows.find((r) => r.action === "admin_issue_link")!
      expect(token.changes).toEqual([
        { key: "state", before: null, after: "pending" },
      ])
      const join = page.rows.find((r) => r.action === "join_complete")!
      expect(join.related).toEqual([
        {
          entity_type: "babies",
          changes: [{ key: "name", before: "<changed>", after: null }],
          event: null,
        },
      ])
    })
  })

  it("no hidden key in the latest rows of the whole log", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expectNoHiddenKey(await list(db, f, {}))
    })
  })

  it("an anonymized customer: name null", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerB]
      )
      await insertAudit(db, f, { customerId: f.customerB })
      const page = await list(db, f, { customer: f.customerB })
      expect(page.rows[0].customer).toEqual({ id: f.customerB, name: null })
    })
  })
})

describe("admin_list_audit: who may call it", () => {
  it("a customer -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customerA)
      expect(await queryError(db, LIST, params({}))).toEqual({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
    })
  })

  it("anon has no execute", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      const error = await queryError(db, LIST, params({}))
      expect(error?.code).toBe("42501")
    })
  })
})

// Story 5.20: a marketing reminder text's subject is the text itself (the
// screen shortens it); a text no longer there falls back to the row's body.
describe("admin_list_audit: a marketing reminder text's subject", () => {
  it("the current body, else the body in the row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const body = testName("reminder_text_now")
      const { rows } = await db.query(
        `insert into public.marketing_reminder_texts (body, sort_order)
         values ($1, 999) returning id`,
        [body]
      )
      const at = "2099-06-01 10:00+03"
      const kept = await insertAudit(db, f, {
        createdAt: at,
        action: "admin_update_marketing_reminder_text",
        entityType: "marketing_reminder_texts",
        entityId: rows[0].id,
        before: { body: testName("reminder_text_before") },
        after: { body },
      })
      const gone = await insertAudit(db, f, {
        createdAt: "2099-06-01 11:00+03",
        action: "admin_add_marketing_reminder_text",
        entityType: "marketing_reminder_texts",
        entityId: randomUUID(),
        after: { body: testName("reminder_text_gone") },
      })
      const page = await list(db, f, { from: "2099-06-01", to: "2099-06-01" })
      const subjects = Object.fromEntries(
        page.rows.map((row) => [row.id, row.subject])
      )
      expect(subjects[kept]).toBe(body)
      expect(subjects[gone]).toBe(testName("reminder_text_gone"))
    })
  })
})
