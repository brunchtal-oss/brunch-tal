import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

const callRpc = vi.fn()

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/content/business-details", () => ({
  getWhatsappHref: async () => null,
}))
vi.mock("../sessions/load-sessions", () => ({
  sessionPhotos: async () => new Map(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const { Bookings } = await import("./bookings-list")

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

const PENDING = {
  ...CREDIT,
  credit_id: "c5",
  waiting: false,
  choice_pending: true,
  cancelled_starts_at: "2026-10-20T07:30:00Z",
  options_count: 2,
}

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

function answers(credits: unknown[]) {
  callRpc.mockImplementation(async (_client: unknown, name: string) =>
    name === "get_my_credits"
      ? { ok: true, data: credits }
      : { ok: true, data: { upcoming: [], past: [] } }
  )
}

beforeEach(() => {
  callRpc.mockReset()
})

// Story 3.8: a business cancel waiting for her choice on /me/bookings.
describe("my bookings: a pending choice", () => {
  it("only a pending choice: its card, not the empty state", async () => {
    answers([PENDING])
    const html = renderToStaticMarkup(await Bookings())
    expect(html).toContain(customerCopy.pendingChoice.button)
    expect(html).toContain(customerCopy.pendingChoice.title("20.10"))
    expect(html).not.toContain(customerCopy.bookingsEmpty)
  })

  it("the pending card comes before the credit and refund cards", async () => {
    answers([CREDIT, REFUND, PENDING])
    const html = renderToStaticMarkup(await Bookings())
    const pending = html.indexOf(customerCopy.pendingChoice.chip)
    expect(pending).toBeGreaterThan(-1)
    expect(pending).toBeLessThan(
      html.indexOf(customerCopy.creditTitle("08.10"))
    )
    expect(pending).toBeLessThan(html.indexOf(customerCopy.refundNote))
  })

  it("nothing at all: the empty state", async () => {
    answers([])
    const html = renderToStaticMarkup(await Bookings())
    expect(html).toContain(customerCopy.bookingsEmpty)
  })
})

// Story 3.9: a refund Tal recorded (the server returns it for 14 days).
describe("my bookings: a refunded credit", () => {
  it("renders its refunded card: the chip and the amount paid back; no refund note, no credit card", async () => {
    answers([
      {
        ...CREDIT,
        credit_id: "c7",
        status: "refunded",
        waiting: false,
        refund: {
          amount_agorot: 12000,
          status: "completed",
          requested_at: "2026-10-09T07:00:00Z",
          refunded_on: "2026-10-12",
        },
      },
    ])
    const html = renderToStaticMarkup(await Bookings())
    const text = html.replace(/\s/g, " ")
    expect(html).toContain(customerCopy.refundedChip)
    expect(text).toContain("ההחזר של 120 ₪ בוצע")
    expect(html).not.toContain(customerCopy.refundNote)
    expect(html).not.toContain(customerCopy.creditWaiting)
    expect(html).not.toContain(customerCopy.bookingsEmpty)
  })
})

// Story 5.21 (fix 7): the companion's note is on the session page, not
// under the card here.
describe("my bookings: a couple booking", () => {
  it("shows the card without the companion's note", async () => {
    callRpc.mockImplementation(async (_client: unknown, name: string) =>
      name === "get_my_credits"
        ? { ok: true, data: [] }
        : {
            ok: true,
            data: {
              upcoming: [
                {
                  booking_id: "b1",
                  event_id: "e1",
                  status: "confirmed",
                  starts_at: "2026-12-10T07:30:00Z",
                  concept_name: "concept-a",
                  can_self_cancel: true,
                  funding: "card",
                  product_name: "",
                  party_size: 2,
                  guest_details: "צמחונית",
                  guest_details_editable: true,
                },
              ],
              past: [],
            },
          }
    )
    const html = renderToStaticMarkup(await Bookings())
    expect(html).toContain("concept-a")
    expect(html).not.toContain(customerCopy.companion.label)
    expect(html).not.toContain("צמחונית")
    expect(html).not.toContain('id="booking-b1"')
  })
})
