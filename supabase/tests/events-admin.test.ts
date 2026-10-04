// Story 3.1: concepts and session management. admin_create_event,
// admin_duplicate_event, admin_update_event, admin_publish_event, the
// registration-close and revision triggers, and who sees a draft. One test
// per row of the spec's I/O matrix. Everything runs in inRollback, with the
// settings set to their defaults inside the transaction.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const CREATE = "select public.admin_create_event($1::jsonb, $2) as r"
const DUPLICATE =
  "select public.admin_duplicate_event($1, $2::date, $3::time, $4::time, $5) as r"
const UPDATE = "select public.admin_update_event($1, $2::jsonb, $3) as r"
const PUBLISH = "select public.admin_publish_event($1, $2) as r"

type Fixture = {
  admin: string
  customer: string
  concepts: Record<string, string>
}

// As the owner: an admin, an activated customer, the default settings, and
// the seeded concepts by theme_key.
async function seed(db: Db): Promise<Fixture> {
  const admin = randomUUID()
  const customer = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName("events_customer")]
  )
  await db.query(
    `update public.business_settings
     set default_capacity_regular = 12, default_capacity_couple = 14,
         registration_close_days_before = 1,
         registration_close_local_time = '20:00'`
  )
  const { rows } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  return {
    admin,
    customer,
    concepts: Object.fromEntries(rows.map((row) => [row.theme_key, row.id])),
  }
}

async function one(db: Db, text: string, params: unknown[]) {
  const { rows } = await db.query(text, params)
  return rows[0].r
}

// The row as the owner, with the times as UTC text.
async function eventRow(db: Db, id: string) {
  const { rows } = await db.query(
    `select concept_id, kind, description, capacity_adults, status, revision,
       registration_close_overridden, display_price_agorot,
       to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as starts,
       to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as ends,
       to_char(registration_closes_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as closes
     from public.events where id = $1`,
    [id]
  )
  return rows[0]
}

// Ordered by action: rows of one transaction share created_at.
async function auditOf(db: Db, eventId: string) {
  const { rows } = await db.query(
    `select action, entity_type, entity_id, event_id, before, after
     from public.audit_log where event_id = $1
     order by action, id`,
    [eventId]
  )
  return rows
}

// queryError with the exception's detail (detail.field).
async function failure(db: Db, text: string, params: unknown[]) {
  await db.query("savepoint failure")
  try {
    await db.query(text, params)
    await db.query("release savepoint failure")
    return null
  } catch (error) {
    await db.query("rollback to savepoint failure")
    const { code, message, detail } = error as {
      code?: string
      message?: string
      detail?: string
    }
    return {
      code,
      message,
      field: detail ? (JSON.parse(detail) as { field?: string }).field : null,
    }
  }
}

// As the admin; returns to the owner role afterwards.
async function asAdmin<T>(db: Db, admin: string, fn: () => Promise<T>) {
  await asAuthenticated(db, admin)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function create(
  db: Db,
  f: Fixture,
  event: Record<string, unknown>,
  key: string = randomUUID()
): Promise<string> {
  const result = await asAdmin(db, f.admin, () => one(db, CREATE, [event, key]))
  return result.event_id
}

const WHEN = { date: "2026-12-15", start_time: "10:00", end_time: "12:00" }

describe("creating from a concept", () => {
  it("a couple concept: couple, 14 places, closes at 20:00 the day before", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, {
        concept_id: f.concepts.grandma,
        ...WHEN,
      })
      expect(await eventRow(db, id)).toMatchObject({
        concept_id: f.concepts.grandma,
        kind: "couple",
        description: null,
        capacity_adults: 14,
        status: "draft",
        revision: 1,
        registration_close_overridden: false,
        display_price_agorot: null,
        // 15.12 is winter time (UTC+2).
        starts: "2026-12-15T08:00Z",
        ends: "2026-12-15T10:00Z",
        closes: "2026-12-14T18:00Z",
      })
      const audit = await auditOf(db, id)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        action: "admin_create_event",
        entity_type: "events",
        entity_id: id,
        event_id: id,
      })
    })
  })

  it("a regular concept: regular, 12 places; given values win", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      expect(await eventRow(db, id)).toMatchObject({
        kind: "regular",
        capacity_adults: 12,
      })

      const other = await create(db, f, {
        concept_id: f.concepts.greek,
        ...WHEN,
        kind: "couple",
        description: "  " + testName("text") + "  ",
        display_price_agorot: 13800,
      })
      expect(await eventRow(db, other)).toMatchObject({
        kind: "couple",
        capacity_adults: 14,
        description: testName("text"),
        display_price_agorot: 13800,
      })
    })
  })

  it("refuses an archived concept", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.concepts set archived_at = now() where id = $1",
        [f.concepts.greek]
      )
      await asAuthenticated(db, f.admin)
      expect(
        await failure(db, CREATE, [
          { concept_id: f.concepts.greek, ...WHEN },
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", field: "concept_id" })
    })
  })
})

