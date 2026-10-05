import { describe, expect, it, vi } from "vitest"

import {
  answerFor,
  canSearch,
  PAYMENT_HREF,
  resultHref,
} from "./customer-search"

vi.mock("../actions", () => ({ searchCustomersAction: vi.fn() }))

describe("canSearch", () => {
  it.each([
    ["", false],
    [" a ", false],
    ["da", true],
    [" 054 ", true],
  ])("%j -> %s", (query, expected) => {
    expect(canSearch(query)).toBe(expected)
  })
})

describe("answerFor", () => {
  const answer = { query: "dana", ok: true }

  it("shows the answer only for the query it answers (trimmed)", () => {
    expect(answerFor("dana", answer)).toBe(answer)
    expect(answerFor(" dana ", answer)).toBe(answer)
    expect(answerFor("dan", answer)).toBeNull()
    expect(answerFor("d", answer)).toBeNull()
    expect(answerFor("dana", null)).toBeNull()
  })
})

describe("resultHref", () => {
  it("leads to the payment form by default, or to the given template (story 3.4)", () => {
    expect(resultHref(PAYMENT_HREF, "c1")).toBe(
      "/admin/payments/new/existing/c1"
    )
    expect(resultHref("/admin/sessions/e1/book?customer=:id", "c1")).toBe(
      "/admin/sessions/e1/book?customer=c1"
    )
  })
})
