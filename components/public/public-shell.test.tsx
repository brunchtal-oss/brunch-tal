import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import { ContactDetails, hasContactDetails, telHref } from "./contact-details"
import { EmptyPublicPage, PublicPageHeading } from "./public-page"
import {
  FaqSection,
  StepsSection,
  TestimonialsSection,
  TextBlockSection,
} from "./sections"
import { SiteFooter } from "./site-footer"
import { TopBar } from "./top-bar"
import { WhatsappBar, WhatsappFlowLink } from "./whatsapp-bar"

vi.mock("next/navigation", () => ({
  usePathname: () => "/gallery",
}))

const copy = shellCopy.public
const WA = "https://wa.me/972544256456?text=hi"

describe("TopBar", () => {
  const html = renderToStaticMarkup(<TopBar name="biz-name" />)

  it("is a sticky header with the menu, the name home and the login", () => {
    expect(html).toMatch(/^<header[^>]*data-top-bar/)
    expect(html).toContain("sticky top-0")
    expect(html).toContain(`aria-label="${copy.menu}"`)
    expect(html).toContain('href="/"')
    expect(html).toContain("biz-name")
    expect(html).toContain('href="/login"')
    expect(html).toContain(copy.customerLogin)
  })

  it("keeps the order menu, name, login", () => {
    const menu = html.indexOf(copy.menu)
    const name = html.indexOf("biz-name")
    const login = html.indexOf(copy.customerLogin)
    expect(menu).toBeLessThan(name)
    expect(name).toBeLessThan(login)
  })

  it("has no physical direction classes", () => {
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
  })
})

describe("WhatsappBar", () => {
  it("is a named aside with the link and its accessible name", () => {
    const html = renderToStaticMarkup(<WhatsappBar href={WA} />)
    expect(html).toMatch(/^<aside[^>]*aria-label="יצירת קשר"/)
    expect(html).toContain("data-whatsapp-bar")
    expect(html).toContain(`href="${WA}"`)
    expect(html).toContain(`aria-label="${copy.whatsappBarName}"`)
    expect(html).toContain(copy.whatsappBar)
    expect(html).toContain("short:hidden")
  })

  it("is not shown without a usable number", () => {
    expect(renderToStaticMarkup(<WhatsappBar href={null} />)).toBe("")
    expect(renderToStaticMarkup(<WhatsappFlowLink href={null} />)).toBe("")
  })

  it("has an in-flow link for a short window", () => {
    const html = renderToStaticMarkup(<WhatsappFlowLink href={WA} />)
    expect(html).toContain("hidden")
    expect(html).toContain("short:block")
    expect(html).toContain(`href="${WA}"`)
  })
})

describe("SiteFooter", () => {
  const details = {
    whatsapp_phone: "0544256456",
    phone: "050-123 4567",
    address: "addr",
    navigation_url: "https://waze.com/ul?q=x",
  }
  const legal = [{ href: "/privacy", label: "privacy-label" }]

  it("shows the contact lines, the legal links and the admin entrance", () => {
    const html = renderToStaticMarkup(
      <SiteFooter details={details} legal={legal} />
    )
    expect(html).toMatch(/^<footer[^>]*data-site-footer/)
    expect(html).toContain("bg-foreground")
    expect(html).toContain('href="tel:0501234567"')
    expect(html).toMatch(/href="https:\/\/waze\.com\/ul\?q=x"[^>]*>addr/)
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/admin/login"')
  })

  it("leaves out what is not published", () => {
    const html = renderToStaticMarkup(
      <SiteFooter
        details={{ whatsapp_phone: "0544256456", address: "addr" }}
        legal={[]}
      />
    )
    expect(html).not.toContain("tel:")
    expect(html).toContain("addr")
    expect(html).not.toContain("waze")
    expect(html).not.toContain('href="/privacy"')
    expect(html).toContain(copy.adminLogin)
  })

  it("shows the editor's links above the fixed ones, in a new tab", () => {
    const html = renderToStaticMarkup(
      <SiteFooter
        details={null}
        legal={[]}
        links={[{ label: "insta", url: "https://instagram.com/x" }]}
      />
    )
    expect(html).toMatch(
      /href="https:\/\/instagram\.com\/x" target="_blank" rel="noopener noreferrer"[^>]*>insta/
    )
    expect(html).toContain(copy.contact.opensOutside)
    expect(html.indexOf("instagram")).toBeLessThan(html.indexOf("/admin/login"))
  })

  it("always links to the install guide (story 5.9)", () => {
    const html = renderToStaticMarkup(<SiteFooter details={null} legal={[]} />)
    expect(html).toMatch(/href="\/install"[^>]*>[^<]+<\/a>/)
  })
})

