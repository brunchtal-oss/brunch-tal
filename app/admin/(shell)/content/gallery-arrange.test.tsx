import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ArrangeBar, GalleryArrange } from "./gallery-arrange"
import { arrangeTap, swapItems, type EditorItem } from "./section-fields"

const copy = adminCopy.content.arrange

function items(n: number, hidden: number[] = []): EditorItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    hidden: hidden.includes(i),
    values: { caption: "" },
    images: {
      image: {
        media_id: `3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7${i}`,
        alt: "",
        focus_x: 50,
        focus_y: 50,
      },
    },
  }))
}

const ids = (list: EditorItem[]) => list.map((item) => item.id)

// The gallery's arrange view (user decision 2026-10-08).
describe("swapItems", () => {
  it("swaps the two photos only; the others stay put", () => {
    expect(ids(swapItems(items(5), 0, 3))).toEqual([
      "i3",
      "i1",
      "i2",
      "i0",
      "i4",
    ])
    expect(ids(swapItems(items(5), 4, 1))).toEqual([
      "i0",
      "i4",
      "i2",
      "i3",
      "i1",
    ])
  })

  it("a neighbour swap is the arrows' one step", () => {
    expect(ids(swapItems(items(3), 1, 2))).toEqual(["i0", "i2", "i1"])
  })

  it("keeps the order for the same place or out of range, as a copy", () => {
    const list = items(3)
    for (const [a, b] of [
      [1, 1],
      [-1, 0],
      [0, 3],
      [5, 0],
    ]) {
      const next = swapItems(list, a, b)
      expect(ids(next)).toEqual(["i0", "i1", "i2"])
      expect(next).not.toBe(list)
    }
  })

  it("swaps a hidden photo like any other, keeping its flag", () => {
    const next = swapItems(items(3, [2]), 2, 0)
    expect(next[0]).toMatchObject({ id: "i2", hidden: true })
    expect(next[2]).toMatchObject({ id: "i0", hidden: false })
  })
})

describe("arrangeTap", () => {
  it("selects, cancels on the same photo, swaps with another", () => {
    expect(arrangeTap(null, 2)).toEqual({ kind: "select", index: 2 })
    expect(arrangeTap(2, 2)).toEqual({ kind: "cancel" })
    expect(arrangeTap(2, 0)).toEqual({ kind: "swap", a: 2, b: 0 })
  })
})

describe("GalleryArrange", () => {
  it("shows every photo in the chosen columns, none selected, hidden ones dimmed with their mark", () => {
    const list = items(4, [1])
    const html = renderToStaticMarkup(
      <GalleryArrange
        items={list}
        columns="4"
        previewUrls={{ [list[0].images!.image!.media_id]: "/a.jpg" }}
        onSwap={() => {}}
        announce={() => {}}
      />
    )
    expect(html).toContain("grid-cols-4")
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(4)
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).not.toContain("data-arrange-bar")
    expect(html).toContain(`${copy.photo(2)}, ${copy.hidden}`)
    expect(html).toContain("lucide-eye-off")
    expect(html).toContain("aspect-[4/5]")
  })
})

describe("ArrangeBar", () => {
  it("disables 'קודם' on the first photo and 'אחרי' on the last", () => {
    const first = renderToStaticMarkup(
      <ArrangeBar
        selected={0}
        total={3}
        onStep={() => {}}
        onCancel={() => {}}
      />
    )
    expect(first).toMatch(
      new RegExp(`aria-label="${copy.before(1)}" aria-disabled="true"`)
    )
    expect(first).not.toMatch(
      new RegExp(`aria-label="${copy.after(1)}" aria-disabled`)
    )
    const last = renderToStaticMarkup(
      <ArrangeBar
        selected={2}
        total={3}
        onStep={() => {}}
        onCancel={() => {}}
      />
    )
    expect(last).toMatch(
      new RegExp(`aria-label="${copy.after(3)}" aria-disabled="true"`)
    )
    expect(last).not.toMatch(
      new RegExp(`aria-label="${copy.before(3)}" aria-disabled`)
    )
  })

  it("announces a swap in the agreed words", () => {
    expect(copy.swapped(1, 4)).toBe("תמונות 1 ו-4 הוחלפו")
  })
})
