import { describe, expect, it } from "vitest"

import { visibleSection } from "./visible"

const item = (name: string, hidden?: boolean) => ({
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
