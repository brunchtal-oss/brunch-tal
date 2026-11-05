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
  return pageMetadata(seo, "privacy", site, siteUrl())
}

// /privacy (story 5.5, CAP-29): the published privacy policy from the cache
// (content:privacy), with "last updated" from its last publish; the empty
// page before the first publish. No sign-in.
export default async function PrivacyPage() {
  const [sections, publishedAt, whatsappHref, seo] = await Promise.all([
    getPublishedSections("privacy"),
    getPublishedAt("privacy"),
    getWhatsappHref(),
    getPageSeo(),
  ])
  return (
    <LegalTextView
      title={pageH1(seo, "privacy", "")}
      content={sectionContent(sections, "body", "legal_text")}
      publishedAt={publishedAt}
      // The plain number, without the prepared message (5.5).
      whatsappHref={whatsappHref}
    />
  )
}
