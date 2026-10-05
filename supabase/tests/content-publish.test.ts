// Story 5.1: admin_get_content_page, admin_set_content_draft and
// admin_publish_content (AD-5, AD-16, AD-19), along the I/O matrix of the
// spec: publish, draft only, repeat with the same key, nothing changed, not
// an admin, unknown page or key. The home page and its hero section come
// from the migration; each test resets them (inCleanHome) and rolls back.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const GET = "select public.admin_get_content_page($1) as r"
const SET = "select public.admin_set_content_draft($1, $2, $3::jsonb) as r"
const PUBLISH = "select public.admin_publish_content($1, $2) as r"
const PUBLIC_HERO = `select s.published_content
  from public.content_sections s
  where s.page_slug = 'home' and s.key = 'hero'`

const HERO = { title: testName("title"), cta_label: "c" }

async function asAnon(db: Db): Promise<void> {
  await db.query(
    "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
  )
  await db.query("set local role anon")
}

// An admin (no Auth user needed: asAuthenticated sets auth.uid()). As the
// owner on return.
async function seedAdmin(db: Db): Promise<string> {
  const admin = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  return admin
}

async function asAdmin(
  db: Db,
  admin: string,
  query: string,
  params: unknown[]
): Promise<Record<string, unknown>> {
  await asAuthenticated(db, admin)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r
}

