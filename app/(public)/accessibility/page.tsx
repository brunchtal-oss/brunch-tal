import type { Metadata } from "next"

import { AccessibilityView } from "@/components/public/legal-views"
import { getBusinessDetails } from "@/lib/content/business-details"
import {
  getPublishedAt,
  getPublishedSections,
  sectionContent,
} from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = {
  title: shellCopy.public.footer.accessibility,
}

// /accessibility (story 5.5, CAP-33): the published accessibility statement
// from the cache (content:accessibility), with "last updated" from its last
// publish. Before the first publish: the interim line with the published
// contact details (content:global). No sign-in; always linked.
export default async function AccessibilityPage() {
  const [sections, publishedAt, details] = await Promise.all([
    getPublishedSections("accessibility"),
    getPublishedAt("accessibility"),
    getBusinessDetails(),
  ])
  return (
    <AccessibilityView
      content={sectionContent(sections, "statement", "accessibility_statement")}
      publishedAt={publishedAt}
      details={details}
    />
  )
}
