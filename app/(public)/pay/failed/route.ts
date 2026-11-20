import { cookies } from "next/headers"

import {
  CHECKOUT_COOKIE,
  failFromPayment,
} from "@/lib/server/privileged/checkout"

// GET /pay/failed: Grow's failureUrl. The checkout fails (an open hold is
// released and the waitlist hears of it), then the session page (or "my
// purchases") shows ?payment=failed. A checkout that is already paid goes
// to /pay/return.

export async function GET(request: Request): Promise<Response> {
  const store = await cookies()
  const path = await failFromPayment(store.get(CHECKOUT_COOKIE)?.value)
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, request.url).href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  })
}
