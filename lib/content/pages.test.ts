import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getPublishedAt,
  getPublishedPage,
  getPublishedPageSlugs,
  getPublishedSections,
  sectionContent,
  toSections,
} from "./pages"

const order = vi.fn()
const maybeSingle = vi.fn()
const eq = vi.fn()
const inList = vi.fn()
const select = vi.fn()
const cacheTag = vi.fn()

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: (...args: unknown[]) => cacheTag(...args),
}))
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({ select }),
  }),
}))

beforeEach(() => {
  order.mockReset()
  eq.mockReset()
  select.mockReset()
  cacheTag.mockReset()
  inList.mockReset()
  select.mockReturnValue({ eq, in: inList })
  maybeSingle.mockReset()
  eq.mockReturnValue({ order, maybeSingle })
})

const STEPS = { items: [{ title: "s", body: "b" }] }
const FAQ = { items: [{ question: "q", answer: "a" }] }

describe("getPublishedSections", () => {
  it("parses each section with its kind, tagged content:<slug>", async () => {
    order.mockResolvedValue({
      data: [
        { key: "steps", kind: "steps", published_content: STEPS },
        { key: "faq", kind: "faq", published_content: FAQ },
      ],
      error: null,
    })
    const sections = await getPublishedSections("how-it-works")
    expect(sections).toEqual({
      steps: { kind: "steps", content: STEPS },
      faq: { kind: "faq", content: FAQ },
    })
    expect(Object.keys(sections)).toEqual(["steps", "faq"])
    expect(select).toHaveBeenCalledWith("key, kind, published_content")
    expect(eq).toHaveBeenCalledWith("page_slug", "how-it-works")
    expect(order).toHaveBeenCalledWith("sort_order")
    expect(cacheTag).toHaveBeenCalledWith("content:how-it-works")
    expect(cacheTag).not.toHaveBeenCalledWith("content:global")
  })

  it("leaves out an invalid section and keeps the rest", async () => {
    order.mockResolvedValue({
      data: [
        { key: "steps", kind: "steps", published_content: { title: "x" } },
        { key: "faq", kind: "faq", published_content: FAQ },
        { key: "odd", kind: "unknown", published_content: { a: 1 } },
        { key: "empty", kind: "text_block", published_content: null },
      ],
      error: null,
    })
    await expect(getPublishedSections("how-it-works")).resolves.toEqual({
      faq: { kind: "faq", content: FAQ },
    })
  })

  it("tags the footer content:global too", async () => {
    order.mockResolvedValue({ data: [], error: null })
    await getPublishedSections("site")
    expect(cacheTag).toHaveBeenCalledWith("content:site")
    expect(cacheTag).toHaveBeenCalledWith("content:global")
  })

  it("leaves hidden sections and items out (story 5.3)", async () => {
    order.mockResolvedValue({
      data: [
        {
          key: "steps",
          kind: "steps",
          published_content: { hidden: true, ...STEPS },
        },
        {
          key: "faq",
          kind: "faq",
          published_content: {
            items: [
              { question: "hidden", answer: "a", hidden: true },
              ...FAQ.items,
            ],
          },
        },
      ],
      error: null,
    })
    await expect(getPublishedSections("how-it-works")).resolves.toEqual({
      faq: { kind: "faq", content: FAQ },
    })
  })

  it("gives {} on a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    order.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getPublishedSections("about")).resolves.toEqual({})
    expect(log).toHaveBeenCalledWith("content.read_failed", { page: "about" })
    log.mockRestore()
  })
})

describe("getPublishedPageSlugs", () => {
  it("returns the published slugs, tagged content:<slug> for each", async () => {
    inList.mockResolvedValue({ data: [{ slug: "privacy" }], error: null })
    await expect(getPublishedPageSlugs(["terms", "privacy"])).resolves.toEqual([
      "privacy",
    ])
    expect(inList).toHaveBeenCalledWith("slug", ["terms", "privacy"])
    expect(cacheTag).toHaveBeenCalledWith("content:terms")
    expect(cacheTag).toHaveBeenCalledWith("content:privacy")
  })

  it("gives [] on a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    inList.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getPublishedPageSlugs(["privacy"])).resolves.toEqual([])
    log.mockRestore()
  })
})

