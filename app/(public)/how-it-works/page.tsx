import type { Metadata } from "next"

import { HowItWorksView } from "@/components/public/page-views"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = { title: shellCopy.nav.howItWorks }

// /how-it-works (stories 5.2, 5.3): the numbered steps and the questions and
// answers (HowItWorksView, shared with the admin preview), published content
// from the cache (content:how-it-works). A section that is not published,
// not valid or hidden is not shown; the other one still is.
export default async function HowItWorksPage() {
  const [sections, details] = await Promise.all([
    getPublishedSections("how-it-works"),
    getBusinessDetails(),
  ])
  return (
    <HowItWorksView
      sections={sections}
      whatsappHref={guestWhatsappHref(details)}
    />
  )
}
