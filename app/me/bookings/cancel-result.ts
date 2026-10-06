// What the cancel screens show (story 3.6), from the RPCs' jsonb (pure: data
// in, values out). Every decision (can_self_cancel, the funding, the new
// validity of a returned entry) comes from the server; nothing is computed
// from a clock here (AD-8).

import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth } from "@/lib/time"

// How a booking was funded: a card, a pinned purchase of this session, or a
// pinned entry that already returned once (behaves like a card).
export type Funding = "card" | "pinned" | "returned"

const FUNDINGS: readonly Funding[] = ["card", "pinned", "returned"]

export function parseFunding(value: unknown): Funding {
  return FUNDINGS.find((f) => f === value) ?? "card"
}

// cancel_booking's result.
export type CancelResult = {
  outcome: "card" | "pinned"
  expiresOn: string | null
  awaitingSessions: boolean
}

export function parseCancelResult(data: unknown): CancelResult {
  const row =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  return {
    outcome: row.outcome === "pinned" ? "pinned" : "card",
    expiresOn: typeof row.expires_on === "string" ? row.expires_on : null,
    awaitingSessions: row.awaiting_sessions === true,
  }
}

/** The success notice after a cancel. */
export function cancelDoneMessage(result: CancelResult): string {
  const copy = customerCopy.cancel
  if (result.outcome !== "pinned") return copy.doneCard
  if (result.awaitingSessions || !result.expiresOn) return copy.doneAwaiting
  return copy.donePinned(formatDayMonth(result.expiresOn))
}

/** "What returns" in the cancel sheet. */
export function returnsText(
  funding: Funding,
  productName: string,
  optionsCount: number
): string {
  const copy = customerCopy.cancel
  if (funding === "pinned") return copy.returnsPinned(optionsCount)
  if (funding === "returned") return copy.returnsReturned
  return copy.returnsCard(productName)
}

// One row of get_my_bookings.
export type MyBooking = {
  bookingId: string
  eventId: string
  status: string
  startsAt: string
  conceptName: string
  canSelfCancel: boolean
  funding: Funding
  productName: string
}

export type MyBookings = {
  upcoming: MyBooking[]
  past: MyBooking[]
  optionsCount: number
}

function parseRows(value: unknown): MyBooking[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): MyBooking[] => {
    if (!raw || typeof raw !== "object") return []
    const r = raw as Record<string, unknown>
    if (
      typeof r.booking_id !== "string" ||
      typeof r.event_id !== "string" ||
      typeof r.starts_at !== "string"
    ) {
      return []
    }
    return [
      {
        bookingId: r.booking_id,
        eventId: r.event_id,
        status: typeof r.status === "string" ? r.status : "",
        startsAt: r.starts_at,
        conceptName: typeof r.concept_name === "string" ? r.concept_name : "",
        canSelfCancel: r.can_self_cancel === true,
        funding: parseFunding(r.funding),
        productName: typeof r.product_name === "string" ? r.product_name : "",
      },
    ]
  })
}

/** get_my_bookings' jsonb; a malformed row is left out. */
export function parseMyBookings(data: unknown): MyBookings {
  const row =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  const n = row.options_count
  return {
    upcoming: parseRows(row.upcoming),
    past: parseRows(row.past),
    optionsCount: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 1,
  }
}

/** The word of a past booking: cancelled, or it took place. */
export function pastBookingStatus(status: string): string {
  return status === "cancelled"
    ? customerCopy.bookingCancelled
    : customerCopy.bookingHeld
}
