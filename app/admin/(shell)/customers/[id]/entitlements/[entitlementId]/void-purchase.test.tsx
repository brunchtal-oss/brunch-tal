import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("./actions", () => ({
  previewVoidPurchaseAction: vi.fn(),
  voidPurchaseAction: vi.fn(),
}))

const { VoidNotice, VoidPurchase } = await import("./void-purchase")

const BOOKING = {
  bookingId: "b1",
  eventId: "e1",
  startsAt: "2026-10-16T07:00:00Z",
  conceptName: "שישי מיוחד",
  partySize: 1,
  guestDetails: null,
}

const PLAN = {
  ok: true as const,
  paymentId: "p1",
  kind: "card",
  customerLabel: "Noa",
  productName: "כרטיסייה 4",
  amountAgorot: 47200,
  paidOn: "2026-10-01",
  linkWillBeRevoked: false,
  bookings: [BOOKING],
}

describe("purchase void (story 2.14)", () => {
  it("the section: what it is for and its button", () => {
    const html = renderToStaticMarkup(<VoidPurchase paymentId="p1" />)
    expect(html).toContain("ביטול הרכישה")
    expect(html).not.toContain("←")
  })

  it("a card with a booking: the booking, both notification lines and the final notice", () => {
    const html = renderToStaticMarkup(<VoidNotice plan={PLAN} />)
    expect(html).toContain("הרשמות שיבוטלו, בלי זיכוי")
    expect(html).toContain("שישי מיוחד")
    expect(html).toContain("הלקוחה לא תקבל התראה")
    expect(html).toContain(
      "כבר בוצע רישום בכרטיסייה, יש לעדכן את הלקוחה על הביטול"
    )
    expect(html).toContain("הביטול סופי. אם זו טעות, רושמים תשלום חדש")
    expect(html).not.toContain("קישור ההצטרפות יבוטל")
  })

  it("an unbound pinned couple: זוגית, the link line, never the card line", () => {
    const html = renderToStaticMarkup(
      <VoidNotice
        plan={{
          ...PLAN,
          kind: "couple",
          linkWillBeRevoked: true,
          bookings: [{ ...BOOKING, partySize: 2, guestDetails: "Dana" }],
        }}
      />
    )
    expect(html).toContain("זוגית, Dana")
    expect(html).toContain("קישור ההצטרפות יבוטל")
    expect(html).toContain("הלקוחה לא תקבל התראה")
    expect(html).not.toContain("כבר בוצע רישום בכרטיסייה")
  })

  it("no future bookings", () => {
    const html = renderToStaticMarkup(
      <VoidNotice plan={{ ...PLAN, bookings: [] }} />
    )
    expect(html).toContain("אין הרשמות עתידיות מהרכישה")
    expect(html).not.toContain("כבר בוצע רישום בכרטיסייה")
  })
})
