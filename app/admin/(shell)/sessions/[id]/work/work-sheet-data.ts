import { adminCopy } from "@/lib/copy/admin"
import { formatShortDay } from "@/lib/time"

import type { EventStatus } from "../../session-draft"

// The work sheet's shape and its pure helpers (story 4.9): no server and no
// browser API, so both the page and the client components use it. Every
// date comes from the server (private.prep_day, AD-8); here they are only
// formatted.

const copy = adminCopy.work

export type PrepDay = { offset: number; date: string }

export type WorkTask = {
  id: string
  dayOffset: number
  body: string
  done: boolean
}

export type WorkDish = { id: string; name: string; tasks: WorkTask[] }

export type WorkSheet = {
  event: {
    id: string
    conceptName: string
    status: EventStatus
    startsAt: string
    endsAt: string
  }
  prepDays: PrepDay[]
  addableDays: PrepDay[]
  dishes: WorkDish[]
}

type RawDay = { offset: number; date: string }

type RawSheet = {
  event: {
    id: string
    concept_name: string
    status: string
    starts_at: string
    ends_at: string
  }
  prep_days: RawDay[]
  addable_days?: RawDay[]
  dishes: {
    id: string
    name: string
    tasks: { id: string; day_offset: number; body: string; done: boolean }[]
  }[]
}

const byOffset = (a: PrepDay, b: PrepDay) => a.offset - b.offset

// admin_get_work_sheet's answer, as the screen uses it.
export function parseWorkSheet(raw: unknown): WorkSheet {
  const data = raw as RawSheet
  const days = (list: RawDay[] | undefined) =>
    (list ?? []).map((d) => ({ offset: d.offset, date: d.date })).sort(byOffset)
  return {
    event: {
      id: data.event.id,
      conceptName: data.event.concept_name,
      status: data.event.status as EventStatus,
      startsAt: data.event.starts_at,
      endsAt: data.event.ends_at,
    },
    prepDays: days(data.prep_days),
    addableDays: days(data.addable_days),
    dishes: (data.dishes ?? []).map((dish) => ({
      id: dish.id,
      name: dish.name,
      tasks: (dish.tasks ?? []).map((task) => ({
        id: task.id,
        dayOffset: task.day_offset,
        body: task.body,
        done: task.done === true,
      })),
    })),
  }
}

// "יום המפגש", "יום לפני", "{n} ימים לפני".
export function dayLabel(offset: number): string {
  return copy.dayLabel(offset)
}

// "ד׳ 21.10" (the short form, everywhere on the work sheet)
export function dayDate(day: PrepDay): string {
  return formatShortDay(day.date)
}

// "ד׳ 21.10 · יום לפני"
export function dayHeading(day: PrepDay): string {
  return copy.dayHeading(dayDate(day), dayLabel(day.offset))
}

// The days a dish card shows: only the sheet's days on which this dish has
// a task (EXPERIENCE › dish-card), in the sheet's order.
export function cardDays(dish: WorkDish, prepDays: readonly PrepDay[]) {
  const used = new Set(dish.tasks.map((task) => task.dayOffset))
  return prepDays.filter((day) => used.has(day.offset))
}

// One dish's tasks of one day, in the server's order.
export function tasksOn(dish: WorkDish, offset: number): WorkTask[] {
  return dish.tasks.filter((task) => task.dayOffset === offset)
}

// How many tasks of the whole sheet are on a day (the remove-day confirm).
export function tasksOnDay(dishes: readonly WorkDish[], offset: number) {
  return dishes.reduce((n, dish) => n + tasksOn(dish, offset).length, 0)
}

// The ids in a new order after moving one item a step up (-1) or down (+1);
// null when it cannot move.
export function movedIds(
  ids: readonly string[],
  id: string,
  delta: -1 | 1
): string[] | null {
  const index = ids.indexOf(id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
