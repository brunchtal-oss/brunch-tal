// What /me shows for each active entitlement that has not expired, or that
// expired before it was bound (story 2.4), built from the rows
// RLS returned (pure: rows in, items out). The product name comes from the
// payment's product_snapshot (past purchases read the snapshot); the message
// and button come from the current product, and only while nothing was
// reserved or used from the entitlement yet (user decision 2026-10-01).

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
// days of the card at purchase.
export type EntitlementRow = {
  id: string
  eligibility_snapshot: unknown
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
  // The card expired before it reached the customer; validityWeeks (from the
  // snapshot's validity days) explains it, null when unknown.
  expiredBeforeBound: boolean
  validityWeeks: number | null
}

function validityWeeks(snapshot: unknown): number | null {
  const days = (snapshot as { validity_days?: unknown } | null)?.validity_days
  return typeof days === "number" && Number.isInteger(days) && days > 0
    ? Math.round(days / 7)
    : null
}

export function buildPurchaseItems(rows: {
  balances: readonly BalanceRow[]
  payments: readonly PaymentRow[]
  products: readonly ProductRow[]
  entitlements?: readonly EntitlementRow[]
}): PurchaseItem[] {
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
    return [
      {
        id: balance.entitlement_id ?? payment.id,
        productName: typeof snapshot?.name === "string" ? snapshot.name : "",
        amountAgorot: payment.amount_agorot,
        paidOn: payment.paid_on,
        available: balance.available ?? 0,
        reserved: balance.reserved ?? 0,
        expiresOn: balance.expires_on,
        message: untouched ? (product?.post_join_message ?? null) : null,
        buttonLabel: untouched
          ? (product?.post_join_button_label ?? null)
          : null,
        expiredBeforeBound,
        validityWeeks: expiredBeforeBound
          ? validityWeeks(entitlement?.eligibility_snapshot)
          : null,
      },
    ]
  })
}
