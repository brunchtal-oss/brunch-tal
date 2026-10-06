import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"
import { ERROR_MESSAGES } from "@/lib/errors"

import { BookingPanel } from "./booking-panel"
import type { BookingPreview } from "./booking-preview"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("../actions", () => ({ bookSessionAction: vi.fn() }))
vi.mock("../../bookings/actions", () => ({ cancelBookingAction: vi.fn() }))

const CONTACT = "https://wa.me/972500000000"

function render(preview: BookingPreview) {
  return renderToStaticMarkup(
    <BookingPanel
      eventId="11111111-1111-4111-8111-111111111111"
      title="בראנץ׳ אמהות"
      startsAt="2026-10-12T07:00:00+00:00"
      preview={preview}
      contactHref={CONTACT}
    />
  )
}

const BOOKED = {
  kind: "booked",
  bookingId: "33333333-3333-4333-8333-333333333333",
  funding: "card",
  productName: "כרטיסייה",
  optionsCount: 2,
  cancelDeadline: "2026-10-10T07:00:00+00:00",
} as const

describe("BookingPanel (story 3.6)", () => {
  it("booked, inside the self-cancel window: her booking and the cancel button", () => {
    const html = render({ ...BOOKED, canSelfCancel: true })
    expect(html).toContain(customerCopy.registered)
    expect(html).toContain(customerCopy.cancel.button)
    expect(html).not.toContain(customerCopy.cancel.closed)
    expect(html).not.toContain(CONTACT)
  })

  it("booked, past the boundary: the contact phrase, no cancel button and no deadline", () => {
    const html = render({ ...BOOKED, canSelfCancel: false })
    expect(html).toContain(customerCopy.registered)
    expect(html).toContain(customerCopy.cancel.closed)
    expect(html).toContain(`href="${CONTACT}"`)
    expect(html).toContain(customerCopy.contactPhrase)
    expect(html).not.toContain(customerCopy.cancel.button)
    expect(html).not.toContain("10.10")
    expect(html).not.toMatch(/(^|[\s>"(])טל($|[\s.,)<])/)
  })

  it("story 3.12: completed: the session ended and she took part, no buttons, no cancel and no contact", () => {
    const html = render({ kind: "completed" })
    expect(html).toContain(ERROR_MESSAGES.EVENT_COMPLETED)
    expect(html).toContain(customerCopy.attended)
    expect(html).not.toContain("<button")
    expect(html).not.toContain(customerCopy.cancel.button)
    expect(html).not.toContain(customerCopy.registered)
    expect(html).not.toContain(customerCopy.contactPhrase)
    expect(html).not.toContain(CONTACT)
    expect(html).not.toContain(customerCopy.book)
  })

  it("bookable: the booking button, no cancel", () => {
    const html = render({
      kind: "bookable",
      productName: "כרטיסייה",
      availableAfter: 3,
      expiresOn: "2026-11-24",
      cancelDeadline: "2026-10-10T07:00:00+00:00",
    })
    expect(html).toContain(customerCopy.book)
    expect(html).not.toContain(customerCopy.cancel.button)
    expect(html).not.toContain(customerCopy.registered)
  })
})
