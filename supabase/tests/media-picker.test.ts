// fix-media-picker: choose an already uploaded image (admin_list_media,
// admin_copy_media), along the I/O matrix of the spec. Every case runs inside
// a rollback, with storage.objects rows standing in for files (the RPCs and
// the storage policy read only the rows). The dev database may hold other
// images in use, so the list is checked for the test's own ids only.

import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const CREATE = "select public.admin_create_media($1) as r"
const BEGIN = "select public.admin_begin_media_publish($1, $2, $3, $4) as r"
const FINISH = "select public.admin_finish_media_publish($1) as r"
const SET_IMAGE = "select public.admin_set_event_image($1, $2) as r"
const SET_DRAFT =
  "select public.admin_set_content_draft($1, $2, $3::jsonb) as r"
const PUBLISH = "select public.admin_publish_content($1, $2) as r"
const LIST = "select public.admin_list_media() as r"
const COPY = "select public.admin_copy_media($1, $2) as r"

vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>
type Listed = {
  id: string
  created_at: string
  public_path: string | null
  alt_text: string | null
  focus_x: number
  focus_y: number
}
type Copied = { media_id: string; storage_path: string; source_path: string }

async function seedAdmin(db: Db): Promise<string> {
  const admin = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  return admin
}

async function as<T = Row>(
  db: Db,
  userId: string,
  query: string,
  params: unknown[]
): Promise<T> {
  await asAuthenticated(db, userId)
  try {
    const { rows } = await db.query(query, params)
    return rows[0].r as T
  } finally {
    await db.query("reset role")
  }
}

