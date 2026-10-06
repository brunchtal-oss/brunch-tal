import { Suspense } from "react"
import type { Metadata } from "next"

import { NotificationList } from "@/components/shared/notification-list"
import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"
import { loadNotifications } from "@/lib/notifications/load"

import { markRead, markUnread } from "./actions"

export const metadata: Metadata = {
  title: shellCopy.notifications.title,
}

// The admin notification center (story 5.7), opened from the bell: her
// latest notifications, newest first. Rendered inside the shell's
// <Suspense> role gate.
export default function AdminNotificationsPage() {
  return (
    <>
      <PageHeading>{shellCopy.notifications.title}</PageHeading>
      {/* Story 5.8: the push explanation card goes here, above the list. */}
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <List />
      </Suspense>
    </>
  )
}

async function List() {
  const items = await loadNotifications("admin")
  return (
    <NotificationList
      surface="admin"
      initialItems={items}
      markRead={markRead}
      markUnread={markUnread}
    />
  )
}
