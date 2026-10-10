// Story 4.11: the notes tab (CAP-39). Topics and notes, admin only. One test
// per row of the spec's I/O matrix, plus the cascade of a topic delete, the
// pinned/unpinned order, the move between topics and the audit's masked
// body. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const ADD_TOPIC = "select public.admin_add_note_topic($1, $2) as r"
const RENAME_TOPIC = "select public.admin_rename_note_topic($1, $2, $3) as r"
const PREVIEW_DELETE_TOPIC =
  "select public.preview_admin_delete_note_topic($1) as r"
const DELETE_TOPIC = "select public.admin_delete_note_topic($1, $2, $3) as r"
const TOPIC_ORDER = "select public.admin_set_note_topic_order($1::uuid[]) as r"
const ADD_NOTE = "select public.admin_add_note($1, $2, $3) as r"
const UPDATE_NOTE = "select public.admin_update_note($1, $2, $3, $4) as r"
const DELETE_NOTE = "select public.admin_delete_note($1, $2) as r"
const PINNED = "select public.admin_set_note_pinned($1, $2) as r"
const DONE = "select public.admin_set_note_done($1, $2) as r"
const ARCHIVED = "select public.admin_set_note_archived($1, $2) as r"
const NOTE_ORDER = "select public.admin_set_note_order($1, $2::uuid[]) as r"

type Fixture = { admin: string; customer: string }

type NoteRow = {
  id: string
  topic_id: string
  body: string
  pinned: boolean
  done: boolean
  archived_at: Date | null
  sort_order: number
}

// As the owner: an admin and an activated customer.
async function seed(db: Db): Promise<Fixture> {
  const admin = randomUUID()
  const customer = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName("notes_customer")]
  )
  return { admin, customer }
}

async function actAs<T>(db: Db, userId: string, fn: () => Promise<T>) {
  await asAuthenticated(db, userId)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function call(db: Db, f: Fixture, text: string, params: unknown[]) {
  return actAs(
    db,
    f.admin,
    async () => (await db.query(text, params)).rows[0].r
  )
}

async function fails(db: Db, f: Fixture, text: string, params: unknown[]) {
  return actAs(
    db,
    f.admin,
    async () => (await queryError(db, text, params))?.message
  )
}

async function topic(db: Db, f: Fixture, name: string): Promise<string> {
  return (await call(db, f, ADD_TOPIC, [name, randomUUID()])).topic_id
}

async function note(
  db: Db,
  f: Fixture,
  topicId: string,
  body: string
): Promise<string> {
  return (await call(db, f, ADD_NOTE, [topicId, body, randomUUID()])).note_id
}

// A topic's notes in display order (pinned first, then sort_order), as the
// owner.
async function notesOf(db: Db, topicId: string): Promise<NoteRow[]> {
  const { rows } = await db.query<NoteRow>(
    `select id, topic_id, body, pinned, done, archived_at, sort_order
     from public.notes where topic_id = $1
     order by pinned desc, sort_order, id`,
    [topicId]
  )
  return rows
}

async function auditCount(db: Db, entityId: string, action: string) {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.audit_log where entity_id = $1 and action = $2",
    [entityId, action]
  )
  return rows[0].n
}

