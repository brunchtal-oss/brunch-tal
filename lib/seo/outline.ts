import { parseLegalText, type Inline } from "@/components/public/legal-text"
import { schemaForKind, type ContentByKind } from "@/lib/content/schema"
import {
  hasContent,
  visibleSection,
  type ParsedSection,
} from "@/lib/content/visible"
import { fieldId } from "@/app/admin/(shell)/content/section-fields"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import type { SeoPageKey } from "./page-seo"

// A public page's heading outline under its H1 (fix-seo-editor), as the
// site renders it (components/public/*): the H2s and H3s in order. A
// heading from content links to its field in the section's editor; a
// heading of the system (microcopy) has no link; the session names are one
// automatic line. A heading that is empty or hidden on the site is left
// out, by the site's own rules (visibleSection), so the outline matches
// the rendered page (lib/seo/outline.test.tsx renders both).

export type OutlineEntry = {
  level: 2 | 3
  text: string
  /** The field's editor (content headings only). */
  href?: string
  /** Stands for any number of headings of this level (the session names). */
  auto?: true
}

/** A saved section: its key, kind and content (published, in full). */
export type OutlineRow = { key: string; kind: string; content: unknown }

export type OutlineInput = {
  /** content_pages slug -> its published sections. */
  pages: Partial<Record<string, readonly OutlineRow[]>>
  /** home › contact is shown only with a usable WhatsApp number. */
  whatsapp: boolean
  /** Upcoming sessions exist: home's sessions and /sessions' list show
   *  headings only then. */
  upcomingSessions: boolean
}

const fixed = (level: 2 | 3, text: string): OutlineEntry => ({ level, text })

// The field's editor, at the input the editor names (fieldId).
function editHref(page: string, key: string, path: string): string {
  return `/admin/content/${page}/${key}#${fieldId(path)}`
}

// A section's content when the site shows it (parsed and visible), else null.
function shown<K extends keyof ContentByKind>(
  input: OutlineInput,
  slug: string,
  key: string,
  kind: K
): ContentByKind[K] | null {
  const row = input.pages[slug]?.find((item) => item.key === key)
  if (!row || row.kind !== kind) return null
  const parsed = schemaForKind(kind)?.safeParse(row.content)
  if (!parsed?.success) return null
  const visible = visibleSection({
    kind,
    content: parsed.data,
  } as ParsedSection)
  return visible ? (parsed.data as ContentByKind[K]) : null
}

// An item the site shows (visibleSection's rule), with its index in the
// saved list (the editor's field paths).
function visibleItems<T extends { hidden?: boolean }>(
  items: readonly T[]
): { item: T; index: number }[] {
  return items.flatMap((item, index) =>
    item.hidden !== true && hasContent(item as Record<string, unknown>)
      ? [{ item, index }]
      : []
  )
}

// A text block's H2 (its title), linked to its editor.
function textBlockTitle(
  input: OutlineInput,
  slug: string,
  key: string,
  page: string
): OutlineEntry[] {
  const block = shown(input, slug, key, "text_block")
  return block?.title
    ? [{ level: 2, text: block.title, href: editHref(page, key, "title") }]
    : []
}

// A list section's H2 (its title), when the site shows the section.
function listTitle(
  title: string | undefined,
  page: string,
  key: string
): OutlineEntry[] {
  return title
    ? [{ level: 2, text: title, href: editHref(page, key, "title") }]
    : []
}

function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      node.type === "text" ? node.text : inlineText(node.children)
    )
    .join("")
}

// The "## " headings of a legal text (h2), linked to the text's field.
function legalHeadings(
  body: string,
  page: string,
  key: string
): OutlineEntry[] {
  return parseLegalText(body).flatMap((block) =>
    block.type === "heading"
      ? [
          {
            level: 2 as const,
            text: inlineText(block.text),
            href: editHref(page, key, "body"),
          },
        ]
      : []
  )
}

const AUTO_SESSIONS = adminCopy.content.seo.outlineAuto

export function pageOutline(
  pageId: SeoPageKey,
  input: OutlineInput
): OutlineEntry[] {
  switch (pageId) {
    case "home": {
      const testimonials = shown(
        input,
        "gallery",
        "testimonials",
        "testimonials"
      )
      return [
        ...textBlockTitle(input, "home", "intro", "home"),
        ...(input.upcomingSessions
          ? [
              fixed(2, shellCopy.public.sessions.upcoming),
              { level: 3 as const, text: AUTO_SESSIONS, auto: true as const },
            ]
          : []),
        ...textBlockTitle(input, "about", "main", "home"),
        ...listTitle(testimonials?.title, "gallery", "testimonials"),
        ...(input.whatsapp
          ? textBlockTitle(input, "home", "contact", "home")
          : []),
      ]
    }
    // Without sessions the list is a line of text, not headings.
    case "sessions":
      return input.upcomingSessions
        ? [{ level: 2, text: AUTO_SESSIONS, auto: true }]
        : []
    case "how_it_works": {
      const steps = shown(input, "how-it-works", "steps", "steps")
      const faq = shown(input, "how-it-works", "faq", "faq")
      const out: OutlineEntry[] = []
      if (steps) {
        out.push(
          ...(steps.title
            ? listTitle(steps.title, "how-it-works", "steps")
            : [fixed(2, shellCopy.public.sections.steps)])
        )
        for (const { item, index } of visibleItems(steps.items)) {
          if (item.title) {
            out.push({
              level: 3,
              text: item.title,
              href: editHref("how-it-works", "steps", `items.${index}.title`),
            })
          }
        }
      }
      if (faq) out.push(...listTitle(faq.title, "how-it-works", "faq"))
      return out
    }
    case "gallery": {
      const photos = shown(input, "gallery", "photos", "gallery")
      const testimonials = shown(
        input,
        "gallery",
        "testimonials",
        "testimonials"
      )
      return [
        ...listTitle(photos?.title, "gallery", "photos"),
        ...listTitle(testimonials?.title, "gallery", "testimonials"),
      ]
    }
    case "contact":
      return textBlockTitle(input, "contact", "intro", "contact")
    case "privacy":
    case "terms": {
      const legal = shown(input, pageId, "body", "legal_text")
      return legal?.body ? legalHeadings(legal.body, pageId, "body") : []
    }
    case "accessibility": {
      const statement = shown(
        input,
        "accessibility",
        "statement",
        "accessibility_statement"
      )
      if (!statement) return []
      return [
        ...legalHeadings(statement.body, "accessibility", "statement"),
        fixed(2, shellCopy.public.legal.accessibility.contact),
      ]
    }
  }
}

/** The content_pages slugs a page's outline reads. */
export const OUTLINE_SLUGS: Record<SeoPageKey, readonly string[]> = {
  home: ["home", "about", "gallery"],
  sessions: [],
  how_it_works: ["how-it-works"],
  gallery: ["gallery"],
  contact: ["contact"],
  privacy: ["privacy"],
  terms: ["terms"],
  accessibility: ["accessibility"],
}
