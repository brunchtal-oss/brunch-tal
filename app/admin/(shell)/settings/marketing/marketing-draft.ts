// The marketing reminders screen (story 5.11), pure: the schedule draft
// (one row per weekday, 0 = Sunday), the slots it saves, and which text is
// next in the rotation. The server decides again (admin_update_business_
// settings, private.job_marketing_reminders); this only shapes the screen.

export type ScheduleSlot = { weekday: number; time: string }

export type ScheduleDay = { on: boolean; time: string }

export type ScheduleDraft = ScheduleDay[]

export type MarketingText = {
  id: string
  body: string
  active: boolean
  sort_order: number
  last_sent_at: string | null
  version: number
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

// The time a day gets when it is checked without one.
export const DEFAULT_TIME = "09:00"

// The longest text the RPC accepts (after trimming).
export const MAX_TEXT = 500

const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

// A saved value as the schedule: anything that is not a valid slot is
// skipped (the server only stores valid ones).
export function parseSchedule(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((slot): ScheduleSlot[] => {
    if (typeof slot !== "object" || slot === null) return []
    const { weekday, time } = slot as { weekday?: unknown; time?: unknown }
    if (
      typeof weekday !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      typeof time !== "string" ||
      !CLOCK.test(time)
    ) {
      return []
    }
    return [{ weekday, time }]
  })
}

// Seven rows, Sunday first: checked with its time when saved, else
// unchecked with the default time (shown once she checks it).
export function draftFromSchedule(
  schedule: readonly ScheduleSlot[]
): ScheduleDraft {
  return WEEKDAYS.map((weekday) => {
    const slot = schedule.find((s) => s.weekday === weekday)
    return slot
      ? { on: true, time: slot.time }
      : { on: false, time: DEFAULT_TIME }
  })
}

// A checked day whose time is not "HH:MM".
export function dayProblem(day: ScheduleDay): boolean {
  return day.on && !CLOCK.test(day.time)
}

// The slots to save, sorted by weekday, or null while a checked day has no
// valid time.
export function scheduleFromDraft(
  draft: readonly ScheduleDay[]
): ScheduleSlot[] | null {
  if (draft.some(dayProblem)) return null
  return draft.flatMap((day, weekday) =>
    day.on ? [{ weekday, time: day.time }] : []
  )
}

// Whether the draft differs from the saved schedule.
export function scheduleChanged(
  saved: readonly ScheduleSlot[],
  draft: readonly ScheduleDay[]
): boolean {
  const next = scheduleFromDraft(draft)
  if (next === null) return true
  const sorted = [...saved].sort((a, b) => a.weekday - b.weekday)
  return JSON.stringify(next) !== JSON.stringify(sorted)
}

// The text the job sends next: the active one sent longest ago (never sent
// first), then sort_order, then id; null when none is active. The same
// order as private.job_marketing_reminders.
export function nextTextId(texts: readonly MarketingText[]): string | null {
  const active = texts.filter((t) => t.active)
  if (active.length === 0) return null
  const sorted = [...active].sort((a, b) => {
    if (a.last_sent_at !== b.last_sent_at) {
      if (a.last_sent_at === null) return -1
      if (b.last_sent_at === null) return 1
      const diff = Date.parse(a.last_sent_at) - Date.parse(b.last_sent_at)
      if (diff !== 0) return diff
    }
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted[0].id
}

// Like the RPC: spaces, tabs, line breaks and no-break spaces at either end
// do not count.
export function trimText(body: string): string {
  return body.replace(/^[ \t\r\n\u00A0]+|[ \t\r\n\u00A0]+$/g, "")
}

// Why a text cannot be saved, or null: "empty" or "long" (code points, like
// char_length in the RPC).
export function textProblem(body: string): "empty" | "long" | null {
  const length = [...trimText(body)].length
  if (length === 0) return "empty"
  if (length > MAX_TEXT) return "long"
  return null
}
