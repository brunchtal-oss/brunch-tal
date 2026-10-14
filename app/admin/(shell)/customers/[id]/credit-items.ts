import type { StatusTone } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth, formatShortDate } from "@/lib/time"

// The "זיכויים והחזרים" section of the customer card (story 3.9), from
// admin_list_customer_credits (pure: data in, items out). Every state and
// amount is the server's; this file only picks the chip and the line.

const copy = adminCopy.customers.card.credits

export type CustomerCreditRow = {
  credit_id: string
  status: "active" | "used" | "refund_requested" | "refunded"
  choice_pending: boolean
  party_size: number
  origin_starts_at: string
  concept_name: string
  monetary_basis_agorot: number
  refund: {
    refund_request_id: string
    status: "requested" | "completed"
    amount_agorot: number
    requested_at: string
    refunded_on: string | null
    reference: string | null
  } | null
}

export type CustomerCreditItem = {
  key: string
  title: string
  couple: boolean
  chip: { label: string; tone: StatusTone }
  line: string
  reference: string | null
  // An open refund request: the complete button acts on it.
  openRefundId: string | null
}

const STATUSES = ["active", "used", "refund_requested", "refunded"] as const

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null

function parseRefund(value: unknown): CustomerCreditRow["refund"] {
  const r = obj(value)
  const id = str(r?.refund_request_id)
  const amount = int(r?.amount_agorot)
  if (
    !r ||
    !id ||
    amount === null ||
    (r.status !== "requested" && r.status !== "completed")
  ) {
    return null
  }
  return {
    refund_request_id: id,
    status: r.status,
    amount_agorot: amount,
    requested_at: str(r.requested_at) ?? "",
    refunded_on: str(r.refunded_on),
    reference: str(r.reference),
  }
}

/** admin_list_customer_credits' jsonb; a malformed row is left out. */
export function parseCustomerCredits(data: unknown): CustomerCreditRow[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): CustomerCreditRow[] => {
    const r = obj(raw)
    const id = str(r?.credit_id)
    const startsAt = str(r?.origin_starts_at)
    const status = STATUSES.find((s) => s === r?.status)
    if (!r || !id || !startsAt || !status) return []
    return [
      {
        credit_id: id,
        status,
        choice_pending: r.choice_pending === true,
        party_size: r.party_size === 2 ? 2 : 1,
        origin_starts_at: startsAt,
        concept_name: str(r.concept_name) ?? "",
        monetary_basis_agorot: int(r.monetary_basis_agorot) ?? 0,
        refund: parseRefund(r.refund),
      },
    ]
  })
}

export function toCustomerCreditItem(
  row: CustomerCreditRow
): CustomerCreditItem {
  const base = {
    key: row.credit_id,
    title: copy.sessionTitle(
      row.concept_name,
      formatDayMonth(row.origin_starts_at)
    ),
    couple: row.party_size === 2,
    reference: null,
    openRefundId: null,
  }
  const refund = row.refund
  if (row.status === "refunded" && refund) {
    return {
      ...base,
      chip: { label: copy.chips.refunded, tone: "success" },
      line: copy.refundedLine(
        formatAgorot(refund.amount_agorot),
        refund.refunded_on ? formatShortDate(refund.refunded_on) : ""
      ),
      reference: refund.reference ? copy.reference(refund.reference) : null,
    }
  }
  if (row.status === "refund_requested" && refund) {
    return {
      ...base,
      chip: { label: copy.chips.requested, tone: "pending" },
      line: copy.requestedLine(
        formatAgorot(refund.amount_agorot),
        refund.requested_at ? formatDayMonth(refund.requested_at) : ""
      ),
      openRefundId:
        refund.status === "requested" ? refund.refund_request_id : null,
    }
  }
  if (row.status === "active" && row.choice_pending) {
    return {
      ...base,
      chip: { label: copy.chips.pending, tone: "warning" },
      line: copy.pendingLine,
    }
  }
  if (row.status === "used") {
    return {
      ...base,
      chip: { label: copy.chips.used, tone: "expired" },
      line: copy.worth(formatAgorot(row.monetary_basis_agorot)),
    }
  }
  return {
    ...base,
    chip: { label: copy.chips.active, tone: "success" },
    line: copy.worth(formatAgorot(row.monetary_basis_agorot)),
  }
}
