import { describe, expect, it } from "vitest"

import {
  visibleImages,
  visibleMediaIds,
  visibleSection,
  withResolvedImages,
  type ImageMap,
} from "./visible"

const item = (name: string, hidden?: boolean) => ({
  kind: "text" as const,
  name,
  text: `${name} text`,
  ...(hidden ? { hidden } : {}),
})

describe("visibleSection", () => {
  it("leaves a section without hidden parts as it is", () => {
    const section = {
      kind: "testimonials" as const,
      content: { items: [item("a"), item("b")] },
    }
    expect(visibleSection(section)).toEqual(section)
  })

  it("leaves hidden items out", () => {
    expect(
      visibleSection({
        kind: "testimonials",
        content: { items: [item("a", true), item("b")] },
      })
    ).toEqual({ kind: "testimonials", content: { items: [item("b")] } })
  })

  it.each([
    ["no items", []],
    ["only hidden items", [item("a", true), item("b", true)]],
  ])("drops a list with %s", (_label, items) => {
    expect(visibleSection({ kind: "testimonials", content: { items } })).toBe(
      null
    )
    expect(
      visibleSection({
        kind: "faq",
        content: {
          items: items.map((i) => ({
            question: i.name,
            answer: i.text,
            hidden: i.hidden,
          })),
        },
      })
    ).toBe(null)
  })

  it("drops a hidden section", () => {
    expect(
      visibleSection({
        kind: "text_block",
        content: { title: "t", body: "b", hidden: true },
      })
    ).toBe(null)
    expect(
      visibleSection({
        kind: "steps",
        content: { hidden: true, items: [{ title: "t", body: "b" }] },
      })
    ).toBe(null)
  })

  it("keeps a footer without links, and leaves its hidden links out", () => {
    expect(visibleSection({ kind: "footer", content: { text: "f" } })).toEqual({
      kind: "footer",
      content: { text: "f" },
    })
    expect(
      visibleSection({
        kind: "footer",
        content: {
          items: [
            { label: "a", url: "https://a.example", hidden: true },
            { label: "b", url: "https://b.example" },
          ],
        },
      })
    ).toEqual({
      kind: "footer",
      content: { items: [{ label: "b", url: "https://b.example" }] },
    })
  })

  it("keeps a visible text block", () => {
    const section = { kind: "text_block" as const, content: { title: "t" } }
    expect(visibleSection(section)).toBe(section)
  })
})

const A = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const B = "4f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const C = "5f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const img = (media_id: string, alt?: string) => ({
  media_id,
  focus_x: 20,
  focus_y: 80,
  ...(alt ? { alt } : {}),
})
const resolved = (id: string): ImageMap => ({
  [id]: { src: `https://x/${id}.jpg`, alt: "", focusX: 50, focusY: 50 },
})

// The same rule as private.visible_media_ids (supabase/tests/media.test.ts).
describe("visibleMediaIds", () => {
  it("takes the block image and the images of items that are not hidden", () => {
    expect(
      visibleMediaIds({
        image: img(A),
        items: [
          { image: img(B) },
          { image: img(C), hidden: true },
          { image: { media_id: "not-a-uuid" } },
          { text: "t" },
        ],
      })
    ).toEqual([A, B])
  })

  it("takes nothing from a hidden section or a value that is not content", () => {
    expect(visibleMediaIds({ image: img(A), hidden: true })).toEqual([])
    expect(visibleMediaIds(null)).toEqual([])
    expect(visibleMediaIds([img(A)])).toEqual([])
  })

  it("keeps the alt and focus of each image", () => {
    expect(visibleImages({ items: [{ image: img(A, " alt ") }] })).toEqual([
      { media_id: A, alt: "alt", focus_x: 20, focus_y: 80 },
    ])
  })
})

describe("withResolvedImages", () => {
  it("leaves out a gallery item whose image did not resolve", () => {
    const section = {
      kind: "gallery" as const,
      content: { items: [{ image: img(A) }, { image: img(B) }] },
    }
    expect(withResolvedImages(section, resolved(B))).toEqual({
      kind: "gallery",
      content: { items: [{ image: img(B) }] },
    })
    expect(withResolvedImages(section, {})).toBeNull()
  })

  it("keeps text testimonials and drops an unresolved image one", () => {
    const section = {
      kind: "testimonials" as const,
      content: {
        items: [item("a"), { kind: "image" as const, image: img(A) }],
      },
    }
    expect(withResolvedImages(section, {})).toEqual({
      kind: "testimonials",
      content: { items: [item("a")] },
    })
  })

  it("shows a block without its unresolved image", () => {
    expect(
      withResolvedImages(
        { kind: "text_block", content: { title: "t", image: img(A) } },
        {}
      )
    ).toEqual({ kind: "text_block", content: { title: "t" } })
    expect(
      withResolvedImages(
        { kind: "hero", content: { title: "t", image: img(A) } },
        resolved(A)
      )
    ).toEqual({ kind: "hero", content: { title: "t", image: img(A) } })
  })
})
