import { MessageCircleIcon } from "lucide-react"

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

// The home page (stories 5.1, 5.2): the hero, the short intro (home ›
// intro), about (about › main; it has no page of its own, user decision
// 2026-10-04), the testimonials (gallery › testimonials) and contact (home ›
// contact: a heading with the WhatsApp button, shown only with a usable
// number; the business details are on /contact). The sessions area joins after the intro in 3.2. Everything is
// published content read from the cache (content:home, content:about,
// content:gallery, content:global) through the anon client, so a draft
// never reaches it; a section without valid published content is not shown.
// Title: the root default.
export default async function HomePage() {
  const [home, about, gallery, details] = await Promise.all([
    getPublishedSections("home"),
    getPublishedSections("about"),
    getPublishedSections("gallery"),
    getBusinessDetails(),
  ])
  const hero = sectionContent(home, "hero", "hero")
  const intro = sectionContent(home, "intro", "text_block")
  const aboutMain = sectionContent(about, "main", "text_block")
  const testimonials = sectionContent(gallery, "testimonials", "testimonials")
  const contact = sectionContent(home, "contact", "text_block")
  const whatsappHref = guestWhatsappHref(details)

  return (
    <>
      <HomeHero
        hero={hero}
        name={details?.business_name ?? shellCopy.wordmark}
      />
      {intro && <TextBlockSection content={intro} />}
      {aboutMain && <TextBlockSection content={aboutMain} />}
      {testimonials && (
        <TestimonialsSection
          content={testimonials}
          label={copy.sections.testimonials}
        />
      )}
      {contact && whatsappHref && (
        <TextBlockSection content={contact}>
          <div className="mt-6 flex justify-center">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[4px] border border-success px-5 py-2 text-base leading-[1.2] font-semibold text-success hover:bg-success-tint"
            >
              <MessageCircleIcon
                aria-hidden
                strokeWidth={1.8}
                className="size-5"
              />
              {copy.contact.whatsappLink}
              <span className="sr-only"> {copy.contact.opensOutside}</span>
            </a>
          </div>
        </TextBlockSection>
      )}
    </>
  )
}
