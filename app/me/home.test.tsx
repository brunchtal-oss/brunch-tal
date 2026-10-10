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
    creditStatus: null,
    ...extra,
  }
}

const CARD = entitlement({})

// Story 3.7: a credit she can book with (get_my_credits).
const CREDIT = {
  credit_id: "c1",
  status: "active",
  party_size: 1,
  origin_starts_at: "2026-10-08T07:30:00Z",
  origin_concept_name: "concept-c",
  reserved_booking: null,
  options: [],
  waiting: true,
  refund: null,
}

function bookings(
  upcoming: ReturnType<typeof booking>[],
  credits: unknown[] = [],
  past: unknown[] = []
) {
  callRpc.mockImplementation(async (_client: unknown, name: string) =>
    name === "get_my_credits"
      ? { ok: true, data: credits }
      : { ok: true, data: { upcoming, past } }
  )
}

// An open refund request (get_my_credits).
const REFUND = {
  ...CREDIT,
  credit_id: "c9",
  status: "refund_requested",
  waiting: false,
  refund: {
    amount_agorot: 12800,
    status: "requested",
    requested_at: "2026-10-09T07:00:00Z",
  },
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
  it("next session, card, the credit line, later sessions, then all bookings; the time only on the next one", async () => {
    bookings(
      [
        booking("b1", NEXT, "2026-10-12T07:30:00Z"),
        booking("b2", LATER, "2026-10-15T07:30:00Z"),
      ],
      [CREDIT]
    )
    loadMyEntitlements.mockResolvedValue([CARD])
    const html = renderToStaticMarkup(await Home())

    const order = [
      customerCopy.upcomingTitle,
      customerCopy.cardTitle,
      customerCopy.homeCredit,
      customerCopy.moreUpcomingTitle,
      customerCopy.allMyBookings,
    ].map((label) => html.indexOf(label))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html.split(customerCopy.allMyBookings).length - 1).toBe(1)
    expect(getPublicSession).toHaveBeenCalledWith(NEXT, {})
    // The credit line leads to her bookings (story 3.7).
    expect(html).toContain('href="/me/bookings"')

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

  it("only a card: its section, no empty session section, and the link to all bookings (2026-10-10)", async () => {
    bookings([])
    loadMyEntitlements.mockResolvedValue([CARD])
    const html = renderToStaticMarkup(await Home())

    expect(html).toContain(customerCopy.cardTitle)
    expect(html).toContain(customerCopy.availableEntriesLabel)
    expect(html).not.toContain(customerCopy.upcomingTitle)
    expect(html).not.toContain(customerCopy.moreUpcomingTitle)
    expect(html).toContain(customerCopy.allMyBookings)
    expect(html).not.toContain(customerCopy.emptyHomeTitle)
    expect(html.match(/<section/g)).toHaveLength(1)
    expect(getPublicSession).not.toHaveBeenCalled()
  })
})

describe("customer home: credits (story 3.7)", () => {
  it("only a credit she can book with: no empty-state, the line to her bookings", async () => {
    bookings([], [CREDIT])
    loadMyEntitlements.mockResolvedValue([])
    const html = renderToStaticMarkup(await Home())
    expect(html).toContain(customerCopy.homeCredit)
    expect(html).not.toContain(customerCopy.emptyHomeTitle)
  })

  it("an exhausted credit: no credit line", async () => {
    bookings([], [{ ...CREDIT, waiting: false, exhausted: true }])
    loadMyEntitlements.mockResolvedValue([])
    const html = renderToStaticMarkup(await Home())
    expect(html).not.toContain(customerCopy.homeCredit)
  })

  it("a credit that funds a booking, or a refund request: no credit line", async () => {
    bookings(
      [],
      [
        {
          ...CREDIT,
          reserved_booking: {
            booking_id: "b9",
            event_id: NEXT,
            starts_at: "2026-10-12T07:30:00Z",
          },
        },
        { ...CREDIT, credit_id: "c2", status: "refund_requested" },
      ]
    )
    loadMyEntitlements.mockResolvedValue([])
    const html = renderToStaticMarkup(await Home())
    expect(html).not.toContain(customerCopy.homeCredit)
    expect(html).toContain(customerCopy.emptyHomeTitle)
  })
})

describe("customer home: all bookings and the refund line (2026-10-10)", () => {
  function lastLink(html: string): boolean {
    const at = html.lastIndexOf(customerCopy.allMyBookings)
    return at > -1 && html.indexOf("href=", at) === -1
  }

  it("a card without an upcoming session: all bookings is the last element", async () => {
    bookings([])
    loadMyEntitlements.mockResolvedValue([CARD])
    const html = renderToStaticMarkup(await Home())
    expect(html.split(customerCopy.allMyBookings).length - 1).toBe(1)
    expect(lastLink(html)).toBe(true)
  })

  it("an open refund request: its line to her bookings, and all bookings last", async () => {
    bookings([], [REFUND])
    loadMyEntitlements.mockResolvedValue([])
    const html = renderToStaticMarkup(await Home())
    expect(customerCopy.homeRefund).toBe("בקשת ההחזר שלך התקבלה")
    expect(html).toContain(customerCopy.homeRefund)
    expect(html).not.toContain(customerCopy.homeCredit)
    expect(html).not.toContain(customerCopy.emptyHomeTitle)
    expect(html.indexOf(customerCopy.homeRefund)).toBeLessThan(
      html.indexOf(customerCopy.allMyBookings)
    )
    expect(lastLink(html)).toBe(true)
  })

  it("the empty home: all bookings only with past bookings", async () => {
    bookings([], [], [booking("p1", NEXT, "2026-10-01T07:30:00Z")])
    loadMyEntitlements.mockResolvedValue([])
    let html = renderToStaticMarkup(await Home())
    expect(html).toContain(customerCopy.emptyHomeTitle)
    expect(html).toContain(customerCopy.allMyBookings)

    bookings([])
    html = renderToStaticMarkup(await Home())
    expect(html).toContain(customerCopy.emptyHomeTitle)
    expect(html).not.toContain(customerCopy.allMyBookings)
  })
})
