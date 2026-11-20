import type { Metadata } from "next"

import { LegalTextView } from "@/components/public/legal-views"
import { getWhatsappHref } from "@/lib/content/business-details"
import {
  getPublishedAt,
  getPublishedSections,
  sectionContent,
} from "@/lib/content/pages"
import { getPageSeo, pageH1, pageMetadata } from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { siteUrl } from "@/lib/site-url"

// Title, canonical and, when set in the content editor's SEO page, the
// description and share image (pageMetadata, fix-seo-editor). Cached readers.
export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getPageSeo(), getSiteSeo()])
  return pageMetadata(seo, "purchase_terms", site, siteUrl())
}

// /purchase-terms (online payments, PR B): the published purchase terms
// from the cache (content:purchase-terms), with "last updated" from its
// last publish; the empty page before the first publish (and no buying
// until then: get_purchase_options needs it published). Its wording is
// Tal's, edited in the content editor. No sign-in.
export default async function PurchaseTermsPage() {
  const [sections, publishedAt, whatsappHref, seo] = await Promise.all([
    getPublishedSections("purchase-terms"),
    getPublishedAt("purchase-terms"),
    getWhatsappHref(),
    getPageSeo(),
  ])
  return (
    <LegalTextView
      title={pageH1(seo, "purchase_terms", "")}
      content={sectionContent(sections, "body", "legal_text")}
      publishedAt={publishedAt}
      // The plain number, without the prepared message (5.5).
      whatsappHref={whatsappHref}
    />
  )
}
