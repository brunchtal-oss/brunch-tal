import { afterEach, describe, expect, it, vi } from "vitest"

import { babyAgeText } from "./copy/baby-age"
import {
  babyAge,
  formatAccessibleDateTime,
  formatDayMonth,
  formatFullDate,
  formatLocalDate,
  formatMonthYear,
  formatNotificationTime,
  formatSessionDateTime,
  formatShortDay,
  formatTime,
  formatWeekday,
  isPlainDate,
  localToday,
} from "./time"

// Story 2.10: every age row of the spec's I/O matrix, the shape and the
// shared wording.
describe("babyAge", () => {
  it.each([
    // Twins born 05.07, on 05.10.
    ["2026-07-05", "2026-10-05", { years: 0, months: 3 }, "3 חודשים"],
    // Age 0.
    ["2026-10-05", "2026-10-05", { newborn: true }, "פחות משבוע"],
    ["2026-09-28", "2026-10-05", { weeks: 1 }, "שבוע"],
    // A month end: not a month yet.
    ["2026-01-31", "2026-02-28", { weeks: 4 }, "4 שבועות"],
    // Over a year.
    ["2025-09-05", "2026-10-05", { years: 1, months: 1 }, "שנה וחודש"],
    ["2024-08-05", "2026-10-05", { years: 2, months: 2 }, "שנתיים וחודשיים"],
    // A whole year at a month end (29.02).
    ["2024-02-29", "2025-02-28", { years: 0, months: 11 }, "11 חודשים"],
    ["2024-02-29", "2025-03-01", { years: 1, months: 0 }, "שנה"],
  ])("%s on %s", (birth, day, age, text) => {
    expect(babyAge(birth, day)).toEqual(age)
    expect(babyAgeText(babyAge(birth, day))).toBe(text)
  })

  it.each([
    [{ years: 1, months: 2 }, "שנה וחודשיים"],
    [{ years: 1, months: 3 }, "שנה ו-3 חודשים"],
    [{ years: 2, months: 0 }, "שנתיים"],
    [{ years: 2, months: 5 }, "שנתיים ו-5 חודשים"],
    [{ years: 3, months: 0 }, "3 שנים"],
    [{ years: 3, months: 1 }, "3 שנים וחודש"],
    [{ years: 0, months: 1 }, "חודש"],
    [{ years: 0, months: 2 }, "חודשיים"],
    [{ weeks: 2 }, "שבועיים"],
  ])("words %j as %s", (age, text) => {
    expect(babyAgeText(age)).toBe(text)
  })

  it("has no age for a birth after the day or a bad date", () => {
    expect(babyAge("2026-10-06", "2026-10-05")).toBeNull()
    expect(babyAge("2026-02-30", "2026-10-05")).toBeNull()
    expect(babyAge("x", "2026-10-05")).toBeNull()
    expect(babyAgeText(null)).toBe("")
  })

  it("formats a birth date with its year", () => {
    expect(formatFullDate("2026-07-05")).toBe("05.07.2026")
  })

  describe("localToday", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      // Summer (IDT, UTC+3): 22:30 UTC is already the next day.
      ["2026-10-05T22:30:00Z", "2026-10-06"],
      ["2026-10-05T20:30:00Z", "2026-10-05"],
      // Winter (IST, UTC+2), across a year.
      ["2026-12-31T22:30:00Z", "2027-01-01"],
      ["2026-12-31T21:30:00Z", "2026-12-31"],
    ])("at %s is %s", (now, day) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(now))
      expect(localToday()).toBe(day)
    })
  })

  it("accepts only a real plain date", () => {
    expect(isPlainDate("2024-02-29")).toBe(true)
    for (const value of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "5.7.2026",
      "",
    ]) {
      expect(isPlainDate(value)).toBe(false)
    }
  })
})

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

  it("formats a short day: the weekday letter and DD.MM (story 4.9)", () => {
    expect(formatShortDay("2026-10-07")).toBe("ד׳ 07.10")
    expect(formatShortDay("2026-10-04")).toBe("א׳ 04.10")
    expect(formatShortDay("2026-10-10")).toBe("ש׳ 10.10")
    // An instant late in the evening UTC is already the next local day.
    expect(formatShortDay("2026-10-06T22:30:00Z")).toBe("ד׳ 07.10")
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

// Story 5.7: a notification's time by the Jerusalem calendar day.
describe("formatNotificationTime", () => {
  const now = "2026-10-06T09:00:00Z" // 12:00 in Jerusalem

  it("says today, yesterday, or the date", () => {
    expect(formatNotificationTime("2026-10-06T05:15:00Z", now)).toBe(
      "היום, 08:15"
    )
    expect(formatNotificationTime("2026-10-05T20:59:00Z", now)).toBe(
      "אתמול, 23:59"
    )
    // 21:00Z on the 5th is already the 6th in Jerusalem.
    expect(formatNotificationTime("2026-10-05T21:00:00Z", now)).toBe(
      "היום, 00:00"
    )
    expect(formatNotificationTime("2026-10-04T20:59:00Z", now)).toBe("04.10")
    expect(formatNotificationTime("2026-10-07T08:00:00Z", now)).toBe("07.10")
  })

  it("keeps the calendar days on the 25-hour day when summer time ends", () => {
    // 2026-10-25: clocks go back at 02:00; 23:30 local is 21:30Z.
    const lateOnLongDay = "2026-10-25T21:30:00Z"
    expect(formatNotificationTime("2026-10-24T21:30:00Z", lateOnLongDay)).toBe(
      "היום, 00:30"
    )
    expect(formatNotificationTime("2026-10-24T19:00:00Z", lateOnLongDay)).toBe(
      "אתמול, 22:00"
    )
    expect(formatNotificationTime("2026-10-23T19:00:00Z", lateOnLongDay)).toBe(
      "23.10"
    )
  })
})
