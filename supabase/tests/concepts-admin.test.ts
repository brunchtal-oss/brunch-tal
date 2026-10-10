// Story 4.8: concepts in the admin. admin_create_concept,
// admin_update_concept, admin_set_concept_archived, admin_delete_concept and
// admin_set_concept_image, along the spec's I/O matrix (all rows but the
// description fallback, which is pure TypeScript). Everything runs in
// inRollback; storage.objects rows stand in for image files.

import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { asAuthenticated, inRollback, testName, type Db } from "./support/db"

const CREATE = "select public.admin_create_concept($1::jsonb, $2) as r"
const UPDATE = "select public.admin_update_concept($1, $2::jsonb, $3) as r"
const ARCHIVE = "select public.admin_set_concept_archived($1, $2) as r"
const DELETE = "select public.admin_delete_concept($1, $2) as r"
const SET_IMAGE = "select public.admin_set_concept_image($1, $2) as r"
const CREATE_EVENT = "select public.admin_create_event($1::jsonb, $2) as r"
const CREATE_MEDIA = "select public.admin_create_media($1) as r"
const BEGIN = "select public.admin_begin_media_publish($1, $2, $3, $4) as r"
const FINISH = "select public.admin_finish_media_publish($1) as r"

// Each case runs several RPCs on the shared pooler.
vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>

type Fixture = { admin: string; customer: string }

// As the owner: an admin and an activated customer.
async function seed(db: Db): Promise<Fixture> {
  const admin = randomUUID()
  const customer = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName("concepts_customer")]
  )
  return { admin, customer }
}

// As a signed-in user; returns to the owner role afterwards.
async function as<T = Row>(
  db: Db,
  userId: string,
  text: string,
  params: unknown[]
): Promise<T> {
  await asAuthenticated(db, userId)
  try {
    const { rows } = await db.query(text, params)
    return rows[0].r as T
  } finally {
    await db.query("reset role")
  }
}

// The error of a call (code, message and detail.field), as the user; null
// when it succeeded.
async function failure(
  db: Db,
  userId: string | null,
  text: string,
  params: unknown[]
) {
  if (userId) await asAuthenticated(db, userId)
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
  } finally {
    if (userId) await db.query("reset role")
  }
}

async function conceptRow(db: Db, id: string): Promise<Row | undefined> {
  const { rows } = await db.query(
    "select * from public.concepts where id = $1",
    [id]
  )
  return rows[0]
}

async function auditOf(db: Db, conceptId: string) {
  const { rows } = await db.query(
    `select action, before, after from public.audit_log
     where entity_type = 'concepts' and entity_id = $1
     order by created_at, id`,
    [conceptId]
  )
  return rows
}

async function newConcept(
  db: Db,
  f: Fixture,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const result = await as<{ concept_id: string }>(db, f.admin, CREATE, [
    { name: testName("concept"), default_kind: "regular", ...extra },
    randomUUID(),
  ])
  return result.concept_id
}

