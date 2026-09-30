import { describe, expect, it } from "vitest"

import { safeNext } from "./safe-next"

describe("safeNext", () => {
  it.each([
    ["/me", "/me"],
    ["/me/bookings?tab=credits", "/me/bookings?tab=credits"],
    ["/join/abc#top", "/join/abc#top"],
    ["/a/../me", "/me"],
  ])("accepts internal path %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    42,
    "",
    "me",
    "https://evil.example",
    "//evil.example",
    "//evil.example/me",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "/me\\..\\..\\evil",
    "/..//evil.example",
    "/.//evil.example/x",
    "/a/..//evil.example",
    "javascript:alert(1)",
    "/\tevil",
    "/\n/evil.example",
    "/" + "a".repeat(2048),
  ])("rejects %j", (input) => {
    expect(safeNext(input)).toBeNull()
  })
})
