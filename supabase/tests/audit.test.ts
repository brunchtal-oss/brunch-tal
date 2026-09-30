// Story 1.4: private.audit_diff, private.audit and who may touch audit_log
// (AD-19).

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"

async function diff(
  oldRow: object | null,
  newRow: object | null,
  table: string
): Promise<{
  before: Record<string, unknown>
  after: Record<string, unknown>
}> {
  const rows = await sql<{ v: never }>(
    "select private.audit_diff($1::jsonb, $2::jsonb, $3) as v",
    [oldRow && JSON.stringify(oldRow), newRow && JSON.stringify(newRow), table]
  )
  return rows[0].v
}

const CHANGED = "<changed>"

describe("private.audit_diff", () => {
  it("keeps only the columns that changed", async () => {
    expect(
      await diff(
        { id: "p1", state: "pending", note: "same" },
        { id: "p1", state: "consumed", note: "same" },
        "activation_tokens"
      )
    ).toEqual({ before: { state: "pending" }, after: { state: "consumed" } })
  })

  it("is empty when nothing changed", async () => {
    expect(
      await diff({ a: 1, b: null }, { a: 1, b: null }, "profiles")
    ).toEqual({ before: {}, after: {} })
  })

  it("shows a key present on one side only on that side", async () => {
    expect(await diff(null, { a: 1 }, "things")).toEqual({
      before: {},
      after: { a: 1 },
    })
    expect(await diff({ a: 1 }, null, "things")).toEqual({
      before: { a: 1 },
      after: {},
    })
  })

  it("replaces a changed profiles.full_name and keeps the name out", async () => {
    const name = testName("Dana")
    const result = await diff(
      { full_name: `${name}_old`, activated_at: null },
      { full_name: name, activated_at: "2026-09-30T10:00:00Z" },
      "profiles"
    )
    expect(result).toEqual({
      before: { full_name: CHANGED, activated_at: null },
      after: { full_name: CHANGED, activated_at: "2026-09-30T10:00:00Z" },
    })
    expect(JSON.stringify(result)).not.toContain(name)
  })

  it.each([
    ["profiles", "phone_e164", "+972501234567", "+972501234568"],
    ["profiles", "dietary_notes", "no nuts", "vegan"],
    ["profiles", "pending_email", "a@example.com", "b@example.com"],
    ["babies", "name", "baby a", "baby b"],
    ["babies", "birth_date", "2026-01-01", "2026-01-02"],
    ["bookings", "guest_details", { n: "a" }, { n: "b" }],
    ["anything", "email", "a@example.com", "b@example.com"],
    ["anything", "contact_email", "a@example.com", "b@example.com"],
    ["activation_tokens", "token_hash", "a".repeat(64), "b".repeat(64)],
    ["activation_tokens", "input_hash", "c".repeat(64), "d".repeat(64)],
  ])("masks %s.%s", async (table, column, before, after) => {
    const result = await diff({ [column]: before }, { [column]: after }, table)
    expect(result).toEqual({
      before: { [column]: CHANGED },
      after: { [column]: CHANGED },
    })
  })

  it("does not mask full_name outside profiles or guest_details outside bookings", async () => {
    expect(
      await diff(
        { full_name: "x", guest_details: "g1" },
        { full_name: "y", guest_details: "g2" },
        "products"
      )
    ).toEqual({
      before: { full_name: "x", guest_details: "g1" },
      after: { full_name: "y", guest_details: "g2" },
    })
  })
})

const AUDIT = `select private.audit($1, $2, 'test_action', 'profiles', $3, $4, null,
  $5::jsonb, $6::jsonb, $7) as id`

async function insertProfile(db: Db, label: string): Promise<string> {
  const id = randomUUID()
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [id, testName(label)]
  )
  return id
}

describe("private.audit", () => {
  it("writes one row with the given actor and the masked diff", async () => {
    await inRollback(async (db) => {
      const customer = await insertProfile(db, "audited")
      const actor = randomUUID()
      const { rows } = await db.query(AUDIT, [
        actor,
        "admin",
        customer,
        customer,
        JSON.stringify({ full_name: "old", activated_at: null }),
        JSON.stringify({ full_name: "new", activated_at: "2026-09-30" }),
        "a reason",
      ])

      const log = await db.query(
        "select actor_id, actor_kind, action, entity_type, entity_id, customer_id, event_id, before, after, reason from public.audit_log where id = $1",
        [rows[0].id]
      )
      expect(log.rows[0]).toEqual({
        actor_id: actor,
        actor_kind: "admin",
        action: "test_action",
        entity_type: "profiles",
        entity_id: customer,
        customer_id: customer,
        event_id: null,
        before: { full_name: CHANGED, activated_at: null },
        after: { full_name: CHANGED, activated_at: "2026-09-30" },
        reason: "a reason",
      })
    })
  })

  it("refuses an unknown actor kind and a missing actor for admin or customer", async () => {
    await inRollback(async (db) => {
      const args = (actor: string | null, kind: string) => [
        actor,
        kind,
        null,
        null,
        "{}",
        "{}",
        null,
      ]
      expect(
        (await queryError(db, AUDIT, args(randomUUID(), "robot")))?.code
      ).toBe("23514")
      expect((await queryError(db, AUDIT, args(null, "customer")))?.code).toBe(
        "23514"
      )
      expect(await queryError(db, AUDIT, args(null, "system"))).toBeNull()
    })
  })

  it.each(["baby", "profile", "Profiles", ""])(
    "refuses an entity_type that is not a public table: %j",
    async (entityType) => {
      await inRollback(async (db) => {
        const error = await queryError(
          db,
          `select private.audit(null, 'system', 'test_action', $1, null, null, null,
             '{"full_name": "a"}'::jsonb, '{"full_name": "b"}'::jsonb)`,
          [entityType]
        )
        expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      })
    }
  )
})

describe("audit_log writes", () => {
  const INSERT =
    "insert into public.audit_log (actor_kind, action, entity_type) values ('system', 'x', 'y')"

  it("no API role can insert, update or delete", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await inRollback(async (db) => {
        if (role === "service_role") await asServiceRole(db)
        else if (role === "authenticated")
          await asAuthenticated(db, randomUUID())
        else await db.query("set local role anon")

        expect((await queryError(db, INSERT))?.code).toBe("42501")
        expect(
          (await queryError(db, "update public.audit_log set reason = 'x'"))
            ?.code
        ).toBe("42501")
        expect(
          (await queryError(db, "delete from public.audit_log"))?.code
        ).toBe("42501")
      })
    }
  })

  it("API roles cannot call private.audit", async () => {
    await inRollback(async (db) => {
      // authenticated has USAGE on private, so the refusal is the function's.
      await asAuthenticated(db, randomUUID())
      const error = await queryError(db, AUDIT, [
        null,
        "system",
        null,
        null,
        "{}",
        "{}",
        null,
      ])
      expect(error?.code).toBe("42501")
      expect(error?.message).toBe("permission denied for function audit")
    })
  })
})
