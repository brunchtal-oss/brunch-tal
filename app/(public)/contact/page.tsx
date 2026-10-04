import type { Metadata } from "next"

import {
  ContactDetails,
  hasContactDetails,
} from "@/components/public/contact-details"
import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import { PublicSection, TextBlockSection } from "@/components/public/sections"
import { getBusinessDetails } from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const title = shellCopy.nav.contact

export const metadata: Metadata = { title }

// /contact (story 5.2): contact › intro and the published business details
// (content:contact, content:global): phone, address, arrival instructions
// and a navigation link; an empty field is not shown. WhatsApp is the
// whatsapp-bar below.
export default async function ContactPage() {
  const [sections, details] = await Promise.all([
    getPublishedSections("contact"),
    getBusinessDetails(),
  ])
  const intro = sectionContent(sections, "intro", "text_block")

  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {intro && <TextBlockSection content={intro} />}
      {hasContactDetails(details) ? (
        <PublicSection label={shellCopy.public.contact.label} className="pt-8">
          <ContactDetails details={details} />
        </PublicSection>
      ) : (
        !intro && <EmptyPublicPage whatsappHref={null} />
      )}
    </>
  )
}
