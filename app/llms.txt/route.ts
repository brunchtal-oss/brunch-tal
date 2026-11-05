import { connection } from "next/server"

import { getPublishedPageSlugs } from "@/lib/content/pages"
import { isIndexable } from "@/lib/seo/indexing.mjs"
import { buildLlmsTxt, type LlmsPage } from "@/lib/seo/llms"
import {
  getPageSeo,
  pageH1,
  pageSeoDescription,
  SEO_PAGE_PATHS,
  type PageSeo,
  type SeoPageKey,
} from "@/lib/seo/page-seo"
import type { SiteSeo } from "@/lib/seo/site-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import {
  listUpcomingPublicSessions,
  type PublicSession,
} from "@/lib/sessions/public"
import { siteUrl } from "@/lib/site-url"

// /llms.txt (fix-seo-editor): a map of the site for AI tools
// (lib/seo/llms.ts). Only while the site is indexable (SITE_INDEXABLE in
// production); otherwise 404, like a page that is not there. Dynamic: the
// upcoming sessions are read per request (AD-2); the content readers are
// cached.
export async function GET(): Promise<Response> {
  await connection()
  if (!isIndexable(process.env)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
  const [site, seo, sessions, legal] = await Promise.all([
    getSiteSeo(),
    getPageSeo(),
    upcomingSessions(),
    getPublishedPageSlugs(["privacy", "terms"]),
  ])
  const page = (key: SeoPageKey): LlmsPage => ({
    title: pageH1(seo, key, site.name),
    path: SEO_PAGE_PATHS[key],
    description: ownDescription(seo, key, site),
  })
  const body = buildLlmsTxt({
    name: site.name,
    description: site.description,
    base: siteUrl(),
    pages: (
      ["home", "sessions", "how_it_works", "gallery", "contact"] as const
    ).map(page),
    sessions,
    policies: [
      ...(["privacy", "terms"] as const).filter((key) => legal.includes(key)),
      "accessibility" as const,
    ].map(page),
  })
  // A few minutes in the shared cache, so each crawler hit is not a read.
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=300",
    },
  })
}

// A page's own description; the site description already heads the file,
// so a page without one gets none.
function ownDescription(
  seo: PageSeo,
  key: SeoPageKey,
  site: SiteSeo
): string | null {
  const description = pageSeoDescription(seo, key, site)
  return description === site.description ? null : description
}

// The sessions the site lists; a read error lists none (logged).
async function upcomingSessions(): Promise<PublicSession[]> {
  try {
    return await listUpcomingPublicSessions()
  } catch {
    console.error("llms.sessions_read_failed")
    return []
  }
}
