import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { parseCustomerCredits, toCustomerCreditItem } from "./credit-items"

const chips = adminCopy.customers.card.credits.chips

const BASE = {
  credit_id: "c1",
  status: "active",
  choice_pending: false,
  party_size: 1,
  origin_starts_at: "2026-10-16T07:00:00Z",
  concept_name: "שישי מיוחד",
  monetary_basis_agorot: 18000,
  refund: null,
}

const REFUND = {
  refund_request_id: "r1",
  status: "requested",
  amount_agorot: 18000,
  requested_at: "2026-10-10T07:00:00Z",
  refunded_on: null,
  reference: null,
}

function item(extra: Record<string, unknown>) {
  const [row] = parseCustomerCredits([{ ...BASE, ...extra }])
  return toCustomerCreditItem(row)
}

const flat = (text: string) => text.replace(/\s/g, " ")

describe("parseCustomerCredits (story 3.9)", () => {
  it("keeps well-formed rows, a refund only when whole; skips the rest", () => {
    const rows = parseCustomerCredits([
      BASE,
      { ...BASE, credit_id: "c2", refund: REFUND },
      { ...BASE, credit_id: "c3", refund: { ...REFUND, status: "x" } },
      { ...BASE, credit_id: null },
      { ...BASE, status: "expired" },
      "x",
    ])
    expect(rows.map((r) => r.credit_id)).toEqual(["c1", "c2", "c3"])
    expect(rows[1].refund).toEqual(REFUND)
    expect(rows[2].refund).toBeNull()
    expect(parseCustomerCredits(null)).toEqual([])
  })
})

describe("toCustomerCreditItem", () => {
  it("an active credit: זיכוי פעיל and its worth", () => {
    const i = item({})
    expect(flat(i.title)).toBe("בראנץ׳ שישי מיוחד 16.10")
    expect(i.chip).toEqual({ label: chips.active, tone: "success" })
    expect(flat(i.line)).toBe("זיכוי בשווי 180 ₪")
    expect(i.openRefundId).toBeNull()
    expect(i.couple).toBe(false)
  })

  it("a used credit and a pending choice", () => {
    expect(item({ status: "used" }).chip).toEqual({
      label: chips.used,
      tone: "expired",
    })
    const pending = item({ choice_pending: true, party_size: 2 })
    expect(pending.chip.label).toBe(chips.pending)
    expect(pending.couple).toBe(true)
    expect(pending.openRefundId).toBeNull()
  })

  it("an open refund request: בקשת החזר and the complete button's request", () => {
    const i = item({ status: "refund_requested", refund: REFUND })
    expect(i.chip).toEqual({ label: chips.requested, tone: "pending" })
    expect(flat(i.line)).toBe("ביקשה החזר של 180 ₪ ב-10.10")
    expect(i.openRefundId).toBe("r1")
    expect(i.line).not.toContain("הוחזר")
  })

  it("a refunded one: הוחזר, amount, day and reference; no button", () => {
    const i = item({
      status: "refunded",
      refund: {
        ...REFUND,
        status: "completed",
        amount_agorot: 12000,
        refunded_on: "2026-10-12",
        reference: "1234",
      },
    })
    expect(i.chip).toEqual({ label: chips.refunded, tone: "success" })
    expect(flat(i.line)).toBe("הוחזר 120 ₪ ב-12.10.26")
    expect(i.reference).toBe("אסמכתה: 1234")
    expect(i.openRefundId).toBeNull()
  })
})
