import { cacheLife, cacheTag } from "next/cache"

import { publicMediaUrl, type MediaRow } from "@/lib/media/photo"
import { createPublicClient } from "@/lib/supabase/public"

import { schemaForKind, type ContentByKind } from "./schema"
import {
  visibleMediaIds,
  visibleSection,
  withResolvedImages,
  type ImageMap,
  type ParsedSection,
} from "./visible"

export type { ImageMap, ResolvedImage } from "./visible"

// A published section of a public page, parsed with its kind's schema.
export type PublishedSection = ParsedSection

// key -> section, in the page's order.
export type PublishedSections = Record<string, PublishedSection>

// A public page: its sections, and the images they show (story 5.4).
export type PublishedPage = { sections: PublishedSections; images: ImageMap }

// The published sections of a public page (story 5.2, AD-16): cached, read
// with the anon client (RLS lets anon see only published, not hidden rows of
// a published page, and only their published columns), tagged
// content:<slug> for admin_publish_content. The site's footer (site) is also
// tagged content:global, with the business details. A section that does not
// parse (or whose kind has no schema) is left out, so the rest of the page
// still shows; hidden sections and items are left out (visibleSection,
// story 5.3). A read error is logged and gives {}: the page is shown
// without its sections (and `next build` does not fail without the DB).
export async function getPublishedSections(
  slug: string
): Promise<PublishedSections> {
  return (await getPublishedPage(slug)).sections
}

// The same, with the images (story 5.4): every image the visible sections
// show is read from media_assets with the anon client (RLS: published rows
// only), in the same cache entry and tag as the page; an image that is not
// published (or a read error) is left out, and so is its item
// (withResolvedImages).
export async function getPublishedPage(slug: string): Promise<PublishedPage> {
  "use cache"
  cacheTag(`content:${slug}`)
  if (slug === "site") cacheTag("content:global")
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_sections")
    .select("key, kind, published_content")
    .eq("page_slug", slug)
    .order("sort_order")
  if (error) {
    console.error("content.read_failed", { page: slug })
    return { sections: {}, images: {} }
  }

  const sections = toSections(
    (data ?? []).map((row) => ({
      key: row.key,
      kind: row.kind,
      content: row.published_content,
    }))
  )
  const images = await resolvePublishedImages(
    Object.values(sections).flatMap((section) =>
      visibleMediaIds(section.content)
    )
  )
  return { sections: resolveSections(sections, images), images }
}

// media_id -> the published image, read with the anon client. A read error
// is logged and gives {} (the images are not shown).
export async function resolvePublishedImages(
  ids: readonly string[]
): Promise<ImageMap> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const { data, error } = await createPublicClient()
    .from("media_assets")
    .select("id, public_path, alt_text, focus_x, focus_y")
    .in("id", unique)
  if (error) {
    console.error("media.read_failed", {
      mediaIds: unique,
      message: error.message,
    })
    return {}
  }
  const images: ImageMap = {}
  for (const row of (data ?? []) as (MediaRow & { id: string })[]) {
    images[row.id] = {
      src: publicMediaUrl(row.public_path),
      alt: row.alt_text ?? "",
      focusX: row.focus_x,
      focusY: row.focus_y,
    }
  }
  return images
}

// Every section with only the images that resolved; a list left without
// items is not a section.
export function resolveSections(
  sections: PublishedSections,
  images: ImageMap
): PublishedSections {
  const resolved: PublishedSections = {}
  for (const [key, section] of Object.entries(sections)) {
    const next = withResolvedImages(section, images)
    if (next) resolved[key] = next
  }
  return resolved
}

// key -> the visible part of each section that parses with its kind's
// schema. Shared by the public pages (published content) and the admin
// preview (the draft), so both show the same thing.
export function toSections(
  rows: readonly { key: string; kind: string; content: unknown }[]
): PublishedSections {
  const sections: PublishedSections = {}
  for (const row of rows) {
    const parsed = schemaForKind(row.kind)?.safeParse(row.content)
    if (!parsed?.success) continue
    const visible = visibleSection({
      kind: row.kind,
      content: parsed.data,
    } as PublishedSection)
    if (visible) sections[row.key] = visible
  }
  return sections
}

// Which of these public pages are published (RLS shows anon only published
// pages), cached and tagged content:<slug> for each. The footer links to a
// legal page only once it is published (user decision 2026-10-04; the pages
// arrive in 5.5). A read error is logged and gives [].
export async function getPublishedPageSlugs(
  slugs: readonly string[]
): Promise<string[]> {
  "use cache"
  for (const slug of slugs) cacheTag(`content:${slug}`)
  cacheLife("minutes")

  const { data, error } = await createPublicClient()
    .from("content_pages")
    .select("slug")
    .in("slug", [...slugs])
  if (error) {
    console.error("content.read_failed", { pages: slugs })
    return []
  }
  return (data ?? []).map((row) => row.slug)
}

// The section under key when it is of the expected kind, else null.
export function sectionContent<K extends keyof ContentByKind>(
  sections: PublishedSections,
  key: string,
  kind: K
): ContentByKind[K] | null {
  const section = Object.hasOwn(sections, key) ? sections[key] : undefined
  return section?.kind === kind ? (section.content as ContentByKind[K]) : null
}
