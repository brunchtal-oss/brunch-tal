import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  cancelDoneMessage,
  parseCancelResult,
  parseMyBookings,
  pastBookingStatus,
  returnsText,
} from "./cancel-result"

const copy = customerCopy.cancel

describe("cancelDoneMessage", () => {
  it("a card, a pinned entry with its date, and a waiting one", () => {
    expect(
      cancelDoneMessage(
        parseCancelResult({ outcome: "card", expires_on: "2026-11-11" })
      )
    ).toBe(copy.doneCard)
    expect(
      cancelDoneMessage(
        parseCancelResult({ outcome: "pinned", expires_on: "2026-10-20" })
      )
    ).toBe(copy.donePinned("20.10"))
    expect(
      cancelDoneMessage(
        parseCancelResult({
          outcome: "pinned",
          expires_on: "2036-10-14",
          awaiting_sessions: true,
        })
      )
    ).toBe(copy.doneAwaiting)
  })

  it("never names Tal or a deadline", () => {
    for (const text of [copy.doneCard, copy.doneAwaiting, copy.closed]) {
      expect(text).not.toMatch(/(^|[\s"(])טל($|[\s.,)])/)
    }
  })
})

describe("returnsText", () => {
  it("by the funding", () => {
    expect(returnsText("card", "כרטיסייה", 2)).toBe(
      copy.returnsCard("כרטיסייה")
    )
    expect(returnsText("pinned", "x", 2)).toBe(
      "כניסה לאחד משני המפגשים המתאימים הבאים"
    )
    expect(returnsText("pinned", "x", 3)).toBe(copy.returnsPinned(3))
    expect(returnsText("returned", "x", 2)).toBe(copy.returnsReturned)
  })
})

describe("parseMyBookings", () => {
  it("maps the rows and leaves out a malformed one", () => {
    const parsed = parseMyBookings({
      upcoming: [
        {
          booking_id: "b1",
          event_id: "e1",
          status: "confirmed",
          starts_at: "2026-10-12T07:00:00+00:00",
          concept_name: "Mothers",
          can_self_cancel: true,
          funding: "pinned",
          product_name: "Single",
        },
        { booking_id: null },
      ],
      past: [
        {
          booking_id: "b2",
          event_id: "e2",
          status: "cancelled",
          starts_at: "2026-10-01T07:00:00+00:00",
          concept_name: "Mothers",
          funding: "other",
        },
      ],
      options_count: 2,
    })
    expect(parsed.upcoming).toEqual([
      {
        bookingId: "b1",
        eventId: "e1",
        status: "confirmed",
        startsAt: "2026-10-12T07:00:00+00:00",
        conceptName: "Mothers",
        canSelfCancel: true,
        funding: "pinned",
        productName: "Single",
      },
    ])
    expect(parsed.past[0]).toMatchObject({
      funding: "card",
      canSelfCancel: false,
    })
    expect(parsed.optionsCount).toBe(2)
    expect(parseMyBookings(null)).toEqual({
      upcoming: [],
      past: [],
      optionsCount: 1,
    })
  })

  it("a past booking is cancelled or took place", () => {
    expect(pastBookingStatus("cancelled")).toBe(customerCopy.bookingCancelled)
    expect(pastBookingStatus("completed")).toBe(customerCopy.bookingHeld)
  })
})
