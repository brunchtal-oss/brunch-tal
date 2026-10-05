// Story 5.4: image upload and publishing (AD-16, AD-21), along the I/O
// matrix of the spec. The RPC and policy cases run inside a rollback, with
// storage.objects rows standing in for files (the RPCs and policies read
// only the rows). The last block talks to the Storage API of the dev project
// with a synthetic PNG made in code, and removes its files afterwards.

import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import {
  asAuthenticated,
  inRollback,
  onCleanup,
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
const DUPLICATE =
  "select public.admin_duplicate_event($1, $2::date, $3::time, $4::time, $5) as r"

// Each case runs several RPCs on the shared pooler.
vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>

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

// A storage object row (as the owner), standing in for an uploaded file.
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

// A new image as the admin, with its draft file.
async function uploadedMedia(db: Db, admin: string): Promise<string> {
  const created = await as<{ media_id: string }>(db, admin, CREATE, [
    randomUUID(),
  ])
  await putObject(db, "media-drafts", created.media_id)
  return created.media_id
}

// An image taken through begin, the copy and finish.
async function publishedMedia(
  db: Db,
  admin: string,
  alt = testName("alt")
): Promise<string> {
  const id = await uploadedMedia(db, admin)
  await as(db, admin, BEGIN, [id, alt, 50, 50])
  await putObject(db, "media-public", `${id}.jpg`)
  await as(db, admin, FINISH, [id])
  return id
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

// The gallery page starts empty inside the rollback (the dev database may
// hold demo content).
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

describe("media rows", () => {
  it("creates a draft row for an admin only, once per key", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const key = randomUUID()
      const first = await as<{ media_id: string; storage_path: string }>(
        db,
        admin,
        CREATE,
        [key]
      )
      expect(first.storage_path).toBe(first.media_id)
      expect(await as(db, admin, CREATE, [key])).toEqual(first)
      expect(await mediaRow(db, first.media_id)).toMatchObject({
        publish_state: "draft",
        public_path: `${first.media_id}.jpg`,
        alt_text: null,
        focus_x: 50,
        focus_y: 50,
      })

      const customer = randomUUID()
      expect(await errorAs(db, customer, CREATE, [randomUUID()])).toMatchObject(
        { code: "P0001", message: "NOT_AUTHORIZED" }
      )
    })
  })

  it("is never written by an API role directly", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const id = randomUUID()
      await asAuthenticated(db, admin)
      const error = await queryError(
        db,
        "insert into public.media_assets (id, storage_path, public_path) values ($1, $2, $3)",
        [id, id, `${id}.jpg`]
      )
      expect(error?.code).toBe("42501")
      await db.query("reset role")
    })
  })

  it("shows anon only published rows", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const draft = await uploadedMedia(db, admin)
      const published = await publishedMedia(db, admin)
      await asAnon(db)
      const { rows } = await db.query(
        "select id from public.media_assets where id = any($1::uuid[])",
        [[draft, published]]
      )
      expect(rows.map((r) => r.id)).toEqual([published])
      // Only the display columns.
      const error = await queryError(
        db,
        "select storage_path from public.media_assets"
      )
      expect(error?.code).toBe("42501")
      await db.query("reset role")
    })
  })
})

