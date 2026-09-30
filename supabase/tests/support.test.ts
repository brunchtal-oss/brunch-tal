// The database test support itself: rollback isolation and acting as a
// signed-in user.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  inRollback,
  onCleanup,
  runId,
  sql,
  testName,
} from "./support/db"

describe("test support", () => {
  it("names fictitious data with the run prefix", () => {
    expect(runId).toMatch(/^test_[0-9a-f]{12}$/)
    expect(testName("alice")).toBe(`${runId}_alice`)
  })

  it("inRollback leaves no change behind", async () => {
    const name = testName("rollback")
    // Safety net: if the rollback ever failed, the row is still removed.
    onCleanup(() =>
      sql("delete from public.profiles where full_name = $1", [name])
    )

    const inside = await inRollback(async (db) => {
      await db.query(
        "insert into public.profiles (id, full_name) values ($1, $2)",
        [randomUUID(), name]
      )
      const { rows } = await db.query(
        "select count(*)::int as n from public.profiles where full_name = $1",
        [name]
      )
      return rows[0].n as number
    })

    expect(inside).toBe(1)
    const after = await sql<{ n: number }>(
      "select count(*)::int as n from public.profiles where full_name = $1",
      [name]
    )
    expect(after[0].n).toBe(0)
  })

  it("asAuthenticated makes auth.uid() return the user id", async () => {
    const userId = randomUUID()
    const result = await inRollback(async (db) => {
      await asAuthenticated(db, userId)
      const { rows } = await db.query(
        "select auth.uid()::text as uid, current_user as role"
      )
      return rows[0]
    })
    expect(result).toEqual({ uid: userId, role: "authenticated" })
  })

  it("asAuthenticated does not outlive the transaction", async () => {
    // One client throughout, so the check runs on the same connection.
    const client = await getPool().connect()
    try {
      await client.query("begin")
      await asAuthenticated(client, randomUUID())
      await client.query("rollback")
      const { rows } = await client.query<{ role: string; uid: string | null }>(
        "select current_user as role, auth.uid()::text as uid"
      )
      expect(rows[0].role).not.toBe("authenticated")
      expect(rows[0].uid).toBeNull()
    } finally {
      client.release()
    }
  })

  it("asAuthenticated refuses to run outside a transaction", async () => {
    const client = await getPool().connect()
    try {
      await expect(asAuthenticated(client, randomUUID())).rejects.toThrow(
        /inside an open transaction/
      )
    } finally {
      client.release()
    }
  })

  it("sets the session statement_timeout", async () => {
    const timeout = await inRollback(async (db) => {
      const { rows } = await db.query<{ statement_timeout: string }>(
        "show statement_timeout"
      )
      return rows[0].statement_timeout
    })
    expect(timeout).toBe("15s")
  })
})
