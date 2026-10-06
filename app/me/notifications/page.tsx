import { Suspense } from "react"
import type { Metadata } from "next"

import { NotificationList } from "@/components/shared/notification-list"
import { PageHeading } from "@/components/shared/page-heading"
import { PushCard } from "@/components/shared/push-card"
import { shellCopy } from "@/lib/copy/shell"
import { loadNotifications } from "@/lib/notifications/load"

import { markRead, markUnread, registerPush, unregisterPush } from "./actions"

export const metadata: Metadata = {
  title: shellCopy.notifications.title,
}

// The customer notification center (story 5.7), opened from the bell: her
// latest notifications, newest first. Rendered inside the shell's
// <Suspense> role gate.
export default function MeNotificationsPage() {
  return (
    <>
      <PageHeading>{shellCopy.notifications.title}</PageHeading>
      {/* Story 5.8: push on this device, above the list. */}
      <PushCard
        surface="customer"
        register={registerPush}
        unregister={unregisterPush}
      />
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <List />
      </Suspense>
    </>
  )
}

async function List() {
  const items = await loadNotifications("customer")
  return (
    <NotificationList
      surface="customer"
      initialItems={items}
      markRead={markRead}
      markUnread={markUnread}
    />
  )
}
