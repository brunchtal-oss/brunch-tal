import { cookies } from "next/headers"

import {
  matchPaymentOutcome,
  PAYMENT_OUTCOME_COOKIE,
  type PaymentOutcome,
} from "./checkout-cookie"

// The outcome notice's proof (review pass 1): a page shows a ?payment=
// notice only when the one-minute cookie set by /pay/return or /pay/failed
// holds the same outcome. It is left to expire by itself. Server
// components only (reads the request's cookies, so inside <Suspense>).

/** The `payment` search param (a single value only). */
export function paymentParam(
  params: Record<string, string | string[] | undefined>
): string | null {
  const value = params.payment
  return typeof value === "string" ? value : null
}

export async function readPaymentOutcome(
  params: Record<string, string | string[] | undefined>
): Promise<PaymentOutcome | null> {
  const param = paymentParam(params)
  if (!param) return null
  const store = await cookies()
  return matchPaymentOutcome(param, store.get(PAYMENT_OUTCOME_COOKIE)?.value)
}
