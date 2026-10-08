import { describe, expect, it } from "vitest"

import {
  addDays,
  demoKey,
  isUuid,
  localParts,
  planDates,
  weekday,
} from "../scripts/demo-plan.mjs"

// 2026-10-08 is a Thursday; Israel is on summer time (UTC+3) until 2026-10-25.
const at = (local: string) => new Date(`${local}+03:00`).toISOString()

describe("planDates", () => {
  it("skips Saturday and keeps every session after the previous one", () => {
    // Thursday: D+3 = Sunday, D+5 = Tuesday, D+9 = Saturday.
    const plan = planDates(at("2026-10-08T12:00:00"))
    if (!plan.ok) throw new Error("expected a plan")
    const dates = Object.values(plan.sessions) as string[]
    for (const date of dates) expect(weekday(date)).not.toBe(6)
    expect(plan.sessions.E6).toBe("2026-10-18")
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it("moves a Saturday to the next free day without collisions", () => {
    // Monday: D+5 = Saturday -> Sunday, then E4 (D+6) moves after it.
    const plan = planDates(at("2026-10-05T12:00:00"))
    if (!plan.ok) throw new Error("expected a plan")
    expect(plan.sessions.E3).toBe("2026-10-11")
    expect(plan.sessions.E4).toBe("2026-10-12")
    expect(plan.sessions.E5).toBe("2026-10-13")
  })

  it("ends E0 after the run, on the same day, after its start", () => {
    for (const time of ["06:10", "09:02", "12:00", "17:47", "23:29"]) {
      const anchor = at(`2026-10-08T${time}:00`)
      const plan = planDates(anchor)
      if (!plan.ok) throw new Error(`expected a plan at ${time}`)
      expect(plan.e0.date).toBe("2026-10-08")
      const run = localParts(anchor).minutes
      const [sh, sm] = plan.e0.start_time.split(":").map(Number)
      const [eh, em] = plan.e0.end_time.split(":").map(Number)
      expect(sh * 60 + sm).toBeLessThan(run)
      expect(sh * 60 + sm).toBeGreaterThanOrEqual(6 * 60)
      expect(sh * 60 + sm).toBeLessThanOrEqual(10 * 60 + 30)
      expect(eh * 60 + em).toBeGreaterThanOrEqual(run + 6)
      expect(eh * 60 + em).toBeLessThan(24 * 60)
      expect(em % 5).toBe(0)
    }
  })

  it("starts E0 at 10:30 in the afternoon", () => {
    const plan = planDates(at("2026-10-08T15:00:00"))
    if (!plan.ok) throw new Error("expected a plan")
    expect(plan.e0).toEqual({
      date: "2026-10-08",
      start_time: "10:30",
      end_time: "15:10",
    })
  })

  it("refuses a late, an early and a Saturday first run", () => {
    expect(planDates(at("2026-10-08T23:30:00"))).toEqual({
      ok: false,
      reason: "late",
    })
    expect(planDates(at("2026-10-08T23:59:00"))).toEqual({
      ok: false,
      reason: "late",
    })
    expect(planDates(at("2026-10-08T05:00:00"))).toEqual({
      ok: false,
      reason: "early",
    })
    expect(planDates(at("2026-10-10T12:00:00"))).toEqual({
      ok: false,
      reason: "saturday",
    })
  })

  it("uses the Israel date, not the UTC date", () => {
    // 00:30 in Israel on Friday is still Thursday (21:30) in UTC.
    const anchor = at("2026-10-09T00:30:00")
    expect(anchor).toBe("2026-10-08T21:30:00.000Z")
    expect(localParts(anchor).date).toBe("2026-10-09")
    expect(localParts(anchor).weekday).toBe(5)
    expect(localParts(anchor).minutes).toBe(30)
  })

  it("gives the expiring card a paid_on that ends on D+9", () => {
    const plan = planDates(at("2026-10-08T12:00:00"))
    if (!plan.ok) throw new Error("expected a plan")
    const paidOn = plan.expiringCardPaidOn(49)
    expect(paidOn).toBe("2026-08-29")
    expect(addDays(paidOn, 49)).toBe(addDays(plan.today, 9))
  })
})

describe("demoKey", () => {
  it("is a stable UUID per generation and item", () => {
    const key = demoKey("gen-1", "pay:maya:card")
    expect(isUuid(key)).toBe(true)
    expect(key).toBe(demoKey("gen-1", "pay:maya:card"))
    expect(key).not.toBe(demoKey("gen-2", "pay:maya:card"))
    expect(key).not.toBe(demoKey("gen-1", "pay:noa:card"))
    expect(key[14]).toBe("5")
  })
})
