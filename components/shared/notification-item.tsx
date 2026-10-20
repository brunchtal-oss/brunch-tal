"use client"

import Link from "next/link"
import { MailIcon, MailOpenIcon } from "lucide-react"

import { shellCopy } from "@/lib/copy/shell"
import type { NotificationView } from "@/lib/notifications/shared"
import { formatNotificationTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { OnlineNativeButton } from "./online-button"

const copy = shellCopy.notifications

// notification-item (DESIGN › notification-item, EXPERIENCE ›
// notification-item; story 5.7): one row of a center, with a divider. The
// row's text is one link to its target (`href`, already checked against the
// surface). Unread: the title in body-strong after an 8px accent dot
// (aria-hidden) and the sr-only word "לא נקראה"; read: the title in body.
// The body in body-sm, the time in label, ink-muted. The read/unread toggle
// is a 44×44 icon button next to the link, never inside it (one target per
// row). `onOpen` runs on a plain click of an unread row (mark, then go);
// `fresh`: it was unread when the center opened, so it keeps the unread look
// (dot, strong title) for this visit while the read state, its sr-only word
// and the toggle follow the server (story 3.5); `now` is for tests.
export function NotificationItem({
  item,
  href,
  onOpen,
  onToggle,
  pending = false,
  fresh = false,
  now,
}: {
  item: NotificationView
  href: string
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  onToggle?: () => void
  pending?: boolean
  fresh?: boolean
  now?: Date
}) {
  const unread = !item.read
  const emphasis = unread || fresh
  return (
    <li
      data-notification-item=""
      className="flex items-start gap-1 border-b border-border"
    >
      <Link
        href={href}
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-[4px] py-4"
      >
        <span className="flex items-baseline gap-2">
          {emphasis && (
            <span
              aria-hidden
              className="size-2 shrink-0 translate-y-[-0.1em] rounded-full bg-brand-accent"
            />
          )}
          <span
            className={cn(
              "text-base leading-snug text-pretty",
              emphasis ? "font-semibold" : "font-normal"
            )}
          >
            {unread && <span className="sr-only">{copy.unread}, </span>}
            {item.title}
          </span>
        </span>
        {item.body && (
          <span
            className={cn(
              "text-[15px] leading-normal text-pretty text-foreground",
              emphasis && "ps-4"
            )}
          >
            {item.body}
          </span>
        )}
        {item.spotTaken && (
          <span
            className={cn(
              "text-[15px] leading-normal font-semibold text-pretty",
              emphasis && "ps-4"
            )}
          >
            {copy.spotTaken}
          </span>
        )}
        <time
          dateTime={item.createdAt}
          // Server and browser may straddle midnight ("היום" / "אתמול").
          suppressHydrationWarning
          className={cn(
            "text-[13px] leading-tight text-muted-foreground",
            emphasis && "ps-4"
          )}
        >
          {formatNotificationTime(item.createdAt, now)}
        </time>
      </Link>
      <OnlineNativeButton
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-label={unread ? copy.markRead : copy.markUnread}
        className="mt-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {unread ? (
          <MailOpenIcon aria-hidden strokeWidth={1.5} className="size-5" />
        ) : (
          <MailIcon aria-hidden strokeWidth={1.5} className="size-5" />
        )}
      </OnlineNativeButton>
    </li>
  )
}
