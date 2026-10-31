// Fix fix-public-read-leaks (story 6.7's acceptance suite, T11 and T18):
// hidden content never reaches a public read (PC8), and an archived concept
// is not readable through the API unless a session that is not a draft
// shows it (SC5). Along the I/O matrix of spec-fix-public-read-leaks.md.
// Every test resets the pages it uses inside its own rollback (the dev
// database may hold published site content), as content-publish.test.ts.

import { randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { visibleSection, type ParsedSection } from "@/lib/content/visible"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"

const GET = "select public.admin_get_content_page($1) as r"
const SET_DRAFT =
  "select public.admin_set_content_draft($1, $2, $3::jsonb) as r"
const PUBLISH = "select public.admin_publish_content($1, $2) as r"
const CREATE_MEDIA = "select public.admin_create_media($1) as r"
const BEGIN = "select public.admin_begin_media_publish($1, $2, $3, $4) as r"
const FINISH = "select public.admin_finish_media_publish($1) as r"
const PUBLIC_SECTION = `select s.published_content
  from public.content_sections s
  where s.page_slug = $1 and s.key = $2`
const STORED = `select s.published_content, s.published_content_full
  from public.content_sections s
  where s.page_slug = $1 and s.key = $2`

// Each case runs several RPCs on the shared pooler.
vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>

type Fixture = { admin: string; customer: string }

// As the owner: an admin and an activated customer (no Auth user needed:
// asAuthenticated sets auth.uid()).
async function seed(db: Db): Promise<Fixture> {
  const admin = randomUUID()
  const customer = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [customer, testName("public_reads_customer")]
  )
  return { admin, customer }
}

async function asAnon(db: Db): Promise<void> {
  await db.query(
    // claim.sub is cleared so auth.uid() does not keep a previous user.
    "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true), set_config('request.jwt.claim.sub', '', true)"
  )
  await db.query("set local role anon")
}

