import { describe, expect, it } from "vitest"

import { isShortLine } from "./sections"

describe("isShortLine", () => {
  it("is true for one line of up to 60 characters", () => {
    expect(isShortLine("נשמח לשמוע ממך")).toBe(true)
    expect(isShortLine("א".repeat(60))).toBe(true)
  })

  it("is false for a longer line or a line break", () => {
    expect(isShortLine("א".repeat(61))).toBe(false)
    expect(isShortLine("שורה אחת\nשורה שנייה")).toBe(false)
  })
})
