import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { buildHistory, signedUnits } from "./history"

describe("signedUnits", () => {
  it("keeps the sign, none for zero", () => {
    expect(signedUnits(4)).toBe("+4")
    expect(signedUnits(-1)).toBe("-1")
    expect(signedUnits(0)).toBeNull()
  })
})

describe("buildHistory", () => {
  const movements = [
    {
      id: "m-1",
      booking_id: null,
      action: "grant",
      units: 4,
      created_at: "2026-09-23T07:00:00+00:00",
    },
    {
      id: "m-2",
      booking_id: "b-1",
      action: "reserve",
      units: -1,
      created_at: "2026-09-24T07:00:00+00:00",
    },
    {
      id: "m-3",
      booking_id: "b-1",
      action: "use",
      units: 0,
      created_at: "2026-10-12T09:00:00+00:00",
    },
    {
      id: "m-4",
      booking_id: "b-2",
      action: "release",
      units: 1,
      created_at: "2026-09-25T07:00:00+00:00",
    },
  ]

  it("labels each movement, keeps the order and names the session of a booking", () => {
    const history = buildHistory({
      movements,
      bookings: [{ id: "b-1", event_id: "ev-1" }],
      // Monday 12.10 10:00 Jerusalem.
      sessions: [
        {
          id: "ev-1",
          starts_at: "2026-10-12T07:00:00Z",
          concept_name: "יווני",
        },
      ],
    })
    expect(history.map((h) => h.id)).toEqual(["m-1", "m-2", "m-3", "m-4"])
    expect(history[0]).toEqual({
      id: "m-1",
      label: customerCopy.movement.grant,
      units: "+4",
      createdAt: "2026-09-23T07:00:00+00:00",
      session: null,
    })
    expect(history[1]).toMatchObject({
      label: customerCopy.movement.reserve,
      units: "-1",
      session: `${customerCopy.sessionTitle("יווני")} · יום שני 12.10`,
    })
    expect(history[2]).toMatchObject({
      label: customerCopy.movement.use,
      units: null,
    })
    // A booking whose session is unknown: no session line.
    expect(history[3]).toMatchObject({
      label: customerCopy.movement.release,
      session: null,
    })
  })

  it("labels every action of the log", () => {
    for (const action of Object.keys(customerCopy.movement)) {
      const [entry] = buildHistory({
        movements: [{ ...movements[0], action }],
        bookings: [],
        sessions: [],
      })
      expect(entry.label).toBe(
        customerCopy.movement[action as keyof typeof customerCopy.movement]
      )
    }
  })
})
