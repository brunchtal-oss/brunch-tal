// Story 2.16: the special-brunch interest (profiles.special_brunch_interests,
// codes couples / grandma / grandpa). One test per row of the spec's I/O
// matrix that the database decides: join_complete stores the picks in code
// order (none = {}), refuses a bad value with INVALID_INPUT
// special_brunch_interests; the customer changes only her own row (column
// grant + RLS) and the check refuses unknown or repeated codes;
// admin_list_customers and admin_export_customers filter by p_interest (AND
// with the category), the export has the new column and the audit keeps
// interest; admin_anonymize_customer clears it; admin_get_customer returns
// it; the content block is seeded published. Plus: through PostgREST, the
// calls with an explicit p_interest resolve to one function while the old
// overloads still exist (no PGRST203). Everything but the PostgREST check
// runs in inRollback; the dev database may hold other rows, so every check
// looks only at this test's ids.

import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const LIST = "select public.admin_list_customers($1, $2, $3) as r"
const EXPORT = "select public.admin_export_customers($1, $2, $3, $4, $5) as r"
const GET = "select public.admin_get_customer($1) as r"
const REMOVE = "select public.admin_anonymize_customer($1, $2, $3) as r"

// Like queryError, with the exception's DETAIL parsed (the field).
async function raised(
  db: Db,
  text: string,
  params: unknown[] = []
): Promise<{ code: string; message: string; detail: unknown } | null> {
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

async function asAdmin<T>(
  db: Db,
  f: MoneyFixture,
  run: () => Promise<T>
): Promise<T> {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function interestsOf(db: Db, id: string): Promise<string[]> {
  const { rows } = await db.query(
    "select special_brunch_interests as v from public.profiles where id = $1",
    [id]
  )
  return rows[0].v
}

// As the owner: an activated customer created `monthsAgo` months back, with
// her special brunches.
async function insertCustomer(
  db: Db,
  label: string,
  interests: string[],
  monthsAgo = 0
): Promise<string> {
  const id = randomUUID()
  await db.query(
    `insert into public.profiles (
       id, full_name, activated_at, created_at, special_brunch_interests)
     values ($1, $2, now(), now() - make_interval(months => $3::int), $4)`,
    [id, testName(label), monthsAgo, interests]
  )
  return id
}

// ---------------------------------------------------------------------------
// join_complete
// ---------------------------------------------------------------------------

type Approved = { f: MoneyFixture; token: string }

async function approveCard(db: Db): Promise<Approved> {
  const f = await seedMoney(db)
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
  })
  await db.query("reset role")
  return { f, token: r.token as string }
}

let phoneCounter = 0
function testPhone(): string {
  phoneCounter++
  const digits = (parseInt(testName("").slice(5, 11), 16) + phoneCounter)
    .toString()
    .padStart(7, "0")
    .slice(-7)
  return `057${digits}`
}

// begin -> Auth user -> complete, as the service role (the TS orchestrator).
// extra: keys merged into p_profile (undefined drops special_brunch_interests).
async function join(
  db: Db,
  a: Approved,
  extra: Record<string, unknown>
): Promise<{ userId: string; error: unknown }> {
  const phone = testPhone()
  // The Auth user's email is this one (join_complete compares them).
  const label = `sbi_${phoneCounter}`
  const email = `${testName(label)}@example.test`.toLowerCase()
  const key = randomUUID()
  await asServiceRole(db)
  const { rows } = await db.query(BEGIN, [a.token, email, phone, key])
  await db.query("reset role")
  const userId = rows[0].r.pending_user_id as string
  await insertAuthUser(db, label, { id: userId })
  const profile = {
    email,
    phone,
    full_name: testName("sbi_joiner"),
    dietary_notes: null,
    privacy_consent: true,
    photo_consent: false,
    personal_photo_consent: false,
    babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
    ...extra,
  }
  await asServiceRole(db)
  const error = await raised(db, COMPLETE, [
    a.token,
    JSON.stringify(profile),
    key,
  ])
  await db.query("reset role")
  return { userId, error }
}