describe("storage policies", () => {
  it("let an admin upload a draft only under a draft row's name", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const created = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      const insert =
        "insert into storage.objects (bucket_id, name) values ($1, $2)"

      await asAuthenticated(db, admin)
      // A foreign name (no row).
      expect(
        (await queryError(db, insert, ["media-drafts", randomUUID()]))?.code
      ).toBe("42501")
      // The public bucket.
      expect(
        (
          await queryError(db, insert, [
            "media-public",
            `${created.media_id}.jpg`,
          ])
        )?.code
      ).toBe("42501")
      // Its own draft row.
      expect(
        await queryError(db, insert, ["media-drafts", created.media_id])
      ).toBeNull()
      // No update or delete: the row stays (no policy, or Storage's own
      // guard refuses it).
      await queryError(
        db,
        "delete from storage.objects where bucket_id = 'media-drafts' and name = $1",
        [created.media_id]
      )
      await queryError(
        db,
        "update storage.objects set name = $2 where bucket_id = 'media-drafts' and name = $1",
        [created.media_id, randomUUID()]
      )
      await db.query("reset role")
      const { rows } = await db.query(
        "select count(*)::int as n from storage.objects where bucket_id = 'media-drafts' and name = $1",
        [created.media_id]
      )
      expect(rows[0].n).toBe(1)

      // A row that is no longer a draft refuses a new upload.
      await as(db, admin, BEGIN, [created.media_id, "", 50, 50])
      const second = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      await db.query(
        "update public.media_assets set publish_state = 'hidden' where id = $1",
        [second.media_id]
      )
      await asAuthenticated(db, admin)
      expect(
        (await queryError(db, insert, ["media-drafts", second.media_id]))?.code
      ).toBe("42501")
      await db.query("reset role")
    })
  })

  it("refuse a customer and anon, and hide drafts from them", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const created = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      await putObject(db, "media-public", testName("probe.jpg"))
      const other = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      await putObject(db, "media-drafts", other.media_id)
      const insert =
        "insert into storage.objects (bucket_id, name) values ('media-drafts', $1)"

      const customer = randomUUID()
      await asAuthenticated(db, customer)
      expect((await queryError(db, insert, [created.media_id]))?.code).toBe(
        "42501"
      )
      const seen = await db.query(
        "select name from storage.objects where bucket_id in ('media-drafts', 'media-public')"
      )
      expect(seen.rows).toEqual([])
      await db.query("reset role")

      await asAnon(db)
      expect((await queryError(db, insert, [created.media_id]))?.code).toBe(
        "42501"
      )
      const anonSeen = await db.query(
        "select name from storage.objects where bucket_id in ('media-drafts', 'media-public')"
      )
      expect(anonSeen.rows).toEqual([])
      await db.query("reset role")

      // The admin reads drafts (signed preview URLs).
      await asAuthenticated(db, admin)
      const adminSeen = await db.query(
        "select name from storage.objects where bucket_id = 'media-drafts' and name = $1",
        [other.media_id]
      )
      expect(adminSeen.rows).toHaveLength(1)
      await db.query("reset role")
    })
  })
})

describe("publishing an image (AD-21)", () => {
  it("needs the uploaded draft file", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const created = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      expect(
        await errorAs(db, admin, BEGIN, [created.media_id, "", 50, 50])
      ).toMatchObject({ code: "P0001", message: "MEDIA_NOT_UPLOADED" })
      expect(
        await errorAs(db, admin, BEGIN, [randomUUID(), "", 50, 50])
      ).toMatchObject({ message: "NOT_FOUND" })
      expect(
        await errorAs(db, admin, BEGIN, [created.media_id, "", 101, 50])
      ).toMatchObject({ message: "INVALID_INPUT" })
    })
  })

  it("stops at finish until the copy exists, and a retry completes", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const id = await uploadedMedia(db, admin)

      const begun = await as(db, admin, BEGIN, [id, "  תמונה  ", 20, 70])
      expect(begun).toMatchObject({ publish_state: "copying" })
      const row = await mediaRow(db, id)
      expect(row).toMatchObject({ alt_text: "תמונה", focus_x: 20, focus_y: 70 })

      // The copy failed: finish stops, nothing is published.
      expect(await errorAs(db, admin, FINISH, [id])).toMatchObject({
        message: "MEDIA_NOT_COPIED",
      })
      expect((await mediaRow(db, id)).publish_state).toBe("copying")

      // A retry: begin again keeps the start, the copy lands, finish closes.
      await as(db, admin, BEGIN, [id, "", 20, 70])
      const again = await mediaRow(db, id)
      expect(again.publish_state).toBe("copying")
      expect(again.alt_text).toBeNull()
      expect(again.publish_started_at).toEqual(row.publish_started_at)
      await putObject(db, "media-public", `${id}.jpg`)
      expect(await as(db, admin, FINISH, [id])).toMatchObject({
        publish_state: "published",
      })
      // finish again: the same result.
      expect(await as(db, admin, FINISH, [id])).toMatchObject({
        publish_state: "published",
      })
      // begin on a published image keeps it published.
      expect(await as(db, admin, BEGIN, [id, "חדש", 10, 10])).toMatchObject({
        publish_state: "published",
      })
    })
  })

  it("refuses finish without begin", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const id = await uploadedMedia(db, admin)
      await putObject(db, "media-public", `${id}.jpg`)
      expect(await errorAs(db, admin, FINISH, [id])).toMatchObject({
        message: "MEDIA_NOT_COPIED",
      })
    })
  })
})