describe("sections", () => {
  it("renders a text block with its eyebrow, title and text, escaped", () => {
    const html = renderToStaticMarkup(
      <TextBlockSection
        content={{ eyebrow: "eb", title: "tt", body: "<b>x</b>" }}
      />
    )
    expect(html).toContain("eb")
    expect(html).toMatch(/<h2[^>]*>tt<\/h2>/)
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).not.toContain("<b>")
  })

  it("numbers the steps in an ordered list", () => {
    const html = renderToStaticMarkup(
      <StepsSection
        label="steps"
        content={{
          items: [
            { title: "s1", body: "b1" },
            { title: "s2", body: "b2" },
          ],
        }}
      />
    )
    expect(html).toContain("<ol")
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(html).toMatch(/<h3[^>]*>s1<\/h3>/)
    // Without a title the section is named by its label.
    expect(html).toContain('aria-label="steps"')
    expect(html).not.toContain("<h2")
  })

  it("opens each answer from its question", () => {
    const html = renderToStaticMarkup(
      <FaqSection
        label="faq"
        content={{ title: "ft", items: [{ question: "q1", answer: "a1" }] }}
      />
    )
    expect(html).toContain("<details")
    expect(html).toMatch(/<summary[^>]*>.*q1/)
    expect(html).toContain("a1")
    expect(html).toMatch(/<h2[^>]*>ft<\/h2>/)
    expect(html).not.toContain('aria-label="faq"')
  })

  it("shows each testimonial with its name", () => {
    const html = renderToStaticMarkup(
      <TestimonialsSection
        label="t"
        content={{ items: [{ name: "n1", text: "t1" }] }}
      />
    )
    expect(html).toMatch(/<blockquote[^>]*>t1<\/blockquote>/)
    expect(html).toMatch(/<figcaption[^>]*>n1<\/figcaption>/)
  })
})

describe("ContactDetails", () => {
  const full = {
    whatsapp_phone: "054-425-6456",
    phone: "050-123 4567",
    address: "addr",
    arrival_instructions: "arrive",
    navigation_url: "https://maps.example.com/x",
    payment_instructions: "pay",
  }

  it("shows the phone, address, arrival and navigation, without WhatsApp or payment", () => {
    const html = renderToStaticMarkup(<ContactDetails details={full} />)
    expect(html).toContain('href="tel:0501234567"')
    expect(html).toContain("addr")
    expect(html).toContain("arrive")
    expect(html).toContain('href="https://maps.example.com/x"')
    expect(html).not.toContain("wa.me")
    expect(html).not.toContain("054-425-6456")
    expect(html).not.toContain("pay")
    expect(html).toContain("<bdi")
  })

  it("leaves out an empty field", () => {
    const html = renderToStaticMarkup(
      <ContactDetails
        details={{ whatsapp_phone: "0544256456", address: "a" }}
      />
    )
    expect(html).not.toContain(copy.contact.phone + "<")
    expect(html).not.toContain("tel:")
    expect(html).toContain(copy.contact.address)
  })

  it("shows nothing without details", () => {
    expect(renderToStaticMarkup(<ContactDetails details={null} />)).toBe("")
  })

  it("has nothing to show for a WhatsApp-only record", () => {
    const only = { whatsapp_phone: "0544256456" }
    expect(hasContactDetails(only)).toBe(false)
    expect(renderToStaticMarkup(<ContactDetails details={only} />)).toBe("")
    expect(hasContactDetails({ ...only, address: "a" })).toBe(true)
    expect(hasContactDetails(null)).toBe(false)
  })

  it("dials digits only", () => {
    expect(telHref("+972 (54) 425-6456")).toBe("tel:+972544256456")
  })
})

describe("public page", () => {
  it("has the page name as h1", () => {
    expect(
      renderToStaticMarkup(<PublicPageHeading>name</PublicPageHeading>)
    ).toMatch(/<h1[^>]*>name<\/h1>/)
  })

  it("shows a status line and the WhatsApp link when nothing is published", () => {
    const html = renderToStaticMarkup(<EmptyPublicPage whatsappHref={WA} />)
    expect(html).toContain(copy.emptyPage)
    expect(html).toContain(`href="${WA}"`)
    expect(
      renderToStaticMarkup(<EmptyPublicPage whatsappHref={null} />)
    ).not.toContain("<a")
  })
})
