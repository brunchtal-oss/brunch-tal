import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { babyAge } from "./baby-age"

const copy = adminCopy.sessions.babyAge

describe("babyAge", () => {
  it.each([
    ["2026-10-01", "2026-10-05", copy.newborn],
    ["2026-10-05", "2026-10-05", copy.newborn],
    ["2026-09-28", "2026-10-05", copy.weeks(1)],
    ["2026-09-20", "2026-10-05", copy.weeks(2)],
    ["2026-09-06", "2026-10-05", copy.weeks(4)],
    ["2026-09-05", "2026-10-05", copy.months(1)],
    ["2026-08-05", "2026-10-05", copy.months(2)],
    ["2026-07-06", "2026-10-05", copy.months(2)],
    ["2026-07-05", "2026-10-05", copy.months(3)],
    ["2025-09-05", "2026-10-05", copy.months(13)],
    // A month end: 31.01 to 28.02 is not a whole month yet.
    ["2026-01-31", "2026-02-28", copy.weeks(4)],
  ])("%s on %s", (birth, day, expected) => {
    expect(babyAge(birth, day)).toBe(expected)
  })

  it("has no age for a birth after the day or a bad date", () => {
    expect(babyAge("2026-10-06", "2026-10-05")).toBe("")
    expect(babyAge("2026-02-30", "2026-10-05")).toBe("")
    expect(babyAge("x", "2026-10-05")).toBe("")
  })

  it("words one and two as the language does", () => {
    expect(copy.weeks(1)).not.toContain("1")
    expect(copy.months(2)).not.toContain("2")
    expect(copy.months(5)).toContain("5")
  })
})
