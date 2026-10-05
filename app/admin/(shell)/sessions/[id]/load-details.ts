import "server-only"

import type { Attendee } from "@/components/admin/attendee-row"
import type { SessionSummary } from "@/components/admin/summary-card"
import { formatLocalPhone } from "@/lib/phone"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { EventKind, EventStatus } from "../session-draft"

// The session page and the session-morning view (story 3.4): one call to
// admin_get_event_details (admin only, a definer read). Never a read of
// bookings or babies from the page itself, and never a sum of party sizes
// here: occupied comes from private.occupied_places.

export type EventDetails = {
  id: string
  conceptName: string
  kind: EventKind
  status: EventStatus
  startsAt: string
  endsAt: string
  capacity: number
  occupied: number
  attendees: Attendee[]
}

type RawBooking = {
  booking_id: string
  party_size: number
  pending_join?: boolean
  payer_label?: string
  full_name?: string
  phone_e164?: string
  dietary_notes?: string
  guest_details?: string
  babies?: { name: string; birth_date: string }[]
}

type RawDetails = {
  event: {
    id: string
    concept_name: string
    kind: string
    status: string
    starts_at: string
    ends_at: string
    capacity_adults: number
    occupied: number
  }
  bookings: RawBooking[]
}

// A blank text is not shown (DESIGN.md › attendee-row: an empty field shows
// nothing).
function text(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

export function parseEventDetails(raw: unknown): EventDetails {
  const data = raw as RawDetails
  return {
    id: data.event.id,
    conceptName: data.event.concept_name,
    kind: data.event.kind as EventKind,
    status: data.event.status as EventStatus,
    startsAt: data.event.starts_at,
    endsAt: data.event.ends_at,
    capacity: data.event.capacity_adults,
    occupied: data.event.occupied,
    attendees: (data.bookings ?? []).map((b) => ({
      bookingId: b.booking_id,
      partySize: b.party_size,
      pendingJoin: b.pending_join === true,
      payerLabel: text(b.payer_label),
      name: text(b.full_name),
      phone: b.phone_e164 ? formatLocalPhone(b.phone_e164) : null,
      dietaryNotes: text(b.dietary_notes),
      guestDetails: text(b.guest_details),
      babies: (b.babies ?? []).map((baby) => ({
        name: baby.name,
        birthDate: baby.birth_date,
      })),
    })),
  }
}

// The summary-card's figures: places from the server, bookings (a pending
// one too), babies, and bookings with dietary notes or a companion's note.
export function detailsSummary(details: EventDetails): SessionSummary {
  return {
    occupied: details.occupied,
    capacity: details.capacity,
    bookings: details.attendees.length,
    babies: details.attendees.reduce((n, a) => n + a.babies.length, 0),
    allergies: details.attendees.filter(
      (a) => a.dietaryNotes !== null || a.guestDetails !== null
    ).length,
  }
}

// A session with no room for one more booking of its kind (couple = 2).
// Display only; admin_book_customer checks again under its lock.
export function isFull(details: EventDetails): boolean {
  const party = details.kind === "couple" ? 2 : 1
  return details.occupied + party > details.capacity
}

// null: no such session (NOT_FOUND).
export async function loadEventDetails(
  eventId: string
): Promise<EventDetails | null> {
  const result = await callRpc(
    await createClient(),
    "admin_get_event_details",
    { p_event_id: eventId }
  )
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return null
    throw new Error("session details failed")
  }
  return parseEventDetails(result.data)
}
