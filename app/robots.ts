import type { MetadataRoute } from "next"

import { robotsFor } from "@/lib/seo/robots"

// robots.txt (stories 5.15, fix-search-ready): see lib/seo/robots.ts. Read at
// build, so a change of SITE_INDEXABLE needs a redeploy.
export default function robots(): MetadataRoute.Robots {
  return robotsFor(process.env)
}
