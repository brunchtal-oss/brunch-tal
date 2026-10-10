import { describe, expect, it } from "vitest"

import {
  isPlainObject,
  nonEmptyText,
  parsePositiveInt,
  validVersion,
} from "./form-values"

describe("parsePositiveInt", () => {
  it("reads a positive whole number, trimmed", () => {
    expect(parsePositiveInt("12")).toBe(12)
    expect(parsePositiveInt(" 7 ")).toBe(7)
    expect(parsePositiveInt("007")).toBe(7)
    expect(parsePositiveInt("999999999")).toBe(999999999)
  })

  it("refuses zero, signs, decimals, long and empty input", () => {
    for (const text of [
      "0",
      "-1",
      "+1",
      "1.5",
      "1e3",
      "1234567890",
      "",
      " ",
      "abc",
    ]) {
      expect(parsePositiveInt(text)).toBeNull()
    }
  })
})

describe("isPlainObject", () => {
  it("accepts a non-empty object", () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
  })

  it("refuses an empty object, an array, null and primitives", () => {
    for (const value of [{}, [], [1], null, undefined, "x", 1, true]) {
      expect(isPlainObject(value)).toBe(false)
    }
  })
})

describe("validVersion", () => {
  it("accepts a positive safe integer", () => {
    expect(validVersion(1)).toBe(true)
    expect(validVersion(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it("refuses zero, negatives, fractions, unsafe and non-numbers", () => {
    for (const value of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      "1",
      null,
    ]) {
      expect(validVersion(value)).toBe(false)
    }
  })
})

describe("nonEmptyText", () => {
  it("keeps a non-empty string as is", () => {
    expect(nonEmptyText("abc")).toBe("abc")
    expect(nonEmptyText(" ")).toBe(" ")
  })

  it("is null for an empty string and non-strings", () => {
    for (const value of ["", null, undefined, 1, {}]) {
      expect(nonEmptyText(value)).toBeNull()
    }
  })
})
