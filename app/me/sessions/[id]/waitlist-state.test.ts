import { describe, expect, it } from "vitest"

import type { BookingPreview } from "./booking-preview"
import { waitlistShowsFull, waitlistState } from "./waitlist-state"

const FULL: BookingPreview = { kind: "blocked", code: "EVENT_FULL" }
const NO_CARD: BookingPreview = {
  kind: "blocked",
  code: "NO_MATCHING_ENTITLEMENT",
}
const BOOKABLE: BookingPreview = {
  kind: "bookable",
  source: "credit",
  originStartsAt: "2026-10-01T07:00:00Z",
  cancelDeadline: "2026-10-10T07:00:00Z",
}

describe("waitlistState (story 5.6)", () => {
  it("full and not waiting: the offer", () => {
    expect(
      waitlistState({ preview: FULL, waiting: false, fromWaitlist: false })
    ).toEqual({ kind: "offer" })
  })

  it("not full and not waiting: nothing", () => {
    for (const preview of [NO_CARD, BOOKABLE]) {
      expect(
        waitlistState({ preview, waiting: false, fromWaitlist: true })
      ).toEqual({ kind: "none" })
    }
  })

  it("waiting: the waiting state with any preview; taken only from the notification while still full", () => {
    expect(
      waitlistState({ preview: FULL, waiting: true, fromWaitlist: false })
    ).toEqual({ kind: "waiting", taken: false })
    expect(
      waitlistState({ preview: FULL, waiting: true, fromWaitlist: true })
    ).toEqual({ kind: "waiting", taken: true })
    expect(
      waitlistState({ preview: BOOKABLE, waiting: true, fromWaitlist: true })
    ).toEqual({ kind: "waiting", taken: false })
    expect(
      waitlistState({ preview: NO_CARD, waiting: true, fromWaitlist: false })
    ).toEqual({ kind: "waiting", taken: false })
  })

  it("her booking, a cancelled or a completed session: nothing", () => {
    for (const preview of [
      { kind: "cancelled", booked: false },
      { kind: "completed" },
      {
        kind: "booked",
        bookingId: null,
        funding: "card",
        productName: "",
        optionsCount: 1,
        cancelDeadline: null,
        canSelfCancel: true,
      },
    ] as BookingPreview[]) {
      expect(
        waitlistState({ preview, waiting: true, fromWaitlist: true })
      ).toEqual({ kind: "none" })
    }
  })
})

describe("waitlistState after the registration closed (story 5.6)", () => {
  it("an active entry or a full session: nothing", () => {
    const closed: BookingPreview = {
      kind: "blocked",
      code: "REGISTRATION_CLOSED",
    }
    for (const waiting of [true, false]) {
      expect(
        waitlistState({ preview: closed, waiting, fromWaitlist: true })
      ).toEqual({ kind: "none" })
    }
  })
})

describe("waitlistShowsFull (story 5.6)", () => {
  it("full with the offer or waiting: the waitlist panel says full", () => {
    expect(waitlistShowsFull(FULL, { kind: "offer" })).toBe(true)
    expect(waitlistShowsFull(FULL, { kind: "waiting", taken: true })).toBe(true)
  })

  it("not full, or nothing to show: the booking panel keeps its notice", () => {
    expect(waitlistShowsFull(FULL, { kind: "none" })).toBe(false)
    expect(waitlistShowsFull(NO_CARD, { kind: "waiting", taken: false })).toBe(
      false
    )
    expect(waitlistShowsFull(BOOKABLE, { kind: "waiting", taken: false })).toBe(
      false
    )
  })
})
