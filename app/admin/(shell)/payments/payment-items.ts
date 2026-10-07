import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth } from "@/lib/time"

import { customerHref } from "../customers/customer-items"

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
}

export type PaymentItem = {
  paymentId: string
  title: string
  // The customer has not joined yet (the title is the "new customer" text).
  unbound: boolean
  // A bound purchase: the customer's card (story 4.2).
  customerHref: string | null
  details: string
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
  return {
    paymentId: row.payment_id,
    title: bound
      ? (row.customer_name ?? "")
      : row.payer_label
        ? copy.unboundNamed(row.payer_label)
        : copy.unbound,
    unbound: !bound,
    customerHref: bound ? customerHref(row.customer_id as string) : null,
    details: copy.details(
      row.product_name ?? "",
      formatAgorot(row.amount_agorot),
      row.payment_method_name ?? "",
      formatDayMonth(row.paid_on),
      formatDayMonth(row.created_at)
    ),
    override,
    extra: extraParts.length > 0 ? extraParts.join(" · ") : null,
  }
}
