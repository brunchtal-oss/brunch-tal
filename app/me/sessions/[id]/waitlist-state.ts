import type { BookingPreview } from "./booking-preview"

// What the session page shows under the booking panel for the waitlist
// (story 5.6). Display only: join_waitlist and leave_waitlist check again.
// - offer: the preview says full (EVENT_FULL) and she has no active entry.
// - waiting: she has an active entry (any preview but her own booking, a
//   cancelled or a completed session); taken when she came from the
//   waitlist_spot notification (?from=waitlist) and it is still full.
// - none: nothing to show; also once the registration closed (the server
//   then sends nothing and her list leaves the session out).
export type WaitlistState =
  { kind: "none" } | { kind: "offer" } | { kind: "waiting"; taken: boolean }

export function waitlistState({
  preview,
  waiting,
  fromWaitlist,
}: {
  preview: BookingPreview
  waiting: boolean
  fromWaitlist: boolean
}): WaitlistState {
  if (
    preview.kind === "booked" ||
    preview.kind === "cancelled" ||
    preview.kind === "completed" ||
    (preview.kind === "blocked" && preview.code === "REGISTRATION_CLOSED")
  ) {
    return { kind: "none" }
  }
  const full = preview.kind === "blocked" && preview.code === "EVENT_FULL"
  if (waiting) return { kind: "waiting", taken: fromWaitlist && full }
  return full ? { kind: "offer" } : { kind: "none" }
}

// The session is full and the waitlist panel shows it (offer or waiting):
// the page leaves out the booking panel's own full notice, and the waitlist
// panel ends with the link to all sessions.
export function waitlistShowsFull(
  preview: BookingPreview,
  state: WaitlistState
): boolean {
  return (
    state.kind !== "none" &&
    preview.kind === "blocked" &&
    preview.code === "EVENT_FULL"
  )
}
