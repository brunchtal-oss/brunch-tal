import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  cardDays,
  dayHeading,
  dayLabel,
  itemLines,
  itemLinesProblem,
  movedIds,
  nextPrepDay,
  parseWorkSheet,
  tableAttendees,
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
    expect(sheet.addableDays).toEqual([
      { offset: -2, date: "2026-10-20", added: false },
    ])
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
    expect(dayHeading({ offset: -1, date: "2026-10-21", added: false })).toBe(
      "ד׳ 21.10 · יום לפני"
    )
    expect(dayHeading({ offset: 0, date: "2026-10-19", added: false })).toBe(
      "ב׳ 19.10 · יום המפגש"
    )
    // An added day: only its weekday and date (round 2).
    expect(dayHeading({ offset: -2, date: "2026-10-20", added: true })).toBe(
      "ג׳ 20.10"
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
    // An added day is in every card, even without this dish's tasks.
    const added = parseWorkSheet({
      ...RAW,
      prep_days: [
        ...RAW.prep_days,
        { offset: -3, date: "2026-10-19", added: true },
      ],
    })
    expect(
      cardDays(added.dishes[1], added.prepDays).map((d) => d.offset)
    ).toEqual([-3])
    expect(
      cardDays(added.dishes[0], added.prepDays).map((d) => d.offset)
    ).toEqual([-3, -1])
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

describe("the prep days of round 2 (story 4.10)", () => {
  it("parses added; a day without the flag is a base day", () => {
    const sheet = parseWorkSheet({
      ...RAW,
      prep_days: [
        { offset: -3, date: "2026-10-19", added: true },
        { offset: -1, date: "2026-10-21", added: false },
        { offset: 0, date: "2026-10-22" },
      ],
    })
    expect(sheet.prepDays.map((d) => [d.offset, d.added])).toEqual([
      [-3, true],
      [-1, false],
      [0, false],
    ])
  })

  it("+ יום הכנה adds the day before the earliest; with -6 taken, the free day closest to the session; none when all are taken", () => {
    const day = (offset: number, date: string) => ({
      offset,
      date,
      added: false,
    })
    const addable = [
      day(-6, "2026-10-16"),
      day(-3, "2026-10-19"),
      day(-2, "2026-10-20"),
    ]
    expect(
      nextPrepDay([day(-1, "2026-10-21"), day(0, "2026-10-22")], addable)
    ).toEqual(day(-2, "2026-10-20"))
    // A gap: -2 was moved to -6, so -5..-2 are free; the closest is -2.
    expect(
      nextPrepDay(
        [day(-6, "2026-10-16"), day(-1, "2026-10-21"), day(0, "2026-10-22")],
        [
          day(-5, "2026-10-17"),
          day(-4, "2026-10-18"),
          day(-3, "2026-10-19"),
          day(-2, "2026-10-20"),
        ]
      )
    ).toEqual(day(-2, "2026-10-20"))
    expect(
      nextPrepDay([day(-6, "2026-10-16"), day(0, "2026-10-22")], [])
    ).toBeNull()
  })
})

describe("the lines of + פריט (story 4.10, round 2)", () => {
  it("one item per line, trimmed; empty lines do not count", () => {
    expect(itemLines("פטה כבשים\nעגבניות\n\n  \nלחם ")).toEqual([
      "פטה כבשים",
      "עגבניות",
      "לחם",
    ])
    expect(itemLines("a\r\nb")).toEqual(["a", "b"])
    expect(itemLines(" \n ")).toEqual([])
  })

  it("more than 100 lines or a line over 200 characters is a problem", () => {
    const copy = adminCopy.work
    expect(itemLinesProblem(["a", "b"])).toBeNull()
    expect(itemLinesProblem(Array.from({ length: 100 }, () => "a"))).toBeNull()
    expect(itemLinesProblem(Array.from({ length: 101 }, () => "a"))).toBe(
      copy.itemsTooMany(100)
    )
    expect(itemLinesProblem(["a", "x".repeat(201)])).toBe(copy.itemTooLong(200))
  })
})

describe("the shopping list's data (story 4.10)", () => {
  it("parses shopping in the server's order; a blank quantity is null", () => {
    const sheet = parseWorkSheet({
      ...RAW,
      shopping: [
        { id: "s1", body: "פטה כבשים", quantity: "1 ק״ג", bought: true },
        { id: "s2", body: "עגבניות שרי", quantity: null, bought: false },
        { id: "s3", body: "לימונים", quantity: "  ", bought: false },
        { id: "s4", body: "לחם", quantity: " 2 ", bought: false },
      ],
    })
    expect(sheet.shopping).toEqual([
      { id: "s1", body: "פטה כבשים", quantity: "1 ק״ג", bought: true },
      { id: "s2", body: "עגבניות שרי", quantity: null, bought: false },
      { id: "s3", body: "לימונים", quantity: null, bought: false },
      { id: "s4", body: "לחם", quantity: "2", bought: false },
    ])
    expect(parseWorkSheet(RAW).shopping).toEqual([])
  })
})

describe("the bookings handed to the client (story 4.10)", () => {
  it("drops the phone and keeps what the table shows", () => {
    const [a] = tableAttendees([
      {
        bookingId: "b",
        partySize: 2,
        pendingJoin: false,
        payerLabel: null,
        name: "דנה",
        phone: "050-123-4567",
        dietaryNotes: "ללא גלוטן",
        guestDetails: "צמחונית",
        photoConsent: true,
        babies: [{ name: "עומר", birthDate: "2026-06-15" }],
      },
    ])
    expect(a.phone).toBeNull()
    expect(JSON.stringify(a)).not.toContain("050")
    expect(a).toMatchObject({
      name: "דנה",
      dietaryNotes: "ללא גלוטן",
      guestDetails: "צמחונית",
      photoConsent: true,
      babies: [{ name: "עומר", birthDate: "2026-06-15" }],
    })
  })
})
