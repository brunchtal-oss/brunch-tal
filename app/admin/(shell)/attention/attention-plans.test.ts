import { describe, expect, it } from "vitest"

import { parseSettlePlan } from "./attention-plans"

describe("parseSettlePlan (story 3.13)", () => {
  it("a plan", () => {
    expect(
      parseSettlePlan({
        ok: true,
        entitlement_id: "e1",
        customer_id: "c1",
        customer_label: "Noa",
        event_id: "ev",
        concept_name: "שישי מיוחד",
        starts_at: "2026-10-16T07:00:00Z",
        amount_agorot: 12800,
      })
    ).toEqual({
      ok: true,
      customerId: "c1",
      customerLabel: "Noa",
      conceptName: "שישי מיוחד",
      startsAt: "2026-10-16T07:00:00Z",
      amountAgorot: 12800,
    })
  })

  it("a purchase not bound yet has no customer id", () => {
    const plan = parseSettlePlan({ ok: true, customer_id: null })
    expect(plan).toMatchObject({ ok: true, customerId: null, amountAgorot: 0 })
  })

  it("NOT_PARKED, and an unknown code as SERVER_ERROR", () => {
    expect(parseSettlePlan({ ok: false, code: "NOT_PARKED" })).toEqual({
      ok: false,
      code: "NOT_PARKED",
    })
    expect(parseSettlePlan({ ok: false, code: "??" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})
