import { errorMessage, type ErrorCode } from "@/lib/errors"

import type { PurchaseProduct } from "./purchase-options"

// The purchase sheet's state (pure; components/shared/purchase-sheet.tsx).
// Every new idempotency key comes in with its event, so the rules can be
// tested: one key per opening, a new one when the product changes, after a
// failure, and when the page comes back from the back-forward cache.

export type SheetState = {
  open: boolean
  key: string
  productId: string
  terms: boolean
  busy: boolean
  error: ErrorCode | null
}

export type SheetEvent =
  | { type: "open"; key: string; products: readonly PurchaseProduct[] }
  | { type: "close" }
  | { type: "select"; productId: string; key: string }
  | { type: "terms"; value: boolean }
  | { type: "submit" }
  | { type: "failed"; code: ErrorCode; key: string }
  // pageshow with event.persisted: Back after leaving for Grow restores the
  // page as it was (busy); it is ready again, with a new request.
  | { type: "pageshow"; key: string }

export const CLOSED: SheetState = {
  open: false,
  key: "",
  productId: "",
  terms: false,
  busy: false,
  error: null,
}

export function sheetReducer(state: SheetState, event: SheetEvent): SheetState {
  switch (event.type) {
    case "open":
      return {
        open: true,
        key: event.key,
        productId: event.products[0]?.id ?? "",
        terms: false,
        busy: false,
        error: null,
      }
    case "close":
      // The sheet stays open while the checkout is on its way.
      return state.busy ? state : { ...state, open: false }
    case "select":
      return state.productId === event.productId
        ? state
        : { ...state, productId: event.productId, key: event.key, error: null }
    case "terms":
      return { ...state, terms: event.value, error: null }
    case "submit":
      return { ...state, busy: true, error: null }
    case "failed":
      return { ...state, busy: false, error: event.code, key: event.key }
    case "pageshow":
      return { ...state, busy: false, error: null, key: event.key }
  }
}

/** Why the pay button cannot be pressed, or null when it can. */
export function unavailableReason(
  product: PurchaseProduct | null,
  terms: boolean
): "product" | "terms" | null {
  if (!product) return "product"
  return terms ? null : "terms"
}

/** A refusal whose message advises contact: "צרי קשר" follows it. */
export function advisesContact(code: ErrorCode): boolean {
  return errorMessage(code).includes("צרי קשר")
}
