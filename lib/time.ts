// Display only (AD-8). Every business time (closing, deadlines, validity) is
// computed in SQL; this file formats what the server returned, always in
// Asia/Jerusalem, never by the browser's clock or time zone.
//
// Formats (DESIGN.md › Typography, EXPERIENCE.md › dates):
//   visible:          "יום שני 12.10 · 10:00"
//   screen reader:    "יום שני, 12 באוקטובר, 10:00"
//   <time datetime>:  "2026-10-12"

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
