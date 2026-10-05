// What /me shows for each active entitlement that has not expired, or that
// expired before it was bound (story 2.4), built from the rows
// RLS returned (pure: rows in, items out). The product name comes from the
// payment's product_snapshot (past purchases read the snapshot); the message
// and button come from the current product, and only while nothing was
// reserved or used from the entitlement yet (user decision 2026-10-01).
// A pinned purchase (story 3.11) whose booking is confirmed and whose session
// has not started is shown as that session, with the product's message and
// button, instead of the balance; otherwise it never shows them. A pinned
// purchase is named "בראנץ׳ {concept}", not by the product (user decision
// 2026-10-05).

import { customerCopy } from "@/lib/copy/customer"

export type BalanceRow = {
  entitlement_id: string | null
  payment_id: string | null
  available: number | null
  reserved: number | null
  used: number | null
  expires_on: string | null
  expired_before_bound?: boolean | null
}

// entitlements.eligibility_snapshot of the shown entitlements: the validity
// days of the card at purchase; pinned_event_id: the session of a pinned
// purchase.
export type EntitlementRow = {
  id: string
  eligibility_snapshot: unknown
  pinned_event_id?: string | null
}

// The customer's own bookings of the shown pinned purchases.
export type BookingRow = {
  payment_id: string | null
  event_id: string
  status: string
}

// The sessions of those bookings, with the concept's name.
export type SessionRow = {
  id: string
  starts_at: string
  concept_name: string
}

export type PinnedSession = {
  eventId: string
  startsAt: string
  conceptName: string
}

export type PaymentRow = {
  id: string
  product_id: string
  amount_agorot: number
  paid_on: string
  product_snapshot: unknown
}

export type ProductRow = {
  id: string
  post_join_message: string | null
  post_join_button_label: string | null
}

export type PurchaseItem = {
  id: string
  productName: string
  amountAgorot: number
  paidOn: string
  available: number
  reserved: number
  expiresOn: string
  // null while something was already reserved or used from it, and for a
  // card that expired before it was bound.
  message: string | null
  buttonLabel: string | null
  // The card expired before it reached the customer; validityDays (from the
  // snapshot) explains it, null when unknown.
  expiredBeforeBound: boolean
  validityDays: number | null
  // A pinned purchase with a confirmed booking for a session that has not
  // started: shown as the session (no balance card); otherwise null.
  session: PinnedSession | null
}

function validityDays(snapshot: unknown): number | null {
  const days = (snapshot as { validity_days?: unknown } | null)?.validity_days
  return typeof days === "number" && Number.isInteger(days) && days > 0
    ? days
    : null
}

export function buildPurchaseItems(rows: {
  balances: readonly BalanceRow[]
  payments: readonly PaymentRow[]
  products: readonly ProductRow[]
  entitlements?: readonly EntitlementRow[]
  bookings?: readonly BookingRow[]
  sessions?: readonly SessionRow[]
  // The server's clock (a session that started is no longer "saved").
  now?: Date
}): PurchaseItem[] {
  const now = rows.now ?? new Date()
  return rows.balances.flatMap((balance) => {
    const payment = rows.payments.find((p) => p.id === balance.payment_id)
    if (!payment || !balance.expires_on) return []
    const product = rows.products.find((p) => p.id === payment.product_id)
    const snapshot = payment.product_snapshot as { name?: unknown } | null
    const expiredBeforeBound = balance.expired_before_bound === true
    const untouched =
      !expiredBeforeBound &&
      (balance.reserved ?? 0) === 0 &&
      (balance.used ?? 0) === 0
    const entitlement = rows.entitlements?.find(
      (e) => e.id === balance.entitlement_id
    )
    const pinnedConcept = entitlement?.pinned_event_id
      ? (rows.sessions?.find((e) => e.id === entitlement.pinned_event_id)
          ?.concept_name ?? null)
      : null
    const session = pinnedSession(
      entitlement?.pinned_event_id ?? null,
      payment.id,
      rows.bookings ?? [],
      rows.sessions ?? [],
      now
    )
    // A pinned purchase shows the product's message and button only as its
    // live session: self-booking never uses it (parked, cancelled, started).
    const isPinned = Boolean(entitlement?.pinned_event_id)
    const showProduct = session !== null || (untouched && !isPinned)
    return [
      {
        id: balance.entitlement_id ?? payment.id,
        productName: pinnedConcept
          ? customerCopy.sessionTitle(pinnedConcept)
          : typeof snapshot?.name === "string"
            ? snapshot.name
            : "",
        amountAgorot: payment.amount_agorot,
        paidOn: payment.paid_on,
        available: balance.available ?? 0,
        reserved: balance.reserved ?? 0,
        expiresOn: balance.expires_on,
        message: showProduct ? (product?.post_join_message ?? null) : null,
        buttonLabel: showProduct
          ? (product?.post_join_button_label ?? null)
          : null,
        expiredBeforeBound,
        validityDays: expiredBeforeBound
          ? validityDays(entitlement?.eligibility_snapshot)
          : null,
        session,
      },
    ]
  })
}

function pinnedSession(
  eventId: string | null,
  paymentId: string,
  bookings: readonly BookingRow[],
  sessions: readonly SessionRow[],
  now: Date
): PinnedSession | null {
  if (!eventId) return null
  const booked = bookings.some(
    (b) =>
      b.payment_id === paymentId &&
      b.event_id === eventId &&
      b.status === "confirmed"
  )
  const event = sessions.find((e) => e.id === eventId)
  if (!booked || !event) return null
  if (new Date(event.starts_at).getTime() <= now.getTime()) return null
  return {
    eventId,
    startsAt: event.starts_at,
    conceptName: event.concept_name,
  }
}
