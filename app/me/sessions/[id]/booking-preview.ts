import { isErrorCode, type ErrorCode } from "@/lib/errors"

// preview_book_session's jsonb as the session page uses it (story 3.2).
// Display only: the server decided every value (funding, dates, whether she
// can still cancel by herself).

export type BookingPreview =
  | {
      kind: "bookable"
      productName: string
      availableAfter: number
      expiresOn: string
      cancelDeadline: string
    }
  | { kind: "booked"; cancelDeadline: string | null; canSelfCancel: boolean }
  | { kind: "blocked"; code: ErrorCode }

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

export function parsePreview(data: unknown): BookingPreview {
  const row =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}

  if (row.booked === true) {
    return {
      kind: "booked",
      cancelDeadline: text(row.cancel_deadline),
      canSelfCancel: row.can_self_cancel === true,
    }
  }

  if (row.ok === true) {
    const productName = text(row.product_name)
    const expiresOn = text(row.expires_on)
    const cancelDeadline = text(row.cancel_deadline)
    if (
      productName &&
      expiresOn &&
      cancelDeadline &&
      Number.isSafeInteger(row.available_after)
    ) {
      return {
        kind: "bookable",
        productName,
        availableAfter: row.available_after as number,
        expiresOn,
        cancelDeadline,
      }
    }
    return { kind: "blocked", code: "SERVER_ERROR" }
  }

  return {
    kind: "blocked",
    code: isErrorCode(row.code) ? row.code : "SERVER_ERROR",
  }
}

// The action next to a blocked reason: a WhatsApp contact where Tal can
// still help (closed, no matching entry), otherwise back to all sessions.
export function blockedAction(code: ErrorCode): "contact" | "all-sessions" {
  return code === "REGISTRATION_CLOSED" || code === "NO_MATCHING_ENTITLEMENT"
    ? "contact"
    : "all-sessions"
}
