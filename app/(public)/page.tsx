import { ContactDetails } from "@/components/public/contact-details"
import { HomeHero } from "@/components/public/home-hero"
import {
  TestimonialsSection,
  TextBlockSection,
} from "@/components/public/sections"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public

// The home page (stories 5.1, 5.2), in EXPERIENCE's order: the hero, the
// short intro (home › intro), the testimonials (gallery › testimonials) and
// contact (home › contact with the business details). The sessions area
// joins between the intro and the testimonials in 3.2. Everything is
// published content read from the cache (content:home, content:gallery,
// content:global) through the anon client, so a draft never reaches it; a
// section without valid published content is not shown. Title: the root
// default.
export default async function HomePage() {
  const [home, gallery, details] = await Promise.all([
    getPublishedSections("home"),
    getPublishedSections("gallery"),
    getBusinessDetails(),
  ])
  const hero = sectionContent(home, "hero", "hero")
  const intro = sectionContent(home, "intro", "text_block")
  const testimonials = sectionContent(gallery, "testimonials", "testimonials")
  const contact = sectionContent(home, "contact", "text_block")

  return (
    <>
      <HomeHero
        hero={hero}
        name={details?.business_name ?? shellCopy.wordmark}
      />
      {intro && <TextBlockSection content={intro} />}
      {testimonials && (
        <TestimonialsSection
          content={testimonials}
          label={copy.sections.testimonials}
        />
      )}
      {contact && (
        <TextBlockSection content={contact}>
          <ContactDetails
            details={details}
            whatsappHref={guestWhatsappHref(details)}
            className="mt-6"
          />
        </TextBlockSection>
      )}
    </>
  )
}
