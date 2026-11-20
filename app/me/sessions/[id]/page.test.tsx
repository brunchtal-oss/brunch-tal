import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

const callRpc = vi.fn()
// The rows the page reads through RLS, by table.
let waitlistRow: { id: string } | null = null
const waitlistFilters: unknown[][] = []

function chain(table: string) {
  const self = {
    select: () => self,
    eq: (...args: unknown[]) => {
      if (table === "waitlist_entries") waitlistFilters.push(args)
      return self
    },
    limit: () => self,
    maybeSingle: async () =>
      table === "events"
        ? { data: SESSION_ROW, error: null }
        : table === "waitlist_entries"
          ? { data: waitlistRow, error: null }
          : { data: null, error: null },
  }
  return self
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => chain(table) }),
}))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/content/business-details", () => ({
  getWhatsappHref: async () => null,
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/me/sessions/${ID}`,
}))
vi.mock("../actions", () => ({
  joinWaitlistAction: vi.fn(),
  leaveWaitlistAction: vi.fn(),
}))
const loadOptions = vi.fn()
vi.mock("./actions", () => ({
  loadSessionPurchaseOptions: (...args: unknown[]) => loadOptions(...args),
  startSessionPurchaseAction: vi.fn(),
}))
// The outcome cookie of a real payment return (review pass 1).
let outcomeCookie: string | undefined
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bt_payment_outcome" && outcomeCookie
        ? { value: outcomeCookie }
        : undefined,
  }),
}))
// The booking panel has its own tests; here only whether it is shown, and
// how many products it may offer.
vi.mock("./booking-panel", () => ({
  BookingPanel: ({
    purchaseProducts = [],
  }: {
    purchaseProducts?: readonly unknown[]
  }) => <p>BOOKING_PANEL:{purchaseProducts.length}</p>,
}))

const { SessionContent } = await import("./page")

const ID = "11111111-1111-4111-8111-111111111111"
const SESSION_ROW = {
  id: ID,
  kind: "regular",
  status: "published",
  description: null,
  starts_at: "2099-10-12T07:00:00+00:00",
  display_price_agorot: null,
  image: null,
  concepts: { name: "Grandma", description: null, default_image: null },
}

const copy = customerCopy.waitlist

// The preview (preview_book_session) answers with a refusal code.
function previewRefuses(code: string) {
  callRpc.mockImplementation(async (_client: unknown, name: string) =>
    name === "preview_book_session"
      ? { ok: false, code }
      : { ok: true, data: [] }
  )
}

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await SessionContent({
      params: Promise.resolve({ id: ID }),
      searchParams: Promise.resolve(search),
    })
  )
}

beforeEach(() => {
  loadOptions.mockReset()
  loadOptions.mockResolvedValue({ enabled: false, products: [] })
  outcomeCookie = undefined
  callRpc.mockReset()
  waitlistRow = null
  waitlistFilters.length = 0
})

// Story 5.6: the session page under the booking panel.
describe("the customer's session page and the waitlist", () => {
  it("full, not waiting: the offer replaces the booking panel", async () => {
    previewRefuses("EVENT_FULL")
    const html = await render()
    expect(html).toContain(copy.fullOffer)
    expect(html).toContain(copy.join)
    expect(html).not.toContain("BOOKING_PANEL")
    expect(html).toContain(customerCopy.allSessions)
  })

  it("reads only her active entry for this session", async () => {
    previewRefuses("EVENT_FULL")
    await render()
    expect(waitlistFilters).toEqual([
      ["event_id", ID],
      ["status", "active"],
    ])
  })

  it("full, waiting: the chip and the leave button, no offer", async () => {
    previewRefuses("EVENT_FULL")
    waitlistRow = { id: "w1" }
    const html = await render()
    expect(html).toContain(copy.chip)
    expect(html).toContain(copy.leave)
    expect(html).not.toContain(copy.join)
    expect(html).not.toContain(copy.taken)
  })

  it("from the notification (?from=waitlist) while still full: the place was taken", async () => {
    previewRefuses("EVENT_FULL")
    waitlistRow = { id: "w1" }
    const html = await render({ from: "waitlist" })
    expect(html).toContain(copy.taken)
    expect(html).toContain(copy.chip)
  })

  it("the registration closed: no waitlist, the booking panel says why", async () => {
    previewRefuses("REGISTRATION_CLOSED")
    waitlistRow = { id: "w1" }
    const html = await render({ from: "waitlist" })
    expect(html).toContain("BOOKING_PANEL")
    expect(html).not.toContain(copy.chip)
    expect(html).not.toContain(copy.fullOffer)
  })
})

// Story 6.7, T22 (SN7): a customer never sees the session's kind, also on a
// couple session, whatever the preview says, and also once she is booked
// there with her couple booking (the companion note shows).
const KIND_WORDS = ["זוגי", "זוגית", "זוגיים", "רגיל", "לשני מבוגרים"]
const COUPLE_BOOKING = {
  booking_id: "b1",
  event_id: ID,
  status: "confirmed",
  starts_at: "2099-10-12T07:00:00+00:00",
  concept_name: "Grandma",
  party_size: 2,
  guest_details: "COMPANION_NOTE_TEXT",
  guest_details_editable: true,
}

describe("the customer's session page and the session kind", () => {
  it.each<[string, { ok: boolean; source?: string; code?: string }, unknown[]]>(
    [
      ["bookable", { ok: true, source: "entitlement" }, []],
      ["full", { ok: false, code: "EVENT_FULL" }, []],
      [
        "no matching entitlement",
        { ok: false, code: "NO_MATCHING_ENTITLEMENT" },
        [],
      ],
      [
        "booked, with her couple booking",
        { ok: true, booked: true, booking_id: "b1" } as { ok: boolean },
        [COUPLE_BOOKING],
      ],
    ]
  )(
    "a couple session (%s) renders no kind word",
    async (_label, preview, upcoming) => {
      const kind = SESSION_ROW.kind
      SESSION_ROW.kind = "couple"
      try {
        callRpc.mockImplementation(async (_client: unknown, name: string) =>
          name === "preview_book_session"
            ? preview.ok
              ? { ok: true, data: preview }
              : { ok: false, code: preview.code }
            : name === "get_event_availability"
              ? {
                  ok: true,
                  data: [
                    {
                      event_id: ID,
                      label: "last_places",
                      registration_open: true,
                    },
                  ],
                }
              : name === "get_my_bookings"
                ? { ok: true, data: { upcoming, past: [] } }
                : { ok: true, data: [] }
        )
        const html = await render()
        expect(html).toContain("Grandma")
        if (upcoming.length > 0) {
          expect(html).toContain(customerCopy.companion.label)
          expect(html).toContain("COMPANION_NOTE_TEXT")
        } else {
          expect(html).not.toContain(customerCopy.companion.label)
        }
        for (const word of KIND_WORDS) {
          expect(html).not.toContain(word)
        }
      } finally {
        SESSION_ROW.kind = kind
      }
    }
  )
})

describe("online payments on her session page (PR B)", () => {
  const PRODUCT = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "בודד",
    type: "single",
    priceAgorot: 18000,
    units: 1,
    validityMode: "session",
    validityDays: null,
  }

  it("no fitting entry and buying enabled: the panel gets the products", async () => {
    previewRefuses("NO_MATCHING_ENTITLEMENT")
    loadOptions.mockResolvedValue({ enabled: true, products: [PRODUCT] })
    expect(await render()).toContain("BOOKING_PANEL:1")
    expect(loadOptions).toHaveBeenCalledWith(ID)
  })

  it("buying not enabled: no product reaches the panel, even when listed", async () => {
    previewRefuses("NO_MATCHING_ENTITLEMENT")
    loadOptions.mockResolvedValue({ enabled: false, products: [PRODUCT] })
    expect(await render()).toContain("BOOKING_PANEL:0")
  })

  it("another block: the options are not even read", async () => {
    previewRefuses("REGISTRATION_CLOSED")
    await render()
    expect(loadOptions).not.toHaveBeenCalled()
  })

  it("a return notice only with the matching outcome cookie", async () => {
    previewRefuses("REGISTRATION_CLOSED")
    const failed = customerCopy.purchase.notices.failed
    expect(await render({ payment: "failed" })).not.toContain(failed)
    outcomeCookie = "paid.session"
    expect(await render({ payment: "failed" })).not.toContain(failed)
    outcomeCookie = "failed.session"
    const html = await render({ payment: "failed" })
    expect(html).toContain(failed)
    // At the top, above the concept header.
    expect(html.indexOf(failed)).toBeLessThan(html.indexOf("<h1"))
  })
})
