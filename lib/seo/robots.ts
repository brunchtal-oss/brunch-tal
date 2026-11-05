import type { MetadataRoute } from "next"

import { isIndexable } from "@/lib/seo/indexing.mjs"
import { siteUrl } from "@/lib/site-url"

// The search and AI crawlers that are named on their own (fix-search-ready),
// so a rule for one of them never hides the "*" rule.
export const NAMED_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
] as const

// Story 5.15 (moved forward, user decision 2026-10-10): the site is open
// without the lock but no crawler may index it until the launch (6.9). The
// X-Robots-Tag header in next.config.mjs covers every response as well.
// fix-search-ready: with SITE_INDEXABLE on in production, every crawler may
// read the site but the API, and the sitemap is listed. /login and /admin are
// not blocked: a blocked page cannot show its noindex.
export function robotsFor(
  env: Record<string, string | undefined>
): MetadataRoute.Robots {
  if (!isIndexable(env)) return { rules: [{ userAgent: "*", disallow: "/" }] }
  return {
    rules: [
      { userAgent: [...NAMED_CRAWLERS], allow: "/", disallow: "/api/" },
      { userAgent: "*", allow: "/", disallow: "/api/" },
    ],
    sitemap: `${siteUrl(env)}/sitemap.xml`,
  }
}