describe("visible_media_ids", () => {
  it("follows hidden sections and items", async () => {
    await inRollback(async (db) => {
      const a = randomUUID()
      const b = randomUUID()
      const c = randomUUID()
      const ids = async (content: unknown) => {
        const { rows } = await db.query(
          "select private.visible_media_ids($1::jsonb) as r",
          [JSON.stringify(content)]
        )
        return [...(rows[0].r as string[])].sort()
      }
      expect(
        await ids({
          image: { media_id: a },
          items: [
            { image: { media_id: b } },
            { image: { media_id: c }, hidden: true },
            { image: { media_id: "not-a-uuid" } },
            { text: "x" },
          ],
        })
      ).toEqual([a, b].sort())
      expect(
        await ids({ image: { media_id: a }, hidden: true, items: [] })
      ).toEqual([])
      expect(await ids({ items: "x" })).toEqual([])
    })
  })
})

describe("publishing content with images", () => {
  it("refuses an image still copying, and skips an unfinished upload", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const copying = await uploadedMedia(db, admin)
      await as(db, admin, BEGIN, [copying, "", 50, 50])
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        galleryWith(copying),
      ])
      expect(
        await errorAs(db, admin, PUBLISH, ["gallery", randomUUID()])
      ).toMatchObject({ message: "MEDIA_NOT_COPIED" })

      // An upload that did not finish (draft) does not stop the publish.
      const created = await as<{ media_id: string }>(db, admin, CREATE, [
        randomUUID(),
      ])
      const published = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        galleryWith(created.media_id, published),
      ])
      expect(
        await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      ).toMatchObject({ changed: 1 })
      expect((await mediaRow(db, published)).publish_state).toBe("published")
    })
  })

  it("hides a removed image before its file is deleted, and repeats the delete", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const keep = await publishedMedia(db, admin)
      const remove = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        galleryWith(keep, remove),
      ])
      const first = await as<{ hidden_paths: string[] }>(db, admin, PUBLISH, [
        "gallery",
        randomUUID(),
      ])
      expect(first.hidden_paths).not.toContain(`${remove}.jpg`)

      // Hidden in the draft (an item hidden), then published.
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        JSON.stringify({
          title: testName("gallery"),
          items: [
            { image: { media_id: keep, focus_x: 50, focus_y: 50 } },
            {
              image: { media_id: remove, focus_x: 50, focus_y: 50 },
              hidden: true,
            },
          ],
        }),
      ])
      const second = await as<{ hidden_paths: string[] }>(db, admin, PUBLISH, [
        "gallery",
        randomUUID(),
      ])
      expect((await mediaRow(db, remove)).publish_state).toBe("hidden")
      expect((await mediaRow(db, keep)).publish_state).toBe("published")
      expect(second.hidden_paths).toContain(`${remove}.jpg`)
      expect(second.hidden_paths).not.toContain(`${keep}.jpg`)

      // The delete failed (the file is still there): the next publish, even
      // with nothing to publish, returns it again.
      const third = await as<{ hidden_paths: string[]; changed: number }>(
        db,
        admin,
        PUBLISH,
        ["gallery", randomUUID()]
      )
      expect(third.changed).toBe(0)
      expect(third.hidden_paths).toContain(`${remove}.jpg`)

      // Anon cannot read the hidden row.
      await asAnon(db)
      const { rows } = await db.query(
        "select id from public.media_assets where id = $1",
        [remove]
      )
      expect(rows).toEqual([])
      await db.query("reset role")

      // Used again: begin brings it back to copying.
      expect(await as(db, admin, BEGIN, [remove, "", 50, 50])).toMatchObject({
        publish_state: "copying",
      })
    })
  })

  it("does not show an image of a hidden section", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const id = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith(id)])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      await as(db, admin, SET_DRAFT, [
        "gallery",
        "photos",
        JSON.stringify({ ...JSON.parse(galleryWith(id)), hidden: true }),
      ])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await mediaRow(db, id)).publish_state).toBe("hidden")
    })
  })
})

