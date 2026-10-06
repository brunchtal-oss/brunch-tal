// Story 2.2: content_pages and content_sections (AD-16). anon and
// authenticated read only published columns of published rows; the seed has
// the photo consent wording, the business details, and an unpublished
// privacy page.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"

async function asAnon(db: Db): Promise<void> {
  await db.query(
    "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
  )
  await db.query("set local role anon")
}

const PAGES = "select slug, published_version from public.content_pages"
const SECTIONS =
  "select page_slug, key, kind, published_content from public.content_sections"

describe("content", () => {
  it.each([
    ["anon", asAnon],
    ["authenticated", (db: Db) => asAuthenticated(db, randomUUID())],
  ])("%s sees published pages only", async (_role, act) => {
    await inRollback(async (db) => {
      // Privacy is editable since 5.5: from the migration's state (not
      // published), whatever the shared dev database holds.
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null
         where slug = 'privacy'`
      )
      await act(db)
      const { rows: privacy } = await db.query(
        `${PAGES} where slug = 'privacy'`
      )
      expect(privacy).toEqual([])
      const { rows: contact } = await db.query(
        `${PAGES} where slug = 'contact'`
      )
      // The business details are editable since 5.1 (admin_publish_content),
      // so the shared dev database may hold a later version than the seed.
      expect(contact).toEqual([
        { slug: "contact", published_version: expect.any(Number) },
      ])
      const { rows: business } = await db.query(
        `${SECTIONS} where page_slug = 'contact' and key = 'business_details'`
      )
      expect(business).toEqual([
        {
          page_slug: "contact",
          key: "business_details",
          kind: "business_details",
          published_content: expect.objectContaining({
            whatsapp_phone: expect.any(String),
          }),
        },
      ])
    })
  })

  it("seeds the approved photo consent wording, version 0", async () => {
    const rows = await sql(
      `select s.published_content, p.published_version
       from public.content_sections s
       join public.content_pages p on p.slug = s.page_slug
       where s.page_slug = 'join-form' and s.key = 'photo_consent'`
    )
    expect(rows).toEqual([
      {
        published_version: 0,
        published_content: {
          question: [
            "במפגשים אני מצלמת תמונות כדי שיהיה למשתתפות הבראנץ׳ מזכרת מתוקה עם הקטנטנים.",
            "לפעמים אשמח לשתף רגעים מהמפגשים גם באתר וברשתות החברתיות.",
            "האם את מסכימה שאפרסם תמונות שלכם?",
          ].join("\n"),
          yes_label: "כן, בשמחה",
          no_label: "מעדיפה שהתמונות שלנו ישארו פרטיות",
        },
      },
    ])
  })

  it("never shows drafts, hidden or unpublished sections", async () => {
    await inRollback(async (db) => {
      await db.query(
        `insert into public.content_sections
           (page_slug, key, kind, hidden, draft_content, published_content, published_at)
         values
           ('contact', $1, 'test', true, '{}', '{}', now()),
           ('contact', $2, 'test', false, '{}', null, null)`,
        [testName("hidden").toLowerCase(), testName("draft").toLowerCase()]
      )
      await asAnon(db)
      const { rows } = await db.query(`${SECTIONS} where kind = 'test'`)
      expect(rows).toEqual([])
      for (const query of [
        "select draft_content from public.content_sections",
        "select draft_content from public.content_pages",
        "select hidden from public.content_sections",
        "select * from public.content_pages",
      ]) {
        expect((await queryError(db, query))?.code).toBe("42501")
      }
    })
  })

  it("hides a published section of an unpublished page", async () => {
    await inRollback(async (db) => {
      const key = testName("under_privacy").toLowerCase()
      // Privacy is editable since 5.5: back to not published.
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null
         where slug = 'privacy'`
      )
      await db.query(
        `insert into public.content_sections
           (page_slug, key, kind, published_content, published_at)
         values ('privacy', $1, 'test', '{}', now())`,
        [key]
      )
      await asAnon(db)
      const { rows } = await db.query(`${SECTIONS} where key = $1`, [key])
      expect(rows).toEqual([])
    })
  })

  it("refuses section content that is not an object", async () => {
    await inRollback(async (db) => {
      for (const [constraint, columns, values] of [
        ["content_sections_draft_content_check", "draft_content", "'[]'"],
        [
          "content_sections_published_content_check",
          "published_content, published_at",
          "'[]', now()",
        ],
      ]) {
        await db.query("savepoint not_object")
        const error = await db
          .query(
            `insert into public.content_sections (page_slug, key, kind, ${columns})
             values ('contact', $1, 'test', ${values})`,
            [testName(constraint).toLowerCase()]
          )
          .then(
            () => null,
            (e: { code?: string; constraint?: string }) => e
          )
        await db.query("rollback to savepoint not_object")
        expect(error).toMatchObject({ code: "23514", constraint })
      }
    })
  })

  it("lets no API role write content", async () => {
    await inRollback(async (db) => {
      await asAnon(db)
      expect(
        (
          await queryError(
            db,
            "update public.content_pages set published_version = 9"
          )
        )?.code
      ).toBe("42501")
    })
  })

  // Story 5.2: the pages and sections of the static public pages
  // (migration public_pages). Their content is made up in the dev project,
  // so only the rows are checked here.
  it("seeds the 5.2 sections with their kinds and order", async () => {
    const rows = await sql(
      `select page_slug, key, kind, sort_order from public.content_sections
       where (page_slug, key) in (
         ('home', 'intro'), ('home', 'contact'), ('about', 'main'),
         ('how-it-works', 'steps'), ('how-it-works', 'faq'),
         ('gallery', 'testimonials'), ('contact', 'intro'), ('site', 'footer'))
       order by page_slug, sort_order`
    )
    expect(rows).toEqual([
      { page_slug: "about", key: "main", kind: "text_block", sort_order: 1 },
      { page_slug: "contact", key: "intro", kind: "text_block", sort_order: 0 },
      {
        page_slug: "gallery",
        key: "testimonials",
        kind: "testimonials",
        sort_order: 1,
      },
      { page_slug: "home", key: "intro", kind: "text_block", sort_order: 2 },
      { page_slug: "home", key: "contact", kind: "text_block", sort_order: 5 },
      { page_slug: "how-it-works", key: "steps", kind: "steps", sort_order: 1 },
      { page_slug: "how-it-works", key: "faq", kind: "faq", sort_order: 2 },
      { page_slug: "site", key: "footer", kind: "footer", sort_order: 1 },
    ])
  })

  it("shows a 5.2 section to anon only once it is published", async () => {
    await inRollback(async (db) => {
      // about and about › main as the migration left them: not published.
      await db.query(
        `update public.content_sections
         set draft_content = null, published_content = null, published_at = null
         where page_slug = 'about'`
      )
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null
         where slug = 'about'`
      )
      const admin = randomUUID()
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        admin,
      ])
      const main = { title: testName("about"), body: "b" }
      const anonMain = async () => {
        await asAnon(db)
        const { rows } = await db.query(
          `${SECTIONS} where page_slug = 'about' and key = 'main'`
        )
        await db.query("reset role")
        return rows
      }

      await asAuthenticated(db, admin)
      await db.query(
        "select public.admin_set_content_draft('about', 'main', $1::jsonb)",
        [JSON.stringify(main)]
      )
      await db.query("reset role")
      expect(await anonMain()).toEqual([])

      await asAuthenticated(db, admin)
      await db.query("select public.admin_publish_content('about', $1)", [
        randomUUID(),
      ])
      await db.query("reset role")
      expect(await anonMain()).toEqual([
        {
          page_slug: "about",
          key: "main",
          kind: "text_block",
          published_content: main,
        },
      ])
    })
  })

  // The card's post-join message without its first sentence (user decision
  // 2026-10-02, migration update_card_post_join_message); button unchanged.
  it("seeds the approved card post-join message and button", async () => {
    const rows = await sql(
      "select post_join_message, post_join_button_label from public.products where type = 'card'"
    )
    expect(rows).toEqual([
      {
        post_join_message:
          "כדאי לבחור כבר עכשיו את כל ארבעת התאריכים שנוחים לך ולהבטיח את מקומך.",
        post_join_button_label: "בואי נבחר תאריכים",
      },
    ])
  })
})
