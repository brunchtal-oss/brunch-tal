import { getBusinessDetails } from "@/lib/content/business-details"
import { getPublishedPage } from "@/lib/content/pages"

import { siteSeoFrom, type SiteSeo } from "./metadata"

export type { SiteSeo } from "./metadata"

// What search and share tags say about the site (fix-search-ready), from
// the cached anon readers of published content (siteSeoFrom).
export async function getSiteSeo(): Promise<SiteSeo> {
  const [details, home] = await Promise.all([
    getBusinessDetails(),
    getPublishedPage("home"),
  ])
  return siteSeoFrom(details, home)
}
