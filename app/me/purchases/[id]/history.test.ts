import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { buildHistory, signedUnits, type MovementRow } from "./history"

function move(
  id: string,
  action: string,
  bookingId: string | null,
  createdAt: string,
  units = 0
): MovementRow {
  return {
    id,
    booking_id: bookingId,
    action,
    units,
    created_at: createdAt,
  }
}

// Monday 12.10 and Thursday 15.10, 10:00 Jerusalem.
const SESSIONS = [
  { id: "ev-1", starts_at: "2026-10-12T07:00:00Z", concept_name: "יווני" },
  { id: "ev-2", starts_at: "2026-10-15T07:00:00Z", concept_name: "אמהות" },
  { id: "ev-3", starts_at: "2026-10-01T07:00:00Z", concept_name: "זוגות" },
]
const BOOKINGS = [
  { id: "b-used", event_id: "ev-1", status: "completed" },
  { id: "b-booked", event_id: "ev-2", status: "confirmed" },
  { id: "b-cancelled", event_id: "ev-3", status: "cancelled" },
]

describe("signedUnits", () => {
  it("keeps the sign, none for zero", () => {
    expect(signedUnits(4)).toBe("+4")
    expect(signedUnits(-1)).toBe("-1")
    expect(signedUnits(0)).toBeNull()
  })
})

describe("buildHistory", () => {
  const movements = [
    move("m-1", "grant", null, "2026-09-23T07:00:00+00:00", 4),
    move("m-2", "reserve", "b-used", "2026-09-24T07:00:00+00:00", -1),
    move("m-3", "use", "b-used", "2026-10-12T09:00:00+00:00"),
    move("m-4", "reserve", "b-booked", "2026-09-25T07:00:00+00:00", -1),
    move("m-5", "reserve", "b-cancelled", "2026-09-26T07:00:00+00:00", -1),
    move("m-6", "release", "b-cancelled", "2026-09-27T07:00:00+00:00", 1),
    move("m-7", "adjust", null, "2026-10-13T07:00:00+00:00", 1),
  ]

  it("story 3.7: a pinned booking cancelled into a credit (reserve, then use) is cancelled, not attended", () => {
    const [entry] = buildHistory({
      movements: [
        move("m-1", "reserve", "b-pinned", "2026-09-24T07:00:00+00:00", -1),
        move("m-2", "use", "b-pinned", "2026-09-25T07:00:00+00:00"),
      ],
      bookings: [{ id: "b-pinned", event_id: "ev-1", status: "cancelled" }],
      sessions: SESSIONS,
    })
    expect(entry).toMatchObject({
      kind: "booking",
      state: "cancelled",
      label: customerCopy.bookingState.cancelled,
    })
  })

  it("no purchase row, one row per booking by its state, by date", () => {
    const history = buildHistory({
      movements,
      bookings: BOOKINGS,
      sessions: SESSIONS,
    })
    expect(history.map((h) => h.id)).toEqual([
      "b-cancelled",
      "b-used",
      "m-7",
      "b-booked",
    ])
    expect(history[0]).toEqual({
      kind: "booking",
      id: "b-cancelled",
      state: "cancelled",
      label: customerCopy.bookingState.cancelled,
      day: "יום חמישי 01.10",
      startsAt: "2026-10-01T07:00:00Z",
      title: customerCopy.sessionTitle("זוגות"),
    })
    expect(history[1]).toMatchObject({
      state: "used",
      label: "השתתפת",
      day: "יום שני 12.10",
      title: customerCopy.sessionTitle("יווני"),
    })
    expect(history[3]).toMatchObject({ state: "booked", label: "נרשמת" })
    // A movement without a booking: its label and its date only.
    expect(history[2]).toEqual({
      kind: "other",
      id: "m-7",
      label: customerCopy.movement.adjust,
      units: "+1",
      createdAt: "2026-10-13T07:00:00+00:00",
    })
    // Booking rows carry no units.
    expect(history[0]).not.toHaveProperty("units")
  })

  it("a booking whose session is unknown: the state without a day or title", () => {
    const [entry] = buildHistory({
      movements: [move("m-1", "reserve", "b-x", "2026-09-24T07:00:00Z", -1)],
      bookings: [],
      sessions: [],
    })
    expect(entry).toMatchObject({
      kind: "booking",
      label: customerCopy.bookingState.booked,
      day: null,
      title: null,
    })
  })

  it("labels the other actions of the log", () => {
    for (const action of ["opening_balance", "adjust"] as const) {
      const [entry] = buildHistory({
        movements: [move("m", action, null, "2026-09-24T07:00:00Z")],
        bookings: [],
        sessions: [],
      })
      expect(entry).toMatchObject({
        kind: "other",
        label: customerCopy.movement[action],
      })
    }
  })
})
