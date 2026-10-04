import type { Metadata } from "next"

import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import { TestimonialsSection } from "@/components/public/sections"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const title = shellCopy.nav.gallery

export const metadata: Metadata = { title }

// /gallery (story 5.2): the text testimonials, published content from the
// cache (content:gallery). The photos arrive in 5.4.
export default async function GalleryPage() {
  const sections = await getPublishedSections("gallery")
  const testimonials = sectionContent(sections, "testimonials", "testimonials")

  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {testimonials ? (
        <TestimonialsSection
          content={testimonials}
          label={shellCopy.public.sections.testimonials}
        />
      ) : (
        <EmptyPublicPage
          whatsappHref={guestWhatsappHref(await getBusinessDetails())}
        />
      )}
    </>
  )
}
