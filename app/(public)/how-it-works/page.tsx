import type { Metadata } from "next"

import { JsonLd } from "@/components/public/json-ld"
import { HowItWorksView } from "@/components/public/page-views"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { getPageSeo, pageH1, pageMetadata } from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { buildFaqData } from "@/lib/seo/structured-data"
import { siteUrl } from "@/lib/site-url"

// Title, canonical and, when set in the content editor's SEO page, the
// description and share image (pageMetadata, fix-seo-editor). Cached readers.
export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getPageSeo(), getSiteSeo()])
  return pageMetadata(seo, "how_it_works", site, siteUrl())
}

// /how-it-works (stories 5.2, 5.3): the numbered steps and the questions and
// answers (HowItWorksView, shared with the admin preview), published content
// from the cache (content:how-it-works). A section that is not published,
// not valid or hidden is not shown; the other one still is.
export default async function HowItWorksPage() {
  const [sections, details, seo] = await Promise.all([
    getPublishedSections("how-it-works"),
    getBusinessDetails(),
    getPageSeo(),
  ])
  // The questions the page shows, as an FAQPage (fix-seo-editor).
  const faq = buildFaqData(sectionContent(sections, "faq", "faq"))
  return (
    <>
      {faq && <JsonLd data={faq} />}
      <HowItWorksView
        heading={pageH1(seo, "how_it_works", "")}
        sections={sections}
        whatsappHref={guestWhatsappHref(details)}
      />
    </>
  )
}
