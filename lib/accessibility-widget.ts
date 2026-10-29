// The accessibility button (story 5.25): the free, MIT-licensed
// AccessibleWeb Widget (accessible-web-widget@1.6.2), self-hosted and loaded
// on demand. Our own button (components/shared/accessibility-button.tsx)
// opens the library's panel; the library's own button is hidden
// (`hideButton`). It never runs in /admin: the library has no teardown, so a
// client navigation into admin after it loaded reloads the page.
//
// No external request: the readable fonts are served from
// public/fonts/a11y/ (SIL OFL 1.1, LICENSE.txt there), and axe-core (dev
// tooling, only with ?acc-dev=true) points at a same-origin path that does
// not exist; the acc-dev parameter is removed before the import anyway. The
// library keeps the visitor's own preferences in localStorage["accweb"]
// (cookie "accweb", SameSite=Strict, only when localStorage throws).
// The build strips the library's MIT banner, so its notice is served as
// public/licenses/accessible-web-widget.txt.

export const WIDGET_STORAGE_KEY = "accweb"
const DEV_PARAM = "acc-dev"

/** The panel API the library puts on window.AccessibleWebWidget.instance. */
export type AccessibleWebWidgetInstance = {
  open(): boolean
  close(): void
  toggle(): void
}

/** The button and the library: every page but /admin/... and /api/... */
export function showsAccessibilityButton(pathname: string): boolean {
  return !/^\/(admin|api)(\/|$)/.test(pathname)
}

/**
 * Whether the saved library config turns anything on. A reset saves
 * `{"states":{}}`, and text size 1 is the default, so neither counts.
 */
export function configHasSettings(raw: string | null | undefined): boolean {
  if (!raw) return false
  let config: unknown
  try {
    config = JSON.parse(raw)
  } catch {
    return false
  }
  const states =
    config && typeof config === "object"
      ? (config as { states?: unknown }).states
      : undefined
  if (!states || typeof states !== "object") return false
  return Object.entries(states as Record<string, unknown>).some(
    ([key, value]) =>
      key === "text-scale"
        ? value !== false && value != null && Number(value) !== 1
        : Boolean(value)
  )
}

function readCookie(name: string): string | null {
  try {
    const prefix = `${name}=`
    const entry = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
  } catch {
    return null
  }
}

/** This device saved settings (the library's localStorage, else its cookie). */
export function hasSavedSettings(): boolean {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(WIDGET_STORAGE_KEY)
  } catch {
    stored = null
  }
  return configHasSettings(stored ?? readCookie(WIDGET_STORAGE_KEY))
}

/** window.AccessibleWebWidgetOptions, set before the import. */
export function widgetOptions() {
  return {
    lang: "he",
    position: "bottom-left",
    hideButton: true,
    // Its footer link goes off-site.
    hideAttribution: true,
    readableFontUrls: {
      dyslexic: "/fonts/a11y/OpenDyslexic3-Regular.woff",
      legible: "/fonts/a11y/AtkinsonHyperlegible-Regular.woff2",
      lexend: "/fonts/a11y/Lexend-Regular.woff2",
    },
    // A same-origin path that does not exist: nothing reaches jsDelivr.
    axeCoreUrl: "/fonts/a11y/axe-disabled.js",
    // DESIGN.md colours.
    primaryColor: "#4A4A2A",
    primaryColorDark: "#2E2A1F",
    activeColor: "#2E2A1F",
    primaryColorLight: "#6B6450",
    hoverColor: "#6B6450",
    backgroundColor: "#FAF6EE",
    cardBackground: "#FFFDF8",
    textColor: "#2E2A1F",
    textColorInverted: "#FAF6EE",
    borderColor: "#E6DFCF",
    focusRingColor: "#4A4A2A",
    buttonBorderRadius: "4px",
    borderRadius: "8px",
  }
}

/** The URL without acc-dev, or null when it has none. */
export function stripDevParam(href: string): string | null {
  const url = new URL(href)
  if (!url.searchParams.has(DEV_PARAM)) return null
  url.searchParams.delete(DEV_PARAM)
  return url.toString()
}

type Importer = () => Promise<unknown>

const importLibrary: Importer = () => import("accessible-web-widget")

let loading: Promise<AccessibleWebWidgetInstance> | null = null
let ready = false

/**
 * Imports the library once (the chunk is cached by the browser and the
 * service worker after that) and returns its instance. A failed import (for
 * example offline before the chunk was cached) is forgotten, so the next
 * call retries.
 */
export function loadWidget(
  importer: Importer = importLibrary
): Promise<AccessibleWebWidgetInstance> {
  if (!loading) {
    loading = (async () => {
      const clean = stripDevParam(window.location.href)
      if (clean) window.history.replaceState(window.history.state, "", clean)
      window.AccessibleWebWidgetOptions = widgetOptions()
      await importer()
      const instance = window.AccessibleWebWidget?.instance
      if (!instance) throw new Error("accessible-web-widget: no instance")
      ready = true
      return instance
    })().catch((error: unknown) => {
      loading = null
      throw error
    })
  }
  return loading
}

/** The import was started (and did not fail): the library may be in the page. */
export function widgetRequested(): boolean {
  return loading !== null
}

/** The library is loaded and its instance is ready. */
export function widgetReady(): boolean {
  return ready
}

/** Tests only. */
export function resetWidgetLoaderForTests() {
  loading = null
  ready = false
}
