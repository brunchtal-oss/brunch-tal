import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { parseAvailability, sessionStatus } from "./session-status"

describe("parseAvailability", () => {
  it("keeps well-formed rows by event id", () => {
    const map = parseAvailability([
      { event_id: "a", label: "available", registration_open: true },
      { event_id: "b", label: "full", registration_open: false },
      { event_id: "c", label: "seven", registration_open: true },
      { label: "full" },
      null,
    ])
    expect([...map.keys()]).toEqual(["a", "b"])
    expect(map.get("b")).toEqual({ label: "full", registrationOpen: false })
  })

  it("returns an empty map for anything that is not an array", () => {
    expect(parseAvailability(null).size).toBe(0)
    expect(parseAvailability({ a: 1 }).size).toBe(0)
  })
})

describe("sessionStatus", () => {
  it("her own booking wins over the label", () => {
    expect(
      sessionStatus({
        booked: true,
        availability: { label: "full", registrationOpen: true },
      })
    ).toEqual({ tone: "success", text: customerCopy.booked })
  })

  it("maps each label to its tone and word; full is muted, not red", () => {
    const of = (label: "available" | "last_places" | "full") =>
      sessionStatus({
        booked: false,
        availability: { label, registrationOpen: true },
      })
    expect(of("available")).toEqual({ tone: "success", text: "יש מקום" })
    expect(of("last_places")).toEqual({
      tone: "warning",
      text: "מקומות אחרונים",
    })
    expect(of("full")).toEqual({ tone: "expired", text: "מלא" })
  })

  it("shows no availability chip once registration closed; her booking still shows", () => {
    const closed = { label: "available", registrationOpen: false } as const
    expect(sessionStatus({ booked: false, availability: closed })).toBe(null)
    expect(sessionStatus({ booked: true, availability: closed })).toEqual({
      tone: "success",
      text: customerCopy.booked,
    })
  })

  it("shows nothing without a label", () => {
    expect(sessionStatus({ booked: false, availability: undefined })).toBe(null)
  })
})
