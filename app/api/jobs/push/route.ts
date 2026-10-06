import {
  runPushWorker,
  vapidFromEnv,
} from "@/lib/server/privileged/push-worker"
import { bearerToken, sameSecret } from "@/lib/server/secret"

// POST /api/jobs/push (story 5.8, AD-11, AD-22): pg_cron (pg_net) wakes the
// push worker here when a job is ready. Exempt from the site lock
// (SITE_LOCK_EXEMPT_PREFIXES), so it checks its own secret: Bearer
// CRON_SECRET. No secret configured -> 503; a missing or wrong one -> 401;
// no VAPID keys -> 503. Any other method is a 405 (Next answers it). The
// answer holds counts only. Runs on Node (the default; cacheComponents
// rejects an explicit `runtime` export), which web-push needs.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store" }

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  if (!secret) return json({ error: "not_configured" }, 503)

  const token = bearerToken(request.headers.get("authorization"))
  // Compared even without a token, so timing does not tell the cases apart.
  const ok = sameSecret(token ?? "", secret) && token !== null
  if (!ok) return json({ error: "unauthorized" }, 401)

  const vapid = vapidFromEnv()
  if (!vapid) return json({ error: "not_configured" }, 503)

  const result = await runPushWorker(vapid)
  console.info("push.worker", result)
  return json(result, 200)
}
