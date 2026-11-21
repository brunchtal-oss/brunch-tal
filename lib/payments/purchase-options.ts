import { isEmailShape } from "@/lib/email"
import type { ErrorCode } from "@/lib/errors"

import { isCheckoutId } from "./checkout-cookie"

// The purchase sheet's products (get_purchase_options; pure). Display only:
// the server decided which products fit and whether buying is enabled
// (the kill switch, published purchase terms, the public setting).

export type PurchaseProduct = {
  id: string
  name: string
  type: string
  priceAgorot: number
  units: number
  // session: pinned to the session (holds a seat); days: a card.
  validityMode: "days" | "session"
  validityDays: number | null
}

export type PurchaseOptions = {
  enabled: boolean
  products: PurchaseProduct[]
}

export const NO_PURCHASE: PurchaseOptions = { enabled: false, products: [] }

function product(value: unknown): PurchaseProduct | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const row = value as Record<string, unknown>
  const mode = row.validity_mode
  if (
    !isCheckoutId(row.id) ||
    typeof row.name !== "string" ||
    row.name.trim() === "" ||
    typeof row.type !== "string" ||
    !Number.isSafeInteger(row.price_agorot) ||
    (row.price_agorot as number) <= 0 ||
    !Number.isSafeInteger(row.units) ||
    (mode !== "days" && mode !== "session")
  ) {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    priceAgorot: row.price_agorot as number,
    units: row.units as number,
    validityMode: mode,
    validityDays: Number.isSafeInteger(row.validity_days)
      ? (row.validity_days as number)
      : null,
  }
}

/** get_purchase_options' jsonb; a malformed product is dropped. */
export function parsePurchaseOptions(data: unknown): PurchaseOptions {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return NO_PURCHASE
  }
  const row = data as Record<string, unknown>
  const products = Array.isArray(row.products)
    ? row.products.flatMap((p) => product(p) ?? [])
    : []
  return { enabled: row.enabled === true, products }
}

/** Whether a buy entry is shown: enabled and at least one product. */
export function canBuy(options: PurchaseOptions): boolean {
  return options.enabled && options.products.length > 0
}

// A guest's name and email for Grow's receipt (the Grow form does not ask
// for them, and its API refuses a form without a client name: errorCode
// 2201, sandbox 2026-11-21). Sent to Grow only; never stored, logged or put
// in a cookie. A customer's come from her profile on the server.
export type PayerInput = { name: string; email: string }

export const PAYER_NAME_MAX = 80

/** Trimmed name and email when both are valid, else null (pure). */
export function payerShape(value: unknown): PayerInput | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.name !== "string" || typeof row.email !== "string") {
    return null
  }
  const name = row.name.trim()
  const email = row.email.trim()
  if (name.length === 0 || name.length > PAYER_NAME_MAX) return null
  if (!isEmailShape(email)) return null
  return { name, email }
}

// The pay button's Server Action (the session pages and "my purchases").
export type PurchaseStartInput = {
  productId: string
  // The session of a pinned product; null for a card.
  eventId: string | null
  termsAccepted: boolean
  idempotencyKey: string
  // The guest sheet only.
  payer?: PayerInput
}

export type PurchaseStartResult =
  | {
      ok: true
      data: { kind: "redirect"; url: string } | { kind: "replayed" }
    }
  | { ok: false; code: ErrorCode }

/** Only the shape of the input (every value is checked again server-side). */
export function purchaseInputShape(input: unknown): PurchaseStartInput | null {
  if (typeof input !== "object" || input === null) return null
  const row = input as Record<string, unknown>
  if (
    !isCheckoutId(row.productId) ||
    (row.eventId !== null && !isCheckoutId(row.eventId)) ||
    typeof row.termsAccepted !== "boolean" ||
    !isCheckoutId(row.idempotencyKey)
  ) {
    return null
  }
  const payer = row.payer === undefined ? undefined : payerShape(row.payer)
  if (payer === null) return null
  return {
    productId: row.productId,
    eventId: row.eventId as string | null,
    termsAccepted: row.termsAccepted,
    idempotencyKey: row.idempotencyKey,
    ...(payer ? { payer } : {}),
  }
}

/**
 * What the pay button sends, or null while it cannot be pressed (no
 * product, no valid payer details where the sheet asks for them, or the
 * terms not accepted). A pinned product holds a seat in the page's
 * session; a card is bought without one. `payer`: undefined when the sheet
 * does not ask (a customer), null while the fields are not valid.
 */
export function purchaseRequest(
  product: PurchaseProduct | null,
  eventId: string | null,
  termsAccepted: boolean,
  idempotencyKey: string,
  payer?: PayerInput | null
): PurchaseStartInput | null {
  if (!product || !termsAccepted || payer === null) return null
  return {
    productId: product.id,
    eventId: holdsSeat(product, eventId) ? eventId : null,
    termsAccepted,
    idempotencyKey,
    ...(payer ? { payer } : {}),
  }
}

/** A pinned product on a session page: the hold line is shown. */
export function holdsSeat(
  product: PurchaseProduct | null,
  eventId: string | null
): boolean {
  return product?.validityMode === "session" && eventId !== null
}
