import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { refusalMessage } from "./preview"

import { ManualBooking } from "./manual-booking"
import type { BookPreview } from "./preview"

vi.mock("../../actions", () => ({
  adminBookCustomerAction: vi.fn(),
  previewAdminBookAction: vi.fn(),
}))

const copy = adminCopy.sessions
const EVENT_ID = "11111111-1111-4111-8111-111111111111"
const CUSTOMER = { id: "33333333-3333-4333-8333-333333333333", name: "Dana" }

function render(preview: BookPreview) {
  return renderToStaticMarkup(
    <ManualBooking
      eventId={EVENT_ID}
      customer={CUSTOMER}
      initialPreview={preview}
    />
  )
}

describe("ManualBooking", () => {
  it("no matching entitlement: the reason and a payment for her", () => {
    const html = render({
      ok: false,
      code: "NO_MATCHING_ENTITLEMENT",
      occupied: 3,
      capacity: 12,
    })
    expect(html).toContain(refusalMessage("NO_MATCHING_ENTITLEMENT"))
    expect(html).toContain(`href="/admin/payments/new/existing/${CUSTOMER.id}"`)
    expect(html).toContain(copy.addPayment)
    expect(html).not.toContain("<button")
  })

  it("full: the reason and raising the capacity", () => {
    const html = render({
      ok: false,
      code: "EVENT_FULL",
      occupied: 12,
      capacity: 12,
    })
    expect(html).toContain(refusalMessage("EVENT_FULL"))
    expect(html).toContain(`href="/admin/sessions/${EVENT_ID}/edit"`)
    expect(html).toContain(copy.raiseCapacity)
    expect(html).not.toContain("<button")
  })

  it("ok: what will be used and one book button", () => {
    const html = render({
      ok: true,
      source: "entitlement",
      productName: "Card",
      expiresOn: "2026-11-19",
      occupied: 3,
      capacity: 12,
    })
    expect(html).toContain(copy.willUse("Card", "19.11"))
    expect(html).toContain("<button")
    expect(html).toContain(copy.bookCustomer("Dana"))
  })

  it("story 3.7: funded by her credit: the credit, no validity date", () => {
    const html = render({
      ok: true,
      source: "credit",
      productName: "Single",
      expiresOn: null,
      occupied: 3,
      capacity: 12,
    })
    expect(html).toContain("ינוצל: זיכוי מביטול של Single")
    expect(html).not.toContain("בתוקף עד")
    expect(html).toContain(copy.bookCustomer("Dana"))
  })
})
