import { describe, expect, it } from "vitest"

import {
  formatAccessibleDateTime,
  formatDayMonth,
  formatLocalDate,
  formatMonthYear,
  formatSessionDateTime,
  formatTime,
  formatWeekday,
} from "./time"

// Monday 12 October 2026, 10:00 in Jerusalem (IDT, UTC+3).
const SESSION = "2026-10-12T07:00:00Z"

describe("lib/time", () => {
  it("formats the visible session date", () => {
    expect(formatWeekday(SESSION)).toBe("יום שני")
    expect(formatDayMonth(SESSION)).toBe("12.10")
    expect(formatTime(SESSION)).toBe("10:00")
    expect(formatSessionDateTime(SESSION)).toBe("יום שני 12.10 · 10:00")
  })

  it("formats the month and year of a plain date and an instant", () => {
    expect(formatMonthYear("2026-10-01")).toBe("אוקטובר 2026")
    // 30.09 23:30 in Jerusalem is still September.
    expect(formatMonthYear("2026-09-30T20:30:00Z")).toBe("ספטמבר 2026")
  })

  it("formats the screen-reader text", () => {
    expect(formatAccessibleDateTime(SESSION)).toBe(
      "יום שני, 12 באוקטובר, 10:00"
    )
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(formatSessionDateTime(new Date(SESSION))).toBe(
      "יום שני 12.10 · 10:00"
    )
  })

  it("uses Jerusalem time, including daylight saving", () => {
    // Winter (IST, UTC+2): 26 October 2026 10:00 local.
    expect(formatTime("2026-10-26T08:00:00Z")).toBe("10:00")
    // Late evening UTC is already the next day in Jerusalem.
    expect(formatSessionDateTime("2026-09-30T21:30:00Z")).toBe(
      "יום חמישי 01.10 · 00:30"
    )
  })

  it("formats midnight on a 24-hour clock", () => {
    expect(formatTime("2026-09-30T21:00:00Z")).toBe("00:00")
  })

  describe("formatLocalDate", () => {
    it("returns the Jerusalem calendar day of an instant", () => {
      expect(formatLocalDate(SESSION)).toBe("2026-10-12")
      expect(formatLocalDate("2026-09-30T21:30:00Z")).toBe("2026-10-01")
      expect(formatLocalDate("2026-11-19T21:59:59Z")).toBe("2026-11-19")
      expect(formatLocalDate("2026-11-19T22:00:00Z")).toBe("2026-11-20")
    })

    it("does not shift a plain SQL date", () => {
      expect(formatLocalDate("2026-10-01")).toBe("2026-10-01")
      expect(formatDayMonth("2026-10-01")).toBe("01.10")
      expect(formatWeekday("2026-09-27")).toBe("יום ראשון")
    })
  })

  it("accepts explicit offsets", () => {
    expect(formatTime("2026-10-12T10:00:00+03:00")).toBe("10:00")
    expect(formatTime("2026-10-12T10:00:00+0300")).toBe("10:00")
    expect(formatTime("2026-10-12 10:00:00+03")).toBe("10:00")
  })

  it.each(["2026-10-12T07:00:00", "2026-10-12 07:00"])(
    "throws on %j (no time zone, would use the host's)",
    (value) => {
      expect(() => formatTime(value)).toThrow(RangeError)
    }
  )

  it.each(["", "not a date", "2026-02-30", "2026-13-01"])(
    "throws on %j",
    (value) => {
      expect(() => formatLocalDate(value)).toThrow(RangeError)
      expect(() => formatTime(value)).toThrow(RangeError)
    }
  )
})
