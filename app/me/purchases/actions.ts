"use server"

import {
  purchaseInputShape,
  type PurchaseOptions,
  type PurchaseStartResult,
} from "@/lib/payments/purchase-options"
import {
  purchaseOptions,
  startPurchase,
} from "@/lib/server/privileged/checkout"

// Online payments, PR B: "רכישת כרטיסייה" in "my purchases": the card
// products, no session, no hold. The customer is the uid of her verified
// session claims (never the input). An exported "use server" loader is a
// public endpoint: it only reads.

/** The card products she may buy (nothing while switched off). */
export async function loadCardPurchaseOptions(): Promise<PurchaseOptions> {
  return purchaseOptions("customer", null)
}

/** "למעבר לתשלום" for a card: always without a session. */
export async function startCardPurchaseAction(
  input: unknown
): Promise<PurchaseStartResult> {
  const shape = purchaseInputShape(input)
  if (!shape || shape.eventId !== null) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  return startPurchase({ as: "customer", ...shape })
}
