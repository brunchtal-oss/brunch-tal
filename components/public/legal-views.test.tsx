import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { BusinessDetailsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { visibleLegalNav } from "@/lib/nav"

import { AccessibilityView, LegalTextView } from "./legal-views"
import { SiteFooter } from "./site-footer"

const copy = shellCopy.public.legal
const a11y = copy.accessibility
const WA = "https://wa.me/972544256456"
// 06.10.2026 13:00 in Jerusalem.
const PUBLISHED = "2026-10-06T10:00:00Z"

const STATEMENT = {
  body: "## intro-h\n\nstatement-text\n\n## venue-h",
  contact_name: "contact-name",
  contact_phone: "054-4256456",
  contact_email: "a11y@example.com",
}

describe("LegalTextView (story 5.5)", () => {
  it("shows the text, its '## ' lines as h2, and the last update", () => {
    const html = renderToStaticMarkup(
      <LegalTextView
        title="t"
        content={{ body: "## first\n\n**b**" }}
        publishedAt={PUBLISHED}
        whatsappHref={WA}
      />
    )
    expect(html).toMatch(/<h2[^>]*>first<\/h2>/)
    expect(html).toContain('<strong class="font-semibold">b</strong>')
    expect(html).toContain(copy.updated("06.10.2026"))
    expect(html).toContain('dateTime="2026-10-06"')
  })

  it("shows the empty page before the first publish", () => {
    const html = renderToStaticMarkup(
      <LegalTextView
        title="t"
        content={null}
        publishedAt={null}
        whatsappHref={WA}
      />
    )
    expect(html).toContain(shellCopy.public.emptyPage)
    expect(html).not.toContain("עודכן")
    expect(html).toContain(`href="${WA}"`)
    expect(html).not.toContain("?text=")
  })
})

describe("AccessibilityView (story 5.5)", () => {
  it("shows the statement's text, then the contact for accessibility", () => {
    const html = renderToStaticMarkup(
      <AccessibilityView
        content={STATEMENT}
        publishedAt={PUBLISHED}
        details={null}
      />
    )
    const order = [
      "intro-h",
      "statement-text",
      "venue-h",
      a11y.contact,
      "contact-name",
    ].map((text) => html.indexOf(text))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toMatch(/<h2[^>]*>intro-h<\/h2>/)
    expect(html).toMatch(/<h2[^>]*>פרטי קשר לנגישות<\/h2>/)
    expect(html).toContain("contact-name")
    expect(html).toContain('href="tel:0544256456"')
    // Shown as the site shows phones, whatever was typed.
    expect(html).toContain("054-425-6456")
    expect(html).toContain('href="mailto:a11y@example.com"')
    expect(html).toContain(copy.updated("06.10.2026"))
  })

  const details: BusinessDetailsContent = {
    whatsapp_phone: "0544256456",
    phone: "054-4256456",
    whatsapp_message: "hello",
  }

  it("before the first publish shows the published phone and WhatsApp", () => {
    const html = renderToStaticMarkup(
      <AccessibilityView content={null} publishedAt={null} details={details} />
    )
    expect(html).toContain(a11y.soon)
    expect(html).toContain(a11y.soonContact)
    expect(html).toContain('href="tel:0544256456"')
    // The plain number, without the prepared message (user decision
    // 2026-10-06).
    expect(html).toContain('href="https://wa.me/972544256456"')
    expect(html).not.toContain("?text=")
    expect(html).not.toContain("<h2")
  })

  it("without contact details shows only the first sentence", () => {
    const html = renderToStaticMarkup(
      <AccessibilityView content={null} publishedAt={null} details={null} />
    )
    expect(html).toContain(a11y.soon)
    expect(html).not.toContain(a11y.soonContact)
    expect(html).not.toContain("<a")
  })
})

describe("footer legal links (story 5.5)", () => {
  it("links only the accessibility statement while nothing is published", () => {
    const html = renderToStaticMarkup(
      <SiteFooter details={null} legal={visibleLegalNav([])} />
    )
    expect(html).toContain('href="/accessibility"')
    expect(html).not.toContain('href="/privacy"')
    expect(html).not.toContain('href="/terms"')
  })

  it("links all three once published", () => {
    const html = renderToStaticMarkup(
      <SiteFooter
        details={null}
        legal={visibleLegalNav(["privacy", "terms", "accessibility"])}
      />
    )
    for (const href of ["/accessibility", "/privacy", "/terms"]) {
      expect(html).toContain(`href="${href}"`)
    }
  })
})
