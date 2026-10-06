import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { cancelReturnsText, parseCancelPlan } from "./cancel-plan"

const copy = adminCopy.sessions.cancel

const BASE = {
  outcome: "pinned" as const,
  productName: "Single",
  awaitingSessions: false,
  expiresOn: "2026-10-20",
  optionsCount: 2,
}

describe("cancelReturnsText (story 3.6)", () => {
  it("a card: one entry to its product", () => {
    expect(cancelReturnsText({ ...BASE, outcome: "card" })).toBe(
      copy.returnsCard("Single")
    )
  })

  it("a pinned booking: the next sessions until the validity date", () => {
    expect(cancelReturnsText(BASE)).toBe(copy.returnsPinned(2, "20.10"))
  })

  it("waiting for the next sessions: no date, never the provisional one", () => {
    const text = cancelReturnsText({
      ...BASE,
      awaitingSessions: true,
      expiresOn: "2036-10-14",
    })
    expect(text).toBe(copy.returnsAwaiting(2))
    expect(text).not.toContain("14.10")
  })
})

describe("parseCancelPlan", () => {
  it("a refusal keeps a known code; anything else is a server error", () => {
    expect(parseCancelPlan({ ok: false, code: "EVENT_ENDED" })).toEqual({
      ok: false,
      code: "EVENT_ENDED",
    })
    expect(parseCancelPlan(null)).toEqual({ ok: false, code: "SERVER_ERROR" })
  })
})
