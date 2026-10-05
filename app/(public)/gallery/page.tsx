import type { Metadata } from "next"

import { GalleryView } from "@/components/public/page-views"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = { title: shellCopy.nav.gallery }

// /gallery (stories 5.2, 5.3): the text testimonials (GalleryView, shared
// with the admin preview), published content from the cache
// (content:gallery); hidden testimonials are left out. The photos arrive in
// 5.4.
export default async function GalleryPage() {
  const [sections, details] = await Promise.all([
    getPublishedSections("gallery"),
    getBusinessDetails(),
  ])
  return (
    <GalleryView
      sections={sections}
      whatsappHref={guestWhatsappHref(details)}
    />
  )
}
