import { describe, expect, it } from "vitest"

import { babyAge } from "./baby-age"

describe("babyAge", () => {
  it.each([
    ["2026-10-01", "2026-10-05", "פחות משבוע"],
    ["2026-10-05", "2026-10-05", "פחות משבוע"],
    ["2026-09-28", "2026-10-05", "שבוע"],
    ["2026-09-20", "2026-10-05", "שבועיים"],
    ["2026-09-06", "2026-10-05", "4 שבועות"],
    ["2026-09-05", "2026-10-05", "חודש"],
    ["2026-08-05", "2026-10-05", "חודשיים"],
    ["2026-07-06", "2026-10-05", "חודשיים"],
    ["2026-07-05", "2026-10-05", "3 חודשים"],
    // From a year on in years and months (story 2.10).
    ["2025-09-05", "2026-10-05", "שנה וחודש"],
    // A month end: 31.01 to 28.02 is not a whole month yet.
    ["2026-01-31", "2026-02-28", "4 שבועות"],
  ])("%s on %s", (birth, day, expected) => {
    expect(babyAge(birth, day)).toBe(expected)
  })

  it("has no age for a birth after the day or a bad date", () => {
    expect(babyAge("2026-10-06", "2026-10-05")).toBe("")
    expect(babyAge("2026-02-30", "2026-10-05")).toBe("")
    expect(babyAge("x", "2026-10-05")).toBe("")
  })
})
