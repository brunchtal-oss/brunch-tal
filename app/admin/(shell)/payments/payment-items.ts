import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth } from "@/lib/time"

import { entitlementHref } from "../customers/[id]/entitlements/[entitlementId]/entitlement-items"

// What /admin/payments shows for each row of admin_list_payments (pure: rows
// in, items out). Product, price and method come from the payment's snapshot.

const copy = adminCopy.paymentsList

// admin_list_payments returns at most this many rows.
export const PAYMENTS_LIMIT = 50

export type PaymentRow = {
  payment_id: string
  customer_id: string | null
  customer_name: string | null
  // A label Tal gave a new customer's payment, shown until she joins.
  payer_label?: string | null
  product_name: string | null
  price_agorot: number | null
  amount_agorot: number
  payment_method_name: string | null
  paid_on: string
  created_at: string
  amount_override_reason: string | null
  reference: string | null
  note: string | null
  // Story 2.14: approved or voided, and the purchase it bought.
  status?: string
  entitlement_id?: string | null
}

export type PaymentItem = {
  paymentId: string
  title: string
  // The customer has not joined yet (the title is the "new customer" text).
  unbound: boolean
  // Story 2.14: the whole row opens the purchase page (bound or not); null
  // only when the row has no entitlement.
  href: string | null
  // "{product} · {amount} · {method} · רכישה {DD.MM} · אושר {DD.MM}", in
  // three parts around the amount.
  details: string
  detailsBefore: string
  amount: string
  detailsAfter: string
  // Story 2.14: tagged "בוטל", the amount struck through.
  voided: boolean
  // Only when the amount differs from the snapshot price.
  override: string | null
  extra: string | null
}

export function toPaymentItem(row: PaymentRow): PaymentItem {
  const changed =
    row.price_agorot !== null && row.price_agorot !== row.amount_agorot
  const reason = row.amount_override_reason?.trim()
  const override = changed
    ? [
        copy.catalogPrice(formatAgorot(row.price_agorot as number)),
        ...(reason ? [copy.reason(reason)] : []),
      ].join(" · ")
    : null
  const extraParts = [
    ...(row.reference ? [copy.reference(row.reference)] : []),
    ...(row.note ? [copy.note(row.note)] : []),
  ]
  const bound = row.customer_id !== null
  const detailsBefore = copy.detailsBefore(row.product_name ?? "")
  const amount = formatAgorot(row.amount_agorot)
  const detailsAfter = copy.detailsAfter(
    row.payment_method_name ?? "",
    formatDayMonth(row.paid_on),
    formatDayMonth(row.created_at)
  )
  return {
    paymentId: row.payment_id,
    title: bound
      ? (row.customer_name ?? "")
      : row.payer_label
        ? copy.unboundNamed(row.payer_label)
        : copy.unbound,
    unbound: !bound,
    href: row.entitlement_id
      ? entitlementHref(row.customer_id, row.entitlement_id)
      : null,
    details: `${detailsBefore}${amount}${detailsAfter}`,
    detailsBefore,
    amount,
    detailsAfter,
    voided: row.status === "voided",
    override,
    extra: extraParts.length > 0 ? extraParts.join(" · ") : null,
  }
}
