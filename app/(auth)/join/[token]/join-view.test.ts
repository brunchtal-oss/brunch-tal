import { describe, expect, it } from "vitest"

import { joinView } from "./join-view"

describe("joinView", () => {
  it.each([
    ["active", "form"],
    ["used", "used"],
    ["expired", "expired"],
    ["conflict", "conflict"],
  ] as const)("shows a %s link as %s before any submit", (link, expected) => {
    expect(joinView(null, link)).toBe(expected)
  })

  it.each([
    [{ status: "joined" }, "joined"],
    [{ status: "used" }, "used"],
    [{ status: "expired" }, "expired"],
    [{ status: "conflict" }, "conflict"],
  ] as const)("lets the result %j win over an active link", (state, view) => {
    expect(joinView(state, "active")).toBe(view)
  })

  it("keeps the form for field and server errors", () => {
    expect(
      joinView({ status: "error", code: "INVALID_INPUT", errors: [] }, "active")
    ).toBe("form")
  })
})
