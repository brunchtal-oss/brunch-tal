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
  // The guest sheet's name and email, as typed (sent to Grow only).
  payerName: string
  payerEmail: string
  busy: boolean
  error: ErrorCode | null
}

export type SheetEvent =
  | { type: "open"; key: string; products: readonly PurchaseProduct[] }
  | { type: "close" }
  | { type: "select"; productId: string; key: string }
  | { type: "terms"; value: boolean }
  | { type: "payer"; name?: string; email?: string }
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
  payerName: "",
  payerEmail: "",
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
        // Kept while the page lives: reopening does not erase what she typed.
        payerName: state.payerName,
        payerEmail: state.payerEmail,
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
    case "payer":
      return {
        ...state,
        payerName: event.name ?? state.payerName,
        payerEmail: event.email ?? state.payerEmail,
        error: null,
      }
    case "submit":
      return { ...state, busy: true, error: null }
    case "failed":
      return { ...state, busy: false, error: event.code, key: event.key }
    case "pageshow":
      return { ...state, busy: false, error: null, key: event.key }
  }
}

/**
 * Why the pay button cannot be pressed, or null when it can, in the
 * sheet's order. payerValid: undefined when the sheet does not ask for a
 * name and email (a customer).
 */
export function unavailableReason(
  product: PurchaseProduct | null,
  terms: boolean,
  payerValid?: boolean
): "product" | "payer" | "terms" | null {
  if (!product) return "product"
  if (payerValid === false) return "payer"
  return terms ? null : "terms"
}

/** A refusal whose message advises contact: "צרי קשר" follows it. */
export function advisesContact(code: ErrorCode): boolean {
  return errorMessage(code).includes("צרי קשר")
}
