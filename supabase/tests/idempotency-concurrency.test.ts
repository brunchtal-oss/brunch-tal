// Story 1.7: two connections call private.idempotent_begin with the same
// scope, rpc, key and request (AD-5). The second waits on the primary key
// until the first commits, then returns the stored result. This needs a real
// commit, so the row is removed in onCleanup.

import { randomUUID } from "node:crypto"

import type { QueryResult } from "pg"
import { describe, expect, it } from "vitest"

import { getPool, onCleanup, sql, testName } from "./support/db"

const BEGIN = "select private.idempotent_begin($1, $2, $3, $4::jsonb) as v"
const FINISH = "select private.idempotent_finish($1, $2, $3, $4::jsonb) as v"
const RPC = "test_rpc"

describe("idempotency under concurrency", () => {
  it("the second caller waits for the first commit and gets the stored result", async () => {
    const scope = testName("concurrent")
    const key = randomUUID()
    const request = JSON.stringify({ p_amount: 100 })
    const result = { id: "r1" }
    onCleanup(() =>
      sql("delete from private.idempotency_results where actor_scope = $1", [
        scope,
      ])
    )

    // Both pool connections (max: 2); while B waits only A queries.
    const a = await getPool().connect()
    const b = await getPool().connect()
    let committed = false
    let second: Promise<QueryResult> | undefined
    try {
      await a.query("begin")
      const first = await a.query(BEGIN, [scope, RPC, key, request])
      expect(first.rows[0].v).toBeNull()

      const { rows: pidRows } = await b.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      )
      const bPid = pidRows[0].pid

      second = b.query(BEGIN, [scope, RPC, key, request])
      // Keep a rejection of B from going unhandled while it is not awaited.
      second.catch(() => {})

      // From A (idle in its open transaction): B must be waiting on a lock.
      // The stats snapshot is cached per transaction, so clear it each try.
      let waitsOnLock = false
      for (let tries = 0; tries < 50 && !waitsOnLock; tries++) {
        await a.query("select pg_stat_clear_snapshot()")
        const { rows } = await a.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid = $1",
          [bPid]
        )
        waitsOnLock = rows[0]?.wait_event_type === "Lock"
        if (!waitsOnLock) await new Promise((r) => setTimeout(r, 100))
      }
      expect(waitsOnLock).toBe(true)

      await a.query(FINISH, [scope, RPC, key, JSON.stringify(result)])
      await a.query("commit")
      committed = true

      expect((await second).rows[0].v).toEqual(result)
    } finally {
      // A rollback of A releases B; B must finish before it goes back.
      if (!committed) await a.query("rollback").catch(() => {})
      await second?.catch(() => {})
      a.release()
      b.release()
    }

    const rows = await sql<{ n: number }>(
      "select count(*)::int as n from private.idempotency_results where actor_scope = $1",
      [scope]
    )
    expect(rows[0].n).toBe(1)
  }, 30_000)
})
