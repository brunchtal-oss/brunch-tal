// Story 1.4: reset_begin / reset_complete with idempotency and audit
// (AD-5, AD-10, AD-19, AD-21). Everything runs as the service role inside a
// rolled-back transaction; fictitious profiles only, no Auth users.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const BEGIN = "select public.reset_begin($1, $2) as v"
const COMPLETE = "select public.reset_complete($1, $2) as v"

type Issued = { token_id: string; token: string }

// As the owner: an activated customer (or an admin) to reset.
async function createTarget(db: Db, admin = false): Promise<string> {
  const id = randomUUID()
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [id, testName(admin ? "reset_admin" : "reset_customer")]
  )
  if (admin) {
    await db.query("insert into public.admin_roles (user_id) values ($1)", [id])
  }
  return id
}

async function issue(db: Db, userId: string): Promise<Issued> {
  const { rows } = await db.query("select public.issue_reset_token($1) as v", [
    userId,
  ])
  return rows[0].v
}

async function call(
  db: Db,
  query: string,
  token: string,
  key: string
): Promise<Record<string, unknown>> {
  const { rows } = await db.query(query, [token, key])
  return rows[0].v
}

async function auditRows(db: Db, tokenId: string) {
  await db.query("reset role")
  const { rows } = await db.query(
    "select actor_id, actor_kind, action, entity_type, entity_id, customer_id, before, after, row_to_json(a)::text as raw from public.audit_log a where entity_id = $1",
    [tokenId]
  )
  await asServiceRole(db)
  return rows
}

