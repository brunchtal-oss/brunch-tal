import type {
  BusinessDetailsContent,
  FaqContent,
  FooterContent,
} from "@/lib/content/schema"
import { footerLinks, visibleSection } from "@/lib/content/visible"
import { customerCopy } from "@/lib/copy/customer"
import { agorotToDecimal } from "@/lib/money"
import type { PublicSession } from "@/lib/sessions/public"
import { formatIsraelIsoDateTime } from "@/lib/time"

// The home page's structured data (JSON-LD, fix-search-ready): the business
// and the website, from published content only (the business details, the
// hero and the footer's visible links). An empty field is left out.

export type StructuredDataInput = {
  name: string
  /** The site's base URL (siteUrl()). */
  url: string
  details: BusinessDetailsContent | null
  /** The hero's published description. */
  description?: string | null
  /** The hero's published photo (absolute URL). */
  image?: string | null
  /** The site › footer content; its hidden links never reach sameAs. */
  footer?: FooterContent | null
}

function filled(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

// The footer's links that the site shows (not hidden, with a label and a URL).
function visibleFooterUrls(footer: FooterContent | null | undefined): string[] {
  if (!footer) return []
  const visible = visibleSection({ kind: "footer", content: footer })
  const items = visible?.kind === "footer" ? visible.content.items : undefined
  return [...new Set(footerLinks(items).map((link) => link.url))]
}

function withoutEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0)
    )
  ) as T
}

/**
 * A LocalBusiness (or an Organization when no address is published) and the
 * WebSite, in one @graph.
 */
export function buildStructuredData(input: StructuredDataInput) {
  const { details } = input
  const address = filled(details?.address)
  const business = withoutEmpty({
    "@type": address ? "LocalBusiness" : "Organization",
    "@id": `${input.url}/#business`,
    name: input.name,
    url: `${input.url}/`,
    telephone: filled(details?.phone) ?? filled(details?.whatsapp_phone),
    address: address
      ? {
          "@type": "PostalAddress",
          streetAddress: address,
          addressCountry: "IL",
        }
      : undefined,
    image: filled(input.image),
    description: filled(input.description),
    sameAs: visibleFooterUrls(input.footer),
  })
  const website = {
    "@type": "WebSite",
    "@id": `${input.url}/#website`,
    name: input.name,
    url: `${input.url}/`,
    inLanguage: "he-IL",
    publisher: { "@id": `${input.url}/#business` },
  }
  return { "@context": "https://schema.org", "@graph": [business, website] }
}

/**
 * /how-it-works' questions and answers as an FAQPage (fix-seo-editor): only
 * what the page shows (faq: the visible, published section), and of it only
 * the items with both a question and an answer (the page opens those). null
 * when none is left.
 */
export function buildFaqData(faq: FaqContent | null) {
  const items = (faq?.items ?? []).flatMap((item) => {
    const question = filled(item.question)
    const answer = filled(item.answer)
    return item.hidden !== true && question && answer
      ? [
          {
            "@type": "Question",
            name: question,
            acceptedAnswer: { "@type": "Answer", text: answer },
          },
        ]
      : []
  })
  if (items.length === 0) return null
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items,
  }
}

export type EventDataInput = {
  /** A session the public site shows (getPublicSession). */
  session: Pick<
    PublicSession,
    | "id"
    | "concept_name"
    | "starts_at"
    | "description"
    | "display_price_agorot"
    | "photo"
  >
  /** The business name (the place's name). */
  name: string
  details: BusinessDetailsContent | null
  /** The site's base URL (siteUrl()). */
  url: string
}

/**
 * A session page's Event (fix-seo-editor): only what the page shows. Its
 * title ("בראנץ׳ {concept}", as the page's <title>), the business as the
 * organizer, the start in Israel time with its offset, always
 * scheduled (a cancelled or past session has no page), in person, at the
 * business (its published address when there is one, shown in the footer),
 * the photo, the description, and the display price when one is set. Never
 * places, availability or the session's kind.
 */
export function buildEventData(input: EventDataInput) {
  const { session } = input
  const pageUrl = `${input.url}/sessions/${session.id}`
  const address = filled(input.details?.address)
  const price = session.display_price_agorot
  return withoutEmpty({
    "@context": "https://schema.org",
    "@type": "Event",
    // The session's title, as its <title> and llms.txt name it.
    name: customerCopy.sessionTitle(session.concept_name),
    startDate: formatIsraelIsoDateTime(session.starts_at),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: withoutEmpty({
      "@type": "Place",
      name: input.name,
      address: address
        ? {
            "@type": "PostalAddress",
            streetAddress: address,
            addressCountry: "IL",
          }
        : undefined,
    }),
    image: session.photo?.photoUrl,
    description: filled(session.description),
    url: pageUrl,
    offers:
      price !== null
        ? {
            "@type": "Offer",
            price: agorotToDecimal(price),
            priceCurrency: "ILS",
            url: pageUrl,
          }
        : undefined,
    organizer: {
      "@type": "Organization",
      name: input.name,
      url: `${input.url}/`,
    },
  })
}

/**
 * The JSON for a <script type="application/ld+json">: every "<" becomes
 * the JSON escape \u003c, so no text can close the script tag
 * (Next.js JSON-LD guide).
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
