import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  closesAfterStart,
  createPayload,
  draftFieldOf,
  draftForConcept,
  draftFromRow,
  fieldChange,
  fieldError,
  listSummary,
  localDateTime,
  sessionTitle,
  type ConceptOption,
  type SessionRow,
} from "./session-draft"

const copy = adminCopy.sessions

const GRANDMA: ConceptOption = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Grandma",
  description: "Text",
  default_kind: "couple",
}
const GREEK: ConceptOption = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Greek",
  description: null,
  default_kind: "regular",
}
const DEFAULTS = { regular: 12, couple: 14 }

// 15.12.2026 10:00-12:00 Jerusalem (UTC+2), closes 14.12 20:00.
const ROW: SessionRow = {
  id: "33333333-3333-4333-8333-333333333333",
  concept_name: "Greek",
  kind: "regular",
  description: null,
  starts_at: "2026-12-15T08:00:00+00:00",
  ends_at: "2026-12-15T10:00:00+00:00",
  capacity_adults: 12,
  registration_closes_at: "2026-12-14T18:00:00+00:00",
  registration_close_overridden: false,
  status: "draft",
  display_price_agorot: null,
}

describe("sessionTitle", () => {
  it("is always the concept's name", () => {
    expect(sessionTitle("Greek")).toBe(copy.sessionTitle("Greek"))
    expect(sessionTitle("Greek")).toContain("Greek")
  })
})

describe("draftForConcept", () => {
  it("fills kind and description from the concept and capacity by kind", () => {
    expect(draftForConcept(GRANDMA, DEFAULTS)).toMatchObject({
      conceptId: GRANDMA.id,
      kind: "couple",
      description: "Text",
      capacityText: "14",
    })
    expect(draftForConcept(GREEK, DEFAULTS)).toMatchObject({
      kind: "regular",
      description: "",
      capacityText: "12",
    })
  })

  it("keeps the date, times and price typed so far; no settings = empty capacity", () => {
    const base = {
      ...draftForConcept(GRANDMA, DEFAULTS),
      date: "2026-12-15",
      startTime: "10:00",
      endTime: "12:00",
      priceText: "128",
    }
    expect(draftForConcept(GREEK, null, base)).toMatchObject({
      date: "2026-12-15",
      startTime: "10:00",
      endTime: "12:00",
      priceText: "128",
      capacityText: "",
    })
  })
})

describe("createPayload", () => {
  const filled = {
    ...draftForConcept(GRANDMA, DEFAULTS),
    date: "2026-12-15",
    startTime: "10:00",
    endTime: "12:00",
  }

  it("builds p_event with local times; an empty price is not sent", () => {
    expect(createPayload(filled)).toEqual({
      ok: true,
      event: {
        concept_id: GRANDMA.id,
        date: "2026-12-15",
        start_time: "10:00",
        end_time: "12:00",
        kind: "couple",
        description: "Text",
        capacity_adults: 14,
      },
    })
    expect(
      createPayload({ ...filled, priceText: "137.5", description: "  " })
    ).toMatchObject({
      ok: true,
      event: { display_price_agorot: 13750, description: null },
    })
  })

  it("sends a close set by hand and publish", () => {
    expect(
      createPayload({ ...filled, closesLocal: "2026-12-13T18:00" }, true)
    ).toMatchObject({
      ok: true,
      event: { registration_closes_local: "2026-12-13T18:00", publish: true },
    })
    expect(createPayload({ ...filled, closesLocal: "13.12" })).toEqual({
      ok: false,
      field: "closes",
    })
    // After the start (15.12 10:00).
    expect(
      createPayload({ ...filled, closesLocal: "2026-12-15T10:30" })
    ).toEqual({ ok: false, field: "closes" })
    expect(
      closesAfterStart({ ...filled, closesLocal: "2026-12-15T10:30" })
    ).toBe(true)
    expect(
      closesAfterStart({ ...filled, closesLocal: "2026-12-15T10:00" })
    ).toBe(false)
    expect(closesAfterStart(filled)).toBe(false)
  })

  it("takes the default hours on a first form only", () => {
    const times = { start: "10:30", end: "14:30" }
    expect(draftForConcept(GRANDMA, DEFAULTS, undefined, times)).toMatchObject({
      startTime: "10:30",
      endTime: "14:30",
    })
    expect(
      draftForConcept(GREEK, DEFAULTS, { ...filled, closesLocal: "x" }, times)
    ).toMatchObject({ startTime: "10:00", endTime: "12:00", closesLocal: "x" })
  })

  it("stops at the first field to fix", () => {
    expect(createPayload({ ...filled, conceptId: "" })).toEqual({
      ok: false,
      field: "concept",
    })
    expect(createPayload({ ...filled, date: "" })).toEqual({
      ok: false,
      field: "date",
    })
    expect(createPayload({ ...filled, endTime: "09:00" })).toEqual({
      ok: false,
      field: "endTime",
    })
    expect(createPayload({ ...filled, capacityText: "0" })).toEqual({
      ok: false,
      field: "capacity",
    })
    expect(createPayload({ ...filled, priceText: "abc" })).toEqual({
      ok: false,
      field: "price",
    })
  })
})

