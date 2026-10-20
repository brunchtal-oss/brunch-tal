import { describe, expect, it } from "vitest"

import { parseMyWaitlist } from "./waitlist"

describe("parseMyWaitlist (story 5.6)", () => {
  it("maps the rows in order and skips malformed ones", () => {
    expect(
      parseMyWaitlist([
        {
          event_id: "e1",
          starts_at: "2026-10-12T07:00:00Z",
          concept_name: "אמהות",
          kind: "regular",
          joined_at: "2026-10-01T07:00:00Z",
        },
        { event_id: "e2", starts_at: "2026-10-13T07:00:00Z" },
        null,
        "nope",
      ])
    ).toEqual([
      {
        eventId: "e1",
        startsAt: "2026-10-12T07:00:00Z",
        conceptName: "אמהות",
      },
    ])
  })

  it("anything but an array: no entries", () => {
    expect(parseMyWaitlist(null)).toEqual([])
    expect(parseMyWaitlist({})).toEqual([])
  })
})
