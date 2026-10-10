// Story 4.5: admin_list_audit, the audit log viewer's read RPC. One test per
// row of the spec's I/O matrix, plus the customer filter, combined filters
// and the keys that are never returned. The dev database holds other audit
// rows, so every check filters by this test's session or customer. Rows are
// inserted as the owner (the table's only writer is private.audit, which
// cannot set created_at). Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { seedMoney, type MoneyFixture } from "./support/money"

const LIST = "select public.admin_list_audit($1, $2, $3, $4, $5, $6) as r"

type Change = { key: string; before: unknown; after: unknown }
type Row = {
  id: string
  created_at: string
  actor_kind: string
  action: string
  entity_type: string
  customer: { id: string; name: string | null } | null
  event: { id: string; title: string; local_date: string } | null
  changes: Change[]
  reason: string | null
}
type Page = { rows: Row[]; has_more: boolean }

type Filters = {
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
    action?: string
    entityType?: string
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
      actorKind === "system" ? null : f.admin,
      actorKind,
      values.action ?? "admin_update_event",
      values.entityType ?? "events",
      randomUUID(),
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
    for (const change of row.changes) {
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
      const row = page.rows[0]
      expect(row).toMatchObject({
        id: mine,
        actor_kind: "admin",
        action: "admin_update_event",
        entity_type: "events",
        customer: null,
        event: { id: one, title: f.conceptName, local_date: "2026-11-02" },
        changes: [{ key: "capacity_adults", before: 12, after: 14 }],
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
      expect(forA.rows.map((r) => r.id)).toEqual(
        expect.arrayContaining([both, onlyCustomer])
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

  it("bad range: from after to -> INVALID_INPUT {field: to}; over 366 days -> {field: from}", async () => {
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
        await raised(db, LIST, [null, null, null, null, null, randomUUID()])
      ).toMatchObject({ message: "INVALID_INPUT", detail: { field: "cursor" } })
    })
  })
})

describe("admin_list_audit: paging", () => {
  it("51 rows: 50 and has_more; the next page is the 51st", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, "2026-11-06 10:00+02")
      // Same created_at for some rows: the id breaks the tie.
      await db.query(
        `insert into public.audit_log (
           created_at, actor_id, actor_kind, action, entity_type, event_id)
         select now() - make_interval(secs => g / 2), $1, 'admin',
           'admin_update_event', 'events', $2
         from generate_series(1, 51) g`,
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
        "select id from public.audit_log where event_id = $1 order by created_at desc, id desc",
        [event]
      )
      expect(all).toEqual(rows.map((r: { id: string }) => r.id))
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

  it("hidden keys (id, *_id, *_hash, created_at, sort_order) never come back; a key on one side is null on the other", async () => {
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
      await insertAudit(db, f, {
        customerId: f.customerA,
        entityType: "babies",
        action: "join_complete",
        before: { name: "<changed>" },
        after: {},
      })
      const page = await list(db, f, { customer: f.customerA })
      expectNoHiddenKey(page)
      const token = page.rows.find((r) => r.action === "admin_issue_link")!
      expect(token.changes).toEqual([
        { key: "state", before: null, after: "pending" },
      ])
      const baby = page.rows.find((r) => r.entity_type === "babies")!
      expect(baby.changes).toEqual([
        { key: "name", before: "<changed>", after: null },
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