describe("who sees a draft", () => {
  it("customers and guests see only the published session; the admin sees both", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const draft = await create(db, f, {
        concept_id: f.concepts.mothers,
        ...WHEN,
      })
      const published = await create(db, f, {
        concept_id: f.concepts.mothers,
        ...WHEN,
      })
      await asAdmin(db, f.admin, () =>
        one(db, PUBLISH, [published, randomUUID()])
      )
      const ids = [draft, published]
      const visible = async () => {
        const { rows } = await db.query(
          "select id from public.events where id = any($1::uuid[]) order by id",
          [ids]
        )
        return rows.map((row) => row.id)
      }

      await asAuthenticated(db, f.customer)
      expect(await visible()).toEqual([published])
      await db.query("reset role")
      await db.query("set local role anon")
      expect(await visible()).toEqual([published])
      // Concepts are public.
      const { rows } = await db.query(
        "select count(*)::int as n from public.concepts where id = $1",
        [f.concepts.mothers]
      )
      expect(rows[0].n).toBe(1)
      await db.query("reset role")
      await asAuthenticated(db, f.admin)
      expect(await visible()).toEqual([...ids].sort())
    })
  })
})

describe("updating", () => {
  it("logs a capacity change 12 -> 13 with event_id", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      await asAdmin(db, f.admin, () =>
        one(db, UPDATE, [id, { capacity_adults: 13 }, randomUUID()])
      )
      expect((await eventRow(db, id)).capacity_adults).toBe(13)
      const audit = await auditOf(db, id)
      expect(audit.map((row) => row.action)).toEqual([
        "admin_create_event",
        "admin_update_event",
      ])
      expect(audit[1]).toEqual({
        action: "admin_update_event",
        entity_type: "events",
        entity_id: id,
        event_id: id,
        before: { capacity_adults: 12 },
        after: { capacity_adults: 13 },
      })
      // The revision does not move for a capacity change.
      expect((await eventRow(db, id)).revision).toBe(1)
    })
  })

  it("a new time raises the revision; the close follows the date unless set by hand", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      const update = (changes: Record<string, unknown>) =>
        asAdmin(db, f.admin, () => one(db, UPDATE, [id, changes, randomUUID()]))

      await update({ start_time: "11:00" })
      expect(await eventRow(db, id)).toMatchObject({
        starts: "2026-12-15T09:00Z",
        ends: "2026-12-15T10:00Z",
        closes: "2026-12-14T18:00Z",
        revision: 2,
      })

      await update({ date: "2026-12-17" })
      expect(await eventRow(db, id)).toMatchObject({
        starts: "2026-12-17T09:00Z",
        ends: "2026-12-17T10:00Z",
        closes: "2026-12-16T18:00Z",
        revision: 3,
      })

      // Set by hand: kept when the session moves.
      await update({ registration_closes_local: "2026-12-16T12:30" })
      expect(await eventRow(db, id)).toMatchObject({
        closes: "2026-12-16T10:30Z",
        registration_close_overridden: true,
        revision: 3,
      })
      await update({ date: "2026-12-18", start_time: "10:00" })
      expect(await eventRow(db, id)).toMatchObject({
        starts: "2026-12-18T08:00Z",
        closes: "2026-12-16T10:30Z",
        revision: 4,
      })

      // Given back to the settings: computed again.
      await update({ registration_closes_local: null })
      expect(await eventRow(db, id)).toMatchObject({
        closes: "2026-12-17T18:00Z",
        registration_close_overridden: false,
      })

      // A kind change raises it too; a description does not.
      await update({ kind: "couple" })
      expect((await eventRow(db, id)).revision).toBe(5)
      await update({ description: testName("d") })
      expect((await eventRow(db, id)).revision).toBe(5)
    })
  })

  it("an unchanged value writes no audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      await asAdmin(db, f.admin, () =>
        one(db, UPDATE, [id, { capacity_adults: 12 }, randomUUID()])
      )
      expect(await auditOf(db, id)).toHaveLength(1)
    })
  })
})

