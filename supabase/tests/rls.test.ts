// Story 1.4: row level security of profiles and audit_log for a customer,
// an admin and anon. Fictitious profiles only, no Auth users.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

type Fixture = { a: string; b: string; admin: string; auditIds: string[] }

// As the owner: customers A and B, an admin, and one audit row per customer.
async function seed(db: Db): Promise<Fixture> {
  const a = randomUUID()
  const b = randomUUID()
  const admin = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now())`,
    [a, testName("rls_a"), b, testName("rls_b")]
  )
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  const auditIds: string[] = []
  for (const customer of [a, b]) {
    const { rows } = await db.query(
      `select private.audit($1, 'customer', 'test_rls', 'profiles', $1, $1, null,
         '{"activated_at": null}'::jsonb, '{"activated_at": "2026-09-30"}'::jsonb) as id`,
      [customer]
    )
    auditIds.push(rows[0].id)
  }
  return { a, b, admin, auditIds }
}

async function visibleProfiles(db: Db, ids: string[]): Promise<string[]> {
  const { rows } = await db.query(
    "select id from public.profiles where id = any($1::uuid[]) order by id",
    [ids]
  )
  return rows.map((row) => row.id)
}

async function visibleAudit(db: Db, ids: string[]): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.audit_log where id = any($1::uuid[])",
    [ids]
  )
  return rows[0].n
}

describe("row level security", () => {
  it("a customer sees only her own profile and no audit row", async () => {
    await inRollback(async (db) => {
      const { a, b, auditIds } = await seed(db)
      await asAuthenticated(db, a)

      expect(await visibleProfiles(db, [a, b])).toEqual([a])
      expect(await visibleAudit(db, auditIds)).toBe(0)
    })
  })

  it("an admin sees the audit log", async () => {
    await inRollback(async (db) => {
      const { admin, auditIds } = await seed(db)
      await asAuthenticated(db, admin)

      expect(await visibleAudit(db, auditIds)).toBe(2)
    })
  })

  it("a signed-in user without a profile or admin role sees nothing", async () => {
    await inRollback(async (db) => {
      const { a, b, auditIds } = await seed(db)
      await asAuthenticated(db, randomUUID())

      expect(await visibleProfiles(db, [a, b])).toEqual([])
      expect(await visibleAudit(db, auditIds)).toBe(0)
    })
  })

  it("anon cannot read profiles or the audit log", async () => {
    await inRollback(async (db) => {
      await seed(db)
      await db.query("set local role anon")

      for (const table of ["public.profiles", "public.audit_log"]) {
        expect(
          (await queryError(db, `select 1 from ${table} limit 1`))?.code
        ).toBe("42501")
      }
    })
  })
})
