import type { MetadataRoute } from "next"
import { cacheLife } from "next/cache"

import { getPublishedAt, getPublishedPageSlugs } from "@/lib/content/pages"
import { buildSitemap, SITEMAP_CONTENT_SLUGS } from "@/lib/seo/sitemap"
import { listUpcomingPublicSessions } from "@/lib/sessions/public"
import { siteUrl } from "@/lib/site-url"

// /sitemap.xml (fix-search-ready): the public pages and the upcoming
// published sessions (lib/seo/sitemap.ts). Published content only, through
// the cached anon readers.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [publishedLegalSlugs, sessions, dates] = await Promise.all([
    getPublishedPageSlugs(["privacy", "terms"]),
    upcomingSessions(),
    Promise.all(
      SITEMAP_CONTENT_SLUGS.map(
        async (slug) => [slug, await getPublishedAt(slug)] as const
      )
    ),
  ])
  return buildSitemap({
    base: siteUrl(),
    publishedLegalSlugs,
    publishedAt: Object.fromEntries(dates),
    sessions,
  })
}

// The upcoming published sessions' ids. A read error is logged (its kind
// only) and lists none, so the sitemap (and `next build` without the DB)
// still works; it is caught outside the cache, so the error is not cached.
async function upcomingSessions(): Promise<
  { id: string; starts_at: string }[]
> {
  try {
    return await cachedUpcomingSessions()
  } catch (error) {
    console.error("sitemap.sessions_read_failed", {
      error: error instanceof Error ? error.name : "unknown",
    })
    return []
  }
}

// Cached for minutes: a new session reaches the sitemap within them. The
// limit is far above the sessions ever open at once (the default 100 would
// drop some silently).
async function cachedUpcomingSessions(): Promise<
  { id: string; starts_at: string }[]
> {
  "use cache"
  cacheLife("minutes")
  const list = await listUpcomingPublicSessions(1000)
  return list.map(({ id, starts_at }) => ({ id, starts_at }))
}
