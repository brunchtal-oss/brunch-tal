import { useId } from "react"

import { telHref } from "@/components/public/contact-details"
import { LEGAL_HEADING, LegalText } from "@/components/public/legal-text"
import {
  EmptyPublicPage,
  PublicPageHeading,
} from "@/components/public/public-page"
import type {
  AccessibilityStatementContent,
  BusinessDetailsContent,
  LegalTextContent,
} from "@/lib/content/schema"
import { whatsappHref as plainWhatsappHref } from "@/lib/content/whatsapp"
import { shellCopy } from "@/lib/copy/shell"
import { formatLocalPhone } from "@/lib/phone"
import { formatFullDate, formatLocalDate } from "@/lib/time"

const copy = shellCopy.public.legal
const a11y = copy.accessibility

// The bodies of the legal pages (story 5.5), shared by the public routes
// (published content) and the admin preview (the draft), so the preview is
// exactly the page. A legal page reads as one document: the centred h1 of
// every inner page, "last updated" under it, then a single start-aligned
// column of text (LegalText; its "## " lines are the h2s). Every WhatsApp
// link here is the plain number, without the prepared message (user decision
// 2026-10-06).

const COLUMN = "mx-auto w-full max-w-[720px] px-6"
const MEASURE = "max-w-[62ch]"
const LINK =
  "inline-flex min-h-11 items-center font-semibold underline underline-offset-4"

// A typed phone as the site shows phones ("054-425-6456"): an Israeli
// number through formatLocalPhone; anything else as typed.
export function displayPhone(raw: string): string {
  const cleaned = raw.replace(/[\s().-]/g, "")
  const e164 = /^0\d{8,9}$/.test(cleaned)
    ? `+972${cleaned.slice(1)}`
    : /^00\d+$/.test(cleaned)
      ? `+${cleaned.slice(2)}`
      : cleaned
  const formatted = formatLocalPhone(e164)
  return formatted === e164 ? raw : formatted
}

// "עודכן לאחרונה DD.MM.YYYY" under the h1, from content_pages.published_at.
function UpdatedLine({ publishedAt }: { publishedAt: string | null }) {
  if (!publishedAt) return null
  return (
    <p className="mt-3 text-center text-[15px] text-muted-foreground">
      <time dateTime={formatLocalDate(publishedAt)}>
        {copy.updated(formatFullDate(publishedAt))}
      </time>
    </p>
  )
}

// One section of a legal text: its heading (h2) and its text.
function LegalSection({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className={LEGAL_HEADING}>
        {heading}
      </h2>
      {children}
    </section>
  )
}

// /privacy and /terms: the published text, or the empty page before the
// first publish. whatsappHref: the plain link (no prepared message).
export function LegalTextView({
  title,
  content,
  publishedAt,
  whatsappHref,
}: {
  title: string
  content: LegalTextContent | null
  publishedAt: string | null
  whatsappHref: string | null
}) {
  return (
    <>
      <PublicPageHeading>{title}</PublicPageHeading>
      {content ? (
        <>
          <div className={COLUMN}>
            <UpdatedLine publishedAt={publishedAt} />
          </div>
          <div className={`${COLUMN} pt-10`}>
            <LegalText text={content.body} className={`mx-auto ${MEASURE}`} />
          </div>
        </>
      ) : (
        <EmptyPublicPage whatsappHref={whatsappHref} />
      )}
    </>
  )
}

// /accessibility: the statement's text, then the contact for accessibility
// under its fixed heading (user decision 2026-10-06, second phone check).
// Before the first publish: one
// line with the contact details that are already published (the phone and
// WhatsApp of the business details); without them, the first sentence only.
export function AccessibilityView({
  content,
  publishedAt,
  details,
}: {
  content: AccessibilityStatementContent | null
  publishedAt: string | null
  details: BusinessDetailsContent | null
}) {
  return (
    <>
      <PublicPageHeading>
        {shellCopy.public.footer.accessibility}
      </PublicPageHeading>
      {content ? (
        <>
          <div className={COLUMN}>
            <UpdatedLine publishedAt={publishedAt} />
          </div>
          <div className={`${COLUMN} pt-10`}>
            <div className={`mx-auto flex flex-col gap-10 ${MEASURE}`}>
              <LegalText text={content.body} />
              <LegalSection heading={a11y.contact}>
                <AccessibilityContact content={content} />
              </LegalSection>
            </div>
          </div>
        </>
      ) : (
        <AccessibilitySoon details={details} />
      )}
    </>
  )
}

// The contact for accessibility: a short definition list on the muted
// surface.
function AccessibilityContact({
  content,
}: {
  content: AccessibilityStatementContent
}) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: a11y.contactName, value: content.contact_name },
    {
      label: a11y.contactPhone,
      value: (
        <a href={telHref(content.contact_phone)} className={LINK}>
          <bdi dir="ltr">{displayPhone(content.contact_phone)}</bdi>
        </a>
      ),
    },
    {
      label: a11y.contactEmail,
      value: (
        <a
          href={`mailto:${content.contact_email}`}
          className={`${LINK} break-all`}
        >
          <bdi dir="ltr">{content.contact_email}</bdi>
        </a>
      ),
    },
  ]
  return (
    <dl className="flex flex-col gap-1 rounded-lg bg-muted px-5 py-4 text-[17px]">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex min-h-11 flex-wrap items-center gap-x-3"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function AccessibilitySoon({
  details,
}: {
  details: BusinessDetailsContent | null
}) {
  const phone = details?.phone ?? null
  const whatsapp = plainWhatsappHref(details?.whatsapp_phone)
  const hasContact = Boolean(phone || whatsapp)
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 px-6 pt-8 text-center">
      <p className="text-[17px] leading-[1.65] text-pretty">
        {a11y.soon}
        {hasContact && ` ${a11y.soonContact}`}
      </p>
      {hasContact && (
        <ul className="flex flex-wrap items-center justify-center gap-x-6">
          {phone && (
            <li>
              <a href={telHref(phone)} className={LINK}>
                <bdi dir="ltr">{phone}</bdi>
              </a>
            </li>
          )}
          {whatsapp && (
            <li>
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                {a11y.whatsapp}
                <span className="sr-only">
                  {" "}
                  {shellCopy.public.contact.opensOutside}
                </span>
              </a>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
