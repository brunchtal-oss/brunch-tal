// The movement log of one entitlement (story 4.12; user decision
// 2026-10-08), built from the rows RLS returned (pure: rows in, entries
// out). The purchase itself (grant) is not a row. The movements of one
// booking become ONE row, by its current state: booked (reserved, not yet
// used or released) "נרשמת", used "השתתפת", released "בוטלה"; the row
// carries the session's weekday and date and its title ("בראנץ׳
// {concept}"), never the movement's own date or units. A movement without
// a booking (opening balance, adjustment) keeps its label and its date.
// Rows go by date: a booking by its session's start, any other row by
// when it was recorded.

import { customerCopy } from "@/lib/copy/customer"
import { formatSessionDate } from "@/lib/time"

export type MovementRow = {
  id: string
  booking_id: string | null
  action: string
  units: number
  created_at: string
}

export type BookingRow = { id: string; event_id: string }

export type SessionRow = {
  id: string
  starts_at: string
  concept_name: string
}

export type BookingState = keyof typeof customerCopy.bookingState

export type HistoryEntry =
  | {
      kind: "booking"
      id: string
      state: BookingState
      // "השתתפת"
      label: string
      // "יום שני 12.10" and the instant; null without a known session.
      day: string | null
      startsAt: string | null
      // "בראנץ׳ {concept}"; null without a known session.
      title: string | null
    }
  | {
      kind: "other"
      id: string
      label: string
      createdAt: string
    }

type Action = keyof typeof customerCopy.movement

function isAction(action: string): action is Action {
  return Object.prototype.hasOwnProperty.call(customerCopy.movement, action)
}

const STATE_OF: Partial<Record<string, BookingState>> = {
  reserve: "booked",
  use: "used",
  release: "cancelled",
}

export function buildHistory(rows: {
  movements: readonly MovementRow[]
  bookings: readonly BookingRow[]
  sessions: readonly SessionRow[]
}): HistoryEntry[] {
  type Sorted = { entry: HistoryEntry; at: string }
  const byBooking = new Map<string, { state: BookingState; firstAt: string }>()
  const others: Sorted[] = []

  for (const m of rows.movements) {
    if (m.action === "grant") continue
    const state = STATE_OF[m.action]
    if (m.booking_id && state) {
      // The server's order is created_at: the last movement is the state.
      const seen = byBooking.get(m.booking_id)
      byBooking.set(m.booking_id, {
        state,
        firstAt: seen?.firstAt ?? m.created_at,
      })
      continue
    }
    others.push({
      at: m.created_at,
      entry: {
        kind: "other",
        id: m.id,
        label: isAction(m.action) ? customerCopy.movement[m.action] : m.action,
        createdAt: m.created_at,
      },
    })
  }

  const bookingRows: Sorted[] = [...byBooking].map(
    ([bookingId, { state, firstAt }]) => {
      const booking = rows.bookings.find((b) => b.id === bookingId)
      const event = booking
        ? rows.sessions.find((s) => s.id === booking.event_id)
        : undefined
      return {
        at: event?.starts_at ?? firstAt,
        entry: {
          kind: "booking",
          id: bookingId,
          state,
          label: customerCopy.bookingState[state],
          day: event ? formatSessionDate(event.starts_at) : null,
          startsAt: event?.starts_at ?? null,
          title: event ? customerCopy.sessionTitle(event.concept_name) : null,
        },
      }
    }
  )

  // Instants as ISO strings with different offsets: compare as times.
  return [...bookingRows, ...others]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((row) => row.entry)
}
