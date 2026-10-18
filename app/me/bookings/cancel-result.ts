// What the cancel screens show (stories 3.6, 3.7), from the RPCs' jsonb
// (pure: data in, values out). Every decision (can_self_cancel, the
// funding, the outcome) comes from the server; nothing is computed from a
// clock here (AD-8).

import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth } from "@/lib/time"

import { isExhaustedCredit, type MyCredit } from "./credits"

// How a booking was funded: a card (a 3.6 returned entry too), a pinned
// purchase of this session (she chooses refund or credit), or a
// cancellation credit (the same credit comes back).
export type Funding = "card" | "pinned" | "credit"

const FUNDINGS: readonly Funding[] = ["card", "pinned", "credit"]

export function parseFunding(value: unknown): Funding {
  return FUNDINGS.find((f) => f === value) ?? "card"
}

// The choice of a pinned booking (story 3.7).
export type CancelChoice = "credit" | "refund"

// cancel_booking's result.
export type CancelResult = {
  outcome: "card" | "credit" | "refund"
}

export function parseCancelResult(data: unknown): CancelResult {
  const row =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  return {
    outcome:
      row.outcome === "credit" || row.outcome === "refund"
        ? row.outcome
        : "card",
  }
}

/** The success notice after a cancel. */
export function cancelDoneMessage(result: CancelResult): string {
  const copy = customerCopy.cancel
  if (result.outcome === "credit") return copy.doneCredit
  if (result.outcome === "refund") return copy.doneRefund
  return copy.doneCard
}

/**
 * "What returns" in the cancel sheet, for a booking without a choice: a
 * card's entry, or the same credit. A pinned booking shows the choice
 * instead (null).
 */
export function returnsText(
  funding: Funding,
  productName: string
): string | null {
  const copy = customerCopy.cancel
  if (funding === "pinned") return null
  if (funding === "credit") return copy.returnsCredit
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
  // Story 3.5: adults on the booking (2 = couple) and the companion's
  // dietary note; editable is the server's decision (confirmed, couple,
  // before the session's registration close).
  partySize: number
  guestDetails: string | null
  guestDetailsEditable: boolean
  // Story 3.10: a moved (cancelled) booking: the session it moved to.
  movedToStartsAt: string | null
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
        partySize: r.party_size === 2 ? 2 : 1,
        guestDetails:
          typeof r.guest_details === "string" && r.guest_details.trim() !== ""
            ? r.guest_details
            : null,
        guestDetailsEditable: r.guest_details_editable === true,
        movedToStartsAt:
          typeof r.moved_to_starts_at === "string" && r.moved_to_starts_at
            ? r.moved_to_starts_at
            : null,
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

/**
 * The word of a past booking: moved to another session (story 3.10),
 * cancelled, or it took place.
 */
export function pastBookingStatus(
  status: string,
  movedToStartsAt: string | null = null
): string {
  if (status === "cancelled" && movedToStartsAt) {
    return customerCopy.bookingMoved(formatDayMonth(movedToStartsAt))
  }
  return status === "cancelled"
    ? customerCopy.bookingCancelled
    : customerCopy.bookingHeld
}

/** A confirmed couple booking: it shows the companion's note (story 3.5). */
export function isCoupleBooking(b: Pick<MyBooking, "partySize" | "status">) {
  return b.partySize === 2 && b.status === "confirmed"
}

/**
 * Whether /me/bookings needs the contact link (WhatsApp): an exhausted
 * credit (story 3.7), or a couple booking whose note can no longer be
 * changed (story 3.5).
 */
export function needsContact(
  credits: MyCredit[],
  upcoming: MyBooking[]
): boolean {
  return (
    credits.some(isExhaustedCredit) ||
    upcoming.some((b) => isCoupleBooking(b) && !b.guestDetailsEditable)
  )
}
