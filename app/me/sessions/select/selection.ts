import type { StatusTone } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { nonEmptyText } from "@/lib/form-values"

import { sessionStatus, type Availability } from "../session-status"

// Several dates with a card (story 3.3): preview_book_sessions' and
// book_sessions' jsonb as the selection screen uses them. Display only: the
// server decided every value (which date she can book, the funding, the
// deadlines, what was saved).

export type DatePreview = {
  ok: boolean
  code: ErrorCode | null
  productName: string | null
  cancelDeadline: string | null
}

export type SelectionPreview = {
  available: number
  dates: Map<string, DatePreview>
}

export type DateResult = {
  eventId: string
  ok: boolean
  code: ErrorCode | null
  bookingId: string | null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function code(value: unknown, ok: boolean): ErrorCode | null {
  if (ok) return null
  return isErrorCode(value) ? value : "SERVER_ERROR"
}

/**
 * preview_book_sessions' jsonb. A date is ok only with a product name; a
 * malformed row is left out (not choosable); a missing or bad available is 0.
 */
export function parseSelectionPreview(data: unknown): SelectionPreview {
  const row = record(data)
  const available =
    Number.isSafeInteger(row.available) && (row.available as number) > 0
      ? (row.available as number)
      : 0
  const dates = new Map<string, DatePreview>()
  if (Array.isArray(row.results)) {
    for (const item of row.results) {
      const r = record(item)
      const eventId = nonEmptyText(r.event_id)
      if (!eventId || typeof r.ok !== "boolean") continue
      const productName = nonEmptyText(r.product_name)
      const ok = r.ok && productName !== null
      dates.set(eventId, {
        ok,
        code: ok ? null : code(r.code, false),
        productName,
        cancelDeadline: nonEmptyText(r.cancel_deadline),
      })
    }
  }
  return { available, dates }
}

/**
 * book_sessions' jsonb ({results: [...]}), or null when it is malformed (the
 * screen then shows a server error and reads the page again).
 */
export function parseBookResults(data: unknown): DateResult[] | null {
  const results = record(data).results
  if (!Array.isArray(results) || results.length === 0) return null
  const parsed: DateResult[] = []
  for (const item of results) {
    const r = record(item)
    const eventId = nonEmptyText(r.event_id)
    if (!eventId || typeof r.ok !== "boolean") return null
    const bookingId = nonEmptyText(r.booking_id)
    if (r.ok && !bookingId) return null
    parsed.push({
      eventId,
      ok: r.ok,
      code: code(r.code, r.ok),
      bookingId: r.ok ? bookingId : null,
    })
  }
  return parsed
}

/** The short reason shown in a row that cannot be chosen. */
export function unavailableReason(code: ErrorCode | null): string {
  const reasons = customerCopy.unavailableReason
  switch (code) {
    case "ALREADY_BOOKED":
    case "REGISTRATION_CLOSED":
    case "EVENT_FULL":
    case "ENTITLEMENT_EXPIRED_ON_DATE":
      return reasons[code]
    default:
      return reasons.other
  }
}

/** A row of the selection screen, built on the server by selectableRows. */
export type SelectableSession = {
  id: string
  conceptName: string
  startsAt: string
  ok: boolean
  code: ErrorCode | null
  productName: string | null
  cancelDeadline: string | null
  // The availability chip of a date she can choose (never a number).
  status: { tone: StatusTone; text: string } | null
}

/**
 * The page's rows: a session missing from the preview is not choosable
 * (EVENT_NOT_BOOKABLE); a blocked row has no chip.
 */
export function selectableRows(
  sessions: readonly { id: string; concept_name: string; starts_at: string }[],
  preview: SelectionPreview,
  availability: ReadonlyMap<string, Availability>
): SelectableSession[] {
  return sessions.map((session) => {
    const date = preview.dates.get(session.id)
    const ok = date?.ok === true
    return {
      id: session.id,
      conceptName: session.concept_name,
      startsAt: session.starts_at,
      ok,
      code: ok ? null : (date?.code ?? "EVENT_NOT_BOOKABLE"),
      productName: date?.productName ?? null,
      cancelDeadline: date?.cancelDeadline ?? null,
      status: ok
        ? sessionStatus({
            booked: false,
            availability: availability.get(session.id),
          })
        : null,
    }
  })
}

/** "לבחור כמה תאריכים" is offered from 2 available entries. */
export function showsSelectEntry(available: number): boolean {
  return available >= 2
}

/**
 * A click on a row: a chosen row is always unchosen; another row is chosen
 * only when it can be chosen and fewer than `available` are chosen.
 */
export function toggleSelection(
  current: readonly string[],
  id: string,
  available: number,
  choosable = true
): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id)
  if (!choosable || current.length >= available) return [...current]
  return [...current, id]
}

/**
 * After the page was read again: only ids whose row can still be chosen, in
 * the order they were chosen, at most `available`.
 */
export function pruneSelection(
  current: readonly string[],
  sessions: readonly { id: string; ok: boolean }[],
  available: number
): string[] {
  const ok = new Set(sessions.filter((s) => s.ok).map((s) => s.id))
  return current.filter((id) => ok.has(id)).slice(0, Math.max(available, 0))
}

/** The results' heading: all saved, some, or none. */
export function resultsHeading(results: readonly { ok: boolean }[]): string {
  const saved = results.filter((r) => r.ok).length
  if (saved === results.length) return customerCopy.climax
  if (saved === 0) return customerCopy.savedNone
  return customerCopy.savedSome(saved, results.length)
}

/**
 * "What will be used", grouped by product in the order of the dates: one
 * line per product with its number of entries. Display only (the server
 * picks the funding of each date when it books).
 */
export function usesByProduct(
  productNames: readonly (string | null)[]
): Array<{ product: string; count: number }> {
  const groups: Array<{ product: string; count: number }> = []
  for (const product of productNames) {
    if (!product) continue
    const group = groups.find((g) => g.product === product)
    if (group) group.count += 1
    else groups.push({ product, count: 1 })
  }
  return groups
}
