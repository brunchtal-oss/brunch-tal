import { MessageCircleIcon } from "lucide-react"

import { HomeHero } from "@/components/public/home-hero"
import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import {
  FaqSection,
  GallerySection,
  PublicSection,
  StepsSection,
  TestimonialsSection,
  TextBlockSection,
} from "@/components/public/sections"
import {
  ContactDetails,
  hasContactDetails,
} from "@/components/public/contact-details"
import {
  sectionContent,
  type ImageMap,
  type PublishedSections,
} from "@/lib/content/pages"
import type { BusinessDetailsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public

// The bodies of the public content pages (story 5.3), given their sections
// (the visible part of what is published, or, in the admin preview, of the
// draft; lib/content/visible.ts). The public pages and the preview render
// the same component, so the preview is exactly the page. Each section is
// shown only when it is there.

// The home page: the hero, the intro, the upcoming sessions (a slot, dynamic
// on the site), about (about › main), the testimonials (gallery ›
// testimonials) and contact (home › contact, with the WhatsApp button; only
// with a usable number). images: the resolved images of these sections
// (story 5.4; the published files, or the drafts in the admin preview).
export function HomeView({
  home,
  about,
  gallery,
  images = {},
  name,
  whatsappHref,
  sessions,
}: {
  home: PublishedSections
  about: PublishedSections
  gallery: PublishedSections
  images?: ImageMap
  name: string
  whatsappHref: string | null
  sessions?: React.ReactNode
}) {
  const hero = sectionContent(home, "hero", "hero")
  const intro = sectionContent(home, "intro", "text_block")
  const aboutMain = sectionContent(about, "main", "text_block")
  const testimonials = sectionContent(gallery, "testimonials", "testimonials")
  const contact = sectionContent(home, "contact", "text_block")
  const imageOf = (image: { media_id: string } | undefined) =>
    (image && images[image.media_id]) ?? null

  return (
    <>
      <HomeHero hero={hero} name={name} image={imageOf(hero?.image)} />
      {intro && <TextBlockSection content={intro} />}
      {sessions}
      {aboutMain && (
        <TextBlockSection
          content={aboutMain}
          image={imageOf(aboutMain.image)}
        />
      )}
      {testimonials && (
        <TestimonialsSection
          content={testimonials}
          label={copy.sections.testimonials}
          images={images}
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

// /how-it-works: the numbered steps and the questions and answers.
export function HowItWorksView({
  sections,
  whatsappHref,
}: {
  sections: PublishedSections
  whatsappHref: string | null
}) {
  const steps = sectionContent(sections, "steps", "steps")
  const faq = sectionContent(sections, "faq", "faq")
  return (
    <>
      <PublicPageHeading>{shellCopy.nav.howItWorks}</PublicPageHeading>
      {steps && <StepsSection content={steps} label={copy.sections.steps} />}
      {faq && <FaqSection content={faq} label={copy.sections.faq} />}
      {!steps && !faq && <EmptyPublicPage whatsappHref={whatsappHref} />}
    </>
  )
}

// /gallery: the photos (gallery › photos, story 5.4), then the testimonials
// (text and image).
export function GalleryView({
  sections,
  images = {},
  whatsappHref,
}: {
  sections: PublishedSections
  images?: ImageMap
  whatsappHref: string | null
}) {
  const photos = sectionContent(sections, "photos", "gallery")
  const testimonials = sectionContent(sections, "testimonials", "testimonials")
  return (
    <>
      <PublicPageHeading>{shellCopy.nav.gallery}</PublicPageHeading>
      {photos && (
        <GallerySection
          content={photos}
          label={copy.sections.gallery}
          images={images}
        />
      )}
      {testimonials && (
        <TestimonialsSection
          content={testimonials}
          label={copy.sections.testimonials}
          images={images}
        />
      )}
      {!photos && !testimonials && (
        <EmptyPublicPage whatsappHref={whatsappHref} />
      )}
    </>
  )
}

// /contact: contact › intro and the business details (phone, address,
// arrival instructions, a navigation link). WhatsApp is the whatsapp-bar.
export function ContactView({
  sections,
  details,
}: {
  sections: PublishedSections
  details: BusinessDetailsContent | null
}) {
  const intro = sectionContent(sections, "intro", "text_block")
  return (
    <>
      <PublicPageHeading>{shellCopy.nav.contact}</PublicPageHeading>
      {intro && <TextBlockSection content={intro} />}
      {hasContactDetails(details) ? (
        <PublicSection label={copy.contact.label} className="pt-8">
          <ContactDetails details={details} />
        </PublicSection>
      ) : (
        !intro && <EmptyPublicPage whatsappHref={null} />
      )}
    </>
  )
}
