import { describe, expect, it } from "vitest"

import { toProductOptions, type ProductRow } from "./product-options"

const row = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: "p-1",
  name: "Card",
  price_agorot: 47200,
  validity_mode: "days",
  eligible_event_kind: "regular",
  allowed_weekdays: null,
  party_size: 1,
  active: true,
  ...overrides,
})

describe("toProductOptions", () => {
  it("drops a hidden product and keeps the order of the rows", () => {
    const options = toProductOptions([
      row({ id: "a" }),
      row({ id: "hidden", active: false }),
      row({ id: "b" }),
    ])
    expect(options.map((o) => o.id)).toEqual(["a", "b"])
  })

  it("a days product has no session field", () => {
    expect(toProductOptions([row()])).toEqual([
      { id: "p-1", name: "Card", priceAgorot: 47200, pinned: null },
    ])
  })

  it("a pinned product carries its kind, weekdays and party size", () => {
    const [couple] = toProductOptions([
      row({
        validity_mode: "session",
        eligible_event_kind: "couple",
        allowed_weekdays: [0, 3],
        party_size: 2,
      }),
    ])
    expect(couple.pinned).toEqual({
      productId: "p-1",
      eventKind: "couple",
      weekdays: [0, 3],
      partySize: 2,
    })
    const [single] = toProductOptions([
      row({ validity_mode: "session", eligible_event_kind: null }),
    ])
    expect(single.pinned).toMatchObject({
      eventKind: "regular",
      weekdays: null,
    })
  })
})
