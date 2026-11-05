import type { Metadata } from "next"

import { ContactView } from "@/components/public/page-views"
import { getBusinessDetails } from "@/lib/content/business-details"
import { getPublishedSections } from "@/lib/content/pages"
import { getPageSeo, pageH1, pageMetadata } from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { siteUrl } from "@/lib/site-url"

// Title, canonical and, when set in the content editor's SEO page, the
// description and share image (pageMetadata, fix-seo-editor). Cached readers.
export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getPageSeo(), getSiteSeo()])
  return pageMetadata(seo, "contact", site, siteUrl())
}

// /contact (stories 5.2, 5.3): contact › intro and the published business
// details (content:contact, content:global), through ContactView, shared
// with the admin preview. WhatsApp is the whatsapp-bar below.
export default async function ContactPage() {
  const [sections, details, seo] = await Promise.all([
    getPublishedSections("contact"),
    getBusinessDetails(),
    getPageSeo(),
  ])
  return (
    <ContactView
      heading={pageH1(seo, "contact", "")}
      sections={sections}
      details={details}
    />
  )
}
