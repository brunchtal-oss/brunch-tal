import { describe, expect, it } from "vitest"

import { formatAgorot, formatAgorotInput, parseShekelsToAgorot } from "./money"

describe("formatAgorot", () => {
  it.each([
    [12800, "128 ₪"],
    [123400, "1,234 ₪"],
    [12750, "127.50 ₪"],
    [12705, "127.05 ₪"],
    [0, "0 ₪"],
    [5, "0.05 ₪"],
    [123456789, "1,234,567.89 ₪"],
    [-12800, "-128 ₪"],
  ])("%i agorot is %s", (agorot, expected) => {
    expect(formatAgorot(agorot)).toBe(expected)
  })

  it("never rounds agorot", () => {
    expect(formatAgorot(12799)).toBe("127.99 ₪")
  })

  it.each([12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "throws on %s",
    (value) => {
      expect(() => formatAgorot(value)).toThrow(RangeError)
    }
  )
})

describe("parseShekelsToAgorot", () => {
  it.each([
    ["128", 12800],
    ["128.5", 12850],
    [" 1,234.50 ₪", 123450],
    ["₪128", 12800],
    ["0", 0],
    ["0.05", 5],
    ["1,234,567", 123456700],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("%j is %i agorot", (input, expected) => {
    expect(parseShekelsToAgorot(input)).toBe(expected)
  })

  it.each([
    "",
    " ",
    "₪",
    "-5",
    "1.234",
    "12,34",
    "1,2345",
    "1e3",
    "abc",
    "12.",
    ".5",
    "1 2",
    "+5",
    "90071992547409.92",
    "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(parseShekelsToAgorot(input)).toBeNull()
  })

  it("ignores bidi marks pasted from the RTL UI", () => {
    expect(parseShekelsToAgorot("\u200f128 ₪")).toBe(12800)
    expect(parseShekelsToAgorot("\u200e1,234.50\u200e ₪")).toBe(123450)
    expect(parseShekelsToAgorot("\u2066128\u2069")).toBe(12800)
    expect(parseShekelsToAgorot("\u202b128\u202c")).toBe(12800)
    expect(parseShekelsToAgorot("\u200f")).toBeNull()
  })

  it("round-trips with formatAgorot", () => {
    for (const agorot of [0, 5, 12750, 123450, 987654321]) {
      expect(parseShekelsToAgorot(formatAgorot(agorot))).toBe(agorot)
    }
  })
})

describe("formatAgorotInput", () => {
  it.each([
    [47200, "472"],
    [123400, "1,234"],
    [12750, "127.50"],
    [0, "0"],
  ])("formats %i as %s and parses it back", (agorot, text) => {
    expect(formatAgorotInput(agorot)).toBe(text)
    expect(parseShekelsToAgorot(text)).toBe(agorot)
  })
})
