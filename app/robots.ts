import type { MetadataRoute } from "next"

// Story 5.15 (moved forward, user decision 2026-10-10): the site is open
// without the lock but no crawler may index it until the launch (6.9). The
// X-Robots-Tag header in next.config.mjs covers every response as well.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] }
}
