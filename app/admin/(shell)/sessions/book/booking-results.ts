import { adminCopy } from "@/lib/copy/admin"
import type { ErrorCode } from "@/lib/errors"
import { formatDayMonth } from "@/lib/time"

import { refusalMessage, type BookPreview } from "../[id]/book/preview"

// Several sessions for one customer (story 4.3, user decision 2026-10-13):
// what the bar, the sheet and the results say. Pure. Display only: each
// date is decided again by admin_book_customer when it is booked.

const copy = adminCopy.sessions

// The most dates booked at once (the Server Action refuses more).
export const MAX_SESSIONS = 20

// How many dates can be ticked: her free entries, never above 20.
export function selectionCap(freeEntries: number): number {
  return Math.min(Math.max(freeEntries, 0), MAX_SESSIONS)
}

// One date in the sheet: what funds it, or why it is refused (the existing
// preview_admin_book_customer result).
export function previewLine(preview: BookPreview): {
  ok: boolean
  text: string
} {
  if (!preview.ok) return { ok: false, text: refusalMessage(preview.code) }
  return {
    ok: true,
    text:
      preview.source === "credit" || preview.expiresOn === null
        ? copy.willUseCredit(preview.productName)
        : copy.willUse(preview.productName, formatDayMonth(preview.expiresOn)),
  }
}

export type ResultItem = {
  eventId: string
  ok: boolean
  status: string
  // The refusal, worded for Tal; null for a saved date.
  reason: string | null
}

export function resultItems(
  results: readonly { eventId: string; ok: boolean; code: ErrorCode | null }[]
): ResultItem[] {
  return results.map((r) => ({
    eventId: r.eventId,
    ok: r.ok,
    status: r.ok ? copy.bookMany.saved : copy.bookMany.notSaved,
    reason: r.ok ? null : refusalMessage(r.code ?? "SERVER_ERROR"),
  }))
}

// "נרשמה ל-{k} מתוך {n}".
export function resultsHeading(results: readonly { ok: boolean }[]): string {
  return copy.bookMany.resultsHeading(
    results.filter((r) => r.ok).length,
    results.length
  )
}
