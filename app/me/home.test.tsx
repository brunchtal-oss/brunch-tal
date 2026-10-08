import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import type { MyEntitlement } from "./purchase-items"

const callRpc = vi.fn()
const loadMyEntitlements = vi.fn<() => Promise<MyEntitlement[]>>()
const getPublicSession = vi.fn()

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("./load-entitlements", () => ({
  loadMyEntitlements: () => loadMyEntitlements(),
}))
vi.mock("@/lib/content/business-details", () => ({
  getWhatsappHref: async () => null,
}))
vi.mock("@/lib/sessions/public", () => ({
  getPublicSession: (...args: unknown[]) => getPublicSession(...args),
}))

const { Home } = await import("./home")

const NEXT = "00000000-0000-4000-8000-000000000001"
const LATER = "00000000-0000-4000-8000-000000000002"

// 12.10.2026 and 15.10.2026, both 10:30 in Jerusalem.
function booking(id: string, eventId: string, startsAt: string) {
  return {
    booking_id: id,
    event_id: eventId,
    status: "confirmed",
    starts_at: startsAt,
    concept_name: `concept-${id}`,
  }
}

function entitlement(extra: Partial<MyEntitlement>): MyEntitlement {
  return {
    id: "ent-card",
    kind: "card",
    status: "active",
    productName: "Personal card",
    amountAgorot: 50000,
    paidOn: "2026-10-01",
    originalUnits: 4,
    available: 1,
    reserved: 2,
    used: 1,
    expiresOn: "2026-11-19",
    isExpired: false,
    expiredBeforeBound: false,
    daysLeft: 40,
    isExpiring: false,
    isUsedUp: false,
    validityDays: 49,
    pinnedEventId: null,
    paymentId: "pay-1",
    returned: false,
    awaitingSessions: false,
    ...extra,
  }
}

const CARD = entitlement({})
const RETURNED = entitlement({
  id: "ent-returned",
  kind: "single",
  productName: "Single brunch",
  originalUnits: 1,
  available: 1,
  reserved: 0,
  used: 0,
  returned: true,
})

function bookings(upcoming: ReturnType<typeof booking>[]) {
  callRpc.mockResolvedValue({ ok: true, data: { upcoming, past: [] } })
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ")
}

beforeEach(() => {
  callRpc.mockReset()
  loadMyEntitlements.mockReset()
  getPublicSession.mockReset()
  getPublicSession.mockResolvedValue({ photo: null })
})

// The spec's matrix (design round 2026-10-07/08): the home's order, and the
// brunch time only on her next session.
describe("customer home", () => {
  it("next session, card, returned entry, later sessions, then all bookings; the time only on the next one", async () => {
    bookings([
      booking("b1", NEXT, "2026-10-12T07:30:00Z"),
      booking("b2", LATER, "2026-10-15T07:30:00Z"),
    ])
    loadMyEntitlements.mockResolvedValue([CARD, RETURNED])
    const html = renderToStaticMarkup(await Home())

    const order = [
      customerCopy.upcomingTitle,
      customerCopy.cardTitle,
      customerCopy.returnedTitle,
      customerCopy.moreUpcomingTitle,
      customerCopy.allMyBookings,
    ].map((label) => html.indexOf(label))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html.split(customerCopy.allMyBookings).length - 1).toBe(1)
    expect(getPublicSession).toHaveBeenCalledWith(NEXT, {})
    // The returned single entry: a chip, no plates or counts (2026-10-08).
    expect(html).toContain(customerCopy.toBook)
    expect(html).not.toContain(customerCopy.usedOf(0, 1))

    // A rule between the sections (user decision 2026-10-08).
    expect(html).toContain("section~section]:border-t")
    // The next card: "בראנץ׳ {concept}" on one line in its title, the chip
    // beside it, and no separate "בראנץ׳" label above it.
    expect(html).toContain(`${customerCopy.brunch} <bdi>concept-b1</bdi>`)
    // The next card: the time, visible and in its accessible name.
    expect(html).toContain("יום שני 12.10 · 10:30")
    expect(html).toContain("12 באוקטובר, 10:30")
    // The later row: weekday and date only, also for screen readers.
    expect(html).toContain(
      `${customerCopy.sessionTitle("concept-b2")}, יום חמישי, 15 באוקטובר</span>`
    )
    expect(text(html).match(/\d{2}:\d{2}/g)).toHaveLength(2)
  })

  it("next session and a card, no later ones: all bookings comes after the card", async () => {
    bookings([booking("b1", NEXT, "2026-10-12T07:30:00Z")])
    loadMyEntitlements.mockResolvedValue([CARD])
    const html = renderToStaticMarkup(await Home())

    expect(html).not.toContain(customerCopy.moreUpcomingTitle)
    expect(html.split(customerCopy.allMyBookings).length - 1).toBe(1)
    expect(html.indexOf(customerCopy.upcomingTitle)).toBeLessThan(
      html.indexOf(customerCopy.cardTitle)
    )
    expect(html.indexOf(customerCopy.cardTitle)).toBeLessThan(
      html.indexOf(customerCopy.allMyBookings)
    )
    // The link is the home's last element: after the card's validity.
    expect(html.indexOf(customerCopy.validUntil)).toBeLessThan(
      html.indexOf(customerCopy.allMyBookings)
    )
  })

  it("only a card: its section, no empty session section and no link to all bookings", async () => {
    bookings([])
    loadMyEntitlements.mockResolvedValue([CARD])
    const html = renderToStaticMarkup(await Home())

    expect(html).toContain(customerCopy.cardTitle)
    expect(html).toContain(customerCopy.availableEntriesLabel)
    expect(html).not.toContain(customerCopy.upcomingTitle)
    expect(html).not.toContain(customerCopy.moreUpcomingTitle)
    expect(html).not.toContain(customerCopy.allMyBookings)
    expect(html).not.toContain(customerCopy.emptyHomeTitle)
    expect(html.match(/<section/g)).toHaveLength(1)
    expect(getPublicSession).not.toHaveBeenCalled()
  })
})
