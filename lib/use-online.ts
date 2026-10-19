import { useSyncExternalStore } from "react"

// Whether the device is online (story 5.21, source §8: offline the screen
// may explain, never confirm a booking or a cancel). Read from
// navigator.onLine and kept current by the online/offline events, so the
// banner and the buttons come back without a reload. The server snapshot
// is "online": no flash of disabled buttons while the page loads.

/** Exported for the test: both events, both removed on unsubscribe. */
export function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  )
}

/**
 * Offline right now (for code outside React: the shared admin writes).
 * Only an explicit `false` counts, so an environment without the property
 * (Node in the tests) is online.
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}
