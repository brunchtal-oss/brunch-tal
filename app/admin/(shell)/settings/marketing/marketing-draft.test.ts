import { describe, expect, it } from "vitest"

import {
  DEFAULT_TIME,
  draftFromSchedule,
  nextTextId,
  parseSchedule,
  scheduleChanged,
  scheduleFromDraft,
  textProblem,
  trimText,
  type MarketingText,
} from "./marketing-draft"

const SAVED = [
  { weekday: 0, time: "09:00" },
  { weekday: 1, time: "20:00" },
  { weekday: 4, time: "20:00" },
]

function text(extra: Partial<MarketingText>): MarketingText {
  return {
    id: "a",
    body: "פוסט אחד",
    active: true,
    sort_order: 1,
    last_sent_at: null,
    version: 1,
    ...extra,
  }
}

describe("the schedule draft (story 5.11)", () => {
  it("parseSchedule keeps only valid slots", () => {
    expect(
      parseSchedule([
        ...SAVED,
        { weekday: 7, time: "09:00" },
        { weekday: 2, time: "9:00" },
        { weekday: 1.5, time: "09:00" },
        null,
        "x",
      ])
    ).toEqual(SAVED)
    expect(parseSchedule(null)).toEqual([])
    expect(parseSchedule({})).toEqual([])
  })

  it("seven rows from Sunday; a saved day is checked with its time, the rest unchecked with the default", () => {
    const draft = draftFromSchedule(SAVED)
    expect(draft).toHaveLength(7)
    expect(draft[0]).toEqual({ on: true, time: "09:00" })
    expect(draft[1]).toEqual({ on: true, time: "20:00" })
    expect(draft[2]).toEqual({ on: false, time: DEFAULT_TIME })
    expect(draft[4]).toEqual({ on: true, time: "20:00" })
    expect(draft[6]).toEqual({ on: false, time: DEFAULT_TIME })
  })

  it("saves the checked days sorted by weekday; an unchecked day's time is ignored", () => {
    const draft = draftFromSchedule(SAVED)
    draft[6] = { on: true, time: "21:30" }
    draft[2] = { on: false, time: "bad" }
    expect(scheduleFromDraft(draft)).toEqual([
      ...SAVED,
      { weekday: 6, time: "21:30" },
    ])
  })

  it("a checked day without a valid time blocks the save", () => {
    const draft = draftFromSchedule(SAVED)
    draft[3] = { on: true, time: "" }
    expect(scheduleFromDraft(draft)).toBeNull()
  })

  it("no day checked saves an empty schedule", () => {
    expect(scheduleFromDraft(draftFromSchedule([]))).toEqual([])
  })

  it("scheduleChanged: unchanged, changed time, a day off", () => {
    expect(scheduleChanged(SAVED, draftFromSchedule(SAVED))).toBe(false)
    const time = draftFromSchedule(SAVED)
    time[0] = { on: true, time: "10:00" }
    expect(scheduleChanged(SAVED, time)).toBe(true)
    const off = draftFromSchedule(SAVED)
    off[1] = { ...off[1], on: false }
    expect(scheduleChanged(SAVED, off)).toBe(true)
  })
})

describe("the next text (same order as the job)", () => {
  it("never sent first, then the oldest send, then sort_order, then id", () => {
    expect(
      nextTextId([
        text({ id: "a", last_sent_at: "2026-10-01T06:00:00Z", sort_order: 1 }),
        text({ id: "b", last_sent_at: null, sort_order: 3 }),
        text({ id: "c", last_sent_at: null, sort_order: 2 }),
      ])
    ).toBe("c")
    expect(
      nextTextId([
        text({ id: "a", last_sent_at: "2026-10-05T06:00:00Z" }),
        text({ id: "b", last_sent_at: "2026-10-01T06:00:00Z" }),
      ])
    ).toBe("b")
    expect(
      nextTextId([
        text({ id: "b", sort_order: 1 }),
        text({ id: "a", sort_order: 1 }),
      ])
    ).toBe("a")
  })

  it("skips inactive texts; none active: null", () => {
    expect(
      nextTextId([
        text({ id: "a", active: false }),
        text({ id: "b", last_sent_at: "2026-10-01T06:00:00Z" }),
      ])
    ).toBe("b")
    expect(nextTextId([text({ active: false })])).toBeNull()
    expect(nextTextId([])).toBeNull()
  })
})

describe("text checks", () => {
  it("trims spaces, tabs, line breaks and no-break spaces", () => {
    expect(trimText("\u00A0\t טקסט \n")).toBe("טקסט")
  })

  it("empty, too long, or fine (code points)", () => {
    expect(textProblem(" \n\u00A0")).toBe("empty")
    expect(textProblem("א".repeat(500))).toBeNull()
    expect(textProblem("א".repeat(501))).toBe("long")
    expect(textProblem("😀".repeat(500))).toBeNull()
  })
})
