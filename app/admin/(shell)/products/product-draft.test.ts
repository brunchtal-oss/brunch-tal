import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  createPayload,
  draftForType,
  draftFromRow,
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
  post_join_message: null,
  post_join_button_label: "Go",
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

  it("keeps the name, price and texts when the type changes", () => {
    const base = {
      ...draftForType("single", 49),
      name: "N",
      priceText: "100",
      postJoinMessage: "M",
      postJoinButtonLabel: "B",
    }
    expect(draftForType("couple", 49, base)).toMatchObject({
      name: "N",
      priceText: "100",
      postJoinMessage: "M",
      postJoinButtonLabel: "B",
      partySize: 2,
    })
  })
})

describe("createPayload", () => {
  it("builds p_product in agorot, every day as null, empty texts as null", () => {
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
        post_join_message: null,
        post_join_button_label: null,
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
      "postJoinMessage",
      "postJoinButtonLabel",
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

  it("weekdays, yes / no and an emptied optional text", () => {
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
    expect(
      fieldChange("postJoinButtonLabel", CARD, {
        ...draft,
        postJoinButtonLabel: "  ",
      })
    ).toEqual({
      from: "Go",
      to: copy.empty,
      changes: { post_join_button_label: null },
    })
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
