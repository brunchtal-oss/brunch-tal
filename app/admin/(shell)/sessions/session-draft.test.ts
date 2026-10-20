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
  imageChanged,
  listOccupancy,
  rescheduleRequest,
  listSummary,
  localDateTime,
  occupancyById,
  productChoicesFor,
  productsText,
  sessionTitle,
  type ConceptOption,
  type ProductChoice,
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

const P_REGULAR = "44444444-4444-4444-8444-444444444444"
const P_HOLIDAY = "55555555-5555-4555-8555-555555555555"
const P_COUPLE = "66666666-6666-4666-8666-666666666666"
const PRODUCTS: ProductChoice[] = [
  { id: P_REGULAR, name: "בראנץ׳ רגיל", kind: "regular", hidden: false },
  { id: P_HOLIDAY, name: "בראנץ׳ חג", kind: "regular", hidden: true },
  { id: P_COUPLE, name: "זוגי", kind: "couple", hidden: false },
]

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

  it("story 3.18: sends the marked products sorted, none = not sent", () => {
    expect(
      createPayload({ ...filled, productIds: [P_HOLIDAY, P_REGULAR] })
    ).toMatchObject({
      ok: true,
      event: { product_ids: [P_REGULAR, P_HOLIDAY] },
    })
    const none = createPayload({ ...filled, productIds: [] })
    expect(none.ok && "product_ids" in none.event).toBe(false)
    expect(draftFieldOf("product_ids")).toBe("products")
  })

  it("story 3.18: the products stay while the kind does", () => {
    const marked = { ...filled, productIds: [P_COUPLE] }
    expect(draftForConcept(GRANDMA, DEFAULTS, marked).productIds).toEqual([
      P_COUPLE,
    ])
    expect(draftForConcept(GREEK, DEFAULTS, marked).productIds).toEqual([])
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
      "products",
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

  it("story 3.18: products from all to one, and back", () => {
    expect(
      fieldChange(
        "products",
        ROW,
        { ...draft, productIds: [P_HOLIDAY] },
        PRODUCTS
      )
    ).toEqual({
      from: copy.productsAll,
      to: "בראנץ׳ חג (לא נמכר)",
      changes: { product_ids: [P_HOLIDAY] },
    })
    const marked = { ...ROW, product_ids: [P_REGULAR, P_HOLIDAY] }
    expect(
      fieldChange(
        "products",
        marked,
        { ...draftFromRow(marked), productIds: [] },
        PRODUCTS
      )
    ).toEqual({
      from: "בראנץ׳ חג (לא נמכר), בראנץ׳ רגיל",
      to: copy.productsAll,
      changes: { product_ids: [] },
    })
    // The same set in another order is no change.
    expect(
      fieldChange(
        "products",
        marked,
        { ...draftFromRow(marked), productIds: [P_HOLIDAY, P_REGULAR] },
        PRODUCTS
      )
    ).toBeNull()
  })

  it("story 3.18: the choices are the session's kind, by name", () => {
    expect(productChoicesFor("regular", PRODUCTS).map((p) => p.id)).toEqual([
      P_HOLIDAY,
      P_REGULAR,
    ])
    expect(productChoicesFor("couple", PRODUCTS).map((p) => p.id)).toEqual([
      P_COUPLE,
    ])
    expect(productsText([], PRODUCTS)).toBe(copy.productsAll)
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
  it("shows the weekday and date only: no places, never the time", () => {
    const text = listSummary(ROW)
    expect(text).toContain("15.12")
    expect(text).not.toMatch(/\d{2}:\d{2}/)
    expect(text).not.toContain("מקומות")
    expect(text).not.toContain("·")
  })
})

// The list row's occupancy (user decisions 2026-10-10).
describe("listOccupancy", () => {
  const published = { ...ROW, status: "published" as const }

  it("a draft shows no number", () => {
    expect(listOccupancy(ROW, 0)).toBeNull()
    expect(listOccupancy(ROW, 5)).toBeNull()
  })

  it("story 3.8: a cancelled session shows no number", () => {
    expect(listOccupancy({ ...ROW, status: "cancelled" }, 0)).toBeNull()
    expect(listOccupancy({ ...ROW, status: "cancelled" }, 3)).toBeNull()
  })

  it("occupied/capacity while there is room", () => {
    expect(listOccupancy(published, 8)).toEqual({
      full: false,
      text: "8/12",
      percent: 67,
    })
    expect(listOccupancy(published, 0)).toEqual({
      full: false,
      text: "0/12",
      percent: 0,
    })
    expect(listOccupancy(published, 11)).toEqual({
      full: false,
      text: copy.occupancy(11, 12),
      percent: 92,
    })
  })

  it("full when one more booking of its kind does not fit", () => {
    expect(listOccupancy(published, 12)).toEqual({ full: true, percent: 100 })
    expect(listOccupancy(published, 13)).toEqual({ full: true, percent: 100 })
    const couple = {
      ...published,
      kind: "couple" as const,
      capacity_adults: 14,
    }
    expect(listOccupancy(couple, 2)).toEqual({
      full: false,
      text: "2/14",
      percent: 14,
    })
    expect(listOccupancy(couple, 12)).toEqual({
      full: false,
      text: "12/14",
      percent: 86,
    })
    // One place left: a couple does not fit.
    expect(listOccupancy(couple, 13)).toEqual({ full: true, percent: 100 })
  })
})

describe("occupancyById", () => {
  it("maps the RPC's entries by session id and skips malformed ones", () => {
    expect(
      occupancyById([
        { event_id: "a", occupied: 2 },
        { event_id: "b", occupied: 0 },
        { event_id: 3, occupied: 1 },
        null,
        { event_id: "c" },
      ])
    ).toEqual({ a: 2, b: 0 })
    expect(occupancyById(null)).toEqual({})
  })
})

// Story 5.4: the editor offers "save the image" only when it changed.
describe("imageChanged", () => {
  const IMAGE = {
    media_id: "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d",
    alt: "שולחן",
    focus_x: 20,
    focus_y: 80,
  }

  it("compares the image, its alt and its focus", () => {
    expect(imageChanged(null, null)).toBe(false)
    expect(imageChanged(undefined, null)).toBe(false)
    expect(imageChanged(IMAGE, null)).toBe(true)
    expect(imageChanged(null, IMAGE)).toBe(true)
    expect(imageChanged(IMAGE, { ...IMAGE })).toBe(false)
    expect(imageChanged(IMAGE, { ...IMAGE, alt: "אחר" })).toBe(true)
    // Only whitespace around the alt is not a change.
    expect(imageChanged(IMAGE, { ...IMAGE, alt: "  שולחן " })).toBe(false)
    expect(imageChanged(IMAGE, { ...IMAGE, focus_x: 25 })).toBe(true)
    expect(imageChanged(IMAGE, { ...IMAGE, focus_y: 75 })).toBe(true)
    expect(
      imageChanged(IMAGE, {
        ...IMAGE,
        media_id: "4f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d",
      })
    ).toBe(true)
  })
})

// Story 3.8: the editor sends a refused time save to the time change.
describe("rescheduleRequest", () => {
  const draft = { date: "2026-10-20", startTime: "11:00", endTime: "13:00" }

  it("the when row refused with EVENT_HAS_BOOKINGS: the draft's date and times", () => {
    expect(
      rescheduleRequest(
        "when",
        { ok: false, code: "EVENT_HAS_BOOKINGS" },
        { ...draft }
      )
    ).toEqual(draft)
  })

  it("another field, another code or a success: null", () => {
    expect(
      rescheduleRequest(
        "capacity",
        { ok: false, code: "EVENT_HAS_BOOKINGS" },
        draft
      )
    ).toBeNull()
    expect(
      rescheduleRequest("when", { ok: false, code: "INVALID_INPUT" }, draft)
    ).toBeNull()
    expect(rescheduleRequest("when", { ok: true }, draft)).toBeNull()
  })
})