// As a signed-in user (or anon when userId is null); returns to the owner
// role afterwards.
async function asRole<T>(
  db: Db,
  userId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  if (userId) await asAuthenticated(db, userId)
  else await asAnon(db)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function rpc<T = Row>(
  db: Db,
  userId: string,
  text: string,
  params: unknown[]
): Promise<T> {
  return asRole(
    db,
    userId,
    async () => (await db.query(text, params)).rows[0].r as T
  )
}

// The published content of a section as anon (null) or a signed-in user.
async function publicRead(
  db: Db,
  userId: string | null,
  slug: string,
  key: string
): Promise<unknown[]> {
  return asRole(db, userId, async () =>
    (await db.query(PUBLIC_SECTION, [slug, key])).rows.map(
      (r) => r.published_content
    )
  )
}

// The section of admin_get_content_page, as the admin.
async function adminSection(
  db: Db,
  admin: string,
  slug: string,
  key: string
): Promise<Row> {
  const page = await rpc<{ sections: Row[] }>(db, admin, GET, [slug])
  return page.sections.find((s) => s.key === key)!
}

async function stored(db: Db, slug: string, key: string): Promise<Row> {
  return (await db.query(STORED, [slug, key])).rows[0]
}

// The pages start unpublished, with no draft and nothing published, inside
// the rollback (as inCleanHome in content-publish.test.ts).
async function cleanPages(db: Db, slugs: string[]): Promise<void> {
  await db.query(
    `update public.content_pages
     set published_content = null, published_at = null, published_version = 0
     where slug = any($1::text[])`,
    [slugs]
  )
  await db.query(
    `update public.content_sections
     set draft_content = null, published_content = null, published_at = null
     where page_slug = any($1::text[])`,
    [slugs]
  )
}

async function publish(db: Db, f: Fixture, slug: string, content: unknown) {
  const [page, key] = slug.split("/")
  await rpc(db, f.admin, SET_DRAFT, [page, key, JSON.stringify(content)])
  return rpc<{ changed: number }>(db, f.admin, PUBLISH, [page, randomUUID()])
}

// A list of each kind with a visible and a hidden item.
const LISTS = [
  {
    slug: "how-it-works/faq",
    content: () => ({
      title: testName("faq"),
      items: [
        { question: testName("q_shown"), answer: "a" },
        { question: testName("q_hidden"), answer: "b", hidden: true },
        { question: testName("q_last"), answer: "c", hidden: false },
      ],
    }),
  },
  {
    slug: "gallery/testimonials",
    content: () => ({
      title: testName("testimonials"),
      items: [
        { kind: "text", name: "n", text: testName("t_hidden"), hidden: true },
        { kind: "text", name: "n", text: testName("t_shown") },
      ],
    }),
  },
  {
    slug: "site/footer",
    content: () => ({
      items: [
        { label: testName("l_shown"), url: "https://example.com/a" },
        {
          label: testName("l_hidden"),
          url: "https://example.com/b",
          hidden: true,
        },
      ],
    }),
  },
]

function withoutHidden(content: { items: Row[] }) {
  return { ...content, items: content.items.filter((i) => i.hidden !== true) }
}

describe("T11: hidden content is not readable through the API (PC8)", () => {
  it("publishes a list with a hidden item: the public reads it without, the editor reads it whole; a republish changes nothing", async () => {
    await inRollback(async (db) => {
      await cleanPages(db, ["how-it-works", "gallery", "site"])
      const f = await seed(db)
      for (const list of LISTS) {
        const [page, key] = list.slug.split("/")
        const draft = list.content()
        const first = await publish(db, f, list.slug, draft)
        expect(first.changed).toBe(1)

        const expected = withoutHidden(draft)
        expect(await publicRead(db, null, page, key)).toEqual([expected])
        expect(await publicRead(db, f.customer, page, key)).toEqual([expected])

        // The editor: published_content is the whole draft, so its chip
        // reads "published" (draft = published).
        const section = await adminSection(db, f.admin, page, key)
        expect(section.published_content).toEqual(draft)
        expect(section.draft_content).toEqual(section.published_content)
        expect((await stored(db, page, key)).published_content_full).toEqual(
          draft
        )

        // Republish, nothing changed (the draft still has its hidden item).
        const again = await rpc<{ changed: number }>(db, f.admin, PUBLISH, [
          page,
          randomUUID(),
        ])
        expect(again.changed).toBe(0)
      }
    })
  })

  it("publishes a hidden section (the promo banner): the public reads only {hidden: true}", async () => {
    await inRollback(async (db) => {
      await cleanPages(db, ["home"])
      const f = await seed(db)
      const draft = { text: testName("banner"), hidden: true }
      await publish(db, f, "home/promo_banner", draft)

      expect(await publicRead(db, null, "home", "promo_banner")).toEqual([
        { hidden: true },
      ])
      expect(await publicRead(db, f.customer, "home", "promo_banner")).toEqual([
        { hidden: true },
      ])
      expect(await stored(db, "home", "promo_banner")).toEqual({
        published_content: { hidden: true },
        published_content_full: draft,
      })
      expect(
        (await adminSection(db, f.admin, "home", "promo_banner"))
          .published_content
      ).toEqual(draft)

      // On again: the public reads the text.
      const on = { text: draft.text, hidden: false }
      await publish(db, f, "home/promo_banner", on)
      expect(await publicRead(db, null, "home", "promo_banner")).toEqual([on])
    })
  })

  it("derives the public copy on a direct write, keeps both on an unrelated update, and clears both on unpublish", async () => {
    await inRollback(async (db) => {
      await cleanPages(db, ["how-it-works"])
      const full = LISTS[0].content()
      await db.query(
        `update public.content_sections
         set published_content = $1::jsonb, published_at = now()
         where page_slug = 'how-it-works' and key = 'faq'`,
        [JSON.stringify(full)]
      )
      expect(await stored(db, "how-it-works", "faq")).toEqual({
        published_content: withoutHidden(full),
        published_content_full: full,
      })

      // An unrelated update: both published columns stay.
      await db.query(
        `update public.content_sections
         set draft_content = '{"title": "x", "items": []}'::jsonb
         where page_slug = 'how-it-works' and key = 'faq'`
      )
      expect(await stored(db, "how-it-works", "faq")).toEqual({
        published_content: withoutHidden(full),
        published_content_full: full,
      })

      // The unpublish reset (as the tests' clean helpers do).
      await db.query(
        `update public.content_sections
         set published_content = null, published_at = null
         where page_slug = 'how-it-works' and key = 'faq'`
      )
      expect(await stored(db, "how-it-works", "faq")).toEqual({
        published_content: null,
        published_content_full: null,
      })
    })
  })

  it("derives the public copy on insert, from either column, and lets the full column win when both are written", async () => {
    const full = {
      title: testName("faq"),
      items: [
        { question: testName("q_a"), answer: "a" },
        { question: testName("q_b"), answer: "b", hidden: true },
      ],
    }
    const expected = withoutHidden(full)
    await inRollback(async (db) => {
      await cleanPages(db, ["how-it-works"])
      await db.query(
        `update public.content_pages
         set published_content = '{}'::jsonb, published_at = now()
         where slug = 'how-it-works'`
      )
      const insert = async (column: string, key: string) =>
        db.query(
          `insert into public.content_sections (
             page_slug, key, kind, sort_order, ${column}, published_at)
           values ('how-it-works', $1, 'faq', 99, $2::jsonb, now())`,
          [key, JSON.stringify(full)]
        )

      for (const column of ["published_content", "published_content_full"]) {
        const key = testName(`insert_${column}`)
        await insert(column, key)
        expect(await stored(db, "how-it-works", key)).toEqual({
          published_content: expected,
          published_content_full: full,
        })
        expect(await publicRead(db, null, "how-it-works", key)).toEqual([
          expected,
        ])
      }

      // Both columns at once: the full one wins, the public one is derived.
      const key = testName("insert_published_content")
      const other = { title: "other", items: [] }
      await db.query(
        `update public.content_sections
         set published_content = $1::jsonb,
             published_content_full = $2::jsonb
         where page_slug = 'how-it-works' and key = $3`,
        [
          JSON.stringify(other),
          JSON.stringify({ ...full, title: testName("both") }),
          key,
        ]
      )
      expect(await stored(db, "how-it-works", key)).toEqual({
        published_content: { ...expected, title: testName("both") },
        published_content_full: { ...full, title: testName("both") },
      })
    })
  })

  it("refuses the full column to anon and customers", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const user of [null, f.customer]) {
        const error = await asRole(db, user, () =>
          queryError(
            db,
            "select published_content_full from public.content_sections"
          )
        )
        expect(error?.code).toBe("42501")
      }
    })
  })

  it("hides the image of a hidden item without deleting it, and publishes it again once shown and copied", async () => {
    await inRollback(async (db) => {
      await cleanPages(db, ["gallery"])
      const f = await seed(db)
      const shown = await publishedMedia(db, f.admin)
      const hidden = await publishedMedia(db, f.admin)
      const gallery = (hideSecond: boolean) => ({
        title: testName("gallery"),
        items: [shown, hidden].map((id, n) => ({
          image: { media_id: id, focus_x: 50, focus_y: 50 },
          ...(n === 1 && hideSecond ? { hidden: true } : {}),
        })),
      })

      await publish(db, f, "gallery/photos", gallery(true))
      expect(await mediaState(db, hidden)).toBe("hidden")
      expect(await mediaState(db, shown)).toBe("published")
      expect(await publicRead(db, null, "gallery", "photos")).toEqual([
        withoutHidden(gallery(true)),
      ])

      // Shown again: copied again (begin, then finish; the public file row
      // is still there), then published.
      await rpc(db, f.admin, SET_DRAFT, [
        "gallery",
        "photos",
        JSON.stringify(gallery(false)),
      ])
      await rpc(db, f.admin, BEGIN, [hidden, "", 50, 50])
      await rpc(db, f.admin, FINISH, [hidden])
      const second = await rpc<{ changed: number }>(db, f.admin, PUBLISH, [
        "gallery",
        randomUUID(),
      ])
      expect(second.changed).toBe(1)
      expect(await mediaState(db, hidden)).toBe("published")
      expect(await publicRead(db, null, "gallery", "photos")).toEqual([
        gallery(false),
      ])
    })
  })

  it("strips exactly what the site does not show (private.public_content = lib/content/visible.ts)", async () => {
    const image = (id: string) => ({ media_id: id, focus_x: 50, focus_y: 50 })
    const cases: { kind: string; content: Row }[] = [
      {
        kind: "steps",
        content: {
          title: "s",
          items: [
            { title: "a", hidden: true },
            { title: "b" },
            { title: "c", hidden: false },
          ],
        },
      },
      {
        kind: "steps",
        content: { title: "s", items: [{ title: "a", hidden: true }] },
      },
      {
        kind: "faq",
        content: {
          items: [
            { question: "q", answer: "a" },
            { question: "q2", answer: "a2", hidden: true },
          ],
        },
      },
      {
        kind: "testimonials",
        content: {
          items: [
            { kind: "text", name: "n", text: "t", hidden: true },
            { kind: "image", image: image(randomUUID()), name: "n" },
            { name: "old", text: "no kind" },
          ],
        },
      },
      {
        kind: "gallery",
        content: {
          title: "g",
          columns: 3,
          items: [
            { image: image(randomUUID()), caption: "c" },
            { image: image(randomUUID()), hidden: true },
          ],
        },
      },
      {
        kind: "footer",
        content: {
          items: [
            { label: "a", url: "https://example.com/a", hidden: true },
            { label: "b", url: "https://example.com/b" },
          ],
        },
      },
      {
        kind: "faq",
        content: {
          title: "whole list hidden",
          items: [{ question: "q", answer: "a" }],
          hidden: true,
        },
      },
      {
        kind: "text_block",
        content: { title: "t", body: "b", hidden: true },
      },
      { kind: "text_block", content: { title: "t", body: "b" } },
      { kind: "promo_banner", content: { text: "on", hidden: false } },
      { kind: "promo_banner", content: { text: "off", hidden: true } },
      { kind: "hero", content: { title: "h", description: "d" } },
    ]

    await inRollback(async (db) => {
      for (const { kind, content } of cases) {
        const { rows } = await db.query(
          "select private.public_content($1::jsonb) as r",
          [JSON.stringify(content)]
        )
        const stripped = rows[0].r as Row
        expect(
          visibleSection({ kind, content: stripped } as ParsedSection)
        ).toEqual(visibleSection({ kind, content } as ParsedSection))
        const items = (stripped.items ?? []) as Row[]
        expect(items.some((i) => i.hidden === true)).toBe(false)
        if (content.hidden === true) expect(stripped).toEqual({ hidden: true })
      }
      const { rows } = await db.query(
        "select private.public_content(null) as r"
      )
      expect(rows[0].r).toBeNull()
    })
  })
})

