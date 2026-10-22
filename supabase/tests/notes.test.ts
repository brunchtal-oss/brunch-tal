// The notes tab (story 4.11, fix 13: one board, no topics). Admin only. One
// test per row of the spec's I/O matrix, plus the board order (pinned
// first), the migration's shape and order, the board lock and the audit's
// masked body. Everything runs in inRollback. The board is shared with the
// dev data, so each test checks only the notes it made, except the full-list
// order, which reads the whole board.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const ADD_NOTE = "select public.admin_add_note($1, $2) as r"
const UPDATE_NOTE = "select public.admin_update_note($1, $2, $3) as r"
const DELETE_NOTE = "select public.admin_delete_note($1, $2) as r"
const PINNED = "select public.admin_set_note_pinned($1, $2) as r"
const DONE = "select public.admin_set_note_done($1, $2) as r"
const ARCHIVED = "select public.admin_set_note_archived($1, $2) as r"
const NOTE_ORDER = "select public.admin_set_note_order($1::uuid[]) as r"

type Fixture = { admin: string; customer: string }

type NoteRow = {
  id: string
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

async function note(db: Db, f: Fixture, body: string): Promise<string> {
  return (await call(db, f, ADD_NOTE, [body, randomUUID()])).note_id
}

// The given notes in board order (pinned first, then sort_order), as the
// owner.
async function notesIn(db: Db, ids: string[]): Promise<NoteRow[]> {
  const { rows } = await db.query<NoteRow>(
    `select id, body, pinned, done, archived_at, sort_order
     from public.notes where id = any($1::uuid[])
     order by pinned desc, sort_order, id`,
    [ids]
  )
  return rows
}

// Every note on the board (archived included) in board order.
async function boardIds(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.notes order by pinned desc, sort_order, id"
  )
  return rows.map((r) => r.id)
}

async function auditCount(db: Db, entityId: string, action: string) {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.audit_log where entity_id = $1 and action = $2",
    [entityId, action]
  )
  return rows[0].n
}

