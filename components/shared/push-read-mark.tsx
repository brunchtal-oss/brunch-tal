"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

import type { ActionResult } from "@/lib/errors"

import { requestUnreadRefresh } from "./bell-button"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The notification a push click asks to mark read (?read=<id>, added by
 * public/sw.js), and the address without it (hash kept); null when there is
 * no valid id.
 */
export function readMarkOf(
  href: string
): { id: string; cleanPath: string } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const id = url.searchParams.get("read")
  if (!id || !UUID.test(id)) return null
  url.searchParams.delete("read")
  return { id, cleanPath: `${url.pathname}${url.search}${url.hash}` }
}

// Opening a push marks its notification read (story 3.5, user decision
// 2026-10-13). The service worker opens the target with ?read=<id>; here,
// inside the shell's role gate, the id goes to the surface's existing
// markRead action (her session; mark_notifications_read skips rows that are
// not hers), the parameter leaves the address bar, and the bell reads its
// count again. A failed mark changes nothing: she is already on the target.
export function PushReadMark({
  markRead,
}: {
  markRead: (ids: string[] | null) => Promise<ActionResult<{ marked: number }>>
}) {
  const pathname = usePathname()

  useEffect(() => {
    const mark = readMarkOf(window.location.href)
    if (!mark) return
    window.history.replaceState(window.history.state, "", mark.cleanPath)
    void markRead([mark.id])
      .catch(() => null)
      .then(() => requestUnreadRefresh())
  }, [pathname, markRead])

  return null
}
