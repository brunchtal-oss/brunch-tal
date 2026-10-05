import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  parseBookResults,
  parseSelectionPreview,
  pruneSelection,
  resultsHeading,
  selectableRows,
  showsSelectEntry,
  toggleSelection,
  unavailableReason,
  usesByProduct,
} from "./selection"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const C = "33333333-3333-4333-8333-333333333333"
const DEADLINE = "2026-10-10T07:00:00+00:00"

describe("parseSelectionPreview", () => {
  it("reads the available entries and each date's answer", () => {
    const preview = parseSelectionPreview({
      available: 3,
      results: [
        {
          event_id: A,
          ok: true,
          product_name: "כרטיסייה",
          cancel_deadline: DEADLINE,
        },
        {
          event_id: B,
          ok: false,
          code: "EVENT_FULL",
          cancel_deadline: DEADLINE,
        },
        { event_id: C, ok: false, code: "SOMETHING_NEW" },
      ],
    })
    expect(preview.available).toBe(3)
    expect(preview.dates.get(A)).toEqual({
      ok: true,
      code: null,
      productName: "כרטיסייה",
      cancelDeadline: DEADLINE,
    })
    expect(preview.dates.get(B)).toEqual({
      ok: false,
      code: "EVENT_FULL",
      productName: null,
      cancelDeadline: DEADLINE,
    })
    expect(preview.dates.get(C)?.code).toBe("SERVER_ERROR")
  })

  it("an ok date without a product name is not choosable; malformed rows and available are dropped", () => {
    const preview = parseSelectionPreview({
      available: -1,
      results: [{ event_id: A, ok: true }, { ok: true }, "x", null],
    })
    expect(preview.available).toBe(0)
    expect([...preview.dates.keys()]).toEqual([A])
    expect(preview.dates.get(A)).toMatchObject({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(parseSelectionPreview(null)).toEqual({
      available: 0,
      dates: new Map(),
    })
  })
})

describe("parseBookResults", () => {
  it("reads each date's result in order", () => {
    expect(
      parseBookResults({
        results: [
          { event_id: A, ok: true, booking_id: C },
          { event_id: B, ok: false, code: "NO_MATCHING_ENTITLEMENT" },
        ],
      })
    ).toEqual([
      { eventId: A, ok: true, code: null, bookingId: C },
      {
        eventId: B,
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
        bookingId: null,
      },
    ])
  })

  it("an unknown code is a server error", () => {
    expect(
      parseBookResults({ results: [{ event_id: A, ok: false, code: "NEW" }] })
    ).toEqual([
      { eventId: A, ok: false, code: "SERVER_ERROR", bookingId: null },
    ])
  })

  it("anything malformed is null", () => {
    for (const data of [
      null,
      {},
      { results: [] },
      { results: [{ event_id: A }] },
      { results: [{ ok: true, booking_id: C }] },
      { results: [{ event_id: A, ok: true }] },
    ]) {
      expect(parseBookResults(data), JSON.stringify(data)).toBeNull()
    }
  })
})

describe("unavailableReason", () => {
  it("a short reason per code, and one for anything else", () => {
    const reasons = customerCopy.unavailableReason
    expect(unavailableReason("ALREADY_BOOKED")).toBe(reasons.ALREADY_BOOKED)
    expect(unavailableReason("REGISTRATION_CLOSED")).toBe(
      reasons.REGISTRATION_CLOSED
    )
    expect(unavailableReason("EVENT_FULL")).toBe(reasons.EVENT_FULL)
    expect(unavailableReason("ENTITLEMENT_EXPIRED_ON_DATE")).toBe(
      reasons.ENTITLEMENT_EXPIRED_ON_DATE
    )
    for (const code of [
      "NO_MATCHING_ENTITLEMENT",
      "EVENT_NOT_BOOKABLE",
      "SERVER_ERROR",
      null,
    ] as const) {
      expect(unavailableReason(code)).toBe(reasons.other)
    }
  })
})

describe("usesByProduct", () => {
  it("groups the dates by product, in order", () => {
    expect(usesByProduct(["א", "ב", "א", null])).toEqual([
      { product: "א", count: 2 },
      { product: "ב", count: 1 },
    ])
  })
})

describe("toggleSelection", () => {
  it("chooses up to the available entries, in click order", () => {
    expect(toggleSelection([], A, 2)).toEqual([A])
    expect(toggleSelection([A], B, 2)).toEqual([A, B])
    expect(toggleSelection([A, B], C, 2)).toEqual([A, B])
  })

  it("always unchooses a chosen row, also a capped or blocked one", () => {
    expect(toggleSelection([A, B], A, 2)).toEqual([B])
    expect(toggleSelection([A], A, 0, false)).toEqual([])
  })

  it("never chooses a row that cannot be chosen", () => {
    expect(toggleSelection([], A, 3, false)).toEqual([])
  })
})

describe("pruneSelection", () => {
  it("keeps only rows that can still be chosen, at most the available entries", () => {
    const sessions = [
      { id: A, ok: true },
      { id: B, ok: false },
      { id: C, ok: true },
    ]
    expect(pruneSelection([B, C, A], sessions, 5)).toEqual([C, A])
    expect(pruneSelection([C, A], sessions, 1)).toEqual([C])
    expect(pruneSelection([C, A], sessions, 0)).toEqual([])
    expect(pruneSelection(["gone"], sessions, 3)).toEqual([])
  })
})

describe("resultsHeading", () => {
  it("all saved: the climax; some: n of m; none: the failure heading", () => {
    expect(resultsHeading([{ ok: true }, { ok: true }])).toBe(
      customerCopy.climax
    )
    expect(resultsHeading([{ ok: true }, { ok: false }, { ok: true }])).toBe(
      customerCopy.savedSome(2, 3)
    )
    expect(resultsHeading([{ ok: false }, { ok: false }])).toBe(
      customerCopy.savedNone
    )
  })
})

describe("selectableRows", () => {
  const session = (id: string) => ({
    id,
    concept_name: "יווני",
    starts_at: "2026-10-12T07:00:00+00:00",
  })

  it("an ok date gets its chip; a blocked date its code and no chip; a date missing from the preview is not choosable", () => {
    const preview = parseSelectionPreview({
      available: 2,
      results: [
        {
          event_id: A,
          ok: true,
          product_name: "כרטיסייה",
          cancel_deadline: DEADLINE,
        },
        { event_id: B, ok: false, code: "EVENT_FULL" },
      ],
    })
    const availability = new Map([
      [A, { label: "last_places" as const, registrationOpen: true }],
      [B, { label: "full" as const, registrationOpen: true }],
    ])
    const rows = selectableRows(
      [session(A), session(B), session(C)],
      preview,
      availability
    )
    expect(rows).toEqual([
      {
        id: A,
        conceptName: "יווני",
        startsAt: "2026-10-12T07:00:00+00:00",
        ok: true,
        code: null,
        productName: "כרטיסייה",
        cancelDeadline: DEADLINE,
        status: {
          tone: "warning",
          text: customerCopy.availability.last_places,
        },
      },
      expect.objectContaining({
        id: B,
        ok: false,
        code: "EVENT_FULL",
        status: null,
      }),
      expect.objectContaining({
        id: C,
        ok: false,
        code: "EVENT_NOT_BOOKABLE",
        productName: null,
        status: null,
      }),
    ])
  })
})

describe("showsSelectEntry", () => {
  it("from 2 available entries", () => {
    expect(showsSelectEntry(0)).toBe(false)
    expect(showsSelectEntry(1)).toBe(false)
    expect(showsSelectEntry(2)).toBe(true)
    expect(showsSelectEntry(5)).toBe(true)
  })
})
