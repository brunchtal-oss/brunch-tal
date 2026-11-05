import { describe, expect, it } from "vitest"

import {
  catalogKey,
  formRemountKey,
  newIdempotencyKey,
  nextApprovalPhase,
} from "./approval-history"

describe("nextApprovalPhase", () => {
  it("shows the success screen once the pushed ?approved=1 is in the URL", () => {
    expect(nextApprovalPhase("pushed", false)).toBe("pushed")
    expect(nextApprovalPhase("pushed", true)).toBe("shown")
    expect(nextApprovalPhase("shown", true)).toBe("shown")
  })

  it("resets to an empty form when the param is gone (Back)", () => {
    expect(nextApprovalPhase("shown", false)).toBe("reset")
  })

  it("keeps the form on a reload of ?approved=1 (the link is never shown again)", () => {
    expect(nextApprovalPhase("form", true)).toBe("form")
    expect(nextApprovalPhase("form", false)).toBe("form")
  })
})

describe("newIdempotencyKey", () => {
  it("builds a v4 UUID", () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(newIdempotencyKey((b) => b.fill(255))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff"
    )
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })
})

describe("formRemountKey", () => {
  const before = catalogKey([
    { id: "A", priceAgorot: 10000 },
    { id: "B", priceAgorot: 5000 },
  ])
  const after = catalogKey([
    { id: "A", priceAgorot: 12000 },
    { id: "B", priceAgorot: 5000 },
  ])

  it("remounts an untouched form when a price changes", () => {
    expect(before).toBe("A:10000,B:5000")
    expect(formRemountKey(0, after, null)).not.toBe(
      formRemountKey(0, before, null)
    )
  })

  it("keeps a touched form (typed, another product chosen, or answered) across a price change", () => {
    expect(formRemountKey(0, after, before)).toBe(
      formRemountKey(0, before, null)
    )
  })

  it("remounts a touched form once a product of its catalog is no longer offered", () => {
    const withoutB = catalogKey([{ id: "A", priceAgorot: 12000 }])
    expect(formRemountKey(0, withoutB, before)).toBe(
      formRemountKey(0, withoutB, null)
    )
    // A product added meanwhile keeps the touched form.
    const withC = catalogKey([
      { id: "A", priceAgorot: 10000 },
      { id: "B", priceAgorot: 5000 },
      { id: "C", priceAgorot: 3000 },
    ])
    expect(formRemountKey(0, withC, before)).toBe(
      formRemountKey(0, before, null)
    )
  })

  it("starts a new form with a new session", () => {
    expect(formRemountKey(1, before, null)).not.toBe(
      formRemountKey(0, before, null)
    )
  })
})
