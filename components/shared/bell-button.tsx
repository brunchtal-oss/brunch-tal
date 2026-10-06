"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BellIcon } from "lucide-react"

import type { ActionResult } from "@/lib/errors"
import { bellLabel, formatUnreadCount } from "@/lib/notifications/shared"

// The event a notification center sends when it changes the unread count
// (a row marked read or unread, "mark all"): the bell follows at once.
const UNREAD_DELTA_EVENT = "notifications:unread-delta"
// The event a center sends once a mark request has settled: the bell asks the
// server for the real count, which replaces the optimistic one.
const UNREAD_REFRESH_EVENT = "notifications:unread-refresh"

/** Tells the bell that `delta` notifications became unread (or read, < 0). */
export function announceUnreadDelta(delta: number): void {
  if (delta === 0 || typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<number>(UNREAD_DELTA_EVENT, { detail: delta })
  )
}

/** Asks the bell to read the unread count from the server again. */
export function requestUnreadRefresh(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT))
}

// bell-button (DESIGN › bell-button, EXPERIENCE › bell-button; story 5.7): a
// 44×44 link to the surface's notification center on the olive top-bar. The
// unread count is a pill (on-primary with primary text, so it reads on the
// bar) in the top inline-end corner, and is part of the link's name
// ("התראות, 3 שלא נקראו"). The first value comes from the server
// (`initialCount`, null while it streams in); afterwards the bell asks
// `refresh` on every route change and when the app comes back into view, so a
// change on another device shows up there. A change is announced politely.
export function BellButton({
  href,
  initialCount,
  refresh,
}: {
  href: string
  initialCount: number | null
  refresh?: () => Promise<ActionResult<number>>
}) {
  const [count, setCount] = useState(initialCount ?? 0)
  // Announced only after a change, never on the first render.
  const [changed, setChanged] = useState(false)
  const countRef = useRef(count)
  const pathname = usePathname()
  const firstPath = useRef(true)
  const refreshRef = useRef(refresh)
  // Only the latest refresh may set the count: an older one that resolves
  // later is stale.
  const requestSeq = useRef(0)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const apply = useCallback((next: number) => {
    if (next === countRef.current) return
    countRef.current = next
    setCount(next)
    setChanged(true)
  }, [])

  const load = useCallback(async () => {
    const fn = refreshRef.current
    if (!fn) return
    const seq = ++requestSeq.current
    try {
      const result = await fn()
      if (result.ok && seq === requestSeq.current) apply(result.data)
    } catch {
      // Keep the last count; the next route change asks again.
    }
  }, [apply])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    const onDelta = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail
      if (typeof delta !== "number") return
      apply(Math.max(0, countRef.current + delta))
    }
    const onRefresh = () => void load()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener(UNREAD_DELTA_EVENT, onDelta)
    window.addEventListener(UNREAD_REFRESH_EVENT, onRefresh)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(UNREAD_DELTA_EVENT, onDelta)
      window.removeEventListener(UNREAD_REFRESH_EVENT, onRefresh)
    }
  }, [apply, load])

  // Every route change after the first render asks the server again.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false
      return
    }
    void load()
  }, [pathname, load])

  return (
    <>
      <Link
        href={href}
        aria-label={bellLabel(count)}
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-primary-foreground hover:bg-primary-foreground/10"
      >
        <BellIcon aria-hidden strokeWidth={1.5} className="size-6" />
        {count > 0 && (
          <span
            aria-hidden
            data-unread-count=""
            className="absolute -end-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-[12px] leading-none font-semibold text-primary tabular-nums ring-2 ring-primary"
          >
            {formatUnreadCount(count)}
          </span>
        )}
      </Link>
      <span aria-live="polite" className="sr-only">
        {changed ? bellLabel(count) : ""}
      </span>
    </>
  )
}
