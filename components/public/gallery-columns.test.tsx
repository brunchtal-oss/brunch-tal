import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  fromContent,
  sectionSpec,
  toContent,
} from "@/app/admin/(shell)/content/section-fields"
import { gallerySchema } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

import { GallerySection } from "./sections"

// The gallery's columns (user decision 2026-10-08): 2, 3 or 4, chosen in
// the editor; 3 when missing.
const A = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const ITEM = { image: { media_id: A, focus_x: 50, focus_y: 50 } }
const IMAGES = {
  [A]: { src: "/a.jpg", alt: "a", focusX: 50, focusY: 50 },
}
const GALLERY = { slug: "gallery", key: "photos", kind: "gallery" } as const

describe("gallery columns", () => {
  it("the schema: optional (old content still parses), 2-4 only, the editor's text read as a number", () => {
    expect(gallerySchema.safeParse({ items: [ITEM] }).success).toBe(true)
    expect(gallerySchema.parse({ items: [], columns: "4" }).columns).toBe(4)
    expect(gallerySchema.parse({ items: [], columns: 2 }).columns).toBe(2)
    expect(gallerySchema.parse({ items: [], columns: "" }).columns).toBe(
      undefined
    )
    for (const bad of [1, 5, "x", 3.5]) {
      expect(gallerySchema.safeParse({ items: [], columns: bad }).success).toBe(
        false
      )
    }
  })

  it("the editor: a choice 2 / 3 / 4, 3 for content without it, saved with the block", () => {
    const spec = sectionSpec(GALLERY)
    const field = spec.fields.find((f) => f.name === "columns")
    expect(field).toMatchObject({
      type: "choice",
      label: adminCopy.content.gallery.columns,
      defaultValue: "3",
      options: [
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
      ],
    })
    const state = fromContent(spec, { items: [] })
    expect(state.text.columns).toBe("3")
    expect(fromContent(spec, { items: [], columns: 4 }).text.columns).toBe("4")
    const saved = toContent(spec, {
      ...state,
      text: { ...state.text, columns: "2" },
    })
    expect(gallerySchema.parse(saved).columns).toBe(2)
  })

  it.each([
    [undefined, "grid-cols-3 gap-x-2 gap-y-4"],
    [2, "grid-cols-2 gap-x-3 gap-y-5"],
    [3, "grid-cols-3 gap-x-2 gap-y-4"],
    [4, "grid-cols-4 gap-x-2 gap-y-3"],
  ] as const)("renders %s columns as %s", (columns, classes) => {
    const html = renderToStaticMarkup(
      <GallerySection
        content={{
          items: [{ ...ITEM, caption: "c" }],
          ...(columns ? { columns } : {}),
        }}
        label="gallery"
        images={IMAGES}
      />
    )
    expect(html).toContain(classes)
    // Four narrow columns: a smaller caption that breaks long words, never
    // cut (no clamp).
    expect(html).not.toContain("line-clamp")
    expect(html).toContain("break-words")
    expect(html.includes("text-[13px]")).toBe(columns === 4)
  })
})
