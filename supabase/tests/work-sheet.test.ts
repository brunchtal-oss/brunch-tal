// Story 4.9: the work sheet (CAP-38). private.ensure_work_sheet, the read,
// dishes, tasks, ordering and prep days. One test per row of the spec's I/O
// matrix, plus the -6..0 range, the last day, a settings change after the
// sheet exists, the audit log and the customer's access. Everything runs in
// inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const GET = "select public.admin_get_work_sheet($1) as r"
const ADD_DISH = "select public.admin_add_work_dish($1, $2, $3) as r"
const UPDATE_DISH = "select public.admin_update_work_dish($1, $2, $3) as r"
const DELETE_DISH = "select public.admin_delete_work_dish($1, $2) as r"
const DISH_ORDER = "select public.admin_set_work_dish_order($1::uuid[]) as r"
const ADD_TASK = "select public.admin_add_work_task($1, $2, $3, $4) as r"
const UPDATE_TASK = "select public.admin_update_work_task($1, $2, $3, $4) as r"
const DELETE_TASK = "select public.admin_delete_work_task($1, $2) as r"
const TASK_DONE = "select public.admin_set_work_task_done($1, $2) as r"
const TASK_ORDER = "select public.admin_set_work_task_order($1::uuid[]) as r"
const ADD_DAY = "select public.admin_add_prep_day($1, $2, $3) as r"
const REMOVE_DAY = "select public.admin_remove_prep_day($1, $2, $3) as r"

type Fixture = { admin: string; customer: string; concept: string }

type Sheet = {
  event: { id: string; concept_name: string; status: string }
  prep_days: { offset: number; date: string }[]
  addable_days: { offset: number; date: string }[]
  dishes: {
    id: string
    name: string
    tasks: { id: string; day_offset: number; body: string; done: boolean }[]
  }[]
}

// As the owner: an admin, an activated customer, default prep days {-1,0}.
async function seed(db: Db): Promise<Fixture> {
  const admin = randomUUID()
  const customer = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName("work_customer")]
  )
  await db.query(
    "update public.business_settings set default_prep_days = '{-1,0}'"
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null order by id limit 1"
  )
  return { admin, customer, concept: rows[0].id }
}

// Runs as the admin, then returns to the owner role.
async function asAdmin<T>(db: Db, f: Fixture, fn: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function call(db: Db, f: Fixture, text: string, params: unknown[]) {
  return asAdmin(db, f, async () => (await db.query(text, params)).rows[0].r)
}

async function fails(db: Db, f: Fixture, text: string, params: unknown[]) {
  return asAdmin(
    db,
    f,
    async () => (await queryError(db, text, params))?.message
  )
}

// A session on a local date at 10:00, created by the admin.
async function session(db: Db, f: Fixture, date: string): Promise<string> {
  const result = await call(
    db,
    f,
    "select public.admin_create_event($1::jsonb, $2) as r",
    [
      {
        concept_id: f.concept,
        date,
        start_time: "10:00",
        end_time: "12:00",
      },
      randomUUID(),
    ]
  )
  return result.event_id
}

async function sheet(db: Db, f: Fixture, eventId: string): Promise<Sheet> {
  return call(db, f, GET, [eventId])
}

async function dish(db: Db, f: Fixture, eventId: string, name: string) {
  return (await call(db, f, ADD_DISH, [eventId, name, randomUUID()])).dish_id
}

async function task(
  db: Db,
  f: Fixture,
  dishId: string,
  day: number,
  body: string
) {
  return (await call(db, f, ADD_TASK, [dishId, day, body, randomUUID()]))
    .task_id
}

describe("prep days from the settings", { timeout: 30_000 }, () => {
  it("a Thursday session: Wednesday (the day before) and Thursday", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const s = await sheet(db, f, id)
      expect(s.event.id).toBe(id)
      expect(s.prep_days).toEqual([
        { offset: -1, date: "2026-10-21" },
        { offset: 0, date: "2026-10-22" },
      ])
      expect(s.dishes).toEqual([])
      // "+ יום הכנה" offers -6..-2 with their dates.
      expect(s.addable_days.map((d) => d.offset)).toEqual([-6, -5, -4, -3, -2])
      expect(s.addable_days[4]).toEqual({ offset: -2, date: "2026-10-20" })
      // One row only, however many reads.
      await sheet(db, f, id)
      const { rows } = await db.query(
        "select count(*)::int as n from public.work_sheets where event_id = $1",
        [id]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("a Monday session: Sunday and Monday", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-19")
      expect((await sheet(db, f, id)).prep_days).toEqual([
        { offset: -1, date: "2026-10-18" },
        { offset: 0, date: "2026-10-19" },
      ])
    })
  })

  it("a settings change does not touch an existing sheet; a new sheet takes it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await session(db, f, "2026-10-22")
      await sheet(db, f, first)
      await db.query(
        "update public.business_settings set default_prep_days = '{-2,0}'"
      )
      expect(
        (await sheet(db, f, first)).prep_days.map((d) => d.offset)
      ).toEqual([-1, 0])
      const second = await session(db, f, "2026-10-29")
      expect(
        (await sheet(db, f, second)).prep_days.map((d) => d.offset)
      ).toEqual([-2, 0])
    })
  })
})

