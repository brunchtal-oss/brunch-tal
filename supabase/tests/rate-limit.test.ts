// Story 2.8: public.rate_limit_hit, the one limiter of the login and the
// token actions. Fixed 15-minute window, every attempt counts; login: 20 per
// IP and 8 per account, token: 20 per IP and 10 per token. Keys are stored
// only as sha256. Everything runs in inRollback with keys of this run.

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const HIT = "select public.rate_limit_hit($1, $2) as r"

async function hit(db: Db, bucket: string, keys: string[]): Promise<boolean> {
  const { rows } = await db.query(HIT, [bucket, keys])
  return rows[0].r.allowed
}

async function hitTimes(
  db: Db,
  times: number,
  bucket: string,
  keys: string[]
): Promise<boolean[]> {
  const out: boolean[] = []
  for (let i = 0; i < times; i++) out.push(await hit(db, bucket, keys))
  return out
}

const ip = (label: string) => `ip:${testName(label)}`
const id = (label: string) => `id:${testName(label)}`

describe("rate_limit_hit", () => {
  it("login: the 9th attempt for one account is refused, from any IP", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const account = id("login_account")
      const results: boolean[] = []
      for (let i = 0; i < 9; i++) {
        results.push(await hit(db, "login", [ip(`ip_${i}`), account]))
      }
      expect(results.slice(0, 8)).toEqual(Array(8).fill(true))
      expect(results[8]).toBe(false)
    })
  })

  it("login: the 21st attempt from one IP is refused, for any account", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const address = ip("login_ip")
      const results: boolean[] = []
      for (let i = 0; i < 21; i++) {
        results.push(await hit(db, "login", [address, id(`account_${i}`)]))
      }
      expect(results.slice(0, 20)).toEqual(Array(20).fill(true))
      expect(results[20]).toBe(false)
    })
  })

  it("token: the 11th attempt for one token is refused; the buckets are separate", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const keys = [ip("token_ip"), id("token")]
      const results = await hitTimes(db, 11, "token", keys)
      expect(results.slice(0, 10)).toEqual(Array(10).fill(true))
      expect(results[10]).toBe(false)
      // The same keys in the login bucket start from zero.
      expect(await hit(db, "login", keys)).toBe(true)
    })
  })

  it("stays blocked while the window lasts and counts refused attempts too", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const keys = [ip("blocked_ip"), id("blocked")]
      await hitTimes(db, 8, "login", keys)
      expect(await hitTimes(db, 3, "login", keys)).toEqual([
        false,
        false,
        false,
      ])
      await db.query("reset role")
      const { rows } = await db.query(
        `select max(hits)::int as hits from private.rate_limits
         where key_hash = encode(extensions.digest($1, 'sha256'), 'hex')`,
        [keys[1]]
      )
      expect(rows[0].hits).toBe(11)
    })
  })

  it("a new window starts from zero; windows older than a day are removed", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const keys = [ip("window_ip"), id("window")]
      await hitTimes(db, 9, "login", keys)
      expect(await hit(db, "login", keys)).toBe(false)

      // Move this run's rows two days back: the window has ended.
      await db.query("reset role")
      await db.query(
        `update private.rate_limits
         set window_start = window_start - interval '2 days'
         where key_hash in (
           select encode(extensions.digest(k, 'sha256'), 'hex') from unnest($1::text[]) k
         )`,
        [keys]
      )
      await asServiceRole(db)
      expect(await hit(db, "login", keys)).toBe(true)

      await db.query("reset role")
      const { rows } = await db.query(
        `select count(*)::int as n from private.rate_limits
         where window_start < now() - interval '1 day'
           and key_hash in (
             select encode(extensions.digest(k, 'sha256'), 'hex') from unnest($1::text[]) k
           )`,
        [keys]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("stores only the hash of a key", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      const keys = [ip("stored_ip"), id("stored@example.test")]
      await hit(db, "login", keys)
      await db.query("reset role")
      const { rows } = await db.query(
        "select row_to_json(r)::text as raw from private.rate_limits r"
      )
      const raw = rows.map((r) => r.raw).join("\n")
      expect(raw).not.toContain(testName("stored"))
    })
  })

  it("refuses bad input", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      for (const [bucket, keys] of [
        ["other", [ip("x")]],
        ["login", []],
        ["login", ["email:someone"]],
        ["login", ["id:"]],
        ["login", [ip("a"), ip("b"), ip("c"), ip("d"), ip("e")]],
      ] as const) {
        expect(await queryError(db, HIT, [bucket, keys])).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
    })
  })

  it("is for the service role only", async () => {
    await inRollback(async (db) => {
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values (gen_random_uuid(), $1, now())",
        [testName("rl_customer")]
      )
      const { rows } = await db.query(
        "select id from public.profiles where full_name = $1",
        [testName("rl_customer")]
      )
      await asAuthenticated(db, rows[0].id)
      expect(await queryError(db, HIT, ["login", [ip("x")]])).toMatchObject({
        code: "42501",
      })
      await db.query("reset role")
      await db.query("set local role anon")
      expect(await queryError(db, HIT, ["login", [ip("x")]])).toMatchObject({
        code: "42501",
      })
    })
  })
})
