import { describe, expect, it } from "vitest"

import { buildPurchaseItems, type BalanceRow } from "./purchase-items"

const balance = (overrides: Partial<BalanceRow> = {}): BalanceRow => ({
  entitlement_id: "ent-1",
  payment_id: "pay-1",
  available: 4,
  reserved: 0,
  used: 0,
  expires_on: "2026-11-19",
  ...overrides,
})

const rows = {
  payments: [
    {
      id: "pay-1",
      product_id: "prod-1",
      amount_agorot: 47200,
      paid_on: "2026-10-01",
      product_snapshot: { name: "Card at purchase" },
    },
  ],
  products: [
    {
      id: "prod-1",
      post_join_message: "Current message",
      post_join_button_label: "Current button",
    },
  ],
}

describe("buildPurchaseItems", () => {
  it("takes the name from product_snapshot and the message from the current product", () => {
    expect(buildPurchaseItems({ ...rows, balances: [balance()] })).toEqual([
      {
        id: "ent-1",
        productName: "Card at purchase",
        amountAgorot: 47200,
        paidOn: "2026-10-01",
        available: 4,
        reserved: 0,
        expiresOn: "2026-11-19",
        message: "Current message",
        buttonLabel: "Current button",
        expiredBeforeBound: false,
        validityWeeks: null,
      },
    ])
  })

  it("marks a card that expired before it was bound, with the weeks of its snapshot and no message", () => {
    const [item] = buildPurchaseItems({
      ...rows,
      balances: [balance({ expired_before_bound: true })],
      entitlements: [
        { id: "ent-1", eligibility_snapshot: { validity_days: 49 } },
      ],
    })
    expect(item).toMatchObject({
      expiredBeforeBound: true,
      validityWeeks: 7,
      message: null,
      buttonLabel: null,
    })
  })

  it.each([[{}], [{ validity_days: null }], [null]])(
    "has no weeks without validity days in the snapshot (%j)",
    (snapshot) => {
      const [item] = buildPurchaseItems({
        ...rows,
        balances: [balance({ expired_before_bound: true })],
        entitlements: [{ id: "ent-1", eligibility_snapshot: snapshot }],
      })
      expect(item.validityWeeks).toBeNull()
    }
  )

  it("skips a balance whose payment is not among the rows", () => {
    expect(
      buildPurchaseItems({
        ...rows,
        balances: [balance({ payment_id: "pay-other" })],
      })
    ).toEqual([])
  })

  it.each([
    ["reserved", { reserved: 1, available: 3 }],
    ["used", { used: 1, available: 3 }],
  ])("hides the message and button once something was %s", (_label, b) => {
    const [item] = buildPurchaseItems({ ...rows, balances: [balance(b)] })
    expect(item).toMatchObject({ message: null, buttonLabel: null })
  })

  it("keeps an empty name for a snapshot without one", () => {
    const [item] = buildPurchaseItems({
      ...rows,
      payments: [{ ...rows.payments[0], product_snapshot: {} }],
      balances: [balance()],
    })
    expect(item.productName).toBe("")
  })
})