describe("adding and removing a prep day", { timeout: 30_000 }, () => {
  it("adds Tuesday (-2) to this session only; an existing day changes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const other = await session(db, f, "2026-10-29")
      await sheet(db, f, other)
      const added = await call(db, f, ADD_DAY, [id, -2, randomUUID()])
      expect(added.prep_days).toEqual([-2, -1, 0])
      expect((await sheet(db, f, id)).prep_days[0]).toEqual({
        offset: -2,
        date: "2026-10-20",
      })
      expect(
        (await sheet(db, f, other)).prep_days.map((d) => d.offset)
      ).toEqual([-1, 0])
      const again = await call(db, f, ADD_DAY, [id, -1, randomUUID()])
      expect(again.prep_days).toEqual([-2, -1, 0])
    })
  })

  it("only -6..0", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      expect(await fails(db, f, ADD_DAY, [id, -7, randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(await fails(db, f, ADD_DAY, [id, 1, randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(await fails(db, f, ADD_DAY, [id, 100000, randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      const added = await call(db, f, ADD_DAY, [id, -6, randomUUID()])
      expect(added.prep_days).toEqual([-6, -1, 0])
    })
  })

  it("removing a day with tasks deletes them in the same call", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      await call(db, f, ADD_DAY, [id, -2, randomUUID()])
      const d = await dish(db, f, id, "שקשוקה ירוקה")
      await task(db, f, d, -2, "להזמין פטה")
      const kept = await task(db, f, d, -1, "לקצוץ עשבים")
      const removed = await call(db, f, REMOVE_DAY, [id, -2, randomUUID()])
      expect(removed).toEqual({ prep_days: [-1, 0], deleted_tasks: 1 })
      const s = await sheet(db, f, id)
      expect(s.prep_days.map((x) => x.offset)).toEqual([-1, 0])
      expect(s.dishes[0].tasks.map((t) => t.id)).toEqual([kept])
    })
  })

  it("any day can go, a default one too, but never the last one", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const left = await call(db, f, REMOVE_DAY, [id, 0, randomUUID()])
      expect(left.prep_days).toEqual([-1])
      expect(await fails(db, f, REMOVE_DAY, [id, -1, randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      // A day that is not on the sheet changes nothing.
      const none = await call(db, f, REMOVE_DAY, [id, -3, randomUUID()])
      expect(none).toEqual({ prep_days: [-1], deleted_tasks: 0 })
    })
  })
})

describe("dishes and tasks", { timeout: 30_000 }, () => {
  it("adds, renames, marks done, moves a task to another day and deletes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await dish(db, f, id, "  שקשוקה  ")
      const b = await dish(db, f, id, "עוגת יוגורט")
      await call(db, f, UPDATE_DISH, [a, "שקשוקה ירוקה", randomUUID()])
      const t1 = await task(db, f, a, 0, "לבשל")
      const t2 = await task(db, f, a, -1, "לקצוץ")
      const t3 = await task(db, f, a, -1, "רוטב")
      expect(await call(db, f, TASK_DONE, [t2, true])).toEqual({
        task_id: t2,
        done: true,
      })
      // t3 moves to the session day: at the end of it.
      await call(db, f, UPDATE_TASK, [t3, "רוטב עגבניות", 0, randomUUID()])
      let s = await sheet(db, f, id)
      expect(s.dishes.map((x) => x.name)).toEqual([
        "שקשוקה ירוקה",
        "עוגת יוגורט",
      ])
      expect(s.dishes[0].tasks).toEqual([
        { id: t2, day_offset: -1, body: "לקצוץ", done: true },
        { id: t1, day_offset: 0, body: "לבשל", done: false },
        { id: t3, day_offset: 0, body: "רוטב עגבניות", done: false },
      ])
      await call(db, f, DELETE_TASK, [t1, randomUUID()])
      await call(db, f, DELETE_DISH, [b, randomUUID()])
      s = await sheet(db, f, id)
      expect(s.dishes.map((x) => x.id)).toEqual([a])
      expect(s.dishes[0].tasks.map((t) => t.id)).toEqual([t2, t3])
      // Deleting a dish deletes its tasks.
      await call(db, f, DELETE_DISH, [a, randomUUID()])
      const { rows } = await db.query(
        "select count(*)::int as n from public.work_tasks where id = any($1::uuid[])",
        [[t2, t3]]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("a task's day must be on the sheet; text is 1-200 characters", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "שקשוקה")
      const t = await task(db, f, d, 0, "לבשל")
      expect(await fails(db, f, ADD_TASK, [d, -3, "x", randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(await fails(db, f, UPDATE_TASK, [t, "x", -3, randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(await fails(db, f, ADD_TASK, [d, 0, "   ", randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(await fails(db, f, ADD_DISH, [id, "", randomUUID()])).toBe(
        "INVALID_INPUT"
      )
      expect(
        await fails(db, f, ADD_DISH, [id, "א".repeat(201), randomUUID()])
      ).toBe("INVALID_INPUT")
      expect(await fails(db, f, TASK_DONE, [randomUUID(), true])).toBe(
        "NOT_FOUND"
      )
    })
  })

  it("the same key returns the same dish; another input with it is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const key = randomUUID()
      const first = await call(db, f, ADD_DISH, [id, "שקשוקה", key])
      const second = await call(db, f, ADD_DISH, [id, "שקשוקה", key])
      expect(second).toEqual(first)
      expect((await sheet(db, f, id)).dishes).toHaveLength(1)
      expect(await fails(db, f, ADD_DISH, [id, "עוגה", key])).toBe(
        "IDEMPOTENCY_KEY_REUSED"
      )
    })
  })

  it("writes the audit log with the session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "שקשוקה")
      const t = await task(db, f, d, 0, "לבשל")
      await call(db, f, TASK_DONE, [t, true])
      await call(db, f, ADD_DAY, [id, -2, randomUUID()])
      const { rows } = await db.query(
        `select action, entity_type, actor_id from public.audit_log
         where event_id = $1 and entity_type like 'work_%' order by action`,
        [id]
      )
      expect(rows).toEqual([
        {
          action: "admin_add_prep_day",
          entity_type: "work_sheets",
          actor_id: f.admin,
        },
        {
          action: "admin_add_work_dish",
          entity_type: "work_dishes",
          actor_id: f.admin,
        },
        {
          action: "admin_add_work_task",
          entity_type: "work_tasks",
          actor_id: f.admin,
        },
        {
          action: "admin_set_work_task_done",
          entity_type: "work_tasks",
          actor_id: f.admin,
        },
      ])
    })
  })
})

describe("ordering", { timeout: 30_000 }, () => {
  it("dishes: the full list in a new order; a stale or repeated list is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await dish(db, f, id, "א")
      const b = await dish(db, f, id, "ב")
      await call(db, f, DISH_ORDER, [[b, a]])
      expect((await sheet(db, f, id)).dishes.map((x) => x.id)).toEqual([b, a])
      const c = await dish(db, f, id, "ג")
      // The list misses the dish added since.
      expect(await fails(db, f, DISH_ORDER, [[a, b]])).toBe("CONCURRENT_CHANGE")
      expect(await fails(db, f, DISH_ORDER, [[a, a, b]])).toBe(
        "CONCURRENT_CHANGE"
      )
      expect(await fails(db, f, DISH_ORDER, [[randomUUID(), a, b]])).toBe(
        "CONCURRENT_CHANGE"
      )
      expect((await sheet(db, f, id)).dishes.map((x) => x.id)).toEqual([
        b,
        a,
        c,
      ])
    })
  })

  it("tasks: one dish and one day; a task of another day is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "שקשוקה")
      const t1 = await task(db, f, d, -1, "1")
      const t2 = await task(db, f, d, -1, "2")
      const other = await task(db, f, d, 0, "3")
      await call(db, f, TASK_ORDER, [[t2, t1]])
      expect((await sheet(db, f, id)).dishes[0].tasks.map((t) => t.id)).toEqual(
        [t2, t1, other]
      )
      expect(await fails(db, f, TASK_ORDER, [[t1, other]])).toBe(
        "CONCURRENT_CHANGE"
      )
      expect(await fails(db, f, TASK_ORDER, [[t1]])).toBe("CONCURRENT_CHANGE")
    })
  })
})