describe("daylight saving", () => {
  it("27.10.2026 (after the change) closes at 20:00 Israel time on 26.10", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const after = await create(db, f, {
        concept_id: f.concepts.mothers,
        date: "2026-10-27",
        start_time: "10:00",
        end_time: "12:00",
      })
      const before = await create(db, f, {
        concept_id: f.concepts.mothers,
        date: "2026-10-20",
        start_time: "10:00",
        end_time: "12:00",
      })
      // Winter time (UTC+2) after 25.10, summer time (UTC+3) before.
      expect(await eventRow(db, after)).toMatchObject({
        starts: "2026-10-27T08:00Z",
        closes: "2026-10-26T18:00Z",
      })
      expect(await eventRow(db, before)).toMatchObject({
        starts: "2026-10-20T07:00Z",
        closes: "2026-10-19T17:00Z",
      })
    })
  })
})

describe("duplicating", () => {
  it("a published session becomes a new draft with the same values; the source is unchanged", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const source = await create(db, f, {
        concept_id: f.concepts.grandma,
        ...WHEN,
        description: testName("desc"),
        capacity_adults: 16,
        display_price_agorot: 25000,
      })
      await asAdmin(db, f.admin, async () => {
        await one(db, PUBLISH, [source, randomUUID()])
        await one(db, UPDATE, [
          source,
          { registration_closes_local: "2026-12-13T09:00" },
          randomUUID(),
        ])
      })
      const sourceBefore = await eventRow(db, source)

      const copy = await asAdmin(db, f.admin, () =>
        one(db, DUPLICATE, [
          source,
          "2027-01-05",
          "09:30",
          "11:30",
          randomUUID(),
        ])
      )
      expect(copy.event_id).not.toBe(source)
      expect(await eventRow(db, copy.event_id)).toMatchObject({
        concept_id: f.concepts.grandma,
        kind: "couple",
        description: testName("desc"),
        capacity_adults: 16,
        display_price_agorot: 25000,
        status: "draft",
        revision: 1,
        registration_close_overridden: false,
        starts: "2027-01-05T07:30Z",
        ends: "2027-01-05T09:30Z",
        closes: "2027-01-04T18:00Z",
      })
      expect(await eventRow(db, source)).toEqual(sourceBefore)
      expect((await auditOf(db, copy.event_id))[0]).toMatchObject({
        action: "admin_duplicate_event",
        event_id: copy.event_id,
      })
    })
  })
})

describe("publishing", () => {
  it("draft -> published once; publishing again succeeds without a change", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      await asAdmin(db, f.admin, async () => {
        expect(await one(db, PUBLISH, [id, randomUUID()])).toEqual({
          event_id: id,
          status: "published",
        })
        expect(await one(db, PUBLISH, [id, randomUUID()])).toEqual({
          event_id: id,
          status: "published",
        })
      })
      expect((await eventRow(db, id)).status).toBe("published")
      expect((await auditOf(db, id)).map((row) => row.action)).toEqual([
        "admin_create_event",
        "admin_publish_event",
      ])
    })
  })

  // One create screen (user decision 2026-10-04): publish in the same
  // request, and a close set by hand at creation.
  it("creates and publishes in one request, with one audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const result = await asAdmin(db, f.admin, () =>
        one(db, CREATE, [
          { concept_id: f.concepts.greek, ...WHEN, publish: true },
          randomUUID(),
        ])
      )
      expect(result.status).toBe("published")
      expect((await eventRow(db, result.event_id)).status).toBe("published")
      const audit = await auditOf(db, result.event_id)
      expect(audit.map((row) => row.action)).toEqual(["admin_create_event"])
      expect(audit[0].after).toMatchObject({ status: "published" })

      await asAuthenticated(db, f.admin)
      expect(
        await failure(db, CREATE, [
          { concept_id: f.concepts.greek, ...WHEN, publish: "yes" },
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", field: "publish" })
    })
  })

  it("keeps a close set at creation; a close after the start is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, {
        concept_id: f.concepts.greek,
        ...WHEN,
        registration_closes_local: "2026-12-13T18:00",
      })
      // 13.12 18:00 in Israel (winter, UTC+2); the session is a draft.
      expect(await eventRow(db, id)).toMatchObject({
        closes: "2026-12-13T16:00Z",
        registration_close_overridden: true,
        status: "draft",
      })

      await asAuthenticated(db, f.admin)
      expect(
        await failure(db, CREATE, [
          {
            concept_id: f.concepts.greek,
            ...WHEN,
            registration_closes_local: "2026-12-15T11:00",
          },
          randomUUID(),
        ])
      ).toMatchObject({
        message: "INVALID_INPUT",
        field: "registration_closes_local",
      })
    })
  })

  it("the settings start a new session at 10:30-14:30", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        `select to_char(default_session_start_time, 'HH24:MI') as start,
           to_char(default_session_end_time, 'HH24:MI') as end
         from public.business_settings`
      )
      expect(rows).toEqual([{ start: "10:30", end: "14:30" }])
      expect(
        await queryError(
          db,
          `update public.business_settings
           set default_session_end_time = '10:00'`
        )
      ).toMatchObject({ code: "23514" })
    })
  })

  it("does not publish or edit a cancelled session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [id]
      )
      expect((await eventRow(db, id)).revision).toBe(2)
      await asAuthenticated(db, f.admin)
      expect(await failure(db, PUBLISH, [id, randomUUID()])).toMatchObject({
        message: "INVALID_INPUT",
      })
      expect(
        await failure(db, UPDATE, [id, { capacity_adults: 13 }, randomUUID()])
      ).toMatchObject({ message: "INVALID_INPUT" })
    })
  })
})

