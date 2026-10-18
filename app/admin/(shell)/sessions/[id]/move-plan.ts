import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatSessionDateTime } from "@/lib/time"

import type { MoveTarget } from "@/app/me/bookings/move-result"

// preview_admin_move_booking's jsonb (story 3.10) has the customer's
// preview's shape plus customer_name and within_window, so it is read by
// the same parser (AD-7: every value is the server's plan).
export {
  parseMovePlan,
  type MovePlan,
  type MoveTarget,
} from "@/app/me/bookings/move-result"

import type { MovePlan } from "@/app/me/bookings/move-result"

// Tal's plan also carries the booking's cancel window (its policy_snapshot),
// for the "within the window" line; null when it cannot be read.
export type AdminMovePlan = MovePlan & { cancelWindowHours?: number | null }

/** A target as a radio-card in Tal's dialog. */
export function moveTargetOption(target: MoveTarget): {
  value: string
  label: string
  description: string
} {
  const copy = adminCopy.sessions
  return {
    value: target.eventId,
    label: formatSessionDateTime(target.startsAt),
    description: [
      copy.sessionTitle(target.conceptName),
      ...(target.outsideOptions ? [copy.move.outsideOptions] : []),
    ].join(" · "),
  }
}

// The codes a move can be refused with that need Tal's own wording (the
// customer's copy adds the contact phrase "צרי קשר").
export const MOVE_REFUSAL_CODES = [
  "MANUAL_HANDLING_REQUIRED",
  "ALREADY_BOOKED",
  "MOVE_TARGET_NOT_ALLOWED",
  "BOOKING_NOT_MOVABLE",
  "EVENT_ENDED",
  "EVENT_FULL",
  "ENTITLEMENT_EXPIRED_ON_DATE",
  "NO_MATCHING_ENTITLEMENT",
  "CONCURRENT_CHANGE",
] as const satisfies readonly ErrorCode[]

/** A refusal of the move, worded for Tal; any other code keeps errorMessage. */
export function moveRefusal(code: ErrorCode): string {
  return adminCopy.sessions.moveRefusal[code] ?? errorMessage(code)
}
