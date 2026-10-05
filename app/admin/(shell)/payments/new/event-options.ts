// The "session" field of the approval form for a pinned product (story
// 3.11): the open sessions (admin_list_bookable_events) of the product's kind
// and on its weekdays. A session without room for the product's party size
// is shown and cannot be chosen. Pure: rows in, options out; the RPC checks
// everything again (private.plan_pinned_placement).

export type BookableEvent = {
  id: string
  startsAt: string
  kind: "regular" | "couple"
  // The local weekday (Jerusalem), 0 = Sunday.
  weekday: number
  conceptName: string
  occupied: number
  capacity: number
}

export type PinnedProductRules = {
  eventKind: "regular" | "couple"
  // null = every day.
  weekdays: readonly number[] | null
  partySize: number
}

export type EventOption = BookableEvent & { full: boolean }

export function eventOptionsFor(
  product: PinnedProductRules,
  events: readonly BookableEvent[]
): EventOption[] {
  return events
    .filter(
      (event) =>
        event.kind === product.eventKind &&
        (product.weekdays === null || product.weekdays.includes(event.weekday))
    )
    .map((event) => ({
      ...event,
      full: event.occupied + product.partySize > event.capacity,
    }))
}

type BookableEventRow = {
  id: string
  starts_at: string
  kind: string
  weekday: number
  concept_name: string
  occupied: number
  capacity: number
}

// The RPC's rows as BookableEvent; a row of an unknown kind is left out.
export function toBookableEvents(rows: unknown): BookableEvent[] {
  if (!Array.isArray(rows)) return []
  return (rows as BookableEventRow[]).flatMap((row) =>
    row.kind === "regular" || row.kind === "couple"
      ? [
          {
            id: row.id,
            startsAt: row.starts_at,
            kind: row.kind,
            weekday: row.weekday,
            conceptName: row.concept_name,
            occupied: row.occupied,
            capacity: row.capacity,
          },
        ]
      : []
  )
}
