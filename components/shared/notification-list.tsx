"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage, type ActionResult } from "@/lib/errors"
import {
  safeNotificationTarget,
  type NotificationSurface,
  type NotificationView,
} from "@/lib/notifications/shared"

import { announceUnreadDelta, requestUnreadRefresh } from "./bell-button"
import { InlineNotice } from "./inline-notice"
import { NotificationItem } from "./notification-item"

const copy = shellCopy.notifications

// How long a click on an unread row waits for the mark before it goes on to
// the target anyway (EXPERIENCE › notification-item).
const OPEN_MARK_TIMEOUT_MS = 1500

type MarkResult = ActionResult<{ marked: number }>

// The list of a notification center (story 5.7): "סימון הכול כנקרא" only
// while something is unread, then one notification-item per row, newest
// first; empty: one sentence, no action. A row and the bell change at once
// (optimistic); a failed toggle puts the row back and says so. Opening an
// unread row marks it (waiting up to 1.5 seconds) and then goes to its
// target, also when the mark failed (the row then turns unread again). Once a
// mark settles the bell reads the real count from the server. Only targets
// inside the surface.
export function NotificationList({
  surface,
  initialItems,
  markRead,
  markUnread,
}: {
  surface: NotificationSurface
  initialItems: NotificationView[]
  markRead: (ids: string[] | null) => Promise<MarkResult>
  markUnread: (ids: string[]) => Promise<MarkResult>
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const unreadIds = items.filter((item) => !item.read).map((item) => item.id)

  function setRead(ids: readonly string[], read: boolean) {
    setItems((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, read } : item))
    )
  }

  function setBusy(id: string, busy: boolean) {
    setPending((current) => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function toggle(item: NotificationView) {
    const nowRead = !item.read
    setError(null)
    setBusy(item.id, true)
    setRead([item.id], nowRead)
    announceUnreadDelta(nowRead ? -1 : 1)
    let result: MarkResult
    try {
      result = nowRead ? await markRead([item.id]) : await markUnread([item.id])
    } catch {
      result = { ok: false, code: "SERVER_ERROR" }
    }
    if (!result.ok) {
      setRead([item.id], item.read)
      announceUnreadDelta(nowRead ? 1 : -1)
      setError(errorMessage(result.code))
    }
    setBusy(item.id, false)
  }

  async function markAll() {
    const ids = unreadIds
    if (ids.length === 0 || markingAll) return
    setMarkingAll(true)
    setError(null)
    setRead(ids, true)
    announceUnreadDelta(-ids.length)
    let result: MarkResult
    try {
      result = await markRead(null)
    } catch {
      result = { ok: false, code: "SERVER_ERROR" }
    }
    if (!result.ok) {
      setRead(ids, false)
      announceUnreadDelta(ids.length)
      setError(errorMessage(result.code))
    }
    setMarkingAll(false)
    requestUnreadRefresh()
  }

  function open(
    event: React.MouseEvent<HTMLAnchorElement>,
    item: NotificationView,
    href: string
  ) {
    // A new tab or window keeps the browser's own behaviour.
    if (
      item.read ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    setRead([item.id], true)
    announceUnreadDelta(-1)
    const marked = markRead([item.id]).then(
      (result) => result,
      (): MarkResult => ({ ok: false, code: "SERVER_ERROR" })
    )
    // Also after navigating: a failed mark puts the row back, and the bell
    // reads the real count.
    void marked.then((result) => {
      if (!result.ok) setRead([item.id], false)
      requestUnreadRefresh()
    })
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, OPEN_MARK_TIMEOUT_MS)
    )
    void Promise.race([marked, timeout]).then(() => router.push(href))
  }

  if (items.length === 0) {
    return <p className="text-base text-muted-foreground">{copy.empty}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {unreadIds.length > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void markAll()}
          disabled={markingAll}
          className="min-h-11 self-start border-foreground bg-transparent px-4 text-base font-semibold"
        >
          {copy.markAllRead}
        </Button>
      )}
      <ul aria-label={copy.listLabel} className="flex flex-col">
        {items.map((item) => {
          const href = safeNotificationTarget(surface, item.targetPath)
          return (
            <NotificationItem
              key={item.id}
              item={item}
              href={href}
              pending={pending.has(item.id)}
              onOpen={(event) => open(event, item, href)}
              onToggle={() => void toggle(item)}
            />
          )
        })}
      </ul>
    </div>
  )
}
