import { describe, expect, it } from "vitest"

import {
  eventOptionsFor,
  toBookableEvents,
  type BookableEvent,
} from "./event-options"

const event = (overrides: Partial<BookableEvent> = {}): BookableEvent => ({
  id: "ev-1",
  startsAt: "2026-10-12T07:00:00Z",
  kind: "regular",
  weekday: 1,
  conceptName: "Mothers",
  occupied: 5,
  capacity: 12,
  ...overrides,
})

describe("eventOptionsFor", () => {
  it("offers only sessions of the product's kind and weekdays", () => {
    const events = [
      event({ id: "monday" }),
      event({ id: "sunday", weekday: 0 }),
      event({ id: "couple", kind: "couple" }),
    ]
    expect(
      eventOptionsFor(
        { eventKind: "regular", weekdays: [1, 4], partySize: 1 },
        events
      ).map((e) => e.id)
    ).toEqual(["monday"])
    expect(
      eventOptionsFor(
        { eventKind: "regular", weekdays: null, partySize: 1 },
        events
      ).map((e) => e.id)
    ).toEqual(["monday", "sunday"])
  })

  it("marks a session without room for the party size as full", () => {
    const [twelveOfFourteen] = eventOptionsFor(
      { eventKind: "couple", weekdays: null, partySize: 2 },
      [event({ kind: "couple", occupied: 12, capacity: 14 })]
    )
    expect(twelveOfFourteen.full).toBe(false)
    const [thirteenOfFourteen] = eventOptionsFor(
      { eventKind: "couple", weekdays: null, partySize: 2 },
      [event({ kind: "couple", occupied: 13, capacity: 14 })]
    )
    expect(thirteenOfFourteen.full).toBe(true)
  })
})

describe("toBookableEvents", () => {
  it("maps the RPC rows and drops an unknown kind", () => {
    expect(
      toBookableEvents([
        {
          id: "ev-1",
          starts_at: "2026-10-12T07:00:00Z",
          kind: "regular",
          weekday: 1,
          concept_name: "Mothers",
          occupied: 5,
          capacity: 12,
        },
        { id: "ev-2", kind: "other" },
      ])
    ).toEqual([event()])
    expect(toBookableEvents(null)).toEqual([])
  })
})
