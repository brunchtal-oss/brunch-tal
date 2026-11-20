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

// Online payments, PR B: the purchase sheet on her session page. The
// customer is the uid of her verified session claims (never the input);
// get_purchase_options and begin_checkout run through the service role and
// check everything again. An exported "use server" loader is a public
// endpoint: it only reads, and it never takes a uid from its input.

/** The products of this session she may buy (nothing while switched off). */
export async function loadSessionPurchaseOptions(
  eventId: string
): Promise<PurchaseOptions> {
  return purchaseOptions(
    "customer",
    typeof eventId === "string" ? eventId : "x"
  )
}

/** "למעבר לתשלום": the checkout, then the Grow form's URL. */
export async function startSessionPurchaseAction(
  input: unknown
): Promise<PurchaseStartResult> {
  const shape = purchaseInputShape(input)
  if (!shape) return { ok: false, code: "INVALID_INPUT" }
  return startPurchase({ as: "customer", ...shape })
}
