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
// The booking panel has its own tests; here only whether it is shown.
vi.mock("./booking-panel", () => ({
  BookingPanel: () => <p>BOOKING_PANEL</p>,
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
