import { describe, expect, it } from "vitest"

import {
  EDITABLE_PAGES,
  EDITOR_PAGE_IDS,
  editorContent,
  editorPageOf,
  fieldErrorMessage,
  fieldErrors,
  findSectionRef,
  hasPendingDraft,
  isEditableSlug,
  isEditorPageId,
  missingStatementFields,
  pageStatus,
  publishTags,
  sameContent,
  sectionHidden,
  sectionRefOf,
  sectionStatus,
  sectionSummary,
  slugsOf,
  statementPublishBlock,
  type ContentPage,
  type ContentSection,
  type SectionRef,
} from "./content-items"

function section(values: Partial<ContentSection>): ContentSection {
  return {
    id: "1",
    key: "hero",
    kind: "hero",
    sort_order: 1,
    hidden: false,
    draft_content: null,
    published_content: null,
    published_at: null,
    updated_at: "2026-10-04T10:00:00+00:00",
    ...values,
  }
}

describe("content items", () => {
  it("saves and publishes the slugs of the editor only", () => {
    for (const slug of [
      "home",
      "about",
      "how-it-works",
      "gallery",
      "contact",
      "join-form",
      "site",
      "privacy",
      "terms",
      "accessibility",
    ]) {
      expect(isEditableSlug(slug)).toBe(true)
    }
    expect(isEditableSlug("join")).toBe(false)
    expect(isEditableSlug("toString")).toBe(false)
  })

  it("groups the sections by where they are on the site", () => {
    expect(EDITOR_PAGE_IDS).toEqual([
      "home",
      "how-it-works",
      "gallery",
      "contact",
      "join-form",
      "site",
      "privacy",
      "terms",
      "accessibility",
    ])
    expect(EDITABLE_PAGES.home.map((ref) => `${ref.slug}/${ref.key}`)).toEqual([
      "home/hero",
      "home/intro",
      "about/main",
      "home/contact",
    ])
    expect(slugsOf("home")).toEqual(["home", "about"])
    expect(slugsOf("contact")).toEqual(["contact"])
    expect(isEditorPageId("about")).toBe(false)
    expect(isEditorPageId("site")).toBe(true)
    expect(isEditorPageId("constructor")).toBe(false)
  })

  it("finds a section by page and key, or by slug and key", () => {
    expect(sectionRefOf("home", "main")).toEqual({
      slug: "about",
      key: "main",
      kind: "text_block",
    })
    expect(sectionRefOf("home", "faq")).toBeNull()
    expect(sectionRefOf("contact", "intro")?.slug).toBe("contact")
    expect(findSectionRef("about", "main")?.kind).toBe("text_block")
    expect(findSectionRef("home", "main")).toBeNull()
    expect(findSectionRef("site", "footer")?.kind).toBe("footer")
    expect(editorPageOf("gallery", "testimonials")).toBe("gallery")
    expect(editorPageOf("about", "main")).toBe("home")
  })

  it("updates content:global for the business details and the footer", () => {
    expect(publishTags("home")).toEqual(["content:home"])
    expect(publishTags("about")).toEqual(["content:about"])
    expect(publishTags("contact")).toEqual([
      "content:contact",
      "content:global",
    ])
    expect(publishTags("site")).toEqual(["content:site", "content:global"])
  })

  it("compares content by value, not key order", () => {
    expect(sameContent({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true)
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameContent(null, undefined)).toBe(true)
  })

  it.each([
    ["no draft", null, null, false],
    ["an empty draft", {}, null, false],
    ["a new draft", { a: 1 }, null, true],
    ["a changed draft", { a: 2 }, { a: 1 }, true],
    ["a published draft", { a: 1 }, { a: 1 }, false],
  ])("%s is pending: %s", (_label, draft, published, expected) => {
    expect(
      hasPendingDraft({ draft_content: draft, published_content: published })
    ).toBe(expected)
  })

  it("gives each section its chip", () => {
    const published = { published_at: "2026-10-04T10:00:00+00:00" }
    expect(sectionStatus(published, null)).toBe("draft")
    expect(sectionStatus({ published_at: null }, section({}))).toBe("draft")
    expect(sectionStatus(published, section({ draft_content: { a: 1 } }))).toBe(
      "draft"
    )
    expect(
      sectionStatus(
        published,
        section({ draft_content: { a: 1 }, published_content: { a: 1 } })
      )
    ).toBe("published")
    expect(
      sectionStatus(
        published,
        section({ draft_content: { a: 2 }, published_content: { a: 1 } })
      )
    ).toBe("changed")
  })

  it("gives each page the chip of all its slugs", () => {
    const at = "2026-10-04T10:00:00+00:00"
    const done = section({
      draft_content: { a: 1 },
      published_content: { a: 1 },
    })
    const changed = section({
      key: "main",
      draft_content: { a: 2 },
      published_content: { a: 1 },
    })
    expect(
      pageStatus([
        { slug: "home", published_at: null, sections: [section({})] },
      ])
    ).toBe("draft")
    expect(
      pageStatus([{ slug: "home", published_at: at, sections: [done] }])
    ).toBe("published")
    expect(
      pageStatus([
        { slug: "home", published_at: at, sections: [done] },
        { slug: "about", published_at: at, sections: [changed] },
      ])
    ).toBe("changed")
    // Only the page's own sections count.
    expect(
      pageStatus(
        [
          { slug: "home", published_at: at, sections: [done] },
          { slug: "about", published_at: at, sections: [changed] },
        ],
        [{ slug: "home", key: "hero" }]
      )
    ).toBe("published")
  })

  it("says a section is hidden from what would be shown", () => {
    expect(sectionHidden(null)).toBe(false)
    expect(
      sectionHidden(section({ published_content: { hidden: true } }))
    ).toBe(true)
    expect(
      sectionHidden(
        section({
          draft_content: { a: 1 },
          published_content: { hidden: true },
        })
      )
    ).toBe(false)
  })

  it("sums a section up in its row", () => {
    expect(sectionSummary({ title: "line 1\nline 2" })).toBe("line 1")
    expect(sectionSummary({ items: [{}, {}] })).toContain("2")
    expect(sectionSummary({ question: "q" })).toBe("q")
    expect(sectionSummary({})).toBe("")
  })

  it("starts the editor from the draft, else the published content", () => {
    expect(editorContent(null)).toEqual({})
    expect(editorContent(section({ published_content: { a: 1 } }))).toEqual({
      a: 1,
    })
    expect(
      editorContent(
        section({ draft_content: { a: 2 }, published_content: { a: 1 } })
      )
    ).toEqual({ a: 2 })
  })

  it("names the first error of each field, inside items too", () => {
    const hero: SectionRef = { slug: "home", key: "hero", kind: "hero" }
    expect(fieldErrors(hero, { title: "t", cta_label: "c" })).toBeNull()
    expect(
      fieldErrors(hero, { title: "", description: "x".repeat(301) })
    ).toEqual({
      title: { kind: "required" },
      description: { kind: "tooLong", max: 300 },
    })
    expect(fieldErrors(hero, {})).toMatchObject({
      title: { kind: "required" },
    })
    expect(
      fieldErrors(
        { slug: "contact", key: "business_details", kind: "business_details" },
        { whatsapp_phone: "abc", navigation_url: "http://x.example" }
      )
    ).toEqual({
      whatsapp_phone: { kind: "phone" },
      navigation_url: { kind: "url" },
    })
    expect(
      fieldErrors(
        { slug: "gallery", key: "testimonials", kind: "testimonials" },
        {
          items: [
            { name: "a", text: "b" },
            { name: "", text: "c" },
          ],
        }
      )
    ).toEqual({ "items.1.name": { kind: "required" } })
    expect(
      fieldErrors(
        { slug: "site", key: "footer", kind: "footer" },
        { items: [{ label: "x", url: "http://x.example" }] }
      )
    ).toEqual({ "items.0.url": { kind: "url" } })
    expect(
      fieldErrors(
        { slug: "site", key: "footer", kind: "footer" },
        { items: [{ label: "x", url: " " }] }
      )
    ).toEqual({ "items.0.url": { kind: "required" } })
  })

  it("requires the body by section, not by kind", () => {
    const intro: SectionRef = { slug: "home", key: "intro", kind: "text_block" }
    const contact: SectionRef = {
      slug: "home",
      key: "contact",
      kind: "text_block",
    }
    expect(fieldErrors(intro, { title: "t", body: "" })).toEqual({
      body: { kind: "required" },
    })
    expect(fieldErrors(contact, { title: "t", body: "" })).toBeNull()
  })

  it("has a message for each error", () => {
    for (const error of [
      { kind: "required" },
      { kind: "tooLong", max: 40 },
      { kind: "phone" },
      { kind: "url" },
      { kind: "invalid" },
    ] as const) {
      expect(fieldErrorMessage(error)).toBeTruthy()
    }
    expect(fieldErrorMessage({ kind: "tooLong", max: 40 })).toContain("40")
  })
})

describe("statementPublishBlock (story 5.5)", () => {
  const FULL = {
    body: "b",
    contact_name: "n",
    contact_phone: "054-4256456",
    contact_email: "a@example.com",
  }
  const page = (
    draft: Record<string, unknown> | null,
    published: Record<string, unknown> | null = null
  ): ContentPage => ({
    slug: "accessibility",
    published_version: published ? 1 : 0,
    published_at: published ? "2026-10-06T10:00:00Z" : null,
    sections: [
      {
        id: "s",
        key: "statement",
        kind: "accessibility_statement",
        sort_order: 1,
        hidden: false,
        draft_content: draft,
        published_content: published,
        published_at: published ? "2026-10-06T10:00:00Z" : null,
        updated_at: "2026-10-06T10:00:00Z",
      },
    ],
  })

  it("blocks with every required field while there is no draft", () => {
    expect(statementPublishBlock(page(null))).toEqual([
      "body",
      "contact_name",
      "contact_phone",
      "contact_email",
    ])
  })

  it("lists only the missing fields of a partial draft", () => {
    expect(statementPublishBlock(page({ ...FULL, contact_email: "" }))).toEqual(
      ["contact_email"]
    )
    expect(missingStatementFields({ ...FULL, contact_phone: "x" })).toEqual([
      "contact_phone",
    ])
  })

  it("does not block a valid draft or a published statement", () => {
    expect(statementPublishBlock(page(FULL))).toEqual([])
    expect(statementPublishBlock(page({}, FULL))).toEqual([])
  })
})
