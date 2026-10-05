// The manual booking's preview (preview_admin_book_customer, story 3.4) as
// the screen reads it, and the action a refusal offers. Pure.

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, isErrorCode, type ErrorCode } from "@/lib/errors"

export type BookPreview =
  | {
      ok: true
      productName: string
      expiresOn: string
      occupied: number
      capacity: number
    }
  | {
      ok: false
      code: ErrorCode
      occupied: number | null
      capacity: number | null
    }

export function parseBookPreview(raw: unknown): BookPreview {
  const data = (raw ?? {}) as Record<string, unknown>
  const occupied = typeof data.occupied === "number" ? data.occupied : null
  const capacity = typeof data.capacity === "number" ? data.capacity : null
  if (
    data.ok === true &&
    typeof data.product_name === "string" &&
    typeof data.expires_on === "string" &&
    occupied !== null &&
    capacity !== null
  ) {
    return {
      ok: true,
      productName: data.product_name,
      expiresOn: data.expires_on,
      occupied,
      capacity,
    }
  }
  return {
    ok: false,
    code: isErrorCode(data.code) ? data.code : "SERVER_ERROR",
    occupied,
    capacity,
  }
}

// What a refusal offers: a payment for her (no matching entitlement), or
// raising the capacity (full). The links are built by the screen.
export function refusalAction(code: ErrorCode): "payment" | "capacity" | null {
  switch (code) {
    case "NO_MATCHING_ENTITLEMENT":
    case "ENTITLEMENT_EXPIRED_ON_DATE":
      return "payment"
    case "EVENT_FULL":
      return "capacity"
    default:
      return null
  }
}

// The refusal's text for Tal: the admin wording where lib/errors.ts speaks to
// the customer, errorMessage otherwise.
export function refusalMessage(code: ErrorCode): string {
  return adminCopy.sessions.bookRefusal[code] ?? errorMessage(code)
}
