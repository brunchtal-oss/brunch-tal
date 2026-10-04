import type { StatusTone } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"

// The status-chip of a session for the signed-in customer (story 3.2): her
// own confirmed booking ("נרשמת"), otherwise the availability label from
// get_event_availability (never a number). Display only: the server decides
// the label and whether she can book.

export type AvailabilityLabel = "available" | "last_places" | "full"

export type Availability = {
  label: AvailabilityLabel
  registrationOpen: boolean
}

const TONE: Record<AvailabilityLabel, StatusTone> = {
  available: "success",
  last_places: "warning",
  full: "expired",
}

/** get_event_availability's jsonb, by event id; anything malformed is left out. */
export function parseAvailability(data: unknown): Map<string, Availability> {
  const result = new Map<string, Availability>()
  if (!Array.isArray(data)) return result
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue
    const { event_id, label, registration_open } = row as Record<
      string,
      unknown
    >
    if (
      typeof event_id === "string" &&
      (label === "available" || label === "last_places" || label === "full")
    ) {
      result.set(event_id, {
        label,
        registrationOpen: registration_open === true,
      })
    }
  }
  return result
}

/**
 * The chip's tone and word, or null when there is nothing to show (no label,
 * or registration closed).
 */
export function sessionStatus(input: {
  booked: boolean
  availability: Availability | undefined
}): { tone: StatusTone; text: string } | null {
  if (input.booked) return { tone: "success", text: customerCopy.booked }
  // Registration is closed: a place label would promise what the page
  // refuses, so no chip.
  if (!input.availability?.registrationOpen) return null
  const { label } = input.availability
  return { tone: TONE[label], text: customerCopy.availability[label] }
}