describe("reset with idempotency", () => {
  it("completes once, audits once without the token or its hash, and repeats the same result", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      const key = randomUUID()

      expect(await call(db, BEGIN, token, key)).toEqual({
        token_id: tokenId,
        user_id: userId,
        already_completed: false,
      })

      const first = await call(db, COMPLETE, token, key)
      expect(first).toEqual({ token_id: tokenId, user_id: userId })

      await db.query("reset role")
      const { rows: tokenRows } = await db.query(
        "select state, customer_id, token_hash from public.activation_tokens where id = $1",
        [tokenId]
      )
      expect(tokenRows[0]).toMatchObject({
        state: "consumed",
        customer_id: userId,
      })
      const tokenHash: string = tokenRows[0].token_hash
      await asServiceRole(db)

      const logs = await auditRows(db, tokenId)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        actor_id: userId,
        actor_kind: "customer",
        action: "reset_complete",
        entity_type: "activation_tokens",
        customer_id: userId,
        before: { state: "pending", consumed_at: null, customer_id: null },
        after: { state: "consumed", customer_id: userId },
      })
      expect(logs[0].raw).not.toContain(token)
      expect(logs[0].raw).not.toContain(tokenHash)

      // Same key again: the stored result, no second audit row.
      expect(await call(db, COMPLETE, token, key)).toEqual(first)
      expect(await auditRows(db, tokenId)).toHaveLength(1)
    })
  })

  it("records an admin target as actor_kind admin", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db, true)
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      await call(db, COMPLETE, token, randomUUID())

      const logs = await auditRows(db, tokenId)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ actor_id: userId, actor_kind: "admin" })
    })
  })

  it("begin after completion: already_completed with the same key, LINK_USED with another", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      const key = randomUUID()
      await call(db, COMPLETE, token, key)

      expect(await call(db, BEGIN, token, key)).toEqual({
        token_id: tokenId,
        user_id: userId,
        already_completed: true,
      })
      expect(await queryError(db, BEGIN, [token, randomUUID()])).toMatchObject({
        code: "P0001",
        message: "LINK_USED",
      })
    })
  })

  it("complete with another key after completion is LINK_USED and adds no audit row", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      await call(db, COMPLETE, token, randomUUID())

      expect(
        await queryError(db, COMPLETE, [token, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "LINK_USED" })
      expect(await auditRows(db, tokenId)).toHaveLength(1)
    })
  })

  it("a revoked link stays closed for an old key", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token } = await issue(db, userId)
      const key = randomUUID()
      await call(db, BEGIN, token, key)

      // Issuing a replacement revokes the first link.
      await issue(db, userId)

      expect(await queryError(db, BEGIN, [token, key])).toMatchObject({
        code: "P0001",
        message: "LINK_EXPIRED",
      })
      expect(await queryError(db, COMPLETE, [token, key])).toMatchObject({
        code: "P0001",
        message: "LINK_EXPIRED",
      })
    })
  })

  describe("expiry and target validity", () => {
    // As the owner, then back to the service role.
    async function asOwner(db: Db, text: string, params: unknown[]) {
      await db.query("reset role")
      await db.query(text, params)
      await asServiceRole(db)
    }
    const expire = (db: Db, tokenId: string) =>
      asOwner(
        db,
        "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
        [tokenId]
      )
    const invalidate = (db: Db, userId: string) =>
      asOwner(
        db,
        "update public.profiles set activated_at = null where id = $1",
        [userId]
      )

    it("begin on an expired pending link is LINK_EXPIRED", async () => {
      await inRollback(async (db) => {
        const userId = await createTarget(db)
        await asServiceRole(db)
        const { token_id: tokenId, token } = await issue(db, userId)
        await expire(db, tokenId)

        expect(
          await queryError(db, BEGIN, [token, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      })
    })

    it("begin with an invalid target is LINK_EXPIRED", async () => {
      await inRollback(async (db) => {
        const userId = await createTarget(db)
        await asServiceRole(db)
        const { token } = await issue(db, userId)
        await invalidate(db, userId)

        expect(
          await queryError(db, BEGIN, [token, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      })
    })

    it("complete after the link expired since begin still consumes it and audits once", async () => {
      await inRollback(async (db) => {
        const userId = await createTarget(db)
        await asServiceRole(db)
        const { token_id: tokenId, token } = await issue(db, userId)
        const key = randomUUID()
        await call(db, BEGIN, token, key)
        await expire(db, tokenId)

        expect(await call(db, COMPLETE, token, key)).toEqual({
          token_id: tokenId,
          user_id: userId,
        })
        const logs = await auditRows(db, tokenId)
        expect(logs).toHaveLength(1)
        expect(logs[0].after).toMatchObject({ state: "consumed" })
      })
    })

    it("same-key already_completed is LINK_EXPIRED after expiry", async () => {
      await inRollback(async (db) => {
        const userId = await createTarget(db)
        await asServiceRole(db)
        const { token_id: tokenId, token } = await issue(db, userId)
        const key = randomUUID()
        await call(db, COMPLETE, token, key)
        await expire(db, tokenId)

        expect(await queryError(db, BEGIN, [token, key])).toMatchObject({
          code: "P0001",
          message: "LINK_EXPIRED",
        })
      })
    })

    it("same-key already_completed is LINK_EXPIRED after the target became invalid", async () => {
      await inRollback(async (db) => {
        const userId = await createTarget(db)
        await asServiceRole(db)
        const { token } = await issue(db, userId)
        const key = randomUUID()
        await call(db, COMPLETE, token, key)
        await invalidate(db, userId)

        expect(await queryError(db, BEGIN, [token, key])).toMatchObject({
          code: "P0001",
          message: "LINK_EXPIRED",
        })
      })
    })
  })

  it("an unknown token is LINK_EXPIRED", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      for (const query of [BEGIN, COMPLETE]) {
        expect(
          await queryError(db, query, ["x".repeat(43), randomUUID()])
        ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      }
    })
  })

  it("a missing key is INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token } = await issue(db, userId)
      for (const query of [BEGIN, COMPLETE]) {
        expect(await queryError(db, query, [token, null])).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
    })
  })

  it("keeps the token out of the stored idempotency row", async () => {
    await inRollback(async (db) => {
      const userId = await createTarget(db)
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      const key = randomUUID()
      await call(db, COMPLETE, token, key)

      await db.query("reset role")
      const { rows } = await db.query(
        "select actor_scope, rpc, key::text as key, row_to_json(r)::text as raw from private.idempotency_results r where actor_scope = $1",
        [`token:${tokenId}`]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ rpc: "reset_complete", key })
      expect(rows[0].raw).not.toContain(token)
    })
  })

  it("refuses an authenticated caller", async () => {
    await inRollback(async (db) => {
      await asAuthenticated(db, randomUUID())
      for (const query of [BEGIN, COMPLETE]) {
        expect(
          (await queryError(db, query, ["x".repeat(43), randomUUID()]))?.code
        ).toBe("42501")
      }
    })
  })
})
