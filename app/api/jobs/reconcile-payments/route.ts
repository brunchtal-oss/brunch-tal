import {
  handleReconcile,
  reconcileConfigured,
} from "@/lib/payments/reconcile-handler"
import { callRpc } from "@/lib/rpc"
import { confirmCheckout } from "@/lib/server/privileged/checkout"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// POST /api/jobs/reconcile-payments: the reconciliation of online payments
// whose notification never landed (lib/payments/reconcile-handler.ts).
// Exempt from the site lock under /api/jobs/; checks CRON_SECRET. Any
// other method is a 405 (Next answers it).

export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  const result = await handleReconcile(request, {
    cronSecret: process.env.CRON_SECRET ?? "",
    configured: reconcileConfigured(process.env),
    claim: async (limit) => {
      const claimed = await callRpc(
        createServiceClient(),
        "claim_checkouts_to_reconcile",
        { p_limit: limit }
      )
      return claimed.ok && Array.isArray(claimed.data)
        ? (claimed.data as string[])
        : null
    },
    confirm: (checkoutId) => confirmCheckout(checkoutId, null, "system"),
  })
  console.info("payments.reconcile", { status: result.status })
  return result
}