describe("notes board (story 4.11, fix 13)", { timeout: 30_000 }, () => {
  it("after the migration there is one board: no topic_id, no note_topics, no topic RPCs", async () => {
    await inRollback(async (db) => {
      const column = await db.query(
        `select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'notes' and column_name = 'topic_id'`
      )
      expect(column.rows).toHaveLength(0)
      const table = await db.query(
        "select to_regclass('public.note_topics') as t"
      )
      expect(table.rows[0].t).toBeNull()
      const functions = await db.query<{ sig: string }>(
        `select p.oid::regprocedure::text as sig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private')
           and (p.proname like '%note_topic%' or p.proname = 'lock_topic_of_note'
                or p.proname = 'note_top_order'
                or p.proname in ('admin_add_note', 'admin_update_note', 'admin_set_note_order'))
         order by 1`
      )
      expect(functions.rows.map((r) => r.sig)).toEqual([
        "admin_add_note(text,uuid)",
        "admin_set_note_order(uuid[])",
        "admin_update_note(uuid,text,uuid)",
      ])
    })
  })

  it("the migration's renumbering keeps all notes, topic 1's first", async () => {
    await inRollback(async (db) => {
      // The same window as the migration, on temporary copies of the old
      // shape: two topics, the second created first.
      await db.query(
        "create temp table t_topics (id uuid, sort_order int) on commit drop"
      )
      await db.query(
        "create temp table t_notes (id uuid, topic_id uuid, sort_order int) on commit drop"
      )
      const [t1, t2] = [randomUUID(), randomUUID()]
      const [a, b, c, d] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ]
      await db.query("insert into t_topics values ($1, 2), ($2, 1)", [t2, t1])
      await db.query(
        "insert into t_notes values ($1, $5, -1), ($2, $5, 0), ($3, $6, -3), ($4, $6, 5)",
        [a, b, c, d, t1, t2]
      )
      await db.query(
        `update t_notes n set sort_order = o.rn
         from (
           select n2.id,
                  row_number() over (order by t.sort_order, t.id, n2.sort_order, n2.id)::integer as rn
           from t_notes n2 join t_topics t on t.id = n2.topic_id
         ) o
         where n.id = o.id`
      )
      const { rows } = await db.query<{ id: string; sort_order: number }>(
        "select id, sort_order from t_notes order by sort_order"
      )
      expect(rows).toEqual([
        { id: a, sort_order: 1 },
        { id: b, sort_order: 2 },
        { id: c, sort_order: 3 },
        { id: d, sort_order: 4 },
      ])
    })
  })

  it("adds a note with a trimmed body at the top of the unpinned notes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pinned = await note(db, f, "נעוץ")
      await call(db, f, PINNED, [pinned, true])
      const first = await note(db, f, "ראשון")
      const second = await note(db, f, "  ספק פרחים\nטלפון  ")
      const list = await notesIn(db, [pinned, first, second])
      expect(list.map((n) => n.id)).toEqual([pinned, second, first])
      expect(list[1]).toMatchObject({
        body: "ספק פרחים\nטלפון",
        pinned: false,
        done: false,
        archived_at: null,
      })
      // The top of the whole board's unpinned notes.
      const unpinned = await db.query<{ id: string }>(
        "select id from public.notes where not pinned order by sort_order, id limit 1"
      )
      expect(unpinned.rows[0].id).toBe(second)
    })
  })

  it("refuses an empty or too long body with detail.field body", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const before = (await boardIds(db)).length
      for (const body of [
        "   ",
        `${String.fromCharCode(0xa0)}\t\n`,
        "א".repeat(2001),
      ]) {
        expect(await fails(db, f, ADD_NOTE, [body, randomUUID()])).toBe(
          "INVALID_INPUT"
        )
      }
      // detail.field through PostgREST is the error's detail.
      await asAuthenticated(db, f.admin)
      await db.query("savepoint s")
      let detail: string | undefined
      try {
        await db.query(ADD_NOTE, ["   ", randomUUID()])
      } catch (error) {
        detail = (error as { detail?: string }).detail
      }
      await db.query("rollback to savepoint s")
      await db.query("reset role")
      expect(JSON.parse(detail ?? "{}")).toEqual({ field: "body" })
      expect(await boardIds(db)).toHaveLength(before)

      // An edit to a blank body is refused the same way.
      const a = await note(db, f, "a")
      expect(await fails(db, f, UPDATE_NOTE, [a, "  ", randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      // 2000 characters (after trimming) fit.
      await note(db, f, ` ${"א".repeat(2000)} `)
      expect(await boardIds(db)).toHaveLength(before + 2)
    })
  })

  it("a replay returns the same result with one row and one audit; another body with the key is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const before = (await boardIds(db)).length
      const key = randomUUID()
      const first = await call(db, f, ADD_NOTE, ["קייטרינג", key])
      expect(await call(db, f, ADD_NOTE, ["קייטרינג", key])).toEqual(first)
      expect(await boardIds(db)).toHaveLength(before + 1)
      expect(await auditCount(db, first.note_id, "admin_add_note")).toBe(1)
      expect(await fails(db, f, ADD_NOTE, ["אחר", key])).toBe(
        "IDEMPOTENCY_KEY_REUSED"
      )
    })
  })

  it("archive and restore keep pinned, done and sort_order", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      const b = await note(db, f, "b")
      await call(db, f, PINNED, [a, true])
      await call(db, f, DONE, [a, true])
      const before = (await notesIn(db, [a]))[0]

      expect(await call(db, f, ARCHIVED, [a, true])).toEqual({
        note_id: a,
        archived: true,
      })
      expect((await notesIn(db, [a]))[0].archived_at).not.toBeNull()

      await call(db, f, ARCHIVED, [a, false])
      const restored = await notesIn(db, [a, b])
      expect(restored.map((n) => n.id)).toEqual([a, b])
      expect(restored[0]).toMatchObject({
        pinned: true,
        done: true,
        archived_at: null,
        sort_order: before.sort_order,
      })
    })
  })

  it("deletes a note for good; a replay returns the stored result; another id is NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      const key = randomUUID()
      expect(await call(db, f, DELETE_NOTE, [a, key])).toEqual({ note_id: a })
      expect(await notesIn(db, [a])).toHaveLength(0)
      expect(await call(db, f, DELETE_NOTE, [a, key])).toEqual({ note_id: a })
      for (const [text, params] of [
        [DELETE_NOTE, [a, randomUUID()]],
        [ARCHIVED, [a, false]],
        [PINNED, [a, true]],
        [DONE, [a, true]],
        [UPDATE_NOTE, [a, "x", randomUUID()]],
      ] as [string, unknown[]][]) {
        expect(await fails(db, f, text, params)).toBe("NOT_FOUND")
      }
    })
  })

  it("orders the board only with the full list (archived included), else CONCURRENT_CHANGE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      const b = await note(db, f, "b")
      const c = await note(db, f, "c")
      await call(db, f, ARCHIVED, [c, true])
      // The board lock, so no other session's note changes the full list.
      await db.query("select private.lock_notes_board()")
      const board = await boardIds(db)
      // Each new note on top of the unpinned notes: c, b, a.
      expect((await notesIn(db, [a, b, c])).map((n) => n.id)).toEqual([c, b, a])

      const rest = board.filter((id) => ![a, b, c].includes(id))
      for (const ids of [
        board.filter((id) => id !== c),
        [...board, randomUUID()],
        [...board.filter((id) => id !== a), randomUUID()],
        [...board, b],
        // The board's length, with one id twice.
        board.map((id) => (id === a ? b : id)),
      ]) {
        expect(await fails(db, f, NOTE_ORDER, [ids])).toBe("CONCURRENT_CHANGE")
      }
      expect(await boardIds(db)).toEqual(board)

      const next = [a, c, b, ...rest]
      expect(await call(db, f, NOTE_ORDER, [next])).toEqual({ note_ids: next })
      expect((await notesIn(db, [a, b, c])).map((n) => n.id)).toEqual([a, c, b])
      // A pinned note is shown first whatever its sort_order.
      await call(db, f, PINNED, [b, true])
      expect((await notesIn(db, [a, b, c])).map((n) => n.id)).toEqual([b, a, c])

      const { rows } = await db.query(
        `select entity_type, entity_id, before, after from public.audit_log
         where actor_id = $1 and action = 'admin_set_note_order'`,
        [f.admin]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entity_type: "notes", entity_id: null })
      expect(rows[0].after.note_order).toEqual(next)
    })
  })

  it("a call that changes nothing writes no update and no audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      await call(db, f, DONE, [a, true])
      const before = (await notesIn(db, [a]))[0]
      const updatedAt = (
        await db.query("select updated_at from public.notes where id = $1", [a])
      ).rows[0].updated_at

      expect(await call(db, f, DONE, [a, true])).toEqual({
        note_id: a,
        done: true,
      })
      await call(db, f, PINNED, [a, false])
      await call(db, f, ARCHIVED, [a, false])
      expect(await call(db, f, UPDATE_NOTE, [a, " a ", randomUUID()])).toEqual({
        note_id: a,
      })
      await db.query("select private.lock_notes_board()")
      expect(await call(db, f, NOTE_ORDER, [await boardIds(db)])).toBeTruthy()

      expect(await auditCount(db, a, "admin_set_note_done")).toBe(1)
      for (const action of [
        "admin_set_note_pinned",
        "admin_set_note_archived",
        "admin_update_note",
      ]) {
        expect(await auditCount(db, a, action)).toBe(0)
      }
      const order = await db.query<{ n: number }>(
        "select count(*)::int as n from public.audit_log where actor_id = $1 and action = 'admin_set_note_order'",
        [f.admin]
      )
      expect(order.rows[0].n).toBe(0)
      expect((await notesIn(db, [a]))[0]).toEqual(before)
      expect(
        (
          await db.query("select updated_at from public.notes where id = $1", [
            a,
          ])
        ).rows[0].updated_at
      ).toEqual(updatedAt)
    })
  })

  it("an edit keeps the note's sort_order, pinned, done and archived", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      const b = await note(db, f, "b")
      const c = await note(db, f, "c")
      await call(db, f, DONE, [b, true])
      const before = await notesIn(db, [a, b, c])
      expect(before.map((n) => n.id)).toEqual([c, b, a])

      expect(
        await call(db, f, UPDATE_NOTE, [b, "ליגל\nענבר", randomUUID()])
      ).toEqual({ note_id: b })
      const after = await notesIn(db, [a, b, c])
      expect(after.map((n) => n.id)).toEqual([c, b, a])
      expect(after[1]).toMatchObject({
        body: "ליגל\nענבר",
        done: true,
        sort_order: before[1].sort_order,
      })

      await call(db, f, PINNED, [c, true])
      await call(db, f, ARCHIVED, [c, true])
      await call(db, f, UPDATE_NOTE, [c, "c2", randomUUID()])
      expect((await notesIn(db, [c]))[0]).toMatchObject({
        body: "c2",
        pinned: true,
      })
      expect((await notesIn(db, [c]))[0].archived_at).not.toBeNull()
    })
  })

  it("every note write takes the board's advisory lock", async () => {
    const calls: [string, (id: string, board: string[]) => unknown[]][] = [
      [ADD_NOTE, () => ["x", randomUUID()]],
      [UPDATE_NOTE, (id) => [id, "y", randomUUID()]],
      [DELETE_NOTE, (id) => [id, randomUUID()]],
      [PINNED, (id) => [id, true]],
      [DONE, (id) => [id, true]],
      [ARCHIVED, (id) => [id, true]],
      // A real new order (the new note moved last), so it does not return
      // before writing.
      [
        NOTE_ORDER,
        (id, board) => {
          const moved = [...board.filter((x) => x !== id), id]
          return [
            moved.every((x, i) => x === board[i])
              ? [...board].reverse()
              : moved,
          ]
        },
      ],
    ]
    for (const [text, params] of calls) {
      await inRollback(async (db) => {
        const f = await seed(db)
        // As the owner, so no RPC has taken the lock yet.
        const { rows } = await db.query<{ id: string }>(
          "insert into public.notes (body, sort_order) values ('x', 0) returning id"
        )
        const held = async () =>
          (
            await db.query<{ n: number }>(
              `select count(*)::int as n from pg_locks
               where locktype = 'advisory' and pid = pg_backend_pid()
                 and classid::bigint = (hashtext('notes')::bigint >> 32) & 4294967295
                 and objid::bigint = hashtext('notes')::bigint & 4294967295
                 and objsubid = 1`
            )
          ).rows[0].n
        expect(await held()).toBe(0)
        const board = await boardIds(db)
        await call(db, f, text, params(rows[0].id, board))
        expect(await held()).toBe(1)
      })
    }
  })

  it("the audit masks a note's body", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "דנה 050-0000000")
      await call(db, f, UPDATE_NOTE, [a, "דנה, התקשרה", randomUUID()])
      await call(db, f, DELETE_NOTE, [a, randomUUID()])
      const { rows } = await db.query(
        `select action, entity_type, before, after from public.audit_log
         where entity_id = $1 order by action`,
        [a]
      )
      expect(rows.map((r) => r.action)).toEqual([
        "admin_add_note",
        "admin_delete_note",
        "admin_update_note",
      ])
      expect(rows.every((r) => r.entity_type === "notes")).toBe(true)
      const [add, del, update] = rows
      expect(add.after.body).toBe("<changed>")
      expect(del.before.body).toBe("<changed>")
      expect(update.before.body).toBe("<changed>")
      expect(update.after.body).toBe("<changed>")
    })
  })

  it("a customer reads 0 rows and every RPC is NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await note(db, f, "a")
      await actAs(db, f.customer, async () => {
        const { rows } = await db.query(
          "select count(*)::int as n from public.notes"
        )
        expect(rows[0].n).toBe(0)
        const calls: [string, unknown[]][] = [
          [ADD_NOTE, ["x", randomUUID()]],
          [UPDATE_NOTE, [a, "x", randomUUID()]],
          [DELETE_NOTE, [a, randomUUID()]],
          [PINNED, [a, true]],
          [DONE, [a, true]],
          [ARCHIVED, [a, true]],
          [NOTE_ORDER, [[a]]],
        ]
        for (const [text, params] of calls) {
          expect((await queryError(db, text, params))?.message).toBe(
            "NOT_AUTHORIZED"
          )
        }
        // No write grant on the table.
        expect(
          (
            await queryError(
              db,
              "insert into public.notes (body, sort_order) values ('x', 0)",
              []
            )
          )?.code
        ).toBe("42501")
      })
      expect(await notesIn(db, [a])).toHaveLength(1)
    })
  })
})
