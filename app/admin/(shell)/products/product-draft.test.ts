import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  createPayload,
  draftForType,
  draftFromRow,
  eventKindPatch,
  partySizePatch,
  fieldChange,
  fieldError,
  priceChange,
  productSummary,
  weekdaysText,
  weekdaysValue,
  type ProductRow,
} from "./product-draft"

const copy = adminCopy.products

const CARD: ProductRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Card",
  type: "card",
  price_agorot: 47200,
  units: 4,
  validity_mode: "days",
  validity_days: 49,
  allowed_weekdays: [1, 4],
  eligible_event_kind: "regular",
  party_size: 1,
  intro_only: false,
  active: true,
}

describe("draftForType (the type fills defaults)", () => {
  it("single: pinned, 1 entry, 1 adult, regular session", () => {
    expect(draftForType("single", 49)).toMatchObject({
      type: "single",
      unitsText: "1",
      validityMode: "session",
      validityDaysText: "",
      partySize: 1,
      eventKind: "regular",
      introOnly: false,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
  })

  it("intro: as single, intro only", () => {
    expect(draftForType("intro", 49)).toMatchObject({
      validityMode: "session",
      introOnly: true,
    })
  })

  it("card: as single, valid for the setting's days", () => {
    expect(draftForType("card", 49)).toMatchObject({
      validityMode: "days",
      validityDaysText: "49",
      unitsText: "1",
      partySize: 1,
    })
    expect(draftForType("card", null).validityDaysText).toBe("")
  })

  it("couple: pinned, 1 entry, 2 adults, couple session", () => {
    expect(draftForType("couple", 49)).toMatchObject({
      validityMode: "session",
      unitsText: "1",
      partySize: 2,
      eventKind: "couple",
      introOnly: false,
    })
  })

  it("keeps the name and price when the type changes", () => {
    const base = {
      ...draftForType("single", 49),
      name: "N",
      priceText: "100",
    }
    expect(draftForType("couple", 49, base)).toMatchObject({
      name: "N",
      priceText: "100",
      partySize: 2,
    })
  })
})

describe("createPayload", () => {
  it("builds p_product in agorot, every day as null, without the post-join texts", () => {
    const draft = {
      ...draftForType("couple", 49),
      name: "  Couple ",
      priceText: "250",
    }
    expect(createPayload(draft)).toEqual({
      ok: true,
      product: {
        name: "Couple",
        type: "couple",
        price_agorot: 25000,
        units: 1,
        validity_mode: "session",
        validity_days: null,
        allowed_weekdays: null,
        eligible_event_kind: "couple",
        party_size: 2,
        intro_only: false,
      },
    })
  })

  it("sends a card without a number of days (the setting's default)", () => {
    const draft = {
      ...draftForType("card", null),
      name: "Card",
      priceText: "472",
      weekdays: [4, 1],
    }
    const payload = createPayload(draft)
    expect(payload.ok && payload.product).toMatchObject({
      validity_mode: "days",
      validity_days: null,
      allowed_weekdays: [1, 4],
    })
  })

  it("returns the first field to fix", () => {
    const base = { ...draftForType("single", 49), name: "N", priceText: "1" }
    expect(createPayload({ ...base, name: " " })).toEqual({
      ok: false,
      field: "name",
    })
    expect(createPayload({ ...base, priceText: "1.234" })).toEqual({
      ok: false,
      field: "price",
    })
    expect(createPayload({ ...base, unitsText: "0" })).toEqual({
      ok: false,
      field: "units",
    })
    expect(createPayload({ ...base, weekdays: [] })).toEqual({
      ok: false,
      field: "weekdays",
    })
  })
})

describe("field rules", () => {
  it("no weekday is an error; all seven are every day", () => {
    const draft = draftFromRow(CARD)
    expect(fieldError("weekdays", { ...draft, weekdays: [] })).toBe("weekdays")
    expect(weekdaysValue([0, 1, 2, 3, 4, 5, 6])).toBeNull()
    expect(weekdaysValue([4, 1, 4])).toEqual([1, 4])
    expect(weekdaysText(null)).toBe(copy.weekdaysAll)
    expect(weekdaysText([0, 1, 2, 3, 4, 5, 6])).toBe(copy.weekdaysAll)
    expect(weekdaysText([1, 4])).toBe("יום שני, יום חמישי")
  })

  it("days are required only in days mode", () => {
    const draft = draftFromRow(CARD)
    expect(fieldError("validityDays", { ...draft, validityDaysText: "" })).toBe(
      "required"
    )
    expect(
      fieldError("validityDays", {
        ...draft,
        validityMode: "session",
        validityDaysText: "",
      })
    ).toBeNull()
  })
})

describe("fieldChange (the editor's old ← new)", () => {
  it("is null while a field is unchanged or not valid", () => {
    const draft = draftFromRow(CARD)
    for (const field of [
      "type",
      "name",
      "units",
      "validity",
      "weekdays",
      "eventKind",
      "partySize",
      "introOnly",
    ] as const) {
      expect(fieldChange(field, CARD, draft), field).toBeNull()
    }
    expect(fieldChange("units", CARD, { ...draft, unitsText: "0" })).toBeNull()
    expect(fieldChange("weekdays", CARD, { ...draft, weekdays: [] })).toBeNull()
    expect(priceChange(CARD, draft)).toBeNull()
    expect(priceChange(CARD, { ...draft, priceText: "abc" })).toBeNull()
  })

  it("units 4 ← 5, validity as mode and days together", () => {
    const draft = draftFromRow(CARD)
    expect(fieldChange("units", CARD, { ...draft, unitsText: "5" })).toEqual({
      from: "4",
      to: "5",
      changes: { units: 5 },
    })
    expect(
      fieldChange("validity", CARD, { ...draft, validityDaysText: "60" })
    ).toEqual({
      from: copy.validityDays(49),
      to: copy.validityDays(60),
      changes: { validity_mode: "days", validity_days: 60 },
    })
    expect(
      fieldChange("validity", CARD, { ...draft, validityMode: "session" })
    ).toEqual({
      from: copy.validityDays(49),
      to: copy.validitySession,
      changes: { validity_mode: "session", validity_days: null },
    })
  })

  it("weekdays and yes / no", () => {
    const draft = draftFromRow(CARD)
    expect(
      fieldChange("weekdays", CARD, {
        ...draft,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
    ).toEqual({
      from: "יום שני, יום חמישי",
      to: copy.weekdaysAll,
      changes: { allowed_weekdays: null },
    })
    expect(
      fieldChange("introOnly", CARD, { ...draft, introOnly: true })
    ).toEqual({ from: copy.no, to: copy.yes, changes: { intro_only: true } })
  })

  it("the price change in agorot, formatted", () => {
    expect(
      priceChange(CARD, { ...draftFromRow(CARD), priceText: "500" })
    ).toEqual({ from: "472 ₪", to: "500 ₪", priceAgorot: 50000 })
  })
})

describe("productSummary", () => {
  it("days and pinned products", () => {
    expect(productSummary(CARD)).toBe("472 ₪ · 4 כניסות · בתוקף 49 ימים")
    expect(
      productSummary({
        ...CARD,
        price_agorot: 12800,
        units: 1,
        validity_mode: "session",
        validity_days: null,
      })
    ).toBe("128 ₪ · כניסה אחת · מוצמד למפגש")
  })
})

// Fix fix-hardening-db: picking a kind in either form sets the party size
// that goes with it, so the pair sent always agrees.
describe("eventKindPatch (kind sets the party size)", () => {
  it("create form: a card switched to couple sends couple with 2, back to regular with 1", () => {
    const base = { ...draftForType("card", 49), name: "Card", priceText: "472" }
    const couple = createPayload({ ...base, ...eventKindPatch("couple") })
    expect(couple.ok && couple.product).toMatchObject({
      eligible_event_kind: "couple",
      party_size: 2,
    })
    const regular = createPayload({
      ...base,
      ...eventKindPatch("couple"),
      ...eventKindPatch("regular"),
    })
    expect(regular.ok && regular.product).toMatchObject({
      eligible_event_kind: "regular",
      party_size: 1,
    })
  })

  it("editor: couple picked on a regular product changes the kind and the party size together", () => {
    const draft = { ...draftFromRow(CARD), ...eventKindPatch("couple") }
    expect(fieldChange("eventKind", CARD, draft)?.changes).toEqual({
      eligible_event_kind: "couple",
    })
    // The size row sends the kind too, so it saves before or after the
    // kind row.
    expect(fieldChange("partySize", CARD, draft)?.changes).toEqual({
      eligible_event_kind: "couple",
      party_size: 2,
    })
    // After the kind is saved, the database sets the size too (the RPC), so
    // the refreshed row matches the draft and no size change is left.
    const saved = {
      ...CARD,
      eligible_event_kind: "couple" as const,
      party_size: 2,
    }
    expect(fieldChange("partySize", saved, draft)).toBeNull()
  })

  it("a party size picked in either form sets the kind with it", () => {
    expect(partySizePatch(2)).toEqual({ eventKind: "couple", partySize: 2 })
    expect(partySizePatch(1)).toEqual({ eventKind: "regular", partySize: 1 })
    const base = { ...draftForType("card", 49), name: "Card", priceText: "472" }
    const couple = createPayload({ ...base, ...partySizePatch(2) })
    expect(couple.ok && couple.product).toMatchObject({
      eligible_event_kind: "couple",
      party_size: 2,
    })
  })
})
