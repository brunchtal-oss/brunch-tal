import { useId } from "react"
import Image from "next/image"
import { ChevronDownIcon } from "lucide-react"

import type { ImageMap, ResolvedImage } from "@/lib/content/pages"
import type {
  FaqContent,
  GalleryContent,
  StepsContent,
  TestimonialsContent,
  TextBlockContent,
} from "@/lib/content/schema"
import { objectPosition } from "@/lib/media/photo"
import { cn } from "@/lib/utils"

// The sections of the public pages (story 5.2), one per content kind. All
// text comes from published content and is rendered as text (React escapes
// it; line breaks are kept with whitespace-pre-line). The rhythm is
// DESIGN's direction 1: 48px between sections, centred headings in
// display-md, a short olive rule, body-lg.

export function PublicSection({
  titleId,
  label,
  className,
  children,
}: {
  titleId?: string
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : label}
      className={cn("mx-auto w-full max-w-[720px] px-6 pt-12", className)}
    >
      {children}
    </section>
  )
}

// The heading of a section: optional eyebrow (a quiet label the content
// gives), the title in display-md, and the short olive rule.
export function SectionHeading({
  id,
  eyebrow,
  title,
}: {
  id: string
  eyebrow?: string
  title: string
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {eyebrow && (
        <p className="text-[13px] leading-[1.4] tracking-[0.04em] text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={cn(
          "font-heading text-[26px] leading-[1.2] font-light text-balance",
          eyebrow && "mt-2"
        )}
      >
        {title}
      </h2>
      <div aria-hidden className="mt-4 h-px w-8 bg-brand-accent" />
    </div>
  )
}

// text_block: a heading and its text (when there is one). children (the
// WhatsApp button on home › contact) follow.
export function TextBlockSection({
  content,
  image = null,
  children,
}: {
  content: TextBlockContent
  // The block's photo (story 5.4, about › main): above the heading, 4:5 at
  // its focus point, lazy.
  image?: ResolvedImage | null
  children?: React.ReactNode
}) {
  const id = useId()
  return (
    <PublicSection titleId={id}>
      {image && (
        <div className="relative mx-auto mb-8 aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-lg bg-muted">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            // object-cover in a 4:5 frame: a landscape photo (up to 16:9) is
            // drawn about 2.2 times the frame's width, so the file is asked
            // for at that width; at the frame's own width it was upscaled and
            // looked pixelated on a desktop screen (user's check 2026-10-06).
            sizes="(min-width: 480px) 940px, 225vw"
            unoptimized={image.unoptimized}
            className="object-cover"
            style={{
              objectPosition: objectPosition(image.focusX, image.focusY),
            }}
          />
        </div>
      )}
      <SectionHeading id={id} eyebrow={content.eyebrow} title={content.title} />
      {content.body && (
        <p className="mx-auto mt-5 max-w-[60ch] text-center text-[17px] leading-[1.65] text-pretty whitespace-pre-line">
          {content.body}
        </p>
      )}
      {children}
    </PublicSection>
  )
}

// steps: the steps are a sequence, so they are an ordered list with their
// numbers (the numbers are read from the list itself by a screen reader).
export function StepsSection({
  content,
  label,
}: {
  content: StepsContent
  label: string
}) {
  const id = useId()
  return (
    <PublicSection titleId={content.title ? id : undefined} label={label}>
      {content.title && <SectionHeading id={id} title={content.title} />}
      <ol className={cn("border-t border-border", content.title && "mt-6")}>
        {content.items.map((step, index) => (
          <li
            key={index}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-border py-5"
          >
            <span
              aria-hidden
              className="pt-0.5 text-[26px] leading-none text-muted-foreground tabular-nums"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="text-base leading-[1.35] font-semibold">
                {step.title}
              </h3>
              <p className="mt-1.5 text-base leading-normal whitespace-pre-line">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </PublicSection>
  )
}

// faq: each question opens its answer (native details/summary: keyboard
// and screen reader support without script).
export function FaqSection({
  content,
  label,
}: {
  content: FaqContent
  label: string
}) {
  const id = useId()
  return (
    <PublicSection titleId={content.title ? id : undefined} label={label}>
      {content.title && <SectionHeading id={id} title={content.title} />}
      <div className={cn("border-t border-border", content.title && "mt-6")}>
        {content.items.map((item, index) => (
          <details key={index} className="group border-b border-border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-base leading-[1.35] font-semibold [&::-webkit-details-marker]:hidden">
              <span>{item.question}</span>
              <ChevronDownIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
              />
            </summary>
            <p className="pb-5 text-base leading-normal whitespace-pre-line">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </PublicSection>
  )
}

// testimonials: each the text with the display name under it, marked by a
// short olive line at inline-start. An image testimonial (story 5.4, e.g. a
// screenshot) is shown whole (never cropped), lazily, with its alt (a short
// transcription) and its display name when there is one. The items arrive
// resolved (an image that is not published is already left out).
export function TestimonialsSection({
  content,
  label,
  images = {},
}: {
  content: TestimonialsContent
  label: string
  images?: ImageMap
}) {
  const id = useId()
  return (
    <PublicSection titleId={content.title ? id : undefined} label={label}>
      {content.title && <SectionHeading id={id} title={content.title} />}
      <ul className={cn("flex flex-col gap-8", content.title && "mt-8")}>
        {content.items.map((item, index) => {
          if (item.kind === "image") {
            const image = images[item.image.media_id]
            if (!image) return null
            return (
              <li key={index}>
                <figure className="border-s-2 border-brand-accent ps-4">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    width={720}
                    height={960}
                    sizes="(min-width: 640px) 360px, 80vw"
                    unoptimized={image.unoptimized}
                    className="h-auto w-full max-w-[360px] rounded-lg border border-border"
                  />
                  {item.name && (
                    <figcaption className="mt-2 text-[15px] text-muted-foreground">
                      {item.name}
                    </figcaption>
                  )}
                </figure>
              </li>
            )
          }
          return (
            <li key={index}>
              <figure className="border-s-2 border-brand-accent ps-4">
                <blockquote className="text-[17px] leading-[1.65] text-pretty whitespace-pre-line">
                  {item.text}
                </blockquote>
                <figcaption className="mt-2 text-[15px] text-muted-foreground">
                  {item.name}
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </PublicSection>
  )
}

// gallery › photos (story 5.4): two columns of photos at 4:5, each at its
// focus point, with its caption under it; lazy (next/image loads a photo
// only near the viewport), sized for the column.
export function GallerySection({
  content,
  label,
  images,
}: {
  content: GalleryContent
  label: string
  images: ImageMap
}) {
  const id = useId()
  return (
    <PublicSection titleId={content.title ? id : undefined} label={label}>
      {content.title && <SectionHeading id={id} title={content.title} />}
      <ul
        className={cn(
          "grid grid-cols-2 gap-x-3 gap-y-5",
          content.title && "mt-8"
        )}
      >
        {content.items.map((item, index) => {
          const image = images[item.image.media_id]
          if (!image) return null
          return (
            <li key={index}>
              <figure>
                <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes="(min-width: 720px) 336px, 50vw"
                    unoptimized={image.unoptimized}
                    className="object-cover"
                    style={{
                      objectPosition: objectPosition(
                        image.focusX,
                        image.focusY
                      ),
                    }}
                  />
                </div>
                {item.caption && (
                  <figcaption className="mt-2 text-[15px] leading-snug text-pretty text-muted-foreground">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            </li>
          )
        })}
      </ul>
    </PublicSection>
  )
}
