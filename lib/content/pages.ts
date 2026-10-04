import { cacheLife, cacheTag } from "next/cache"

import { createPublicClient } from "@/lib/supabase/public"

import { schemaForKind, type ContentByKind } from "./schema"

// A published section of a public page, parsed with its kind's schema.
export type PublishedSection = {
  [K in keyof ContentByKind]: { kind: K; content: ContentByKind[K] }
}[keyof ContentByKind]

// key -> section, in the page's order.
export type PublishedSections = Record<string, PublishedSection>

// The published sections of a public page (story 5.2, AD-16): cached, read
// with the anon client (RLS lets anon see only published, not hidden rows of
// a published page, and only their published columns), tagged
// content:<slug> for admin_publish_content. The site's footer (site) is also
// tagged content:global, with the business details. A section that does not
// parse (or whose kind has no schema) is left out, so the rest of the page
// still shows. A read error is logged and gives {}: the page is shown
// without its sections (and `next build` does not fail without the DB).
export async function getPublishedSections(
  slug: string
): Promise<PublishedSections> {
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
    return {}
  }

  const sections: PublishedSections = {}
  for (const row of data ?? []) {
    const parsed = schemaForKind(row.kind)?.safeParse(row.published_content)
    if (parsed?.success) {
      sections[row.key] = {
        kind: row.kind,
        content: parsed.data,
      } as PublishedSection
    }
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
