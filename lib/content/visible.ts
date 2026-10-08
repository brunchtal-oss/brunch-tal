import type { ContentByKind } from "./schema"

// A parsed section of a public page.
export type ParsedSection = {
  [K in keyof ContentByKind]: { kind: K; content: ContentByKind[K] }
}[keyof ContentByKind]

const LIST_KINDS: readonly string[] = [
  "steps",
  "faq",
  "testimonials",
  "gallery",
]

// The kinds whose every field is required anyway: never "empty".
const ALWAYS_FILLED: readonly string[] = [
  "business_details",
  "photo_consent",
  "accessibility_statement",
]

// A value the site can show: a non-blank text, an image, a non-empty list.
function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== ""
  if (Array.isArray(value)) return value.length > 0
  return value !== null && typeof value === "object"
}

// Whether a block or an item has anything to show besides its flags (since
// 2026-10-08 no editor field but three is required, so an item or a block
// may be saved empty).
export function hasContent(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(
    ([key, value]) => key !== "hidden" && key !== "kind" && hasValue(value)
  )
}

// What of a parsed section the site shows (story 5.3), shared by the public
// pages (getPublishedSections) and the admin preview, so both show the same
// thing: a hidden section is not shown, a hidden item is left out, and a
// list (steps, faq, testimonials, gallery) without a visible item is not a section.
// The footer's hidden links are left out too; the footer itself is never
// hidden. An item with nothing in it is left out, and a block with nothing
// at all is not shown (user decision 2026-10-08). null when nothing of the
// section is shown.
export function visibleSection(section: ParsedSection): ParsedSection | null {
  const content = section.content as Record<string, unknown>
  if (content.hidden === true) return null

  const items = content.items
  if (!Array.isArray(items)) {
    if (LIST_KINDS.includes(section.kind)) return null
    if (!ALWAYS_FILLED.includes(section.kind) && section.kind !== "footer") {
      if (!hasContent(content)) return null
    }
    return section
  }
  const visible = items.filter(
    (item: Record<string, unknown> & { hidden?: boolean }) =>
      item.hidden !== true && hasContent(item)
  )
  if (visible.length === 0 && LIST_KINDS.includes(section.kind)) return null
  return {
    kind: section.kind,
    content: { ...content, items: visible },
  } as ParsedSection
}

// The footer's links that can be shown: both a display name and an address
// (each is optional in the editor since 2026-10-08).
export function footerLinks(
  items: readonly { label?: string; url?: string }[] | undefined
): { label: string; url: string }[] {
  return (items ?? []).flatMap((item) =>
    item.label && item.url ? [{ label: item.label, url: item.url }] : []
  )
}

// An image of the site (story 5.4), resolved from media_assets (the public
// file of a published image) or, in the admin preview, from the draft file
// (a signed URL, not optimized by next/image).
export type ResolvedImage = {
  src: string
  alt: string
  focusX: number
  focusY: number
  unoptimized?: boolean
}

// media_id -> its image. An id that is not here is not shown.
export type ImageMap = Record<string, ResolvedImage>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mediaIdOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const id = (value as { media_id?: unknown }).media_id
  return typeof id === "string" && UUID.test(id) ? id : null
}

// The images a section's content shows (story 5.4), the same rule as
// private.visible_media_ids in SQL: none for a hidden section; otherwise
// $.image.media_id and the image of every item that is not hidden.
export function visibleMediaIds(content: unknown): string[] {
  return [...new Set(visibleImages(content).map((image) => image.media_id))]
}

// A visible image of a section's content, as saved: its id, alt and focus.
export type ContentImageRef = {
  media_id: string
  alt: string
  focus_x: number
  focus_y: number
}

function focus(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(100, Math.max(0, value))
    : 50
}

// The visible images (visibleMediaIds), with what the content says about
// each: what publishing publishes, and what the admin preview shows.
export function visibleImages(content: unknown): ContentImageRef[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return []
  }
  const record = content as Record<string, unknown>
  if (record.hidden === true) return []
  const refs: ContentImageRef[] = []
  const add = (value: unknown) => {
    const id = mediaIdOf(value)
    if (!id) return
    const image = value as Record<string, unknown>
    refs.push({
      media_id: id,
      alt: typeof image.alt === "string" ? image.alt.trim() : "",
      focus_x: focus(image.focus_x),
      focus_y: focus(image.focus_y),
    })
  }
  add(record.image)
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (!item || typeof item !== "object") continue
      const entry = item as Record<string, unknown>
      if (entry.hidden === true) continue
      add(entry.image)
    }
  }
  return refs
}

// A visible section with only the images that resolved (story 5.4): a block
// image that did not resolve (an unfinished upload, a hidden image) is
// dropped and the block shows without it; an item whose image did not
// resolve is left out, and a list left without items is not a section.
export function withResolvedImages(
  section: ParsedSection,
  images: ImageMap
): ParsedSection | null {
  const content = { ...(section.content as Record<string, unknown>) }
  const has = (value: unknown) => {
    const id = mediaIdOf(value)
    return id !== null && Object.hasOwn(images, id)
  }
  if (
    "image" in content &&
    content.image !== undefined &&
    !has(content.image)
  ) {
    delete content.image
  }
  if (Array.isArray(content.items)) {
    const items = (content.items as Record<string, unknown>[]).filter(
      (item) =>
        !(item && typeof item === "object" && "image" in item) ||
        has(item.image)
    )
    content.items = items
    if (items.length === 0 && LIST_KINDS.includes(section.kind)) {
      return null
    }
  }
  return { kind: section.kind, content } as ParsedSection
}
