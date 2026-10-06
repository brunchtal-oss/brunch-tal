import "server-only"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The writes behind the push card, the sync and sign-out (story 5.8): shape
// only here; register_push_subscription / unregister_push_subscription check
// who calls (an active customer or an admin) and the values again.

const PLATFORMS = ["ios", "android", "desktop", "other"] as const
const KEY = /^[A-Za-z0-9_-]+={0,2}$/

export type PushRegistrationInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  platform: (typeof PLATFORMS)[number]
}

export function isPushEndpoint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1000 &&
    /^https:\/\/\S+$/.test(value)
  )
}

export function parsePushRegistration(
  value: unknown
): PushRegistrationInput | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const keys =
    v.keys && typeof v.keys === "object"
      ? (v.keys as Record<string, unknown>)
      : null
  if (!isPushEndpoint(v.endpoint) || !keys) return null
  const { p256dh, auth } = keys
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length > 200 ||
    auth.length > 100 ||
    !KEY.test(p256dh) ||
    !KEY.test(auth)
  ) {
    return null
  }
  const platform = PLATFORMS.find((p) => p === v.platform)
  if (!platform) return null
  return { endpoint: v.endpoint, keys: { p256dh, auth }, platform }
}

export async function registerPushSubscription(
  input: unknown
): Promise<ActionResult> {
  const parsed = parsePushRegistration(input)
  if (!parsed) return { ok: false, code: "INVALID_INPUT" }
  const supabase = await createClient()
  const result = await callRpc(supabase, "register_push_subscription", {
    p_endpoint: parsed.endpoint,
    p_keys: parsed.keys,
    p_platform: parsed.platform,
  })
  return result.ok ? { ok: true, data: undefined } : result
}

export async function unregisterPushSubscription(
  endpoint: unknown
): Promise<ActionResult> {
  if (!isPushEndpoint(endpoint)) return { ok: false, code: "INVALID_INPUT" }
  const supabase = await createClient()
  const result = await callRpc(supabase, "unregister_push_subscription", {
    p_endpoint: endpoint,
  })
  return result.ok ? { ok: true, data: undefined } : result
}
