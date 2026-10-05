import type { z } from "zod"

import { schemaForSection } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

// The content editor's view of admin_get_content_page (stories 5.1, 5.3) and
// the pure rules on it: which sections are edited here, a section's pending
// draft and chip, and the field errors of a draft.

// A section of the site (content_sections: page_slug, key, kind).
export type SectionRef = { slug: EditableSlug; key: string; kind: string }

// The editor's pages are grouped by where they are on the site (story 5.3):
// each is the list of its sections, in the site's order. about › main is
// shown only on the home page, so it is a row of "home"; the testimonials
// are also shown on the home page but edited in "gallery". Saving and
// publishing act on a section's slug.
export const EDITABLE_PAGES = {
  home: [
    { slug: "home", key: "hero", kind: "hero" },
    { slug: "home", key: "intro", kind: "text_block" },
    { slug: "about", key: "main", kind: "text_block" },
    { slug: "home", key: "contact", kind: "text_block" },
  ],
  "how-it-works": [
    { slug: "how-it-works", key: "steps", kind: "steps" },
    { slug: "how-it-works", key: "faq", kind: "faq" },
  ],
  gallery: [
    { slug: "gallery", key: "photos", kind: "gallery" },
    { slug: "gallery", key: "testimonials", kind: "testimonials" },
  ],
  contact: [
    { slug: "contact", key: "intro", kind: "text_block" },
    { slug: "contact", key: "business_details", kind: "business_details" },
  ],
  "join-form": [
    { slug: "join-form", key: "photo_consent", kind: "photo_consent" },
  ],
  site: [{ slug: "site", key: "footer", kind: "footer" }],
} as const satisfies Record<string, readonly SectionRef[]>

export type EditorPageId = keyof typeof EDITABLE_PAGES

export const EDITOR_PAGE_IDS = Object.keys(EDITABLE_PAGES) as EditorPageId[]

export function isEditorPageId(value: unknown): value is EditorPageId {
  return typeof value === "string" && Object.hasOwn(EDITABLE_PAGES, value)
}

// The content_pages slugs the editor saves and publishes.
export const EDITABLE_SLUGS = [
  "home",
  "about",
  "how-it-works",
  "gallery",
  "contact",
  "join-form",
  "site",
] as const

export type EditableSlug = (typeof EDITABLE_SLUGS)[number]

export function isEditableSlug(value: unknown): value is EditableSlug {
  return (
    typeof value === "string" &&
    (EDITABLE_SLUGS as readonly string[]).includes(value)
  )
}

// The slugs of an editor page, in order, without repeats.
export function slugsOf(pageId: EditorPageId): EditableSlug[] {
  const slugs: EditableSlug[] = []
  for (const ref of EDITABLE_PAGES[pageId]) {
    if (!slugs.includes(ref.slug)) slugs.push(ref.slug)
  }
  return slugs
}

// The section of an editor page under key (keys are unique in a page).
export function sectionRefOf(
  pageId: EditorPageId,
  key: string
): SectionRef | null {
  return EDITABLE_PAGES[pageId].find((ref) => ref.key === key) ?? null
}

// The edited section with this slug and key, from any page.
export function findSectionRef(slug: string, key: string): SectionRef | null {
  for (const id of EDITOR_PAGE_IDS) {
    const ref = EDITABLE_PAGES[id].find(
      (item) => item.slug === slug && item.key === key
    )
    if (ref) return ref
  }
  return null
}

// The editor page a section is edited in.
export function editorPageOf(slug: string, key: string): EditorPageId | null {
  return (
    EDITOR_PAGE_IDS.find((id) =>
      EDITABLE_PAGES[id].some((ref) => ref.slug === slug && ref.key === key)
    ) ?? null
  )
}

// Pages whose content is used across the site (AD-16): the business details
// (contact) and the footer (site) are also tagged content:global.
const GLOBAL_PAGES: readonly string[] = ["contact", "site"]

// The cache tags a publish of the page updates.
export function publishTags(slug: string): string[] {
  return GLOBAL_PAGES.includes(slug)
    ? [`content:${slug}`, "content:global"]
    : [`content:${slug}`]
}

export type ContentObject = Record<string, unknown>

export type ContentSection = {
  id: string
  key: string
  kind: string
  sort_order: number
  hidden: boolean
  draft_content: ContentObject | null
  published_content: ContentObject | null
  published_at: string | null
  updated_at: string
}

