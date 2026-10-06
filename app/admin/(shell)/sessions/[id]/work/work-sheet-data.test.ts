import { describe, expect, it } from "vitest"

import {
  cardDays,
  dayHeading,
  dayLabel,
  movedIds,
  parseWorkSheet,
  tasksOnDay,
} from "./work-sheet-data"

const RAW = {
  event: {
    id: "e1",
    concept_name: "יווני",
    kind: "regular",
    status: "published",
    starts_at: "2026-10-22T07:00:00+00:00",
    ends_at: "2026-10-22T09:00:00+00:00",
  },
  prep_days: [
    { offset: 0, date: "2026-10-22" },
    { offset: -1, date: "2026-10-21" },
  ],
  addable_days: [{ offset: -2, date: "2026-10-20" }],
  dishes: [
    {
      id: "d1",
      name: "שקשוקה ירוקה",
      tasks: [
        { id: "t1", day_offset: -1, body: "לקצוץ עשבים", done: false },
        { id: "t2", day_offset: -1, body: "רוטב", done: true },
      ],
    },
    { id: "d2", name: "עוגה", tasks: [] },
  ],
}

describe("the work sheet's data (story 4.9)", () => {
  it("parses admin_get_work_sheet, the days by offset", () => {
    const sheet = parseWorkSheet(RAW)
    expect(sheet.event).toEqual({
      id: "e1",
      conceptName: "יווני",
      status: "published",
      startsAt: "2026-10-22T07:00:00+00:00",
      endsAt: "2026-10-22T09:00:00+00:00",
    })
    expect(sheet.prepDays.map((d) => d.offset)).toEqual([-1, 0])
    expect(sheet.addableDays).toEqual([{ offset: -2, date: "2026-10-20" }])
    expect(sheet.dishes[0].tasks[1]).toEqual({
      id: "t2",
      dayOffset: -1,
      body: "רוטב",
      done: true,
    })
    expect(sheet.dishes[1].tasks).toEqual([])
    expect(
      parseWorkSheet({ ...RAW, addable_days: undefined }).addableDays
    ).toEqual([])
  })

  it("names a day relative to the session", () => {
    expect(dayLabel(0)).toBe("יום המפגש")
    expect(dayLabel(-1)).toBe("יום לפני")
    expect(dayLabel(-2)).toBe("2 ימים לפני")
    expect(dayLabel(-6)).toBe("6 ימים לפני")
    expect(dayHeading({ offset: -1, date: "2026-10-21" })).toBe(
      "ד׳ 21.10 · יום לפני"
    )
    expect(dayHeading({ offset: 0, date: "2026-10-19" })).toBe(
      "ב׳ 19.10 · יום המפגש"
    )
  })

  it("shows on a dish card only the days with its tasks", () => {
    const sheet = parseWorkSheet({
      ...RAW,
      prep_days: [...RAW.prep_days, { offset: -2, date: "2026-10-20" }],
    })
    expect(
      cardDays(sheet.dishes[0], sheet.prepDays).map((d) => d.offset)
    ).toEqual([-1])
    expect(cardDays(sheet.dishes[1], sheet.prepDays)).toEqual([])
    expect(tasksOnDay(sheet.dishes, -1)).toBe(2)
    expect(tasksOnDay(sheet.dishes, -2)).toBe(0)
  })

  it("moves an id one step, or not at the ends", () => {
    expect(movedIds(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"])
    expect(movedIds(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"])
    expect(movedIds(["a", "b"], "a", -1)).toBeNull()
    expect(movedIds(["a", "b"], "b", 1)).toBeNull()
    expect(movedIds(["a"], "x", 1)).toBeNull()
  })
})
