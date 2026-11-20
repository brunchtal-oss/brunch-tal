// POST /api/payments/grow?c=<checkout>&s=<notify secret>: Grow's notifyUrl
// (spec-online-payments-grow-a.md). The pure handler; the route passes the
// confirm step. The notification is only a trigger: its body is read (at
// most 64 KB) and dropped, never parsed or logged. Exempt from the site
// lock, so the per-checkout secret is the authentication.
//
// 401: a missing or wrong c / s (CHECKOUT_NOT_FOUND). 503: Grow is not
// configured or did not answer, the document is not at morning yet, or the
// database failed, so Grow retries. 200 otherwise (an issue for Tal is a
// 200 too). Every answer is no-store.

export const MAX_BODY_BYTES = 64 * 1024

export type NotifyConfirm = (
  checkoutId: string,
  secret: string
) => Promise<
  | { ok: true; pending: boolean }
  | {
      ok: false
      code: "CHECKOUT_NOT_FOUND" | "GROW_UNAVAILABLE" | "SERVER_ERROR"
    }
>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{16,200}$/

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

// Reads and drops the body, stopping after MAX_BODY_BYTES.
async function drainBody(request: Request): Promise<void> {
  const reader = request.body?.getReader()
  if (!reader) return
  let read = 0
  try {
    while (read <= MAX_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) return
      read += value?.byteLength ?? 0
    }
    await reader.cancel()
  } catch {
    // A broken body changes nothing: it is not used.
  }
}

export async function handleGrowNotification(
  request: Request,
  confirm: NotifyConfirm
): Promise<Response> {
  const url = new URL(request.url)
  const checkoutId = url.searchParams.get("c") ?? ""
  const secret = url.searchParams.get("s") ?? ""

  await drainBody(request)

  if (!UUID.test(checkoutId) || !SECRET.test(secret)) {
    return json({ error: "unauthorized" }, 401)
  }

  let result: Awaited<ReturnType<NotifyConfirm>>
  try {
    result = await confirm(checkoutId, secret)
  } catch {
    result = { ok: false, code: "SERVER_ERROR" }
  }

  if (!result.ok) {
    if (result.code === "CHECKOUT_NOT_FOUND") {
      return json({ error: "unauthorized" }, 401)
    }
    console.error("grow.notify", { code: result.code })
    return json({ error: "unavailable" }, 503)
  }
  if (result.pending) return json({ error: "pending" }, 503)
  return json({ ok: true }, 200)
}
