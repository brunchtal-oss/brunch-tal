import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { ConceptRow } from "./concept-draft"
import { ConceptsList } from "./concepts-list"
import { toConceptRow } from "./load-concept"

const copy = adminCopy.concepts

const row = (overrides: Partial<ConceptRow> = {}): ConceptRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "יווני",
  description: null,
  default_kind: "couple",
  archived_at: null,
  image: null,
  image_path: null,
  ...overrides,
})

describe("ConceptsList", () => {
  it("shows the name, the kind and a link to the editor", () => {
    const html = renderToStaticMarkup(<ConceptsList rows={[row()]} />)
    expect(html).toContain("יווני")
    expect(html).toContain(copy.kinds.couple)
    expect(html).toContain(
      'href="/admin/concepts/11111111-1111-4111-8111-111111111111"'
    )
    expect(html).not.toContain(copy.archivedChip)
    expect(html).not.toContain(copy.showArchive)
  })

  it("hides the archived behind the archive toggle", () => {
    const html = renderToStaticMarkup(
      <ConceptsList
        rows={[
          row(),
          row({
            id: "22222222-2222-4222-8222-222222222222",
            name: "ישן",
            archived_at: "2026-10-10T10:00:00Z",
          }),
        ]}
      />
    )
    expect(html).toContain(copy.showArchive)
    expect(html).not.toContain("ישן")
  })

  it("shows the published photo as a thumbnail", () => {
    const html = renderToStaticMarkup(
      <ConceptsList
        rows={[
          row({
            image: { media_id: "m", alt: "", focus_x: 20, focus_y: 80 },
            image_path: "m.jpg",
          }),
        ]}
      />
    )
    expect(html).toContain("media-public")
    expect(html).toContain("object-position:20% 80%")
  })

  it("shows the empty state", () => {
    expect(renderToStaticMarkup(<ConceptsList rows={[]} />)).toContain(
      copy.empty
    )
  })
})

describe("toConceptRow", () => {
  it("keeps the image and its published path", () => {
    const converted = toConceptRow({
      id: "c",
      name: "n",
      description: null,
      default_kind: "regular",
      archived_at: null,
      image: {
        id: "m",
        public_path: "m.jpg",
        alt_text: null,
        focus_x: 10,
        focus_y: 90,
        publish_state: "published",
      },
    })
    expect(converted.image).toEqual({
      media_id: "m",
      alt: "",
      focus_x: 10,
      focus_y: 90,
    })
    expect(converted.image_path).toBe("m.jpg")
  })

  it("has no thumbnail for an image that is not published", () => {
    const converted = toConceptRow({
      id: "c",
      name: "n",
      description: null,
      default_kind: "regular",
      archived_at: null,
      image: {
        id: "m",
        public_path: "m.jpg",
        alt_text: "a",
        focus_x: 50,
        focus_y: 50,
        publish_state: "hidden",
      },
    })
    expect(converted.image_path).toBeNull()
  })
})
