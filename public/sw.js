// @ts-check
/// <reference lib="webworker" />

// Service worker (story 5.9, AD-16). Written by hand: no build step, no
// Workbox. Served with Cache-Control: no-cache (next.config.mjs) and
// registered only in a production build.
//
// What it does:
// - Caches only same-origin GET of /_next/static/* and /icons/* (cache-first,
//   only a 200 is stored) and the /offline page with its static files
//   (stored at install).
// - Navigations are network-only; only a network failure falls back to
//   /offline. A 401 (the site lock) or a 500 passes through as it is.
// - Never caches the HTML of /me or /admin, /api, RSC requests or a non-200.
// - push always ends in showNotification; notificationclick opens the
//   payload's target_path when it is under /me or /admin, else "/".
//
// Bump VERSION when /offline, the icons or this behaviour change: /offline
// is stored only at install, the icons are cache-first under fixed names
// (regenerated ones stay stale until then), and activate deletes the caches
// of older versions.

const VERSION = "v1"
const CACHE_PREFIX = "brunch-"
const CACHE = `${CACHE_PREFIX}${VERSION}`
const OFFLINE_URL = "/offline"
// WORDMARK (lib/copy/shell.ts); sw.test.ts checks they stay equal.
const DEFAULT_TITLE = "בראנץ׳ אצל טל"
const ICON = "/icons/icon-192.png"

const sw = /** @type {ServiceWorkerGlobalScope} */ (
  /** @type {unknown} */ (self)
)

// Same-origin static paths in a page: /_next/static/... up to a quote,
// whitespace, a backslash (escaped in RSC data) or a bracket.
const STATIC_IN_HTML = /\/_next\/static\/[^"'\s\\<>()]+/g

/** @param {string} pathname */
function isCacheable(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/")
}

/**
 * @param {Cache} cache
 * @param {RequestInfo} request
 */
async function fetchAndStore(cache, request) {
  const response = await fetch(request)
  if (response.status === 200) await cache.put(request, response.clone())
  return response
}

async function precache() {
  const cache = await caches.open(CACHE)
  const response = await fetch(OFFLINE_URL, { cache: "no-store" })
  // A 401 (locked, no credentials yet) or an error is not stored: the
  // install fails and the browser tries again on a later visit.
  if (response.status !== 200) throw new Error("offline page unavailable")
  const html = await response.clone().text()
  await cache.put(OFFLINE_URL, response)
  const assets = new Set(
    (html.match(STATIC_IN_HTML) ?? []).map((path) =>
      path.replaceAll("&amp;", "&")
    )
  )
  await Promise.all(
    [...assets].map((path) => fetchAndStore(cache, path).catch(() => null))
  )
}

sw.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => sw.skipWaiting()))
})

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name))
      )
      await sw.clients.claim()
    })()
  )
})

/** @param {Request} request */
async function networkOrOffline(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(CACHE)
    return (await cache.match(OFFLINE_URL)) ?? Response.error()
  }
}

/** @param {Request} request */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  return hit ?? fetchAndStore(cache, request)
}

sw.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== sw.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request))
    return
  }
  // /api, RSC (?_rsc) and everything else: the browser handles it.
  if (isCacheable(url.pathname) && !url.searchParams.has("_rsc")) {
    event.respondWith(cacheFirst(request))
  }
})

/**
 * A path inside the app's own areas, else the home page.
 * @param {unknown} value
 */
function safeTarget(value) {
  return typeof value === "string" && /^\/(me|admin)(\/|\?|#|$)/.test(value)
    ? value
    : "/"
}

/**
 * The push contract with story 5.8: { title, body, target_path }. A missing
 * or broken payload still shows a notification (browsers may revoke the
 * subscription of a push that shows none).
 * @param {PushMessageData | null} data
 */
function readPayload(data) {
  let title = DEFAULT_TITLE
  let body = ""
  let target = "/"
  try {
    const json = data ? data.json() : null
    if (json && typeof json === "object") {
      if (typeof json.title === "string" && json.title) title = json.title
      if (typeof json.body === "string") body = json.body
      target = safeTarget(json.target_path)
    }
  } catch {
    // Not JSON: the defaults.
  }
  return { title, body, target }
}

sw.addEventListener("push", (event) => {
  const { title, body, target } = readPayload(event.data)
  event.waitUntil(
    sw.registration.showNotification(title, {
      body,
      lang: "he",
      dir: "rtl",
      icon: ICON,
      data: { target_path: target },
    })
  )
})

sw.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = safeTarget(event.notification.data?.target_path)
  const url = new URL(target, sw.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const open = windows[0]
      if (!open) {
        await sw.clients.openWindow(url)
        return
      }
      const focused = await open.focus()
      try {
        await focused.navigate(url)
      } catch {
        // An uncontrolled window cannot be navigated from here.
        await sw.clients.openWindow(url)
      }
    })()
  )
})
