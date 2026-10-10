import { adminCopy } from "@/lib/copy/admin"
import { isErrorCode, type ErrorCode } from "@/lib/errors"
import { formatAgorot } from "@/lib/money"

// preview_admin_cancel_booking's jsonb (stories 3.6, 3.7) as the sensitive
// dialog shows it. Every value is the server's plan (AD-7); nothing is
// computed here.

export type CancelChoice = "credit" | "refund"

export type CancelPlan =
  | {
      ok: true
      pendingJoin: boolean
      customerName: string | null
      // card: an entry returns to its card; pinned: a credit or (when Tal
      // chooses) a refund request; credit: the same credit comes back.
      funding: "card" | "pinned" | "credit"
      productName: string
      withinWindow: boolean
      // A pinned booking she could still cancel herself: Tal chooses.
      choiceRequired: boolean
      optionsCount: number
      // A pinned booking: the amount of a refund request.
      amountAgorot: number | null
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
  const amount = row.amount_agorot
  return {
    ok: true,
    pendingJoin: row.pending_join === true,
    customerName:
      typeof row.customer_name === "string" ? row.customer_name : null,
    funding:
      row.funding === "pinned" || row.funding === "credit"
        ? row.funding
        : "card",
    productName: typeof row.product_name === "string" ? row.product_name : "",
    withinWindow: row.within_window === true,
    choiceRequired: row.choice_required === true,
    optionsCount: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 1,
    amountAgorot:
      typeof amount === "number" && Number.isInteger(amount) ? amount : null,
  }
}

/**
 * "What returns" in the dialog: the card's product; for a pinned booking a
 * credit for N alternative sessions, or the refund request when Tal chose
 * it; for a credit-funded booking the same credit.
 */
export function cancelReturnsText(
  plan: Pick<
    Extract<CancelPlan, { ok: true }>,
    "funding" | "productName" | "optionsCount" | "amountAgorot"
  >,
  choice: CancelChoice | null = null
): string {
  const copy = adminCopy.sessions.cancel
  if (plan.funding === "card") return copy.returnsCard(plan.productName)
  if (plan.funding === "credit") return copy.returnsSameCredit
  if (choice === "refund") {
    return copy.returnsRefund(formatAgorot(plan.amountAgorot ?? 0))
  }
  return copy.returnsCredit(plan.optionsCount)
}