// Review fixes (story 5.4): a hidden image in a pending draft stops the
// publish; an unused image stuck in copying is hidden (its copied file comes
// back to delete); a concept's image is in use; a section hidden by its
// column shows no image; a customer reads only published rows.
describe("publishing content with images, review fixes", () => {
  it("refuses a pending draft that shows a hidden image", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const id = await publishedMedia(db, admin)
      await db.query(
        "update public.media_assets set publish_state = 'hidden' where id = $1",
        [id]
      )
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith(id)])
      expect(
        await errorAs(db, admin, PUBLISH, ["gallery", randomUUID()])
      ).toMatchObject({ message: "MEDIA_NOT_COPIED" })

      // The Action's retry publishes it again, then the page publishes.
      await as(db, admin, BEGIN, [id, "", 50, 50])
      await as(db, admin, FINISH, [id])
      expect(
        await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      ).toMatchObject({ changed: 1 })
      expect((await mediaRow(db, id)).publish_state).toBe("published")
    })
  })

  it("hides an unused image stuck in copying whose file was copied", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const stuck = await uploadedMedia(db, admin)
      await as(db, admin, BEGIN, [stuck, "", 50, 50])
      await putObject(db, "media-public", `${stuck}.jpg`)
      const result = await as<{ hidden_paths: string[] }>(db, admin, PUBLISH, [
        "gallery",
        randomUUID(),
      ])
      expect((await mediaRow(db, stuck)).publish_state).toBe("hidden")
      expect(result.hidden_paths).toContain(`${stuck}.jpg`)
    })
  })

  it("keeps a concept's default image published", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const id = await publishedMedia(db, admin)
      await db.query(
        "update public.concepts set default_image_id = $1 where id = (select id from public.concepts order by sort_order limit 1)",
        [id]
      )
      const result = await as<{ hidden_paths: string[] }>(db, admin, PUBLISH, [
        "gallery",
        randomUUID(),
      ])
      expect((await mediaRow(db, id)).publish_state).toBe("published")
      expect(result.hidden_paths).not.toContain(`${id}.jpg`)
    })
  })

  it("hides the image of a section hidden by its column", async () => {
    await inRollback(async (db) => {
      await cleanGallery(db)
      const admin = await seedAdmin(db)
      const id = await publishedMedia(db, admin)
      await as(db, admin, SET_DRAFT, ["gallery", "photos", galleryWith(id)])
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await mediaRow(db, id)).publish_state).toBe("published")
      await db.query(
        "update public.content_sections set hidden = true where page_slug = 'gallery' and key = 'photos'"
      )
      await as(db, admin, PUBLISH, ["gallery", randomUUID()])
      expect((await mediaRow(db, id)).publish_state).toBe("hidden")
    })
  })

  it("lets a customer read only published rows", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const draft = await uploadedMedia(db, admin)
      const copying = await uploadedMedia(db, admin)
      await as(db, admin, BEGIN, [copying, "", 50, 50])
      const published = await publishedMedia(db, admin)
      const hidden = await publishedMedia(db, admin)
      await db.query(
        "update public.media_assets set publish_state = 'hidden' where id = $1",
        [hidden]
      )
      await asAuthenticated(db, randomUUID())
      const { rows } = await db.query(
        "select id from public.media_assets where id = any($1::uuid[])",
        [[draft, copying, published, hidden]]
      )
      expect(rows.map((r) => r.id)).toEqual([published])
      await db.query("reset role")
    })
  })
})

