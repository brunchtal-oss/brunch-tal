// Story 5.22: the pure part of the video data (no database, no env), tested
// in test/video-plan.test.ts. Every date is a local calendar date in
// Asia/Jerusalem, computed from the run day (the world's anchor day, kept in
// the filming admin's Auth app_metadata), so a second run on the same day
// computes the same dates and the same idempotency keys.

import { hash } from "node:crypto"

export const TIME_ZONE = "Asia/Jerusalem"

// Regular brunches only on Monday and Thursday; couple brunches only on
// Friday (user guideline 1).
export const REGULAR_WEEKDAYS = [1, 4]
export const COUPLE_WEEKDAY = 5

// H0 is the Monday 17 weeks before the run day (the inactive customer).
export const INACTIVE_WEEKS = 17

function pad(n) {
  return String(n).padStart(2, "0")
}

/**
 * The local calendar date, time (minutes after midnight) and weekday
 * (0 = Sunday) of an instant.
 *
 * @param {string | number | Date} instant
 */
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

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone). */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Sunday. */
export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/** The Sunday that starts the local week of a date (private.local_week_start). */
export function weekStart(date) {
  return addDays(date, -weekday(date))
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000
  )
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(value) {
  return (
    typeof value === "string" &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

// The first n dates strictly after `from` (step +1) or strictly before it
// (step -1) whose weekday is in `weekdays`, in the order found.
function datesFrom(from, weekdays, n, step) {
  const found = []
  let date = from
  while (found.length < n) {
    date = addDays(date, step)
    if (weekdays.includes(weekday(date))) found.push(date)
  }
  return found
}

/**
 * The temporary date of a history session: the same weekday, 1 to 7 days
 * after the run day (never today). The session is created there, filled
 * through the real RPCs, then moved back by whole weeks (DW2).
 *
 * @param {string} date the real (past) date
 * @param {string} today the run day
 * @returns {{ temp: string, weeks: number }}
 */
export function historyShift(date, today) {
  const ahead = ((weekday(date) - weekday(today) + 7) % 7) || 7
  const temp = addDays(today, ahead)
  return { temp, weeks: daysBetween(date, temp) / 7 }
}

/**
 * The dates of the video world, from the run instant.
 * U1–U8: the next 8 Mondays/Thursdays after the run day (never today).
 * F1, F2: the next 2 Fridays. H1–H4: the last 4 Mondays/Thursdays before the
 * run day, oldest first. HF: the last Friday before the run day. H0: the
 * Monday 17 weeks before the run day. temp: the temporary date and the shift
 * (weeks) of each history session. historyStart: the Sunday of H1's week, the
 * first week with a session (every later week has one up to the run day).
 *
 * @param {string | number | Date} now
 */
export function planVideoDates(now) {
  const today = localParts(now).date
  const [U1, U2, U3, U4, U5, U6, U7, U8] = datesFrom(
    today,
    REGULAR_WEEKDAYS,
    8,
    1
  )
  const [F1, F2] = datesFrom(today, [COUPLE_WEEKDAY], 2, 1)
  const [H4, H3, H2, H1] = datesFrom(today, REGULAR_WEEKDAYS, 4, -1)
  const [HF] = datesFrom(today, [COUPLE_WEEKDAY], 1, -1)
  // The Monday on or before the day 17 weeks back.
  const back = addDays(today, -7 * INACTIVE_WEEKS)
  const H0 = addDays(back, -((weekday(back) - 1 + 7) % 7))

  /** @type {Record<string, string>} */
  const sessions = { U1, U2, U3, U4, U5, U6, U7, U8, F1, F2, H1, H2, H3, H4, HF, H0 }
  /** @type {Record<string, { temp: string, weeks: number }>} */
  const temp = {}
  for (const key of ["H1", "H2", "H3", "H4", "HF", "H0"]) {
    temp[key] = historyShift(sessions[key], today)
  }
  return { today, sessions, temp, historyStart: weekStart(H1) }
}

// job_auto_extend runs every hour at minute 5 (5.10). A run in the middle
// of the seed, while the history is still on its temporary dates (almost
// the whole run), sees weeks without a session and extends every card. So
// the seed starts only at minutes 6–54: the next run is at least 10 minutes
// away.
export const AUTO_EXTEND_QUIET = { from: 55, to: 5 }

/** True when a seed must not start now (job_auto_extend runs soon). */
export function nearAutoExtend(now) {
  const minute = localParts(now).minutes % 60
  return minute >= AUTO_EXTEND_QUIET.from || minute <= AUTO_EXTEND_QUIET.to
}

export const HISTORY_KEYS = ["H1", "H2", "H3", "H4", "HF", "H0"]

export function isHistory(key) {
  return HISTORY_KEYS.includes(key)
}

/**
 * The date a purchase was paid on, from its `paid` rule:
 * { daysAgo: n } (before the run day), { historyWeek: n } (n days after the
 * Sunday of H1's week, so job_auto_extend finds a session in every week of
 * the card), { beforeEvent: n } (before the real date of its session) or
 * { expiresIn: n } (a card that ends n days after the run day: paid_on =
 * today + n - validity_days).
 *
 * @param {{ daysAgo?: number, historyWeek?: number, beforeEvent?: number, expiresIn?: number }} paid
 * @param {{ today: string, historyStart?: string | null, eventDate?: string | null, validityDays?: number | null }} ctx
 */
export function paidOnOf(paid, { today, historyStart, eventDate, validityDays }) {
  if (typeof paid.daysAgo === "number") return addDays(today, -paid.daysAgo)
  if (typeof paid.historyWeek === "number") {
    if (!historyStart) throw new Error("historyWeek needs the history start")
    return addDays(historyStart, paid.historyWeek)
  }
  if (typeof paid.beforeEvent === "number") {
    if (!eventDate) throw new Error("beforeEvent needs the session date")
    return addDays(eventDate, -paid.beforeEvent)
  }
  if (typeof paid.expiresIn === "number") {
    if (typeof validityDays !== "number") {
      throw new Error("expiresIn needs validity_days")
    }
    return addDays(today, paid.expiresIn - validityDays)
  }
  throw new Error("unknown paid rule")
}

// A stable number in [0, n) from a salt.
function spread(salt, n) {
  return parseInt(hash("sha256", String(salt), "hex").slice(0, 8), 16) % n
}

function hhmm(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/**
 * A local moment on this date, between 09:00 and 21:00, stable for the salt:
 * "YYYY-MM-DD HH:MM" (Asia/Jerusalem), the backdating target of a purchase.
 */
export function localMoment(date, salt) {
  return `${date} ${hhmm(9 * 60 + spread(salt, 12 * 60))}`
}

const MOMENT = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/

export function isMoment(value) {
  const match = typeof value === "string" ? MOMENT.exec(value) : null
  return Boolean(match && isDate(match[1]))
}

function momentMinutes(moment) {
  const [, , h, m] = MOMENT.exec(moment) ?? []
  return Number(h) * 60 + Number(m)
}

/** The join of a customer: the day of her first purchase, 30–180 minutes later (by 23:00). */
export function joinMoment(purchaseMoment, salt) {
  const date = purchaseMoment.slice(0, 10)
  const minutes = Math.min(
    23 * 60,
    momentMinutes(purchaseMoment) + 30 + spread(salt, 150)
  )
  return `${date} ${hhmm(minutes)}`
}

/**
 * A history card booking: after the purchase and before the session day
 * (one to six days before it, never before the purchase).
 */
export function historyBookingMoment(purchaseMoment, eventDate, salt) {
  const paidOn = purchaseMoment.slice(0, 10)
  let date = addDays(eventDate, -(1 + spread(`${salt}:day`, 6)))
  if (date < paidOn) date = paidOn
  if (date >= eventDate) date = paidOn
  if (date === paidOn) {
    const minutes = Math.min(23 * 60 + 30, momentMinutes(purchaseMoment) + 20)
    return `${date} ${hhmm(minutes)}`
  }
  return localMoment(date, salt)
}

/**
 * The day a session was "created": three weeks before it, or the day before
 * its first purchase when that is earlier; null when that day is not in the
 * past (the session keeps its real creation time).
 *
 * @param {string} eventDate
 * @param {string[]} paidOns
 * @param {string} today
 */
export function eventCreatedOn(eventDate, paidOns, today) {
  let day = addDays(eventDate, -21)
  for (const paidOn of paidOns) {
    if (addDays(paidOn, -1) < day) day = addDays(paidOn, -1)
  }
  return day < today ? day : null
}

/**
 * The idempotency key of one item of the world: a UUID made of
 * sha256(generation + ":" + item), so the same generation repeats the same
 * keys and a new generation never meets the stored results of an old one.
 */
export function demoKey(generation, item) {
  const hex = hash("sha256", `${generation}:${item}`, "hex")
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value)
}

/**
 * What a run does with the world anchor (the filming admin's
 * app_metadata.video_world) on this run day:
 * "new" (no anchor), "replay" (the same day: same generation and keys) or
 * "stop" (another day, or a broken anchor: video:clear, then video:seed).
 *
 * @param {unknown} anchor
 * @param {string} today
 * @returns {{ action: "new" } | { action: "replay", generation: string, complete: boolean } | { action: "stop", reason: "other_day" | "invalid" }}
 */
export function checkAnchor(anchor, today) {
  if (anchor === undefined || anchor === null) return { action: "new" }
  const a = /** @type {Record<string, unknown>} */ (anchor)
  if (
    typeof anchor !== "object" ||
    !isUuid(a.generation) ||
    !isDate(a.anchor_date) ||
    typeof a.complete !== "boolean"
  ) {
    return { action: "stop", reason: "invalid" }
  }
  if (a.anchor_date !== today) return { action: "stop", reason: "other_day" }
  return {
    action: "replay",
    generation: /** @type {string} */ (a.generation),
    complete: a.complete,
  }
}

/**
 * One step of the seed: calls fn with the item's idempotency key and
 * reports "נוצר" or "כבר קיים" (the key already had a stored result before
 * the call). State lives in memory and is rebuilt by replay.
 *
 * @param {{
 *   keyOf: (itemKey: string) => string,
 *   exists: (key: string) => Promise<boolean>,
 *   log: (message: string) => void,
 * }} deps
 */
export function createStep({ keyOf, exists, log }) {
  const counts = { created: 0, existing: 0 }
  /**
   * @template T
   * @param {string} itemKey
   * @param {string} label
   * @param {(key: string) => Promise<T | undefined> | T | undefined} fn
   * @returns {Promise<T | undefined>}
   */
  async function step(itemKey, label, fn) {
    const key = keyOf(itemKey)
    const existed = await exists(key)
    const result = await fn(key)
    if (result === undefined) return undefined
    if (existed) {
      counts.existing++
      log(`כבר קיים: ${label}`)
    } else {
      counts.created++
      log(`נוצר: ${label}`)
    }
    return result
  }
  return { step, counts }
}
