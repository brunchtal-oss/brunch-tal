import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { MultiBooking, type BookRow } from "./multi-booking"

vi.mock("./actions", () => ({ adminBookSessionsAction: vi.fn() }))
vi.mock("../actions", () => ({ previewAdminBookAction: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/sessions/book",
}))

const copy = adminCopy.sessions

const CUSTOMER = { id: "44444444-4444-4444-8444-444444444444", name: "Dana" }
const PAYMENT_HREF = `href="/admin/payments/new/existing/${CUSTOMER.id}"`

const ROWS: BookRow[] = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Greek",
    details: "Sunday · 2/12",
    dateTime: "2026-12-15",
    booked: false,
  },
]

function render(hiddenCount: number, freeEntries = 2) {
  return renderToStaticMarkup(
    <MultiBooking
      customer={CUSTOMER}
      rows={ROWS}
      freeEntries={freeEntries}
      hiddenCount={hiddenCount}
    />
  )
}

function count(html: string, text: string) {
  return html.split(text).length - 1
}

describe("MultiBooking: the hidden line (story 3.19)", () => {
  it("2 hidden: the line and the add-payment link", () => {
    const html = render(2)
    expect(html).toContain("2 מפגשים לא מוצגים כי אין לה זכות שמתאימה להם")
    expect(count(html, PAYMENT_HREF)).toBe(1)
    expect(html).toContain(copy.addPayment)
  })

  it("nothing hidden: neither shows", () => {
    const html = render(0)
    expect(html).not.toContain("לא מוצגים")
    expect(html).not.toContain("לא מוצג ")
    expect(html).not.toContain(PAYMENT_HREF)
  })

  it("no free entries: the line shows, with the cap notice's one add-payment link only", () => {
    const html = render(2, 0)
    expect(html).toContain(copy.hiddenSessions(2))
    expect(count(html, PAYMENT_HREF)).toBe(1)
  })
})
