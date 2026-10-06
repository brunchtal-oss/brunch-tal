"use client"

import { useEffect } from "react"

import type { ActionResult } from "@/lib/errors"
import {
  currentPushState,
  ensureSubscription,
  type PushRegistration,
} from "@/lib/push/client"

// When the app comes back, at most one sync per this long.
const SYNC_EVERY_MS = 10 * 60 * 1000

// Mounted in the /me and /admin shells (story 5.8; pwa-push-notifications
// Step 10): when this device allows push and was not turned off here, its
// subscription (made again if the browser lost it) is registered for the
// signed-in account. So a device that moved between accounts belongs to the
// current one, and a subscription the database missed heals itself. Never
// asks for the permission.
export function PushSync({
  register,
}: {
  register: (input: PushRegistration) => Promise<ActionResult>
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
        const result = subscription ? await register(subscription) : null
        if (!result?.ok) lastSync = 0
      } catch {
        lastSync = 0
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") void sync()
    }
    void sync()
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [register])
  return null
}
