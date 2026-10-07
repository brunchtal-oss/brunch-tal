// Display only (AD-8). Every business time (closing, deadlines, validity) is
// computed in SQL; this file formats what the server returned, always in
// Asia/Jerusalem, never by the browser's clock or time zone.
//
// Formats (DESIGN.md › Typography, EXPERIENCE.md › dates):
//   visible:          "יום שני 12.10 · 10:00"
//   screen reader:    "יום שני, 12 באוקטובר, 10:00"
//   <time datetime>:  "2026-10-12"

import { shellCopy } from "./copy/shell"

export const TIME_ZONE = "Asia/Jerusalem"

export type DateInput = Date | string

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
// An instant string must carry its zone; without one JS would read it in the
// host's time zone.
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

// A plain "YYYY-MM-DD" (a SQL `date`) is a local calendar day, not an instant.
// Reading it at noon UTC keeps the same calendar day in Jerusalem (UTC+2/+3).
function toInstant(value: DateInput): Date {
  if (
    typeof value === "string" &&
    !PLAIN_DATE.test(value) &&
    !EXPLICIT_ZONE.test(value)
  ) {
    throw new RangeError(`Date string without a time zone: ${value}`)
  }
  const date =
    typeof value === "string"
      ? new Date(PLAIN_DATE.test(value) ? `${value}T12:00:00Z` : value)
      : new Date(value.getTime())
  const invalid =
    Number.isNaN(date.getTime()) ||
    (typeof value === "string" &&
      PLAIN_DATE.test(value) &&
      date.toISOString().slice(0, 10) !== value)
  if (invalid) throw new RangeError(`Invalid date: ${String(value)}`)
  return date
}

function parts(
  value: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    ...options,
  })
  const result: Record<string, string> = {}
  for (const part of formatter.formatToParts(toInstant(value))) {
    if (part.type !== "literal") result[part.type] = part.value
  }
  return result
}

/** "12.10" */
export function formatDayMonth(value: DateInput): string {
  const { day, month } = parts(value, "he-IL", {
    day: "2-digit",
    month: "2-digit",
  })
  return `${day}.${month}`
}

/** "10:00" (24-hour clock) */
export function formatTime(value: DateInput): string {
  const { hour, minute } = parts(value, "he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  return `${hour}:${minute}`
}

/** "יום שני" */
export function formatWeekday(value: DateInput): string {
  return parts(value, "he-IL", { weekday: "long" }).weekday
}

/** "ב׳ 12.10": the weekday letter and DD.MM (the work sheet's days). */
export function formatShortDay(value: DateInput): string {
  const { weekday } = parts(value, "he-IL", { weekday: "narrow" })
  return `${weekday} ${formatDayMonth(value)}`
}

/** "יום שני 12.10 · 10:00" */
export function formatSessionDateTime(value: DateInput): string {
  return `${formatWeekday(value)} ${formatDayMonth(value)} · ${formatTime(value)}`
}

/** "יום שני, 12 באוקטובר, 10:00" - the full text for screen readers. */
export function formatAccessibleDateTime(value: DateInput): string {
  const { day, month } = parts(value, "he-IL", {
    day: "numeric",
    month: "long",
  })
  return `${formatWeekday(value)}, ${day} ב${month}, ${formatTime(value)}`
}

/** "אוקטובר 2026" (the month and year of a date, e.g. a period start) */
export function formatMonthYear(value: DateInput): string {
  const { month, year } = parts(value, "he-IL", {
    month: "long",
    year: "numeric",
  })
  return `${month} ${year}`
}

/**
 * "YYYY-MM-DD": the Jerusalem calendar day of an instant, for
 * `<time datetime>`. A plain SQL date is returned as is, never shifted.
 */
export function formatLocalDate(value: DateInput): string {
  if (typeof value === "string" && PLAIN_DATE.test(value)) {
    toInstant(value)
    return value
  }
  const { year, month, day } = parts(value, "en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return `${year}-${month}-${day}`
}

/**
 * The name of a weekday by its index (0 = Sunday, as in
 * products.allowed_weekdays): "יום ראשון". 2026-01-04 is a Sunday.
 */
export function formatWeekdayIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 6) {
    throw new RangeError(`Invalid weekday index: ${index}`)
  }
  return formatWeekday(`2026-01-${String(4 + index).padStart(2, "0")}`)
}

/** "05.07.2026": a plain SQL date (a birth date) with its year. */
export function formatFullDate(value: DateInput): string {
  const [year, month, day] = formatLocalDate(value).split("-")
  return `${day}.${month}.${year}`
}

/** "05.10.26": a day with a two-digit year (the customers list, story 4.2). */
export function formatShortDate(value: DateInput): string {
  const [year, month, day] = formatLocalDate(value).split("-")
  return `${day}.${month}.${year.slice(-2)}`
}

/** The Jerusalem calendar day now ("YYYY-MM-DD"), for display only. */
export function localToday(): string {
  return formatLocalDate(new Date())
}

// A baby's age: newborn (under a week), whole weeks, or years and months.
export type BabyAge =
  { newborn: true } | { weeks: number } | { years: number; months: number }

/**
 * A baby's age on a local day, for display only (AD-8): from two plain
 * local dates ("YYYY-MM-DD"), never stored. Under a week: newborn; under a
 * whole calendar month: whole weeks; then whole calendar months as years and
 * months (31.01 to 28.02 is not a month yet). null for a birth after the day
 * or a bad date. The wording is babyAgeText (lib/copy/baby-age.ts).
 */
export function babyAge(birthDate: string, onDay: string): BabyAge | null {
  const birth = parsePlainDate(birthDate)
  const day = parsePlainDate(onDay)
  if (!birth || !day || birth.utc > day.utc) return null
  let months = (day.year - birth.year) * 12 + (day.month - birth.month)
  if (day.day < birth.day) months -= 1
  if (months >= 1) {
    return { years: Math.floor(months / 12), months: months % 12 }
  }
  const days = Math.round((day.utc - birth.utc) / 86_400_000)
  if (days < 7) return { newborn: true }
  return { weeks: Math.floor(days / 7) }
}

/** A real calendar day "YYYY-MM-DD" (not 2026-02-30). Shape only. */
export function isPlainDate(value: string): boolean {
  return parsePlainDate(value) !== null
}

function parsePlainDate(date: string) {
  if (!PLAIN_DATE.test(date)) return null
  const [year, month, day] = date.split("-").map(Number)
  const utc = Date.UTC(year, month - 1, day)
  // Rejects 2026-02-30, 2026-13-01 and the like.
  const parsed = new Date(utc)
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null
  }
  return { year, month, day, utc }
}

/**
 * A notification's time (story 5.7), by the Jerusalem calendar day:
 * "<today>, HH:MM", "<yesterday>, HH:MM", or "DD.MM" for anything older
 * (or later than now, e.g. a clock skew). The words come from shellCopy.
 * `now` is a parameter for tests.
 */
export function formatNotificationTime(
  value: DateInput,
  now: DateInput = new Date()
): string {
  const day = formatLocalDate(value)
  const today = parsePlainDate(formatLocalDate(now))!
  const yesterday = new Date(today.utc - 86_400_000).toISOString().slice(0, 10)
  const words = shellCopy.notifications.time
  if (day === formatLocalDate(now)) return words.today(formatTime(value))
  if (day === yesterday) return words.yesterday(formatTime(value))
  return formatDayMonth(value)
}