async function adminError(
  db: Db,
  userId: string,
  query: string,
  params: unknown[]
) {
  await asAuthenticated(db, userId)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function anonHero(db: Db): Promise<unknown[]> {
  await asAnon(db)
  const { rows } = await db.query(PUBLIC_HERO)
  await db.query("reset role")
  return rows
}

// The hero section of admin_get_content_page('home') (5.2 added more).
function heroOf(page: Record<string, unknown>): unknown[] {
  return (page.sections as { key: string }[]).filter((s) => s.key === "hero")
}

async function homeVersion(db: Db): Promise<number> {
  const { rows } = await db.query(
    "select published_version from public.content_pages where slug = 'home'"
  )
  return rows[0].published_version
}

// The shared dev database may hold a published home page (demo content), so
// every test starts from the migration's state inside its rollback: home not
// published, version 0, the hero section without a draft.
async function inCleanHome(fn: (db: Db) => Promise<void>): Promise<void> {
  await inRollback(async (db) => {
    await db.query(
      `update public.content_pages
       set published_content = null, published_at = null, published_version = 0
       where slug = 'home'`
    )
    await db.query(
      `update public.content_sections
       set draft_content = null, published_content = null, published_at = null
       where page_slug = 'home'`
    )
    await fn(db)
  })
}

describe("content publish", () => {
  it("has the home page with its hero section (migration)", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      const page = await asAdmin(db, admin, GET, ["home"])
      expect(page).toMatchObject({
        slug: "home",
        published_version: 0,
        published_at: null,
      })
      // The hero (5.1), then the intro and contact sections (5.2), in order.
      expect(page.sections).toEqual([
        expect.objectContaining({
          key: "hero",
          kind: "hero",
          sort_order: 1,
          hidden: false,
          draft_content: null,
          published_content: null,
        }),
        expect.objectContaining({
          key: "intro",
          kind: "text_block",
          sort_order: 2,
        }),
        expect.objectContaining({
          key: "contact",
          kind: "text_block",
          sort_order: 5,
        }),
      ])
      expect(await anonHero(db)).toEqual([])
    })
  })

  it("keeps a draft from anon until it is published", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      await asAdmin(db, admin, SET, ["home", "hero", JSON.stringify(HERO)])

      // Draft only: anon sees nothing, the version stays.
      expect(await anonHero(db)).toEqual([])
      expect(await homeVersion(db)).toBe(0)
      const page = await asAdmin(db, admin, GET, ["home"])
      expect(heroOf(page)).toEqual([
        expect.objectContaining({
          draft_content: HERO,
          published_content: null,
        }),
      ])

      const result = await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      expect(result).toMatchObject({ published_version: 1, changed: 1 })
      expect(await anonHero(db)).toEqual([{ published_content: HERO }])

      // Audited: the draft and the publish of the section.
      const { rows } = await db.query(
        `select a.action from public.audit_log a
         join public.content_sections s on s.id = a.entity_id
         where a.entity_type = 'content_sections' and a.actor_id = $1
           and s.page_slug = 'home' and s.key = 'hero'
         order by a.created_at, a.action`,
        [admin]
      )
      expect(rows.map((r) => r.action).sort()).toEqual([
        "admin_publish_content",
        "admin_set_content_draft",
      ])
    })
  })

  it("returns the same result for the same key and raises the version once", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      await asAdmin(db, admin, SET, ["home", "hero", JSON.stringify(HERO)])
      const key = randomUUID()
      const first = await asAdmin(db, admin, PUBLISH, ["home", key])
      // A new draft in between is not published by the repeat.
      await asAdmin(db, admin, SET, [
        "home",
        "hero",
        JSON.stringify({ ...HERO, title: testName("other") }),
      ])
      const again = await asAdmin(db, admin, PUBLISH, ["home", key])
      expect(again).toEqual(first)
      expect(await homeVersion(db)).toBe(1)
      expect(await anonHero(db)).toEqual([{ published_content: HERO }])
    })
  })

  it("changes nothing when there is no new draft", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      // Nothing to publish on an unpublished page: still not published.
      expect(
        await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      ).toMatchObject({ published_version: 0, changed: 0 })
      expect(await anonHero(db)).toEqual([])

      await asAdmin(db, admin, SET, ["home", "hero", JSON.stringify(HERO)])
      await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      expect(
        await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      ).toMatchObject({ published_version: 1, changed: 0 })

      // An empty draft is not published either.
      await asAdmin(db, admin, SET, ["home", "hero", "{}"])
      expect(
        await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      ).toMatchObject({ published_version: 1, changed: 0 })
      expect(await anonHero(db)).toEqual([{ published_content: HERO }])
    })
  })

  it("keeps the published page {} when it had no content", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      await asAdmin(db, admin, SET, ["home", "hero", JSON.stringify(HERO)])
      await asAdmin(db, admin, PUBLISH, ["home", randomUUID()])
      const { rows } = await db.query(
        "select published_content, published_at is not null as published from public.content_pages where slug = 'home'"
      )
      expect(rows).toEqual([{ published_content: {}, published: true }])
    })
  })

  it("refuses a draft that is not an object", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      for (const content of ["[]", '"x"', "1", "null"]) {
        const error = await adminError(db, admin, SET, [
          "home",
          "hero",
          content,
        ])
        expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      const page = await asAdmin(db, admin, GET, ["home"])
      expect(heroOf(page)).toEqual([
        expect.objectContaining({ draft_content: null }),
      ])
    })
  })

  it.each([
    ["an unknown page", GET, ["nope"]],
    ["an unknown page (draft)", SET, ["nope", "hero", "{}"]],
    ["an unknown key", SET, ["home", "nope", "{}"]],
    ["an unknown page (publish)", PUBLISH, ["nope", randomUUID()]],
  ])("is NOT_FOUND for %s", async (_label, query, params) => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      expect(await adminError(db, admin, query, params)).toMatchObject({
        code: "P0001",
        message: "NOT_FOUND",
      })
    })
  })

  it.each([
    ["read", GET, ["home"]],
    ["draft", SET, ["home", "hero", JSON.stringify(HERO)]],
    ["publish", PUBLISH, ["home", randomUUID()]],
  ])("refuses a customer and anon (%s)", async (_label, query, params) => {
    await inCleanHome(async (db) => {
      const customer = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [customer, testName("customer")]
      )
      expect(await adminError(db, customer, query, params)).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })

      await asAnon(db)
      expect((await queryError(db, query, params))?.code).toBe("42501")
      await db.query("reset role")
      expect(await homeVersion(db)).toBe(0)
    })
  })

  it("never shows a draft column to anon or a customer", async () => {
    await inCleanHome(async (db) => {
      const admin = await seedAdmin(db)
      await asAdmin(db, admin, SET, ["home", "hero", JSON.stringify(HERO)])
      await asAuthenticated(db, randomUUID())
      expect(
        (
          await queryError(
            db,
            "select draft_content from public.content_sections"
          )
        )?.code
      ).toBe("42501")
      await db.query("reset role")
      await asAnon(db)
      expect(
        (
          await queryError(
            db,
            "select draft_content from public.content_sections"
          )
        )?.code
      ).toBe("42501")
    })
  })
})