describe("T18: an archived concept through the API (SC5)", () => {
  async function concept(db: Db, label: string, archived: boolean) {
    const { rows } = await db.query(
      `insert into public.concepts (name, default_kind, theme_key, archived_at)
       values ($1, 'regular', 'mothers', case when $2 then now() end)
       returning id`,
      [testName(label), archived]
    )
    return rows[0].id as string
  }

  async function event(db: Db, conceptId: string, status: string) {
    const days = status === "completed" ? -5 : 10
    const { rows } = await db.query(
      `insert into public.events (
         concept_id, kind, starts_at, ends_at, capacity_adults,
         registration_closes_at, status)
       values ($1, 'regular', now() + make_interval(days => $2),
         now() + make_interval(days => $2, hours => 2), 10,
         now() + make_interval(days => $2) - interval '1 day', $3)
       returning id`,
      [conceptId, days, status]
    )
    return rows[0].id as string
  }

  async function conceptNames(db: Db, user: string | null, id: string) {
    return asRole(db, user, async () =>
      (
        await db.query("select name from public.concepts where id = $1", [id])
      ).rows.map((r) => r.name)
    )
  }

  // The events -> concepts(name) embed of the session pages: the session's
  // row with its concept's name (null when the concept is not readable).
  async function embeddedName(db: Db, user: string | null, eventId: string) {
    return asRole(db, user, async () =>
      (
        await db.query(
          `select (
             select c.name from public.concepts c where c.id = e.concept_id
           ) as name
           from public.events e
           where e.id = $1`,
          [eventId]
        )
      ).rows.map((r) => r.name)
    )
  }

  it("hides an archived concept without sessions, or with a draft only, from anon and customers", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const none = await concept(db, "archived_none", true)
      const draftOnly = await concept(db, "archived_draft", true)
      await event(db, draftOnly, "draft")
      for (const user of [null, f.customer]) {
        expect(await conceptNames(db, user, none)).toEqual([])
        expect(await conceptNames(db, user, draftOnly)).toEqual([])
      }
    })
  })

  it("shows an archived concept through a published, completed or cancelled session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const status of ["published", "completed", "cancelled"]) {
        const id = await concept(db, `archived_${status}`, true)
        const eventId = await event(db, id, status)
        for (const user of [null, f.customer]) {
          expect(await conceptNames(db, user, id)).toEqual([
            testName(`archived_${status}`),
          ])
          expect(await embeddedName(db, user, eventId)).toEqual([
            testName(`archived_${status}`),
          ])
        }
      }
    })
  })

  it("shows every concept to the admin, and an active one to everyone", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const archived = await concept(db, "archived_admin", true)
      const active = await concept(db, "active", false)
      expect(await conceptNames(db, f.admin, archived)).toEqual([
        testName("archived_admin"),
      ])
      for (const user of [null, f.customer, f.admin]) {
        expect(await conceptNames(db, user, active)).toEqual([
          testName("active"),
        ])
      }
    })
  })
})

// A published image (begin, a public file row, finish), as in media.test.ts.
async function publishedMedia(db: Db, admin: string): Promise<string> {
  const created = await rpc<{ media_id: string }>(db, admin, CREATE_MEDIA, [
    randomUUID(),
  ])
  const id = created.media_id
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-drafts', $1)",
    [id]
  )
  await rpc(db, admin, BEGIN, [id, testName("alt"), 50, 50])
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('media-public', $1)",
    [`${id}.jpg`]
  )
  await rpc(db, admin, FINISH, [id])
  return id
}

async function mediaState(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select publish_state from public.media_assets where id = $1",
    [id]
  )
  return rows[0].publish_state
}
