import { describe, expect, it } from "vitest"

import { requestPathOf, shellPath } from "./request-path"

describe("requestPathOf", () => {
  it("keeps the query", () => {
    expect(requestPathOf({ pathname: "/admin/more", search: "?x=1" })).toBe(
      "/admin/more?x=1"
    )
  })
})

describe("shellPath", () => {
  it.each([
    ["/admin/more", "/admin", "/admin/more"],
    ["/admin", "/admin", "/admin"],
    ["/admin?x=1", "/admin", "/admin?x=1"],
    ["/me/bookings", "/me", "/me/bookings"],
    [null, "/admin", "/admin"],
    ["/administration", "/admin", "/admin"],
    ["//evil.com", "/me", "/me"],
    ["/me", "/admin", "/admin"],
  ])("%j in %s -> %s", (value, area, expected) => {
    expect(shellPath(value, area)).toBe(expected)
  })
})
