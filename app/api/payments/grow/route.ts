import { handleGrowNotification } from "@/lib/payments/grow-notification"
import { confirmCheckout } from "@/lib/server/privileged/checkout"

// POST /api/payments/grow?c=<checkout>&s=<notify secret>: Grow's notifyUrl
// (online payments, PR A). Exempt from the site lock
// (SITE_LOCK_EXEMPT_PATHS); the per-checkout secret authenticates it.
// Processes notifications even when the kill switch is off. Any other
// method is a 405 (Next answers it). The handler and its answers:
// lib/payments/grow-notification.ts.

export async function POST(request: Request): Promise<Response> {
  return handleGrowNotification(request, async (checkoutId, secret) => {
    const result = await confirmCheckout(checkoutId, secret, "notify")
    return result.ok ? { ok: true, pending: result.pending } : result
  })
}
