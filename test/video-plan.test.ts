import { describe, expect, it, vi } from "vitest"

import {
  addDays,
  checkAnchor,
  createStep,
  daysBetween,
  demoKey,
  eventCreatedOn,
  historyBookingMoment,
  historyShift,
  isMoment,
  joinMoment,
  localMoment,
  localParts,
  nearAutoExtend,
  paidOnOf,
  planVideoDates,
  weekStart,
  weekday,
} from "../scripts/video-plan.mjs"

// Israel leaves summer time on Sunday 2026-10-25 and enters it on Friday
// 2027-03-26; the ranges below cross both.
const runDays = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(from, i))
const atNoon = (day: string) => new Date(`${day}T12:00:00+02:00`)

describe("planVideoDates", () => {
  const days = [...runDays("2026-10-14", 21), ...runDays("2027-03-18", 21)]

  it.each(days)("dates the world from %s", (day) => {
    const plan = planVideoDates(atNoon(day))
    const { today, sessions, temp } = plan
    expect(today).toBe(day)

    const upcoming = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"].map(
      (k) => sessions[k]
    )
    for (const date of upcoming) {
      expect([1, 4]).toContain(weekday(date))
      expect(date > today).toBe(true)
    }
    expect([...upcoming].sort()).toEqual(upcoming)
    expect(new Set(upcoming).size).toBe(8)
    // The first one is the next Monday or Thursday.
    for (let d = addDays(today, 1); d < sessions.U1; d = addDays(d, 1)) {
      expect([1, 4]).not.toContain(weekday(d))
    }

    for (const key of ["F1", "F2"]) {
      expect(weekday(sessions[key])).toBe(5)
      expect(sessions[key] > today).toBe(true)
    }
    expect(daysBetween(sessions.F1, sessions.F2)).toBe(7)
    expect(daysBetween(today, sessions.F1)).toBeLessThanOrEqual(7)

    const history = ["H1", "H2", "H3", "H4"].map((k) => sessions[k])
    for (const date of history) {
      expect([1, 4]).toContain(weekday(date))
      expect(date < today).toBe(true)
      expect(daysBetween(date, today)).toBeLessThanOrEqual(14)
    }
    expect([...history].sort()).toEqual(history)
    expect(weekday(sessions.HF)).toBe(5)
    expect(sessions.HF < today).toBe(true)
    expect(daysBetween(sessions.HF, today)).toBeLessThanOrEqual(7)
    expect(weekday(sessions.H0)).toBe(1)
    const back = daysBetween(sessions.H0, today)
    expect(back).toBeGreaterThanOrEqual(119)
    expect(back).toBeLessThan(126)

    // The history starts on the Sunday of H1's week, at least 12 days back,
    // and from there every week up to today has a Monday or Thursday of
    // H1–H4 (the weeks job_auto_extend checks).
    expect(plan.historyStart).toBe(weekStart(sessions.H1))
    expect(weekday(plan.historyStart)).toBe(0)
    expect(daysBetween(plan.historyStart, today)).toBeGreaterThanOrEqual(12)
    for (let w = plan.historyStart; w < weekStart(today); w = addDays(w, 7)) {
      expect(history.some((d) => d >= w && d < addDays(w, 7))).toBe(true)
    }

    for (const key of ["H1", "H2", "H3", "H4", "HF", "H0"]) {
      const shift = temp[key]
      expect(weekday(shift.temp)).toBe(weekday(sessions[key]))
      const ahead = daysBetween(today, shift.temp)
      expect(ahead).toBeGreaterThanOrEqual(1)
      expect(ahead).toBeLessThanOrEqual(7)
      expect(Number.isInteger(shift.weeks)).toBe(true)
      expect(addDays(sessions[key], shift.weeks * 7)).toBe(shift.temp)
    }
  })

  it("never uses today, also on a Monday, a Thursday and a Friday", () => {
    for (const day of ["2026-10-19", "2026-10-22", "2026-10-23"]) {
      const { today, sessions } = planVideoDates(atNoon(day))
      expect(Object.values(sessions)).not.toContain(today)
    }
  })

  it("takes the Israel date, not the UTC date", () => {
    // 00:30 in Israel on Friday 2026-10-23 is still Thursday in UTC.
    expect(planVideoDates(new Date("2026-10-23T00:30:00+03:00")).today).toBe(
      "2026-10-23"
    )
    // 23:30 on the night summer time ends.
    expect(localParts(new Date("2026-10-25T23:30:00+02:00")).date).toBe(
      "2026-10-25"
    )
  })
})

describe("historyShift", () => {
  it("moves a past date to the same weekday 1–7 days ahead", () => {
    expect(historyShift("2026-10-19", "2026-10-22")).toEqual({
      temp: "2026-10-26",
      weeks: 1,
    })
    // The same weekday as today: a week ahead, never today.
    expect(historyShift("2026-10-15", "2026-10-22")).toEqual({
      temp: "2026-10-29",
      weeks: 2,
    })
  })
})

describe("paidOnOf", () => {
  const today = "2026-10-22"
  it("reads each rule", () => {
    expect(paidOnOf({ daysAgo: 24 }, { today })).toBe("2026-09-28")
    expect(
      paidOnOf({ beforeEvent: 3 }, { today, eventDate: "2026-10-08" })
    ).toBe("2026-10-05")
    // A card of 49 days that ends 7 days after today.
    const paid = paidOnOf({ expiresIn: 7 }, { today, validityDays: 49 })
    expect(addDays(paid, 49)).toBe("2026-10-29")
    expect(
      paidOnOf({ historyWeek: 2 }, { today, historyStart: "2026-10-04" })
    ).toBe("2026-10-06")
  })

  it("refuses an incomplete rule", () => {
    expect(() => paidOnOf({ beforeEvent: 3 }, { today })).toThrow()
    expect(() => paidOnOf({ expiresIn: 7 }, { today })).toThrow()
    expect(() => paidOnOf({ historyWeek: 0 }, { today })).toThrow()
    expect(() => paidOnOf({}, { today })).toThrow()
  })
})

