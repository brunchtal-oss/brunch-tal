import type { Metadata } from "next"

import { GalleryView } from "@/components/public/page-views"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedPage } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = { title: shellCopy.nav.gallery }

// /gallery (stories 5.2, 5.3, 5.4): the photos and the testimonials
// (GalleryView, shared with the admin preview), published content and
// published images from the cache (content:gallery); hidden items are left
// out.
export default async function GalleryPage() {
  const [page, details] = await Promise.all([
    getPublishedPage("gallery"),
    getBusinessDetails(),
  ])
  return (
    <GalleryView
      sections={page.sections}
      images={page.images}
      whatsappHref={guestWhatsappHref(details)}
    />
  )
}
