import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"

import { cancelReturnsText, parseCancelPlan } from "./cancel-plan"

const copy = adminCopy.sessions.cancel

const BASE = {
  funding: "pinned" as const,
  productName: "Single",
  optionsCount: 2,
  amountAgorot: 12800,
}

describe("cancelReturnsText (stories 3.6, 3.7)", () => {
  it("a card: one entry to its product", () => {
    expect(cancelReturnsText({ ...BASE, funding: "card" })).toBe(
      copy.returnsCard("Single")
    )
  })

  it("a pinned booking: a credit for N sessions, or the refund Tal chose", () => {
    expect(cancelReturnsText(BASE)).toBe(copy.returnsCredit(2))
    expect(cancelReturnsText(BASE)).toBe(
      "ייווצר ללקוחה זיכוי ל-2 מפגשים חלופיים"
    )
    expect(cancelReturnsText(BASE, "credit")).toBe(copy.returnsCredit(2))
    expect(cancelReturnsText(BASE, "refund")).toBe(
      `תיפתח בקשת החזר של ${formatAgorot(12800)}`
    )
  })

  it("a credit-funded booking: the same credit comes back", () => {
    expect(cancelReturnsText({ ...BASE, funding: "credit" })).toBe(
      "הזיכוי יחזור ללקוחה עם אותן חלופות"
    )
  })
})

describe("parseCancelPlan", () => {
  it("reads the funding and the choice; an unknown funding is a card", () => {
    const plan = parseCancelPlan({
      ok: true,
      funding: "credit",
      options_count: 3,
      choice_required: false,
    })
    expect(plan).toMatchObject({
      ok: true,
      funding: "credit",
      optionsCount: 3,
      choiceRequired: false,
      amountAgorot: null,
    })
    expect(parseCancelPlan({ ok: true, funding: "returned" })).toMatchObject({
      funding: "card",
    })
  })

  it("a refusal keeps a known code; anything else is a server error", () => {
    expect(parseCancelPlan({ ok: false, code: "EVENT_ENDED" })).toEqual({
      ok: false,
      code: "EVENT_ENDED",
    })
    expect(parseCancelPlan(null)).toEqual({ ok: false, code: "SERVER_ERROR" })
  })
})