describe("session images", () => {
  it("needs a published image, and hides the one it replaces", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const event = await seedEvent(db)
      const draft = await uploadedMedia(db, admin)
      expect(await errorAs(db, admin, SET_IMAGE, [event, draft])).toMatchObject(
        { message: "MEDIA_NOT_PUBLISHED" }
      )
      expect(
        await errorAs(db, admin, SET_IMAGE, [randomUUID(), null])
      ).toMatchObject({ message: "NOT_FOUND" })
      expect(
        await errorAs(db, randomUUID(), SET_IMAGE, [event, null])
      ).toMatchObject({ message: "NOT_AUTHORIZED" })

      const first = await publishedMedia(db, admin)
      const set = await as<{ image_id: string }>(db, admin, SET_IMAGE, [
        event,
        first,
      ])
      expect(set.image_id).toBe(first)

      // Another session uses the same image: it stays published.
      const shared = await publishedMedia(db, admin)
      const otherEvent = await seedEvent(db, shared)
      expect(otherEvent).toBeTruthy()

      const second = await publishedMedia(db, admin)
      const replaced = await as<{ hidden_paths: string[] }>(
        db,
        admin,
        SET_IMAGE,
        [event, second]
      )
      expect((await mediaRow(db, first)).publish_state).toBe("hidden")
      expect(replaced.hidden_paths).toContain(`${first}.jpg`)
      expect((await mediaRow(db, shared)).publish_state).toBe("published")

      // Audited with the session.
      const { rows } = await db.query(
        "select count(*)::int as n from public.audit_log where action = 'admin_set_event_image' and event_id = $1",
        [event]
      )
      expect(rows[0].n).toBe(2)

      // Anon reads it through the session.
      await asAnon(db)
      const read = await db.query(
        "select e.image_id, m.public_path from public.events e join public.media_assets m on m.id = e.image_id where e.id = $1",
        [event]
      )
      expect(read.rows[0]).toEqual({
        image_id: second,
        public_path: `${second}.jpg`,
      })
      await db.query("reset role")
    })
  })

  it("is copied by duplicate", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const image = await publishedMedia(db, admin)
      const event = await seedEvent(db, image)
      const copy = await as<{ event_id: string }>(db, admin, DUPLICATE, [
        event,
        "2099-01-05",
        "10:00",
        "12:00",
        randomUUID(),
      ])
      const { rows } = await db.query(
        "select image_id from public.events where id = $1",
        [copy.event_id]
      )
      expect(rows[0].image_id).toBe(image)
    })
  })

  it("falls back to the concept's image for the public", async () => {
    await inRollback(async (db) => {
      const admin = await seedAdmin(db)
      const image = await publishedMedia(db, admin)
      const event = await seedEvent(db)
      await db.query(
        "update public.concepts set default_image_id = $1 where id = (select concept_id from public.events where id = $2)",
        [image, event]
      )
      await asAnon(db)
      const { rows } = await db.query(
        `select m.public_path
         from public.events e
         join public.concepts c on c.id = e.concept_id
         join public.media_assets m on m.id = coalesce(e.image_id, c.default_image_id)
         where e.id = $1`,
        [event]
      )
      expect(rows[0].public_path).toBe(`${image}.jpg`)
      await db.query("reset role")
    })
  })
})

// Through the Storage API of the dev project (a synthetic 1x1 PNG).
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef" +
    "0000000049454e44ae426082",
  "hex"
)

function storageClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !secret || !publishable) {
    throw new Error("Supabase keys are missing in .env.local")
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  return {
    url,
    service: createClient(url, secret, options),
    anon: createClient(url, publishable, options),
  }
}

describe("storage API", () => {
  it("never serves a draft, and a deleted public file is gone", async () => {
    const { url, service, anon } = storageClients()
    const name = randomUUID()
    const publicName = `${name}.jpg`
    onCleanup(async () => {
      await service.storage.from("media-drafts").remove([name])
      await service.storage.from("media-public").remove([publicName])
    })

    const uploaded = await service.storage
      .from("media-drafts")
      .upload(name, PNG, { contentType: "image/png" })
    expect(uploaded.error).toBeNull()

    // A draft: no public URL, no download for anon.
    const draftUrl = `${url}/storage/v1/object/public/media-drafts/${name}`
    const draft = await fetch(draftUrl)
    expect(draft.status).toBeGreaterThanOrEqual(400)
    expect(draft.status).toBeLessThan(500)
    const download = await anon.storage.from("media-drafts").download(name)
    expect(download.data).toBeNull()

    // The copy (as lib/server/privileged/media.ts), then the public URL.
    const copied = await service.storage
      .from("media-drafts")
      .copy(name, publicName, { destinationBucket: "media-public" })
    expect(copied.error).toBeNull()
    const publicUrl = `${url}/storage/v1/object/public/media-public/${publicName}`
    expect((await fetch(publicUrl)).status).toBe(200)

    // anon cannot list the public bucket.
    const listed = await anon.storage.from("media-public").list()
    expect(listed.data ?? []).toEqual([])

    // A refused type.
    const gif = await service.storage
      .from("media-drafts")
      .upload(`${name}-gif`, PNG, { contentType: "image/gif" })
    expect(gif.error).not.toBeNull()

    // Deleted: the public URL no longer serves it.
    const removed = await service.storage
      .from("media-public")
      .remove([publicName])
    expect(removed.error).toBeNull()
    // A new query string skips the CDN's copy of the earlier answer.
    const gone = await fetch(`${publicUrl}?v=${randomUUID()}`)
    expect(gone.status).toBeGreaterThanOrEqual(400)
  })
})
