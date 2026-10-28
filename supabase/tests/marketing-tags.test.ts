// Story 5.24: the marketing tags. public.marketing_tags (one row, its
// checks, the anon column grant) and admin_update_marketing_tags (save,
// clear, normalize, formats, STALE_VERSION, idempotent retry, audit,
// non-admin). Everything runs in inRollback against the real row, so each
// test reads the version it starts from.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  type Db,
} from "./support/db"
import { seedMoney } from "./support/money"

const NBSP = String.fromCharCode(160)
const UPDATE =
  "select public.admin_update_marketing_tags($1, $2, $3, $4, $5) as r"

type Tags = {
  ga4_measurement_id: string | null
  gtm_container_id: string | null
  meta_pixel_id: string | null
  version: number
}

async function current(db: Db): Promise<Tags> {
  const { rows } = await db.query<Tags>(
    "select ga4_measurement_id, gtm_container_id, meta_pixel_id, version from public.marketing_tags"
  )
  return rows[0]
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// Like queryError, with the exception's DETAIL (the refused field).
async function rpcError(
  db: Db,
  params: unknown[]
): Promise<{ code: string; message: string; detail?: string } | null> {
  await db.query("savepoint rpc_error")
  try {
    await db.query(UPDATE, params)
    await db.query("release savepoint rpc_error")
    return null
  } catch (error) {
    await db.query("rollback to savepoint rpc_error")
    const { code, message, detail } = error as {
      code?: string
      message?: string
      detail?: string
    }
    return { code: code ?? "", message: message ?? "", detail }
  }
}

async function auditRows(db: Db, admin: string) {
  const { rows } = await db.query(
    `select entity_type, entity_id, before, after from public.audit_log
     where action = 'admin_update_marketing_tags' and actor_id = $1
     order by created_at, id`,
    [admin]
  )
  return rows
}

describe("public.marketing_tags", () => {
  it("has exactly one row", async () => {
    const rows = await sql("select id from public.marketing_tags")
    expect(rows).toEqual([{ id: true }])
  })

  it("cannot have a second row", async () => {
    await inRollback(async (db) => {
      expect(
        (
          await queryError(
            db,
            "insert into public.marketing_tags default values"
          )
        )?.code
      ).toBe("23505")
      expect(
        (
          await queryError(
            db,
            "insert into public.marketing_tags (id) values (false)"
          )
        )?.code
      ).toBe("23514")
    })
  })

  it.each([
    ["ga4_measurement_id", "g-ab12cd34ef"],
    ["ga4_measurement_id", "<script>"],
    ["gtm_container_id", "GTM-12 34"],
    ["meta_pixel_id", "12345"],
  ])("the table refuses %s = %s", async (column, value) => {
    await inRollback(async (db) => {
      expect(
        (
          await queryError(
            db,
            `update public.marketing_tags set ${column} = $1`,
            [value]
          )
        )?.code
      ).toBe("23514")
    })
  })

  it("anon reads the three IDs only; nobody but the RPC writes", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      const { rows } = await db.query(
        "select ga4_measurement_id, gtm_container_id, meta_pixel_id from public.marketing_tags"
      )
      expect(rows).toHaveLength(1)
      expect(
        await queryError(db, "select version from public.marketing_tags")
      ).toMatchObject({ code: "42501" })
      expect(
        await queryError(
          db,
          "update public.marketing_tags set meta_pixel_id = null"
        )
      ).toMatchObject({ code: "42501" })
      expect(
        await queryError(
          db,
          "select public.admin_update_marketing_tags(null, null, null, 1, gen_random_uuid())"
        )
      ).toMatchObject({ code: "42501" })
    })
  })
})

describe("direct writes", () => {
  it.each(["customerA", "admin"] as const)(
    "a signed-in %s cannot insert, update or delete",
    async (who) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        await as(db, f[who], async () => {
          for (const text of [
            "insert into public.marketing_tags (id) values (true)",
            "update public.marketing_tags set meta_pixel_id = null",
            "delete from public.marketing_tags",
          ]) {
            expect(await queryError(db, text), text).toMatchObject({
              code: "42501",
            })
          }
        })
      })
    }
  )
})

