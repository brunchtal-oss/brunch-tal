import { beforeEach, describe, expect, it, vi } from "vitest"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))

const { companionNoteBooking, coupleSessionBookings } =
  await import("./companion-booking")

const client = {} as Parameters<typeof coupleSessionBookings>[0]

function row(extra: Record<string, unknown> = {}) {
  return {
    booking_id: "b1",
    event_id: "e1",
    status: "confirmed",
    starts_at: "2026-12-10T07:30:00Z",
    concept_name: "concept-a",
    party_size: 2,
    guest_details: "vegetarian",
    guest_details_editable: true,
    ...extra,
  }
}

function answer(upcoming: unknown[]) {
  callRpc.mockResolvedValue({ ok: true, data: { upcoming, past: [] } })
}

async function noteFor(bookingId: string | null) {
  return companionNoteBooking(
    await coupleSessionBookings(client, "couple"),
    bookingId
  )
}

beforeEach(() => callRpc.mockReset())

// Story 5.21 (fix 7): the companion's note on the session page.
describe("the companion note's booking", () => {
  it("a couple booking: its row from get_my_bookings", async () => {
    answer([row({ booking_id: "b0", event_id: "e0" }), row()])
    const booking = await noteFor("b1")
    expect(callRpc).toHaveBeenCalledWith(client, "get_my_bookings")
    expect(booking).toMatchObject({
      bookingId: "b1",
      guestDetails: "vegetarian",
      guestDetailsEditable: true,
    })
  })

  it("after the registration close: the row, not editable", async () => {
    answer([row({ guest_details_editable: false })])
    expect((await noteFor("b1"))?.guestDetailsEditable).toBe(false)
  })

  it("a regular session: nothing is read, no note", async () => {
    const bookings = await coupleSessionBookings(client, "regular")
    expect(bookings).toBeNull()
    expect(companionNoteBooking(bookings, "b1")).toBeNull()
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("no booking here, a failed read, a missing row or a single booking: no note", async () => {
    answer([row()])
    expect(await noteFor(null)).toBeNull()
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    expect(await noteFor("b1")).toBeNull()
    answer([row({ booking_id: "other" })])
    expect(await noteFor("b1")).toBeNull()
    answer([row({ party_size: 1 })])
    expect(await noteFor("b1")).toBeNull()
  })
})
