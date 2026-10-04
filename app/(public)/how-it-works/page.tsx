import type { Metadata } from "next"

import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import { FaqSection, StepsSection } from "@/components/public/sections"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const title = shellCopy.nav.howItWorks
const labels = shellCopy.public.sections

export const metadata: Metadata = { title }

// /how-it-works (story 5.2): the numbered steps and the questions and
// answers, published content from the cache (content:how-it-works). A
// section that is not published or not valid is not shown; the other one
// still is.
export default async function HowItWorksPage() {
  const sections = await getPublishedSections("how-it-works")
  const steps = sectionContent(sections, "steps", "steps")
  const faq = sectionContent(sections, "faq", "faq")

  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {steps && <StepsSection content={steps} label={labels.steps} />}
      {faq && <FaqSection content={faq} label={labels.faq} />}
      {!steps && !faq && (
        <EmptyPublicPage
          whatsappHref={guestWhatsappHref(await getBusinessDetails())}
        />
      )}
    </>
  )
}