async function errorAs(
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

async function asAnon(db: Db): Promise<void> {
  await db.query(
    "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
  )
  await db.query("set local role anon")
}

async function putObject(db: Db, bucket: string, name: string) {
  await db.query(
    "insert into storage.objects (bucket_id, name) values ($1, $2)",
    [bucket, name]
  )
}

async function mediaRow(db: Db, id: string): Promise<Row> {
  const { rows } = await db.query(
    "select * from public.media_assets where id = $1",
    [id]
  )
  return rows[0]
}

async function uploadedMedia(db: Db, admin: string): Promise<string> {
  const created = await as<{ media_id: string }>(db, admin, CREATE, [
    randomUUID(),
  ])
  await putObject(db, "media-drafts", created.media_id)
  return created.media_id
}

// Begin, the copy (a row standing in for the file) and finish.
async function publish(
  db: Db,
  admin: string,
  id: string,
  alt: string,
  focusX = 50,
  focusY = 50
) {
  await as(db, admin, BEGIN, [id, alt, focusX, focusY])
  await putObject(db, "media-public", `${id}.jpg`)
  await as(db, admin, FINISH, [id])
}

async function publishedMedia(
  db: Db,
  admin: string,
  alt = testName("alt")
): Promise<string> {
  const id = await uploadedMedia(db, admin)
  await publish(db, admin, id, alt)
  return id
}

// A copy as the admin, with its draft file (the action's storage copy).
async function copied(db: Db, admin: string, source: string): Promise<string> {
  const result = await as<Copied>(db, admin, COPY, [source, randomUUID()])
  await putObject(db, "media-drafts", result.media_id)
  return result.media_id
}

async function seedEvent(db: Db, imageId: string | null = null) {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status, image_id)
     select c.id, 'regular', now() + interval '10 days',
       now() + interval '10 days 2 hours', 10, now() + interval '9 days',
       'published', $1
     from public.concepts c order by c.sort_order limit 1
     returning id`,
    [imageId]
  )
  return rows[0].id as string
}

async function cleanGallery(db: Db) {
  await db.query(
    `update public.content_sections
     set draft_content = null, published_content = null, published_at = null
     where page_slug = 'gallery'`
  )
}

function galleryWith(...ids: string[]) {
  return JSON.stringify({
    title: testName("gallery"),
    items: ids.map((id) => ({
      image: { media_id: id, focus_x: 50, focus_y: 50 },
    })),
  })
}

async function listed(db: Db, admin: string): Promise<Listed[]> {
  return as<Listed[]>(db, admin, LIST, [])
}

describe("admin_list_media", () => {
  it("lists only families in use, by their original, newest first", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const inGallery = await publishedMedia(db, admin)
      const forSession = await publishedMedia(db, admin)
      const forConcept = await publishedMedia(db, admin)
      // Uploaded but never used, and a row whose upload never finished.
      const unused = await uploadedMedia(db, admin)
      const notUploaded = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])

      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        galleryWith(inGallery),
      ])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      await seedEvent(db, forSession)
      await db.query(
        "update public.concepts set default_image_id = $1 where id = (select id from public.concepts order by sort_order limit 1)",
        [forConcept]
      )
      // Newest first (now() is one value inside the rollback): spread the
      // creation times.
      for (const [id, hours] of [
        [inGallery, 3],
        [forSession, 2],
        [forConcept, 1],
      ] as const) {
        await db.query(
          "update public.media_assets set created_at = now() - make_interval(hours => $2) where id = $1",
          [id, hours]
        )
      }

      const ids = (await listed(db, admin)).map((row) => row.id)
      const mine = ids.filter((id) =>
        [inGallery, forSession, forConcept].includes(id)
      )
      expect(mine).toEqual([forConcept, forSession, inGallery])
      expect(ids).not.toContain(unused)
      expect(ids).not.toContain(notUploaded.media_id)
    })
  })

  it("drops a family taken off the site", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const id = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith(id)])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await listed(db, admin)).map((r) => r.id)).toContain(id)

      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith()])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await mediaRow(db, id)).publish_state).toBe("hidden")
      expect((await listed(db, admin)).map((r) => r.id)).not.toContain(id)
    })
  })

  it("lists a family used only through a copy, under its original, with the latest alt", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const original = await publishedMedia(db, admin, testName("first alt"))
      // The original is on the site while the copy is made.
      const first = await seedEvent(db, original)
      const copy = await copied(db, admin, original)
      const latestAlt = testName("session alt")
      await publish(db, admin, copy, latestAlt, 20, 80)
      await db.query(
        "update public.media_assets set updated_at = now() + interval '1 minute' where id = $1",
        [copy]
      )
      // Then only the copy is in use (a session); the original is not.
      await seedEvent(db, copy)
      await db.query("update public.events set image_id = null where id = $1", [
        first,
      ])

      const rows = await listed(db, admin)
      expect(rows.map((r) => r.id)).not.toContain(copy)
      expect(rows.find((r) => r.id === original)).toMatchObject({
        alt_text: latestAlt,
        focus_x: 20,
        focus_y: 80,
        // The thumbnail is the published member in use.
        public_path: `${copy}.jpg`,
      })
    })
  })

  it("prefers the alt of a member on the site over a copy just taken off it", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const siteAlt = testName("site alt")
      const original = await uploadedMedia(db, admin)
      await publish(db, admin, original, siteAlt, 10, 10)
      await seedEvent(db, original)
      const copy = await copied(db, admin, original)
      await publish(db, admin, copy, testName("old alt"), 90, 90)
      // The copy was taken off the site: hide_unused_media gave it the
      // latest updated_at.
      await db.query(
        "update public.media_assets set publish_state = 'hidden', updated_at = now() + interval '1 minute' where id = $1",
        [copy]
      )
      expect(
        (await listed(db, admin)).find((r) => r.id === original)
      ).toMatchObject({
        alt_text: siteAlt,
        focus_x: 10,
        focus_y: 10,
        public_path: `${original}.jpg`,
      })
    })
  })

  it("falls back to the original's alt and focus when no row has an alt", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const original = await uploadedMedia(db, admin)
      await publish(db, admin, original, "", 30, 40)
      await seedEvent(db, original)
      expect(
        (await listed(db, admin)).find((r) => r.id === original)
      ).toMatchObject({ alt_text: null, focus_x: 30, focus_y: 40 })
    })
  })

  it("refuses a customer and anon", async () => {
    await inRollback(async (db) => {
      expect(await errorAs(db, randomUUID(), LIST, [])).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
      await asAnon(db)
      // No execute grant for anon.
      expect((await queryError(db, LIST))?.code).toBe("42501")
      await db.query("reset role")
    })
  })
})

describe("admin_copy_media", () => {
  it("makes a draft copy pointing at the original, once per key", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const original = await publishedMedia(db, admin)
      await seedEvent(db, original)
      const key = randomUUID()
      const first = await as<Copied>(db, admin, COPY, [original, key])
      expect(first.storage_path).toBe(first.media_id)
      expect(first.source_path).toBe(original)
      expect(await as(db, admin, COPY, [original, key])).toEqual(first)
      expect(await mediaRow(db, first.media_id)).toMatchObject({
        publish_state: "draft",
        source_id: original,
        public_path: `${first.media_id}.jpg`,
        alt_text: null,
      })
      // The original is untouched.
      expect(await mediaRow(db, original)).toMatchObject({
        publish_state: "published",
        source_id: null,
      })

      // The same key with another source is refused.
      const other = await publishedMedia(db, admin)
      await seedEvent(db, other)
      expect(await errorAs(db, admin, COPY, [other, key])).toMatchObject({
        code: "P0001",
        message: "IDEMPOTENCY_KEY_REUSED",
      })

      // The storage policy lets the admin write the copy's draft file.
      await asAuthenticated(db, admin)
      expect(
        await queryError(
          db,
          "insert into storage.objects (bucket_id, name) values ('media-drafts', $1)",
          [first.media_id]
        )
      ).toBeNull()
      await db.query("reset role")
    })
  })

  it("points a copy of a copy at the original", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const original = await publishedMedia(db, admin)
      await seedEvent(db, original)
      const copy = await copied(db, admin, original)
      const second = await as<Copied>(db, admin, COPY, [copy, randomUUID()])
      expect((await mediaRow(db, second.media_id)).source_id).toBe(original)
      expect(second.source_path).toBe(copy)
    })
  })

  it("keeps each place's own alt and focus", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const heroAlt = testName("gallery alt")
      const sessionAlt = testName("session alt")
      const original = await uploadedMedia(db, admin)
      await publish(db, admin, original, heroAlt, 10, 10)
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        galleryWith(original),
      ])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])

      const copy = await copied(db, admin, original)
      await publish(db, admin, copy, sessionAlt, 90, 90)
      const event = await seedEvent(db)
      await as(db, admin, SET_IMAGE, [event, copy])

      expect(await mediaRow(db, original)).toMatchObject({
        alt_text: heroAlt,
        focus_x: 10,
        publish_state: "published",
      })
      expect(await mediaRow(db, copy)).toMatchObject({
        alt_text: sessionAlt,
        focus_x: 90,
        publish_state: "published",
      })
    })
  })

  it("needs the source's draft file, and a known id", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const original = await publishedMedia(db, admin)
      await seedEvent(db, original)
      // A copy whose file never arrived, in a family on the site.
      const noFile = await as<Copied>(db, admin, COPY, [original, randomUUID()])
      expect(
        await errorAs(db, admin, COPY, [noFile.media_id, randomUUID()])
      ).toMatchObject({ message: "MEDIA_NOT_UPLOADED" })
      expect(
        await errorAs(db, admin, COPY, [randomUUID(), randomUUID()])
      ).toMatchObject({ message: "NOT_FOUND" })
    })
  })

  it("refuses an image not on the site (never used, or taken off it)", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const unused = await publishedMedia(db, admin)
      expect(
        await errorAs(db, admin, COPY, [unused, randomUUID()])
      ).toMatchObject({ message: "NOT_FOUND" })

      const id = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith(id)])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith()])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await mediaRow(db, id)).publish_state).toBe("hidden")
      expect(await errorAs(db, admin, COPY, [id, randomUUID()])).toMatchObject({
        message: "NOT_FOUND",
      })
    })
  })

  it("refuses a customer and anon", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const original = await publishedMedia(db, admin)
      await seedEvent(db, original)
      expect(
        await errorAs(db, randomUUID(), COPY, [original, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })

      await asAnon(db)
      // No execute grant for anon.
      expect((await queryError(db, COPY, [original, randomUUID()]))?.code).toBe(
        "42501"
      )
      await db.query("reset role")
    })
  })
})
