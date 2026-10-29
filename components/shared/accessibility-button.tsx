"use client"

import { AccessibilityIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type Ref } from "react"

import {
  hasSavedSettings,
  loadWidget,
  showsAccessibilityButton,
  widgetReady,
  widgetRequested,
  type AccessibleWebWidgetInstance,
} from "@/lib/accessibility-widget"
import { shellCopy } from "@/lib/copy/shell"

// The accessibility button (story 5.25): a fixed olive circle at the bottom
// inline-end of every page but /admin (lib/accessibility-widget.ts). The
// first click imports the AccessibleWeb Widget and opens its panel; a
// device that already saved settings imports it right after mount, so they
// apply. Not an OnlineButton: it sends nothing. Where it sits (above the
// whatsapp-bar, the tab bar and the cookie notice) and the room the page
// keeps for it: app/globals.css › [data-a11y-button].

export type WidgetDeps = {
  load: () => Promise<AccessibleWebWidgetInstance>
  requested: () => boolean
  saved: () => boolean
  reload: () => void
}

const defaultDeps: WidgetDeps = {
  load: () => loadWidget(),
  requested: widgetRequested,
  saved: hasSavedSettings,
  reload: () => window.location.reload(),
}

/**
 * On every path: into /admin after the library loaded, a full reload (it
 * has no teardown); elsewhere, load it when this device saved settings.
 */
export function syncWidgetWithPath(
  pathname: string,
  deps: WidgetDeps = defaultDeps
): void {
  if (!showsAccessibilityButton(pathname)) {
    if (deps.requested()) deps.reload()
    return
  }
  if (deps.saved()) deps.load().catch(() => {})
}

/**
 * Loads the library and opens its panel. Focus is put on the button first,
 * so the library returns it there when the panel closes. False when the
 * import failed (the next click retries).
 */
export async function openWidget(
  button: HTMLButtonElement | null,
  deps: Pick<WidgetDeps, "load"> = defaultDeps
): Promise<boolean> {
  try {
    const instance = await deps.load()
    button?.focus({ preventScroll: true })
    return instance.open()
  } catch {
    return false
  }
}

export function AccessibilityButton() {
  const pathname = usePathname()
  const shown = showsAccessibilityButton(pathname)
  const ref = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    syncWidgetWithPath(pathname)
  }, [pathname])

  if (!shown) return null
  return (
    <AccessibilityButtonView
      ref={ref}
      busy={busy}
      onClick={async () => {
        if (busy) return
        if (!widgetReady()) setBusy(true)
        try {
          await openWidget(ref.current)
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

export function AccessibilityButtonView({
  busy = false,
  onClick,
  ref,
}: {
  busy?: boolean
  onClick?: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-a11y-button=""
      aria-label={shellCopy.accessibilityButton}
      aria-haspopup="dialog"
      aria-busy={busy || undefined}
      onClick={onClick}
      className="fixed end-4 z-30 inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 print:hidden"
    >
      <AccessibilityIcon aria-hidden strokeWidth={1.5} className="size-6" />
    </button>
  )
}
