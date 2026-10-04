import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { toPaymentItem, type PaymentRow } from "./payment-items"

const copy = adminCopy.paymentsList

const row = (overrides: Partial<PaymentRow> = {}): PaymentRow => ({
  payment_id: "pay-1",
  customer_id: "c-1",
  customer_name: "Dana",
  product_name: "Card",
  price_agorot: 47200,
  amount_agorot: 47200,
  payment_method_name: "Bit",
  paid_on: "2026-10-01",
  // 03.10 in Jerusalem.
  created_at: "2026-10-02T22:30:00+00:00",
  amount_override_reason: null,
  reference: null,
  note: null,
  ...overrides,
})

describe("toPaymentItem", () => {
  it("words a bound payment at the catalog price", () => {
    expect(toPaymentItem(row())).toEqual({
      paymentId: "pay-1",
      title: "Dana",
      unbound: false,
      details: copy.details("Card", "472 ₪", "Bit", "01.10", "03.10"),
      override: null,
      extra: null,
    })
  })

  it("titles a payment whose customer has not joined yet", () => {
    const item = toPaymentItem(row({ customer_id: null, customer_name: null }))
    expect(item.title).toBe(copy.unbound)
    expect(item.unbound).toBe(true)
  })

  it("titles an unbound payment with its payer label, and a bound one with the name", () => {
    expect(
      toPaymentItem(
        row({ customer_id: null, customer_name: null, payer_label: "Michal" })
      ).title
    ).toBe(copy.unboundNamed("Michal"))
    expect(toPaymentItem(row({ payer_label: "Michal" })).title).toBe("Dana")
  })

  it("shows the catalog price of a changed amount, and the reason only when given", () => {
    expect(
      toPaymentItem(
        row({ amount_agorot: 44000, amount_override_reason: "friend" })
      ).override
    ).toBe(`${copy.catalogPrice("472 ₪")} · ${copy.reason("friend")}`)
    expect(toPaymentItem(row({ amount_agorot: 0 })).override).toBe(
      copy.catalogPrice("472 ₪")
    )
  })

  it("adds the reference and the note when they exist", () => {
    expect(toPaymentItem(row({ reference: "123" })).extra).toBe(
      copy.reference("123")
    )
    expect(toPaymentItem(row({ reference: "123", note: "n" })).extra).toBe(
      `${copy.reference("123")} · ${copy.note("n")}`
    )
  })
})
