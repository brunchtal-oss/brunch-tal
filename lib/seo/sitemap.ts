import type { MetadataRoute } from "next"

import { publicNav, visibleLegalNav } from "@/lib/nav"

// The sitemap's entries (fix-search-ready): the public pages of the menu,
// the legal pages the footer links to (privacy and terms once published,
// the accessibility statement always) and every upcoming published
// session. Never /install, /offline, the auth and token pages, /me or
// /admin.

export type SitemapInput = {
  /** The site's base URL (siteUrl()). */
  base: string
  /** The published slugs among privacy and terms (getPublishedPageSlugs). */
  publishedLegalSlugs: readonly string[]
  /** content slug -> its last publish (getPublishedAt), null when never. */
  publishedAt: Readonly<Record<string, string | null>>
  /** The upcoming published sessions. */
  sessions: readonly { id: string }[]
}

// The content page whose last publish dates a path; /sessions has none
// (its list is the sessions, not content).
const CONTENT_SLUG: Readonly<Record<string, string>> = {
  "/": "home",
  "/how-it-works": "how-it-works",
  "/gallery": "gallery",
  "/contact": "contact",
  "/privacy": "privacy",
  "/terms": "terms",
  "/accessibility": "accessibility",
}

/** The content slugs whose last publish the sitemap reads. */
export const SITEMAP_CONTENT_SLUGS = Object.values(CONTENT_SLUG)

export function buildSitemap(input: SitemapInput): MetadataRoute.Sitemap {
  const paths = [
    ...publicNav.map((item) => item.href),
    ...visibleLegalNav(input.publishedLegalSlugs).map((item) => item.href),
  ]
  const pages = paths.map((path) => {
    const slug = Object.hasOwn(CONTENT_SLUG, path) ? CONTENT_SLUG[path] : null
    const lastModified = slug ? input.publishedAt[slug] : null
    return {
      url: path === "/" ? `${input.base}/` : `${input.base}${path}`,
      ...(lastModified ? { lastModified } : {}),
    }
  })
  const sessions = input.sessions.map((session) => ({
    url: `${input.base}/sessions/${session.id}`,
  }))
  return [...pages, ...sessions]
}
