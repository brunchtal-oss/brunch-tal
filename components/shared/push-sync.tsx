"use client"

import { useEffect } from "react"

import type { ActionResult } from "@/lib/errors"
import {
  currentPushState,
  ensureSubscription,
  forgetReplaced,
  type PushRegistration,
} from "@/lib/push/client"

// When the app comes back, at most one sync per this long.
const SYNC_EVERY_MS = 10 * 60 * 1000

// Mounted in the /me and /admin shells (story 5.8; pwa-push-notifications
// Step 10): when this device allows push and was not turned off here, its
// subscription (made again if the browser lost it) is registered for the
// signed-in account. So a device that moved between accounts belongs to the
// current one, and a subscription the database missed heals itself. A
// subscription made with another VAPID key is made again, and its old
// endpoint removed (fix-push-key-change). Never asks for the permission, and
// never runs on a device turned off here (state "off", not "on").
export function PushSync({
  register,
  unregister,
}: {
  register: (input: PushRegistration) => Promise<ActionResult>
  unregister: (endpoint: string) => Promise<ActionResult>
}) {
  useEffect(() => {
    // Every mount syncs (a sign-in to another account mounts a shell again).
    let lastSync = 0
    async function sync() {
      if (Date.now() - lastSync < SYNC_EVERY_MS) return
      if (currentPushState() !== "on") return
      lastSync = Date.now()
      try {
        const subscription = await ensureSubscription()
        const result = subscription
          ? await register(subscription.registration)
          : null
        if (!result?.ok) lastSync = 0
        else if (subscription?.replaced) await dropOld(subscription.replaced)
      } catch {
        lastSync = 0
      }
    }
    // The old endpoint, after the new one is registered. Forgotten on this
    // device only once the server removed it; otherwise the next sync tries
    // again. A failure here never fails the sync.
    async function dropOld(endpoint: string) {
      try {
        if ((await unregister(endpoint)).ok) forgetReplaced()
      } catch {
        // Kept on this device for the next sync.
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void sync()
    }
    void sync()
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [register, unregister])
  return null
}
