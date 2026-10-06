import { describe, expect, it } from "vitest"

import { bearerToken, sameSecret } from "./secret"

describe("sameSecret", () => {
  it("compares whole values of any length", () => {
    expect(sameSecret("abc", "abc")).toBe(true)
    expect(sameSecret("abc", "abd")).toBe(false)
    expect(sameSecret("abc", "abcd")).toBe(false)
    expect(sameSecret("", "abc")).toBe(false)
  })
})

describe("bearerToken", () => {
  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["Bearer  abc ", "abc"],
    ["Bearer ", null],
    ["Basic abc", null],
    ["Bearer a b", null],
    [null, null],
  ])("%j -> %j", (header, expected) => {
    expect(bearerToken(header)).toBe(expected)
  })
})