describe("notes (story 4.11)", { timeout: 30_000 }, () => {
  it("adds a note with a trimmed body at the top of the unpinned notes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "  ספקים  ")
      const { rows } = await db.query(
        "select name from public.note_topics where id = $1",
        [t]
      )
      expect(rows[0].name).toBe("ספקים")

      const pinned = await note(db, f, t, "נעוץ")
      await call(db, f, PINNED, [pinned, true])
      const first = await note(db, f, t, "ראשון")
      const second = await note(db, f, t, "  ספק פרחים  ")
      const list = await notesOf(db, t)
      expect(list.map((n) => n.id)).toEqual([pinned, second, first])
      expect(list[1]).toMatchObject({
        body: "ספק פרחים",
        pinned: false,
        done: false,
        archived_at: null,
      })
    })
  })

  it("refuses an empty or too long body or name with detail.field", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "רעיונות")
      for (const body of [
        "   ",
        `${String.fromCharCode(0xa0)}\t\n`,
        "א".repeat(2001),
      ]) {
        const error = await actAs(db, f.admin, () =>
          queryError(db, ADD_NOTE, [t, body, randomUUID()])
        )
        expect(error?.message).toBe("INVALID_INPUT")
      }
      // detail.field through PostgREST is the error's detail.
      await asAuthenticated(db, f.admin)
      await db.query("savepoint s")
      let detail: string | undefined
      try {
        await db.query(ADD_NOTE, [t, "   ", randomUUID()])
      } catch (error) {
        detail = (error as { detail?: string }).detail
      }
      await db.query("rollback to savepoint s")
      await db.query("reset role")
      expect(JSON.parse(detail ?? "{}")).toEqual({ field: "body" })

      expect(
        await fails(db, f, ADD_TOPIC, ["א".repeat(61), randomUUID()])
      ).toBe("INVALID_INPUT")
      expect(await notesOf(db, t)).toHaveLength(0)
      // 2000 characters (after trimming) fit.
      await note(db, f, t, ` ${"א".repeat(2000)} `)
      expect(await notesOf(db, t)).toHaveLength(1)
    })
  })

  it("a replay returns the same result with one row and one audit; another body with the key is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const key = randomUUID()
      const first = await call(db, f, ADD_NOTE, [t, "קייטרינג", key])
      expect(await call(db, f, ADD_NOTE, [t, "קייטרינג", key])).toEqual(first)
      expect(await notesOf(db, t)).toHaveLength(1)
      expect(await auditCount(db, first.note_id, "admin_add_note")).toBe(1)
      expect(await fails(db, f, ADD_NOTE, [t, "אחר", key])).toBe(
        "IDEMPOTENCY_KEY_REUSED"
      )
    })
  })

  it("archive and restore keep pinned, done and sort_order", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const a = await note(db, f, t, "a")
      const b = await note(db, f, t, "b")
      await call(db, f, PINNED, [a, true])
      await call(db, f, DONE, [a, true])
      const before = (await notesOf(db, t)).find((n) => n.id === a)

      expect(await call(db, f, ARCHIVED, [a, true])).toEqual({
        note_id: a,
        archived: true,
      })
      const archived = (await notesOf(db, t)).find((n) => n.id === a)
      expect(archived?.archived_at).not.toBeNull()

      await call(db, f, ARCHIVED, [a, false])
      const restored = await notesOf(db, t)
      expect(restored.map((n) => n.id)).toEqual([a, b])
      expect(restored[0]).toMatchObject({
        pinned: true,
        done: true,
        archived_at: null,
        sort_order: before?.sort_order,
      })
    })
  })

  it("deletes a note for good; a replay returns the stored result; another id is NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const a = await note(db, f, t, "a")
      const key = randomUUID()
      expect(await call(db, f, DELETE_NOTE, [a, key])).toEqual({ note_id: a })
      expect(await notesOf(db, t)).toHaveLength(0)
      expect(await call(db, f, DELETE_NOTE, [a, key])).toEqual({ note_id: a })
      expect(await fails(db, f, DELETE_NOTE, [a, randomUUID()])).toBe(
        "NOT_FOUND"
      )
      expect(await fails(db, f, ARCHIVED, [a, false])).toBe("NOT_FOUND")
    })
  })

  it("a topic with notes needs p_confirmed; the preview counts archived notes; a confirmed delete cascades", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "מתעניינות")
      await note(db, f, t, "1")
      await note(db, f, t, "2")
      const archived = await note(db, f, t, "3")
      await call(db, f, ARCHIVED, [archived, true])

      expect(await call(db, f, PREVIEW_DELETE_TOPIC, [t])).toEqual({
        topic_id: t,
        name: "מתעניינות",
        note_count: 3,
      })
      expect(await fails(db, f, DELETE_TOPIC, [t, false, randomUUID()])).toBe(
        "CONFIRM_REQUIRED"
      )
      expect(await fails(db, f, DELETE_TOPIC, [t, null, randomUUID()])).toBe(
        "CONFIRM_REQUIRED"
      )
      expect(await notesOf(db, t)).toHaveLength(3)

      expect(await call(db, f, DELETE_TOPIC, [t, true, randomUUID()])).toEqual({
        topic_id: t,
        note_count: 3,
      })
      expect(await notesOf(db, t)).toHaveLength(0)
      const { rows } = await db.query(
        `select before, after from public.audit_log
         where entity_id = $1 and action = 'admin_delete_note_topic'`,
        [t]
      )
      expect(rows[0].before).toMatchObject({
        name: "מתעניינות",
        note_count: 3,
      })
      expect(rows[0].after).toEqual({})
      expect(await fails(db, f, PREVIEW_DELETE_TOPIC, [t])).toBe("NOT_FOUND")
    })
  })

  it("an empty topic is deleted without p_confirmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ריק")
      expect(await call(db, f, DELETE_TOPIC, [t, false, randomUUID()])).toEqual(
        {
          topic_id: t,
          note_count: 0,
        }
      )
      const { rows } = await db.query(
        "select count(*)::int as n from public.note_topics where id = $1",
        [t]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("moves a note to the top of the target's unpinned notes, keeping its state; a missing topic is NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const from = await topic(db, f, "רעיונות")
      const to = await topic(db, f, "ספקים")
      const pinnedThere = await note(db, f, to, "נעוץ שם")
      await call(db, f, PINNED, [pinnedThere, true])
      const there = await note(db, f, to, "שם")
      const moving = await note(db, f, from, "עובר")
      await call(db, f, DONE, [moving, true])

      expect(
        await call(db, f, UPDATE_NOTE, [moving, to, "עובר", randomUUID()])
      ).toEqual({ note_id: moving, topic_id: to })
      expect(await notesOf(db, from)).toHaveLength(0)
      const target = await notesOf(db, to)
      expect(target.map((n) => n.id)).toEqual([pinnedThere, moving, there])
      expect(target[1]).toMatchObject({ done: true, pinned: false })

      const { rows } = await db.query(
        `select before, after from public.audit_log
         where entity_id = $1 and action = 'admin_update_note'`,
        [moving]
      )
      expect(rows[0].before.topic_id).toBe(from)
      expect(rows[0].after.topic_id).toBe(to)

      expect(
        await fails(db, f, UPDATE_NOTE, [
          moving,
          randomUUID(),
          "עובר",
          randomUUID(),
        ])
      ).toBe("NOT_FOUND")
      expect((await notesOf(db, to)).map((n) => n.id)).toContain(moving)
    })
  })

  it("orders notes and topics only with the full list, else CONCURRENT_CHANGE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const other = await topic(db, f, "אחר")
      const a = await note(db, f, t, "a")
      const b = await note(db, f, t, "b")
      const c = await note(db, f, t, "c")
      await call(db, f, ARCHIVED, [c, true])
      const foreign = await note(db, f, other, "x")
      // Display order now: c, b, a (each new note on top).
      expect((await notesOf(db, t)).map((n) => n.id)).toEqual([c, b, a])

      for (const ids of [
        [c, b],
        [c, b, foreign],
        [c, b, a, foreign],
        [c, b, b],
      ]) {
        expect(await fails(db, f, NOTE_ORDER, [t, ids])).toBe(
          "CONCURRENT_CHANGE"
        )
      }
      expect((await notesOf(db, t)).map((n) => n.id)).toEqual([c, b, a])

      expect(await call(db, f, NOTE_ORDER, [t, [a, c, b]])).toEqual({
        note_ids: [a, c, b],
      })
      expect((await notesOf(db, t)).map((n) => n.id)).toEqual([a, c, b])
      // A pinned note is shown first whatever its sort_order.
      await call(db, f, PINNED, [b, true])
      expect((await notesOf(db, t)).map((n) => n.id)).toEqual([b, a, c])

      // Topics: the full list of every topic.
      const { rows } = await db.query<{ id: string }>(
        "select id from public.note_topics order by sort_order, id"
      )
      const all = rows.map((r) => r.id)
      expect(
        await fails(db, f, TOPIC_ORDER, [all.filter((id) => id !== t)])
      ).toBe("CONCURRENT_CHANGE")
      const reversed = [...all].reverse()
      expect(await call(db, f, TOPIC_ORDER, [reversed])).toEqual({
        topic_ids: reversed,
      })
      const after = await db.query<{ id: string }>(
        "select id from public.note_topics order by sort_order, id"
      )
      expect(after.rows.map((r) => r.id)).toEqual(reversed)
    })
  })

  it("a call that changes nothing writes no update and no audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const a = await note(db, f, t, "a")
      await call(db, f, DONE, [a, true])
      const before = (await notesOf(db, t))[0]
      const updatedAt = (
        await db.query("select updated_at from public.notes where id = $1", [a])
      ).rows[0].updated_at

      expect(await call(db, f, DONE, [a, true])).toEqual({
        note_id: a,
        done: true,
      })
      await call(db, f, PINNED, [a, false])
      await call(db, f, ARCHIVED, [a, false])
      await call(db, f, UPDATE_NOTE, [a, t, " a ", randomUUID()])
      await call(db, f, RENAME_TOPIC, [t, "ספקים", randomUUID()])
      await call(db, f, NOTE_ORDER, [t, [a]])

      expect(await auditCount(db, a, "admin_set_note_done")).toBe(1)
      for (const action of [
        "admin_set_note_pinned",
        "admin_set_note_archived",
        "admin_update_note",
      ]) {
        expect(await auditCount(db, a, action)).toBe(0)
      }
      expect(await auditCount(db, t, "admin_rename_note_topic")).toBe(0)
      expect(await auditCount(db, t, "admin_set_note_order")).toBe(0)
      expect((await notesOf(db, t))[0]).toEqual(before)
      expect(
        (
          await db.query("select updated_at from public.notes where id = $1", [
            a,
          ])
        ).rows[0].updated_at
      ).toEqual(updatedAt)
    })
  })

  it("an edit in place keeps the note's sort_order and position", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const a = await note(db, f, t, "a")
      const b = await note(db, f, t, "b")
      const c = await note(db, f, t, "c")
      const before = await notesOf(db, t)
      expect(before.map((n) => n.id)).toEqual([c, b, a])

      await call(db, f, UPDATE_NOTE, [b, t, "b2", randomUUID()])
      const after = await notesOf(db, t)
      expect(after.map((n) => n.id)).toEqual([c, b, a])
      expect(after[1]).toMatchObject({
        body: "b2",
        sort_order: before[1].sort_order,
      })
    })
  })

  it("moving a pinned, archived note keeps it pinned and archived in the target", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const from = await topic(db, f, "רעיונות")
      const to = await topic(db, f, "ספקים")
      await note(db, f, to, "שם")
      const moving = await note(db, f, from, "עובר")
      await call(db, f, PINNED, [moving, true])
      await call(db, f, ARCHIVED, [moving, true])

      await call(db, f, UPDATE_NOTE, [moving, to, "עובר", randomUUID()])
      const moved = (await notesOf(db, to)).find((n) => n.id === moving)
      expect(moved?.pinned).toBe(true)
      expect(moved?.archived_at).not.toBeNull()
    })
  })

  it("the current topic order writes no update and no audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await topic(db, f, "א")
      await topic(db, f, "ב")
      const { rows } = await db.query<{ id: string; sort_order: number }>(
        "select id, sort_order from public.note_topics order by sort_order, id"
      )
      const ids = rows.map((r) => r.id)
      expect(await call(db, f, TOPIC_ORDER, [ids])).toEqual({ topic_ids: ids })
      const after = await db.query<{ id: string; sort_order: number }>(
        "select id, sort_order from public.note_topics order by sort_order, id"
      )
      expect(after.rows).toEqual(rows)
      const audit = await db.query<{ n: number }>(
        "select count(*)::int as n from public.audit_log where actor_id = $1 and action = 'admin_set_note_topic_order'",
        [f.admin]
      )
      expect(audit.rows[0].n).toBe(0)
    })
  })

  it("an unknown topic is NOT_FOUND for add and rename", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await fails(db, f, ADD_NOTE, [randomUUID(), "x", randomUUID()])
      ).toBe("NOT_FOUND")
      expect(
        await fails(db, f, RENAME_TOPIC, [randomUUID(), "x", randomUUID()])
      ).toBe("NOT_FOUND")
    })
  })

  it("rename: a blank name is INVALID_INPUT with field name; a padded name is stored trimmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      await asAuthenticated(db, f.admin)
      await db.query("savepoint s")
      let error: { message?: string; detail?: string } = {}
      try {
        await db.query(RENAME_TOPIC, [t, "   ", randomUUID()])
      } catch (e) {
        error = e as { message?: string; detail?: string }
      }
      await db.query("rollback to savepoint s")
      await db.query("reset role")
      expect(error.message).toBe("INVALID_INPUT")
      expect(JSON.parse(error.detail ?? "{}")).toEqual({ field: "name" })

      await call(db, f, RENAME_TOPIC, [t, "  ספקים חדשים  ", randomUUID()])
      const { rows } = await db.query(
        "select name from public.note_topics where id = $1",
        [t]
      )
      expect(rows[0].name).toBe("ספקים חדשים")
    })
  })

  it("the audit masks a note's body, not a topic's name", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "מתעניינות")
      const a = await note(db, f, t, "דנה 050-0000000")
      await call(db, f, UPDATE_NOTE, [a, t, "דנה, התקשרה", randomUUID()])
      await call(db, f, DELETE_NOTE, [a, randomUUID()])
      const { rows } = await db.query(
        `select action, before, after from public.audit_log
         where entity_id = $1 order by action`,
        [a]
      )
      expect(rows.map((r) => r.action)).toEqual([
        "admin_add_note",
        "admin_delete_note",
        "admin_update_note",
      ])
      const [add, del, update] = rows
      expect(add.after.body).toBe("<changed>")
      expect(del.before.body).toBe("<changed>")
      expect(update.before.body).toBe("<changed>")
      expect(update.after.body).toBe("<changed>")
      const topicAudit = await db.query(
        `select after from public.audit_log
         where entity_id = $1 and action = 'admin_add_note_topic'`,
        [t]
      )
      expect(topicAudit.rows[0].after.name).toBe("מתעניינות")
    })
  })

  it("a customer reads 0 rows and every RPC is NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const t = await topic(db, f, "ספקים")
      const a = await note(db, f, t, "a")
      await actAs(db, f.customer, async () => {
        for (const table of ["note_topics", "notes"]) {
          const { rows } = await db.query(
            `select count(*)::int as n from public.${table}`
          )
          expect(rows[0].n).toBe(0)
        }
        const calls: [string, unknown[]][] = [
          [ADD_TOPIC, ["x", randomUUID()]],
          [RENAME_TOPIC, [t, "x", randomUUID()]],
          [PREVIEW_DELETE_TOPIC, [t]],
          [DELETE_TOPIC, [t, true, randomUUID()]],
          [TOPIC_ORDER, [[t]]],
          [ADD_NOTE, [t, "x", randomUUID()]],
          [UPDATE_NOTE, [a, t, "x", randomUUID()]],
          [DELETE_NOTE, [a, randomUUID()]],
          [PINNED, [a, true]],
          [DONE, [a, true]],
          [ARCHIVED, [a, true]],
          [NOTE_ORDER, [t, [a]]],
        ]
        for (const [text, params] of calls) {
          expect((await queryError(db, text, params))?.message).toBe(
            "NOT_AUTHORIZED"
          )
        }
        // No write grant on the tables.
        expect(
          (
            await queryError(
              db,
              "insert into public.notes (topic_id, body, sort_order) values ($1, 'x', 0)",
              [t]
            )
          )?.code
        ).toBe("42501")
      })
      expect(await notesOf(db, t)).toHaveLength(1)
    })
  })
})
