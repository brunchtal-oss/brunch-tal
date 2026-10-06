"use client"

import Link from "next/link"
import { MailIcon, MailOpenIcon } from "lucide-react"

import { shellCopy } from "@/lib/copy/shell"
import type { NotificationView } from "@/lib/notifications/shared"
import { formatNotificationTime } from "@/lib/time"
import { cn } from "@/lib/utils"

const copy = shellCopy.notifications

// notification-item (DESIGN › notification-item, EXPERIENCE ›
// notification-item; story 5.7): one row of a center, with a divider. The
// row's text is one link to its target (`href`, already checked against the
// surface). Unread: the title in body-strong after an 8px accent dot
// (aria-hidden) and the sr-only word "לא נקראה"; read: the title in body.
// The body in body-sm, the time in label, ink-muted. The read/unread toggle
// is a 44×44 icon button next to the link, never inside it (one target per
// row). `onOpen` runs on a plain click of an unread row (mark, then go);
// `now` is for tests.
export function NotificationItem({
  item,
  href,
  onOpen,
  onToggle,
  pending = false,
  now,
}: {
  item: NotificationView
  href: string
  onOpen?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  onToggle?: () => void
  pending?: boolean
  now?: Date
}) {
  const unread = !item.read
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
          {unread && (
            <span
              aria-hidden
              className="size-2 shrink-0 translate-y-[-0.1em] rounded-full bg-brand-accent"
            />
          )}
          <span
            className={cn(
              "text-base leading-snug text-pretty",
              unread ? "font-semibold" : "font-normal"
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
              unread && "ps-4"
            )}
          >
            {item.body}
          </span>
        )}
        <time
          dateTime={item.createdAt}
          // Server and browser may straddle midnight ("היום" / "אתמול").
          suppressHydrationWarning
          className={cn(
            "text-[13px] leading-tight text-muted-foreground",
            unread && "ps-4"
          )}
        >
          {formatNotificationTime(item.createdAt, now)}
        </time>
      </Link>
      <button
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
      </button>
    </li>
  )
}
