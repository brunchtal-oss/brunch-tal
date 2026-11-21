import { cookies } from "next/headers"

import {
  CHECKOUT_COOKIE,
  paymentRedirectResponse,
  returnFromPayment,
} from "@/lib/server/privileged/checkout"

// GET /pay/return?c=<checkout>: Grow's successUrl. Runs the same confirm
// step as the notification (a lost notification still lands), then sends
// her on: a new customer to /join/<token> (that cookie entry is then
// removed), a known one to her area, a payment not at morning yet to
// /pay/pending, anything else to the session page (or "my purchases", or
// the home page for a guest) with ?payment=<state>. The checkout is the
// cookie entry whose id is c; no c or no match is "not found".

// The return waits up to about 10 seconds for the receipt (RETURN_WAITS_MS).
export const maxDuration = 30

export async function GET(request: Request): Promise<Response> {
  const store = await cookies()
  const c = new URL(request.url).searchParams.get("c")
  const redirect = await returnFromPayment(store.get(CHECKOUT_COOKIE)?.value, c)
  return paymentRedirectResponse(redirect, request.url)
}
