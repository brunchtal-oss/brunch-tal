import { describe, expect, it } from "vitest"

import { formatLocalPhone } from "./phone"

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
