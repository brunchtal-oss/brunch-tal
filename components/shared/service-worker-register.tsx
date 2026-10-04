"use client"

import { useEffect } from "react"

// Registers public/sw.js (story 5.9, AD-16) in a production build only, so
// `next dev` never serves stale files from a worker. updateViaCache "none":
// the browser always checks sw.js against the network.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Not installable this time (e.g. locked before the first sign-in);
        // the next page load tries again.
      })
  }, [])
  return null
}
