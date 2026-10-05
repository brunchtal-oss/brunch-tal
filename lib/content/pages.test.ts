import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getPublishedPageSlugs,
  getPublishedSections,
  sectionContent,
  toSections,
} from "./pages"

const order = vi.fn()
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
  eq.mockReturnValue({ order })
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
        { key: "bad", kind: "faq", content: { items: [{ question: "q" }] } },
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
