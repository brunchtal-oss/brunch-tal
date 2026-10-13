import { isErrorCode, type ErrorCode } from "@/lib/errors"

// The plans of the two business actions on a whole session (story 3.8,
// AD-7): preview_admin_cancel_event and preview_admin_reschedule_event, as
// the sensitive dialog shows them. Every value is the server's plan;
// nothing is computed here.

export type AtRiskReason =
  "expired" | "no_session_before_expiry" | "not_valid_on_new_day"

// A card-funded booking whose card may be left unusable.
export type AtRiskCard = {
  customerId: string | null
  customerLabel: string
  productName: string
  expiresOn: string
  reason: AtRiskReason
}

// A purchase paid without a place on the session (user decision
// 2026-10-13): the cancel leaves it as it is; Tal handles it by hand.
export type ParkedPurchase = {
  customerId: string | null
  customerLabel: string
  paymentId: string
}

type Refusal = { ok: false; code: ErrorCode; field: string | null }

export type CancelEventPlan =
  | {
      ok: true
      bookingCount: number
      places: number
      cardCount: number
      choiceCount: number
      unboundCount: number
      atRisk: AtRiskCard[]
      parked: ParkedPurchase[]
      title: string
      body: string
    }
  | Refusal

export type RescheduleEventPlan =
  | {
      ok: true
      startsAt: string
      endsAt: string
      newStartsAt: string
      newEndsAt: string
      bookingCount: number
      atRisk: AtRiskCard[]
      title: string
      body: string
    }
  | Refusal

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function refusal(row: Record<string, unknown>): Refusal {
  return {
    ok: false,
    code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
    field: typeof row.field === "string" ? row.field : null,
  }
}

const REASONS: readonly AtRiskReason[] = [
  "expired",
  "no_session_before_expiry",
  "not_valid_on_new_day",
]

export function parseAtRisk(value: unknown): AtRiskCard[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = asRecord(item)
    const reason = REASONS.find((r) => r === row.reason)
    if (!reason || typeof row.expires_on !== "string") return []
    return [
      {
        customerId:
          typeof row.customer_id === "string" ? row.customer_id : null,
        customerLabel: text(row.customer_label),
        productName: text(row.product_name),
        expiresOn: row.expires_on,
        reason,
      },
    ]
  })
}

export function parseParked(value: unknown): ParkedPurchase[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = asRecord(item)
    if (typeof row.payment_id !== "string") return []
    return [
      {
        customerId:
          typeof row.customer_id === "string" ? row.customer_id : null,
        customerLabel: text(row.customer_label),
        paymentId: row.payment_id,
      },
    ]
  })
}

export function parseCancelEventPlan(data: unknown): CancelEventPlan {
  const row = asRecord(data)
  if (row.ok !== true) return refusal(row)
  return {
    ok: true,
    bookingCount: count(row.booking_count),
    places: count(row.places),
    cardCount: count(row.card_count),
    choiceCount: count(row.choice_count),
    unboundCount: count(row.unbound_count),
    atRisk: parseAtRisk(row.at_risk),
    parked: parseParked(row.parked),
    title: text(row.title),
    body: text(row.body),
  }
}

export function parseRescheduleEventPlan(data: unknown): RescheduleEventPlan {
  const row = asRecord(data)
  if (row.ok !== true) return refusal(row)
  return {
    ok: true,
    startsAt: text(row.starts_at),
    endsAt: text(row.ends_at),
    newStartsAt: text(row.new_starts_at),
    newEndsAt: text(row.new_ends_at),
    bookingCount: count(row.booking_count),
    atRisk: parseAtRisk(row.at_risk),
    title: text(row.title),
    body: text(row.body),
  }
}

// The number of customers notified, from either action's result.
export function parseNotified(data: unknown): number {
  return count(asRecord(data).notified)
}
