import "server-only"

import { headers } from "next/headers"

import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// The one rate limiter of the login and the token actions (story 2.8, user
// decision 2026-10-13): public.rate_limit_hit in our database, fixed
// 15-minute window, counted per IP and per account or token. This file is
// its only caller. The thresholds live in the SQL:
//   login: 20 per IP, 8 per account (normalized email)
//   token: 20 per IP, 10 per token (join submit, claim, reset submit)
// The keys reach the database only to be hashed there; they are never
// logged here (AD-22).

export type RateLimitBucket = "login" | "token"

export type RateLimitKeys = {
  // The client IP (clientIp()).
  ip: string
  // The account (normalized email) or the raw token.
  id: string
}

// The client IP as Vercel passes it: x-real-ip, else the first address of
// x-forwarded-for, else "unknown" (all such requests share one key).
export function clientIpFrom(h: Pick<Headers, "get">): string {
  const real = h.get("x-real-ip")?.trim()
  if (real) return real
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded
  return "unknown"
}

export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers())
}

// Counts one attempt and answers whether it may go on: "allowed",
// "blocked", or "failed" when the limiter itself fails (network, database).
// A failure blocks too (user decision 2026-10-13): a missing limiter must
// show at once, not leave the login unprotected; the caller answers
// SERVER_ERROR, since Auth runs on the same project anyway.
export type RateLimitVerdict = "allowed" | "blocked" | "failed"

export async function hitRateLimit(
  bucket: RateLimitBucket,
  keys: RateLimitKeys
): Promise<RateLimitVerdict> {
  let result: Awaited<ReturnType<typeof callRpc<"rate_limit_hit">>>
  try {
    result = await callRpc(createServiceClient(), "rate_limit_hit", {
      p_bucket: bucket,
      // Bounded, as the SQL accepts at most 512 characters a key.
      p_keys: [`ip:${keys.ip}`.slice(0, 512), `id:${keys.id}`.slice(0, 512)],
    })
  } catch {
    result = { ok: false, code: "SERVER_ERROR" }
  }
  if (!result.ok) {
    console.error("rate_limit.failed", { bucket, code: result.code })
    return "failed"
  }
  const allowed = (result.data as { allowed?: unknown } | null)?.allowed
  if (allowed === true) return "allowed"
  if (allowed === false) return "blocked"
  console.error("rate_limit.failed", { bucket, code: "UNEXPECTED_RESULT" })
  return "failed"
}

// The error code of a verdict that stops the action, null when it may go on.
export function rateLimitCode(
  verdict: RateLimitVerdict
): "TOO_MANY_ATTEMPTS" | "SERVER_ERROR" | null {
  if (verdict === "allowed") return null
  return verdict === "blocked" ? "TOO_MANY_ATTEMPTS" : "SERVER_ERROR"
}
