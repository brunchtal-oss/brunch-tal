import type { z } from "zod"

import { schemaForKind } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

// The content editor's view of admin_get_content_page (story 5.1) and the
// pure rules on it: which pages are edited here, a section's pending draft,
// the chip of a page, and the field errors of a draft.

// The pages edited in 5.1, each with its one section (5.3 adds the rest).
export const EDITABLE_PAGES = {
  home: { key: "hero" },
  contact: { key: "business_details" },
} as const

export type EditableSlug = keyof typeof EDITABLE_PAGES

export function isEditableSlug(value: unknown): value is EditableSlug {
  return typeof value === "string" && Object.hasOwn(EDITABLE_PAGES, value)
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

// DESIGN › content-section-row: never published -> draft; published with a
// pending draft -> unpublished changes; otherwise published.
export function pageStatus(
  page: Pick<ContentPage, "published_at" | "sections">
): PageStatus {
  if (!page.published_at) return "draft"
  return page.sections.some(hasPendingDraft) ? "changed" : "published"
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

// The first error of each top-level field, from the kind's schema.
export function fieldErrors(
  kind: string,
  content: unknown
): Record<string, FieldError> | null {
  const schema = schemaForKind(kind)
  if (!schema) return { "": { kind: "invalid" } }
  const parsed = schema.safeParse(content)
  if (parsed.success) return null
  const errors: Record<string, FieldError> = {}
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "")
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
