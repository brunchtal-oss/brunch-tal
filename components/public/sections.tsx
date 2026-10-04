import { useId } from "react"
import { ChevronDownIcon } from "lucide-react"

import type {
  FaqContent,
  StepsContent,
  TestimonialsContent,
  TextBlockContent,
} from "@/lib/content/schema"
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

// text_block: a heading and its text. children (the business details on
// home › contact) follow the text.
export function TextBlockSection({
  content,
  children,
}: {
  content: TextBlockContent
  children?: React.ReactNode
}) {
  const id = useId()
  return (
    <PublicSection titleId={id}>
      <SectionHeading id={id} eyebrow={content.eyebrow} title={content.title} />
      <p className="mx-auto mt-5 max-w-[60ch] text-center text-[17px] leading-[1.65] text-pretty whitespace-pre-line">
        {content.body}
      </p>
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

// testimonials: text testimonials, each the text with the display name
// under it, marked by a short olive line at inline-start.
export function TestimonialsSection({
  content,
  label,
}: {
  content: TestimonialsContent
  label: string
}) {
  const id = useId()
  return (
    <PublicSection titleId={content.title ? id : undefined} label={label}>
      {content.title && <SectionHeading id={id} title={content.title} />}
      <ul className={cn("flex flex-col gap-8", content.title && "mt-8")}>
        {content.items.map((item, index) => (
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
        ))}
      </ul>
    </PublicSection>
  )
}
