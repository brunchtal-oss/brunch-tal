// Push in the browser (story 5.8): the pure decisions (platform, the card's
// state, the VAPID key's bytes) and the small browser helpers that the push
// card, the sync and the sign-out field share. Imported only by client
// components. The permission is requested only from a click (iOS ignores
// anything else; pwa-push-notifications Step 11).

export type PushPlatform = "ios" | "android" | "desktop" | "other"

/**
 * The card's state on this device:
 * - unsupported: no service worker, Push API or Notification here;
 * - ios-install: an iPhone/iPad in a Safari tab (push needs the home-screen
 *   app);
 * - denied: blocked in the browser (only the device settings can undo it);
 * - off: "לא עכשיו" or "לכבות" on this device (never asked again by itself);
 * - on: permission granted and not turned off here;
 * - ask: not asked yet.
 */
export type PushState =
  "unsupported" | "ios-install" | "denied" | "off" | "on" | "ask"

export type PushEnv = {
  supported: boolean
  permission: NotificationPermission | null
  ios: boolean
  standalone: boolean
  choice: "off" | null
}

export function pushStateOf(env: PushEnv): PushState {
  if (env.ios && !env.standalone) return "ios-install"
  if (!env.supported || env.permission === null) return "unsupported"
  if (env.permission === "denied") return "denied"
  if (env.choice === "off") return "off"
  if (env.permission === "granted") return "on"
  return "ask"
}

/** iPadOS reports a Mac user agent; a touch screen tells them apart. */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  )
}

export function platformOf(
  userAgent: string,
  maxTouchPoints = 0
): PushPlatform {
  if (isIos(userAgent, maxTouchPoints)) return "ios"
  if (/Android/i.test(userAgent)) return "android"
  if (/Mobi|Tablet/i.test(userAgent)) return "other"
  if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return "desktop"
  return "other"
}

/**
 * The VAPID public key (base64url) as bytes. iOS rejects the string form,
 * and the fresh ArrayBuffer gives the Uint8Array<ArrayBuffer> type that
 * pushManager.subscribe accepts (pwa-push-notifications Step 8).
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/** "לא עכשיו" / "לכבות", per device (localStorage may be unavailable). */
const CHOICE_KEY = "push-choice"
/** Fired on window when the choice changes, so every reader updates. */
export const PUSH_CHANGE_EVENT = "push-change"

export function readChoice(): "off" | null {
  try {
    return window.localStorage.getItem(CHOICE_KEY) === "off" ? "off" : null
  } catch {
    return null
  }
}

export function writeChoice(choice: "off" | null): void {
  try {
    if (choice) window.localStorage.setItem(CHOICE_KEY, choice)
    else window.localStorage.removeItem(CHOICE_KEY)
  } catch {
    // Not stored: the card asks again on the next visit.
  }
  window.dispatchEvent(new Event(PUSH_CHANGE_EVENT))
}

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function readPushEnv(): PushEnv {
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  return {
    supported,
    permission: "Notification" in window ? Notification.permission : null,
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
    standalone: standalone(),
    choice: readChoice(),
  }
}

export function currentPushState(): PushState {
  return pushStateOf(readPushEnv())
}

/** Re-reads on a choice change and when the app comes back (settings). */
export function subscribePushState(onChange: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange()
  }
  window.addEventListener(PUSH_CHANGE_EVENT, onChange)
  document.addEventListener("visibilitychange", onVisible)
  return () => {
    window.removeEventListener(PUSH_CHANGE_EVENT, onChange)
    document.removeEventListener("visibilitychange", onVisible)
  }
}

export type PushRegistration = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  platform: PushPlatform
}

// The registered service worker, or null (none in `next dev`, or not yet).
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  return navigator.serviceWorker.ready
}

/** This device's subscription, created when there is none. Null without a
 * service worker or key. Only after the permission was granted. */
export async function ensureSubscription(): Promise<PushRegistration | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const reg = await registration()
  if (!reg || !key) return null
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }))
  // The sign-out field reads the endpoint again.
  window.dispatchEvent(new Event(PUSH_CHANGE_EVENT))
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    platform: platformOf(navigator.userAgent, navigator.maxTouchPoints),
  }
}

/** This device's endpoint, without creating a subscription. */
export async function currentEndpoint(): Promise<string | null> {
  try {
    const reg = await registration()
    const sub = await reg?.pushManager.getSubscription()
    return sub?.endpoint ?? null
  } catch {
    return null
  }
}

/** Ends this device's browser subscription; its endpoint, or null. */
export async function endSubscription(): Promise<string | null> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  window.dispatchEvent(new Event(PUSH_CHANGE_EVENT))
  return endpoint
}