describe("nearAutoExtend", () => {
  it("lets a seed start only at minutes 6–54 of the hour, Israel time", () => {
    const at = (time: string) => new Date(`2026-10-26T${time}:00+02:00`)
    expect(nearAutoExtend(at("10:54"))).toBe(false)
    expect(nearAutoExtend(at("10:55"))).toBe(true)
    expect(nearAutoExtend(at("23:59"))).toBe(true)
    expect(nearAutoExtend(at("00:00"))).toBe(true)
    expect(nearAutoExtend(at("10:05"))).toBe(true)
    expect(nearAutoExtend(at("10:06"))).toBe(false)
    expect(nearAutoExtend(at("10:30"))).toBe(false)
  })
})

describe("backdating targets", () => {
  it("puts a purchase between 09:00 and 21:00, stable for its salt", () => {
    for (const salt of ["a", "b", "payment:michal:0", "x:y"]) {
      const moment = localMoment("2026-10-01", salt)
      expect(isMoment(moment)).toBe(true)
      expect(moment.slice(0, 10)).toBe("2026-10-01")
      const time = moment.slice(11)
      expect(time >= "09:00" && time <= "21:00").toBe(true)
      expect(localMoment("2026-10-01", salt)).toBe(moment)
    }
  })

  it("joins the same day, after the purchase", () => {
    const purchase = "2026-10-01 20:55"
    const join = joinMoment(purchase, "join:michal")
    expect(join.slice(0, 10)).toBe("2026-10-01")
    expect(join > purchase).toBe(true)
  })

  it("books a history session after the purchase and before its day", () => {
    for (const salt of ["a", "b", "c", "d", "e", "f"]) {
      const at = historyBookingMoment("2026-09-20 10:00", "2026-10-08", salt)
      expect(isMoment(at)).toBe(true)
      expect(at > "2026-09-20 10:00").toBe(true)
      expect(at.slice(0, 10) < "2026-10-08").toBe(true)
    }
    // Paid the day before: booked that day, after the purchase.
    const close = historyBookingMoment("2026-10-07 21:00", "2026-10-08", "x")
    expect(close.slice(0, 10)).toBe("2026-10-07")
    expect(close > "2026-10-07 21:00").toBe(true)
  })

  it("creates a session three weeks before, or before its first purchase", () => {
    expect(eventCreatedOn("2026-10-08", [], "2026-10-22")).toBe("2026-09-17")
    expect(eventCreatedOn("2026-06-22", ["2026-05-20"], "2026-10-22")).toBe(
      "2026-05-19"
    )
    // Not in the past: the session keeps its real creation time.
    expect(eventCreatedOn("2026-11-19", [], "2026-10-22")).toBeNull()
  })

  it("refuses a malformed moment", () => {
    expect(isMoment("2026-10-01 24:00")).toBe(false)
    expect(isMoment("2026-02-30 10:00")).toBe(false)
    expect(isMoment("2026-10-01T10:00")).toBe(false)
  })
})

describe("demoKey", () => {
  it("is a stable UUID per generation and item", () => {
    const a = demoKey("g1", "event:U1")
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(demoKey("g1", "event:U1")).toBe(a)
    expect(demoKey("g2", "event:U1")).not.toBe(a)
    expect(demoKey("g1", "event:U2")).not.toBe(a)
  })
})

describe("checkAnchor", () => {
  const generation = "6f1c2a52-3b7e-4c1d-9a8f-0e2d4c6b8a10"
  it("starts a new world without an anchor", () => {
    expect(checkAnchor(undefined, "2026-10-22")).toEqual({ action: "new" })
    expect(checkAnchor(null, "2026-10-22")).toEqual({ action: "new" })
  })

  it("replays the same day", () => {
    expect(
      checkAnchor(
        { anchor_date: "2026-10-22", generation, complete: true },
        "2026-10-22"
      )
    ).toEqual({ action: "replay", generation, complete: true })
  })

  it("stops on another day or a broken anchor", () => {
    expect(
      checkAnchor(
        { anchor_date: "2026-10-21", generation, complete: true },
        "2026-10-22"
      )
    ).toEqual({ action: "stop", reason: "other_day" })
    expect(
      checkAnchor({ anchor_date: "2026-10-22", generation: "x" }, "2026-10-22")
    ).toEqual({ action: "stop", reason: "invalid" })
    expect(checkAnchor("text", "2026-10-22")).toEqual({
      action: "stop",
      reason: "invalid",
    })
  })
})

describe("createStep", () => {
  it("reports created and existing by the stored key", async () => {
    const stored = new Set(["k:a"])
    const log = vi.fn()
    const { step, counts } = createStep({
      keyOf: (item: string) => `k:${item}`,
      exists: async (key: string) => stored.has(key),
      log,
    })
    expect(await step("a", "A", async (key: string) => ({ key }))).toEqual({
      key: "k:a",
    })
    expect(await step("b", "B", async () => 1)).toBe(1)
    expect(await step("c", "C", async () => undefined)).toBeUndefined()
    expect(counts).toEqual({ created: 1, existing: 1 })
    expect(log).toHaveBeenCalledWith("כבר קיים: A")
    expect(log).toHaveBeenCalledWith("נוצר: B")
  })
})
