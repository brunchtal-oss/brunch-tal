// Story 1.4: private.idempotent_begin / idempotent_finish (AD-5).

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  inRollback,
  onCleanup,
  queryError,
  runId,
  sql,
  testName,
  type Db,
} from "./support/db"

// Safety net: every scope of this file starts with the run id.
onCleanup(() =>
  sql("delete from private.idempotency_results where actor_scope like $1", [
    `${runId}%`,
  ])
)

const BEGIN = "select private.idempotent_begin($1, $2, $3, $4::jsonb) as v"
const FINISH = "select private.idempotent_finish($1, $2, $3, $4::jsonb) as v"

async function begin(
  db: Db,
  scope: string,
  key: string,
  request: object = {},
  rpc = "test_rpc"
): Promise<unknown> {
  const { rows } = await db.query(BEGIN, [
    scope,
    rpc,
    key,
    JSON.stringify(request),
  ])
  return rows[0].v
}

async function finish(
  db: Db,
  scope: string,
  key: string,
  result: object,
  rpc = "test_rpc"
): Promise<unknown> {
  const { rows } = await db.query(FINISH, [
    scope,
    rpc,
    key,
    JSON.stringify(result),
  ])
  return rows[0].v
}

async function rowCount(db: Db, scope: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from private.idempotency_results where actor_scope = $1",
    [scope]
  )
  return rows[0].n
}

describe("idempotency", () => {
  it("returns null first, then the stored result for the same call", async () => {
    await inRollback(async (db) => {
      const scope = testName("same")
      const key = randomUUID()
      const request = { p_amount: 100 }

      expect(await begin(db, scope, key, request)).toBeNull()
      expect(await finish(db, scope, key, { id: "r1" })).toEqual({ id: "r1" })
      expect(await begin(db, scope, key, request)).toEqual({ id: "r1" })
      expect(await rowCount(db, scope)).toBe(1)
    })
  })

  it("stores the sha256 hex of the request, not the request", async () => {
    await inRollback(async (db) => {
      const scope = testName("hash")
      await begin(db, scope, randomUUID(), { secret_value: "x" })
      const { rows } = await db.query(
        "select request_hash from private.idempotency_results where actor_scope = $1",
        [scope]
      )
      expect(rows[0].request_hash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it("raises IDEMPOTENCY_KEY_REUSED for the same key with another request", async () => {
    await inRollback(async (db) => {
      const scope = testName("reused")
      const key = randomUUID()
      await begin(db, scope, key, { p_amount: 100 })
      await finish(db, scope, key, { id: "r1" })

      expect(
        await queryError(db, BEGIN, [
          scope,
          "test_rpc",
          key,
          JSON.stringify({ p_amount: 200 }),
        ])
      ).toMatchObject({ code: "P0001", message: "IDEMPOTENCY_KEY_REUSED" })
    })
  })

  it("keeps keys apart per scope and per rpc", async () => {
    await inRollback(async (db) => {
      const key = randomUUID()
      const a = testName("scope_a")
      const b = testName("scope_b")
      await begin(db, a, key)
      await finish(db, a, key, { id: "a" })

      expect(await begin(db, b, key)).toBeNull()
      expect(await begin(db, a, key, {}, "other_rpc")).toBeNull()
    })
  })

  it("stores nothing for a failed call, so a retry runs again", async () => {
    await inRollback(async (db) => {
      const scope = testName("failure")
      const key = randomUUID()

      // The RPC fails after idempotent_begin: its work, including the row,
      // is rolled back.
      const error = await queryError(
        db,
        `do $$
         begin
           perform private.idempotent_begin('${scope}', 'test_rpc', '${key}', '{}');
           raise exception 'SOMETHING_FAILED' using errcode = 'P0001';
         end $$`
      )
      expect(error).toMatchObject({ message: "SOMETHING_FAILED" })
      expect(await rowCount(db, scope)).toBe(0)

      expect(await begin(db, scope, key)).toBeNull()
    })
  })

  it.each([
    ["an empty scope", "", randomUUID()],
    ["a blank scope", "   ", randomUUID()],
    ["a null scope", null, randomUUID()],
    ["a null key", "scope", null],
  ])("raises INVALID_INPUT for %s", async (_label, scope, key) => {
    await inRollback(async (db) => {
      expect(
        await queryError(db, BEGIN, [scope, "test_rpc", key, "{}"])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
    })
  })

  it("refuses a second begin in the same call with an internal error, not a P0001 code", async () => {
    await inRollback(async (db) => {
      const scope = testName("twice")
      const key = randomUUID()
      await begin(db, scope, key)
      const error = await queryError(db, BEGIN, [scope, "test_rpc", key, "{}"])
      expect(error?.code).toBe("XX000")
    })
  })

  it("refuses finish without begin", async () => {
    await inRollback(async (db) => {
      const error = await queryError(db, FINISH, [
        testName("no_begin"),
        "test_rpc",
        randomUUID(),
        "{}",
      ])
      expect(error?.code).toBe("XX000")
    })
  })

  it("is not reachable by API roles", async () => {
    await inRollback(async (db) => {
      await db.query("set local role authenticated")
      const error = await queryError(db, BEGIN, [
        testName("api"),
        "test_rpc",
        randomUUID(),
        "{}",
      ])
      expect(error?.code).toBe("42501")
    })
  })
})
