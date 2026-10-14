import { adminCopy } from "@/lib/copy/admin"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { formatAgorot, parseShekelsToAgorot } from "@/lib/money"
import { formatDayMonth, formatShortDate } from "@/lib/time"

import { customerHref } from "../customers/customer-items"

// The refunds section of /admin/payments (story 3.9): the rows of
// admin_list_refund_requests and the plan of preview_admin_complete_refund
// (pure: data in, values out). Every amount, ceiling and date is the
// server's (AD-7, AD-9); nothing is computed here but the input check.

const copy = adminCopy.refunds

export type RefundRow = {
  refund_request_id: string
  status: "requested" | "completed"
  customer_id: string | null
  customer_label: string | null
  amount_agorot: number
  requested_at: string
  refunded_on: string | null
  reference: string | null
  concept_name: string
  starts_at: string
  product_name: string | null
  paid_agorot: number
  max_agorot: number
}

export type RefundItem = {
  id: string
  // The row's anchor: /admin/payments#refund-<id> (the home and "לטיפול").
  anchor: string
  open: boolean
  name: string
  customerHref: string | null
  title: string
  // An open request: what she asked for; a completed one: what was paid
  // back and when.
  detail: string
  reference: string | null
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null

/** admin_list_refund_requests' jsonb; a malformed row is left out. */
export function parseRefundRows(data: unknown): RefundRow[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): RefundRow[] => {
    const r =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : null
    const id = str(r?.refund_request_id)
    const amount = int(r?.amount_agorot)
    const startsAt = str(r?.starts_at)
    if (
      !r ||
      !id ||
      amount === null ||
      !startsAt ||
      (r.status !== "requested" && r.status !== "completed")
    ) {
      return []
    }
    return [
      {
        refund_request_id: id,
        status: r.status,
        customer_id: str(r.customer_id),
        customer_label: str(r.customer_label),
        amount_agorot: amount,
        requested_at: str(r.requested_at) ?? "",
        refunded_on: str(r.refunded_on),
        reference: str(r.reference),
        concept_name: str(r.concept_name) ?? "",
        starts_at: startsAt,
        product_name: str(r.product_name),
        paid_agorot: int(r.paid_agorot) ?? 0,
        max_agorot: int(r.max_agorot) ?? 0,
      },
    ]
  })
}

export function refundAnchor(id: string): string {
  return `refund-${id}`
}

/** The link from the home and "לטיפול" to one request's row. */
export function refundHref(id: string): string {
  return `/admin/payments#${refundAnchor(id)}`
}

function nameOf(label: string | null): string {
  const trimmed = label?.trim() ?? ""
  return trimmed === "" ? adminCopy.home.newCustomer : trimmed
}

export function toRefundItem(row: RefundRow): RefundItem {
  const name = nameOf(row.customer_label)
  const open = row.status === "requested"
  return {
    id: row.refund_request_id,
    anchor: refundAnchor(row.refund_request_id),
    open,
    name,
    customerHref: row.customer_id ? customerHref(row.customer_id) : null,
    title: copy.rowTitle(name, row.concept_name, formatDayMonth(row.starts_at)),
    detail: open
      ? copy.requested(formatAgorot(row.amount_agorot), row.product_name ?? "")
      : copy.completed(
          formatAgorot(row.amount_agorot),
          row.refunded_on ? formatShortDate(row.refunded_on) : ""
        ),
    reference: !open && row.reference ? copy.reference(row.reference) : null,
  }
}

export type RefundPlan =
  | {
      ok: true
      refundRequestId: string
      customerLabel: string | null
      requestedAgorot: number
      paidAgorot: number
      refundedBeforeAgorot: number
      maxAgorot: number
      paidOn: string
      conceptName: string
      startsAt: string
      // The local day (the server's): the date field's default and max.
      today: string
    }
  | { ok: false; code: ErrorCode }

/** preview_admin_complete_refund's jsonb. */
export function parseRefundPlan(data: unknown): RefundPlan {
  const r =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  const id = str(r.refund_request_id)
  const requested = int(r.requested_agorot)
  const paid = int(r.paid_agorot)
  const max = int(r.max_agorot)
  const paidOn = str(r.paid_on)
  const today = str(r.today)
  if (
    r.ok !== true ||
    !id ||
    requested === null ||
    paid === null ||
    max === null ||
    !paidOn ||
    !today
  ) {
    return {
      ok: false,
      code: r.ok === false && isErrorCode(r.code) ? r.code : "SERVER_ERROR",
    }
  }
  return {
    ok: true,
    refundRequestId: id,
    customerLabel: str(r.customer_label),
    requestedAgorot: requested,
    paidAgorot: paid,
    refundedBeforeAgorot: int(r.refunded_before_agorot) ?? 0,
    maxAgorot: max,
    paidOn,
    conceptName: str(r.concept_name) ?? "",
    startsAt: str(r.starts_at) ?? "",
    today,
  }
}

export type RefundFields = {
  refundedOn: string
  amountText: string
  reference: string
}

/**
 * Why the dialog's confirm cannot run yet (shown as its hint), or null:
 * a date between the payment's day and today, an amount in shekels up to
 * the ceiling, a reference of at most 200 characters. The server checks
 * every one again.
 */
export function refundFieldsProblem(
  plan: Extract<RefundPlan, { ok: true }>,
  fields: RefundFields
): string | null {
  if (fields.refundedOn === "") return copy.dateMissing
  if (fields.refundedOn < plan.paidOn || fields.refundedOn > plan.today) {
    return copy.dateInvalid
  }
  const amount = parseShekelsToAgorot(fields.amountText)
  if (amount === null) return copy.amountInvalid
  if (amount > plan.maxAgorot) {
    return copy.amountTooHigh(formatAgorot(plan.maxAgorot))
  }
  if (fields.reference.trim().length > 200) return copy.referenceTooLong
  return null
}

/** A refusal of the action, worded for Tal (detail.field of INVALID_INPUT). */
export function refundRefusal(code: ErrorCode, field?: string): string | null {
  if (code === "INVALID_INPUT") {
    if (field === "refunded_on") return copy.dateInvalid
    if (field === "amount") return copy.amountInvalid
    if (field === "reference") return copy.referenceTooLong
  }
  return null
}
