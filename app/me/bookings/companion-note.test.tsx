import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("./actions", () => ({ setGuestDetailsAction: vi.fn() }))

const { CompanionNote, companionAnchor } = await import("./companion-note")

const BOOKING = "33333333-3333-4333-8333-333333333333"
const CONTACT = "https://wa.me/972500000000"

function render(guestDetails: string | null, editable: boolean) {
  return renderToStaticMarkup(
    <CompanionNote
      bookingId={BOOKING}
      guestDetails={guestDetails}
      editable={editable}
      contactHref={CONTACT}
    />
  )
}

describe("the companion's note (story 3.5)", () => {
  it("the section is the notification's target: id booking-<id>", () => {
    expect(companionAnchor(BOOKING)).toBe(`booking-${BOOKING}`)
    expect(render(null, true)).toContain(`id="booking-${BOOKING}"`)
  })

  it("empty and editable: the label, 'לא נמסרו' and 'הוספה', no contact", () => {
    const html = render(null, true)
    expect(html).toContain("הגבלות תזונה או אלרגיות של המלווה")
    expect(html).toContain("לא נמסרו")
    expect(html).toContain(">הוספה<")
    expect(html).not.toContain(">עריכה<")
    expect(html).not.toContain(CONTACT)
  })

  it("saved and editable: the text and 'עריכה'", () => {
    const html = render("צמחונית", true)
    expect(html).toContain("צמחונית")
    expect(html).not.toContain("לא נמסרו")
    expect(html).toContain(">עריכה<")
  })

  it("after the registration close: read-only, with 'אפשר לשנות דרך צרי קשר'", () => {
    const html = render("צמחונית", false)
    expect(html).toContain("צמחונית")
    expect(html).not.toContain("<button")
    expect(html).toContain(customerCopy.companion.closedNote)
    expect(html).toContain(`href="${CONTACT}"`)
    expect(html).toContain(customerCopy.contactPhrase)
    expect(html).not.toMatch(/(^|[\s>"(])טל($|[\s.,)<])/)
  })
})
