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

// Online payments, PR B: the purchase sheet on the public session page, for
// a guest, only while public_online_purchase is on (get_purchase_options
// says so; begin_guest_checkout refuses with PUBLIC_PURCHASE_OFF anyway).
// The checkout rate limit (10 an hour per IP) runs in startCheckout. An
// exported "use server" loader is a public endpoint: it only reads.

/** The products of this session a guest may buy (nothing while off). */
export async function loadGuestPurchaseOptions(
  eventId: string
): Promise<PurchaseOptions> {
  return purchaseOptions("guest", typeof eventId === "string" ? eventId : "x")
}

/** "למעבר לתשלום" for a guest: the checkout, then the Grow form's URL. */
export async function startGuestPurchaseAction(
  input: unknown
): Promise<PurchaseStartResult> {
  // A guest sends her name and email (for Grow only).
  const shape = purchaseInputShape(input)
  if (!shape?.payer) return { ok: false, code: "INVALID_INPUT" }
  return startPurchase({ as: "guest", ...shape })
}