export type ContentPage = {
  slug: string
  published_version: number
  published_at: string | null
  sections: ContentSection[]
}

// JSON with sorted keys, so two objects compare by value (jsonb does not
// keep key order).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as ContentObject)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

export function sameContent(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null)
}

// A draft that publishing would publish (as admin_publish_content: not
// empty and different from what is published).
export function hasPendingDraft(
  section: Pick<ContentSection, "draft_content" | "published_content">
): boolean {
  const draft = section.draft_content
  if (!draft || Object.keys(draft).length === 0) return false
  return !sameContent(draft, section.published_content)
}

export type PageStatus = "draft" | "published" | "changed"

// DESIGN › content-section-row, for one section: never published -> draft;
// published with a pending draft -> unpublished changes; otherwise
// published.
export function sectionStatus(
  page: Pick<ContentPage, "published_at">,
  section: ContentSection | null
): PageStatus {
  if (!section || !page.published_at || !section.published_content) {
    return "draft"
  }
  return hasPendingDraft(section) ? "changed" : "published"
}

// The chip of an editor page, over its sections (refs; all of the pages'
// sections when left out), across its slugs: unpublished changes when any
// has a pending draft, draft when none is published, otherwise published.
export function pageStatus(
  pages: readonly Pick<ContentPage, "slug" | "published_at" | "sections">[],
  refs?: readonly Pick<SectionRef, "slug" | "key">[]
): PageStatus {
  const statuses = pages.flatMap((page) =>
    page.sections
      .filter(
        (section) =>
          !refs ||
          refs.some((ref) => ref.slug === page.slug && ref.key === section.key)
      )
      .map((section) => sectionStatus(page, section))
  )
  if (statuses.includes("changed")) return "changed"
  if (statuses.every((status) => status === "draft")) return "draft"
  return "published"
}

// A section is hidden when what would be shown (the saved draft, else what
// is published) says so (story 5.3).
export function sectionHidden(section: ContentSection | null): boolean {
  return editorContent(section).hidden === true
}

export function sectionOf(
  page: ContentPage,
  key: string
): ContentSection | null {
  return page.sections.find((section) => section.key === key) ?? null
}

// What the editor starts from: the saved draft, else what is published.
export function editorContent(section: ContentSection | null): ContentObject {
  return section?.draft_content ?? section?.published_content ?? {}
}

export type FieldError =
  | { kind: "required" }
  | { kind: "tooLong"; max: number }
  | { kind: "phone" }
  | { kind: "url" }
  | { kind: "invalid" }

// The first error of each field, from the section's schema
// (schemaForSection). A field is named by its path: "title", or
// "items.2.text" for a field of the third item.
export function fieldErrors(
  ref: SectionRef,
  content: unknown
): Record<string, FieldError> | null {
  const schema = schemaForSection(ref.slug, ref.key, ref.kind)
  if (!schema) return { "": { kind: "invalid" } }
  const parsed = schema.safeParse(content)
  if (parsed.success) return null
  const errors: Record<string, FieldError> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path.map(String).join(".")
    if (field in errors) continue
    errors[field] = toFieldError(issue)
  }
  return errors
}

export function fieldErrorMessage(error: FieldError): string {
  const copy = adminCopy.content.fieldError
  return error.kind === "tooLong" ? copy.tooLong(error.max) : copy[error.kind]
}

function toFieldError(issue: z.core.$ZodIssue): FieldError {
  switch (issue.code) {
    case "too_small":
      return { kind: "required" }
    case "too_big":
      return { kind: "tooLong", max: Number(issue.maximum) }
    // A missing field (the editor sends text only).
    case "invalid_type":
      return { kind: "required" }
    case "invalid_format":
      return issue.format === "url" ? { kind: "url" } : { kind: "invalid" }
    case "custom":
      return { kind: "phone" }
    default:
      return { kind: "invalid" }
  }
}

// The short detail of a section's row: its title (or first line), or how
// many items its list has; "" when there is nothing to say.
export function sectionSummary(content: ContentObject): string {
  if (Array.isArray(content.items)) {
    return adminCopy.content.itemCount(content.items.length)
  }
  for (const name of ["title", "question", "business_name", "whatsapp_phone"]) {
    const value = content[name]
    if (typeof value === "string" && value.trim()) {
      const line = value.trim().split("\n")[0]
      return line.length > 60 ? `${line.slice(0, 60)}…` : line
    }
  }
  return ""
}
