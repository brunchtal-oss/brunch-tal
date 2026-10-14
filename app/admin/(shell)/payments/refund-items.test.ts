import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  parseRefundPlan,
  parseRefundRows,
  refundFieldsProblem,
  refundHref,
  refundRefusal,
  toRefundItem,
} from "./refund-items"

const copy = adminCopy.refunds
const CUSTOMER = "44444444-4444-4444-8444-444444444444"

const OPEN = {
  refund_request_id: "r1",
  status: "requested",
  customer_id: CUSTOMER,
  customer_label: "Noa",
  amount_agorot: 18000,
  requested_at: "2026-10-10T07:00:00Z",
  refunded_on: null,
  reference: null,
  concept_name: "שישי מיוחד",
  starts_at: "2026-10-16T07:00:00Z",
  product_name: "בראנץ׳ בודד",
  paid_agorot: 18000,
  max_agorot: 18000,
}

const flat = (text: string) => text.replace(/\s/g, " ")

describe("parseRefundRows (story 3.9)", () => {
  it("keeps well-formed rows and skips the rest", () => {
    const rows = parseRefundRows([
      OPEN,
      { ...OPEN, refund_request_id: null },
      { ...OPEN, status: "other" },
      "x",
    ])
    expect(rows).toEqual([OPEN])
    expect(parseRefundRows(null)).toEqual([])
  })
})

describe("toRefundItem", () => {
  it("an open request: its anchor, the customer's card and what she asked for", () => {
    const item = toRefundItem(parseRefundRows([OPEN])[0])
    expect(item).toMatchObject({
      id: "r1",
      anchor: "refund-r1",
      open: true,
      name: "Noa",
      customerHref: `/admin/customers/${CUSTOMER}`,
      reference: null,
    })
    expect(flat(item.title)).toBe("Noa · בראנץ׳ שישי מיוחד 16.10")
    expect(flat(item.detail)).toBe("בקשת החזר של 180 ₪ · בראנץ׳ בודד")
  })

  it("a completed one: what was paid back, its day and the reference; unbound reads as a new customer", () => {
    const item = toRefundItem(
      parseRefundRows([
        {
          ...OPEN,
          status: "completed",
          customer_id: null,
          customer_label: null,
          amount_agorot: 12000,
          refunded_on: "2026-10-12",
          reference: "1234",
        },
      ])[0]
    )
    expect(item.open).toBe(false)
    expect(item.customerHref).toBeNull()
    expect(item.name).toBe(adminCopy.home.newCustomer)
    expect(flat(item.detail)).toBe("הוחזר 120 ₪ ב-12.10.26")
    expect(item.reference).toBe("אסמכתה: 1234")
  })

  it("refundHref points at the row", () => {
    expect(refundHref("r1")).toBe("/admin/payments#refund-r1")
  })
})

const PLAN = {
  ok: true,
  refund_request_id: "r1",
  customer_id: CUSTOMER,
  customer_label: "Noa",
  requested_agorot: 18000,
  paid_agorot: 18000,
  refunded_before_agorot: 0,
  max_agorot: 18000,
  paid_on: "2026-10-01",
  concept_name: "שישי מיוחד",
  starts_at: "2026-10-16T07:00:00Z",
  today: "2026-10-13",
}

describe("parseRefundPlan", () => {
  it("maps the plan", () => {
    expect(parseRefundPlan(PLAN)).toEqual({
      ok: true,
      refundRequestId: "r1",
      customerLabel: "Noa",
      requestedAgorot: 18000,
      paidAgorot: 18000,
      refundedBeforeAgorot: 0,
      maxAgorot: 18000,
      paidOn: "2026-10-01",
      conceptName: "שישי מיוחד",
      startsAt: "2026-10-16T07:00:00Z",
      today: "2026-10-13",
    })
  })

  it("a refusal keeps its code; anything malformed is a server error", () => {
    expect(
      parseRefundPlan({ ok: false, code: "REFUND_ALREADY_COMPLETED" })
    ).toEqual({ ok: false, code: "REFUND_ALREADY_COMPLETED" })
    expect(parseRefundPlan({ ok: false, code: "NOPE" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(parseRefundPlan({ ...PLAN, max_agorot: "1" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("refundFieldsProblem", () => {
  const plan = parseRefundPlan(PLAN)
  if (!plan.ok) throw new Error("plan")
  const ok = { refundedOn: "2026-10-13", amountText: "180", reference: "" }

  it("valid fields: none", () => {
    expect(refundFieldsProblem(plan, ok)).toBeNull()
    expect(refundFieldsProblem(plan, { ...ok, amountText: "0" })).toBeNull()
    expect(
      refundFieldsProblem(plan, { ...ok, refundedOn: "2026-10-01" })
    ).toBeNull()
  })

  it("names the first problem", () => {
    expect(refundFieldsProblem(plan, { ...ok, refundedOn: "" })).toBe(
      copy.dateMissing
    )
    expect(refundFieldsProblem(plan, { ...ok, refundedOn: "2026-10-14" })).toBe(
      copy.dateInvalid
    )
    expect(refundFieldsProblem(plan, { ...ok, refundedOn: "2026-09-30" })).toBe(
      copy.dateInvalid
    )
    expect(refundFieldsProblem(plan, { ...ok, amountText: "abc" })).toBe(
      copy.amountInvalid
    )
    expect(
      flat(refundFieldsProblem(plan, { ...ok, amountText: "180.01" }) ?? "")
    ).toBe("אפשר להחזיר עד 180 ₪")
    expect(
      refundFieldsProblem(plan, { ...ok, reference: "x".repeat(201) })
    ).toBe(copy.referenceTooLong)
  })
})

describe("refundRefusal", () => {
  it("words INVALID_INPUT by its field; any other code keeps lib/errors", () => {
    expect(refundRefusal("INVALID_INPUT", "refunded_on")).toBe(copy.dateInvalid)
    expect(refundRefusal("INVALID_INPUT", "amount")).toBe(copy.amountInvalid)
    expect(refundRefusal("INVALID_INPUT", "reference")).toBe(
      copy.referenceTooLong
    )
    expect(refundRefusal("REFUND_EXCEEDS_PAID")).toBeNull()
  })
})
