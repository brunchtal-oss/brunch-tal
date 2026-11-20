import { cookies } from "next/headers"

import {
  CHECKOUT_COOKIE,
  returnFromPayment,
} from "@/lib/server/privileged/checkout"

// GET /pay/return: Grow's successUrl. Runs the same confirm step as the
// notification (a lost notification still lands), then sends her on: a new
// customer to /join/<token>, a known one to her area, a payment not at
// morning yet to /pay/pending, anything else to the session page (or "my
// purchases") with ?payment=<state>. The checkout comes only from the
// httpOnly cookie. No referrer, no cache (a join token may be in Location).

export async function GET(request: Request): Promise<Response> {
  const store = await cookies()
  const path = await returnFromPayment(store.get(CHECKOUT_COOKIE)?.value)
  return redirect(path, request)
}

function redirect(path: string, request: Request): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, request.url).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  })
}
