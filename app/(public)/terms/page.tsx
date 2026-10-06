import type { Metadata } from "next"

import { LegalTextView } from "@/components/public/legal-views"
import { getWhatsappHref } from "@/lib/content/business-details"
import {
  getPublishedAt,
  getPublishedSections,
  sectionContent,
} from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = { title: shellCopy.public.footer.terms }

// /terms (story 5.5): the published terms of use from the cache
// (content:terms), with "last updated" from its last publish; the empty
// page before the first publish. No sign-in.
export default async function TermsPage() {
  const [sections, publishedAt, whatsappHref] = await Promise.all([
    getPublishedSections("terms"),
    getPublishedAt("terms"),
    getWhatsappHref(),
  ])
  return (
    <LegalTextView
      title={shellCopy.public.footer.terms}
      content={sectionContent(sections, "body", "legal_text")}
      publishedAt={publishedAt}
      // The plain number, without the prepared message (5.5).
      whatsappHref={whatsappHref}
    />
  )
}
