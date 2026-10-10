import { describe, expect, it } from "vitest"

import {
  activeOptions,
  isBookableCredit,
  isExhaustedCredit,
  isOpenRefund,
  parseMyCredits,
} from "./credits"

const ROW = {
  credit_id: "c1",
  status: "active",
  party_size: 1,
  origin_starts_at: "2026-10-08T07:30:00Z",
  origin_concept_name: "Mothers",
  reserved_booking: null,
  options: [
    {
      event_id: "e1",
      starts_at: "2026-10-12T07:30:00Z",
      concept_name: "Mothers",
      state: "active",
    },
    {
      event_id: "e2",
      starts_at: "2026-10-15T07:30:00Z",
      concept_name: "Greek",
      state: "used",
    },
    { event_id: "e3", starts_at: "2026-10-16T07:30:00Z", state: "replaced" },
  ],
  waiting: false,
  refund: null,
}

describe("parseMyCredits (story 3.7)", () => {
  it("maps a credit, its options and its refund; a malformed row is skipped", () => {
    const [credit] = parseMyCredits([
      ROW,
      { credit_id: null },
      { ...ROW, status: "used" },
    ])
    expect(parseMyCredits([ROW, { credit_id: null }])).toHaveLength(1)
    expect(credit).toEqual({
      creditId: "c1",
      status: "active",
      partySize: 1,
      originStartsAt: "2026-10-08T07:30:00Z",
      originConceptName: "Mothers",
      reserved: null,
      options: [
        {
          eventId: "e1",
          startsAt: "2026-10-12T07:30:00Z",
          conceptName: "Mothers",
          state: "active",
        },
        {
          eventId: "e2",
          startsAt: "2026-10-15T07:30:00Z",
          conceptName: "Greek",
          state: "used",
        },
      ],
      waiting: false,
      exhausted: false,
      refund: null,
    })
    expect(activeOptions(credit).map((o) => o.eventId)).toEqual(["e1"])
    expect(parseMyCredits(null)).toEqual([])
  })

  it("bookable while active and not funding a booking; an open refund request", () => {
    const [free, reserved, refund] = parseMyCredits([
      ROW,
      {
        ...ROW,
        credit_id: "c2",
        reserved_booking: {
          booking_id: "b1",
          event_id: "e2",
          starts_at: "2026-10-15T07:30:00Z",
        },
      },
      {
        ...ROW,
        credit_id: "c3",
        status: "refund_requested",
        options: [],
        refund: {
          amount_agorot: 12800,
          status: "requested",
          requested_at: "2026-10-10T07:00:00Z",
        },
      },
    ])
    expect(isBookableCredit(free)).toBe(true)
    expect(isBookableCredit(reserved)).toBe(false)
    expect(reserved.reserved).toEqual({
      bookingId: "b1",
      eventId: "e2",
      startsAt: "2026-10-15T07:30:00Z",
    })
    expect(isBookableCredit(refund)).toBe(false)
    expect(isOpenRefund(refund)).toBe(true)
    expect(refund.refund).toEqual({
      amountAgorot: 12800,
      status: "requested",
      requestedAt: "2026-10-10T07:00:00Z",
    })
    expect(isOpenRefund(free)).toBe(false)
  })

  it("an exhausted credit is not bookable (no home line); it has its own card", () => {
    const [exhausted] = parseMyCredits([
      { ...ROW, options: [], exhausted: true },
    ])
    expect(exhausted.exhausted).toBe(true)
    expect(isBookableCredit(exhausted)).toBe(false)
    expect(isExhaustedCredit(exhausted)).toBe(true)
    expect(isExhaustedCredit(parseMyCredits([ROW])[0])).toBe(false)
  })
})
