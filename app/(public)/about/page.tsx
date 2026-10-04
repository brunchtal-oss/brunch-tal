import type { Metadata } from "next"

import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import { TextBlockSection } from "@/components/public/sections"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const title = shellCopy.nav.about

export const metadata: Metadata = { title }

// /about (story 5.2): about › main, published content from the cache
// (content:about). Photos arrive in 5.4.
export default async function AboutPage() {
  const sections = await getPublishedSections("about")
  const main = sectionContent(sections, "main", "text_block")

  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {main ? (
        <TextBlockSection content={main} />
      ) : (
        <EmptyPublicPage
          whatsappHref={guestWhatsappHref(await getBusinessDetails())}
        />
      )}
    </>
  )
}
