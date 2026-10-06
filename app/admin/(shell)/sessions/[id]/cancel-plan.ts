import { adminCopy } from "@/lib/copy/admin"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { formatDayMonth } from "@/lib/time"

// preview_admin_cancel_booking's jsonb (story 3.6) as the sensitive dialog
// shows it. Every value is the server's plan (AD-7); nothing is computed
// here.

export type CancelPlan =
  | {
      ok: true
      pendingJoin: boolean
      customerName: string | null
      outcome: "card" | "pinned"
      productName: string
      withinWindow: boolean
      expiresOn: string | null
      awaitingSessions: boolean
      optionsCount: number
    }
  | { ok: false; code: ErrorCode }

export function parseCancelPlan(data: unknown): CancelPlan {
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
  const n = row.options_count
  return {
    ok: true,
    pendingJoin: row.pending_join === true,
    customerName:
      typeof row.customer_name === "string" ? row.customer_name : null,
    outcome: row.outcome === "pinned" ? "pinned" : "card",
    productName: typeof row.product_name === "string" ? row.product_name : "",
    withinWindow: row.within_window === true,
    expiresOn: typeof row.expires_on === "string" ? row.expires_on : null,
    awaitingSessions: row.awaiting_sessions === true,
    optionsCount: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 1,
  }
}

/**
 * "What returns" in the dialog: the card's product; for a pinned booking the
 * N next sessions and the validity date, or, while it would wait for the
 * next sessions, no date (its expires_on is then provisional).
 */
export function cancelReturnsText(
  plan: Pick<
    Extract<CancelPlan, { ok: true }>,
    | "outcome"
    | "productName"
    | "awaitingSessions"
    | "expiresOn"
    | "optionsCount"
  >
): string {
  const copy = adminCopy.sessions.cancel
  if (plan.outcome === "card") return copy.returnsCard(plan.productName)
  if (plan.awaitingSessions || !plan.expiresOn) {
    return copy.returnsAwaiting(plan.optionsCount)
  }
  return copy.returnsPinned(plan.optionsCount, formatDayMonth(plan.expiresOn))
}
