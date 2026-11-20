import {
  growConfig,
  type OnlinePaymentsEnv,
} from "@/lib/payments/online-config"
import { bearerToken, sameSecret } from "@/lib/server/secret"

// POST /api/jobs/reconcile-payments (online payments, "Decisions after
// review"): pg_cron (pg_net) calls it every 10 minutes, as the push worker.
// Bearer CRON_SECRET: none configured -> 503, missing or wrong -> 401.
// Grow not configured (its vars missing) -> 200 at once, with no Grow call
// and no write. The kill switch alone does not stop it (as the
// notification route), so payments lost while it was off still land.
// Otherwise it confirms at most 20 unpaid checkouts of the last 7 days (the
// least recently checked first), through the same confirm step as the
// notification (secret kind 'system'). The answer holds counts only.

export const RECONCILE_LIMIT = 20

/** The route's gate: the Grow vars only, never ONLINE_PAYMENTS_ENABLED. */
export function reconcileConfigured(
  env: OnlinePaymentsEnv = process.env
): boolean {
  return growConfig(env) !== null
}

export type ReconcileDeps = {
  cronSecret: string
  // The Grow vars are present (growConfig), whatever the kill switch.
  configured: boolean
  // The ids to check (claim_checkouts_to_reconcile), null on a failure.
  claim: (limit: number) => Promise<string[] | null>
  confirm: (checkoutId: string) => Promise<{ ok: boolean }>
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function handleReconcile(
  request: Request,
  deps: ReconcileDeps
): Promise<Response> {
  const secret = deps.cronSecret.trim()
  if (!secret) return json({ error: "not_configured" }, 503)

  const token = bearerToken(request.headers.get("authorization"))
  // Compared even without a token, so timing does not tell the cases apart.
  const ok = sameSecret(token ?? "", secret) && token !== null
  if (!ok) return json({ error: "unauthorized" }, 401)

  if (!deps.configured) return json({ skipped: true }, 200)

  const ids = await deps.claim(RECONCILE_LIMIT)
  if (ids === null) return json({ error: "unavailable" }, 503)

  let confirmed = 0
  for (const id of ids.slice(0, RECONCILE_LIMIT)) {
    try {
      if ((await deps.confirm(id)).ok) confirmed++
    } catch {
      // One checkout's failure does not stop the others.
    }
  }
  return json({ checked: ids.length, confirmed }, 200)
}
