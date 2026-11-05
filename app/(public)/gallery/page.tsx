import type { Metadata } from "next"

import { GalleryView } from "@/components/public/page-views"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedPage } from "@/lib/content/pages"
import { getPageSeo, pageH1, pageMetadata } from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { siteUrl } from "@/lib/site-url"

// Title, canonical and, when set in the content editor's SEO page, the
// description and share image (pageMetadata, fix-seo-editor). Cached readers.
export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getPageSeo(), getSiteSeo()])
  return pageMetadata(seo, "gallery", site, siteUrl())
}

// /gallery (stories 5.2, 5.3, 5.4): the photos and the testimonials
// (GalleryView, shared with the admin preview), published content and
// published images from the cache (content:gallery); hidden items are left
// out.
export default async function GalleryPage() {
  const [page, details, seo] = await Promise.all([
    getPublishedPage("gallery"),
    getBusinessDetails(),
    getPageSeo(),
  ])
  return (
    <GalleryView
      heading={pageH1(seo, "gallery", "")}
      sections={page.sections}
      images={page.images}
      whatsappHref={guestWhatsappHref(details)}
    />
  )
}