describe("join_complete: special_brunch_interests", () => {
  it("two picks: stored in code order (matrix: join, two picks)", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId, error } = await join(db, a, {
        special_brunch_interests: ["grandpa", "couples"],
      })
      expect(error).toBeNull()
      expect(await interestsOf(db, userId)).toEqual(["couples", "grandpa"])
    })
  })

  it.each([
    ["missing", {}],
    ["null", { special_brunch_interests: null }],
    ["empty", { special_brunch_interests: [] }],
  ])(
    "%s: stored {} and the account is created (matrix: join, none)",
    async (_label, extra) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        const { userId, error } = await join(db, a, extra)
        expect(error).toBeNull()
        expect(await interestsOf(db, userId)).toEqual([])
      })
    }
  )

  it.each([
    ["an unknown code", ["aunt"]],
    ["a repeated code", ["couples", "couples"]],
    ["a string, not an array", "couples"],
    ["a number inside", [1]],
    ["an object", { couples: true }],
  ])(
    "%s: INVALID_INPUT on the field, no account (matrix: join, bad value)",
    async (_label, value) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        const { userId, error } = await join(db, a, {
          special_brunch_interests: value,
        })
        expect(error).toEqual({
          code: "P0001",
          message: "INVALID_INPUT",
          detail: { field: "special_brunch_interests" },
        })
        const { rows } = await db.query(
          "select 1 from public.profiles where id = $1",
          [userId]
        )
        expect(rows).toEqual([])
      })
    }
  )
})

// ---------------------------------------------------------------------------
// The customer's own update and the column check
// ---------------------------------------------------------------------------

