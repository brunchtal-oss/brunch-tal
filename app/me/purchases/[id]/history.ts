// The movement log of one entitlement (story 4.12), built from the rows RLS
// returned (pure: rows in, entries out), in the server's order (created_at,
// id). Each movement of a booking names its session: "בראנץ׳ {concept} ·
// {יום DD.MM}". Units keep their sign (grant +4, reserve -1, use 0).

import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth, formatWeekday } from "@/lib/time"

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

export type HistoryEntry = {
  id: string
  label: string
  // "+4", "-1"; null for a movement without units (use).
  units: string | null
  createdAt: string
  // "בראנץ׳ {concept} · {יום DD.MM}", or null without a known session.
  session: string | null
}

type Action = keyof typeof customerCopy.movement

function isAction(action: string): action is Action {
  return Object.prototype.hasOwnProperty.call(customerCopy.movement, action)
}

export function signedUnits(units: number): string | null {
  if (units === 0) return null
  return units > 0 ? `+${units}` : `-${Math.abs(units)}`
}

export function buildHistory(rows: {
  movements: readonly MovementRow[]
  bookings: readonly BookingRow[]
  sessions: readonly SessionRow[]
}): HistoryEntry[] {
  return rows.movements.map((m) => {
    const booking = m.booking_id
      ? rows.bookings.find((b) => b.id === m.booking_id)
      : undefined
    const event = booking
      ? rows.sessions.find((s) => s.id === booking.event_id)
      : undefined
    return {
      id: m.id,
      label: isAction(m.action) ? customerCopy.movement[m.action] : m.action,
      units: signedUnits(m.units),
      createdAt: m.created_at,
      session: event
        ? `${customerCopy.sessionTitle(event.concept_name)} · ${formatWeekday(event.starts_at)} ${formatDayMonth(event.starts_at)}`
        : null,
    }
  })
}
