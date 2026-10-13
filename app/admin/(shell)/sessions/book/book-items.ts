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
