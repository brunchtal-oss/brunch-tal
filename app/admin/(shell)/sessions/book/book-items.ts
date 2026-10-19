// The manual booking list (story 3.4) for one customer (story 4.3, user
// decision 2026-10-13): a session she already has a confirmed booking for
// is marked "רשומה" and is not a link. Pure: the sessions and her booked
// session ids in, the rows out.

export type BookableRow<E extends { id: string }> = E & { booked: boolean }

export function markBooked<E extends { id: string }>(
  events: E[],
  bookedEventIds: Iterable<string>
): BookableRow<E>[] {
  const booked = new Set(bookedEventIds)
  return events.map((event) => ({ ...event, booked: booked.has(event.id) }))
}

// The answer of admin_list_customer_bookable_events (story 3.19): the
// sessions she can be booked for (the bookable-events rows, parsed with
// toBookableEvents) and how many open sessions were hidden. A malformed
// answer reads as nothing listed and nothing hidden.
export function parseCustomerBookable(data: unknown): {
  events: unknown
  hidden: number
} {
  if (typeof data !== "object" || data === null)
    return { events: [], hidden: 0 }
  const { events, hidden } = data as { events?: unknown; hidden?: unknown }
  return {
    events: Array.isArray(events) ? events : [],
    hidden:
      typeof hidden === "number" && Number.isInteger(hidden) && hidden > 0
        ? hidden
        : 0,
  }
}

// What the screen shows (story 3.19): no open session at all ("אין מפגש
// פתוח לרישום"), open sessions but none she can be booked for (the notice
// with "הוספת תשלום"), or the list (with the hidden line when hidden > 0).
export type BookListView = "noSessions" | "noFundable" | "list"

export function bookListView(listed: number, hidden: number): BookListView {
  if (listed > 0) return "list"
  return hidden > 0 ? "noFundable" : "noSessions"
}

// Her free entries (story 4.3, the selection cap, user decision 2026-10-13),
// counted as preview_book_sessions counts them: the available entries of
// her active, non-pinned entitlements valid today or later (Jerusalem
// date), plus her active credits not waiting for her choice and not
// funding a confirmed booking. Pure: the rows read through RLS in.
export type FreeEntriesInput = {
  entitlements: readonly {
    id: string
    status: string
    pinned_event_id: string | null
    expires_on: string
  }[]
  balances: readonly {
    entitlement_id: string | null
    available: number | null
  }[]
  credits: readonly { id: string; status: string; choice_pending: boolean }[]
  // Credits allocated to a confirmed booking.
  fundingCreditIds: Iterable<string>
  // The local day (YYYY-MM-DD, Asia/Jerusalem).
  today: string
}

export function countFreeEntries(input: FreeEntriesInput): number {
  const open = new Set(
    input.entitlements
      .filter(
        (e) =>
          e.status === "active" &&
          e.pinned_event_id === null &&
          e.expires_on >= input.today
      )
      .map((e) => e.id)
  )
  const available = input.balances.reduce(
    (sum, b) =>
      b.entitlement_id !== null && open.has(b.entitlement_id)
        ? sum + (b.available ?? 0)
        : sum,
    0
  )
  const funding = new Set(input.fundingCreditIds)
  const credits = input.credits.filter(
    (c) => c.status === "active" && !c.choice_pending && !funding.has(c.id)
  ).length
  return Math.max(available, 0) + credits
}
