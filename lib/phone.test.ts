import { describe, expect, it } from "vitest"

import { formatLocalPhone, normalizePhone } from "./phone"

describe("formatLocalPhone", () => {
  it.each([
    ["+972541234567", "054-123-4567"],
    ["+972721234567", "072-123-4567"],
    ["+97231234567", "03-123-4567"],
  ])("formats %s as %s", (e164, local) => {
    expect(formatLocalPhone(e164)).toBe(local)
  })

  it.each(["+14155550123", "", "054-123-4567"])(
    "returns %j unchanged",
    (value) => {
      expect(formatLocalPhone(value)).toBe(value)
    }
  )
})

describe("normalizePhone", () => {
  it.each([
    "0544256456",
    "054-425-6456",
    "+972 54-425-6456",
    "\u202A+972 54-425-6456\u202C",
    "\u200E+972 54-425-6456",
    "+972 054-425-6456",
    "00972-054-425-6456",
    "972544256456",
    "(054) 425.6456",
    "054\u2011425\u20116456",
    "\u061C054\u2212425\u20136456",
  ])("reads %j as 972544256456", (raw) => {
    expect(normalizePhone(raw)).toBe("972544256456")
  })

  it.each([
    ["03-123-4567", "97231234567"],
    ["02-1234567", "97221234567"],
    ["077-1234567", "972771234567"],
  ])("reads the landline or 07x number %j", (raw, digits) => {
    expect(normalizePhone(raw)).toBe(digits)
  })

  it.each([
    null,
    undefined,
    "",
    "544256456",
    "+44 20 7946 0958",
    "054425645",
    "05442564567",
    "02-12345678",
    "1-800-123-456",
    "1800123456",
    "abc",
    "05",
    "+0123456789",
    "1".repeat(16),
    "()",
    "+972",
  ])("gives null for %j", (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })
})
