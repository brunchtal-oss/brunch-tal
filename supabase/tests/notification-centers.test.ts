// Story 5.7: mark_notifications_read / mark_notifications_unread and the
// reads behind the notification centers. Customers A and B and one admin,
// fictitious and without Auth users, all in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"

type Fixture = {
  a: string
  b: string
  admin: string
  inactive: string
  ids: { a1: string; a2: string; b1: string; admin1: string }
}

async function enqueue(
  db: Db,
  recipient: string,
  type: string,
  discriminator: string,
  targetPath: string,
  bodyOverride: string | null = null
): Promise<string> {
  const { rows } = await db.query(
    "select private.enqueue_notification($1, $2, $3, null, $4, $5) as id",
    [recipient, type, discriminator, targetPath, bodyOverride]
  )
  return rows[0].id
}

// As the owner: A has 2 unread, B 1, the admin 1. `inactive` has a profile
// that was never activated (current_customer_id() is null for her).
async function seed(db: Db): Promise<Fixture> {
  const a = randomUUID()
  const b = randomUUID()
  const admin = randomUUID()
  const inactive = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now()), ($5, $6, null)`,
    [
      a,
      testName("centers_a"),
      b,
      testName("centers_b"),
      inactive,
      testName("centers_inactive"),
    ]
  )
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  const ids = {
    a1: await enqueue(db, a, "purchase_new_card", "c-a1", "/me"),
    a2: await enqueue(db, a, "purchase_new_card", "c-a2", "/me/bookings"),
    b1: await enqueue(db, b, "purchase_new_card", "c-b1", "/me"),
    admin1: await enqueue(
      db,
      admin,
      "marketing_reminder",
      "c-m",
      "/admin",
      "x"
    ),
  }
  return { a, b, admin, inactive, ids }
}

const READ = "select public.mark_notifications_read($1::uuid[]) as r"
const UNREAD = "select public.mark_notifications_unread($1::uuid[]) as r"

async function call(
  db: Db,
  text: string,
  ids: string[] | null
): Promise<{ marked: number }> {
  const { rows } = await db.query(text, [ids])
  return rows[0].r
}

// As the owner (reset role first): read_at of the given ids, in order.
async function readAt(db: Db, ids: string[]): Promise<Array<string | null>> {
  const { rows } = await db.query(
    `select n.read_at::text as read_at
     from unnest($1::uuid[]) with ordinality as x(id, ord)
     join public.notifications n on n.id = x.id
     order by x.ord`,
    [ids]
  )
  return rows.map((row) => row.read_at)
}

describe("notification centers: reading", () => {
  it("every recipient sees and counts only her own", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const all = Object.values(f.ids)
      const expected = {
        a: { kind: "customer", ids: [f.ids.a1, f.ids.a2].sort() },
        b: { kind: "customer", ids: [f.ids.b1] },
        admin: { kind: "admin", ids: [f.ids.admin1] },
      } as const
      for (const who of ["a", "b", "admin"] as const) {
        await asAuthenticated(db, f[who])
        const { rows } = await db.query(
          `select id from public.notifications
           where id = any($1::uuid[]) and recipient_kind = $2
           order by id`,
          [all, expected[who].kind]
        )
        expect(
          rows.map((row) => row.id),
          who
        ).toEqual(expected[who].ids)
        const count = await db.query(
          `select count(*)::int as n from public.notifications
           where read_at is null and recipient_kind = $1
             and id = any($2::uuid[])`,
          [expected[who].kind, all]
        )
        expect(count.rows[0].n, who).toBe(expected[who].ids.length)
        await db.query("reset role")
      }
    })
  })

  it("a customer cannot read or mark an admin notification directly", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.a)
      const { rows } = await db.query(
        "select id from public.notifications where id = $1",
        [f.ids.admin1]
      )
      expect(rows).toEqual([])
      expect(await call(db, READ, [f.ids.admin1])).toEqual({ marked: 0 })
      await db.query("reset role")
      expect(await readAt(db, [f.ids.admin1])).toEqual([null])
    })
  })
})

describe("mark_notifications_read", () => {
  it("marks one, and a second call changes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.a)
      expect(await call(db, READ, [f.ids.a1])).toEqual({ marked: 1 })
      await db.query("reset role")
      const [first] = await readAt(db, [f.ids.a1])
      expect(first).not.toBeNull()
      expect(await readAt(db, [f.ids.a2])).toEqual([null])

      await asAuthenticated(db, f.a)
      expect(await call(db, READ, [f.ids.a1])).toEqual({ marked: 0 })
      await db.query("reset role")
      expect(await readAt(db, [f.ids.a1])).toEqual([first])
    })
  })

  it("null marks all of hers and nobody else's", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.a)
      expect(await call(db, READ, null)).toEqual({ marked: 2 })
      await db.query("reset role")
      const [a1, a2, b1, admin1] = await readAt(db, [
        f.ids.a1,
        f.ids.a2,
        f.ids.b1,
        f.ids.admin1,
      ])
      expect(a1).not.toBeNull()
      expect(a2).not.toBeNull()
      expect(b1).toBeNull()
      expect(admin1).toBeNull()
    })
  })

  it("an admin with null marks only her own", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await call(db, READ, null)).toEqual({ marked: 1 })
      await db.query("reset role")
      const [a1, a2, b1, admin1] = await readAt(db, [
        f.ids.a1,
        f.ids.a2,
        f.ids.b1,
        f.ids.admin1,
      ])
      expect([a1, a2, b1]).toEqual([null, null, null])
      expect(admin1).not.toBeNull()
    })
  })

  it("refuses more than 200 ids", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.a)
      const ids = Array.from({ length: 201 }, () => randomUUID())
      const error = await queryError(db, READ, [ids])
      expect(error?.code).toBe("P0001")
      expect(error?.message).toBe("INVALID_INPUT")
      const ok = await call(db, READ, ids.slice(0, 200))
      expect(ok).toEqual({ marked: 0 })
    })
  })
})

describe("mark_notifications_unread", () => {
  it("unmarks her own read row, skips someone else's, requires ids", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.notifications set read_at = now() where id = any($1::uuid[])",
        [[f.ids.a1, f.ids.b1]]
      )
      await asAuthenticated(db, f.a)
      expect(await call(db, UNREAD, [f.ids.a1])).toEqual({ marked: 1 })
      // Already unread: nothing to change.
      expect(await call(db, UNREAD, [f.ids.a1])).toEqual({ marked: 0 })
      expect(await call(db, UNREAD, [f.ids.b1])).toEqual({ marked: 0 })
      for (const ids of [null, []]) {
        const error = await queryError(db, UNREAD, [ids])
        expect(error?.code, JSON.stringify(ids)).toBe("P0001")
        expect(error?.message, JSON.stringify(ids)).toBe("INVALID_INPUT")
      }
      const many = Array.from({ length: 201 }, () => randomUUID())
      expect((await queryError(db, UNREAD, [many]))?.message).toBe(
        "INVALID_INPUT"
      )
      await db.query("reset role")
      const [a1, b1] = await readAt(db, [f.ids.a1, f.ids.b1])
      expect(a1).toBeNull()
      expect(b1).not.toBeNull()
    })
  })
})

describe("who may call", () => {
  it("anon has no execute (42501)", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const [text, ids] of [
        [READ, null],
        [UNREAD, [randomUUID()]],
      ] as const) {
        expect((await queryError(db, text, [ids]))?.code, text).toBe("42501")
      }
    })
  })

  it("a user without an active profile who is not an admin gets NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const user of [f.inactive, randomUUID()]) {
        await asAuthenticated(db, user)
        for (const [text, ids] of [
          [READ, null],
          [UNREAD, [f.ids.a1]],
        ] as const) {
          const error = await queryError(db, text, [ids])
          expect(error?.code, text).toBe("P0001")
          expect(error?.message, text).toBe("NOT_AUTHORIZED")
        }
        await db.query("reset role")
      }
    })
  })
})

describe("pg_proc", () => {
  it("only the two mark functions write notifications.read_at", async () => {
    const rows = await sql<{ name: string; src: string }>(`
      select n.nspname || '.' || p.proname as name, p.prosrc as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.oid not in (select objid from pg_depend where deptype = 'e')`)
    const writers = rows
      .filter((row) => /\bread_at\s*=/i.test(row.src))
      .filter((row) => /update\s+public\.notifications\b/i.test(row.src))
      .map((row) => row.name)
      .sort()
    expect(writers).toEqual([
      "public.mark_notifications_read",
      "public.mark_notifications_unread",
    ])
  })
})
