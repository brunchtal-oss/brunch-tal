import { isErrorCode, type ErrorCode } from "@/lib/errors"

// preview_admin_settle_parked_purchase as the parked_settle dialog reads it
// (story 3.13; pure). Every value is the server's plan.

export type SettlePlan =
  | {
      ok: true
      customerId: string | null
      customerLabel: string
      conceptName: string
      startsAt: string
      amountAgorot: number
    }
  | { ok: false; code: ErrorCode }

export function parseSettlePlan(data: unknown): SettlePlan {
  const row =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  if (row.ok !== true) {
    return {
      ok: false,
      code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
    }
  }
  return {
    ok: true,
    customerId: typeof row.customer_id === "string" ? row.customer_id : null,
    customerLabel:
      typeof row.customer_label === "string" ? row.customer_label : "",
    conceptName: typeof row.concept_name === "string" ? row.concept_name : "",
    startsAt: typeof row.starts_at === "string" ? row.starts_at : "",
    amountAgorot:
      typeof row.amount_agorot === "number" &&
      Number.isSafeInteger(row.amount_agorot)
        ? row.amount_agorot
        : 0,
  }
}
