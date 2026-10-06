// Story 2.10: the customer's profile. private.babies_guard (birth date not
// after the local today, at most 10 babies, the customer does not delete her
// last baby, the count after the profile lock), the babies insert grant
// without customer_id, the profile column grants, and set_photo_consent.
// Along the I/O matrix of the spec. Profiles are fictitious rows without
// Auth users (asAuthenticated sets auth.uid()).

import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  getPool,
  inRollback,
  insertAuthUser,
  onCleanup,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney } from "./support/money"

const CONSENT = "select public.set_photo_consent($1) as r"
const TOMORROW = "((now() at time zone 'Asia/Jerusalem')::date + 1)"
const TODAY = "((now() at time zone 'Asia/Jerusalem')::date)"

// As the owner: an active customer (or not activated) with `babies` babies.
async function seedCustomer(
  db: Db,
  {
    babies = 1,
    activated = true,
  }: { babies?: number; activated?: boolean } = {}
): Promise<{ id: string; babyIds: string[] }> {
  const id = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, case when $3 then now() end)`,
    [id, testName("profile"), activated]
  )
  const babyIds: string[] = []
  for (let i = 0; i < babies; i++) {
    const { rows } = await db.query(
      "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-07-05') returning id",
      [id, testName(`baby_${i}`)]
    )
    babyIds.push(rows[0].id)
  }
  return { id, babyIds }
}

// The raised error with its parsed detail, inside a savepoint.
async function raised(db: Db, text: string, params: unknown[] = []) {
  await db.query("savepoint raised")
  try {
    await db.query(text, params)
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

async function babyCount(db: Db, customerId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.babies where customer_id = $1",
    [customerId]
  )
  return rows[0].n
}

describe("babies guard", () => {
  it("refuses a birth date after the local today, on insert and update", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db)
      await asAuthenticated(db, c.id)

      const onInsert = await raised(
        db,
        `insert into public.babies (name, birth_date) values ($1, ${TOMORROW})`,
        [testName("future")]
      )
      expect(onInsert).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "birth_date" },
      })
      const onUpdate = await raised(
        db,
        `update public.babies set birth_date = ${TOMORROW} where id = $1`,
        [c.babyIds[0]]
      )
      expect(onUpdate?.message).toBe("INVALID_INPUT")
      expect(onUpdate?.detail).toEqual({ field: "birth_date" })

      // Born today is allowed (age 0).
      const { rows } = await db.query(
        `insert into public.babies (name, birth_date) values ($1, ${TODAY}) returning customer_id`,
        [testName("today")]
      )
      expect(rows).toEqual([{ customer_id: c.id }])
    })
  })

  it("refuses an eleventh baby, for the customer and for any writer", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db, { babies: 10 })
      await asAuthenticated(db, c.id)
      const error = await raised(
        db,
        "insert into public.babies (name, birth_date) values ($1, '2026-01-01')",
        [testName("eleventh")]
      )
      expect(error).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "babies" },
      })
      await db.query("reset role")
      expect(
        (
          await raised(
            db,
            "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-01-01')",
            [c.id, testName("owner_eleventh")]
          )
        )?.detail
      ).toEqual({ field: "babies" })
      expect(await babyCount(db, c.id)).toBe(10)
    })
  })

  it("keeps the customer's last baby (LAST_BABY), but not against a cascade", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db, { babies: 2 })
      await asAuthenticated(db, c.id)
      const { rowCount } = await db.query(
        "delete from public.babies where id = $1",
        [c.babyIds[0]]
      )
      expect(rowCount).toBe(1)
      expect(
        await raised(db, "delete from public.babies where id = $1", [
          c.babyIds[1],
        ])
      ).toMatchObject({ code: "P0001", message: "LAST_BABY" })
      await db.query("reset role")
      expect(await babyCount(db, c.id)).toBe(1)

      // One statement deleting all her babies: the last row is refused and
      // the whole statement with it.
      await db.query(
        "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-07-05')",
        [c.id, testName("baby_again")]
      )
      await asAuthenticated(db, c.id)
      expect(
        await raised(db, "delete from public.babies where customer_id = $1", [
          c.id,
        ])
      ).toMatchObject({ code: "P0001", message: "LAST_BABY" })
      await db.query("reset role")
      expect(await babyCount(db, c.id)).toBe(2)

      // Not the customer herself: the profile removed (cascade).
      await db.query("delete from public.profiles where id = $1", [c.id])
      expect(await babyCount(db, c.id)).toBe(0)
    })
  })

  it("never takes customer_id from the input", async () => {
    await inRollback(async (db) => {
      const mine = await seedCustomer(db)
      const other = await seedCustomer(db)
      await asAuthenticated(db, mine.id)
      expect(
        (
          await queryError(
            db,
            "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-01-01')",
            [other.id, testName("foreign")]
          )
        )?.code
      ).toBe("42501")
      expect(
        (
          await queryError(
            db,
            "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-01-01')",
            [mine.id, testName("own_explicit")]
          )
        )?.code
      ).toBe("42501")
      // Another customer's baby is invisible, so it is not changed.
      const { rowCount } = await db.query(
        "update public.babies set name = $1 where id = $2",
        [testName("renamed"), other.babyIds[0]]
      )
      expect(rowCount).toBe(0)
    })
  })

  it("refuses a direct update of the phone or the photo consent", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db)
      await asAuthenticated(db, c.id)
      for (const column of [
        "phone_e164 = '+972541111111'",
        "photo_consent = true",
      ]) {
        expect(
          (await queryError(db, `update public.profiles set ${column}`))?.code
        ).toBe("42501")
      }
      // Empty dietary notes are stored as null (the action trims to null);
      // an empty string is refused by the check.
      expect(
        (
          await queryError(
            db,
            "update public.profiles set dietary_notes = '   '"
          )
        )?.code
      ).toBe("23514")
      const { rows } = await db.query(
        "update public.profiles set dietary_notes = null returning dietary_notes"
      )
      expect(rows).toEqual([{ dietary_notes: null }])
    })
  })

  it("lets join_complete add two babies with the guard in place", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const approved = await approve(db, {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      })
      await db.query("reset role")

      const email = `${testName("twins")}@example.test`.toLowerCase()
      const phone = `058${String(Date.now()).slice(-7)}`
      const key = randomUUID()
      await asServiceRole(db)
      const { rows: begun } = await db.query(
        "select public.join_begin($1, $2, $3, $4) as r",
        [approved.token, email, phone, key]
      )
      await db.query("reset role")
      const userId = begun[0].r.pending_user_id as string
      await insertAuthUser(db, "twins", { id: userId })
      await asServiceRole(db)
      const { rows: done } = await db.query(
        "select public.join_complete($1, $2::jsonb, $3) as r",
        [
          approved.token,
          JSON.stringify({
            email,
            phone,
            full_name: testName("twins_mother"),
            dietary_notes: null,
            privacy_consent: true,
            photo_consent: false,
            babies: [
              { name: testName("twin_a"), birth_date: "2026-07-05" },
              { name: testName("twin_b"), birth_date: "2026-07-05" },
            ],
          }),
          key,
        ]
      )
      await db.query("reset role")
      expect(done[0].r.outcome).toBe("joined")
      expect(await babyCount(db, userId)).toBe(2)
    })
  })
})

describe("set_photo_consent", () => {
  it("stores the change with now(), the join-form version and an audit row", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db)
      const { rowCount: pages } = await db.query(
        "update public.content_pages set published_version = 3 where slug = 'join-form'"
      )
      expect(pages).toBe(1)
      await asAuthenticated(db, c.id)
      const { rows } = await db.query(CONSENT, [true])
      const { rows: now } = await db.query("select now() as now")
      expect(rows[0].r).toEqual({
        photo_consent: true,
        photo_consent_at: expect.any(String),
        photo_consent_text_version: 3,
      })
      expect(new Date(rows[0].r.photo_consent_at).getTime()).toBe(
        new Date(now[0].now).getTime()
      )
      await db.query("reset role")

      const { rows: profile } = await db.query(
        "select photo_consent, photo_consent_text_version from public.profiles where id = $1",
        [c.id]
      )
      expect(profile).toEqual([
        { photo_consent: true, photo_consent_text_version: 3 },
      ])
      const { rows: audit } = await db.query(
        "select actor_id, actor_kind, action, before, after from public.audit_log where customer_id = $1 and action = 'set_photo_consent'",
        [c.id]
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actor_id: c.id,
        actor_kind: "customer",
        before: { photo_consent: false },
        after: { photo_consent: true, photo_consent_text_version: 3 },
      })
    })
  })

  it("writes nothing for the same value", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db)
      await db.query(
        "update public.profiles set photo_consent = true, photo_consent_at = '2026-09-01T08:00:00Z', photo_consent_text_version = 0 where id = $1",
        [c.id]
      )
      await asAuthenticated(db, c.id)
      const { rows } = await db.query(CONSENT, [true])
      expect(rows[0].r.photo_consent).toBe(true)
      expect(rows[0].r.photo_consent_text_version).toBe(0)
      expect(new Date(rows[0].r.photo_consent_at).toISOString()).toBe(
        "2026-09-01T08:00:00.000Z"
      )
      await db.query("reset role")
      const { rows: audit } = await db.query(
        "select 1 from public.audit_log where customer_id = $1 and action = 'set_photo_consent'",
        [c.id]
      )
      expect(audit).toHaveLength(0)
    })
  })

  it("refuses a null answer (INVALID_INPUT, photo_consent)", async () => {
    await inRollback(async (db) => {
      const c = await seedCustomer(db)
      await asAuthenticated(db, c.id)
      expect(await raised(db, CONSENT, [null])).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "photo_consent" },
      })
    })
  })

  it("is NOT_AUTHORIZED for an admin or an account that is not activated", async () => {
    await inRollback(async (db) => {
      const admin = randomUUID()
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        admin,
      ])
      const pending = await seedCustomer(db, { activated: false })
      for (const userId of [admin, pending.id]) {
        await asAuthenticated(db, userId)
        expect(await queryError(db, CONSENT, [true])).toEqual({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
        await db.query("reset role")
      }
    })
  })
})

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

// A committed active customer with `babies` babies (two transactions must
// see each other), removed with her babies in onCleanup.
async function committedCustomer(
  label: string,
  babies: number
): Promise<{ id: string; babyIds: string[] }> {
  const id = randomUUID()
  onCleanup(() => sql("delete from public.profiles where id = $1", [id]))
  await sql(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [id, testName(label)]
  )
  const babyIds: string[] = []
  for (let i = 0; i < babies; i++) {
    const rows = await sql<{ id: string }>(
      "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-07-05') returning id",
      [id, testName(`${label}_${i}`)]
    )
    babyIds.push(rows[0].id)
  }
  return { id, babyIds }
}

// As the customer in two sessions: A runs `first` and holds its locks; B
// runs `second` and must wait on a lock; A commits. Returns B's error (or
// null when B succeeded).
async function race(
  customer: string,
  first: [string, unknown[]],
  second: [string, unknown[]]
): Promise<{ code?: string; message?: string; detail?: string } | null> {
  const a = await getPool().connect()
  const b = await getPool().connect()
  let pending: Promise<unknown> | undefined
  try {
    await a.query("begin")
    await asAuthenticated(a, customer)
    await a.query(...first)

    await b.query("begin")
    await asAuthenticated(b, customer)
    const { rows: pid } = await b.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    )
    pending = b.query(...second)
    pending.catch(() => {})

    await a.query("reset role")
    expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
    await a.query("commit")

    const result = await pending.then(
      () => null,
      (error: { code?: string; message?: string; detail?: string }) => error
    )
    if (result === null) await b.query("commit")
    return result
  } finally {
    await a.query("rollback").catch(() => {})
    await pending?.catch(() => {})
    await b.query("rollback").catch(() => {})
    a.release()
    b.release()
  }
}

describe("babies under concurrency", () => {
  it("two deletes at once: one passes, the other gets LAST_BABY", async () => {
    const c = await committedCustomer("race_delete", 2)
    const DELETE = "delete from public.babies where id = $1"
    const error = await race(
      c.id,
      [DELETE, [c.babyIds[0]]],
      [DELETE, [c.babyIds[1]]]
    )
    expect(error).toMatchObject({ code: "P0001", message: "LAST_BABY" })

    const left = await sql<{ id: string }>(
      "select id from public.babies where customer_id = $1",
      [c.id]
    )
    expect(left).toEqual([{ id: c.babyIds[1] }])
  })

  it("two inserts at once at 9 babies: one passes, the other gets INVALID_INPUT babies", async () => {
    const c = await committedCustomer("race_insert", 9)
    const INSERT =
      "insert into public.babies (name, birth_date) values ($1, '2026-07-05')"
    const error = await race(
      c.id,
      [INSERT, [testName("race_tenth")]],
      [INSERT, [testName("race_eleventh")]]
    )
    expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
    expect(JSON.parse(error?.detail ?? "null")).toEqual({ field: "babies" })

    const count = await sql<{ n: number }>(
      "select count(*)::int as n from public.babies where customer_id = $1",
      [c.id]
    )
    expect(count[0].n).toBe(10)
  })
})
