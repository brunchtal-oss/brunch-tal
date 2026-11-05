import type {
  BusinessDetailsContent,
  FooterContent,
} from "@/lib/content/schema"
import { footerLinks, visibleSection } from "@/lib/content/visible"

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
 * The JSON for a <script type="application/ld+json">: every "<" becomes
 * the JSON escape \u003c, so no text can close the script tag
 * (Next.js JSON-LD guide).
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
