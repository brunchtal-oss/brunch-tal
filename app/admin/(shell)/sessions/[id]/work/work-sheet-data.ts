import type { Attendee } from "@/components/admin/attendee-row"
import { adminCopy } from "@/lib/copy/admin"
import { formatShortDay } from "@/lib/time"

import type { EventStatus } from "../../session-draft"

// The work sheet's shape and its pure helpers (stories 4.9, 4.10): no server
// and no browser API, so both the page and the client components use it.
// Every date comes from the server (private.prep_day, AD-8); here they are
// only formatted.

const copy = adminCopy.work

// A prep day of the sheet. added: not one of the sheet's base days (the
// defaults copied when it was made), so it can be removed or moved (story
// 4.10, round 2). The free days (addableDays) are never added days.
export type PrepDay = { offset: number; date: string; added: boolean }

export type WorkTask = {
  id: string
  dayOffset: number
  body: string
  done: boolean
}

export type WorkDish = { id: string; name: string; tasks: WorkTask[] }

// A shopping item (story 4.10); quantity is free text or null.
export type ShoppingItem = {
  id: string
  body: string
  quantity: string | null
  bought: boolean
}

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
  shopping: ShoppingItem[]
}

type RawDay = { offset: number; date: string; added?: boolean }

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
  shopping?: {
    id: string
    body: string
    quantity: string | null
    bought: boolean
  }[]
}

const byOffset = (a: PrepDay, b: PrepDay) => a.offset - b.offset

// admin_get_work_sheet's answer, as the screen uses it.
export function parseWorkSheet(raw: unknown): WorkSheet {
  const data = raw as RawSheet
  const days = (list: RawDay[] | undefined) =>
    (list ?? [])
      .map((d) => ({ offset: d.offset, date: d.date, added: d.added === true }))
      .sort(byOffset)
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
    shopping: (data.shopping ?? []).map((item) => ({
      id: item.id,
      body: item.body,
      quantity: item.quantity?.trim() || null,
      bought: item.bought === true,
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

// "ד׳ 21.10 · יום לפני" for a base day; an added day is only its weekday
// and date ("ג׳ 20.10"; user decision 2026-10-07).
export function dayHeading(day: PrepDay): string {
  if (day.added) return dayDate(day)
  return copy.dayHeading(dayDate(day), dayLabel(day.offset))
}

// The day "+ יום הכנה" adds, with its date from the server (one of
// addableDays): the day before the sheet's earliest when it is free;
// otherwise (the earliest is -6, e.g. after a move) the free day closest to
// the session. null only when every day of -6..0 is on the sheet (the
// button is disabled with the reason).
export function nextPrepDay(
  prepDays: readonly PrepDay[],
  addableDays: readonly PrepDay[]
): PrepDay | null {
  const earliest = prepDays[0]?.offset ?? 1
  const before = addableDays.find((day) => day.offset === earliest - 1)
  if (before) return before
  return [...addableDays].sort((a, b) => b.offset - a.offset)[0] ?? null
}

// The days a dish card shows, in the sheet's order: the sheet's days on
// which this dish has a task (EXPERIENCE › dish-card), and every added day,
// whose X and move live in the cards on the phone (story 4.10, second phone
// check: no days row).
export function cardDays(dish: WorkDish, prepDays: readonly PrepDay[]) {
  const used = new Set(dish.tasks.map((task) => task.dayOffset))
  return prepDays.filter((day) => day.added || used.has(day.offset))
}

// One dish's tasks of one day, in the server's order.
export function tasksOn(dish: WorkDish, offset: number): WorkTask[] {
  return dish.tasks.filter((task) => task.dayOffset === offset)
}

// How many tasks of the whole sheet are on a day (the remove-day confirm).
export function tasksOnDay(dishes: readonly WorkDish[], offset: number) {
  return dishes.reduce((n, dish) => n + tasksOn(dish, offset).length, 0)
}

// The items of "+ פריט": one per line, trimmed; empty lines do not count.
export function itemLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

// What keeps those lines from being added (the action and the RPC check
// again): more than 100 items, or a line over 200 characters. null: none.
export const MAX_ITEMS = 100
export const MAX_TEXT = 200

export function itemLinesProblem(lines: readonly string[]): string | null {
  if (lines.length > MAX_ITEMS) return copy.itemsTooMany(MAX_ITEMS)
  if (lines.some((line) => line.length > MAX_TEXT)) {
    return copy.itemTooLong(MAX_TEXT)
  }
  return null
}

// The bookings as the page hands them to the client component: only what
// the registrants table shows. The phone stays on the server (it is shown
// only in the session's details).
export function tableAttendees(attendees: readonly Attendee[]): Attendee[] {
  return attendees.map((a) => ({
    bookingId: a.bookingId,
    partySize: a.partySize,
    pendingJoin: a.pendingJoin,
    payerLabel: a.payerLabel,
    name: a.name,
    phone: null,
    dietaryNotes: a.dietaryNotes,
    guestDetails: a.guestDetails,
    photoConsent: a.photoConsent,
    babies: a.babies.map((b) => ({ name: b.name, birthDate: b.birthDate })),
  }))
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
