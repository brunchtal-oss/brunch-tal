import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

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
        validityDays: null,
        session: null,
      },
    ])
  })

  it("marks a card that expired before it was bound, with the validity days of its snapshot and no message", () => {
    const [item] = buildPurchaseItems({
      ...rows,
      balances: [balance({ expired_before_bound: true })],
      entitlements: [
        { id: "ent-1", eligibility_snapshot: { validity_days: 49 } },
      ],
    })
    expect(item).toMatchObject({
      expiredBeforeBound: true,
      validityDays: 49,
      message: null,
      buttonLabel: null,
    })
  })

  it.each([[{}], [{ validity_days: null }], [null]])(
    "has no validity days without them in the snapshot (%j)",
    (snapshot) => {
      const [item] = buildPurchaseItems({
        ...rows,
        balances: [balance({ expired_before_bound: true })],
        entitlements: [{ id: "ent-1", eligibility_snapshot: snapshot }],
      })
      expect(item.validityDays).toBeNull()
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

  describe("a pinned purchase (story 3.11)", () => {
    const NOW = new Date("2026-10-05T08:00:00Z")
    const pinned = {
      ...rows,
      balances: [balance({ available: 0, reserved: 1 })],
      entitlements: [
        { id: "ent-1", eligibility_snapshot: {}, pinned_event_id: "ev-1" },
      ],
      bookings: [
        { payment_id: "pay-1", event_id: "ev-1", status: "confirmed" },
      ],
      sessions: [
        {
          id: "ev-1",
          starts_at: "2026-10-12T07:00:00Z",
          concept_name: "Mothers",
        },
      ],
      now: NOW,
    }

    it("shows the session with the product's message and button while it has not started", () => {
      const [item] = buildPurchaseItems(pinned)
      expect(item).toMatchObject({
        productName: customerCopy.sessionTitle("Mothers"),
        session: {
          eventId: "ev-1",
          startsAt: "2026-10-12T07:00:00Z",
          conceptName: "Mothers",
        },
        message: "Current message",
        buttonLabel: "Current button",
      })
    })

    it.each([
      ["the session started", { now: new Date("2026-10-12T07:00:00Z") }],
      [
        "the booking was cancelled",
        {
          bookings: [
            { payment_id: "pay-1", event_id: "ev-1", status: "cancelled" },
          ],
        },
      ],
      ["there is no booking", { bookings: [] }],
      [
        "it was parked (nothing reserved)",
        { bookings: [], balances: [balance({ available: 1, reserved: 0 })] },
      ],
      ["the session is unknown", { sessions: [] }],
    ])("is not a session when %s", (_label, change) => {
      const [item] = buildPurchaseItems({ ...pinned, ...change })
      expect(item).toMatchObject({
        session: null,
        message: null,
        buttonLabel: null,
      })
    })
  })
})
