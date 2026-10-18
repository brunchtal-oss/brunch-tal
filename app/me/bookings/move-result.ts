// What the move screens show (story 3.10), from the RPCs' jsonb (pure: data
// in, values out). Every decision (whether she may move, the funding, which
// sessions she may move to) comes from the server; nothing is computed from
// a clock here (AD-8).

import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, isErrorCode, type ErrorCode } from "@/lib/errors"
import { nonEmptyText } from "@/lib/form-values"

import { parseFunding, type Funding } from "./cancel-result"

// One session the booking may move to. outsideOptions: (Tal only) the
// session is not one of the credit's options.
export type MoveTarget = {
  eventId: string
  startsAt: string
  conceptName: string
  outsideOptions: boolean
}

export type MovePlan =
  | {
      ok: true
      funding: Funding
      // The customer's preview: whether she may still move it herself.
      canMove: boolean
      // Tal's preview: the customer's name and whether the booking is
      // inside the self-cancel window.
      customerName: string | null
      withinWindow: boolean
      targets: MoveTarget[]
    }
  | { ok: false; code: ErrorCode }

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseTargets(value: unknown): MoveTarget[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): MoveTarget[] => {
    const r = record(raw)
    const eventId = nonEmptyText(r.event_id)
    const startsAt = nonEmptyText(r.starts_at)
    if (!eventId || !startsAt) return []
    return [
      {
        eventId,
        startsAt,
        conceptName: typeof r.concept_name === "string" ? r.concept_name : "",
        outsideOptions: r.outside_options === true,
      },
    ]
  })
}

/** preview_move_booking's or preview_admin_move_booking's jsonb. */
export function parseMovePlan(data: unknown): MovePlan {
  const row = record(data)
  if (row.ok !== true) {
    return {
      ok: false,
      code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
    }
  }
  return {
    ok: true,
    funding: parseFunding(row.funding),
    canMove: row.can_move === true,
    customerName: nonEmptyText(row.customer_name),
    withinWindow: row.within_window === true,
    targets: parseTargets(row.targets),
  }
}

// move_booking's and admin_move_booking's result: the new booking.
export type MoveResult = { bookingId: string; fromBookingId: string }

export function parseMoveResult(data: unknown): MoveResult | null {
  const row = record(data)
  const bookingId = nonEmptyText(row.booking_id)
  const fromBookingId = nonEmptyText(row.from_booking_id)
  return bookingId && fromBookingId ? { bookingId, fromBookingId } : null
}

/** "כן, להזיז" waits for a session to be chosen. */
export function moveConfirmBlocked(target: string | null): boolean {
  return target === null
}

/**
 * The reason a move was refused, in move wording: past the window the same
 * closed notice as the buttons', a booking funded from two kinds of entry
 * its own line (both followed by the contact phrase, see
 * moveNeedsContact); any other code its shared message.
 */
export function moveErrorText(
  code: ErrorCode,
  cancelWindowHours: number | null
): string {
  if (code === "SELF_CANCEL_CLOSED") {
    return customerCopy.cancel.closed(cancelWindowHours)
  }
  if (code === "MANUAL_HANDLING_REQUIRED") return customerCopy.move.manual
  return errorMessage(code)
}

/** Whether a refusal of the move shows the contact phrase ("ליצירת קשר"). */
export function moveNeedsContact(code: ErrorCode | null): boolean {
  return code === "SELF_CANCEL_CLOSED" || code === "MANUAL_HANDLING_REQUIRED"
}

/**
 * A tap on "הזזה למועד אחר" (or on the cancel): past the self-cancel window
 * it only shows the closed notice and calls no RPC; otherwise it reads the
 * sessions she may move to.
 */
export function moveTapAction(canSelfCancel: boolean): "closed" | "preview" {
  return canSelfCancel ? "preview" : "closed"
}