describe("invalid input", () => {
  it("refuses an end before the start, capacity 0 and concept_id in an update; nothing is saved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      const before = await eventRow(db, id)
      const { rows: count } = await db.query(
        "select count(*)::int as n from public.events"
      )
      await asAuthenticated(db, f.admin)

      const cases: [string, unknown[], string][] = [
        [
          CREATE,
          [
            {
              concept_id: f.concepts.greek,
              ...WHEN,
              start_time: "12:00",
              end_time: "10:00",
            },
            randomUUID(),
          ],
          "end_time",
        ],
        [
          CREATE,
          [
            { concept_id: f.concepts.greek, ...WHEN, capacity_adults: 0 },
            randomUUID(),
          ],
          "capacity_adults",
        ],
        [
          CREATE,
          [
            { concept_id: f.concepts.greek, ...WHEN, display_price_agorot: -1 },
            randomUUID(),
          ],
          "display_price_agorot",
        ],
        [
          CREATE,
          [
            { concept_id: f.concepts.greek, ...WHEN, date: "2026-02-30" },
            randomUUID(),
          ],
          "date",
        ],
        [
          CREATE,
          [{ concept_id: f.concepts.greek, date: WHEN.date }, randomUUID()],
          "start_time",
        ],
        [CREATE, [{ ...WHEN }, randomUUID()], "concept_id"],
        [
          CREATE,
          [{ concept_id: f.concepts.greek, ...WHEN, title: "x" }, randomUUID()],
          "title",
        ],
        [UPDATE, [id, { end_time: "09:00" }, randomUUID()], "end_time"],
        [UPDATE, [id, { capacity_adults: 0 }, randomUUID()], "capacity_adults"],
        [
          UPDATE,
          [id, { capacity_adults: 1.5 }, randomUUID()],
          "capacity_adults",
        ],
        [
          UPDATE,
          [id, { concept_id: f.concepts.mothers }, randomUUID()],
          "concept_id",
        ],
        [
          UPDATE,
          [id, { registration_closes_local: "2026-12-15T10:30" }, randomUUID()],
          "registration_closes_local",
        ],
        [UPDATE, [id, { kind: "triple" }, randomUUID()], "kind"],
        [
          DUPLICATE,
          [id, "2027-01-05", "12:00", "11:00", randomUUID()],
          "end_time",
        ],
      ]
      for (const [query, params, field] of cases) {
        expect(await failure(db, query, params), field).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
          field,
        })
      }

      await db.query("reset role")
      expect(await eventRow(db, id)).toEqual(before)
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.events"
      )
      expect(after[0].n).toBe(count[0].n)
      expect(await auditOf(db, id)).toHaveLength(1)
    })
  })
})