describe("admin_update_marketing_tags", () => {
  it("saves normalized IDs, a new version and one audit row; the same values change nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const before = await current(db)
      const { rows } = await as(db, f.admin, () =>
        db.query(UPDATE, [
          " g-ab12cd34ef ",
          `${NBSP}gtm-ab12cd3${NBSP}`,
          " 123456789012345 ",
          before.version,
          randomUUID(),
        ])
      )
      const saved = {
        ga4_measurement_id: "G-AB12CD34EF",
        gtm_container_id: "GTM-AB12CD3",
        meta_pixel_id: "123456789012345",
        version: before.version + 1,
      }
      expect(rows[0].r).toEqual(saved)
      expect(await current(db)).toEqual(saved)

      const audit = await auditRows(db, f.admin)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        entity_type: "marketing_tags",
        entity_id: null,
        after: {
          ga4_measurement_id: "G-AB12CD34EF",
          gtm_container_id: "GTM-AB12CD3",
          meta_pixel_id: "123456789012345",
        },
      })
      expect(audit[0].after).not.toHaveProperty("version")
      expect(audit[0].before).toMatchObject({
        ga4_measurement_id: before.ga4_measurement_id,
      })

      // The same values again (another key): no new version, no audit.
      const { rows: again } = await as(db, f.admin, () =>
        db.query(UPDATE, [
          "G-AB12CD34EF",
          "GTM-AB12CD3",
          "123456789012345",
          saved.version,
          randomUUID(),
        ])
      )
      expect(again[0].r).toEqual(saved)
      expect(await auditRows(db, f.admin)).toHaveLength(1)
    })
  })

  it("blank clears a tool (null = off)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const v = (await current(db)).version
      await as(db, f.admin, () =>
        db.query(UPDATE, [
          "G-AB12CD34EF",
          "GTM-AB12CD3",
          "123456789012345",
          v,
          randomUUID(),
        ])
      )
      const { rows } = await as(db, f.admin, () =>
        db.query(UPDATE, ["", "  ", null, v + 1, randomUUID()])
      )
      expect(rows[0].r).toEqual({
        ga4_measurement_id: null,
        gtm_container_id: null,
        meta_pixel_id: null,
        version: v + 2,
      })
    })
  })

  it.each([
    ["ga4_measurement_id", ["<script>", null, null]],
    ["ga4_measurement_id", ["G-ab 12", null, null]],
    ["gtm_container_id", [null, "GTM-12 34", null]],
    ["gtm_container_id", [null, "G-AB12CD34EF", null]],
    ["meta_pixel_id", [null, null, "12345"]],
    ["meta_pixel_id", [null, null, "12345678901a"]],
  ])(
    "refuses a bad %s (%j): INVALID_INPUT, nothing saved",
    async (field, ids) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        const before = await current(db)
        const error = await as(db, f.admin, () =>
          rpcError(db, [...ids, before.version, randomUUID()])
        )
        expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
        expect(JSON.parse(error?.detail ?? "{}")).toEqual({ field })
        expect(await current(db)).toEqual(before)
        expect(await auditRows(db, f.admin)).toHaveLength(0)
      })
    }
  )

  it("an old version: STALE_VERSION, nothing saved", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const v = (await current(db)).version
      await as(db, f.admin, () =>
        db.query(UPDATE, ["G-AB12CD34EF", null, null, v, randomUUID()])
      )
      const error = await as(db, f.admin, () =>
        rpcError(db, [null, "GTM-AB12CD3", null, v, randomUUID()])
      )
      expect(error).toMatchObject({ code: "P0001", message: "STALE_VERSION" })
      expect(await current(db)).toMatchObject({
        ga4_measurement_id: "G-AB12CD34EF",
        gtm_container_id: null,
        version: v + 1,
      })
    })
  })

  it("a retry with the same key returns the first answer and changes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const v = (await current(db)).version
      const key = randomUUID()
      const params = ["G-AB12CD34EF", null, null, v, key]
      const first = await as(db, f.admin, () => db.query(UPDATE, params))
      const second = await as(db, f.admin, () => db.query(UPDATE, params))
      expect(second.rows[0].r).toEqual(first.rows[0].r)
      expect((await current(db)).version).toBe(v + 1)
      expect(await auditRows(db, f.admin)).toHaveLength(1)
    })
  })

  it("a customer: NOT_AUTHORIZED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const before = await current(db)
      const error = await as(db, f.customerA, () =>
        rpcError(db, ["G-AB12CD34EF", null, null, before.version, randomUUID()])
      )
      expect(error).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(await current(db)).toEqual(before)
    })
  })
})