describe("fieldError", () => {
  it("needs the end after the start", () => {
    const draft = draftFromRow(ROW)
    expect(fieldError("endTime", { ...draft, endTime: "10:00" })).toBe(
      "invalid"
    )
    expect(fieldError("endTime", draft)).toBeNull()
  })
})

describe("draftFieldOf", () => {
  it("maps the RPC's detail.field to the form", () => {
    expect(draftFieldOf("end_time")).toBe("endTime")
    expect(draftFieldOf("capacity_adults")).toBe("capacity")
    expect(draftFieldOf("registration_closes_local")).toBe("closes")
    expect(draftFieldOf(undefined)).toBeNull()
  })
})

describe("draftFromRow", () => {
  it("reads local values in Jerusalem", () => {
    expect(draftFromRow(ROW)).toMatchObject({
      date: "2026-12-15",
      startTime: "10:00",
      endTime: "12:00",
      capacityText: "12",
      priceText: "",
      closesLocal: "2026-12-14T20:00",
    })
    expect(localDateTime("2026-10-26T18:00:00+00:00")).toBe("2026-10-26T20:00")
  })
})

describe("fieldChange", () => {
  const draft = draftFromRow(ROW)

  it("nothing changed: no row opens", () => {
    for (const field of [
      "when",
      "kind",
      "description",
      "capacity",
      "closes",
      "price",
    ] as const) {
      expect(fieldChange(field, ROW, draft), field).toBeNull()
    }
  })

  it("capacity 12 -> 13", () => {
    expect(
      fieldChange("capacity", ROW, { ...draft, capacityText: "13" })
    ).toEqual({ from: "12", to: "13", changes: { capacity_adults: 13 } })
  })

  it("the date row sends only what changed, shown as one line", () => {
    const change = fieldChange("when", ROW, { ...draft, startTime: "11:00" })
    expect(change?.changes).toEqual({ start_time: "11:00" })
    expect(change?.from).toContain("10:00–12:00")
    expect(change?.to).toContain("11:00–12:00")
    expect(fieldChange("when", ROW, { ...draft, endTime: "09:00" })).toBeNull()
  })

  it("the close is sent as local time", () => {
    expect(
      fieldChange("closes", ROW, { ...draft, closesLocal: "2026-12-14T12:00" })
        ?.changes
    ).toEqual({ registration_closes_local: "2026-12-14T12:00" })
  })

  it("an emptied price is null", () => {
    const priced = { ...ROW, display_price_agorot: 13800 }
    expect(
      fieldChange("price", priced, { ...draftFromRow(priced), priceText: "" })
    ).toMatchObject({ changes: { display_price_agorot: null } })
  })

  it("kind and description", () => {
    expect(
      fieldChange("kind", ROW, { ...draft, kind: "couple" })
    ).toMatchObject({
      from: copy.kinds.regular,
      to: copy.kinds.couple,
      changes: { kind: "couple" },
    })
    expect(
      fieldChange("description", ROW, { ...draft, description: " New " })
        ?.changes
    ).toEqual({ description: "New" })
  })
})

describe("listSummary", () => {
  it("shows when and how many places", () => {
    const text = listSummary(ROW)
    expect(text).toContain("15.12")
    expect(text).toContain("10:00")
    expect(text).toContain(copy.places(12))
  })
})