describe("idempotency", () => {
  it("the same key returns the same result with one audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const event = { concept_id: f.concepts.greek, ...WHEN }
      const first = await create(db, f, event, key)
      const second = await create(db, f, event, key)
      expect(second).toBe(first)
      expect(await auditOf(db, first)).toHaveLength(1)

      const updateKey = randomUUID()
      await asAdmin(db, f.admin, async () => {
        const a = await one(db, UPDATE, [
          first,
          { capacity_adults: 13 },
          updateKey,
        ])
        // A change in between: the replay must not run again (13 over 15).
        await one(db, UPDATE, [first, { capacity_adults: 15 }, randomUUID()])
        const b = await one(db, UPDATE, [
          first,
          { capacity_adults: 13 },
          updateKey,
        ])
        expect(b).toEqual(a)
        const dupKey = randomUUID()
        const c = await one(db, DUPLICATE, [
          first,
          "2027-01-05",
          "10:00",
          "12:00",
          dupKey,
        ])
        const d = await one(db, DUPLICATE, [
          first,
          "2027-01-05",
          "10:00",
          "12:00",
          dupKey,
        ])
        expect(d).toEqual(c)
      })
      expect((await eventRow(db, first)).capacity_adults).toBe(15)
      // create, 12 -> 13, 13 -> 15; the replay added nothing.
      expect(await auditOf(db, first)).toHaveLength(3)
    })
  })
})

describe("a close rule that falls after the start", () => {
  it("0 days before at 20:00 closes at the start, on create, duplicate and a new time", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        `update public.business_settings
         set registration_close_days_before = 0,
             registration_close_local_time = '20:00'`
      )
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      const atStart = async (eventId: string) => {
        const row = await eventRow(db, eventId)
        expect(row.closes, eventId).toBe(row.starts)
        return row
      }
      expect((await atStart(id)).starts).toBe("2026-12-15T08:00Z")

      const copy = await asAdmin(db, f.admin, () =>
        one(db, DUPLICATE, [id, "2027-01-05", "10:00", "12:00", randomUUID()])
      )
      expect((await atStart(copy.event_id)).starts).toBe("2027-01-05T08:00Z")

      await asAdmin(db, f.admin, () =>
        one(db, UPDATE, [id, { start_time: "09:00" }, randomUUID()])
      )
      expect((await atStart(id)).starts).toBe("2026-12-15T07:00Z")
    })
  })
})

describe("permissions", () => {
  it("refuses a customer (NOT_AUTHORIZED) and anon (42501) on every new RPC", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await create(db, f, { concept_id: f.concepts.greek, ...WHEN })
      const calls: [string, unknown[]][] = [
        [CREATE, [{ concept_id: f.concepts.greek, ...WHEN }, randomUUID()]],
        [DUPLICATE, [id, "2027-01-05", "10:00", "12:00", randomUUID()]],
        [UPDATE, [id, { capacity_adults: 13 }, randomUUID()]],
        [PUBLISH, [id, randomUUID()]],
      ]
      await asAuthenticated(db, f.customer)
      for (const [query, params] of calls) {
        expect(await queryError(db, query, params), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query("reset role")
      await db.query("set local role anon")
      for (const [query, params] of calls) {
        expect((await queryError(db, query, params))?.code, query).toBe("42501")
      }
    })
  })

  it("leaves the private helpers without a grant and the tables without writes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const statement of [
        "select private.local_instant('2026-12-15', '10:00')",
        "select private.apply_event_changes(null::public.events, '{}', '{}')",
        "select private.save_event(null::public.events, true)",
        `insert into public.concepts (name, default_kind, theme_key) values ('x', 'regular', 'greek')`,
        "update public.events set capacity_adults = 1",
      ]) {
        expect((await queryError(db, statement))?.code, statement).toBe("42501")
      }
    })
  })
})

describe("schema", () => {
  it("has no events.menu and no events.title", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'events'
           and column_name in ('menu', 'title')`
      )
      expect(rows).toEqual([])
    })
  })

  it("seeds the five concepts with their kinds", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        `select theme_key, default_kind from public.concepts
         where theme_key in ('mothers', 'couples', 'grandma', 'grandpa', 'greek')
         order by sort_order`
      )
      expect(rows).toEqual([
        { theme_key: "mothers", default_kind: "regular" },
        { theme_key: "couples", default_kind: "couple" },
        { theme_key: "grandma", default_kind: "couple" },
        { theme_key: "grandpa", default_kind: "couple" },
        { theme_key: "greek", default_kind: "regular" },
      ])
    })
  })
})
