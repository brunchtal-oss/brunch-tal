import type { ContentByKind } from "./schema"

// A parsed section of a public page.
export type ParsedSection = {
  [K in keyof ContentByKind]: { kind: K; content: ContentByKind[K] }
}[keyof ContentByKind]

const LIST_KINDS: readonly string[] = ["steps", "faq", "testimonials"]

// What of a parsed section the site shows (story 5.3), shared by the public
// pages (getPublishedSections) and the admin preview, so both show the same
// thing: a hidden section is not shown, a hidden item is left out, and a
// list (steps, faq, testimonials) without a visible item is not a section.
// The footer's hidden links are left out too; the footer itself is never
// hidden. null when nothing of the section is shown.
export function visibleSection(section: ParsedSection): ParsedSection | null {
  const content = section.content as Record<string, unknown>
  if (content.hidden === true) return null

  const items = content.items
  if (!Array.isArray(items)) {
    return LIST_KINDS.includes(section.kind) ? null : section
  }
  const visible = items.filter(
    (item: { hidden?: boolean }) => item.hidden !== true
  )
  if (visible.length === 0 && LIST_KINDS.includes(section.kind)) return null
  return {
    kind: section.kind,
    content: { ...content, items: visible },
  } as ParsedSection
}