describe("access", { timeout: 30_000 }, () => {
  it("a customer sees no row and cannot call the RPCs", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "שקשוקה")
      await asAuthenticated(db, f.customer)
      for (const table of ["work_sheets", "work_dishes", "work_tasks"]) {
        const { rows } = await db.query(`select * from public.${table}`)
        expect(rows).toHaveLength(0)
      }
      expect((await queryError(db, GET, [id]))?.message).toBe("NOT_AUTHORIZED")
      expect(
        (await queryError(db, ADD_DISH, [id, "x", randomUUID()]))?.message
      ).toBe("NOT_AUTHORIZED")
      expect((await queryError(db, DISH_ORDER, [[d]]))?.message).toBe(
        "NOT_AUTHORIZED"
      )
      expect(
        (await queryError(db, ADD_DAY, [id, -2, randomUUID()]))?.message
      ).toBe("NOT_AUTHORIZED")
      await db.query("reset role")
    })
  })

  it("an unknown session -> NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await fails(db, f, GET, [randomUUID()])).toBe("NOT_FOUND")
      expect(
        await fails(db, f, ADD_DISH, [randomUUID(), "x", randomUUID()])
      ).toBe("NOT_FOUND")
    })
  })
})

describe("review fixes", { timeout: 30_000 }, () => {
  it("removing a day touches only this sheet's tasks", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const other = await session(db, f, "2026-10-29")
      const mine = await dish(db, f, id, "a")
      const theirs = await dish(db, f, other, "b")
      await task(db, f, mine, -1, "1")
      const kept = await task(db, f, theirs, -1, "2")
      const removed = await call(db, f, REMOVE_DAY, [id, -1, randomUUID()])
      expect(removed.deleted_tasks).toBe(1)
      expect(
        (await sheet(db, f, other)).dishes[0].tasks.map((t) => t.id)
      ).toEqual([kept])
    })
  })

  it("orders a day's tasks while another dish has tasks on that day", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await dish(db, f, id, "a")
      const b = await dish(db, f, id, "b")
      const t1 = await task(db, f, a, -1, "1")
      const t2 = await task(db, f, a, -1, "2")
      await task(db, f, b, -1, "3")
      await call(db, f, TASK_ORDER, [[t2, t1]])
      expect((await sheet(db, f, id)).dishes[0].tasks.map((t) => t.id)).toEqual(
        [t2, t1]
      )
    })
  })

  it("editing only the text keeps the task's place", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "a")
      const t1 = await task(db, f, d, -1, "1")
      const t2 = await task(db, f, d, -1, "2")
      await call(db, f, UPDATE_TASK, [t1, "אחד", -1, randomUUID()])
      const tasks = (await sheet(db, f, id)).dishes[0].tasks
      expect(tasks.map((t) => [t.id, t.body])).toEqual([
        [t1, "אחד"],
        [t2, "2"],
      ])
    })
  })

  it("a customer gets NOT_AUTHORIZED from all 12 RPCs", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "a")
      const t = await task(db, f, d, 0, "1")
      const calls: [string, unknown[]][] = [
        [GET, [id]],
        [ADD_DISH, [id, "x", randomUUID()]],
        [UPDATE_DISH, [d, "x", randomUUID()]],
        [DELETE_DISH, [d, randomUUID()]],
        [DISH_ORDER, [[d]]],
        [ADD_TASK, [d, 0, "x", randomUUID()]],
        [UPDATE_TASK, [t, "x", 0, randomUUID()]],
        [DELETE_TASK, [t, randomUUID()]],
        [TASK_DONE, [t, true]],
        [TASK_ORDER, [[t]]],
        [ADD_DAY, [id, -2, randomUUID()]],
        [REMOVE_DAY, [id, 0, randomUUID()]],
      ]
      await asAuthenticated(db, f.customer)
      for (const [text, params] of calls) {
        expect((await queryError(db, text, params))?.message, text).toBe(
          "NOT_AUTHORIZED"
        )
      }
      await db.query("reset role")
    })
  })

  it("a replay of a removal returns the stored result and deletes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const d = await dish(db, f, id, "a")
      await call(db, f, ADD_DAY, [id, -2, randomUUID()])
      await task(db, f, d, -2, "old")
      const key = randomUUID()
      const first = await call(db, f, REMOVE_DAY, [id, -2, key])
      expect(first.deleted_tasks).toBe(1)
      await call(db, f, ADD_DAY, [id, -2, randomUUID()])
      const fresh = await task(db, f, d, -2, "new")
      expect(await call(db, f, REMOVE_DAY, [id, -2, key])).toEqual(first)
      const s = await sheet(db, f, id)
      expect(s.prep_days.map((x) => x.offset)).toEqual([-2, -1, 0])
      expect(s.dishes[0].tasks.map((x) => x.id)).toEqual([fresh])
    })
  })

  it("the audit keeps the deleted tasks; an unchanged order writes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      const a = await dish(db, f, id, "a")
      const b = await dish(db, f, id, "b")
      const ta = await task(db, f, a, -1, "for a")
      const tb = await task(db, f, b, 0, "for b")
      await call(db, f, DISH_ORDER, [[a, b]])
      await call(db, f, TASK_ORDER, [[ta]])
      await call(db, f, UPDATE_DISH, [a, "a", randomUUID()])
      await call(db, f, REMOVE_DAY, [id, -1, randomUUID()])
      await call(db, f, DELETE_DISH, [b, randomUUID()])
      const { rows } = await db.query<{ action: string; before: never }>(
        `select action, before from public.audit_log
         where event_id = $1 and action in ('admin_set_work_dish_order',
           'admin_set_work_task_order', 'admin_update_work_dish',
           'admin_remove_prep_day', 'admin_delete_work_dish')
         order by action`,
        [id]
      )
      expect(rows.map((r) => r.action)).toEqual([
        "admin_delete_work_dish",
        "admin_remove_prep_day",
      ])
      expect(rows[0].before).toMatchObject({
        name: "b",
        tasks: [{ id: tb, day_offset: 0, body: "for b", done: false }],
      })
      expect(rows[1].before).toMatchObject({
        deleted_tasks: [
          { id: ta, dish_id: a, day_offset: -1, body: "for a", done: false },
        ],
      })
    })
  })

  it("copies the default prep days sorted and without repeats", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const set = await queryError(
        db,
        "update public.business_settings set default_prep_days = '{0,-1,-1}'"
      )
      // A settings check (4.7) may refuse the value; then nothing to test.
      if (set) return
      const id = await session(db, f, "2026-10-22")
      expect((await sheet(db, f, id)).prep_days.map((d) => d.offset)).toEqual([
        -1, 0,
      ])
    })
  })

  it("a name of only tabs or no-break spaces is refused; edges are trimmed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await session(db, f, "2026-10-22")
      expect(
        await fails(db, f, ADD_DISH, [id, "\t\u00A0\n", randomUUID()])
      ).toBe("INVALID_INPUT")
      await dish(db, f, id, "\u00A0\tשקשוקה\u00A0")
      expect((await sheet(db, f, id)).dishes[0].name).toBe("שקשוקה")
    })
  })
})