// A session of the concept, as the owner (any status).
async function insertEvent(
  db: Db,
  conceptId: string,
  kind: string,
  status = "published",
  days = 10
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, $2, now() + make_interval(days => $3),
       now() + make_interval(days => $3, hours => 2), 10,
       now() + make_interval(days => $3) - interval '1 day', $4)
     returning id`,
    [conceptId, kind, days, status]
  )
  return rows[0].id as string
}

// A published image (begin, a public file row, finish).
async function publishedMedia(db: Db, admin: string): Promise<string> {
  const created = await as<{ media_id: string }>(db, admin, CREATE_MEDIA, [
    randomUUID(),
  ])
  const id = created.media_id
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-drafts', $1)",
    [id]
  )
  await as(db, admin, BEGIN, [id, testName("alt"), 50, 50])
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-public', $1)",
    [`${id}.jpg`]
  )
  await as(db, admin, FINISH, [id])
  return id
}

async function mediaState(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select publish_state from public.media_assets where id = $1",
    [id]
  )
  return rows[0].publish_state as string
}

const WHEN = { date: "2026-12-15", start_time: "10:00", end_time: "12:00" }

describe("create", () => {
  it("makes a generic olive concept, last in the order, with an audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const name = testName("חגים")
      const id = await newConcept(db, f, {
        name: `  ${name}  `,
        default_kind: "couple",
        description: "  טקסט  ",
      })
      const row = await conceptRow(db, id)
      expect(row).toMatchObject({
        name,
        description: "טקסט",
        default_kind: "couple",
        theme_key: "generic",
        generic_paper_key: "olive",
        archived_at: null,
      })
      const { rows } = await db.query(
        "select max(sort_order)::int as m from public.concepts"
      )
      expect(row?.sort_order).toBe(rows[0].m)
      const audit = await auditOf(db, id)
      expect(audit.map((a) => a.action)).toEqual(["admin_create_concept"])
      expect(audit[0].after).toMatchObject({ name })
    })
  })

  it("refuses a name that exists (trimmed, any case, archived too)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const name = testName("Holidays")
      const archived = await newConcept(db, f, { name })
      await as(db, f.admin, ARCHIVE, [archived, true])
      const before = await db.query(
        "select count(*)::int as n from public.concepts"
      )
      const error = await failure(db, f.admin, CREATE, [
        { name: ` ${name.toUpperCase()} `, default_kind: "regular" },
        randomUUID(),
      ])
      expect(error?.message).toBe("CONCEPT_NAME_TAKEN")
      const after = await db.query(
        "select count(*)::int as n from public.concepts"
      )
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it.each([
    [{ name: "", default_kind: "regular" }, "name"],
    [{ name: "   ", default_kind: "regular" }, "name"],
    [{ name: "x".repeat(101), default_kind: "regular" }, "name"],
    [{ default_kind: "regular" }, "name"],
    [
      { name: "n", default_kind: "regular", description: "x".repeat(2001) },
      "description",
    ],
    [{ name: "n", default_kind: "x" }, "default_kind"],
    [{ name: "n" }, "default_kind"],
    [{ name: "n", default_kind: "regular", theme_key: "greek" }, "theme_key"],
  ])("refuses bad input %j (field %s)", async (input, field) => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const error = await failure(db, f.admin, CREATE, [input, randomUUID()])
      expect(error).toMatchObject({ message: "INVALID_INPUT", field })
    })
  })

  it("a repeated key returns the stored result; another payload is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const input = { name: testName("repeat"), default_kind: "regular" }
      const first = await as<Row>(db, f.admin, CREATE, [input, key])
      const second = await as<Row>(db, f.admin, CREATE, [input, key])
      expect(second).toEqual(first)
      const { rows } = await db.query(
        "select count(*)::int as n from public.concepts where name = $1",
        [input.name]
      )
      expect(rows[0].n).toBe(1)
      const error = await failure(db, f.admin, CREATE, [
        { ...input, name: testName("other") },
        key,
      ])
      expect(error?.message).toBe("IDEMPOTENCY_KEY_REUSED")
    })
  })
})

describe("update", () => {
  it("changes the kind of a concept with sessions; the sessions keep theirs, the next one takes the new kind and description", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f, { default_kind: "couple" })
      const events = [
        await insertEvent(db, id, "couple"),
        await insertEvent(db, id, "couple", "draft"),
        await insertEvent(db, id, "couple", "completed", -10),
      ]
      await as(db, f.admin, UPDATE, [
        id,
        { default_kind: "regular", description: "חדש" },
        randomUUID(),
      ])
      expect(await conceptRow(db, id)).toMatchObject({
        default_kind: "regular",
        description: "חדש",
      })
      const { rows } = await db.query(
        "select kind from public.events where id = any($1)",
        [events]
      )
      expect(rows.map((r) => r.kind)).toEqual(["couple", "couple", "couple"])

      const created = await as<{ event_id: string }>(
        db,
        f.admin,
        CREATE_EVENT,
        [{ concept_id: id, ...WHEN }, randomUUID()]
      )
      const { rows: next } = await db.query(
        "select kind, description from public.events where id = $1",
        [created.event_id]
      )
      expect(next[0]).toEqual({ kind: "regular", description: "חדש" })

      const audit = await auditOf(db, id)
      expect(
        audit.find((a) => a.action === "admin_update_concept")
      ).toMatchObject({
        before: { default_kind: "couple" },
        after: { default_kind: "regular", description: "חדש" },
      })
    })
  })

  it("renames, clears the description, and refuses a taken name or bad input", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const other = testName("other")
      await newConcept(db, f, { name: other })
      const id = await newConcept(db, f, { description: "d" })
      const name = testName("renamed")
      await as(db, f.admin, UPDATE, [
        id,
        { name, description: "" },
        randomUUID(),
      ])
      expect(await conceptRow(db, id)).toMatchObject({
        name,
        description: null,
      })
      // Its own name (another case) is not "taken".
      await as(db, f.admin, UPDATE, [
        id,
        { name: name.toUpperCase() },
        randomUUID(),
      ])

      expect(
        (
          await failure(db, f.admin, UPDATE, [
            id,
            { name: other },
            randomUUID(),
          ])
        )?.message
      ).toBe("CONCEPT_NAME_TAKEN")
      expect(
        await failure(db, f.admin, UPDATE, [
          id,
          { sort_order: 1 },
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", field: "sort_order" })
      expect(
        await failure(db, f.admin, UPDATE, [
          id,
          { description: "x".repeat(2001) },
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", field: "description" })
      expect(
        (await failure(db, f.admin, UPDATE, [id, {}, randomUUID()]))?.message
      ).toBe("INVALID_INPUT")
    })
  })

  it("the same values write no audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const row = await conceptRow(db, id)
      await as(db, f.admin, UPDATE, [
        id,
        { name: row?.name, default_kind: "regular" },
        randomUUID(),
      ])
      expect((await auditOf(db, id)).map((a) => a.action)).toEqual([
        "admin_create_concept",
      ])
    })
  })
})

describe("archive and restore", () => {
  it("archives and restores; an archived concept is refused by admin_create_event, an old session still shows it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const media = await publishedMedia(db, f.admin)
      await as(db, f.admin, SET_IMAGE, [id, media])
      const past = await insertEvent(db, id, "regular", "completed", -5)

      const archived = await as<Row>(db, f.admin, ARCHIVE, [id, true])
      expect(archived.archived_at).not.toBeNull()
      expect((await conceptRow(db, id))?.archived_at).not.toBeNull()
      // Again: nothing changes.
      await as(db, f.admin, ARCHIVE, [id, true])

      expect(
        await failure(db, f.admin, CREATE_EVENT, [
          { concept_id: id, ...WHEN },
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT", field: "concept_id" })

      // The customer still sees the concept's name and image on the session.
      await asAuthenticated(db, f.customer)
      const { rows } = await db.query(
        `select c.name, c.default_image_id from public.events e
         join public.concepts c on c.id = e.concept_id where e.id = $1`,
        [past]
      )
      await db.query("reset role")
      expect(rows[0]).toMatchObject({ default_image_id: media })
      expect(await mediaState(db, media)).toBe("published")

      const restored = await as<Row>(db, f.admin, ARCHIVE, [id, false])
      expect(restored.archived_at).toBeNull()
      expect(
        (await auditOf(db, id))
          .filter((a) => a.action === "admin_set_concept_archived")
          .map((a) => a.after.archived_at === null)
          .sort()
      ).toEqual([false, true])
    })
  })
})

describe("delete", () => {
  it("deletes an unused concept; its image becomes hidden and its public path is returned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const media = await publishedMedia(db, f.admin)
      await as(db, f.admin, SET_IMAGE, [id, media])
      const key = randomUUID()
      const result = await as<{ concept_id: string; hidden_paths: string[] }>(
        db,
        f.admin,
        DELETE,
        [id, key]
      )
      expect(result.concept_id).toBe(id)
      expect(result.hidden_paths).toContain(`${media}.jpg`)
      expect(await conceptRow(db, id)).toBeUndefined()
      expect(await mediaState(db, media)).toBe("hidden")
      const deleted = (await auditOf(db, id)).find(
        (a) => a.action === "admin_delete_concept"
      )
      expect(deleted).toMatchObject({ after: {}, before: { id } })
      // The same key replays the result.
      expect(await as(db, f.admin, DELETE, [id, key])).toEqual(result)
    })
  })

  it.each(["draft", "published", "cancelled", "completed"])(
    "refuses a concept with a %s session: nothing changes",
    async (status) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const id = await newConcept(db, f)
        await insertEvent(
          db,
          id,
          "regular",
          status,
          status === "completed" ? -5 : 10
        )
        const error = await failure(db, f.admin, DELETE, [id, randomUUID()])
        expect(error?.message).toBe("CONCEPT_IN_USE")
        expect(await conceptRow(db, id)).toBeDefined()
      })
    }
  )
})

describe("concept image", () => {
  it("sets a published image, shows it for a session without its own, replaces and clears it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const event = await insertEvent(db, id, "regular")
      const first = await publishedMedia(db, f.admin)
      const set = await as<Row>(db, f.admin, SET_IMAGE, [id, first])
      expect(set).toMatchObject({ concept_id: id, image_id: first })

      // Anon reads the session's concept image (published).
      await db.query(
        "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
      )
      await db.query("set local role anon")
      const { rows } = await db.query(
        `select m.public_path from public.events e
         join public.concepts c on c.id = e.concept_id
         join public.media_assets m on m.id = c.default_image_id
         where e.id = $1 and e.image_id is null`,
        [event]
      )
      await db.query("reset role")
      expect(rows[0]?.public_path).toBe(`${first}.jpg`)

      const second = await publishedMedia(db, f.admin)
      const replaced = await as<{ hidden_paths: string[] }>(
        db,
        f.admin,
        SET_IMAGE,
        [id, second]
      )
      expect(replaced.hidden_paths).toContain(`${first}.jpg`)
      expect(await mediaState(db, first)).toBe("hidden")

      await as(db, f.admin, SET_IMAGE, [id, null])
      expect((await conceptRow(db, id))?.default_image_id).toBeNull()
      expect(await mediaState(db, second)).toBe("hidden")
      expect(
        (await auditOf(db, id)).filter(
          (a) => a.action === "admin_set_concept_image"
        )
      ).toHaveLength(3)
    })
  })

  it("refuses an image that is not published", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const draft = await as<{ media_id: string }>(db, f.admin, CREATE_MEDIA, [
        randomUUID(),
      ])
      const error = await failure(db, f.admin, SET_IMAGE, [id, draft.media_id])
      expect(error?.message).toBe("MEDIA_NOT_PUBLISHED")
      expect((await conceptRow(db, id))?.default_image_id).toBeNull()
    })
  })
})

describe("missing concept and permissions", () => {
  it("an unknown id is NOT_FOUND on every RPC", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const missing = randomUUID()
      for (const [text, params] of [
        [UPDATE, [missing, { name: "x" }, randomUUID()]],
        [ARCHIVE, [missing, true]],
        [DELETE, [missing, randomUUID()]],
        [SET_IMAGE, [missing, null]],
      ] as const) {
        expect((await failure(db, f.admin, text, [...params]))?.message).toBe(
          "NOT_FOUND"
        )
      }
    })
  })

  it("a customer is NOT_AUTHORIZED and anon has no grant; nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await newConcept(db, f)
      const calls = [
        [
          CREATE,
          [{ name: testName("x"), default_kind: "regular" }, randomUUID()],
        ],
        [UPDATE, [id, { name: testName("y") }, randomUUID()]],
        [ARCHIVE, [id, true]],
        [DELETE, [id, randomUUID()]],
        [SET_IMAGE, [id, null]],
      ] as const
      for (const [text, params] of calls) {
        expect(
          (await failure(db, f.customer, text, [...params]))?.message
        ).toBe("NOT_AUTHORIZED")
      }
      await db.query(
        "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
      )
      await db.query("set local role anon")
      for (const [text, params] of calls) {
        const error = await failure(db, null, text, [...params])
        expect(error?.code).toBe("42501")
      }
      await db.query("reset role")
      expect(await conceptRow(db, id)).toMatchObject({ archived_at: null })
    })
  })
})
