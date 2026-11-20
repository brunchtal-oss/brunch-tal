import { cookies } from "next/headers"

import {
  CHECKOUT_COOKIE,
  failFromPayment,
  paymentRedirectResponse,
} from "@/lib/server/privileged/checkout"

// GET /pay/failed?c=<checkout>: Grow's failureUrl. Only the cookie entry
// whose id is c fails (an open hold is released and the waitlist hears of
// it), so a forged link cannot cancel another checkout. Then the session
// page (or "my purchases", or the home page for a guest) shows
// ?payment=failed. A checkout that is already paid goes to /pay/return.

export async function GET(request: Request): Promise<Response> {
  const store = await cookies()
  const c = new URL(request.url).searchParams.get("c")
  const redirect = await failFromPayment(store.get(CHECKOUT_COOKIE)?.value, c)
  return paymentRedirectResponse(redirect, request.url)
}
