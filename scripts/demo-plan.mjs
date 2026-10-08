// Story 5.18: the pure part of the demo data (no database, no env), tested in
// test/demo-plan.test.ts. Dates are local to Asia/Jerusalem and relative to
// the anchor, the moment of the first run (kept in .demo-data.local.json), so
// a second run computes the same dates.

import { hash } from "node:crypto"

const TIME_ZONE = "Asia/Jerusalem"

// The sessions after E0, as days after the anchor (spec 5.18). A Saturday
// moves to the next day, and each session stays after the previous one.
export const SESSION_OFFSETS = [
  ["E1", 1],
  ["E2", 3],
  ["E3", 5],
  ["E4", 6],
  ["E5", 7],
  ["E6", 9],
  ["E7", 12],
]

// The expiring card ends this many days after the anchor.
export const EXPIRING_CARD_DAYS = 9

// The first run stops at or after this local time: E0 must end that day.
export const LATEST_START = "23:30"
// E0 starts at 06:00 at the earliest, before the run: an earlier run stops.
export const EARLIEST_START = "06:10"

const EARLIEST_E0_START = 6 * 60
const DEFAULT_E0_START = 10 * 60 + 30

function pad(n) {
  return String(n).padStart(2, "0")
}

// The local calendar date, time and weekday (0 = Sunday) of an instant.
export function localParts(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value])
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return {
    date,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: weekday(date),
  }
}

// YYYY-MM-DD plus n days (calendar arithmetic, no time zone).
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function hhmm(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

function toMinutes(text) {
  const [h, m] = text.split(":").map(Number)
  return h * 60 + m
}

/**
 * The dates of the demo, from the anchor (an ISO instant).
 * Returns { ok: false, reason } when the first run cannot be at this time:
 * "late" (from 23:30), "early" (before 06:10) or "saturday" (E0 is on the
 * anchor day, and there are no sessions on Saturday).
 * Otherwise { ok: true, today, e0: { date, start_time, end_time }, sessions:
 * { E1: date, ... }, expiringCardPaidOn(validityDays) }.
 *
 * @typedef {{ ok: false, reason: "late" | "early" | "saturday" }} PlanRefusal
 * @typedef {{
 *   ok: true,
 *   today: string,
 *   e0: { date: string, start_time: string, end_time: string },
 *   sessions: Record<string, string>,
 *   expiringCardPaidOn: (validityDays: number) => string,
 * }} Plan
 * @param {string} anchor
 * @returns {Plan | PlanRefusal}
 */
export function planDates(anchor) {
  const now = localParts(anchor)
  if (now.weekday === 6) return { ok: false, reason: "saturday" }
  if (now.minutes >= toMinutes(LATEST_START)) {
    return { ok: false, reason: "late" }
  }
  if (now.minutes < toMinutes(EARLIEST_START)) {
    return { ok: false, reason: "early" }
  }

  // E0: from 10:30, or from an hour before the run (rounded down to 5
  // minutes) when that is earlier, not before 06:00; it ends about 6 minutes
  // after the run (rounded up to 5), so the bookings fit before its end and
  // the completion job closes it soon after.
  const start = Math.max(
    EARLIEST_E0_START,
    Math.min(DEFAULT_E0_START, Math.floor((now.minutes - 60) / 5) * 5)
  )
  const end = Math.ceil((now.minutes + 6) / 5) * 5

  /** @type {Record<string, string>} */
  const sessions = {}
  let previous = now.date
  for (const [key, offset] of SESSION_OFFSETS) {
    let date = addDays(now.date, offset)
    if (date <= previous) date = addDays(previous, 1)
    while (weekday(date) === 6) date = addDays(date, 1)
    sessions[key] = date
    previous = date
  }

  return {
    ok: true,
    today: now.date,
    e0: { date: now.date, start_time: hhmm(start), end_time: hhmm(end) },
    sessions,
    // A card bought this day ends EXPIRING_CARD_DAYS after the anchor
    // (expires_on = paid_on + validity_days).
    expiringCardPaidOn: (validityDays) =>
      addDays(now.date, EXPIRING_CARD_DAYS - validityDays),
  }
}

/**
 * The idempotency key of one demo item: a UUID made of
 * sha256(generation + ":" + item), so the same generation repeats the same
 * keys and a new generation never meets the stored results of an old one.
 */
export function demoKey(generation, item) {
  const hex = hash("sha256", `${generation}:${item}`, "hex")
  // UUID layout, version 5 and RFC 4122 variant bits.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value)
}