describe("profiles.special_brunch_interests: self-update and check", () => {
  it("she changes her own answer, the other details stay (matrix: profile change)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await db.query(
        "update public.profiles set dietary_notes = 'vegan' where id = $1",
        [f.customerA]
      )
      expect(await interestsOf(db, f.customerA)).toEqual([])
      await asAuthenticated(db, f.customerA)
      const { rowCount } = await db.query(
        "update public.profiles set special_brunch_interests = '{couples}' where id = $1",
        [f.customerA]
      )
      await db.query("reset role")
      expect(rowCount).toBe(1)
      const { rows } = await db.query(
        "select special_brunch_interests, dietary_notes, full_name from public.profiles where id = $1",
        [f.customerA]
      )
      expect(rows[0]).toEqual({
        special_brunch_interests: ["couples"],
        dietary_notes: "vegan",
        full_name: testName("money_a"),
      })
    })
  })

  it("another customer's row: 0 rows (matrix: direct write, other row)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.customerA)
      const { rowCount } = await db.query(
        "update public.profiles set special_brunch_interests = '{grandma}' where id = $1",
        [f.customerB]
      )
      await db.query("reset role")
      expect(rowCount).toBe(0)
      expect(await interestsOf(db, f.customerB)).toEqual([])
    })
  })

  it.each([["{aunt}"], ["{couples,couples}"], ["{couples,grandma,couples}"]])(
    "%s is refused by the check (matrix: direct write, bad value)",
    async (value) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        await asAuthenticated(db, f.customerA)
        expect(
          await queryError(
            db,
            "update public.profiles set special_brunch_interests = $1::text[] where id = $2",
            [value, f.customerA]
          )
        ).toMatchObject({ code: "23514" })
      })
    }
  )

  it("existing customers have {} (not answered)", async () => {
    const rows = await sql<{ n: number }>(
      "select count(*)::int as n from public.profiles where special_brunch_interests is null"
    )
    expect(rows[0].n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The admin's list, export, card and removal
// ---------------------------------------------------------------------------

type ListRow = { id: string }

describe("admin_list_customers: p_interest", () => {
  it("AND with the category (matrix: list filter)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await db.query(
        "update public.business_settings set inactivity_months = 3"
      )
      const oldGrandma = await insertCustomer(db, "old_g", ["grandma"], 12)
      const oldCouples = await insertCustomer(db, "old_c", ["couples"], 12)
      const newGrandma = await insertCustomer(db, "new_g", [
        "couples",
        "grandma",
      ])
      const { rows: activity } = await db.query(
        "select private.customer_activity($1) as a, private.customer_activity($2) as b",
        [oldGrandma, newGrandma]
      )
      expect(activity[0]).toEqual({ a: "inactive", b: "active" })

      const ids = async (activityName: string, interest: string | null) =>
        asAdmin(db, f, async () =>
          (
            (await db.query(LIST, ["", activityName, interest])).rows[0].r
              .customers as ListRow[]
          )
            .map((c) => c.id)
            .filter((id) => [oldGrandma, oldCouples, newGrandma].includes(id))
            .sort()
        )

      expect(await ids("inactive", "grandma")).toEqual([oldGrandma])
      expect(await ids("all", "grandma")).toEqual(
        [oldGrandma, newGrandma].sort()
      )
      expect(await ids("all", "grandpa")).toEqual([])
      expect(await ids("all", null)).toEqual(
        [oldGrandma, oldCouples, newGrandma].sort()
      )
    })
  })

  it("AND with the search", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const match = await insertCustomer(db, "sbi_search_x", ["grandpa"])
      await insertCustomer(db, "sbi_search_y", [])
      const result = await asAdmin(
        db,
        f,
        async () =>
          (await db.query(LIST, [testName("sbi_search"), "all", "grandpa"]))
            .rows[0].r
      )
      expect(result.customers.map((c: ListRow) => c.id)).toEqual([match])
    })
  })

  it.each([["aunt"], [""], ["COUPLES"]])(
    "%j -> INVALID_INPUT interest",
    async (interest) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        await asAuthenticated(db, f.admin)
        expect(await raised(db, LIST, ["", "all", interest])).toEqual({
          code: "P0001",
          message: "INVALID_INPUT",
          detail: { field: "interest" },
        })
      })
    }
  )
})

describe("admin_export_customers: p_interest and the column", () => {
  it("only interested customers, the codes in the column, interest in the audit (matrix: export)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await insertCustomer(db, "exp_both", ["grandpa", "couples"])
      await insertCustomer(db, "exp_none", [])
      await insertCustomer(db, "exp_grandma", ["grandma"])

      const exported = await asAdmin(
        db,
        f,
        async () =>
          (
            await db.query(EXPORT, [
              "all",
              null,
              ["full_name", "special_brunch_interests"],
              "all",
              "couples",
            ])
          ).rows[0].r.rows
      )
      const mine = exported.filter((r: { full_name: string }) =>
        r.full_name.startsWith(testName("exp_"))
      )
      // The stored codes as they are (the check does not force their
      // order; the app orders the labels).
      expect(mine).toEqual([
        {
          full_name: testName("exp_both"),
          phone_e164: null,
          email: null,
          special_brunch_interests: ["grandpa", "couples"],
        },
      ])

      const { rows: logs } = await db.query(
        `select after from public.audit_log
         where actor_id = $1 and action = 'admin_export_customers'`,
        [f.admin]
      )
      expect(logs).toEqual([
        {
          after: {
            scope: "all",
            columns: ["full_name", "special_brunch_interests"],
            activity: "all",
            interest: "couples",
            row_count: expect.any(Number),
          },
        },
      ])
    })
  })

  it("the column is null when not chosen", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await insertCustomer(db, "exp_off", ["grandma"])
      const exported = await asAdmin(
        db,
        f,
        async () =>
          (
            await db.query(EXPORT, [
              "search",
              testName("exp_off"),
              ["full_name"],
              "all",
              null,
            ])
          ).rows[0].r.rows
      )
      expect(exported).toEqual([
        {
          full_name: testName("exp_off"),
          phone_e164: null,
          email: null,
          special_brunch_interests: null,
        },
      ])
    })
  })

  it("an unknown interest -> INVALID_INPUT interest, no log row", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      expect(
        await raised(db, EXPORT, ["all", null, ["full_name"], "all", "aunt"])
      ).toEqual({
        code: "P0001",
        message: "INVALID_INPUT",
        detail: { field: "interest" },
      })
      await db.query("reset role")
      const { rows } = await db.query(
        `select 1 from public.audit_log
         where actor_id = $1 and action = 'admin_export_customers'`,
        [f.admin]
      )
      expect(rows).toEqual([])
    })
  })
})

