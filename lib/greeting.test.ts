import { describe, expect, it } from "vitest"

import { adminGreeting, dayPart, firstName, metadataFullName } from "./greeting"

// 12.10.2026 is summer time in Jerusalem (UTC+3): local HH:MM = UTC + 3h.
function at(localHHMM: string): string {
  const [h, m] = localHHMM.split(":").map(Number)
  const utc = new Date(Date.UTC(2026, 9, 12, h - 3, m))
  return utc.toISOString()
}

describe("adminGreeting", () => {
  it("switches at the boundaries, in Jerusalem time", () => {
    expect(adminGreeting("טל כהן", at("04:59"))).toBe("לילה טוב, טל")
    expect(adminGreeting("טל כהן", at("05:00"))).toBe("בוקר טוב, טל")
    expect(adminGreeting("טל כהן", at("11:59"))).toBe("בוקר טוב, טל")
    expect(adminGreeting("טל כהן", at("12:00"))).toBe("צהריים טובים, טל")
    expect(adminGreeting("טל כהן", at("16:59"))).toBe("צהריים טובים, טל")
    expect(adminGreeting("טל כהן", at("17:00"))).toBe("ערב טוב, טל")
    expect(adminGreeting("טל כהן", at("21:59"))).toBe("ערב טוב, טל")
    expect(adminGreeting("טל כהן", at("22:00"))).toBe("לילה טוב, טל")
  })

  it("uses winter time too (UTC+2 after 25.10)", () => {
    // 26.10.2026 03:00 UTC = 05:00 in Jerusalem.
    expect(adminGreeting("טל", "2026-10-26T03:00:00Z")).toBe("בוקר טוב, טל")
  })

  it("without a name: the greeting alone; without a time: היי", () => {
    expect(adminGreeting(null, at("09:00"))).toBe("בוקר טוב")
    expect(adminGreeting("   ", at("09:00"))).toBe("בוקר טוב")
    expect(adminGreeting("טל", null)).toBe("היי טל")
    expect(adminGreeting(null, null)).toBe("היי")
  })

  it("reads full_name from Auth user metadata", () => {
    expect(metadataFullName({ full_name: "טל כהן" })).toBe("טל כהן")
    expect(
      adminGreeting(metadataFullName({ full_name: "טל כהן" }), at("09:00"))
    ).toBe("בוקר טוב, טל")
    expect(metadataFullName({ full_name: "  " })).toBeNull()
    expect(metadataFullName({ full_name: 3 })).toBeNull()
    expect(metadataFullName({})).toBeNull()
    expect(metadataFullName(undefined)).toBeNull()
  })

  it("dayPart and firstName", () => {
    expect(dayPart(0)).toBe("night")
    expect(dayPart(23)).toBe("night")
    expect(firstName(" טל  כהן ")).toBe("טל")
    expect(firstName("")).toBeNull()
  })
})
