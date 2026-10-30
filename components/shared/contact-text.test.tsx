import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { ContactText } from "./contact-text"

// Story 6.6 (P6, T22): the explanation of a card that expired before the
// join offers contact: "צרי קשר" is a link to the business's WhatsApp.
const HREF = "https://wa.me/972500000000"

describe("ContactText", () => {
  it("renders the expired-card explanation with צרי קשר as a link to WhatsApp", () => {
    const html = renderToStaticMarkup(
      <ContactText
        text={customerCopy.expiredBeforeBoundInfo(49)}
        href={HREF}
        phrase={customerCopy.contactPhrase}
      />
    )
    expect(customerCopy.contactPhrase).toBe("צרי קשר")
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toMatch(
      new RegExp(`<a href="${HREF}"[^>]*>${customerCopy.contactPhrase}</a>`)
    )
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("stays plain text without a WhatsApp link", () => {
    const html = renderToStaticMarkup(
      <ContactText
        text={customerCopy.expiredBeforeBoundInfo(49)}
        href={null}
        phrase={customerCopy.contactPhrase}
      />
    )
    expect(html).not.toContain("<a ")
    expect(html).toContain(customerCopy.contactPhrase)
  })
})
