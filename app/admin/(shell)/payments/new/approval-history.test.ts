import { describe, expect, it } from "vitest"

import { newIdempotencyKey, nextApprovalPhase } from "./approval-history"

describe("nextApprovalPhase", () => {
  it("shows the success screen once the pushed ?approved=1 is in the URL", () => {
    expect(nextApprovalPhase("pushed", false)).toBe("pushed")
    expect(nextApprovalPhase("pushed", true)).toBe("shown")
    expect(nextApprovalPhase("shown", true)).toBe("shown")
  })

  it("resets to an empty form when the param is gone (Back, or the payments tab)", () => {
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