describe("the customer card and the removal", () => {
  it("admin_get_customer returns the codes; {} when none (matrix: card key)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const picked = await insertCustomer(db, "card_p", ["grandma"])
      const card = async (id: string) =>
        asAdmin(
          db,
          f,
          async () => (await db.query(GET, [id])).rows[0].r.profile
        )
      expect((await card(picked)).special_brunch_interests).toEqual(["grandma"])
      expect((await card(f.customerA)).special_brunch_interests).toEqual([])
    })
  })

  it("admin_anonymize_customer clears the answers (matrix: anonymize)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const user = await insertAuthUser(db, "sbi_removal")
      await db.query(
        `insert into public.profiles (
           id, full_name, activated_at, special_brunch_interests)
         values ($1, $2, now(), '{couples,grandpa}')`,
        [user.id, testName("sbi_removal")]
      )
      await asAdmin(db, f, () =>
        db.query(REMOVE, [user.id, true, randomUUID()])
      )
      expect(await interestsOf(db, user.id)).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// The content block
// ---------------------------------------------------------------------------

describe("join-form › special_brunch", () => {
  it("is seeded published, kind special_brunch, with a public copy", async () => {
    const rows = await sql(
      `select kind, published_at is not null as published,
              draft_content is not null as has_draft,
              published_content is not null as has_public
       from public.content_sections
       where page_slug = 'join-form' and key = 'special_brunch'`
    )
    expect(rows).toEqual([
      {
        kind: "special_brunch",
        published: true,
        has_draft: true,
        has_public: true,
      },
    ])
  })

  it("has the fallback's fields", async () => {
    // Only the keys: Tal may have edited the text in dev.
    const rows = await sql<{ keys: string[] }>(
      `select array(select jsonb_object_keys(published_content_full) order by 1) as keys
       from public.content_sections
       where page_slug = 'join-form' and key = 'special_brunch'`
    )
    expect(rows[0].keys).toEqual(Object.keys(SPECIAL_BRUNCH_FALLBACK).sort())
  })
})

// ---------------------------------------------------------------------------
// PostgREST: an explicit p_interest picks one overload
// ---------------------------------------------------------------------------

// Until 20261109224659_special_brunch_interest_drop_old.sql runs, both the
// old and the new overloads exist. callRpc always sends p_interest (null =
// no filter), so PostgREST matches only the new one: anon gets the
// permission error of that one function (42501), never PGRST203 (more than
// one candidate). After the drop the same holds.
describe("PostgREST resolves the new list and export", () => {
  it("with an explicit p_interest, never PGRST203", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !publishable) {
      throw new Error("Supabase keys are missing in .env.local")
    }
    const anon = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const list = await anon.rpc("admin_list_customers", {
      p_query: "",
      p_activity: "all",
      p_interest: null as unknown as string,
    })
    expect(list.error?.code).toBe("42501")
    const exported = await anon.rpc("admin_export_customers", {
      p_scope: "all",
      p_query: "",
      p_columns: ["full_name"],
      p_activity: "all",
      p_interest: null as unknown as string,
    })
    expect(exported.error?.code).toBe("42501")
  })
})
