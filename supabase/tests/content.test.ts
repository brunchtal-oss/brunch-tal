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
      await act(db)
      const { rows: privacy } = await db.query(
        `${PAGES} where slug = 'privacy'`
      )
      expect(privacy).toEqual([])
      const { rows: contact } = await db.query(
        `${PAGES} where slug = 'contact'`
      )
      expect(contact).toEqual([{ slug: "contact", published_version: 0 }])
      const { rows: business } = await db.query(
        `${SECTIONS} where page_slug = 'contact' and key = 'business_details'`
      )
      expect(business).toEqual([
        {
          page_slug: "contact",
          key: "business_details",
          kind: "business_details",
          published_content: { whatsapp_phone: "0544256456" },
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
