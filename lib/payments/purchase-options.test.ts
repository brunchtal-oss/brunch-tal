import { describe, expect, it } from "vitest"

import {
  canBuy,
  holdsSeat,
  NO_PURCHASE,
  parsePurchaseOptions,
  purchaseInputShape,
  purchaseRequest,
  type PurchaseProduct,
} from "./purchase-options"

const EVENT = "33333333-3333-4333-8333-333333333333"
const KEY = "44444444-4444-4444-8444-444444444444"
const PINNED_ID = "11111111-1111-4111-8111-111111111111"
const CARD_ID = "22222222-2222-4222-8222-222222222222"

const PINNED_ROW = {
  id: PINNED_ID,
  name: "בודד",
  type: "single",
  price_agorot: 18000,
  units: 1,
  validity_mode: "session",
  validity_days: null,
}
const CARD_ROW = {
  id: CARD_ID,
  name: "כרטיסייה",
  type: "card",
  price_agorot: 47200,
  units: 4,
  validity_mode: "days",
  validity_days: 49,
}

const PINNED: PurchaseProduct = {
  id: PINNED_ID,
  name: "בודד",
  type: "single",
  priceAgorot: 18000,
  units: 1,
  validityMode: "session",
  validityDays: null,
}
const CARD: PurchaseProduct = {
  id: CARD_ID,
  name: "כרטיסייה",
  type: "card",
  priceAgorot: 47200,
  units: 4,
  validityMode: "days",
  validityDays: 49,
}

describe("parsePurchaseOptions", () => {
  it("reads enabled and the products", () => {
    expect(
      parsePurchaseOptions({
        enabled: true,
        public_purchase: false,
        products: [PINNED_ROW, CARD_ROW],
      })
    ).toEqual({ enabled: true, products: [PINNED, CARD] })
  })

  it("drops a malformed product, and anything but true is disabled", () => {
    expect(
      parsePurchaseOptions({
        enabled: "yes",
        products: [
          { ...CARD_ROW, id: "x" },
          { ...CARD_ROW, price_agorot: 0 },
          { ...CARD_ROW, validity_mode: "other" },
          { ...CARD_ROW, price_agorot: 1.5 },
          CARD_ROW,
        ],
      })
    ).toEqual({ enabled: false, products: [CARD] })
    expect(parsePurchaseOptions(null)).toEqual(NO_PURCHASE)
    expect(parsePurchaseOptions([])).toEqual(NO_PURCHASE)
  })

  it("canBuy: enabled and at least one product", () => {
    expect(canBuy({ enabled: true, products: [CARD] })).toBe(true)
    expect(canBuy({ enabled: true, products: [] })).toBe(false)
    expect(canBuy({ enabled: false, products: [CARD] })).toBe(false)
  })
})

describe("purchaseRequest", () => {
  it("a pinned product on a session page holds that session", () => {
    expect(holdsSeat(PINNED, EVENT)).toBe(true)
    expect(purchaseRequest(PINNED, EVENT, true, KEY)).toEqual({
      productId: PINNED_ID,
      eventId: EVENT,
      termsAccepted: true,
      idempotencyKey: KEY,
    })
  })

  it("a card is bought without a session, even from a session page (no hold line)", () => {
    expect(holdsSeat(CARD, EVENT)).toBe(false)
    expect(purchaseRequest(CARD, EVENT, true, KEY)?.eventId).toBeNull()
    expect(purchaseRequest(CARD, null, true, KEY)?.eventId).toBeNull()
  })

  it("terms not ticked or no product: nothing to send", () => {
    expect(purchaseRequest(CARD, null, false, KEY)).toBeNull()
    expect(purchaseRequest(null, null, true, KEY)).toBeNull()
  })
})

describe("purchaseInputShape", () => {
  const input = {
    productId: CARD_ID,
    eventId: null,
    termsAccepted: true,
    idempotencyKey: KEY,
  }

  it("keeps a well-formed input", () => {
    expect(purchaseInputShape(input)).toEqual(input)
    expect(purchaseInputShape({ ...input, eventId: EVENT })?.eventId).toBe(
      EVENT
    )
  })

  it.each([
    null,
    "x",
    { ...input, productId: "x" },
    { ...input, eventId: "x" },
    { ...input, eventId: undefined },
    { ...input, termsAccepted: "true" },
    { ...input, idempotencyKey: 1 },
  ])("refuses %j", (value) => {
    expect(purchaseInputShape(value)).toBeNull()
  })
})