describe("toSections", () => {
  it("is the same rule for the preview's drafts", () => {
    expect(
      toSections([
        { key: "faq", kind: "faq", content: { items: [] } },
        { key: "steps", kind: "steps", content: STEPS },
        {
          key: "bad",
          kind: "faq",
          content: { items: [{ question: "q".repeat(301) }] },
        },
        // Every field is optional (2026-10-08): an item with nothing in it
        // is left out, and a list left empty is not a section.
        {
          key: "empty",
          kind: "faq",
          content: { items: [{ question: " ", answer: "" }] },
        },
        { key: "blank", kind: "text_block", content: { title: " " } },
      ])
    ).toEqual({ steps: { kind: "steps", content: STEPS } })
  })
})

describe("sectionContent", () => {
  const sections = {
    steps: { kind: "steps", content: STEPS },
  } as const

  it("returns the content of the expected kind only", () => {
    expect(sectionContent(sections, "steps", "steps")).toEqual(STEPS)
    expect(sectionContent(sections, "steps", "faq")).toBeNull()
    expect(sectionContent(sections, "faq", "faq")).toBeNull()
    expect(sectionContent(sections, "toString", "faq")).toBeNull()
  })
})

// Story 5.4: the images of a page come from media_assets (anon, published
// rows only); an item whose image does not resolve is left out.
describe("getPublishedPage", () => {
  const A = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
  const B = "4f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
  const GALLERY = {
    items: [
      { image: { media_id: A, focus_x: 20, focus_y: 80 } },
      { image: { media_id: B, focus_x: 50, focus_y: 50 } },
    ],
  }

  beforeEach(() => {
    order.mockResolvedValue({
      data: [{ key: "photos", kind: "gallery", published_content: GALLERY }],
      error: null,
    })
  })

  it("resolves the published images and drops an item that does not resolve", async () => {
    inList.mockResolvedValue({
      data: [
        {
          id: A,
          public_path: `${A}.jpg`,
          alt_text: "שולחן",
          focus_x: 20,
          focus_y: 80,
        },
      ],
      error: null,
    })
    const page = await getPublishedPage("gallery")
    expect(select).toHaveBeenCalledWith(
      "id, public_path, alt_text, focus_x, focus_y"
    )
    expect(inList).toHaveBeenCalledWith("id", [A, B])
    expect(page.images[A].src).toMatch(
      new RegExp(`/storage/v1/object/public/media-public/${A}\\.jpg$`)
    )
    expect(page.images[A]).toMatchObject({
      alt: "שולחן",
      focusX: 20,
      focusY: 80,
    })
    expect(page.images[B]).toBeUndefined()
    expect(page.sections.photos).toEqual({
      kind: "gallery",
      content: { items: [GALLERY.items[0]] },
    })
  })

  it("gives no images when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    inList.mockResolvedValue({ data: null, error: { message: "down" } })
    const page = await getPublishedPage("gallery")
    expect(page.images).toEqual({})
    // Without a resolved image the gallery is not a section.
    expect(page.sections.photos).toBeUndefined()
  })
})

describe("getPublishedAt (story 5.5)", () => {
  it("returns the page's published_at, tagged content:<slug>", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_at: "2026-10-06T10:00:00+00:00" },
      error: null,
    })
    expect(await getPublishedAt("privacy")).toBe("2026-10-06T10:00:00+00:00")
    expect(select).toHaveBeenCalledWith("published_at")
    expect(eq).toHaveBeenCalledWith("slug", "privacy")
    expect(cacheTag).toHaveBeenCalledWith("content:privacy")
  })

  it("is null without a row (never published: RLS hides it)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await getPublishedAt("terms")).toBeNull()
  })

  it("is null on a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    expect(await getPublishedAt("accessibility")).toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
