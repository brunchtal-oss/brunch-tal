import type { Metadata } from "next"

import { ContactDetails } from "@/components/public/contact-details"
import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import { PublicSection, TextBlockSection } from "@/components/public/sections"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const title = shellCopy.nav.contact

export const metadata: Metadata = { title }

// /contact (story 5.2): contact › intro and the published business details
// (content:contact, content:global): phone, WhatsApp, address, arrival
// instructions, a navigation link and the payment instructions; an empty
// field is not shown.
export default async function ContactPage() {
  const [sections, details] = await Promise.all([
    getPublishedSections("contact"),
    getBusinessDetails(),
  ])
  const intro = sectionContent(sections, "intro", "text_block")
  const whatsappHref = guestWhatsappHref(details)

  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {intro && <TextBlockSection content={intro} />}
      {details ? (
        <PublicSection label={shellCopy.public.contact.label} className="pt-8">
          <ContactDetails details={details} whatsappHref={whatsappHref} />
        </PublicSection>
      ) : (
        !intro && <EmptyPublicPage whatsappHref={null} />
      )}
    </>
  )
}
