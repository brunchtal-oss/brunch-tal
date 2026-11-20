"use server"

import { checkoutBannerId } from "@/lib/server/privileged/checkout"

// Online payments, PR B: the "continue joining" banner's loader (public
// layout and /me). An exported "use server" loader is a public endpoint:
// it only reads, takes no input, and answers only about the caller's own
// cookie (the checkout id of a paid, unjoined purchase within 24 hours, or
// null).
export async function loadCheckoutBanner(): Promise<string | null> {
  return checkoutBannerId()
}
